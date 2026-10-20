import { describe, expect, it } from "vitest";
import { pointsForRound } from "@scraper/config/points-table";
import { eraTable, seasonOf } from "@scraper/replay/points-eras";

describe("seasonOf", () => {
  it("dates a season by its first event week, not the calendar year", () => {
    expect(seasonOf("atp", "2023-12-29")).toBe(2024); // United Cup 2024
    expect(seasonOf("atp", "2023-12-18")).toBe(2023);
    expect(seasonOf("atp", "2024-12-30")).toBe(2025);
    expect(seasonOf("wta", "2023-01-02")).toBe(2023);
    expect(seasonOf("wta", "2026-01-05")).toBe(2026);
    expect(seasonOf("atp", "2022-11-14")).toBe(2022);
    expect(seasonOf("atp", "2021-11-15")).toBeNull();
  });
});

describe("eraTable — ATP", () => {
  it("2023 main draw is the old table", () => {
    expect(eraTable("atp", "grand_slam", 2023, 128)!.main.F).toBe(1200);
    expect(eraTable("atp", "atp_500", 2023, 32)!.main.F).toBe(300);
    expect(eraTable("atp", "atp_250", 2023, 48)!.main.R32).toBe(10);
    expect(eraTable("atp", "masters_1000", 2023, 96)!.main.R64).toBe(25);
  });

  it("2024 and 2025 Slam main draw equal the live table", () => {
    for (const season of [2024, 2025] as const)
      for (const r of ["W", "F", "SF", "QF", "R16", "R32", "R64", "R128"] as const)
        expect(eraTable("atp", "grand_slam", season, 128)!.main[r]).toBe(pointsForRound("grand_slam", r));
  });

  it("qualifying: bonus plus losers counted from the last round", () => {
    const slam = eraTable("atp", "grand_slam", 2024, 128)!;
    expect(slam.qualifierBonus).toBe(30);
    expect(slam.qual(0, 3)).toBe(16);
    expect(slam.qual(1, 3)).toBe(8);
    expect(slam.qual(2, 3)).toBe(0);
    const m = eraTable("atp", "masters_1000", 2023, 56)!;
    expect(m.qualifierBonus).toBe(25);
    expect(m.qual(0, 2)).toBe(16);
  });

  it("Challenger: 2023 vs 2024 tables, first round worth nothing", () => {
    expect(eraTable("atp", "ch_175", 2023, 32)!.main.F).toBe(100);
    expect(eraTable("atp", "ch_175", 2024, 32)!.main.F).toBe(90);
    expect(eraTable("atp", "ch_125", 2025, 32)!.main.R32).toBe(0);
    expect(eraTable("atp", "ch_100", 2024, 32)!.qualifierBonus).toBe(4);
  });

  it("ITF men: one table 2022-2025", () => {
    for (const season of [2022, 2023, 2024, 2025] as const) {
      expect(eraTable("atp", "m25_futures", season, 32)!.main.R16).toBe(1);
      expect(eraTable("atp", "m15_futures", season, 32)!.main.W).toBe(15);
    }
  });

  it("2026 is the live table", () => {
    expect(eraTable("atp", "atp_500", 2026, 32)!.main.F).toBe(pointsForRound("atp_500", "F"));
  });
});

