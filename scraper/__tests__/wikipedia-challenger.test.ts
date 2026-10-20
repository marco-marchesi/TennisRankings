import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { challengerTierForWeek } from "@scraper/sources/atp-challenger-calendar";
import { parseWikiChallengerSeason } from "@scraper/sources/wikipedia-challenger";

// The real 2025_ATP_Challenger_Tour wikitext: the January table (three weeks)
// and the "Cancelled tournaments" table.
const fixture = readFileSync(resolve(__dirname, "../__fixtures__/wiki-2025-atp-challenger-excerpt.txt"), "utf8");
const events = parseWikiChallengerSeason(fixture, 2025);

describe("parseWikiChallengerSeason", () => {
  it("reads one event per edition, with its week and tier", () => {
    expect(events).toHaveLength(8);
    expect(events).toContainEqual({
      city: "canberra", name: "Canberra, Australia", start: "2024-12-30", end: "2025-01-05", tier: 125,
    });
  });

  it("dates a December week on a season page in the previous year", () => {
    expect(events.filter((e) => e.start.startsWith("2024-12")).map((e) => e.city).sort()).toEqual([
      "canberra", "nonthaburi", "noumea",
    ]);
  });

  it("keeps a city's editions apart, each with its own tier", () => {
    expect(events.filter((e) => e.city === "nonthaburi").map((e) => e.start)).toEqual([
      "2024-12-30", "2025-01-06", "2025-01-13",
    ]);
    expect(events.filter((e) => e.city === "oeiras").map((e) => [e.start, e.tier])).toEqual([
      ["2025-01-06", 75], ["2025-01-13", 100],
    ]);
  });

  it("reads the city from a piped link's display text", () => {
    expect(events.find((e) => e.city === "oeiras")!.name).toBe("Oeiras, Portugal");
  });

  it("skips cancelled tournaments", () => {
    expect(events.find((e) => e.city === "ottignies louvain la neuve")).toBeUndefined();
    expect(events.find((e) => e.city === "queretaro")).toBeUndefined();
  });

  it("feeds the archive's names through the existing tier lookup", () => {
    // Oeiras 1 ends 2025-01-12; the archive dates Oeiras 2 by its week, 01-13.
    expect(challengerTierForWeek(events, "Oeiras 2", "2025-01-13")).toBe(100);
    expect(challengerTierForWeek(events, "Nonthaburi 1", "2024-12-30")).toBe(75);
    expect(challengerTierForWeek(events, "Nonthaburi 3", "2025-01-13")).toBe(75);
    expect(challengerTierForWeek(events, "Canberra", "2025-02-03")).toBeNull();
  });

  it("accepts 2022's tiers (80 / 90 / 110)", () => {
    const row = "|rowspan=8|January 3||rowspan=2|[[2022 Bendigo International|Bendigo International]]<br />[[Bendigo]], Australia <br /> Hard – Challenger 80 – 48S/16Q/16D<br />";
    expect(parseWikiChallengerSeason(row, 2022)).toEqual([
      { city: "bendigo", name: "Bendigo, Australia", start: "2022-01-03", end: "2022-01-09", tier: 80 },
    ]);
  });
});
