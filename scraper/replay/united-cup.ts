// United Cup ranking points: earned per match, not per round reached.
//
// Sources (Wikipedia raw wikitext, accessed 2026-10-13, "ATP / WTA ranking
// points"; each cites unitedcup.com "Prize Money & Ranking Points" or the ATP
// rulebook ch. 4):
//   <Y>_United_Cup, Y = 2024, 2025, 2026 — one per-win table, by stage and
//   the opponent's rank, maximum 500. 2024 adds for the WTA: 5 wins = 500,
//   4 wins at least 325. From 2025 the WTA pays by number of wins instead.
// 2023 used the same table with "host city finals" for the quarter-final
// row, but the archive tags those matches "RR", so a 2023 win cannot be
// placed: unsourced. 2022 and before was the ATP Cup (another table).
import type { Season } from "./points-eras";
import type { Tour } from "./types";

export type UnitedCupStage = "RR" | "QF" | "SF" | "F";

export interface UnitedCupMatch {
  stage: UnitedCupStage;
  won: boolean;
  /** The opponent's ranking entering the event; null = unranked or missing. */
  oppRank: number | null;
}

/** Rank bands: 1-10, 11-20, 21-30, 31-50, 51-100, 101-250, 251+. */
const BAND_TOP = [10, 20, 30, 50, 100, 250];

const PER_WIN: Record<UnitedCupStage, number[]> = {
  F: [180, 140, 120, 90, 60, 40, 35],
  SF: [130, 105, 90, 60, 40, 35, 25],
  QF: [80, 65, 55, 40, 35, 25, 20],
  RR: [55, 45, 40, 35, 25, 20, 15],
};

/** null when the opponent has no rank: no page says which band that is. */
function perWin(m: UnitedCupMatch): number | null {
  if (m.oppRank == null) return null;
  const band = BAND_TOP.findIndex((top) => m.oppRank! <= top);
  return PER_WIN[m.stage][band < 0 ? BAND_TOP.length : band]!;
}

/** A player's United Cup points, or null when no source covers the season. */
export function unitedCupPoints(tour: Tour, season: Season, matches: UnitedCupMatch[]): number | null {
  if (season < 2024) return null;
  const wins = matches.filter((m) => m.won);
  if (tour === "wta" && season >= 2025) {
    const ko = wins.some((m) => m.stage !== "RR");
    switch (wins.length) {
      case 0:
        return 1;
      case 1:
        return ko ? 60 : 32;
      case 2:
        return ko ? 108 : 90;
      case 3:
        return 150;
      case 4:
        return 325;
      default:
        return 500;
    }
  }
  if (tour === "wta" && wins.length >= 5) return 500;
  const each = wins.map(perWin);
  if (each.some((p) => p == null)) return null;
  const sum = Math.min(500, each.reduce<number>((s, p) => s + p!, 0));
  if (tour === "wta") {
    if (wins.length >= 5) return 500;
    if (wins.length === 4) return Math.max(325, sum);
  }
  return sum;
}
