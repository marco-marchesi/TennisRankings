// Computes "dropping points" for each player — the count that will roll off
// their 52-week rolling-sum window on next Monday's publish.
//
// Source: `player_recent_matches` (Tennis Abstract). For each player, find
// tournaments that started ~52 weeks ago, identify the deepest round they
// reached, look up the corresponding points, and sum across tournaments.
//
// Used as a fallback to `rankings_snapshots.drop_points` (which is the
// ATP-published value, captured directly during refresh). WTA's rankings
// page doesn't expose this column, so for WTA players we always rely on this
// derivation; for ATP we prefer the published value when present.
//
// Known approximations:
//   - We assume EVERY result counts (not "best 18 + 4 mandatory"). For top
//     players who play more than 22 events, this slightly overestimates the
//     drop. For ranks ~30+, the approximation is exact.
//   - Tournament category inference falls back to a default tier when level
//     code is ambiguous — see category-inference.ts for the rules.

import { db, schema } from "@/db";
import { and, gte, inArray, lte, sql } from "drizzle-orm";
import { ROUNDS_IN_ORDER, pointsForRound, type Round } from "../config/points-table";
import { inferCategory } from "./category-inference";

interface Options {
  tour: "atp" | "wta";
  playerIds: number[];
}

/**
 * Returns a map of playerId → dropping points (always ≥ 0).
 * Players with no matches in the dropping window get 0.
 */
export async function deriveDroppingPoints(opts: Options): Promise<Map<number, number>> {
  const result = new Map<number, number>();
  if (opts.playerIds.length === 0) return result;

  // Tournaments dropping next Monday: any whose start_date was approximately
  // 52 weeks ago. We use a 14-day window centered on 364 days back to absorb
  // small offsets between "tournament start" and "ranking-week boundary".
  const today = new Date();
  const hi = isoDate(addDays(today, -357));
  const lo = isoDate(addDays(today, -371));

  const rows = await db
    .select({
      playerId: schema.playerRecentMatches.playerId,
      tournamentName: schema.playerRecentMatches.tournamentName,
      tournamentLevel: schema.playerRecentMatches.tournamentLevel,
      round: schema.playerRecentMatches.round,
      won: schema.playerRecentMatches.won,
      playedOn: schema.playerRecentMatches.playedOn,
    })
    .from(schema.playerRecentMatches)
    .where(
      and(
        inArray(schema.playerRecentMatches.playerId, opts.playerIds),
        gte(schema.playerRecentMatches.playedOn, lo),
        lte(schema.playerRecentMatches.playedOn, hi),
      ),
    );

  // Group by (player, tournament_name). Each group is the player's matches at
  // that tournament. The deepest match tells us how many points they earned.
  type Key = string;
  const groups = new Map<Key, typeof rows>();
  for (const r of rows) {
    const key = `${r.playerId}::${r.tournamentName}`;
    const existing = groups.get(key);
    if (existing) existing.push(r);
    else groups.set(key, [r]);
  }

  for (const matches of groups.values()) {
    const first = matches[0]!;
    const category = inferCategory(opts.tour, first.tournamentName, first.tournamentLevel);
    const earned = earnedAtTournament(matches.map((m) => ({ round: m.round, won: m.won })), category);
    if (earned === 0) continue;
    const prior = result.get(first.playerId) ?? 0;
    result.set(first.playerId, prior + earned);
  }

  return result;
}

interface MatchOutcome {
  round: string;
  won: boolean;
}

/**
 * Given a player's match list at one tournament, compute how many points they
 * walked away with. The rule:
 *   - The DEEPEST round in their list is the round they reached.
 *   - If they LOST that deepest match → they were eliminated there →
 *     earned = pointsForRound(category, deepestRound).
 *   - If they WON that deepest match AND it was the F → they won the title →
 *     earned = pointsForRound(category, "W").
 *   - If they WON that deepest match but it wasn't F → either they won the
 *     title (data missing F row) or data is incomplete. Treat as advanced to
 *     the next round (conservative).
 */
function earnedAtTournament(matches: MatchOutcome[], category: ReturnType<typeof inferCategory>): number {
  if (matches.length === 0) return 0;
  // Rank each match by its position in ROUNDS_IN_ORDER. Higher = deeper.
  let deepestIdx = -1;
  let deepestMatch: MatchOutcome | null = null;
  for (const m of matches) {
    const idx = ROUNDS_IN_ORDER.indexOf(m.round as Round);
    if (idx > deepestIdx) {
      deepestIdx = idx;
      deepestMatch = m;
    }
  }
  if (!deepestMatch) return 0;

  if (deepestMatch.won) {
    if (deepestMatch.round === "F") return pointsForRound(category, "W");
    // Won this round, no subsequent match recorded → assume advanced to next
    // round and stopped there. Conservative: take next-round loser reward.
    const nextRound = ROUNDS_IN_ORDER[deepestIdx + 1] ?? "W";
    return pointsForRound(category, nextRound);
  }
  // Lost at the deepest round → that's their finishing position.
  return pointsForRound(category, deepestMatch.round as Round);
}

function addDays(d: Date, n: number): Date {
  return new Date(d.getTime() + n * 24 * 60 * 60 * 1000);
}

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}
