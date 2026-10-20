import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { parseChallengerCalendar } from "../sources/atp-challenger-calendar";
import { officialEventKey, teTournamentLevel } from "../te-tournament-level";
import { inferCategory } from "../projections/category-inference";

const challengerEvents = parseChallengerCalendar(
  readFileSync(resolve(import.meta.dirname, "../__fixtures__/atp-challenger-calendar-2026.html"), "utf8"),
);
const officialLevels = [
  { key: officialEventKey("Porto 125"), playedOn: "2026-09-24", level: "WTA 125" },
  { key: officialEventKey("Seoul"), playedOn: "2026-09-23", level: "WTA 250" },
];
const deps = { challengerEvents, officialLevels };

describe("teTournamentLevel", () => {
  it("stores a tier for every kind of event TE lists", () => {
    expect(teTournamentLevel("atp", "UTR Pro Tennis Series 3", "2026-09-28", deps)).toBe("X");
    expect(teTournamentLevel("atp", "Laver Cup", "2026-09-26", deps)).toBe("X");
    expect(teTournamentLevel("wta", "Baza ITF", "2026-09-28", deps)).toBe("ITF");
    expect(teTournamentLevel("atp", "Bari challenger", "2026-09-28", deps)).toBe("CH50");
    expect(teTournamentLevel("atp", "Porto challenger", "2026-09-28", deps)).toBe("CH125");
  });

  it("takes the official WTA level for the same event and week", () => {
    // TE "Porto WTA" was stored as "A" (a 250); the WTA calls it a 125.
    expect(teTournamentLevel("wta", "Porto WTA", "2026-09-22", deps)).toBe("WTA 125");
    // WTA_500_TOURNAMENTS lists Seoul, but the 2026 edition is a 250.
    expect(teTournamentLevel("wta", "Seoul WTA", "2026-09-22", deps)).toBe("WTA 250");
  });

  it("round-trips through inferCategory", () => {
    const cat = (tour: "atp" | "wta", name: string, date: string) =>
      inferCategory(tour, name, teTournamentLevel(tour, name, date, deps));
    expect(cat("wta", "Porto WTA", "2026-09-22")).toBe("wta_125");
    expect(cat("wta", "Seoul WTA", "2026-09-22")).toBe("wta_250");
    expect(cat("atp", "Bari challenger", "2026-09-28")).toBe("ch_50");
    expect(cat("atp", "Beijing", "2026-09-28")).toBe("atp_500");
    expect(cat("wta", "Beijing", "2026-09-28")).toBe("wta_1000");
  });
});
