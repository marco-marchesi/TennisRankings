// Player enrichment: photo (downloaded + cached in DB) + backhand + DOB.
//
// Eligibility for a photo is restricted to "ever in the top 100" — lower-
// ranked players generally don't have a usable Wikipedia infobox image, and
// we don't want to hammer Wikimedia trying to find one each week.
//
// Pipeline per player:
//   1. Look up Wikidata entity → P18 (image filename) + sitelinks.enwiki.
//   2. If P18 exists: GET the binary from Special:FilePath, store bytes in
//      players.photo_bytes (+ content_type, fetched_at).
//   3. If enwiki title exists: GET the Wikipedia HTML, parse the "Plays"
//      row of the infobox for backhand style.
//   4. Always update photo_attempt_at — so the next run can skip players we
//      recently checked even if no photo was downloaded.
//
// Rate-limited at 1.1s per host (Wikimedia's polite-bot guideline).

import { db, schema } from "@/db";
import { eq, sql } from "drizzle-orm";

const WIKIDATA_API = "https://www.wikidata.org/w/api.php";
const WIKIPEDIA_REST = "https://en.wikipedia.org/api/rest_v1";
const COMMONS_FILEPATH = "https://commons.wikimedia.org/wiki/Special:FilePath";

const USER_AGENT =
  "TennisRankingsBot/0.1 (https://tennisrankings.example; contact: dev@tennisrankings.example)";
const HOST_INTERVAL_MS = 1100;
const lastHit = new Map<string, number>();

const PHOTO_RETRY_DAYS = 14; // Don't re-check an "attempted but failed" player for this long.
const PHOTO_REFRESH_DAYS = 730; // Re-download photos every ~2 years even if present —
                                // pro players' headshots rarely change inside that window,
                                // and refreshing too often burns Wikimedia bandwidth without
                                // visible benefit.

interface EnrichOptions {
  /** Skip the "ever top-100" filter and enrich everything with a wikidata_id. */
  allPlayers?: boolean;
  /** Re-download photos even if they're already cached. */
  force?: boolean;
}

interface EnrichResult {
  scanned: number;
  photosDownloaded: number;
  photoNotFound: number;
  backhandUpdated: number;
  failures: { slug: string; reason: string }[];
}

