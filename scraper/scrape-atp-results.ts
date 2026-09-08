/**
 * Write ATP match results into player_recent_matches from atptour.com.
 *
 * Replaces TennisExplorer as the primary ATP match source. TE is retained as
 * a fallback: it covers lower-tier events (Challengers, ITF) that the ATP
 * results pages do not, and it is currently blocked on this network anyway.
 *
 * WHAT MAKES THIS BETTER THAN THE SOURCE IT REPLACES
 *
 *   requests   one page per TOURNAMENT (232 matches in 5.6s) rather than one
 *              per MATCH. The TE backfill of a single summer cost ~13,000.
 *   dates      real per-match dates, from the day accordions. Tennis Abstract
 *              stamps every match at an event with the tournament START date,
 *              which broke the dropping window and every cross-source dedupe.
 *   identity   ATP player ids from the profile href, so players are matched by
 *              key rather than by name.
 *   rounds     explicit labels, including main draw vs qualifying.
 *
 * ENUMERATION
 *
 * The results route is id-driven; the slug is cosmetic (verified:
 * /scores/current/zzz-wrong/560/results returns the same 232 matches, while a
 * wrong id returns none). So only tournament ids are needed. They come from:
 *
 *   --tournament <id>   explicit, repeatable
 *   --current           the in-progress event(s) from /en/scores/current
 *   --from-db <year>    ids we already hold, derived from Tennis Abstract's
 *                       external_tourney_id ("2026-0416" -> 416)
 *
 * Default is --current, which is what a daily run needs.
 *
 *   pnpm scraper:atp-results
 *   pnpm scraper:atp-results -- --tournament 560 --year 2026
 *   pnpm scraper:atp-results -- --from-db 2026 --limit 5
 *   pnpm scraper:atp-results -- --current --dry
 */
