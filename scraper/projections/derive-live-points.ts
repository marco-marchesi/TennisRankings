// Derives "live" points + rank for each top-N player by adding the
// week-to-date points earned (or about to be earned) to the settled
// Monday snapshot.
//
// Matches the semantics of live-tennis.eu's /en/atp-live-ranking page:
//
//   live_points = settled_points
//               + sum( pointsForRound(category, roundOf(match)) )
//                 over each finished match the player played in the
//                 current ranking week
//
// The "round of a match" is the round at which the player STOPPED:
//   - if they won the match → the round they advanced TO
//   - if they lost the match → the round they lost IN
//
// Players who haven't played a match this week → live_points = settled.
//
// Tournament-week boundary: ATP/WTA publishes rankings on Mondays. We
// take "this week" as [last_monday_00:00 UTC, now]. Anything that
// happened before last Monday is already in the settled total.
//
// Race uses identical logic but adds to settled RACE points instead.
// The race already excludes drops since it's calendar-year YTD.

import { db } from "@/db";
import { sql } from "drizzle-orm";
import {
  canonicalizeRound,
  pointsForRound,
  ROUNDS_IN_ORDER,
  type Category,
  type Round,
} from "../config/points-table";
import { inferCategory } from "./category-inference";

export interface LivePointsRow {
  playerId: number;
  /** Settled snapshot total at last Monday's publish. */
  settledPoints: number;
  /** Settled rank. */
  settledRank: number;
  /** Live total = settled + in-week earnings. */
  livePoints: number;
  /** Re-ranked position by livePoints (1 = highest). */
  liveRank: number;
  /** Same for race (calendar-year points). */
  settledRacePoints: number;
  settledRaceRank: number;
  liveRacePoints: number;
  liveRaceRank: number;
  /** settledRank - liveRank. Positive = improved, negative = dropped. */
  liveRankChange: number;
}

interface RunOpts {
  tour: "atp" | "wta";
  /** Cap the input population to this many top-ranked players (default 200). */
  topN?: number;
}

interface InWeekMatch {
  player_id: number;
  tournament_name: string;
  tournament_level: string | null;
  round: string;
  won: boolean;
  played_on: string; // ISO date
}

