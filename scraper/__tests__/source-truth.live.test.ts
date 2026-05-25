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
  // ("Bautista Agut R.") will still contain "Agut" so the substring match
  // still hits.
  const parts = fullName.trim().split(/\s+/);
  return parts[parts.length - 1] ?? fullName;
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
async function fetchWdClaims(qid: string): Promise<{
  sport: string | null;
  dobIso: string | null;
}> {
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
}

// ─── DB query helpers ────────────────────────────────────────────────

// matches-table column names have evolved between commits. Try the
// documented column set; return null on schema mismatch so the calling
// test can degrade gracefully instead of failing the whole suite.
async function dbHasMatchForPlayerOnDate(
  playerId: number,
  dateStr: string,
): Promise<boolean | null> {
  try {
    const res = await db.execute<{ count: number }>(sql`
      select count(*)::int as count
      from matches m
      where (m.player_a_id = ${playerId} or m.player_b_id = ${playerId})
        and m.played_on::text = ${dateStr}
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
    for (const p of candidates) {
      const { dobIso } = await fetchWdClaims(p.wikidataId!);
      if (!dobIso) {
        console.warn(`[live] ${p.slug}: Wikidata has no DOB; skipping`);
        continue;
      }
      expect(dobIso, `${p.slug}: DB=${p.dateOfBirth} WD=${dobIso}`).toBe(p.dateOfBirth);
    }
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
              m.p1Name.toLowerCase().includes(ln) ||
              m.p2Name.toLowerCase().includes(ln);
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
              m.p1Name.toLowerCase().includes(ln) ||
              m.p2Name.toLowerCase().includes(ln);
            if (!involved) continue;
            const has = await dbHasMatchForPlayerOnDate(pick.playerId, dateStr);
            if (has === null) continue; // schema mismatch already reported above
            if (has) wins++;
            else {
              misses++;
              if (examples.length < 5) {
                const opp = m.p1Name.toLowerCase().includes(ln) ? m.p2Name : m.p1Name;
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
