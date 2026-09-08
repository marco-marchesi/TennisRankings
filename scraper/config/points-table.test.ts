import { describe, it, expect } from "vitest";
import {
  ALL_ROUNDS,
  canonicalizeRound,
  ROUNDS_IN_ORDER,
  finalsPoints,
  maxPointsForCategory,
  pointsForRound,
  qualifierBonus,
  type Category,
  type Round,
} from "./points-table";

/**
 * Every numeric assertion here is transcribed from `docs/ranking-rules.md`,
 * with the source line number in the test name. That makes the rules digest
 * the executable spec: correcting the doc means a failing test, and a table
 * edit that contradicts the doc cannot land silently.
 *
 * The ATP/WTA divergence is the point of most of this file. Three WTA tiers
 * used to alias the ATP tables outright, so every WTA player's points were
 * computed with men's values.
 */

// Main-draw rounds only, deepest first. Q-rounds are a separate ladder.
const MAIN_DRAW_DESC: Round[] = ["W", "F", "SF", "QF", "R16", "R32", "R64", "R128"];

describe("points table — Grand Slams differ between tours", () => {
  // docs/ranking-rules.md:33-48 (ATP) vs :272-287 (WTA)
  it("docs:37-44 + :274-283 — W and F coincide, everything below diverges", () => {
    expect(pointsForRound("grand_slam", "W")).toBe(2000);
    expect(pointsForRound("wta_grand_slam", "W")).toBe(2000);
    expect(pointsForRound("grand_slam", "F")).toBe(1300);
    expect(pointsForRound("wta_grand_slam", "F")).toBe(1300);
  });

  it.each([
    ["SF", 800, 780],
    ["QF", 400, 430],
    ["R16", 200, 240],
    ["R32", 100, 130],
    ["R64", 50, 70],
  ] as const)("docs:477-481 — %s: ATP %i, WTA %i", (round, atp, wta) => {
    expect(pointsForRound("grand_slam", round)).toBe(atp);
    expect(pointsForRound("wta_grand_slam", round)).toBe(wta);
  });

  it("docs:44 + :283 — a first-round loss is 10 on both tours", () => {
    expect(pointsForRound("grand_slam", "R128")).toBe(10);
    expect(pointsForRound("wta_grand_slam", "R128")).toBe(10);
  });

  it("docs:48 vs :287 — ATP Q1 loss scores 0, WTA Q1 loss scores 2", () => {
    expect(pointsForRound("grand_slam", "Q1")).toBe(0);
    expect(pointsForRound("wta_grand_slam", "Q1")).toBe(2);
  });
});

describe("points table — 1000-level differs between tours", () => {
  // docs/ranking-rules.md:54-63 (ATP) vs :303-315 (WTA combined)
  it("docs:56-57 + :305-306 — W and F coincide", () => {
    expect(pointsForRound("masters_1000", "W")).toBe(1000);
    expect(pointsForRound("wta_1000", "W")).toBe(1000);
    expect(pointsForRound("masters_1000", "F")).toBe(650);
    expect(pointsForRound("wta_1000", "F")).toBe(650);
  });

  it.each([
    ["SF", 400, 390],
    ["QF", 200, 215],
    ["R16", 100, 120],
    ["R32", 50, 65],
    ["R64", 30, 35],
  ] as const)("docs:58-62 vs :307-311 — %s: ATP %i, WTA %i", (round, atp, wta) => {
    expect(pointsForRound("masters_1000", round)).toBe(atp);
    expect(pointsForRound("wta_1000", round)).toBe(wta);
  });

  // docs/ranking-rules.md:317-332 — Doha, Dubai, Wuhan pay less because they
  // occupy a separate "best 1 of 3" slot.
  it("docs:319-329 — non-combined WTA 1000 tops out at 900, not 1000", () => {
    expect(pointsForRound("wta_1000_nc", "W")).toBe(900);
    expect(pointsForRound("wta_1000_nc", "F")).toBe(585);
    expect(pointsForRound("wta_1000_nc", "SF")).toBe(350);
    expect(pointsForRound("wta_1000_nc", "QF")).toBe(190);
    expect(pointsForRound("wta_1000_nc", "R16")).toBe(105);
    expect(pointsForRound("wta_1000_nc", "R32")).toBe(60);
  });
});

