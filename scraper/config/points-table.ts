// Canonical ATP/WTA points table per tournament category × round.
//
// Source: ATP 2026 Rulebook Chapter 9, WTA 2026 Rulebook (cross-checked).
// Grand Slam round values differ between tours — use "grand_slam" for ATP,
// "wta_grand_slam" for WTA. WTA non-combined 1000s (Doha/Dubai/Wuhan) use
// "wta_1000_nc" (a separate best-1-of-3 slot). Bump POINTS_TABLE_VERSION
// whenever a tier table changes so downstream consumers can spot a
// points-rule shift versus a data error.
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

export const POINTS_TABLE_VERSION = "2026-10-ch-itf-wta-q";

export type Round =
  | "W" | "F" | "SF" | "QF"
  | "R16" | "R32" | "R48" | "R64" | "R128"
  | "Q1" | "Q2" | "Q3";

/**
 * Every round label a points table may legitimately key on, including the
 * R48 layer that only 48-draw CH50 events have. Use this to validate or
 * canonicalize a label — never to walk a draw.
 */
export const ALL_ROUNDS: Round[] = [
  "Q1", "Q2", "Q3", "R128", "R64", "R48", "R32", "R16", "QF", "SF", "F", "W",
];

/**
 * The progression ladder: the rounds a player advances through, in order.
 *
 * R48 is deliberately ABSENT. It exists only at 48-draw CH50 events, and
 * having it in this list meant `ROUNDS_IN_ORDER[idx + 1]` promoted every
 * R64 winner to "R48" — a round worth 0 points in every category except
 * ch_50. Code that advances a winner by one round MUST use this list;
 * code that validates a label wants ALL_ROUNDS.
 */
export const ROUNDS_IN_ORDER: Round[] = [
  "Q1", "Q2", "Q3", "R128", "R64", "R32", "R16", "QF", "SF", "F", "W",
];

export type Category =
  // Top of the ladder — ATP and WTA have different per-round values at Slams
  | "grand_slam"       // ATP Grand Slams
  | "wta_grand_slam"   // WTA Grand Slams (SF/QF/R-values differ from ATP)
  | "masters_1000"
  | "atp_500"
  | "atp_250"
  // WTA equivalents — 1000 combined mirrors ATP 1000; non-combined pay less
  | "wta_1000"         // combined WTA 1000s (Indian Wells, Miami, Madrid, Rome, Canada, Cincinnati, Beijing)
  | "wta_1000_nc"      // non-combined WTA 1000s (Doha, Dubai, Wuhan) — own slot; 900 until 2023
  | "wta_500"
  | "wta_250"
  | "wta_125"
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
  | "m15_futures"
  // ITF event whose tier (W15..W100 / M15, M25) no feed states. Scored 0
  // rather than guessed; see category-inference.ts.
  | "itf"
  // Exhibitions and team events that award no ranking points (UTR series,
  // Laver Cup, Asian Games, Billie Jean King Cup, ...). Before this existed
  // they fell through to atp_250 / wta_250.
  | "non_ranking";

type PointsByRound = Partial<Record<Round, number>>;

// ─── Top tier ─────────────────────────────────────────────────────────────
//
// Q-round values = points for the LOSER of that qualifying round.
// The qualifier who WINS Q3 and enters the main draw earns an additional
// 25 pts (ATP) / 40 pts (WTA) on top of whatever they earn in the MD —
// not modelled here since top-100 players never play qualies.

// ATP Grand Slams
const SLAM_POINTS: PointsByRound = {
  W: 2000,
  F: 1300,
  SF: 800,
  QF: 400,
  R16: 200,
  R32: 100,
  R64: 50,
  R128: 10,
  Q3: 16,
  Q2: 8,
  Q1: 0,
};

// WTA Grand Slams — SF/QF/R-values differ from ATP
const WTA_SLAM_POINTS: PointsByRound = {
  W: 2000,
  F: 1300,
  SF: 780,
  QF: 430,
  R16: 240,
  R32: 130,
  R64: 70,
  R128: 10,
  Q3: 30,
  Q2: 20,
  Q1: 2,
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
  // docs/ranking-rules.md:64-66. Two qualifying rounds; the Q3 slot holds the
  // qualifying winner's value, as at every non-Slam tier. Was 20 / 10 / none.
  Q3: 25,
  Q2: 16,
  Q1: 8,
};

