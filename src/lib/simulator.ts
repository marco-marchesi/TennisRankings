import "server-only";
import {
  ATP_BEST_RESULTS_COUNT,
  WTA_BEST_RESULTS_COUNT,
  RANKING_WINDOW_WEEKS,
} from "./constants";

/**
 * "What if" simulator for ranking outcomes.
 *
 * The simplified algorithm:
 *   1. Take the player's current points-breakdown (per tournament, per
 *      points-on-roll-off-date).
 *   2. Apply the hypothetical override: "what if Sinner reaches the
 *      semi-finals at Roland Garros 2026?" → replaces the current Roland
 *      Garros line with the SF point award.
 *   3. Re-aggregate using the tour rule:
 *        ATP: best 18 in the rolling 52 weeks, with 4 mandatory slams + 8
 *             mandatory Masters 1000 weighted.
 *        WTA: best 16, with mandatory tournaments rule (slightly different).
 *   4. Sort and compare against today.
 *
 * This file ships the *interface* and a minimal placeholder so the API
 * route compiles. The full rule engine is a phase-3 implementation.
 *
 * TODO(phase 3):
 *   - Implement mandatory-tournament substitution properly.
 *   - Account for protected ranking, special exempts, and walkover rules.
 *   - Validate against historical weeks where the actual result is known.
 */

export interface PointsLine {
  tournamentSlug: string;
  category: "grand_slam" | "masters_1000" | "atp_500" | "atp_250" | "finals" | "other";
  points: number;
  isMandatory: boolean;
  expiresWeekOf: string;
}

export interface SimulationInput {
  playerSlug: string;
  tour: "atp" | "wta";
  scenario: Array<{
    tournamentSlug: string;
    pointsAfterScenario: number;
  }>;
}

export interface SimulationResult {
  playerSlug: string;
  currentRank: number;
  projectedRank: number;
  projectedPoints: number;
  breakdown: PointsLine[];
}

export function simulate(
  current: PointsLine[],
  input: SimulationInput,
): SimulationResult {
  const limit =
    input.tour === "atp" ? ATP_BEST_RESULTS_COUNT : WTA_BEST_RESULTS_COUNT;

  const overrides = new Map(
    input.scenario.map((s) => [s.tournamentSlug, s.pointsAfterScenario]),
  );

  const adjusted = current.map((line) =>
    overrides.has(line.tournamentSlug)
      ? { ...line, points: overrides.get(line.tournamentSlug)! }
      : line,
  );

  // Phase 1 of the rule: take best `limit` results, mandatory first.
  const mandatory = adjusted.filter((l) => l.isMandatory);
  const optional = adjusted
    .filter((l) => !l.isMandatory)
    .sort((a, b) => b.points - a.points);
  const taken = [
    ...mandatory,
    ...optional.slice(0, Math.max(0, limit - mandatory.length)),
  ];

  const projectedPoints = taken.reduce((sum, l) => sum + l.points, 0);

  return {
    playerSlug: input.playerSlug,
    currentRank: 0, // TODO: look up from rankingsSnapshots
    projectedRank: 0, // TODO: re-rank entire tour with same scenario applied
    projectedPoints,
    breakdown: taken,
  };
}

export const RANKING_WINDOW = RANKING_WINDOW_WEEKS;
