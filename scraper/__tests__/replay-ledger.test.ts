import { describe, expect, it } from "vitest";
import { indexByPlayer, ledgerFor } from "@scraper/replay/ledger";
import { countingRules, DEFAULT_VARIANT } from "@scraper/replay/rules";
import type { PlayerResult } from "@scraper/replay/types";

const r = (points: number, entryWeek: string, over: Partial<PlayerResult> = {}): PlayerResult => ({
  playerId: "p", editionKey: `e${points}${entryWeek}`, editionName: "x", points, category: null, mainDraw: true, entryWeek,
  expiryWeek: "2026-01-05", isFinals: false, gaps: [], ...over,
});

const c = (points: number, category: PlayerResult["category"], name = "x", over: Partial<PlayerResult> = {}) =>
  r(points, "2025-01-06", { category, editionName: name, editionKey: `${name}${points}${Math.random()}`, ...over });

describe("countingRules", () => {
  it("counts 19 ATP results through 2025 and 18 from the 2026 season", () => {
    // docs/ranking-rules.md:17-27
    expect(countingRules("atp", "2025-12-22").bestN).toBe(19);
    expect(countingRules("atp", "2025-12-29").bestN).toBe(18);
    expect(countingRules("wta", "2025-06-02").bestN).toBe(18);
  });

  it("ATP: 4 Slams + 8 mandatory 1000s + 7 others, 6 from the 2026 season (docs :17-27)", () => {
    const r25 = countingRules("atp", "2025-12-22", "slots");
    expect(r25.slots.map((s) => [s.name, s.take])).toEqual([["slam", 4], ["mandatory_1000", 8]]);
    expect(r25.others).toBe(7);
    expect(r25.bestN).toBe(19);
    expect(countingRules("atp", "2025-12-29", "slots").others).toBe(6);
  });

  it("WTA: 4 Slams + best 6 combined 1000s + best 1 non-combined + 7 others (docs :255-264)", () => {
    const w = countingRules("wta", "2025-06-02", "slots");
    expect(w.slots.map((s) => [s.name, s.take])).toEqual([["slam", 4], ["combined_1000", 6], ["non_combined_1000", 1]]);
    expect(w.others).toBe(7);
  });

  it("WTA before the 2024 season: best 16, no slots, Finals on top", () => {
    // en.wikipedia.org WTA_rankings oldid 1162000864 (June 2023): "a maximum
    // of 16 tournaments for singles". 18 from the 2024 season.
    for (const variant of ["flat", "slots", "slots+overflow+refill>50"]) {
      const w = countingRules("wta", "2023-12-25", variant);
      expect(w.slots).toEqual([]);
      expect(w.bestN).toBe(16);
      expect(w.others).toBe(16);
      expect(w.finalsExtra).toBe(true);
    }
    expect(countingRules("wta", "2024-01-01").bestN).toBe(18);
  });

  it("defaults to slots, refilled for every player, with overflow (replay, Phase 2a)", () => {
    expect(DEFAULT_VARIANT).toBe("slots+refill+overflow");
    const r = countingRules("atp", "2025-06-02", undefined, 3);
    expect(r.refill).toBe(true);
    expect(r.overflow).toBe(true);
    expect(r.slots.map((s) => s.name)).toEqual(["slam", "mandatory_1000"]);
  });

  it("flat>K: players ranked worse than K count a flat best N", () => {
    expect(countingRules("atp", "2025-06-02", "slots+refill+flat>30", 10).slots).toHaveLength(2);
    expect(countingRules("atp", "2025-06-02", "slots+refill+flat>30", 31).slots).toEqual([]);
  });

  it("keeps the flat best-N reading available for comparison", () => {
    expect(countingRules("atp", "2025-06-02", "flat").slots).toEqual([]);
  });
});

