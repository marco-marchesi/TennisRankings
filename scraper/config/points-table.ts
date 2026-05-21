// Canonical ATP points table per tournament category × round.
//
// Source: ATP Rulebook (current season), as cross-checked against the user-
// provided reference tables. WTA mirrors the ATP structure within each tier
// (same per-round values). Bump POINTS_TABLE_VERSION whenever a tier table
// changes so downstream consumers can spot a points-rule shift versus a
// data error.
//
// Rounds use a canonical short form:
//   "W"   = winner (champion)
//   "F"   = finalist (runner-up)
//   "SF"  = semifinal loser
//   "QF"  = quarterfinal loser
//   "R16" = round of 16 loser (a.k.a. fourth round at Slams)
//   "R32" = round of 32 loser
//   "R48" = round of 48 loser (only used at 48-draw CH50)
//   "R64" = round of 64 loser
//   "R128" = round of 128 loser (first-round loss at Slams)
//   "Q1"  = qualifying first round
//   "Q2"  = qualifying second round
//   "Q3"  = qualifying final (last loser before main draw)
//
// Notes on draw-size variants we deliberately don't model:
//   - ATP 500/250 events come in both 32-draw and 48-draw flavours. The
//     32-draw variant has 7 points more for Q3 / Q2 in 250 events; we always
//     use the 32-draw values since they're the modal case for the events
//     fixed-budgeted top-50 players play.
//   - Masters 1000 events come in both 96-draw (most) and 56-draw. Round-
//     reward values are identical; only qualifying differs in obscure ways.
//   - CH50 events with 48 draws add an R48 row worth 1 point. Modelled.

export const POINTS_TABLE_VERSION = "2024-01-revised-2026-05";

export type Round =
  | "W" | "F" | "SF" | "QF"
  | "R16" | "R32" | "R48" | "R64" | "R128"
  | "Q1" | "Q2" | "Q3";

export const ROUNDS_IN_ORDER: Round[] = [
  "Q1", "Q2", "Q3", "R128", "R64", "R48", "R32", "R16", "QF", "SF", "F", "W",
];

export type Category =
  // Top of the ladder
  | "grand_slam"
  | "masters_1000"
  | "atp_500"
  | "atp_250"
  // WTA equivalents (mirror ATP per-tier values)
  | "wta_1000"
  | "wta_500"
  | "wta_250"
  // Year-end championships and miscellany
  | "finals"
  | "olympics"
  | "davis_cup"
  // Challenger tour, modelled per prize-money tier
  | "ch_175"
  | "ch_125"
  | "ch_100"
  | "ch_75"
  | "ch_50"
  // ITF Futures, modelled per prize-money tier
  | "m25_futures"
  | "m15_futures";

type PointsByRound = Partial<Record<Round, number>>;

// ─── Top tier ─────────────────────────────────────────────────────────────

const SLAM_POINTS: PointsByRound = {
  W: 2000,
  F: 1300,
  SF: 800,
  QF: 400,
  R16: 200,
  R32: 100,
  R64: 50,
  R128: 10,
  Q3: 30,
  Q2: 16,
  Q1: 8,
};

const MASTERS_1000_POINTS: PointsByRound = {
  W: 1000,
  F: 650,
  SF: 400,
  QF: 200,
  R16: 100,
  R32: 50,
  R64: 30,
  R128: 10,
  Q3: 20,
  Q2: 10,
};

// ATP 500 / WTA 500 — defaults to 32-draw qualifying values.
const ATP_500_POINTS: PointsByRound = {
  W: 500,
  F: 330,
  SF: 200,
  QF: 100,
  R16: 50,
  R32: 25,
  Q3: 25,
  Q2: 13,
};

// ATP 250 / WTA 250 — defaults to 32-draw qualifying values.
const ATP_250_POINTS: PointsByRound = {
  W: 250,
  F: 165,
  SF: 100,
  QF: 50,
  R16: 25,
  R32: 13,
  Q3: 13,
  Q2: 7,
};