describe("points table — 500 and 250 differ between tours", () => {
  it.each([
    ["W", 500, 500],
    ["F", 330, 325],
    ["SF", 200, 195],
    ["QF", 100, 108],
    ["R16", 50, 60],
  ] as const)("docs:74-78 vs :336-342 — 500 %s: ATP %i, WTA %i", (round, atp, wta) => {
    expect(pointsForRound("atp_500", round)).toBe(atp);
    expect(pointsForRound("wta_500", round)).toBe(wta);
  });

  it.each([
    ["W", 250, 250],
    ["F", 165, 163],
    ["SF", 100, 98],
    ["QF", 50, 54],
    ["R16", 25, 30],
  ] as const)("docs:89-93 vs :350-356 — 250 %s: ATP %i, WTA %i", (round, atp, wta) => {
    expect(pointsForRound("atp_250", round)).toBe(atp);
    expect(pointsForRound("wta_250", round)).toBe(wta);
  });

  /**
   * The single largest per-match divergence at tour level. A main-draw
   * first-round loss at a 32-draw WTA 500 or 250 earns ONE point, where the
   * ATP pays 25 and 13. Because wta_500/wta_250 aliased the ATP tables, every
   * WTA first-round exit was credited 25x / 13x too much.
   */
  it("docs:343 + :357 — WTA R32 is 1 point; ATP pays 25 (500) and 13 (250)", () => {
    expect(pointsForRound("wta_500", "R32")).toBe(1);
    expect(pointsForRound("wta_250", "R32")).toBe(1);
    expect(pointsForRound("atp_500", "R32")).toBe(25);
    expect(pointsForRound("atp_250", "R32")).toBe(13);
  });

  // docs/ranking-rules.md:362-371 — previously not a category at all, so
  // these events inferred as wta_250 and paid double at the winner slot.
  it("docs:366-371 — wta_125 exists and tops out at 125", () => {
    expect(pointsForRound("wta_125", "W")).toBe(125);
    expect(pointsForRound("wta_125", "F")).toBe(81);
    expect(pointsForRound("wta_125", "SF")).toBe(49);
    expect(pointsForRound("wta_125", "QF")).toBe(27);
    expect(pointsForRound("wta_125", "R16")).toBe(15);
    expect(pointsForRound("wta_250", "W")).toBe(250);
  });
});

describe("points table — draw-size variants", () => {
  // docs/ranking-rules.md:52-63 — 96-draw vs 56-draw Masters.
  it("docs:62 — 56-draw Masters R64 pays 25, 96-draw pays 30", () => {
    expect(pointsForRound("masters_1000", "R64", "d96")).toBe(30);
    expect(pointsForRound("masters_1000", "R64", "d56")).toBe(25);
    expect(pointsForRound("masters_1000", "R64")).toBe(30);
  });

  it("docs:63 — a 56-draw Masters has no R128 layer at all", () => {
    expect(pointsForRound("masters_1000", "R128", "d96")).toBe(10);
    expect(pointsForRound("masters_1000", "R128", "d56")).toBe(0);
  });

  it("docs:311 — 56-draw WTA 1000 R64 pays 10, 96-draw pays 35", () => {
    expect(pointsForRound("wta_1000", "R64", "d96")).toBe(35);
    expect(pointsForRound("wta_1000", "R64", "d56")).toBe(10);
  });

  /**
   * A 48-draw 500/250 has an R64 layer; a 32-draw does not. Without these
   * rows a 48-draw first-round loss scored 0 rather than 16 / 8.
   */
  it("docs:80 + :95 — 48-draw R64 pays 16 (500) and 8 (250)", () => {
    expect(pointsForRound("atp_500", "R64", "d48")).toBe(16);
    expect(pointsForRound("atp_250", "R64", "d48")).toBe(8);
    expect(pointsForRound("atp_500", "R64", "d32")).toBe(0);
  });
});

