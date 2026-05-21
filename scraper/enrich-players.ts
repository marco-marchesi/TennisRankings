// Player enrichment via Wikidata + Wikipedia.
//
// For each player who has a wikidata_id (set during Tennis Abstract ranking
// backfill) but is missing a photo or backhand style, hit two public APIs:
//
//   1. Wikidata `wbgetentities` → grab P18 (image filename) + sitelinks[enwiki]
//      Image lives on Wikimedia Commons; we build the standard Special:FilePath
//      URL so the browser gets a stable, properly-licensed thumb.
//
//   2. Wikipedia REST API `/page/html/{title}` → parse the infobox `Plays`
//      row for the backhand style ("two-handed" / "one-handed"). This is the
//      only canonical public source for that field — TA doesn't expose it
//      and Wikidata doesn't model it as a structured property.
//
// Runs rate-limited at 1 req/s per host (Wikimedia's polite-bot guideline).
// Idempotent: skips players who already have photo + backhand filled.
//
// Usage:
//   pnpm scraper:enrich-players                    # both tours, top 50
//   pnpm scraper:enrich-players atp --top 100
//   pnpm scraper:enrich-players -- --force         # overwrite existing data

import { db, schema } from "@/db";
import { and, desc, eq, isNotNull, isNull, or, sql } from "drizzle-orm";

const WIKIDATA_API = "https://www.wikidata.org/w/api.php";
const WIKIPEDIA_REST = "https://en.wikipedia.org/api/rest_v1";
const COMMONS_FILEPATH = "https://commons.wikimedia.org/wiki/Special:FilePath";

const USER_AGENT = "TennisRankingsBot/0.1 (https://tennisrankings.example; contact: dev@tennisrankings.example)";
const HOST_INTERVAL_MS = 1100;
const lastHit = new Map<string, number>();

interface EnrichOptions {
  topN: number;
  tour?: "atp" | "wta";
  force: boolean;
}

interface EnrichResult {
  scanned: number;
  enriched: number;
  noWikidata: string[];
  failures: { slug: string; reason: string }[];
}

export async function enrichPlayers(opts: EnrichOptions): Promise<EnrichResult> {
  const result: EnrichResult = { scanned: 0, enriched: 0, noWikidata: [], failures: [] };

  // Pull top-N players in current settled snapshot. Easier than joining via
  // ranking history twice when we just need a recency filter.
  const rows = await db.execute<{
    id: number;
    slug: string;
    full_name: string;
    wikidata_id: string | null;
    photo_url: string | null;
    backhand: string | null;
    wikipedia_url: string | null;
  }>(sql`
    with latest as (
      select tour, max(week_of) as week_of
      from rankings_snapshots
      where is_race = false
      group by tour
    )
    select p.id, p.slug, p.full_name, p.wikidata_id, p.photo_url, p.backhand, p.wikipedia_url
    from players p
    join rankings_snapshots rs on rs.player_id = p.id and rs.is_race = false
    join latest l on l.tour = p.tour and l.week_of = rs.week_of
    where ${opts.tour ? sql`p.tour = ${opts.tour}` : sql`true`}
    order by rs.rank
    limit ${opts.topN};
  `);
  const candidates =
    (rows as unknown as { rows: Array<Record<string, unknown>> }).rows ??
    (rows as unknown as Array<Record<string, unknown>>);
  result.scanned = candidates.length;

  for (const c of candidates) {
    const id = Number(c.id);
    const slug = String(c.slug);
    const fullName = String(c.full_name);
    const wikidataId = c.wikidata_id as string | null;
    const photoUrl = c.photo_url as string | null;
    const backhand = c.backhand as string | null;
    const wikipediaUrl = c.wikipedia_url as string | null;

    if (!opts.force && photoUrl && backhand) continue;

    if (!wikidataId) {
      result.noWikidata.push(fullName);
      continue;
    }

    try {
      const updates: Partial<typeof schema.players.$inferInsert> = {};
      const wd = await fetchWikidataEntity(wikidataId);

      if ((opts.force || !photoUrl) && wd.imageFile) {
        const cleaned = wd.imageFile.replace(/^File:/i, "");
        updates.photoUrl = `${COMMONS_FILEPATH}/${encodeURIComponent(cleaned)}?width=400`;
        updates.photoAttribution = `Wikimedia Commons · ${cleaned}`;
      }
      if ((opts.force || !wikipediaUrl) && wd.enwikiTitle) {
        updates.wikipediaUrl = `https://en.wikipedia.org/wiki/${encodeURIComponent(wd.enwikiTitle.replace(/ /g, "_"))}`;
      }
      if ((opts.force || !backhand) && wd.enwikiTitle) {
        const inferredBackhand = await fetchWikipediaBackhand(wd.enwikiTitle);
        if (inferredBackhand) updates.backhand = inferredBackhand;
      }

      if (Object.keys(updates).length > 0) {
        updates.updatedAt = new Date();
        await db.update(schema.players).set(updates).where(eq(schema.players.id, id));
        result.enriched++;
      }
    } catch (err) {
      result.failures.push({ slug, reason: err instanceof Error ? err.message : String(err) });
    }
  }

  return result;
}