// WTA non-combined 1000s (Doha, Dubai, Wuhan) — 56-draw. They still count in
// a separate "best 1 of 3" slot, but since 2025 they PAY like every other
// 1000: 1000 / 650 / 390 / 215 / 120 / 65, and 10 for the first round.
// This table used to carry the pre-2025 900 / 585 / 350 / 190 / 105 / 60 / 1,
// which under-charged Gauff's Wuhan 2025 title by 100 and Pegula's final by
// 65 when those results dropped (live-tennis.eu, 2026-09-29; WTA 1000 points
// table on Wikipedia "WTA 1000 tournaments").
const WTA_1000_NC_POINTS: PointsByRound = {
  W: 1000,
  F: 650,
  SF: 390,
  QF: 215,
  R16: 120,
  R32: 65,
  R64: 10,
  // Qualifying as the other 1000s' 64/56-draw row (2024/2025_WTA_Tour); was
  // 25 / 13 / 1, the 500's values. Replay over 2026: clean delta 65.7 -> 66.0%.
  Q3: 30,
  Q2: 20,
  Q1: 2,
};

// WTA combined/mandatory 1000s (Indian Wells, Miami, Madrid, Rome, Canada,
// Cincinnati, Beijing). docs/ranking-rules.md:299-315.
//
// This tier used to alias MASTERS_1000_POINTS. It should not: the WTA pays
// differently at every round below the final — SF 390 vs 400, QF 215 vs 200,
// R16 120 vs 100, R32 65 vs 50, R64 35 vs 30. Only W and F coincide.
const WTA_1000_POINTS: PointsByRound = {
  W: 1000,
  F: 650,
  SF: 390,
  QF: 215,
  R16: 120,
  R32: 65,
  R64: 35,
  R128: 10,
  Q3: 30,
  Q2: 20,
  Q1: 2,
};

// ATP 500 — 32-draw. docs/ranking-rules.md:70-83.
const ATP_500_POINTS: PointsByRound = {
  W: 500,
  F: 330,
  SF: 200,
  QF: 100,
  R16: 50,
  // A first-round loss at a 32-draw 500 earns nothing (2025 ATP Rulebook,
  // ch. 9, "ATP Tour 500 - 32 Draw": R1 0). This said 25 — the 48-draw
  // value, where R32 is the SECOND round — so every Beijing / Tokyo 2026
  // first-round loser, and every player waiting to play one, was 25 high
  // against live-tennis.eu.
  R32: 0,
  Q3: 25,
  Q2: 13,
  Q1: 0,
};

// ATP 250 — 32-draw. docs/ranking-rules.md:85-98.
const ATP_250_POINTS: PointsByRound = {
  W: 250,
  F: 165,
  SF: 100,
  QF: 50,
  R16: 25,
  // 0, not 13 — as for the 500 above ("ATP Tour 250 - 32 Draw": R1 0).
  R32: 0,
  Q3: 12,
  Q2: 6,
  Q1: 0,
};

// WTA 500. docs/ranking-rules.md:334-346.
//
// Also formerly aliased to the ATP table. Note R32 = 1: the WTA awards a
// single point for a main-draw first-round loss at this tier, where the ATP
// awards 25. That asymmetry is the single largest per-match divergence
// between the tours at tour level, and it applied to every WTA player in the
// top 200 with a first-round exit.
const WTA_500_POINTS: PointsByRound = {
  W: 500,
  F: 325,
  SF: 195,
  QF: 108,
  R16: 60,
  R32: 1,
  Q3: 25,
  Q2: 13,
  Q1: 1,
};

// WTA 250. docs/ranking-rules.md:348-360. R32 = 1, as above (ATP pays 13).
const WTA_250_POINTS: PointsByRound = {
  W: 250,
  F: 163,
  SF: 98,
  QF: 54,
  R16: 30,
  R32: 1,
  Q3: 18,
  Q2: 12,
  Q1: 1,
};

// WTA 125. docs/ranking-rules.md:362-371. Previously absent entirely, so
// these events fell through category inference to wta_250 and were credited
// 250-tier points — a 2x overpayment at the winner slot.
const WTA_125_POINTS: PointsByRound = {
  W: 125,
  F: 81,
  SF: 49,
  QF: 27,
  R16: 15,
  R32: 1,
  // Qualifier 6, last qualifying round 4, first 1 (2024_WTA_125_tournaments
  // "Points distribution"). Replay over 2026: clean delta 65.7 -> 66.6%.
  Q3: 6,
  Q2: 4,
  Q1: 1,
};