import { chromium } from "@playwright/test";
import { and, eq, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { fetchAtpResults, type AtpResultMatch } from "./sources/atp-results";
import { namesMatch } from "./sources/live-tennis";
import { runEntrypoint } from "./exit";
import { stableMatchNumber } from "./stable-match-number";

/** Marks rows written by this module. */
export const ATP_SITE_SOURCE = "atp_site";

interface Target {
  tournamentId: string;
  year: number;
  /** Cosmetic, but keeps the fetched URL readable in logs. */
  slug: string;
}

interface RunSummary {
  tournaments: number;
  matchesParsed: number;
  rowsWritten: number;
  playersMatchedBySlug: number;
  playersMatchedByName: number;
  playersUnresolved: number;
  unresolvedNames: Set<string>;
  skippedNoDate: number;
  failures: string[];
}

/** Discover the in-progress tournament(s) from the ATP scores landing page. */
async function discoverCurrent(): Promise<Target[]> {
  const browser = await chromium.launch({ headless: true });
  try {
    const ctx = await browser.newContext({
      userAgent:
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
        "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
      viewport: { width: 1400, height: 1000 },
    });
    const page = await ctx.newPage();
    await page.goto("https://www.atptour.com/en/scores/current", {
      waitUntil: "domcontentloaded",
      timeout: 60_000,
    });
    await page.waitForTimeout(4000);
    const hrefs: string[] = await page
      .locator("a[href]")
      .evaluateAll((els) =>
        els.map((e) => e.getAttribute("href") ?? "").filter((h) => h.length > 0),
      );
    const seen = new Map<string, Target>();
    const year = new Date().getUTCFullYear();
    for (const h of hrefs) {
      const m = h.match(/\/(?:scores\/current|tournaments)\/([^/]+)\/(\d+)\//);
      if (m) seen.set(m[2]!, { tournamentId: m[2]!, slug: m[1]!, year });
    }
    return [...seen.values()];
  } finally {
    await browser.close();
  }
}

/**
 * Tournament ids we already hold, from Tennis Abstract's id format
 * ("2026-0416" -> 416). Zero padding is stripped; ATP's routes want the
 * unpadded number.
 */
async function idsFromDb(year: number): Promise<Target[]> {
  const res = await db.execute<Record<string, unknown>>(sql`
    select distinct prm.external_tourney_id, prm.tournament_name
    from player_recent_matches prm
    join players p on p.id = prm.player_id
    where p.tour = 'atp'
      and prm.source = 'tennis_abstract'
      and prm.external_tourney_id like ${`${year}-%`}
    order by prm.external_tourney_id
  `);
  const rows = ((res as unknown as { rows: unknown[] }).rows ?? res) as Array<
    Record<string, unknown>
  >;
  const out: Target[] = [];
  for (const r of rows) {
    const raw = String(r.external_tourney_id);
    const m = raw.match(/^(\d{4})-0*(\d+)$/);
    if (!m) continue;
    out.push({
      tournamentId: m[2]!,
      year: Number(m[1]),
      slug: String(r.tournament_name ?? "event")
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, "") || "event",
    });
  }
  return out;
}

interface PlayerLookup {
  bySlug: Map<string, number>;
  all: Array<{ id: number; fullName: string }>;
}

async function loadAtpPlayers(): Promise<PlayerLookup> {
  const rows = await db
    .select({
      id: schema.players.id,
      slug: schema.players.slug,
      fullName: schema.players.fullName,
    })
    .from(schema.players)
    .where(eq(schema.players.tour, "atp"));
  const bySlug = new Map<string, number>();
  for (const r of rows) bySlug.set(r.slug, r.id);
  return { bySlug, all: rows.map((r) => ({ id: r.id, fullName: r.fullName })) };
}

/**
 * Resolve one ATP result player to a players.id.
 *
 * NOTE ON IDENTITY: the ATP player id (e.g. "z355") is the right key, but
 * `players` has no column to store it, and adding one needs a `db:push` that
 * would also DROP the auth tables removed from the schema - a destructive
 * migration that should be run deliberately, not as a side effect of this
 * scraper. So for now resolution goes slug-first, then a strict name match.
 *
 * `namesMatch` is called with `{ fuzzy: false }`: this WRITES data, and the
 * fuzzy branch pairs genuinely different players ("Ekaterina Maklakova" with
 * "Ekaterina Makarova"). Attaching a match to the wrong player is worse than
 * reporting it unresolved.
 */
function resolvePlayer(
  lookup: PlayerLookup,
  atpSlug: string,
  fullName: string,
  summary: RunSummary,
): number | null {
  const bySlug = lookup.bySlug.get(atpSlug);
  if (bySlug != null) {
    summary.playersMatchedBySlug++;
    return bySlug;
  }
  const hits = lookup.all.filter((p) => namesMatch(p.fullName, fullName, { fuzzy: false }));
  if (hits.length === 1) {
    summary.playersMatchedByName++;
    return hits[0]!.id;
  }
  summary.playersUnresolved++;
  summary.unresolvedNames.add(fullName);
  return null;
}

/** Stable per-match number from round + both ATP ids. See stable-match-number.ts. */
function matchNumber(m: AtpResultMatch): number {
  return stableMatchNumber(
    m.round,
    m.players.map((p) => p.atpId),
  );
}

/**
 * ATP tier letter for category inference, matching Tennis Abstract's codes.
 *
 * Qualifying rows carry the SAME tier as the main draw. Marking them "Q"
 * instead — as this did originally — threw the tier away, and
 * `inferCategory` has no "Q" branch, so a qualifying loss at a Slam fell
 * through to name matching and was scored on the 250 table. The round
 * (Q1/Q2/Q3) is what selects the qualifying column of the points table; the
 * level still has to say which event it was.
 */
function levelLetter(m: AtpResultMatch, drawSize: number): string | null {
  void m;
  if (drawSize >= 96) return "G"; // 128-draw main draws are Slams
  return null; // let name-based inference decide; Masters/500/250 differ by event
}

async function ingestTournament(
  t: Target,
  lookup: PlayerLookup,
  summary: RunSummary,
  dry: boolean,
): Promise<void> {
  let matches: AtpResultMatch[];
  try {
    matches = await fetchAtpResults({ slug: t.slug, tournamentId: t.tournamentId, year: t.year });
  } catch (err) {
    const msg = err instanceof Error ? err.message.split("\n")[0]! : String(err);
    summary.failures.push(`${t.year}-${t.tournamentId}: ${msg}`);
    console.warn(`[atp-results] ${t.year}-${t.tournamentId} FAILED — ${msg}`);
    return;
  }
  summary.tournaments++;
  summary.matchesParsed += matches.length;

  const mainDrawSize = matches.filter((m) => !m.isQualifying && m.round === "R128").length * 2;
  const rows: Array<typeof schema.playerRecentMatches.$inferInsert> = [];

  for (const m of matches) {
    if (!m.playedOn) {
      summary.skippedNoDate++;
      continue;
    }
    const externalMatchNum = matchNumber(m);
    for (let side = 0; side < 2; side++) {
      const me = m.players[side]!;
      const them = m.players[1 - side]!;
      const playerId = resolvePlayer(lookup, me.atpSlug, me.fullName, summary);
      if (playerId == null) continue;
      rows.push({
        playerId,
        source: ATP_SITE_SOURCE,
        externalTourneyId: `${t.year}-${t.tournamentId}`,
        externalMatchNum,
        playedOn: m.playedOn,
        tournamentName: t.slug.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()),
        tournamentLevel: levelLetter(m, mainDrawSize),
        surface: null,
        round: m.round,
        opponentName: them.fullName,
        opponentCountry: them.countryCode,
        won: me.won,
        score: m.scoreString || null,
        matchMinutes: null,
      });
    }
  }

  console.log(
    `[atp-results] ${t.year}-${String(t.tournamentId).padEnd(6)} ${matches.length} matches -> ${rows.length} rows` +
      (dry ? "  (dry run, nothing written)" : ""),
  );
  if (dry || rows.length === 0) return;

  const CHUNK = 300;
  for (let i = 0; i < rows.length; i += CHUNK) {
    await db
      .insert(schema.playerRecentMatches)
      .values(rows.slice(i, i + CHUNK))
      .onConflictDoUpdate({
        target: [
          schema.playerRecentMatches.playerId,
          schema.playerRecentMatches.source,
          schema.playerRecentMatches.externalTourneyId,
          schema.playerRecentMatches.externalMatchNum,
        ],
        set: {
          playedOn: sql`excluded.played_on`,
          round: sql`excluded.round`,
          won: sql`excluded.won`,
          score: sql`excluded.score`,
          tournamentLevel: sql`excluded.tournament_level`,
          opponentCountry: sql`excluded.opponent_country`,
        },
      });
    summary.rowsWritten += rows.slice(i, i + CHUNK).length;
  }
}

