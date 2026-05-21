import { describe, it, expect } from "vitest";
import { computeProjection } from "./calculator";

describe("computeProjection", () => {
  describe("not_playing", () => {
    it("delta == -dropping when no nextBest backfill", () => {
      const r = computeProjection({
        currentPoints: 4710,
        droppingPoints: 250,
        status: "not_playing",
      });
      expect(r.pointsDelta).toBe(-250);
      expect(r.nextPoints).toBe(4460);
      expect(r.maxPossiblePoints).toBeNull();
    });

    it("nextBest promotes to reduce the effective drop", () => {
      const r = computeProjection({
        currentPoints: 4000,
        droppingPoints: 200,
        nextBestPoints: 100,
        status: "not_playing",
      });
      // effectiveDrop = 200 - 100 = 100 → delta = -100, next = 3900
      expect(r.pointsDelta).toBe(-100);
      expect(r.nextPoints).toBe(3900);
    });

    it("clamps nextBest at dropping (a 500 nextBest can't fill a 200 slot fully into negative)", () => {
      const r = computeProjection({
        currentPoints: 5000,
        droppingPoints: 200,
        nextBestPoints: 500,
        status: "not_playing",
      });
      expect(Math.abs(r.pointsDelta)).toBe(0); // effectiveDrop = 0, no net change (could be -0)
      expect(r.nextPoints).toBe(5000);
    });
  });

  describe("in_progress at a Grand Slam (Alcaraz defending RG title)", () => {
    const base = {
      currentPoints: 11960,
      droppingPoints: 2000,
      status: "in_progress" as const,
      category: "grand_slam" as const,
    };

    it("advancing past R128 (will play R64): secured = R64 reward", () => {
      const r = computeProjection({ ...base, roundReached: "R64" });
      expect(r.pointsDelta).toBe(50 - 2000);
      expect(r.nextPoints).toBe(11960 + 50 - 2000);
      expect(r.maxPossiblePoints).toBe(11960 + 2000 - 2000);
    });

    it("Auger-Aliassime / Felix scenario: nextBest closes the gap", () => {
      const r = computeProjection({
        currentPoints: 4060,
        droppingPoints: 200,
        nextBestPoints: 100,
        status: "in_progress",
        category: "masters_1000",
        roundReached: "R64",
      });
      // R64 at Masters 1000 = 30 secured (per official ATP table);
      // effectiveDrop = 200 − 100 = 100 → delta = 30 − 100 = −70.
      expect(r.pointsDelta).toBe(30 - 100);
      expect(r.nextPoints).toBe(4060 - 70);
    });
  });

  describe("eliminated", () => {
    it("projected next is current + secured - effectiveDrop (no longer reverts to current)", () => {
      const r = computeProjection({
        currentPoints: 5705,
        droppingPoints: 200,
        status: "eliminated",
        category: "masters_1000",
        roundReached: "R32",
      });
      // R32 at Masters = 50; effectiveDrop = 200; delta = 50 - 200 = -150
      expect(r.pointsDelta).toBe(-150);
      expect(r.nextPoints).toBe(5555);
      expect(r.maxPossiblePoints).toBeNull();
    });
  });

  describe("won_tournament", () => {
    it("next == max == current + winnerReward - effectiveDrop", () => {
      const r = computeProjection({
        currentPoints: 3665,
        droppingPoints: 50,
        status: "won_tournament",
        category: "atp_500",
        roundReached: "W",
      });
      const expected = 3665 + 500 - 50;
      expect(r.nextPoints).toBe(expected);
      expect(r.maxPossiblePoints).toBe(expected);
      expect(r.pointsDelta).toBe(450);
    });
  });

  describe("missing inputs", () => {
    it("throws when in_progress is missing the category", () => {
      expect(() =>
        computeProjection({
          currentPoints: 5000,
          droppingPoints: 0,
          status: "in_progress",
          roundReached: "R16",
        }),
      ).toThrow();
    });

    it("throws when eliminated is missing the round", () => {
      expect(() =>
        computeProjection({
          currentPoints: 5000,
          droppingPoints: 0,
          status: "eliminated",
          category: "masters_1000",
        }),
      ).toThrow();
    });
  });
});