export async function deriveLivePoints(opts: RunOpts): Promise<LivePointsRow[]> {
  const topN = opts.topN ?? 200;
  const weekStart = mostRecentMondayUtc();

  // 1. Pull settled (Monday) ranking + race for the top-N players in one go.
  //    Also drop_points — the dropping count we must SUBTRACT when computing
  //    live points (those are last year's same-tournament points that are
  //    no longer countable now that this year's edition has begun).
  const settled = await db.execute<{
    player_id: number;
    rank: number;
    points: number;
    drop_points: number | null;
    is_race: boolean;
  }>(sql`
    with latest_official as (
      select max(week_of) as w from rankings_snapshots
      where tour = ${opts.tour} and is_race = false
    ),
    latest_race as (
      select max(week_of) as w from rankings_snapshots
      where tour = ${opts.tour} and is_race = true
    )
    select rs.player_id, rs.rank, rs.points, rs.drop_points, rs.is_race
    from rankings_snapshots rs
    where rs.tour = ${opts.tour}
      and (
        (rs.is_race = false and rs.week_of = (select w from latest_official) and rs.rank <= ${topN})
        or
        (rs.is_race = true and rs.week_of = (select w from latest_race) and rs.rank <= ${topN})
      )
  `);
  const settledRows =
    ((settled as unknown) as { rows?: Array<Record<string, unknown>> }).rows ??
    ((settled as unknown) as Array<Record<string, unknown>>);
  const officialByPlayer = new Map<number, { rank: number; points: number; dropping: number }>();
  const raceByPlayer = new Map<number, { rank: number; points: number }>();
  for (const r of settledRows) {
    const playerId = Number(r.player_id);
    if (r.is_race) {
      raceByPlayer.set(playerId, { rank: Number(r.rank), points: Number(r.points) });
    } else {
      officialByPlayer.set(playerId, {
        rank: Number(r.rank),
        points: Number(r.points),
        dropping: r.drop_points == null ? 0 : Number(r.drop_points),
      });
    }
  }

  const allPlayerIds = Array.from(
    new Set([...officialByPlayer.keys(), ...raceByPlayer.keys()]),
  );
  if (allPlayerIds.length === 0) return [];

  // 2. Pull every match this week for these players. DISTINCT ON to dedupe
  //    rows that exist in both TA and TE (prefer TE).
  const matches = await db.execute<{
    player_id: number;
    tournament_name: string;
    tournament_level: string | null;
    round: string;
    won: boolean;
    played_on: string;
  }>(sql`
    select distinct on (prm.player_id, prm.played_on, lower(prm.opponent_name))
      prm.player_id, prm.tournament_name, prm.tournament_level,
      prm.round, prm.won, prm.played_on::text as played_on
    from player_recent_matches prm
    where prm.player_id = any(array[${sql.join(allPlayerIds.map((id) => sql`${id}`), sql`, `)}]::int[])
      and prm.played_on >= ${weekStart}
    order by prm.player_id, prm.played_on, lower(prm.opponent_name),
             case prm.source when 'tennis_explorer' then 0 else 1 end
  `);
  const matchRows =
    ((matches as unknown) as { rows?: InWeekMatch[] }).rows ??
    ((matches as unknown) as InWeekMatch[]);

  // 3. For each player, walk their matches in chronological order and sum
  //    the points earned. The points for "round R" represent the value of
  //    reaching that round (with a win) or losing in it.
  //
  //    Key subtlety: in the points table, the value for round R is what the
  //    player gets for *reaching* R — i.e. their best result so far. So as
  //    a player wins matches, we replace their already-credited points
  //    with the higher value for the next round, NOT add them on top.
  //    The "earned this week" is the FINAL round value minus 0 (since
  //    they came into the week with 0 points from this tournament).
  //
  //    For a player still in_progress, their current credit = round they
  //    last completed (the one they advanced TO if they won, or lost IN
  //    if they lost their latest match).
  const inWeekByPlayer = new Map<number, InWeekMatch[]>();
  for (const m of matchRows) {
    const arr = inWeekByPlayer.get(m.player_id) ?? [];
    arr.push(m);
    inWeekByPlayer.set(m.player_id, arr);
  }

  function pointsEarnedThisWeek(
    playerId: number,
    tour: "atp" | "wta",
  ): number {
    const ms = inWeekByPlayer.get(playerId);
    if (!ms || ms.length === 0) return 0;
    // Sort chronologically — the LAST match tells us the round they ended at.
    ms.sort((a, b) => a.played_on.localeCompare(b.played_on));
    // Group by tournament so a player who appeared in two tournaments this
    // week (rare — qualifying + main draw) gets each contribution.
    const byTournament = new Map<string, InWeekMatch[]>();
    for (const m of ms) {
      const arr = byTournament.get(m.tournament_name) ?? [];
      arr.push(m);
      byTournament.set(m.tournament_name, arr);
    }
    let total = 0;
    for (const [tName, tMatches] of byTournament) {
      const last = tMatches[tMatches.length - 1]!;
      const category = inferCategory(tour, tName, last.tournament_level);
      const reachedRound = reachedRoundForMatch(last, category);
      if (!reachedRound) continue;
      total += pointsForRound(category, reachedRound);
    }
    return total;
  }

  // 4. Build the per-player live totals.
  //
  // Formula (matches live-tennis.eu and ATP/WTA's own live ranking logic):
  //
  //   live_points = settled_points
  //               − dropping_points          (last year's same-tournament credit)
  //               + earned_this_week         (this year's accumulated rounds)
  //
  // For RACE there is no dropping (race is calendar-year YTD), so:
  //   live_race_points = settled_race_points + earned_this_week
  const rows: LivePointsRow[] = [];
  for (const playerId of allPlayerIds) {
    const official = officialByPlayer.get(playerId);
    const race = raceByPlayer.get(playerId);
    if (!official) continue; // need settled official to compute live ranking
    const earned = pointsEarnedThisWeek(playerId, opts.tour);
    const livePoints = official.points - official.dropping + earned;
    const liveRacePoints = (race?.points ?? 0) + earned;
    rows.push({
      playerId,
      settledPoints: official.points,
      settledRank: official.rank,
      livePoints,
      liveRank: 0, // assigned after sort below
      settledRacePoints: race?.points ?? 0,
      settledRaceRank: race?.rank ?? 0,
      liveRacePoints,
      liveRaceRank: 0, // assigned after sort below
      liveRankChange: 0, // assigned after re-rank
    });
  }

  // 5. Re-rank by livePoints (DESC), assigning 1..N. Ties broken by settled
  //    rank — keeps the order deterministic and matches LT's tiebreaker.
  rows.sort((a, b) =>
    b.livePoints - a.livePoints || a.settledRank - b.settledRank,
  );
  for (let i = 0; i < rows.length; i++) {
    rows[i]!.liveRank = i + 1;
    rows[i]!.liveRankChange = rows[i]!.settledRank - rows[i]!.liveRank;
  }

  // 6. Re-rank by liveRacePoints (DESC), assigning 1..N. Players with no
  //    race row keep rank 0 → end of the list.
  rows.sort((a, b) =>
    b.liveRacePoints - a.liveRacePoints ||
    (a.settledRaceRank || 9999) - (b.settledRaceRank || 9999),
  );
  for (let i = 0; i < rows.length; i++) {
    rows[i]!.liveRaceRank = i + 1;
  }

  return rows;
}

/**
 * Given a match this player just played, what round have they currently
 * reached? Mirrors the calculator's roundReached convention:
 *   - won  → the NEXT round (they advanced)
 *   - lost → the round of the match (they fell out at this round)
 *
 * The raw round string comes from player_recent_matches.round, which can
 * be in any of TA / TE / ATP formats. canonicalizeRound + category resolve
 * this into our internal `Round` ladder.
 */
function reachedRoundForMatch(
  m: { round: string; won: boolean },
  category: Category,
): Round | null {
  const round = canonicalizeRound(m.round, category);
  if (!round) return null;
  if (!m.won) return round;
  // Advanced. If they won the final ("F"), the next round is "W".
  if (round === "F") return "W";
  const idx = ROUNDS_IN_ORDER.indexOf(round);
  return ROUNDS_IN_ORDER[idx + 1] ?? "W";
}

/**
 * Return the most-recent Monday at 00:00 UTC as an ISO date string. ATP/WTA
 * publishes new rankings on Monday — anything before that boundary is in
 * the settled snapshot already.
 */
function mostRecentMondayUtc(): string {
  const d = new Date();
  const dow = d.getUTCDay(); // 0 = Sunday, 1 = Monday
  // How many days back to last Monday? Sunday → 6, Monday → 0, Tue → 1, etc.
  const daysBack = dow === 0 ? 6 : dow - 1;
  d.setUTCDate(d.getUTCDate() - daysBack);
  return d.toISOString().slice(0, 10);
}
