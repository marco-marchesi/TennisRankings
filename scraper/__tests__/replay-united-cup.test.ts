import { describe, expect, it } from "vitest";
import { buildEditions } from "@scraper/replay/editions";
import type { ArchiveMatch } from "@scraper/replay/types";
import { unitedCupPoints, type UnitedCupMatch } from "@scraper/replay/united-cup";

const win = (stage: UnitedCupMatch["stage"], oppRank: number | null): UnitedCupMatch => ({ stage, won: true, oppRank });
const loss = (stage: UnitedCupMatch["stage"]): UnitedCupMatch => ({ stage, won: false, oppRank: 5 });

describe("unitedCupPoints — ATP (per win, by stage and opponent rank)", () => {
  it("pays each win by stage and the opponent's rank band", () => {
    expect(unitedCupPoints("atp", 2024, [win("RR", 8)])).toBe(55);
    expect(unitedCupPoints("atp", 2024, [win("RR", 300)])).toBe(15);
    expect(unitedCupPoints("atp", 2025, [win("F", 300)])).toBe(35);
    expect(unitedCupPoints("atp", 2026, [win("QF", 45), win("SF", 15)])).toBe(40 + 105);
  });
  it("a loss earns nothing; the total caps at 500", () => {
    expect(unitedCupPoints("atp", 2024, [loss("RR")])).toBe(0);
    expect(unitedCupPoints("atp", 2024, [win("RR", 1), win("RR", 1), win("QF", 1), win("SF", 1), win("F", 1)])).toBe(500);
  });
  it("a win over an opponent with no rank is unsourced, not band 251+", () => {
    // The pages give no rule for unranked opponents, and the archive leaves
    // some ranked players' ranks blank (5 WTA 2024 matches): a gap.
    expect(unitedCupPoints("atp", 2024, [win("RR", null)])).toBeNull();
    // A loss to one needs no band.
    expect(unitedCupPoints("atp", 2024, [{ stage: "RR", won: false, oppRank: null }])).toBe(0);
    // WTA from 2025 pays by wins: the rank does not matter.
    expect(unitedCupPoints("wta", 2025, [win("RR", null)])).toBe(32);
  });
  it("2023 is unsourced in the archive's labels (city finals tagged RR)", () => {
    expect(unitedCupPoints("atp", 2023, [win("RR", 8)])).toBeNull();
  });
});

describe("unitedCupPoints — WTA", () => {
  it("2024: the per-win table, with 5 wins = 500 and 4 wins at least 325", () => {
    expect(unitedCupPoints("wta", 2024, [win("RR", 8), loss("RR")])).toBe(55);
    const four = [win("RR", 300), win("RR", 300), win("QF", 300), win("SF", 300), loss("F")];
    expect(unitedCupPoints("wta", 2024, four)).toBe(325);
    expect(unitedCupPoints("wta", 2024, [...four.slice(0, 4), win("F", 300)])).toBe(500);
  });
  it("2025 on: by number of wins, knockout wins worth more", () => {
    expect(unitedCupPoints("wta", 2025, [loss("RR"), loss("RR")])).toBe(1);
    expect(unitedCupPoints("wta", 2025, [win("RR", 8), loss("RR")])).toBe(32);
    expect(unitedCupPoints("wta", 2025, [loss("RR"), win("QF", 8)])).toBe(60);
    expect(unitedCupPoints("wta", 2026, [win("RR", 8), win("RR", 8), loss("QF")])).toBe(90);
    expect(unitedCupPoints("wta", 2026, [win("RR", 8), win("QF", 8), loss("SF")])).toBe(108);
    expect(unitedCupPoints("wta", 2025, [win("RR", 8), win("RR", 8), win("QF", 8)])).toBe(150);
  });
});

describe("buildEditions — United Cup", () => {
  const m = (over: Partial<ArchiveMatch>): ArchiveMatch => ({
    tourneyId: "2025-9900", tourneyName: "United Cup", level: "A", drawSize: 18, tourneyDate: "2024-12-27",
    round: "RR", winnerId: "A", loserId: "B", winnerEntry: null, loserEntry: null, score: "6-1 6-1",
    winnerRank: 30, loserRank: 9, ...over,
  });
  it("scores each player from their matches and counts them the Monday after", () => {
    const { results } = buildEditions("atp", [m({}), m({ round: "QF", winnerId: "B", loserId: "A", winnerRank: 9, loserRank: 30 })], []);
    const a = results.find((r) => r.playerId === "A")!;
    expect(a.points).toBe(55); // RR win over #9
    expect(a.gaps).toEqual([]);
    expect(results.find((r) => r.playerId === "B")!.points).toBe(55); // QF win over #30
    expect(a.entryWeek).toBe("2025-01-06");
  });
});