export async function enrichPlayers(opts: EnrichOptions = {}): Promise<EnrichResult> {
  const result: EnrichResult = {
    scanned: 0,
    photosDownloaded: 0,
    photoNotFound: 0,
    backhandUpdated: 0,
    failures: [],
  };

  // Eligibility: "ever in top 100" unless allPlayers is set. We no longer
  // filter on wikidata_id here — players without one go through a Wikidata
  // name-search inside the loop. That's the only way to enrich players
  // Tennis Abstract's player file doesn't carry a QID for (Darderi etc.).
  const candidates = await db.execute<{
    id: number;
    slug: string;
    full_name: string;
    country_code: string | null;
    wikidata_id: string | null;
    wikipedia_url: string | null;
    backhand: string | null;
    photo_fetched_at: string | null;
    photo_attempt_at: string | null;
  }>(sql`
    select
      p.id, p.slug, p.full_name, p.country_code, p.wikidata_id, p.wikipedia_url, p.backhand,
      p.photo_fetched_at::text as photo_fetched_at,
      p.photo_attempt_at::text as photo_attempt_at
    from players p
    where 1=1
      ${opts.allPlayers
        ? sql``
        : sql`and exists (
            select 1 from rankings_snapshots rs
            where rs.player_id = p.id and rs.is_race = false and rs.rank <= 100
          )`}
      ${opts.force
        ? sql``
        : sql`and (
            p.photo_fetched_at is null
            or p.photo_fetched_at < now() - interval '${sql.raw(String(PHOTO_REFRESH_DAYS))} days'
            or p.backhand is null
            or p.wikidata_id is null
          )
          and (
            p.photo_attempt_at is null
            or p.photo_attempt_at < now() - interval '${sql.raw(String(PHOTO_RETRY_DAYS))} days'
            or p.photo_fetched_at is null
          )`}
    order by p.id;
  `);
  const rows =
    (candidates as unknown as { rows: Array<Record<string, unknown>> }).rows ??
    (candidates as unknown as Array<Record<string, unknown>>);
  result.scanned = rows.length;
  console.log(`[enrich] ${result.scanned} eligible players`);

  for (const r of rows) {
    const id = Number(r.id);
    const slug = String(r.slug);
    let wikidataId = r.wikidata_id as string | null;
    const fullName = String(r.full_name);
    const countryCode = r.country_code as string | null;
    const existingBackhand = r.backhand as string | null;
    const updates: Record<string, unknown> = {};
    let needsAttemptStamp = false;

    try {
      // If Tennis Abstract didn't carry a wikidata_id for this player, try
      // to discover one by searching Wikidata by name. We verify candidates
      // are tennis players via P641 to avoid grabbing the wrong Luciano.
      if (!wikidataId) {
        const discovered = await searchWikidataForTennisPlayer(fullName, countryCode);
        if (discovered) {
          wikidataId = discovered;
          updates.wikidataId = discovered;
          console.log(`[enrich] ${slug}: discovered wikidata_id ${discovered} via search`);
        } else {
          // Found nothing — stamp the attempt and move on.
          updates.photoAttemptAt = new Date();
          updates.updatedAt = new Date();
          await db.update(schema.players).set(updates).where(eq(schema.players.id, id));
          result.photoNotFound++;
          continue;
        }
      }

      const wd = await fetchWikidataEntity(wikidataId);

      if (wd.imageFile) {
        const cleaned = wd.imageFile.replace(/^File:/i, "");
        const imageUrl = `${COMMONS_FILEPATH}/${encodeURIComponent(cleaned)}?width=400`;
        try {
          const { bytes, contentType } = await fetchImageBinary(imageUrl);
          updates.photoBytes = bytes;
          updates.photoContentType = contentType;
          updates.photoFetchedAt = new Date();
          updates.photoUrl = imageUrl; // keep the URL for diagnostics
          updates.photoAttribution = `Wikimedia Commons · ${cleaned}`;
          result.photosDownloaded++;
        } catch (err) {
          // The Wikimedia URL exists per Wikidata but the binary fetch failed.
          // Stamp the attempt to avoid retrying immediately.
          result.photoNotFound++;
          console.warn(`[enrich] ${slug}: image fetch failed — ${err instanceof Error ? err.message : err}`);
        }
      } else {
        result.photoNotFound++;
      }
      needsAttemptStamp = true;

      if (wd.enwikiTitle) {
        updates.wikipediaUrl =
          `https://en.wikipedia.org/wiki/${encodeURIComponent(wd.enwikiTitle.replace(/ /g, "_"))}`;
        if (!existingBackhand) {
          const bh = await fetchWikipediaBackhand(wd.enwikiTitle);
          if (bh) {
            updates.backhand = bh;
            result.backhandUpdated++;
          }
        }
      }
    } catch (err) {
      result.failures.push({ slug, reason: err instanceof Error ? err.message : String(err) });
      needsAttemptStamp = true;
    }

    if (needsAttemptStamp) updates.photoAttemptAt = new Date();
    if (Object.keys(updates).length > 0) {
      updates.updatedAt = new Date();
      await db.update(schema.players).set(updates).where(eq(schema.players.id, id));
    }
  }

  return result;
}

// ─── Wikidata ──────────────────────────────────────────────────────

interface WdEntityResult {
  imageFile: string | null;
  enwikiTitle: string | null;
}

/**
 * Searches Wikidata by a player's full name and returns the QID of the
 * first match that looks like a tennis player. Strategy:
 *   1. wbsearchentities returns up to 10 candidates with short descriptions.
 *   2. Prefer candidates whose description literally contains "tennis" —
 *      this catches 90% of cases in one cheap call.
 *   3. For any remaining candidates, fetch claims and check P641 (sport)
 *      = Q847 (tennis). Up to two verifies per player to keep cost bounded.
 * Returns null when no plausible match exists.
 */