// ─── Wikidata ─────────────────────────────────────────────────────────────

interface WdEntityResult {
  imageFile: string | null;
  enwikiTitle: string | null;
}

async function fetchWikidataEntity(qid: string): Promise<WdEntityResult> {
  const url = new URL(WIKIDATA_API);
  url.searchParams.set("action", "wbgetentities");
  url.searchParams.set("ids", qid);
  url.searchParams.set("props", "claims|sitelinks");
  url.searchParams.set("sitefilter", "enwiki");
  url.searchParams.set("format", "json");
  url.searchParams.set("origin", "*");
  const json = (await politeJson(url.toString())) as {
    entities?: Record<string, {
      claims?: Record<string, Array<{ mainsnak?: { datavalue?: { value?: string } } }>>;
      sitelinks?: { enwiki?: { title?: string } };
    }>;
  };
  const entity = json.entities?.[qid];
  if (!entity) return { imageFile: null, enwikiTitle: null };
  const imageClaim = entity.claims?.P18?.[0]?.mainsnak?.datavalue?.value;
  const enwikiTitle = entity.sitelinks?.enwiki?.title ?? null;
  return { imageFile: imageClaim ?? null, enwikiTitle };
}

// ─── Wikipedia ────────────────────────────────────────────────────────────

/**
 * Returns "one-handed" or "two-handed" parsed from the infobox `Plays` row,
 * or null when the article doesn't structure that field. The REST API
 * gives us a cleaner HTML document than the raw page view.
 */
async function fetchWikipediaBackhand(title: string): Promise<string | null> {
  const url = `${WIKIPEDIA_REST}/page/html/${encodeURIComponent(title.replace(/ /g, "_"))}`;
  const html = await politeText(url);
  // Infobox row looks like:
  //   <th>Plays</th><td>Right-handed (two-handed backhand)</td>
  // Match the "Plays" cell loosely — Wikipedia varies the wrappers across
  // articles but the "two-handed backhand" / "one-handed backhand" phrase is
  // standardised across the tennis project's manual of style.
  const playsRowMatch = html.match(/<th[^>]*>Plays<\/th>\s*<td[^>]*>([\s\S]{0,400}?)<\/td>/i);
  if (!playsRowMatch) return null;
  const cell = playsRowMatch[1] ?? "";
  if (/two[- ]handed\s+backhand/i.test(cell)) return "two-handed";
  if (/one[- ]handed\s+backhand/i.test(cell)) return "one-handed";
  return null;
}

// ─── transport ────────────────────────────────────────────────────────────

async function politeText(url: string): Promise<string> {
  await throttle(url);
  const res = await fetch(url, { headers: { "User-Agent": USER_AGENT, Accept: "text/html, */*;q=0.5" } });
  if (!res.ok) throw new Error(`${url} → ${res.status} ${res.statusText}`);
  return res.text();
}

async function politeJson(url: string): Promise<unknown> {
  await throttle(url);
  const res = await fetch(url, { headers: { "User-Agent": USER_AGENT, Accept: "application/json" } });
  if (!res.ok) throw new Error(`${url} → ${res.status} ${res.statusText}`);
  return res.json();
}

async function throttle(url: string) {
  const host = new URL(url).host;
  const since = Date.now() - (lastHit.get(host) ?? 0);
  if (since < HOST_INTERVAL_MS) {
    await new Promise((r) => setTimeout(r, HOST_INTERVAL_MS - since));
  }
  lastHit.set(host, Date.now());
}

async function main() {
  const args = process.argv.slice(2);
  const tourArg = args.find((a) => a === "atp" || a === "wta") as "atp" | "wta" | undefined;
  const topIdx = args.indexOf("--top");
  const topN = topIdx >= 0 && args[topIdx + 1] ? Number(args[topIdx + 1]) : 50;
  const force = args.includes("--force");

  console.log(`[enrich] tours: ${tourArg ?? "atp+wta"}  topN: ${topN}  force: ${force}`);
  const tours = tourArg ? [tourArg] : (["atp", "wta"] as const);
  for (const tour of tours) {
    const r = await enrichPlayers({ tour, topN, force });
    console.log(
      `[enrich] ${tour.toUpperCase()}: scanned=${r.scanned} enriched=${r.enriched} ` +
        `noWikidata=${r.noWikidata.length} failures=${r.failures.length}`,
    );
    if (r.failures.length > 0 && r.failures.length <= 6) {
      for (const f of r.failures) console.log(`           ${f.slug}: ${f.reason}`);
    }
  }
}

const entryFile = process.argv[1] ?? "";
if (entryFile.endsWith("enrich-players.ts") || entryFile.endsWith("enrich-players.js")) {
  main()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