// ─── Year-end Finals ─────────────────────────────────────────────────────
//
// Round-robin scoring with bonuses. We approximate by using the maximum
// achievable totals at each "round equivalence", which is what a projection
// caller actually wants: "if they win out, how much".
//   W  = 600 RR (3 wins) + 900 bonus (SF + F) = 1500
//   F  = 600 RR (3 wins) + 400 bonus (SF only) = 1000
//   SF = 400 RR + 0 bonus (lost SF) ≈ 400
//   QF = ~1 RR win = 200 (a player who finished 3rd in the group and didn't
//        advance still earned per-match points)
const FINALS_POINTS: PointsByRound = {
  W: 1500,
  F: 1000,
  SF: 400,
  QF: 200,
};

// ─── ATP Challenger Tour — five distinct prize-money tiers ──────────────

const CH_175_POINTS: PointsByRound = {
  W: 175, F: 90, SF: 50, QF: 25, R16: 13, R32: 6,
};

const CH_125_POINTS: PointsByRound = {
  W: 125, F: 64, SF: 35, QF: 16, R16: 8, R32: 5,
};

const CH_100_POINTS: PointsByRound = {
  W: 100, F: 50, SF: 25, QF: 14, R16: 7, R32: 4,
};

const CH_75_POINTS: PointsByRound = {
  W: 75, F: 44, SF: 22, QF: 12, R16: 6, R32: 0,
};

const CH_50_POINTS: PointsByRound = {
  W: 50, F: 25, SF: 14, QF: 8, R16: 4, R32: 3, R48: 1,
};

// ─── ITF Futures ────────────────────────────────────────────────────────

const M25_POINTS: PointsByRound = {
  W: 25, F: 16, SF: 8, QF: 3,
};

const M15_POINTS: PointsByRound = {
  W: 15, F: 8, SF: 4, QF: 2,
};

// ─── Olympics & Davis Cup ──────────────────────────────────────────────
//
// Olympics historically awards 750 to the gold medallist plus stepped rewards
// for medal positions. Davis Cup uses per-rubber awards that vary by tie
// round and opponent rank — modelled here only at a coarse W/F/SF/QF for
// approximation purposes.

const OLYMPICS_POINTS: PointsByRound = {
  W: 750,
  F: 450,
  SF: 340,
  QF: 215,
  R16: 110,
  R32: 55,
  R64: 10,
};

const DAVIS_CUP_POINTS: PointsByRound = {
  W: 200, F: 120, SF: 75, QF: 50,
};

// ─── Lookup table ──────────────────────────────────────────────────────

const POINTS: Record<Category, PointsByRound> = {
  grand_slam: SLAM_POINTS,
  masters_1000: MASTERS_1000_POINTS,
  atp_500: ATP_500_POINTS,
  atp_250: ATP_250_POINTS,
  wta_1000: MASTERS_1000_POINTS,
  wta_500: ATP_500_POINTS,
  wta_250: ATP_250_POINTS,
  finals: FINALS_POINTS,
  ch_175: CH_175_POINTS,
  ch_125: CH_125_POINTS,
  ch_100: CH_100_POINTS,
  ch_75: CH_75_POINTS,
  ch_50: CH_50_POINTS,
  m25_futures: M25_POINTS,
  m15_futures: M15_POINTS,
  olympics: OLYMPICS_POINTS,
  davis_cup: DAVIS_CUP_POINTS,
};

/**
 * Points awarded to a player who reached `round` at a tournament of the
 * given `category`. Returns 0 if the round is not defined for that category
 * (e.g. an R48 query against an event that doesn't have an R48 layer).
 */
export function pointsForRound(category: Category, round: Round): number {
  return POINTS[category][round] ?? 0;
}

/**
 * The maximum points achievable if a player still alive in the draw goes on
 * to win the title. Equal to `pointsForRound(category, "W")`.
 */
export function maxPointsForCategory(category: Category): number {
  return pointsForRound(category, "W");
}