describe("points table — events that award nothing", () => {
  /**
   * docs/ranking-rules.md:143 and :487. This table used to pay
   * 200/120/75/50, so every Davis Cup / BJK Cup rubber inflated both live
   * points and derived dropping points.
   */
  it("docs:143 — Davis Cup has awarded no ranking points since 2016", () => {
    for (const round of MAIN_DRAW_DESC) {
      expect(pointsForRound("davis_cup", round)).toBe(0);
    }
    expect(maxPointsForCategory("davis_cup")).toBe(0);
  });

  /**
   * Olympic points are awarded by medal, only when the tour approves them
   * for that Games. The WTA did for Paris 2024; the ATP did not. The old flat
   * table paid ATP players 750 for gold.
   */
  it("docs:467 — Olympics awards nothing by default", () => {
    expect(pointsForRound("olympics", "W")).toBe(0);
    expect(pointsForRound("olympics", "F")).toBe(0);
  });

  it("docs:467 — the WTA 2024 medal values are opt-in via the variant", () => {
    expect(pointsForRound("olympics", "W", "d64")).toBe(750);
    expect(pointsForRound("olympics", "F", "d64")).toBe(450);
    expect(pointsForRound("olympics", "SF", "d64")).toBe(375);
  });
});

describe("finals — additive round-robin scoring", () => {
  /**
   * docs/ranking-rules.md:100-112. The old model was a step function keyed on
   * "round reached" (W 1500 / F 1000 / SF 400 / QF 200), which could not
   * distinguish a 2-RR-win group exit (400) from a semifinal loser (600).
   */
  it("docs:107 — undefeated champion scores 1500", () => {
    expect(finalsPoints({ rrWins: 3, wonSf: true, wonFinal: true })).toBe(1500);
  });

  it("docs:108 — runner-up with 3 RR wins scores 1000", () => {
    expect(finalsPoints({ rrWins: 3, wonSf: true, wonFinal: false })).toBe(1000);
  });

  it("docs:109 — SF loser with 3 RR wins scores 600 (not 1000)", () => {
    expect(finalsPoints({ rrWins: 3, wonSf: false, wonFinal: false })).toBe(600);
  });

  it("docs:110-112 — group-stage exits score 200 per RR win", () => {
    expect(finalsPoints({ rrWins: 2, wonSf: false, wonFinal: false })).toBe(400);
    expect(finalsPoints({ rrWins: 1, wonSf: false, wonFinal: false })).toBe(200);
    expect(finalsPoints({ rrWins: 0, wonSf: false, wonFinal: false })).toBe(0);
  });

  it("distinguishes a 2-RR-win group exit from a semifinal loser", () => {
    const groupExit = finalsPoints({ rrWins: 2, wonSf: false, wonFinal: false });
    const sfLoser = finalsPoints({ rrWins: 3, wonSf: false, wonFinal: false });
    expect(groupExit).not.toBe(sfLoser);
  });
});

describe("round ladder", () => {
  /**
   * R48 exists only at 48-draw CH50 events. It used to sit in
   * ROUNDS_IN_ORDER between R64 and R32, and the derivers advance a winner
   * with ROUNDS_IN_ORDER[idx + 1] — so every R64 winner was credited "R48",
   * worth 0 points in every category except ch_50.
   */
  it("R48 is absent from the progression ladder but valid as a label", () => {
    expect(ROUNDS_IN_ORDER).not.toContain("R48");
    expect(ALL_ROUNDS).toContain("R48");
    expect(pointsForRound("ch_50", "R48")).toBe(1);
  });

  it("advancing from R64 lands on R32, not a phantom round", () => {
    const idx = ROUNDS_IN_ORDER.indexOf("R64");
    expect(idx).toBeGreaterThanOrEqual(0);
    expect(ROUNDS_IN_ORDER[idx + 1]).toBe("R32");
    expect(pointsForRound("grand_slam", ROUNDS_IN_ORDER[idx + 1]!)).toBe(100);
  });

  it("is ordered shallow to deep and ends at the title", () => {
    expect(ROUNDS_IN_ORDER[ROUNDS_IN_ORDER.length - 1]).toBe("W");
    const r128 = ROUNDS_IN_ORDER.indexOf("R128");
    const qf = ROUNDS_IN_ORDER.indexOf("QF");
    expect(r128).toBeLessThan(qf);
  });
});

