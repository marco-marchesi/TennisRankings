// Derives each top-N player's current-tournament status from the per-player
// match history we've already backfilled (player_recent_matches, sourced
// from Tennis Abstract). For each player:
//
//   1. Look at their most recent completed match in `player_recent_matches`.
//   2. If it's within the lookback window (default 7 days), derive status:
//        - last match was a WIN of the final  → won_tournament (roundReached "W")
//        - last match was a WIN, other round  → in_progress    (roundReached = next round)
//        - last match was a LOSS              → eliminated     (roundReached = round they lost in)
//   3. If no match in the window               → not_playing.
//
// Limitation: Tennis Abstract publishes match CSVs after the matches are
// played, often with a 1-3 day lag. So "live" here means "as of the last
// Tennis Abstract CSV refresh". For truly real-time updates during a match
// in progress, a different source (live scoreboard scrape) would be needed.

import { db, schema } from "@/db";
import { and, desc, eq, gte, sql } from "drizzle-orm";
import { ROUNDS_IN_ORDER, type Category, type Round } from "../config/points-table";
import type { ProjectionStatus } from "./calculator";
import { inferCategory } from "./category-inference";

export interface LiveState {
  playerId: number;
  status: ProjectionStatus;
  /** null when status === "not_playing". */
  tournamentName: string | null;
  tournamentCategory: Category | null;
  /** See calculator.ts for the round-reached semantics by status. */
  roundReached: Round | null;
  lastMatchDate: string | null;
}

interface DeriveOptions {
  tour: "atp" | "wta";
  topN: number;
  /** How many days back to look for "current week" matches. */
  lookbackDays?: number;
}

export async function deriveLiveStates(opts: DeriveOptions): Promise<LiveState[]> {
  const lookbackDays = opts.lookbackDays ?? 14;
  const cutoff = new Date();
  cutoff.setUTCDate(cutoff.getUTCDate() - lookbackDays);
  const cutoffStr = cutoff.toISOString().slice(0, 10);

  // Pull the top-N players for the tour with their most-recent match (if any
  // exists within the lookback window). Done as one query so we don't N+1.
  //
  // Critical filter: we EXCLUDE matches whose tournament already has a Final
  // played. Otherwise we'd treat last month's Madrid Masters as the "current
  // tournament", awarding everyone their Madrid points all over again on top
  // of the official ranking that already reflects them. A tournament with a
  // Final on record is over — its participants should be `not_playing`, not
  // `in_progress` or `eliminated`.
  const rows = await db.execute<{
    player_id: number;
    full_name: string;
    last_played_on: string | null;
    last_tournament: string | null;
    last_level: string | null;
    last_round: string | null;
    last_won: boolean | null;
  }>(sql`
    with top_players as (
      select rs.player_id, p.full_name, p.tour, rs.rank
      from rankings_snapshots rs
      join players p on p.id = rs.player_id
      where rs.tour = ${opts.tour}
        and rs.is_race = false
        and rs.week_of = (
          select max(week_of) from rankings_snapshots
          where tour = ${opts.tour} and is_race = false
        )
      order by rs.rank
      limit ${opts.topN}
    ),
    finished_tournaments as (
      -- Any tournament that has a Final row recorded is over. We compare by
      -- (tournament_name, year) so re-runs of the same event don't conflate.
      select distinct
        tournament_name,
        extract(year from played_on)::int as year
      from player_recent_matches
      where round = 'F'
    ),
    in_progress_matches as (
      select prm.*
      from player_recent_matches prm
      left join finished_tournaments ft
        on ft.tournament_name = prm.tournament_name
       and ft.year = extract(year from prm.played_on)::int
      where prm.played_on >= ${cutoffStr}
        and ft.tournament_name is null
    ),
    latest_match as (
      select distinct on (ipm.player_id)
        ipm.player_id, ipm.played_on, ipm.tournament_name, ipm.tournament_level,
        ipm.round, ipm.won
      from in_progress_matches ipm
      order by ipm.player_id, ipm.played_on desc
    )
    select
      tp.player_id,
      tp.full_name,
      lm.played_on::text as last_played_on,
      lm.tournament_name as last_tournament,
      lm.tournament_level as last_level,
      lm.round as last_round,
      lm.won as last_won
    from top_players tp
    left join latest_match lm on lm.player_id = tp.player_id;
  `);
  const result = (rows as unknown as { rows: Array<Record<string, unknown>> }).rows ??
    (rows as unknown as Array<Record<string, unknown>>);

  return result.map((r) => deriveOne(opts.tour, r));
}

function deriveOne(tour: "atp" | "wta", r: Record<string, unknown>): LiveState {
  const playerId = Number(r.player_id);
  const playedOn = r.last_played_on ? String(r.last_played_on) : null;
  const tournamentName = r.last_tournament ? String(r.last_tournament) : null;
  const level = r.last_level ? String(r.last_level) : null;
  const round = r.last_round ? String(r.last_round) : null;
  const won = r.last_won === true;

  // No recent match → player isn't participating in any tournament this week.
  if (!playedOn || !round || !tournamentName) {
    return {
      playerId,
      status: "not_playing",
      tournamentName: null,
      tournamentCategory: null,
      roundReached: null,
      lastMatchDate: null,
    };
  }

  const category = inferCategory(tour, tournamentName, level);
  const matchRound = round as Round;

  if (won && matchRound === "F") {
    return {
      playerId,
      status: "won_tournament",
      tournamentName,
      tournamentCategory: category,
      roundReached: "W",
      lastMatchDate: playedOn,
    };
  }

  if (won) {
    // Won a non-final round → advancing to the next round.
    const idx = ROUNDS_IN_ORDER.indexOf(matchRound);
    const nextRound = (idx >= 0 && idx + 1 < ROUNDS_IN_ORDER.length
      ? ROUNDS_IN_ORDER[idx + 1]
      : "W") as Round;
    return {
      playerId,
      status: "in_progress",
      tournamentName,
      tournamentCategory: category,
      roundReached: nextRound,
      lastMatchDate: playedOn,
    };
  }

  // Lost their last match.
  return {
    playerId,
    status: "eliminated",
    tournamentName,
    tournamentCategory: category,
    roundReached: matchRound,
    lastMatchDate: playedOn,
  };
}

// Suppress unused-warning for the helper exports we want available later.
export type { Category };
