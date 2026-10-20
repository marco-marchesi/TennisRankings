import { describe, expect, it } from "vitest";
import { archiveCategory } from "@scraper/replay/category";
import type { ChallengerEvent } from "@scraper/sources/atp-challenger-calendar";

const CAL: ChallengerEvent[] = [
  { city: "bengaluru", name: "Bengaluru, India", start: "2026-01-05", end: "2026-01-10", tier: 125 },
  { city: "bangalore", name: "Bangalore, India", start: "2025-02-24", end: "2025-03-02", tier: 125 },
  { city: "nansha", name: "Nansha, China", start: "2025-04-28", end: "2025-05-04", tier: 75 },
  { city: "guangzhou", name: "Guangzhou, China", start: "2025-09-08", end: "2025-09-14", tier: 100 },
  { city: "bendigo", name: "Bendigo, Australia", start: "2022-01-03", end: "2022-01-09", tier: 80 },
  { city: "tulln an der donau", name: "Tulln an der Donau, Austria", start: "2022-09-05", end: "2022-09-11", tier: 100 },
];
const cat = (tour: "atp" | "wta", level: string, name: string, draw: number | null = 32, start = "2025-03-03") =>
  archiveCategory(tour, level, name, draw, start, CAL);

describe("archiveCategory — ATP", () => {
  it("maps tour levels", () => {
    expect(cat("atp", "G", "Australian Open", 128)).toEqual({ category: "grand_slam", variant: undefined, gap: null });
    expect(cat("atp", "M", "Indian Wells Masters", 96).category).toBe("masters_1000");
    expect(cat("atp", "M", "Monte Carlo Masters", 56).variant).toBe("d56");
    expect(cat("atp", "A", "Basel", 32).category).toBe("atp_500");
    expect(cat("atp", "A", "Washington", 48)).toEqual({ category: "atp_500", variant: "d48", gap: null });
    expect(cat("atp", "A", "Marseille", 28).category).toBe("atp_250");
    expect(cat("atp", "F", "Tour Finals", 8).category).toBe("finals");
    expect(cat("atp", "15", "M15 Antalya", 32).category).toBe("m15_futures");
    expect(cat("atp", "25", "M25 Rome", 32).category).toBe("m25_futures");
  });

  it("awards nothing for Next Gen Finals and Davis Cup", () => {
    expect(cat("atp", "F", "Next Gen Finals", 8).category).toBe("non_ranking");
    expect(cat("atp", "D", "Davis Cup Finals", 4).category).toBe("davis_cup");
  });

  it("recognises the Finals by name, whatever level the archive gives them", () => {
    // The archive tags the 2023 Tour Finals "A" and the 2022 NextGen Finals
    // "A": by level alone the 2023 Finals scored as a 250 (Sinner 165, not 1000).
    expect(cat("atp", "A", "Tour Finals", 8).category).toBe("finals");
    expect(cat("atp", "A", "NextGen Finals", 8).category).toBe("non_ranking");
  });

  it("reports what it cannot score as a gap, never a default tier", () => {
    // The United Cup is scored per match by united-cup.ts; the ATP Cup is not.
    expect(cat("atp", "A", "United Cup", 18)).toEqual({ category: null, variant: undefined, gap: null, replayTier: "united_cup" });
    expect(cat("atp", "C", "Abidjan 1 CH", 32)).toEqual({ category: null, variant: undefined, gap: "challenger_tier" });
    expect(cat("atp", "Z", "Mystery", 32).gap).toBe("level:Z");
  });

  it("scores nothing for the Laver Cup, which the archive tags as a tour event", () => {
    // atp_matches_2024: 2024-9210,Laver Cup,Hard,12,A
    expect(cat("atp", "A", "Laver Cup", 12)).toEqual({ category: "non_ranking", variant: undefined, gap: null });
    expect(cat("atp", "A", "ATP Cup", 24).gap).toBe("united_cup");
  });

  it("knows Doha and Munich were 250s before they became 500s in 2025", () => {
    expect(cat("atp", "A", "Doha", 32, "2024-02-19").category).toBe("atp_250");
    expect(cat("atp", "A", "Munich", 32, "2024-04-15").category).toBe("atp_250");
    expect(cat("atp", "A", "Doha", 32, "2025-02-17").category).toBe("atp_500");
  });

  it("resolves a Challenger tier from the calendar when it covers the week", () => {
    expect(cat("atp", "C", "Bengaluru CH", 32, "2026-01-05").category).toBe("ch_125");
  });

  it("routes a 2022-only Challenger tier to the replay tables", () => {
    expect(cat("atp", "C", "Bendigo CH", 48, "2022-01-03")).toEqual({ category: null, variant: undefined, gap: null, replayTier: "ch_80" });
  });

  it("falls back to the calendar's name for a city the archive spells differently", () => {
    expect(cat("atp", "C", "Bengaluru CH", 32, "2025-02-24").category).toBe("ch_125"); // Wikipedia: Bangalore
    expect(cat("atp", "C", "Guangzhou CH", 32, "2025-04-28").category).toBe("ch_75"); // that week: Nansha
    expect(cat("atp", "C", "Guangzhou Huangpu CH", 32, "2025-09-08").category).toBe("ch_100");
    expect(cat("atp", "C", "Tulln CH", 32, "2022-09-05").category).toBe("ch_100");
    // Its own name wins when the calendar has it.
    expect(cat("atp", "C", "Guangzhou CH", 32, "2025-09-08").category).toBe("ch_100");
  });
});

