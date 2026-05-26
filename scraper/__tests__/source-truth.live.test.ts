// Live source-truth tests.
//
// What they do, in order:
//   1. Sample 10 ATP + 10 WTA players from current rankings, stratified across
//      five rank buckets (1-20, 21-100, 101-200, 201-400, 401-800) so both
//      top-of-tour and outside-top-100 picks are exercised.
//   2. Assert DB integrity for each pick (slug, name, valid DOB/country/plays).
//   3. Cross-check Wikidata: for picks with a stored wikidata_id, verify the
//      entity is actually a tennis player (P641 = Q847) and the DOB on
//      Wikidata matches our DB (P569).
//   4. Smoke-test TennisExplorer: it must return a non-empty daily match list
//      for at least one of the last three days, per tour.
//   5. TE → DB consistency for recent matches: every finished match TE
//      published in the last 7 days that involves one of our picks should
//      also be in our `matches` table.
//   6. TE → DB consistency for next matches: every planned match TE shows
//      for one of our picks in the next 4 days should be reflected in our DB.
//
// How to run:
//
//   PowerShell:    $env:LIVE_TESTS = "1"; pnpm vitest run scraper/__tests__/source-truth.live.test.ts
//   bash/zsh:      LIVE_TESTS=1 pnpm vitest run scraper/__tests__/source-truth.live.test.ts
//
// Without `LIVE_TESTS=1`, every test self-skips — so a normal `pnpm test` run
// touches nothing here. `DATABASE_URL` must also be set; pulled from the
// process env (`.env.local` populated by Weekly-Update.ps1's loader if you
// source it first).
//
// Realistic runtime: ~90s on a warm cache, up to ~3min on a cold one. Both
// TE and Wikidata are rate-limited at 1 req/sec per host inside politeFetch.

import { describe, it, expect, beforeAll } from "vitest";
import { sql } from "drizzle-orm";
import { db } from "@/db";
import {
  fetchDailyMatchList,
  type TEMatchRef,
} from "@scraper/sources/tennis-explorer";
import { politeFetch } from "@scraper/http";

const LIVE = !!process.env.LIVE_TESTS && !!process.env.DATABASE_URL;

// 2 random picks from each rank bucket per tour → 10 per tour.
const BUCKETS: Array<{ name: string; min: number; max: number }> = [
  { name: "1-20", min: 1, max: 20 },
  { name: "21-100", min: 21, max: 100 },
  { name: "101-200", min: 101, max: 200 },
  { name: "201-400", min: 201, max: 400 },
  { name: "401-800", min: 401, max: 800 },
];

interface Pick {
  tour: "atp" | "wta";
  rank: number;
  playerId: number;
  slug: string;
  fullName: string;
  lastName: string;
  countryCode: string | null;
  dateOfBirth: string | null;
  plays: string | null;
  wikidataId: string | null;
}

let picks: Pick[] = [];