async function searchWikidataForTennisPlayer(
  fullName: string,
  _countryCode: string | null,
): Promise<string | null> {
  const searchUrl = new URL(WIKIDATA_API);
  searchUrl.searchParams.set("action", "wbsearchentities");
  searchUrl.searchParams.set("search", fullName);
  searchUrl.searchParams.set("language", "en");
  searchUrl.searchParams.set("format", "json");
  searchUrl.searchParams.set("type", "item");
  searchUrl.searchParams.set("limit", "10");
  searchUrl.searchParams.set("origin", "*");
  const json = (await politeJson(searchUrl.toString())) as {
    search?: Array<{ id?: string; description?: string }>;
  };
  const hits = json.search ?? [];
  if (hits.length === 0) return null;

  // Fast path: any hit whose description mentions "tennis" is almost
  // certainly the right person.
  for (const h of hits) {
    const desc = (h.description ?? "").toLowerCase();
    if (h.id && desc.includes("tennis")) return h.id;
  }

  // Slow path: verify the top two hits by claim. Cap at two to keep request
  // count predictable — a name with no tennis-mentioning description usually
  // means we'd grab the wrong person anyway.
  for (let i = 0; i < Math.min(2, hits.length); i++) {
    const id = hits[i]?.id;
    if (!id) continue;
    const verifyUrl = new URL(WIKIDATA_API);
    verifyUrl.searchParams.set("action", "wbgetentities");
    verifyUrl.searchParams.set("ids", id);
    verifyUrl.searchParams.set("props", "claims");
    verifyUrl.searchParams.set("format", "json");
    verifyUrl.searchParams.set("origin", "*");
    const verifyJson = (await politeJson(verifyUrl.toString())) as {
      entities?: Record<string, {
        claims?: Record<string, Array<{ mainsnak?: { datavalue?: { value?: { id?: string } } } }>>;
      }>;
    };
    const entity = verifyJson.entities?.[id];
    // P641 = sport. Q847 = tennis.
    const sport = entity?.claims?.P641?.[0]?.mainsnak?.datavalue?.value?.id;
    if (sport === "Q847") return id;
  }

  return null;
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

// ─── Wikipedia ───────────────────────────────────────────────────

async function fetchWikipediaBackhand(title: string): Promise<string | null> {
  const url = `${WIKIPEDIA_REST}/page/html/${encodeURIComponent(title.replace(/ /g, "_"))}`;
  const html = await politeText(url);
  const playsRowMatch = html.match(/<th[^>]*>Plays<\/th>\s*<td[^>]*>([\s\S]{0,400}?)<\/td>/i);
  if (!playsRowMatch) return null;
  const cell = playsRowMatch[1] ?? "";
  if (/two[- ]handed\s+backhand/i.test(cell)) return "two-handed";
  if (/one[- ]handed\s+backhand/i.test(cell)) return "one-handed";
  return null;
}

// ─── Image binary fetch ─────────────────────────────────────────────

async function fetchImageBinary(url: string): Promise<{ bytes: Buffer; contentType: string }> {
  await throttle(url);
  const res = await fetch(url, {
    headers: { "User-Agent": USER_AGENT, Accept: "image/*" },
    redirect: "follow",
  });
  if (!res.ok) throw new Error(`${url} → ${res.status} ${res.statusText}`);
  const contentType = res.headers.get("content-type") || "image/jpeg";
  const arrayBuffer = await res.arrayBuffer();
  return { bytes: Buffer.from(arrayBuffer), contentType };
}

// ─── transport ───────────────────────────────────────────────────

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
  const allPlayers = args.includes("--all");
  const force = args.includes("--force");

  console.log(`[enrich] allPlayers=${allPlayers}  force=${force}`);
  const r = await enrichPlayers({ allPlayers, force });
  console.log(
    `[enrich] scanned=${r.scanned}  photos=${r.photosDownloaded}  noPhoto=${r.photoNotFound}  ` +
      `backhand=${r.backhandUpdated}  failures=${r.failures.length}`,
  );
  if (r.failures.length > 0 && r.failures.length <= 10) {
    for (const f of r.failures) console.log(`  ${f.slug}: ${f.reason}`);
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