describe("points table — structural invariants", () => {
  const TOUR_LEVEL: Category[] = [
    "grand_slam",
    "wta_grand_slam",
    "masters_1000",
    "wta_1000",
    "wta_1000_nc",
    "atp_500",
    "wta_500",
    "atp_250",
    "wta_250",
    "wta_125",
    "ch_175",
    "ch_125",
    "ch_100",
  ];

  /**
   * Going deeper into a draw must never be worth less. A violation means a
   * transcription error, and it would let a player lose points by winning.
   */
  it.each(TOUR_LEVEL)("%s pays strictly more for every deeper round", (category) => {
    const defined = MAIN_DRAW_DESC.filter((r) => pointsForRound(category, r) > 0);
    for (let i = 0; i < defined.length - 1; i++) {
      const deeper = pointsForRound(category, defined[i]!);
      const shallower = pointsForRound(category, defined[i + 1]!);
      expect(
        deeper,
        `${category}: ${defined[i]}=${deeper} must exceed ${defined[i + 1]}=${shallower}`,
      ).toBeGreaterThan(shallower);
    }
  });

  it.each(TOUR_LEVEL)("%s has a winner reward equal to maxPointsForCategory", (category) => {
    expect(maxPointsForCategory(category)).toBe(pointsForRound(category, "W"));
    expect(maxPointsForCategory(category)).toBeGreaterThan(0);
  });

  it("returns 0 rather than throwing for a round a tier does not have", () => {
    expect(pointsForRound("atp_250", "R128")).toBe(0);
    expect(pointsForRound("wta_125", "R64")).toBe(0);
  });
});

describe("qualifying round labels", () => {
  /**
   * TennisExplorer emits "Q-1R" / "Q-2R" / "Q-3R" — confirmed live in
   * player_recent_matches for the 2026 US Open, where qualifying accounts for
   * ~118 ATP and ~117 WTA players. These matched nothing and returned null,
   * which was safe (skipped, not mis-scored) but under-credited every
   * qualifying result at a depth where those points count.
   */
  it.each([
    ["Q-1R", "Q1"],
    ["Q-2R", "Q2"],
    ["Q-3R", "Q3"],
    ["Q1", "Q1"],
    ["Q3", "Q3"],
    ["Q 2", "Q2"],
    ["qual-3", "Q3"],
  ] as const)("canonicalizes %s to %s", (raw, expected) => {
    expect(canonicalizeRound(raw, "grand_slam")).toBe(expected);
  });

  it("docs:46-48 — slam Q3/Q2/Q1 losers earn 16 / 8 / 0 (ATP)", () => {
    expect(pointsForRound("grand_slam", canonicalizeRound("Q-3R", "grand_slam")!)).toBe(16);
    expect(pointsForRound("grand_slam", canonicalizeRound("Q-2R", "grand_slam")!)).toBe(8);
    expect(pointsForRound("grand_slam", canonicalizeRound("Q-1R", "grand_slam")!)).toBe(0);
  });

  it("docs:285-287 — WTA slam Q losers earn 30 / 20 / 2", () => {
    expect(pointsForRound("wta_grand_slam", canonicalizeRound("Q-3R", "wta_grand_slam")!)).toBe(30);
    expect(pointsForRound("wta_grand_slam", canonicalizeRound("Q-2R", "wta_grand_slam")!)).toBe(20);
    expect(pointsForRound("wta_grand_slam", canonicalizeRound("Q-1R", "wta_grand_slam")!)).toBe(2);
  });

  /**
   * The critical guard: a qualifying label must never be read as a main-draw
   * round. "Q-1R" parsing as round 1 would credit a qualifying loser with 10
   * points at a slam.
   */
  it("never resolves a qualifying label to a main-draw round", () => {
    for (const raw of ["Q-1R", "Q-2R", "Q-3R", "Q1", "Q2", "Q3"]) {
      const r = canonicalizeRound(raw, "grand_slam");
      expect(r).toMatch(/^Q[123]$/);
      expect(["R128", "R64", "R32", "R16"]).not.toContain(r);
    }
  });

  it("still resolves main-draw round numbers correctly", () => {
    expect(canonicalizeRound("1R", "grand_slam")).toBe("R128");
    expect(canonicalizeRound("2R", "grand_slam")).toBe("R64");
  });
});

describe("qualifier bonus", () => {
  // docs/ranking-rules.md:45 (ATP 25) and :284 (WTA 40).
  it("docs:45 + :284 — slam qualifying winner earns 25 (ATP) / 40 (WTA)", () => {
    expect(qualifierBonus("grand_slam")).toBe(25);
    expect(qualifierBonus("wta_grand_slam")).toBe(40);
  });

  it("docs:96 — an ATP 250 qualifying winner earns 12", () => {
    expect(qualifierBonus("atp_250")).toBe(12);
  });

  it("is zero for tiers where it does not apply", () => {
    expect(qualifierBonus("davis_cup")).toBe(0);
    expect(qualifierBonus("finals")).toBe(0);
  });
});