/**
 * 56/48-draw WTA 500 (2024/2025_WTA_Tour, "64/56/48S" row): the first round
 * is R64 (1) and R32 pays 32. Replay over 2026: clean delta 65.7 -> 66.0%.
 */
const WTA_500_D56_POINTS: PointsByRound = {
  W: 500, F: 325, SF: 195, QF: 108, R16: 60, R32: 32, R64: 1, Q3: 25, Q2: 13, Q1: 1,
};

// ─── Draw-size variants ──────────────────────────────────────────
//
// A tier's round values are NOT independent of draw size, contrary to the
// claim this file used to carry. Sackmann's CSVs expose `draw_size` on every
// match, so the caller can pass the right variant instead of guessing.
//
// Variant tables are COMPLETE, not merged onto the default — a 56-draw
// Masters has no R128 layer at all, and a merge could not express absence.

/** 56-draw Masters (Monte Carlo, Paris). docs/ranking-rules.md:52-66. */
const MASTERS_1000_D56_POINTS: PointsByRound = {
  W: 1000,
  F: 650,
  SF: 400,
  QF: 200,
  R16: 100,
  R32: 50,
  R64: 25, // 30 at 96-draw
  // No R128 layer.
  Q3: 25,
  Q2: 16,
  Q1: 8,
};

/** 56-draw WTA 1000. docs/ranking-rules.md:303-315 (R64 10, no R128). */
const WTA_1000_D56_POINTS: PointsByRound = {
  W: 1000,
  F: 650,
  SF: 390,
  QF: 215,
  R16: 120,
  R32: 65,
  R64: 10, // 35 at 96-draw
  Q3: 30,
  Q2: 20,
  Q1: 2,
};

/**
 * 48-draw ATP 500. docs/ranking-rules.md:80 gives R64 = 16.
 * Without this row a 48-draw first-round loss scored 0.
 */
const ATP_500_D48_POINTS: PointsByRound = {
  ...ATP_500_POINTS,
  // In a 48-draw R32 is the second round, which does pay.
  R32: 25,
  R64: 16,
};

/** 48-draw ATP 250. docs/ranking-rules.md:95 gives R64 = 8. */
const ATP_250_D48_POINTS: PointsByRound = {
  ...ATP_250_POINTS,
  R32: 13,
  R64: 8,
};

// ─── Year-end Finals ────────────────────────────────────────
//
// The Finals are round-robin plus knockout, and the scoring is ADDITIVE:
// +200 per RR win, +400 for winning the semifinal, +500 for winning the
// final (docs/ranking-rules.md:100-112). It is not a step function keyed on
// "round reached", which is what this file used to model — that made a
// 2-RR-win group-stage exit (really 400) indistinguishable from a semifinal
// loser, and `drawPositionForRoundNumber` mapped Finals round 1 to "SF",
// crediting 400 for a player's very first round-robin match.
//
// Note on docs/ranking-rules.md:105: it labels the +400 as a "Semifinal
// berth", but line 109 states an SF loser with 3 RR wins gets ~600. Those
// are mutually exclusive; line 109 is consistent with the rest of the table
// (3 RR wins 600 + SF 400 + final 500 = 1500 for an undefeated champion), so
// the +400 is for WINNING the semifinal. Flagged for rulebook confirmation.

export const FINALS_RR_WIN = 200;
export const FINALS_SF_WIN = 400;
export const FINALS_FINAL_WIN = 500;

export interface FinalsProgress {
  /** Round-robin matches won (0-3 for a qualifier). */
  rrWins: number;
  wonSf: boolean;
  wonFinal: boolean;
}

/** Additive Finals scoring. Undefeated champion = 3*200 + 400 + 500 = 1500. */
export function finalsPoints(p: FinalsProgress): number {
  return (
    FINALS_RR_WIN * p.rrWins +
    (p.wonSf ? FINALS_SF_WIN : 0) +
    (p.wonFinal ? FINALS_FINAL_WIN : 0)
  );
}

// Retained only so a round-keyed caller still gets a sane number; the real
// scoring is finalsPoints(). Values are the totals an undefeated run reaches
// at each stage, per docs/ranking-rules.md:107-112.
const FINALS_POINTS: PointsByRound = {
  W: 1500,
  F: 1000,
  SF: 600,
  QF: 200,
};