describe("eraTable — 2022 (2022_ATP_Tour, 2022_WTA_Tour, 2022_ITF_Women's_World_Tennis_Tour)", () => {
  it("tour tables pay as 2023", () => {
    expect(eraTable("atp", "atp_500", 2022, 32)!.main.F).toBe(300);
    expect(eraTable("wta", "wta_250", 2022, 32)!.main.W).toBe(280);
    expect(eraTable("wta", "wta_125", 2022, 32)!.main.W).toBe(160);
  });
  it("Challengers: 2022's own tiers and values (2022_ATP_Challenger_Tour)", () => {
    expect(eraTable("atp", "ch_80", 2022, 48)!.main.W).toBe(80);
    expect(eraTable("atp", "ch_90", 2022, 32)!.main.F).toBe(55);
    expect(eraTable("atp", "ch_110", 2022, 32)!.qualifierBonus).toBe(5);
    expect(eraTable("atp", "ch_100", 2022, 32)!.main.F).toBe(60);
    expect(eraTable("atp", "ch_175", 2022, 32)).toBeNull(); // no 175s in 2022
    expect(eraTable("atp", "ch_80", 2023, 32)).toBeNull(); // 80s ended with 2022
  });
  it("ITF: +H rows for W100/W80, no W40, W15 depends on an unknown qualifying draw", () => {
    expect(eraTable("wta", "itf_w100h", 2022, 32)!.main.W).toBe(150);
    expect(eraTable("wta", "itf_w80h", 2022, 48)!.main.R32).toBe(6);
    expect(eraTable("wta", "itf_w60", 2022, 32)!.main.W).toBe(80);
    expect(eraTable("wta", "itf_w40", 2022, 32)).toBeNull();
    expect(eraTable("wta", "itf_w15", 2022, 32)).toBeNull();
  });
});

describe("eraTable — WTA", () => {
  it("2023 500 / 250 / non-combined 1000", () => {
    expect(eraTable("wta", "wta_500", 2023, 32)!.main.W).toBe(470);
    expect(eraTable("wta", "wta_250", 2023, 32)!.main.W).toBe(280);
    expect(eraTable("wta", "wta_1000_nc", 2023, 56)!.main.W).toBe(900);
    expect(eraTable("wta", "wta_1000_nc", 2023, 64)!.main.W).toBe(1000);
  });

  it("a 2023 250's qualifying depends on how many rounds it had", () => {
    const t = eraTable("wta", "wta_250", 2023, 32)!;
    expect(t.qual(0, 3)).toBe(14);
    expect(t.qual(0, 2)).toBe(12);
  });

  it("non-combined 1000: 2024 and 2025 pay like a 1000 (2024 by replay evidence)", () => {
    expect(eraTable("wta", "wta_1000_nc", 2024, 56)!.main.W).toBe(1000);
    expect(eraTable("wta", "wta_1000_nc", 2025, 56)!.main.R64).toBe(10);
  });

  it("WTA 125 changed in 2024", () => {
    expect(eraTable("wta", "wta_125", 2023, 32)!.main.W).toBe(160);
    expect(eraTable("wta", "wta_125", 2025, 32)!.main.W).toBe(125);
  });

  it("ITF tiers per era, draw-dependent", () => {
    expect(eraTable("wta", "itf_w60", 2023, 32)!.main.W).toBe(80);
    expect(eraTable("wta", "itf_w60h", 2023, 32)!.main.W).toBe(100);
    expect(eraTable("wta", "itf_w35", 2024, 32)!.main.R16).toBe(4);
    expect(eraTable("wta", "itf_w35", 2024, 32)!.main.R32).toBe(0);
    expect(eraTable("wta", "itf_w75", 2025, 48)!.main.R32).toBe(5);
    expect(eraTable("wta", "itf_w100", 2024, 32)!.qual(0, 2)).toBe(3);
  });

  it("2023 WTA Finals format is unsourced", () => {
    expect(eraTable("wta", "finals", 2023, 8)).toBeNull();
    expect(eraTable("wta", "finals", 2024, 8)).not.toBeNull();
  });

  it("unsourced combinations are null, never a neighbour's table", () => {
    expect(eraTable("wta", "itf_w35", 2023, 32)).toBeNull(); // no W35 in 2023
    expect(eraTable("wta", "itf_w50h", 2024, 32)).toBeNull(); // no +H rows from 2024, evidence too thin
    expect(eraTable("wta", "itf_w40h", 2024, 32)).toBeNull(); // no W40 from 2024
    expect(eraTable("wta", "itf_w15", 2024, 48)).toBeNull(); // no 48-draw W15 row
    expect(eraTable("wta", "itf_w25", 2026, 32)).toBeNull(); // no W25 since 2024
    expect(eraTable("wta", "itf_w35", 2026, 32)!.main.R16).toBe(4); // 2025 values, replay evidence
  });
});