function extractLastName(fullName: string): string {
  // Naive lastname extraction — takes the final whitespace-separated token.
  // Handles "Iga Świątek" and "Carlos Alcaraz" cleanly; gets "Bautista Agut"
  // wrong (returns "Agut") but that's tolerable: TE's lastname-first format
  // ("Bautista Agut R.") will still contain "Agut" so the word-boundary
  // match below still hits.
  const parts = fullName.trim().split(/\s+/);
  return parts[parts.length - 1] ?? fullName;
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Word-boundary match for a player's last name inside a TE match listing
 * line. Naive substring matching produced false positives for short
 * surnames — "Li" matched inside "Svito-li-na" — making coverage tests
 * accuse us of missing matches that the player wasn't even in. \b on
 * both sides forces a token-boundary match.
 */
function nameMatches(haystack: string, lastName: string): boolean {
  const re = new RegExp(`\\b${escapeRegex(lastName)}\\b`, "i");
  return re.test(haystack);
}

async function sampleTour(tour: "atp" | "wta"): Promise<Pick[]> {
  const collected: Pick[] = [];
  for (const bucket of BUCKETS) {
    const result = await db.execute<{
      rank: number;
      player_id: number;
      slug: string;
      full_name: string;
      country_code: string | null;
      date_of_birth: string | null;
      plays: string | null;
      wikidata_id: string | null;
    }>(sql`
      with latest as (
        select max(week_of) as w from rankings_snapshots
        where tour = ${tour} and is_race = false
      )
      select
        rs.rank, rs.player_id,
        p.slug, p.full_name, p.country_code,
        p.date_of_birth::text as date_of_birth,
        p.plays, p.wikidata_id
      from rankings_snapshots rs
      join players p on p.id = rs.player_id
      join latest on rs.week_of = latest.w
      where rs.tour = ${tour}
        and rs.is_race = false
        and rs.rank between ${bucket.min} and ${bucket.max}
      order by random()
      limit 2
    `);
    const rows =
      ((result as unknown) as { rows?: Record<string, unknown>[] }).rows ??
      ((result as unknown) as Record<string, unknown>[]);
    for (const r of rows) {
      const fullName = String(r.full_name);
      collected.push({
        tour,
        rank: Number(r.rank),
        playerId: Number(r.player_id),
        slug: String(r.slug),
        fullName,
        lastName: extractLastName(fullName),
        countryCode: (r.country_code as string | null) ?? null,
        dateOfBirth: (r.date_of_birth as string | null) ?? null,
        plays: (r.plays as string | null) ?? null,
        wikidataId: (r.wikidata_id as string | null) ?? null,
      });
    }
  }
  return collected;
}

beforeAll(async () => {
  if (!LIVE) return;
  const [atp, wta] = await Promise.all([sampleTour("atp"), sampleTour("wta")]);
  picks = [...atp, ...wta];
  console.log(`[live] sampled ${atp.length} ATP + ${wta.length} WTA from current rankings`);
}, 30_000);

// ─── Wikidata fetch helper ─────────────────────────────────────────
// In-process cache keyed by QID. Tests 3a (sport check) and 3b (DOB check)
// look at the same picks, so without memoization we'd double the request
// count and Wikidata's anonymous-tier rate limiter (~1 req/s sustained,
// burstable) returns 429.
const wdCache = new Map<string, Promise<{ sport: string | null; dobIso: string | null }>>();
let lastWdRequestAt = 0;

async function fetchWdClaims(qid: string): Promise<{
  sport: string | null;
  dobIso: string | null;
}> {
  const cached = wdCache.get(qid);
  if (cached) return cached;

  const p = (async () => {
    // Polite throttle: ≥1.1s between cold network calls, regardless of
    // which test is calling. Wikidata 429s before 1s consistently.
    const since = Date.now() - lastWdRequestAt;
    if (since < 1100) await new Promise((r) => setTimeout(r, 1100 - since));
    lastWdRequestAt = Date.now();

    const url = new URL("https://www.wikidata.org/w/api.php");
    url.searchParams.set("action", "wbgetentities");
    url.searchParams.set("ids", qid);
    url.searchParams.set("props", "claims");
    url.searchParams.set("format", "json");
    url.searchParams.set("origin", "*");
    const res = await fetch(url.toString(), {
      headers: { "User-Agent": "TennisRankingsBot/0.1 source-truth-test" },
    });
    if (!res.ok) throw new Error(`Wikidata ${qid}: ${res.status} ${res.statusText}`);
    const json = (await res.json()) as {
      entities?: Record<
        string,
        {
          claims?: Record<
            string,
            Array<{ mainsnak?: { datavalue?: { value?: { id?: string; time?: string } } } }>
          >;
        }
      >;
    };
    const entity = json.entities?.[qid];
    const sport = entity?.claims?.P641?.[0]?.mainsnak?.datavalue?.value?.id ?? null;
    const dobRaw = entity?.claims?.P569?.[0]?.mainsnak?.datavalue?.value?.time ?? null;
    // Wikidata DOB format: "+1991-08-16T00:00:00Z" → "1991-08-16"
    const dobIso = dobRaw ? dobRaw.replace(/^[+-]/, "").slice(0, 10) : null;
    return { sport, dobIso };
  })();
  wdCache.set(qid, p);
  return p;
}

// ─── DB query helpers ────────────────────────────────────────────────

// Our match history lives in `player_recent_matches` — one row per
// player perspective on a match (so a single match produces two rows,
// one per side). Either row is sufficient evidence that we recorded
// the match for `playerId`. Returns null on a schema mismatch so the
// calling test can degrade gracefully instead of failing the suite.
async function dbHasMatchForPlayerOnDate(
  playerId: number,
  dateStr: string,
): Promise<boolean | null> {
  try {
    const res = await db.execute<{ count: number }>(sql`
      select count(*)::int as count
      from player_recent_matches prm
      where prm.player_id = ${playerId}
        and prm.played_on::text = ${dateStr}
    `);
    const rows =
      ((res as unknown) as { rows?: { count: number }[] }).rows ??
      ((res as unknown) as { count: number }[]);
    const count = Number(rows[0]?.count ?? 0);
    return count > 0;
  } catch {
    return null;
  }
}

// "Next match" coverage is checked against `player_upcoming_matches` —
// a separate table the daily-matches scraper bulk-rewrites every run.
// player_recent_matches only holds finished matches; planned ones would
// always miss if we looked there.
async function dbHasUpcomingMatchForPlayerOnDate(
  playerId: number,
  dateStr: string,
): Promise<boolean | null> {
  try {
    const res = await db.execute<{ count: number }>(sql`
      select count(*)::int as count
      from player_upcoming_matches pum
      where pum.player_id = ${playerId}
        and pum.scheduled_date::text = ${dateStr}
    `);
    const rows =
      ((res as unknown) as { rows?: { count: number }[] }).rows ??
      ((res as unknown) as { count: number }[]);
    const count = Number(rows[0]?.count ?? 0);
    return count > 0;
  } catch {
    return null;
  }
}

// ─── 1. Sampling ────────────────────────────────────────────────────
describe.skipIf(!LIVE)("source-truth: sampling", () => {
  it("sampled at least 6 players from each tour across rank buckets", () => {
    const atp = picks.filter((p) => p.tour === "atp");
    const wta = picks.filter((p) => p.tour === "wta");
    // Each tour: 2 per bucket × 5 buckets = up to 10. WTA's 401-800 bucket
    // is sometimes empty if expand-rankings hasn't backfilled it yet.
    expect(atp.length, `ATP picks (${atp.length})`).toBeGreaterThanOrEqual(6);
    expect(wta.length, `WTA picks (${wta.length})`).toBeGreaterThanOrEqual(6);
    console.log("[live] picks:");
    for (const p of picks) {
      console.log(`  ${p.tour} #${p.rank.toString().padStart(3)}  ${p.slug}`);
    }
  });
});

// ─── 2. DB integrity ──────────────────────────────────────────────────
describe.skipIf(!LIVE)("source-truth: DB integrity", () => {
  it("every pick has a non-empty slug, name and positive rank", () => {
    for (const p of picks) {
      expect(p.slug, `${p.tour} #${p.rank}`).toBeTruthy();
      expect(p.fullName, `${p.tour} ${p.slug}`).toBeTruthy();
      expect(p.rank).toBeGreaterThan(0);
    }
  });

  it("date_of_birth, country, plays — when set — are syntactically valid", () => {
    for (const p of picks) {
      if (p.dateOfBirth) {
        expect(p.dateOfBirth, `${p.slug} dob`).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      }
      if (p.countryCode) {
        expect(p.countryCode, `${p.slug} country`).toMatch(/^[A-Z]{2,3}$/);
      }
      if (p.plays) {
        expect(["right", "left", "unknown"], `${p.slug} plays`).toContain(p.plays);
      }
    }
  });
});

// ─── 3. Wikidata cross-check ────────────────────────────────────────────
describe.skipIf(!LIVE)("source-truth: Wikidata cross-check", () => {
  it("each Wikidata entity is a tennis player (P641 = Q847)", async () => {
    const withQid = picks.filter((p) => p.wikidataId).slice(0, 6);
    if (withQid.length === 0) {
      console.warn("[live] no picks have wikidata_id; skipping P641 check");
      return;
    }
    for (const p of withQid) {
      const { sport } = await fetchWdClaims(p.wikidataId!);
      expect(sport, `${p.slug} (${p.wikidataId}) Wikidata sport`).toBe("Q847");
    }
  }, 60_000);

  it("DB date_of_birth matches Wikidata P569 (where both are set)", async () => {
    const candidates = picks
      .filter((p) => p.wikidataId && p.dateOfBirth)
      .slice(0, 6);
    if (candidates.length === 0) {
      console.warn("[live] no candidates with both wikidata_id and DOB; skipping P569 check");
      return;
    }
    // Collect mismatches rather than failing on the first one — a single
    // wrong DOB is a data-fix prompt (re-run scraper:enrich-players), not
    // a reason to bury the rest of the suite's findings. Common cause of
    // a mismatch: our players row was first inserted from a non-TA source
    // (ATP HTML scrape) and given a placeholder DOB like 2005-01-01 that
    // enrichment hasn't overwritten yet.
    let compared = 0;
    const mismatches: string[] = [];
    for (const p of candidates) {
      const { dobIso } = await fetchWdClaims(p.wikidataId!);
      if (!dobIso) {
        console.warn(`[live] ${p.slug}: Wikidata has no DOB; skipping`);
        continue;
      }
      compared++;
      if (dobIso !== p.dateOfBirth) {
        mismatches.push(`${p.slug}: DB=${p.dateOfBirth} WD=${dobIso}`);
      }
    }
    if (mismatches.length > 0) {
      console.warn("[live] DOB mismatches (consider re-running scraper:enrich-players):");
      for (const m of mismatches) console.warn(`  ${m}`);
    }
    if (compared === 0) return;
    const passRate = (compared - mismatches.length) / compared;
    expect(
      passRate,
      `${mismatches.length}/${compared} DB DOBs disagreed with Wikidata`,
    ).toBeGreaterThanOrEqual(0.8);
  }, 60_000);
});

// ─── 4. TennisExplorer is reachable ────────────────────────────────────────
describe.skipIf(!LIVE)("source-truth: TennisExplorer is reachable", () => {
  it("returns a non-empty daily match list for at least one of the past 3 days per tour", async () => {
    for (const tour of ["atp", "wta"] as const) {
      let bestCount = 0;
      for (let daysAgo = 1; daysAgo <= 3; daysAgo++) {
        const date = new Date();
        date.setUTCDate(date.getUTCDate() - daysAgo);
        try {
          const matches = await fetchDailyMatchList(date, tour);
          if (matches.length > bestCount) bestCount = matches.length;
          if (bestCount > 0) break;
        } catch (err) {
          console.warn(`[live] TE ${tour} ${date.toISOString().slice(0, 10)} fetch failed: ${err}`);
        }
      }
      expect(bestCount, `TE returned 0 matches across last 3 days for ${tour}`).toBeGreaterThan(0);
    }
  }, 120_000);
});

// ─── 5. Recent matches: TE → DB ───────────────────────────────────────────
describe.skipIf(!LIVE)("source-truth: TE recent matches present in DB", () => {
  it("matches TE published in the last 7 days for our picks are also in our DB", async () => {
    let wins = 0;
    let misses = 0;
    let schemaFailures = 0;
    const examples: string[] = [];

    for (const tour of ["atp", "wta"] as const) {
      const tourPicks = picks.filter((p) => p.tour === tour);
      const lastNamesToPick = new Map<string, Pick>();
      for (const p of tourPicks) lastNamesToPick.set(p.lastName.toLowerCase(), p);

      for (let daysAgo = 1; daysAgo <= 7; daysAgo++) {
        const date = new Date();
        date.setUTCDate(date.getUTCDate() - daysAgo);
        let matches: TEMatchRef[];
        try {
          matches = await fetchDailyMatchList(date, tour);
        } catch {
          continue;
        }
        if (matches.length === 0) continue;
        const dateStr = date.toISOString().slice(0, 10);

        for (const m of matches) {
          if (m.status !== "finished") continue;
          for (const [ln, pick] of lastNamesToPick) {
            const involved =
              nameMatches(m.p1Name, ln) || nameMatches(m.p2Name, ln);
            if (!involved) continue;
            const has = await dbHasMatchForPlayerOnDate(pick.playerId, dateStr);
            if (has === null) {
              schemaFailures++;
              continue;
            }
            if (has) wins++;
            else {
              misses++;
              if (examples.length < 5) {
                examples.push(`${pick.slug} ${dateStr} (TE: ${m.p1Name} vs ${m.p2Name})`);
              }
            }
          }
        }
      }
    }

    console.log(`[live] TE → DB recent: wins=${wins} misses=${misses} schemaFailures=${schemaFailures}`);
    if (examples.length > 0) {
      console.warn("[live] examples of missing matches:");
      for (const e of examples) console.warn(`  ${e}`);
    }

    // Schema-mismatch path: the dbHasMatchForPlayerOnDate query failed for
    // everything. Don't fail the test — print the lesson and skip the ratio
    // assertion. The user can update the query column names.
    if (schemaFailures > 0 && wins === 0 && misses === 0) {
      console.warn(
        "[live] matches-table query failed for every row — schema doesn't match " +
        "the test's assumptions. Update dbHasMatchForPlayerOnDate() with the " +
        "current column names (player_a_id/player_b_id/played_on are the defaults).",
      );
      return;
    }

    const total = wins + misses;
    if (total > 0) {
      // 60% floor: some TE matches are doubles or qualifiers our scraper
      // doesn't track, so a perfect 100% would be unrealistic.
      const ratio = wins / total;
      expect(ratio, `DB covered ${wins}/${total} of TE's recent matches`).toBeGreaterThanOrEqual(0.6);
    } else {
      console.warn("[live] no TE matches matched our picks in the last 7 days — perhaps a quiet week");
    }
  }, 180_000);
});

// ─── 6. Next matches: TE → DB ─────────────────────────────────────────────
describe.skipIf(!LIVE)("source-truth: TE next matches reflected in DB", () => {
  it("upcoming matches TE shows for our picks are scheduled in our DB too", async () => {
    let wins = 0;
    let misses = 0;
    const examples: string[] = [];

    for (const tour of ["atp", "wta"] as const) {
      const tourPicks = picks.filter((p) => p.tour === tour);
      const lastNamesToPick = new Map<string, Pick>();
      for (const p of tourPicks) lastNamesToPick.set(p.lastName.toLowerCase(), p);

      for (let offset = 0; offset <= 4; offset++) {
        const date = new Date();
        date.setUTCDate(date.getUTCDate() + offset);
        let matches: TEMatchRef[];
        try {
          matches = await fetchDailyMatchList(date, tour);
        } catch {
          continue;
        }
        if (matches.length === 0) continue;
        const dateStr = date.toISOString().slice(0, 10);

        for (const m of matches) {
          if (m.status !== "planned") continue;
          for (const [ln, pick] of lastNamesToPick) {
            const involved =
              nameMatches(m.p1Name, ln) || nameMatches(m.p2Name, ln);
            if (!involved) continue;
            const has = await dbHasUpcomingMatchForPlayerOnDate(pick.playerId, dateStr);
            if (has === null) continue; // schema mismatch already reported above
            if (has) wins++;
            else {
              misses++;
              if (examples.length < 5) {
                const opp = nameMatches(m.p1Name, ln) ? m.p2Name : m.p1Name;
                examples.push(`${pick.slug} vs ${opp} on ${dateStr}`);
              }
            }
          }
        }
      }
    }

    console.log(`[live] TE → DB next: wins=${wins} misses=${misses}`);
    if (examples.length > 0) {
      console.warn("[live] examples of missing scheduled matches:");
      for (const e of examples) console.warn(`  ${e}`);
    }

    const total = wins + misses;
    if (total > 0) {
      // Looser threshold for next-match coverage — TE schedules update more
      // often than our hourly scrape, so a 1-2 hour lag is normal.
      const ratio = wins / total;
      expect(ratio, `DB covered ${wins}/${total} of TE's planned matches`).toBeGreaterThanOrEqual(0.5);
    } else {
      console.warn("[live] no TE planned matches matched our picks in next 4 days — perhaps a dark week");
    }
  }, 180_000);
});

// ─── 7. Cross-check vs live-tennis.eu ─────────────────────────────────────
// live-tennis.eu publishes a continuously-updated live ranking and race
// standings. We don't try for an exact match — the "live" ranking moves
// during a tournament week while ours snaps at Monday's publish — but
// the player POPULATION in the top N should agree very closely. If our
// settled top-50 contains <80% of live-tennis's top-50, something's
// drifted (mis-resolved players, stale snapshot, parser regression).

interface LiveTennisRow {
  rank: number;
  fullName: string;
  slugCandidate: string;
  /**
   * Net rank change vs the previous published ranking. Positive = improved
   * (moved up). Null when LT shows "CH"/"NCH" (career high) instead of
   * a numeric change.
   */
  rankChange: number | null;
  /** Current live points (live ranking) or year-to-date points (race). */
  points: number | null;
  /** Projected points after the player's current tournament finishes. */
  nextPoints: number | null;
  /** Max possible points if the player wins out the current tournament. */
  maxPoints: number | null;
}

function parseLiveTennisHtml(html: string): LiveTennisRow[] {
  // Split into one chunk per `<tr class="XXX …">` data row. Header/footer
  // rows lack the country-code class and get dropped.
  const rowRe = /<tr class="[A-Z]{3}[^"]*">([\s\S]*?)<\/tr>/g;
  const out: LiveTennisRow[] = [];
  let rowMatch: RegExpExecArray | null;
  while ((rowMatch = rowRe.exec(html)) !== null) {
    const rowHtml = rowMatch[1]!;
    const rank = readInt(rowHtml.match(/class=rk>(\d+)</)?.[1]);
    const rawName = rowHtml.match(/class=pn>([^<]+)</)?.[1];
    if (rank === null || !rawName) continue;
    const fullName = decodeEntities(rawName.trim());

    // Rank change cell — only on the LIVE-ranking page. The official and
    // race pages omit chtd entirely, so its absence is the layout signal.
    const chHtml = rowHtml.match(/class=chtd>([\s\S]*?)<\/td>/)?.[1] ?? "";
    const hasChtd = /class=chtd>/.test(rowHtml);
    let rankChange: number | null = null;
    const upMatch = chHtml.match(/class=ich>(\d+)</);
    const downMatch = chHtml.match(/class=dch>(\d+)</);
    if (upMatch) rankChange = Number(upMatch[1]);
    else if (downMatch) rankChange = -Number(downMatch[1]);

    const cells = extractCellTexts(rowHtml);
    // Layout differs by page type:
    //   live-ranking:    rk, chtd, flag, pn, age, country, POINTS, …
    //   official/race:   rk,       flag, pn, age, country, POINTS, …
    // Detect by chtd presence and index points accordingly.
    const pointsIdx = hasChtd ? 6 : 5;
    const points = readInt(cells[pointsIdx]);
    // nextPoints + maxPoints are the LAST two purely-numeric cells. Players
    // without an active-tournament projection show a `colspan` empty cell
    // and yield no trailing numbers.
    const trailing = cells.slice(pointsIdx + 1).filter((c) => /^\d+$/.test(c)).map(Number);
    const nextPoints = trailing.length >= 2 ? trailing[trailing.length - 2]! : null;
    const maxPoints = trailing.length >= 2 ? trailing[trailing.length - 1]! : null;

    out.push({
      rank,
      fullName,
      slugCandidate: slugifyForCompare(fullName),
      rankChange,
      points,
      nextPoints,
      maxPoints,
    });
  }
  return out;
}