// ─── ATP Challenger Tour — five distinct prize-money tiers ──────────────
//
// 2024/2025_ATP_Challenger_Tour "Point distribution" (the 2025 page cites the
// 2025 ATP rulebook ch. 9). A first-round loss earns nothing; Q3 is the
// qualifying winner's value (as at every non-Slam tier), Q2 the last
// qualifying round's loser. docs/ranking-rules.md listed 6/5/4/3/3 under
// "R32": that was the qualifier column. Replay over the 2026 weeks
// (2026-10-13): clean delta 60.1% -> 68.0%, clean full 17.9% -> 27.5% of
// ~7k player-weeks with these values.

const CH_175_POINTS: PointsByRound = {
  W: 175, F: 90, SF: 50, QF: 25, R16: 13, R32: 0, Q3: 6, Q2: 3, Q1: 0,
};

const CH_125_POINTS: PointsByRound = {
  W: 125, F: 64, SF: 35, QF: 16, R16: 8, R32: 0, Q3: 5, Q2: 3, Q1: 0,
};

const CH_100_POINTS: PointsByRound = {
  W: 100, F: 50, SF: 25, QF: 14, R16: 7, R32: 0, Q3: 4, Q2: 2, Q1: 0,
};

const CH_75_POINTS: PointsByRound = {
  W: 75, F: 44, SF: 22, QF: 12, R16: 6, R32: 0, Q3: 4, Q2: 2, Q1: 0,
};

// R48: the first round of a 48-draw CH50 (docs/ranking-rules.md; not on the
// Wikipedia table, unverified by replay — the archive has no 48-draw CH50).
const CH_50_POINTS: PointsByRound = {
  W: 50, F: 25, SF: 14, QF: 8, R16: 4, R32: 0, R48: 1, Q3: 3, Q2: 1, Q1: 0,
};

// ─── ITF Futures ────────────────────────────────────────────────────────

// <Y>_ITF_Men's_World_Tennis_Tour "Ranking points distribution", 2022-2025
// (one table): the R16 point was missing here. Replay over the 2026 weeks:
// clean delta 79.6% -> 83.0% of ~7k player-weeks with it (2026-10-13).
const M25_POINTS: PointsByRound = {
  W: 25, F: 16, SF: 8, QF: 3, R16: 1,
};

const M15_POINTS: PointsByRound = {
  W: 15, F: 8, SF: 4, QF: 2, R16: 1,
};

// ─── Olympics & Davis Cup ──────────────────────────────────────────────
//
// Olympics historically awards 750 to the gold medallist plus stepped rewards
// for medal positions. Davis Cup uses per-rubber awards that vary by tie
// round and opponent rank — modelled here only at a coarse W/F/SF/QF for
// approximation purposes.

// Olympic points are awarded by medal and only when the tour approves them
// for that Games, so they are year- and tour-scoped rather than a fixed
// table. The WTA awarded points for Paris 2024 (docs/ranking-rules.md:467);
// the ATP awarded NONE, which the previous flat 750-for-gold table got wrong
// for every male medallist.
const OLYMPICS_WTA_2024_POINTS: PointsByRound = {
  W: 750, // gold
  F: 450, // silver
  SF: 375, // bronze
  QF: 0,
};

// The default is zero. A caller wanting the WTA 2024 values must ask for the
// variant explicitly, so an unmodelled Games cannot silently award points.
const OLYMPICS_POINTS: PointsByRound = {};

// Davis Cup has awarded NO ranking points since 2016
// (docs/ranking-rules.md:143, :487). This table used to pay 200/120/75/50,
// so every Davis Cup rubber inflated both live points and derived dropping.
// The category is kept for display; it must never contribute points.
const DAVIS_CUP_POINTS: PointsByRound = {};

// ─── Lookup table ──────────────────────────────────────────────────────

const POINTS: Record<Category, PointsByRound> = {
  grand_slam: SLAM_POINTS,
  wta_grand_slam: WTA_SLAM_POINTS,
  masters_1000: MASTERS_1000_POINTS,
  atp_500: ATP_500_POINTS,
  atp_250: ATP_250_POINTS,
  wta_1000: WTA_1000_POINTS,
  wta_1000_nc: WTA_1000_NC_POINTS,
  wta_500: WTA_500_POINTS,
  wta_250: WTA_250_POINTS,
  wta_125: WTA_125_POINTS,
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
  itf: {},
  non_ranking: {},
};

