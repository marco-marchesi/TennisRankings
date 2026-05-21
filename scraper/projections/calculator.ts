// Pure-function projection calculator. Status-aware: each of the four player
// states maps to a different (Next, Max, +/-) result per the user's spec.
//
//   NOT_PLAYING     — no tournament this week.
//                     next=null, max=null, delta = -dropping
//                     (rationale: they earn nothing, so their next-Monday
//                     publish drops by exactly the rolling-off points; UI
//                     hides Next/Max because there's no tournament to point
//                     to — only +/- matters)
//
//   IN_PROGRESS     — won their latest match in the current week. Now playing
//                     the next round.
//                     secured = pointsForRound(category, nextRound)
//                     next    = current + secured - dropping
//                     max     = current + winnerReward - dropping
//                     delta   = secured - dropping
//
//   ELIMINATED      — lost their latest match this week.
//                     next = current   (per user: "next becomes official
//                                       ranking"; off-sync with ATP until
//                                       next Monday's publish)
//                     max  = null
//                     delta = securedAtLossRound - dropping
//
//   WON_TOURNAMENT  — won the final this week. No further progression.
//                     secured = winnerReward
//                     next = max = current + secured - dropping
//                     delta = secured - dropping
//
// Inputs flow in from two real sources: dropPoints from ATP's published
// rankings page, roundReached from Tennis Abstract match data.

import { pointsForRound, type Category, type Round } from "../config/points-table";

export type ProjectionStatus = "not_playing" | "in_progress" | "eliminated" | "won_tournament";

export interface ProjectionInput {
  /** Points TOTAL at the most recent Monday publish. */
  currentPoints: number;
  /** Points rolling off the 52-week window on the next publish. From ATP's "Dropping" column. */
  droppingPoints: number;
  /**
   * Highest non-countable result from ATP's "Next Best" column. When a
   * countable result drops off, this gets promoted into the countable set —
   * so the effective loss is (dropping − nextBest), not the full dropping.
   * Defaults to 0 when unknown (e.g. WTA, where the column isn't published).
   */
  nextBestPoints?: number;
  status: ProjectionStatus;
  /** Required unless status is "not_playing". */
  category?: Category;
  /**
   * Round whose points the player has secured:
   *   - in_progress:    the round they ADVANCED TO (= round they'll play next)
   *   - eliminated:     the round they LOST IN
   *   - won_tournament: "W"
   *   - not_playing:    null (ignored)
   */
  roundReached?: Round | null;
}

export interface ProjectionOutput {
  /** null when the UI should leave the Next column blank. */
  nextPoints: number | null;
  /** null when there is no more upside (eliminated, won, or not playing). */
  maxPossiblePoints: number | null;
  /** Net change at next Monday's publish — always defined. */
  pointsDelta: number;
}

export function computeProjection(input: ProjectionInput): ProjectionOutput {
  const { currentPoints, droppingPoints, status, category, roundReached } = input;
  const nextBest = input.nextBestPoints ?? 0;

  // The "next-best promotion" mechanic: when a countable result rolls off,
  // a player's next-best non-countable steps in to fill the slot. Net loss
  // from dropping is therefore (dropping − nextBest), not the full dropping.
  // We cap nextBest at droppingPoints because next_best can't promote into
  // anything beyond the slot that just opened up.
  const effectiveDrop = Math.max(0, droppingPoints - Math.min(droppingPoints, nextBest));

  if (status === "not_playing") {
    // No tournament this week → no secured points → the only thing that
    // changes is dropping minus the next-best backfill.
    const delta = -effectiveDrop;
    return {
      nextPoints: currentPoints + delta,
      maxPossiblePoints: null,
      pointsDelta: delta,
    };
  }

  if (!category || !roundReached) {
    throw new Error(`status "${status}" requires both category and roundReached`);
  }

  const secured = pointsForRound(category, roundReached);
  const winnerReward = pointsForRound(category, "W");
  const delta = secured - effectiveDrop;

  if (status === "in_progress") {
    return {
      nextPoints: currentPoints + delta,
      maxPossiblePoints: currentPoints + winnerReward - effectiveDrop,
      pointsDelta: delta,
    };
  }

  if (status === "won_tournament") {
    const winnerDelta = winnerReward - effectiveDrop;
    const total = currentPoints + winnerDelta;
    return { nextPoints: total, maxPossiblePoints: total, pointsDelta: winnerDelta };
  }

  // eliminated — projected total is what they actually have locked in.
  // Max is null because there's no further upside (they can't advance).
  return {
    nextPoints: currentPoints + delta,
    maxPossiblePoints: null,
    pointsDelta: delta,
  };
}
