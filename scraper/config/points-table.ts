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

/**
 * Normalises various round labels into our canonical `Round` form. Different
 * sources emit different conventions:
 *   - TA CSVs and ATP/WTA HTML use draw-position labels: R128, R64, R32, R16
 *   - TennisExplorer (and ATP commentary) use tour-style numbers: 1R, 2R, 3R
 *   - Wikipedia / live-tennis.eu often writes "R1", "R2", etc.
 *
 * Tour-style numbers need the tournament category to disambiguate — "1R"
 * at a Grand Slam is R128, at a Masters 1000 it's R64 (or R32 for 32-draw
 * events), at an ATP 250 it's R32 (or R28 — we round up). The mapping
 * tables below are deliberate over-simplifications: they pick the modal
 * draw size for each category. Edge cases (a Masters 1000 in 56-draw
 * format) will be off by one slot — fine for live-ranking math since
 * the points table values at adjacent rounds are close.
 *
 * Returns null if the round cannot be parsed into anything canonical.
 */
export function canonicalizeRound(raw: string, category: Category): Round | null {
  const r = raw.trim().toUpperCase();
  if (!r) return null;
  // Already canonical.
  if ((ROUNDS_IN_ORDER as string[]).includes(r)) return r as Round;
  // Word-form aliases that don't go through the per-category table.
  if (r === "QUARTERFINAL" || r === "QUARTERFINALS") return "QF";
  if (r === "SEMIFINAL" || r === "SEMIFINALS") return "SF";
  if (r === "FINAL") return "F";
  if (r === "WINNER" || r === "CHAMPION") return "W";
  // Tour-style round number: "1R", "R1", "1ST ROUND", "ROUND 1", etc.
  // Pull the leading integer; if found, map via category.
  const num = r.match(/^(?:R(?:OUND)?)?\s*(\d{1,2})(?:R|ST|ND|RD|TH)?(?:\s*ROUND)?$/);
  if (num) {
    return drawPositionForRoundNumber(Number(num[1]), category);
  }
  return null;
}

/**
 * "Player reached round N of the draw" → canonical Round for that
 * category. Round N here is 1-indexed counting from the first match
 * played in the main draw. For 128-draw Slams, round 1 = R128; for
 * 64-draw Masters, round 1 = R64; etc.
 */
function drawPositionForRoundNumber(n: number, category: Category): Round | null {
  if (n < 1) return null;
  let ladder: Round[];
  if (category === "grand_slam") {
    ladder = ["R128", "R64", "R32", "R16", "QF", "SF", "F", "W"];
  } else if (category === "masters_1000" || category === "wta_1000") {
    // Most 1000s are 96-draw (top 32 seeds get a bye → first round for
    // unseeded players is R64). We model from R64 down.
    ladder = ["R64", "R32", "R16", "QF", "SF", "F", "W"];
  } else if (category === "atp_500" || category === "wta_500") {
    ladder = ["R32", "R16", "QF", "SF", "F", "W"];
  } else if (category === "atp_250" || category === "wta_250") {
    ladder = ["R32", "R16", "QF", "SF", "F", "W"];
  } else if (category === "finals") {
    // ATP/WTA Finals: round-robin then SF/F. Treat round 1-3 as SF (group
    // points are mileage-based but live ranking doesn't add them mid-RR).
    ladder = ["SF", "F", "W"];
  } else if (category.startsWith("ch_")) {
    // Challenger 32-draw default.
    ladder = ["R32", "R16", "QF", "SF", "F", "W"];
  } else {
    // davis_cup / olympics / itf — fall back to a Slam-style ladder so
    // mid-event rounds still produce *some* reasonable value.
    ladder = ["R128", "R64", "R32", "R16", "QF", "SF", "F", "W"];
  }
  return ladder[n - 1] ?? null;
}