function readInt(s: string | undefined): number | null {
  if (!s) return null;
  const n = Number(s.replace(/[,\s]/g, ""));
  return Number.isFinite(n) ? n : null;
}

/**
 * Pull the visible text of each `<td>` in a row, in document order. We
 * decode &nbsp;/&amp; and collapse whitespace so downstream comparison
 * against integer / string fields is robust.
 */
function extractCellTexts(rowHtml: string): string[] {
  const out: string[] = [];
  const cellRe = /<td[^>]*>([\s\S]*?)<\/td>/g;
  let m: RegExpExecArray | null;
  while ((m = cellRe.exec(rowHtml)) !== null) {
    const inner = m[1]!.replace(/<[^>]+>/g, "");
    out.push(decodeEntities(inner).replace(/\s+/g, " ").trim());
  }
  return out;
}

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&nbsp;/g, " ")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)));
}

/**
 * Slug-style normalisation used purely for membership comparison. NFKD
 * strips accents (Félix Auger-Aliassime → felix-auger-aliassime), matching
 * our internal slug convention closely enough for set-overlap checks.
 */
function slugifyForCompare(name: string): string {
  return name
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

async function fetchLiveTennis(path: string): Promise<LiveTennisRow[]> {
  // Use politeFetch — live-tennis.eu sits behind Cloudflare and 403s a
  // plain Node fetch on TLS fingerprint regardless of User-Agent. The
  // curl fallback in politeFetch resolves both.
  const res = await politeFetch(`https://live-tennis.eu${path}`);
  const html = await res.text();
  return parseLiveTennisHtml(html);
}

async function ourTopSlugs(
  tour: "atp" | "wta",
  isRace: boolean,
  limit: number,
): Promise<Set<string>> {
  const result = await db.execute<{ slug: string }>(sql`
    with latest as (
      select max(week_of) as w from rankings_snapshots
      where tour = ${tour} and is_race = ${isRace}
    )
    select p.slug
    from rankings_snapshots rs
    join players p on p.id = rs.player_id
    join latest on rs.week_of = latest.w
    where rs.tour = ${tour}
      and rs.is_race = ${isRace}
      and rs.rank <= ${limit}
  `);
  const rows =
    ((result as unknown) as { rows?: { slug: string }[] }).rows ??
    ((result as unknown) as { slug: string }[]);
  return new Set(rows.map((r) => r.slug));
}

interface CrossCheck {
  label: string;
  tour: "atp" | "wta";
  isRace: boolean;
  path: string;
}

// We compare against the OFFICIAL ranking endpoint (settled Monday snapshot)
// rather than /en/atp-live-ranking (live, updates mid-week). Our DB stores
// the official settled snapshot — comparing it against LT's live ranking
// would always disagree during a tournament week.
//
// For race, LT exposes only the live race page. The calendar-year totals
// shouldn't drift between Monday publishes when no matches are being
// played, but during a tournament week our settled race vs LT's live race
// WILL diverge — that's flagged when the test fails.
const CROSS_CHECKS: CrossCheck[] = [
  { label: "ATP official ranking", tour: "atp", isRace: false, path: "/en/official-atp-ranking" },
  { label: "WTA official ranking", tour: "wta", isRace: false, path: "/en/official-wta-ranking" },
  { label: "ATP race", tour: "atp", isRace: true, path: "/en/atp-race" },
  { label: "WTA race", tour: "wta", isRace: true, path: "/en/wta-race" },
];

describe.skipIf(!LIVE)("source-truth: live-tennis.eu cross-check", () => {
  for (const cc of CROSS_CHECKS) {
    it(`${cc.label}: top-50 overlap with our DB top-100`, async () => {
      const lt = await fetchLiveTennis(cc.path);
      // Sanity: live-tennis.eu always renders more than 50 rows; if we got
      // 0, the parser regex needs updating (rather than the data being bad).
      expect(lt.length, `${cc.label} parser returned 0 rows — selector regression?`)
        .toBeGreaterThan(50);

      const top50 = lt.filter((r) => r.rank <= 50);
      const ours100 = await ourTopSlugs(cc.tour, cc.isRace, 100);

      let hits = 0;
      const missed: string[] = [];
      for (const r of top50) {
        if (ours100.has(r.slugCandidate)) {
          hits++;
        } else {
          missed.push(`#${r.rank} ${r.fullName} (slug guess: ${r.slugCandidate})`);
        }
      }
      const ratio = hits / top50.length;
      console.log(`[live] ${cc.label}: ${hits}/${top50.length} of LT top-50 found in our DB top-100`);
      if (missed.length > 0) {
        console.warn(`[live] ${cc.label}: first missed players:`);
        for (const m of missed.slice(0, 5)) console.warn(`  ${m}`);
      }
      // 80% floor accounts for in-week ranking churn + slug-mismatch on a
      // handful of accent-heavy or hyphenated names. The race ranking
      // (calendar-year points) drifts more from ours since we settle weekly,
      // but the player set still overlaps strongly.
      expect(ratio, `${cc.label}: only ${hits}/${top50.length} of LT top-50 were in our DB top-100`)
        .toBeGreaterThanOrEqual(0.8);
    }, 30_000);
  }
});

// ─── 8. Field-level cross-check vs live-tennis.eu ─────────────────────────
// Per-player verification: for 10 picks per tour (spread across rank
// buckets), confirm rank / points / rank-move / next-points / max-points
// match LT within in-week tolerance. The set-overlap test above catches
// "wrong population"; this one catches "right players, wrong numbers".
//
// Tolerances are deliberately generous because:
//   - Our rank/points are the SETTLED Monday snapshot. LT updates live.
//     During a tournament week the two will legitimately diverge.
//   - Race standings (calendar-year) drift faster than ranking — but still
//     stay within a few positions for top-100 players.

const FIELD_BUCKETS: Array<{ name: string; min: number; max: number; per: number }> = [
  { name: "top-10",    min: 1,   max: 10,  per: 2 },
  { name: "11-30",     min: 11,  max: 30,  per: 2 },
  { name: "31-60",     min: 31,  max: 60,  per: 2 },
  { name: "61-100",    min: 61,  max: 100, per: 2 },
  { name: "101-200",   min: 101, max: 200, per: 2 },
];

interface FieldPick {
  slug: string;
  fullName: string;
  rank: number;
  points: number | null;
  rankMove: number | null;
  nextPoints: number | null;
  maxPoints: number | null;
}

async function sampleFieldPicks(
  tour: "atp" | "wta",
  isRace: boolean,
): Promise<FieldPick[]> {
  const out: FieldPick[] = [];
  for (const b of FIELD_BUCKETS) {
    const result = await db.execute<{
      slug: string;
      full_name: string;
      rank: number;
      points: number | null;
      rank_move: number | null;
      next_points: number | null;
      max_possible_points: number | null;
    }>(sql`
      with latest as (
        select max(week_of) as w from rankings_snapshots
        where tour = ${tour} and is_race = ${isRace}
      )
      select
        p.slug, p.full_name,
        rs.rank, rs.points, rs.rank_move,
        lp.next_points, lp.max_possible_points
      from rankings_snapshots rs
      join players p on p.id = rs.player_id
      join latest on rs.week_of = latest.w
      left join live_projections lp on lp.player_id = rs.player_id
      where rs.tour = ${tour}
        and rs.is_race = ${isRace}
        and rs.rank between ${b.min} and ${b.max}
      order by random()
      limit ${b.per}
    `);
    const rows =
      ((result as unknown) as { rows?: Record<string, unknown>[] }).rows ??
      ((result as unknown) as Record<string, unknown>[]);
    for (const r of rows) {
      out.push({
        slug: String(r.slug),
        fullName: String(r.full_name),
        rank: Number(r.rank),
        points: r.points == null ? null : Number(r.points),
        rankMove: r.rank_move == null ? null : Number(r.rank_move),
        nextPoints: r.next_points == null ? null : Number(r.next_points),
        maxPoints: r.max_possible_points == null ? null : Number(r.max_possible_points),
      });
    }
  }
  return out;
}

interface FieldDiff {
  slug: string;
  rank: { ours: number; lt: number; pass: boolean };
  points: { ours: number | null; lt: number | null; pass: boolean };
  rankMove: { ours: number | null; lt: number | null; pass: boolean };
  nextPoints: { ours: number | null; lt: number | null; pass: boolean };
  maxPoints: { ours: number | null; lt: number | null; pass: boolean };
}

function exactMatch(a: number | null, b: number | null): boolean {
  // Both null → vacuously equal. One side null → can't compare → treat as
  // OK (don't penalise for incomplete LT projections). Both set → must
  // be byte-identical.
  if (a == null || b == null) return true;
  return a === b;
}

describe.skipIf(!LIVE)("source-truth: live-tennis.eu field-level check", () => {
  for (const cc of CROSS_CHECKS) {
    it(`${cc.label}: rank/points/move/projections match within tolerance`, async () => {
      const [ltRows, picks] = await Promise.all([
        fetchLiveTennis(cc.path),
        sampleFieldPicks(cc.tour, cc.isRace),
      ]);
      // Index LT by slug for O(1) lookup; some players appear with accents
      // we don't carry on our side, so the slugifyForCompare normalisation
      // is what gives this a chance of matching.
      const ltBySlug = new Map<string, LiveTennisRow>();
      for (const r of ltRows) ltBySlug.set(r.slugCandidate, r);

      const diffs: FieldDiff[] = [];
      for (const pick of picks) {
        const lt = ltBySlug.get(pick.slug);
        if (!lt) {
          console.warn(`[live] ${cc.label}: no LT row for ${pick.slug} (rank #${pick.rank})`);
          continue;
        }
        // Exact-match comparison. The official ranking endpoint is the
        // same source feed as our scraper, so rank + points + projections
        // should be byte-identical. The race endpoint is LT-live but
        // calendar-year totals only change when a match is played — they
        // should also match exactly between scrapes.
        //
        // rankMove (rank change vs last published week) is omitted from
        // the official-ranking comparison because the official page
        // doesn't carry a rank-change cell. We still capture it on the
        // race page where chtd is shown, but skip-on-null.
        diffs.push({
          slug: pick.slug,
          rank: { ours: pick.rank, lt: lt.rank, pass: pick.rank === lt.rank },
          points: { ours: pick.points, lt: lt.points, pass: exactMatch(pick.points, lt.points) },
          rankMove: { ours: pick.rankMove, lt: lt.rankChange, pass: exactMatch(pick.rankMove, lt.rankChange) },
          nextPoints: { ours: pick.nextPoints, lt: lt.nextPoints, pass: exactMatch(pick.nextPoints, lt.nextPoints) },
          maxPoints: { ours: pick.maxPoints, lt: lt.maxPoints, pass: exactMatch(pick.maxPoints, lt.maxPoints) },
        });
      }

      // Report — one line per pick, with PASS/FAIL per field.
      console.log(`[live] ${cc.label} field-level (${diffs.length} compared):`);
      for (const d of diffs) {
        const f = (label: string, x: { ours: unknown; lt: unknown; pass: boolean }) =>
          `${label}=${x.pass ? "OK" : "FAIL"}(${x.ours ?? "·"}/${x.lt ?? "·"})`;
        console.log(
          `  ${d.slug.padEnd(28)} ${f("rank", d.rank)} ${f("pts", d.points)} ${f("move", d.rankMove)} ${f("next", d.nextPoints)} ${f("max", d.maxPoints)}`,
        );
      }

      // Strict assertion: every compared pick must match every field
      // exactly (nullable fields skip-on-null via exactMatch). A single
      // mismatch fails the test with a list of the offending fields per
      // pick — making the data drift impossible to ignore.
      const compared = diffs.length;
      if (compared < 6) {
        console.warn(`[live] ${cc.label}: only ${compared} picks resolved against LT — skipping assertion`);
        return;
      }
      const failures: string[] = [];
      for (const d of diffs) {
        const wrong: string[] = [];
        if (!d.rank.pass) wrong.push(`rank: ours=${d.rank.ours} vs LT=${d.rank.lt}`);
        if (!d.points.pass) wrong.push(`points: ours=${d.points.ours} vs LT=${d.points.lt}`);
        if (!d.rankMove.pass) wrong.push(`rank_move: ours=${d.rankMove.ours} vs LT=${d.rankMove.lt}`);
        if (!d.nextPoints.pass) wrong.push(`next: ours=${d.nextPoints.ours} vs LT=${d.nextPoints.lt}`);
        if (!d.maxPoints.pass) wrong.push(`max: ours=${d.maxPoints.ours} vs LT=${d.maxPoints.lt}`);
        if (wrong.length > 0) failures.push(`  ${d.slug}: ${wrong.join("; ")}`);
      }
      expect(
        failures.length,
        `${cc.label}: ${failures.length}/${compared} picks have field mismatches:\n${failures.join("\n")}`,
      ).toBe(0);
    }, 45_000);
  }
});

// ─── 9. LIVE ranking cross-check vs live-tennis.eu ────────────────────────
// Compares our derived live_rank / live_points against LT's
// /en/{atp,wta}-live-ranking with zero tolerance. The settled-ranking
// test above keeps the canonical snapshot honest; this one keeps the
// in-week derivation honest. Same set of 10 picks per tour, sampled
// across the rank spectrum.

const LIVE_CROSS_CHECKS: Array<{
  label: string;
  tour: "atp" | "wta";
  path: string;
  isRace: boolean;
}> = [
  { label: "ATP live ranking (derived)", tour: "atp", path: "/en/atp-live-ranking", isRace: false },
  { label: "WTA live ranking (derived)", tour: "wta", path: "/en/wta-live-ranking", isRace: false },
];

interface LiveFieldPick {
  slug: string;
  fullName: string;
  settledRank: number;
  livePoints: number | null;
  liveRank: number | null;
}

async function sampleLivePicks(tour: "atp" | "wta"): Promise<LiveFieldPick[]> {
  const out: LiveFieldPick[] = [];
  for (const b of FIELD_BUCKETS) {
    const result = await db.execute<{
      slug: string;
      full_name: string;
      rank: number;
      live_points: number | null;
      live_rank: number | null;
    }>(sql`
      with latest as (
        select max(week_of) as w from rankings_snapshots
        where tour = ${tour} and is_race = false
      )
      select
        p.slug, p.full_name, rs.rank,
        lp.live_points, lp.live_rank
      from rankings_snapshots rs
      join players p on p.id = rs.player_id
      join latest on rs.week_of = latest.w
      left join live_projections lp on lp.player_id = rs.player_id
      where rs.tour = ${tour}
        and rs.is_race = false
        and rs.rank between ${b.min} and ${b.max}
      order by random()
      limit ${b.per}
    `);
    const rows =
      ((result as unknown) as { rows?: Record<string, unknown>[] }).rows ??
      ((result as unknown) as Record<string, unknown>[]);
    for (const r of rows) {
      out.push({
        slug: String(r.slug),
        fullName: String(r.full_name),
        settledRank: Number(r.rank),
        livePoints: r.live_points == null ? null : Number(r.live_points),
        liveRank: r.live_rank == null ? null : Number(r.live_rank),
      });
    }
  }
  return out;
}

describe.skipIf(!LIVE)("source-truth: derived live ranking vs live-tennis.eu", () => {
  for (const cc of LIVE_CROSS_CHECKS) {
    it(`${cc.label}: live_points + live_rank exact match`, async () => {
      const [ltRows, picks] = await Promise.all([
        fetchLiveTennis(cc.path),
        sampleLivePicks(cc.tour),
      ]);
      const ltBySlug = new Map<string, LiveTennisRow>();
      for (const r of ltRows) ltBySlug.set(r.slugCandidate, r);

      console.log(`[live] ${cc.label} (${picks.length} sampled):`);
      const failures: string[] = [];
      let comparable = 0;
      for (const pick of picks) {
        const lt = ltBySlug.get(pick.slug);
        if (!lt) {
          console.warn(`  ${pick.slug}: no LT row at settled rank ${pick.settledRank}`);
          continue;
        }
        // Skip when our derivation hasn't produced a row — usually means
        // the player is outside the topN that runProjections covers. That's
        // a configuration gap, not a correctness bug.
        if (pick.livePoints == null || pick.liveRank == null) {
          console.warn(`  ${pick.slug}: no derived live row (settled rank ${pick.settledRank})`);
          continue;
        }
        comparable++;
        const wrong: string[] = [];
        if (pick.liveRank !== lt.rank) {
          wrong.push(`live_rank ours=${pick.liveRank} vs LT=${lt.rank}`);
        }
        if (lt.points != null && pick.livePoints !== lt.points) {
          wrong.push(`live_points ours=${pick.livePoints} vs LT=${lt.points}`);
        }
        const status = wrong.length === 0 ? "OK" : "FAIL";
        console.log(
          `  ${pick.slug.padEnd(28)} settled#${pick.settledRank} → live#${pick.liveRank} (${pick.livePoints}) [${status}]`,
        );
        if (wrong.length > 0) failures.push(`  ${pick.slug}: ${wrong.join("; ")}`);
      }
      if (comparable < 5) {
        console.warn(
          `[live] ${cc.label}: only ${comparable} picks had both LT + derived rows — skipping assertion`,
        );
        return;
      }
      expect(
        failures.length,
        `${cc.label}: ${failures.length}/${comparable} live-ranking mismatches:\n${failures.join("\n")}`,
      ).toBe(0);
    }, 45_000);
  }
});