describe("archiveCategory — WTA", () => {
  it("maps tour levels", () => {
    expect(cat("wta", "G", "Wimbledon", 128).category).toBe("wta_grand_slam");
    expect(cat("wta", "PM", "Beijing", 96).category).toBe("wta_1000");
    expect(cat("wta", "PM", "Wuhan", 56).category).toBe("wta_1000_nc");
    expect(cat("wta", "PM", "Doha", 64).category).toBe("wta_1000_nc");
    expect(cat("wta", "P", "Stuttgart", 28).category).toBe("wta_500");
    expect(cat("wta", "I", "Hobart", 32).category).toBe("wta_250");
    expect(cat("wta", "C", "Lisbon 125", 32).category).toBe("wta_125");
    expect(cat("wta", "D", "BJK Cup Finals", 12).category).toBe("non_ranking");
  });

  it("places non-mandatory 1000s the archive tags 'P'", () => {
    // wta_matches_2024: Doha and Dubai are "P" (2025+: "PM"); 2023's
    // Dubai/Montreal/Cincinnati/Guadalajara 1000s are "P" with a 64 draw.
    expect(cat("wta", "P", "Dubai", 64, "2024-02-18").category).toBe("wta_1000_nc");
    expect(cat("wta", "P", "Doha", 64, "2024-02-11").category).toBe("wta_1000_nc");
    expect(cat("wta", "P", "Montreal", 64, "2023-08-07").category).toBe("wta_1000_nc");
    // Doha 2023 was a 32-draw 500; Brisbane is a 64-draw 500.
    expect(cat("wta", "P", "Doha", 32, "2023-02-13").category).toBe("wta_500");
    expect(cat("wta", "P", "Brisbane", 64, "2024-12-29").category).toBe("wta_500");
  });

  it("routes the WTA United Cup, which the archive tags as a 250, to per-match scoring", () => {
    // wta_matches_2024: 2024-9900,United Cup,Hard,18,I — scoring is per match
    // by opponent rank (docs/ranking-rules.md:131-139), not by round reached.
    expect(cat("wta", "I", "United Cup", 18).replayTier).toBe("united_cup");
  });

  it("recognises the WTA Finals by name and flags the Elite Trophy", () => {
    // wta_matches_2023: 2023-1081,Zhuhai,Hard,12,F — the Elite Trophy, not the Finals.
    expect(cat("wta", "F", "Riyadh Finals", 8).category).toBe("finals");
    expect(cat("wta", "F", "Cancun Finals", 8).category).toBe("finals");
    expect(cat("wta", "F", "Zhuhai", 12).gap).toBe("elite_trophy");
  });

  it("scores the Paris 2024 Olympics with the WTA's medal table", () => {
    expect(cat("wta", "O", "Paris Olympics", 64, "2024-07-27")).toEqual({ category: "olympics", variant: "d64", gap: null });
  });

  it("names ITF tiers for points-eras.ts to score, hospitality included", () => {
    expect(cat("wta", "50+H", "W50 Rome", 32)).toEqual({ category: null, variant: undefined, gap: null, replayTier: "itf_w50h" });
    expect(cat("wta", "15", "W15 Monastir", 32).replayTier).toBe("itf_w15");
  });
});