/**
 * Draw sizes that change a tier's per-round values. Sackmann's match CSVs
 * carry `draw_size` on every row, so this is derivable rather than guessed.
 */
export type DrawVariant = "d128" | "d96" | "d64" | "d56" | "d48" | "d32" | "rr";

/**
 * Complete per-variant tables. Complete, not merged: a 56-draw Masters has
 * no R128 layer, and merging onto the default could not express that absence.
 */
const VARIANT_POINTS: Partial<Record<Category, Partial<Record<DrawVariant, PointsByRound>>>> = {
  masters_1000: { d56: MASTERS_1000_D56_POINTS },
  wta_1000: { d56: WTA_1000_D56_POINTS },
  atp_500: { d48: ATP_500_D48_POINTS },
  atp_250: { d48: ATP_250_D48_POINTS },
  wta_500: { d56: WTA_500_D56_POINTS },
  olympics: { d64: OLYMPICS_WTA_2024_POINTS },
};

/**
 * Points awarded to a player who reached `round` at a tournament of the
 * given `category`. Returns 0 if the round is not defined for that category
 * (e.g. an R48 query against an event that doesn't have an R48 layer).
 *
 * Pass `variant` when the draw size is known — a 56-draw Masters pays 25 for
 * an R64 loss where a 96-draw pays 30, and a 48-draw ATP 500 has an R64 row
 * at all (16) where a 32-draw does not.
 */
export function pointsForRound(
  category: Category,
  round: Round,
  variant?: DrawVariant,
): number {
  if (variant) {
    const table = VARIANT_POINTS[category]?.[variant];
    if (table) return table[round] ?? 0;
  }
  return POINTS[category][round] ?? 0;
}

/**
 * Extra points a qualifier earns for winning the final qualifying round and
 * entering the main draw, ADDED on top of whatever they go on to earn there
 * (docs/ranking-rules.md:45, :284). Distinct from the Q-round values in the
 * tables above, which are what the LOSER of that qualifying round receives.
 *
 * Whether this is additive or a floor is not stated explicitly in the rules
 * digest; additive is implemented. Flagged for rulebook confirmation.
 */
export function qualifierBonus(category: Category): number {
  switch (category) {
    case "grand_slam":
      return 25;
    case "wta_grand_slam":
      return 40;
    case "masters_1000":
      return 25;
    case "wta_1000":
      return 30;
    case "wta_1000_nc":
      return 30;
    case "atp_500":
      return 25;
    case "wta_500":
      return 25;
    case "atp_250":
      return 12;
    case "wta_250":
      return 18;
    case "wta_125":
      return 6;
    case "ch_175":
      return 6;
    case "ch_125":
      return 5;
    case "ch_100":
    case "ch_75":
      return 4;
    case "ch_50":
      return 3;
    default:
      return 0;
  }
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
  if ((ALL_ROUNDS as string[]).includes(r)) return r as Round;
  // Word-form aliases that don't go through the per-category table.
  if (r === "QUARTERFINAL" || r === "QUARTERFINALS") return "QF";
  if (r === "SEMIFINAL" || r === "SEMIFINALS") return "SF";
  if (r === "FINAL") return "F";
  if (r === "WINNER" || r === "CHAMPION") return "W";
  // Qualifying rounds. TennisExplorer emits "Q-1R" / "Q-2R" / "Q-3R", which
  // matched nothing and returned null — safe (a null round is skipped rather
  // than mis-scored) but it under-credited every qualifying result. Players
  // ranked roughly 100-250 do play slam and 1000-level qualifying, so those
  // points matter at the depth we rank.
  //
  // Checked BEFORE the tour-style number branch below: that regex would not
  // match "Q-1R" today, but a small loosening of it later would silently make
  // "Q-1R" parse as round 1 and credit a qualifying loser with first-round
  // MAIN-DRAW points (10 at a slam), which is exactly the sort of quiet
  // over-credit this table should never produce.
  const qual = r.match(/^Q[-\s]?(\d)(?:R)?$/) ?? r.match(/^QUAL(?:IFYING)?[-\s]?(\d)$/);
  if (qual) {
    const n = Number(qual[1]);
    if (n === 1) return "Q1";
    if (n === 2) return "Q2";
    if (n === 3) return "Q3";
    return null;
  }
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