describe("ledgerFor — slots", () => {
  const atp = (variant: Parameters<typeof countingRules>[2]) => countingRules("atp", "2025-06-02", variant);

  it("puts Monte Carlo among the others, not in a mandatory slot (docs :162)", () => {
    const res = [c(1000, "masters_1000", "Monte Carlo Masters"), ...Array.from({ length: 7 }, () => c(500, "atp_500"))];
    const led = ledgerFor(res, "2025-06-02", atp("slots"));
    // 7 others: the 1000 from Monte Carlo + six 500s; the seventh 500 is cut.
    expect(led.total).toBe(1000 + 6 * 500);
  });

  it("without refill, an unused slot loses capacity, never points", () => {
    const res = [c(2000, "grand_slam"), ...Array.from({ length: 9 }, () => c(250, "atp_250"))];
    expect(ledgerFor(res, "2025-06-02", atp("slots")).total).toBe(2000 + 7 * 250);
  });

  it("with refill, unused Slam and 1000 slots go to the others", () => {
    const res = [c(2000, "grand_slam"), ...Array.from({ length: 9 }, () => c(250, "atp_250"))];
    expect(ledgerFor(res, "2025-06-02", atp("slots+refill")).total).toBe(2000 + 9 * 250);
  });

  it("refills only for players ranked below the cutoff ('mandatory if accepted', docs :21)", () => {
    // A top player who skips a mandatory event keeps an empty slot; a player
    // ranked too low to be accepted has it filled from other results.
    const res = [c(2000, "grand_slam"), ...Array.from({ length: 9 }, () => c(250, "atp_250"))];
    const rules = (rank: number) => countingRules("atp", "2025-06-02", "slots+refill>50", rank);
    expect(ledgerFor(res, "2025-06-02", rules(10)).total).toBe(2000 + 7 * 250);
    expect(ledgerFor(res, "2025-06-02", rules(120)).total).toBe(2000 + 9 * 250);
  });

  it("a qualifying-only result does not take a Slam or 1000 slot", () => {
    // A player who only played qualifying was not accepted into the main
    // draw; his result counts among the others and leaves the slot unused.
    const qual = c(16, "grand_slam", "Australian Open", { mainDraw: false });
    const res = [qual, ...Array.from({ length: 19 }, () => c(250, "atp_250"))];
    const led = ledgerFor(res, "2025-06-02", countingRules("atp", "2025-06-02", "slots+refill"));
    // All 12 slots stay unused -> 7 + 12 = 19 others: the nineteen 250s beat
    // the 16. Had the qualifying loss taken a Slam slot, only 18 others would
    // count and the total would be 16 + 18 * 250.
    expect(led.total).toBe(19 * 250);
  });

  it("rejects an unknown variant", () => {
    expect(() => countingRules("atp", "2025-06-02", "slots+bogus" as never)).toThrow(/variant/);
  });

  it("WTA: only the best non-combined 1000 takes the slot; overflow decides the rest", () => {
    const w = (variant: Parameters<typeof countingRules>[2]) => countingRules("wta", "2025-06-02", variant);
    const res = [c(1000, "wta_1000_nc", "Wuhan"), c(120, "wta_1000_nc", "Dubai"), c(65, "wta_1000_nc", "Doha")];
    expect(ledgerFor(res, "2025-06-02", w("slots")).total).toBe(1000);
    expect(ledgerFor(res, "2025-06-02", w("slots+overflow")).total).toBe(1000 + 120 + 65);
  });

  it("keeps the Finals on top in every variant", () => {
    const res = [c(1500, "finals", "Tour Finals", { isFinals: true }), c(250, "atp_250")];
    for (const v of ["flat", "slots", "slots+refill"] as const) {
      expect(ledgerFor(res, "2025-06-02", atp(v)).total).toBe(1750);
    }
  });

  it("a fifth Slam result in the window does not take a Slam slot", () => {
    const res = [...Array.from({ length: 5 }, () => c(100, "grand_slam")), c(50, "atp_250")];
    // 4 Slam slots; without overflow the 5th Slam result is dropped.
    expect(ledgerFor(res, "2025-06-02", atp("slots")).total).toBe(4 * 100 + 50);
  });
});

describe("ledgerFor", () => {
  const rules = { ...countingRules("atp", "2025-06-02", "flat"), bestN: 2, others: 2 };

  it("counts a result from its entry Monday until the Monday before expiry", () => {
    const res = [r(100, "2025-03-03", { expiryWeek: "2026-03-02" })];
    expect(ledgerFor(res, "2025-02-24", rules).total).toBe(0);
    expect(ledgerFor(res, "2025-03-03", rules).total).toBe(100);
    expect(ledgerFor(res, "2026-02-23", rules).total).toBe(100);
    expect(ledgerFor(res, "2026-03-02", rules).total).toBe(0);
  });

  it("keeps only the best N, plus the Finals on top", () => {
    const res = [
      r(500, "2025-01-06"), r(250, "2025-01-06"), r(100, "2025-01-06"),
      r(1500, "2025-01-06", { isFinals: true }),
    ];
    const led = ledgerFor(res, "2025-06-02", rules);
    expect(led.total).toBe(500 + 250 + 1500);
    expect(led.valid).toHaveLength(4);
    expect(led.counted).toHaveLength(3);
  });

  it("collects the gaps of every valid result", () => {
    const res = [r(0, "2025-01-06", { gaps: ["challenger_tier"] }), r(0, "2025-01-06", { gaps: ["challenger_tier"] })];
    expect(ledgerFor(res, "2025-06-02", rules).gaps).toEqual(["challenger_tier"]);
  });

  it("indexes results by player", () => {
    const idx = indexByPlayer([r(1, "2025-01-06"), r(2, "2025-01-06", { playerId: "q" })]);
    expect(idx.get("p")).toHaveLength(1);
    expect(idx.get("q")).toHaveLength(1);
  });
});