async function main() {
  const args = process.argv.slice(2);
  const dry = args.includes("--dry");
  const yearIdx = args.indexOf("--year");
  const year = yearIdx >= 0 && args[yearIdx + 1] ? Number(args[yearIdx + 1]) : new Date().getUTCFullYear();
  const limitIdx = args.indexOf("--limit");
  const limit = limitIdx >= 0 && args[limitIdx + 1] ? Number(args[limitIdx + 1]) : Infinity;

  let targets: Target[] = [];
  const explicit = args.reduce<string[]>((acc, a, i) => {
    if (a === "--tournament" && args[i + 1]) acc.push(args[i + 1]!);
    return acc;
  }, []);
  const fromDbIdx = args.indexOf("--from-db");

  if (explicit.length > 0) {
    targets = explicit.map((id) => ({ tournamentId: id, year, slug: "event" }));
  } else if (fromDbIdx >= 0) {
    const y = args[fromDbIdx + 1] ? Number(args[fromDbIdx + 1]) : year;
    targets = await idsFromDb(y);
    console.log(`[atp-results] ${targets.length} tournament id(s) derived from stored Tennis Abstract ids for ${y}`);
  } else {
    targets = await discoverCurrent();
    console.log(`[atp-results] ${targets.length} in-progress tournament(s) discovered`);
  }

  if (targets.length === 0) {
    console.log("[atp-results] nothing to do");
    return;
  }
  targets = targets.slice(0, limit);

  const lookup = await loadAtpPlayers();
  console.log(`[atp-results] ${lookup.all.length} ATP players available for matching`);

  const summary: RunSummary = {
    tournaments: 0,
    matchesParsed: 0,
    rowsWritten: 0,
    playersMatchedBySlug: 0,
    playersMatchedByName: 0,
    playersUnresolved: 0,
    unresolvedNames: new Set(),
    skippedNoDate: 0,
    failures: [],
  };

  for (const t of targets) {
    await ingestTournament(t, lookup, summary, dry);
  }

  console.log(
    `\n[atp-results] tournaments=${summary.tournaments} matches=${summary.matchesParsed} ` +
      `rows=${summary.rowsWritten} bySlug=${summary.playersMatchedBySlug} ` +
      `byName=${summary.playersMatchedByName} unresolved=${summary.playersUnresolved} ` +
      `noDate=${summary.skippedNoDate}`,
  );
  if (summary.unresolvedNames.size > 0) {
    const names = [...summary.unresolvedNames].slice(0, 12);
    console.log(`[atp-results] unresolved (first ${names.length}): ${names.join(", ")}`);
  }
  for (const f of summary.failures) console.log(`[atp-results] failure: ${f}`);

  // A tournament that could not be fetched at all is a real failure; an
  // unresolved player is expected (qualifiers outside our top-800).
  if (summary.failures.length > 0) process.exitCode = 1;
}

runEntrypoint(main());
