import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  challengerTier,
  parseChallengerCalendar,
  parseDateRange,
  teChallengerCity,
} from "../sources/atp-challenger-calendar";

const html = readFileSync(
  resolve(import.meta.dirname, "../__fixtures__/atp-challenger-calendar-2026.html"),
  "utf8",
);

describe("parseDateRange", () => {
  it("handles same-month, cross-month and cross-year ranges", () => {
    expect(parseDateRange("7 - 13 September, 2026")).toEqual(["2026-09-07", "2026-09-13"]);
    expect(parseDateRange("28 September - 4 October, 2026")).toEqual(["2026-09-28", "2026-10-04"]);
    expect(parseDateRange("29 December - 4 January, 2026")).toEqual(["2025-12-29", "2026-01-04"]);
  });
});

describe("parseChallengerCalendar", () => {
  const events = parseChallengerCalendar(html);

  it("reads the whole 2026 calendar", () => {
    expect(events.length).toBeGreaterThan(200);
    expect(events.every((e) => [50, 75, 100, 125, 175].includes(e.tier))).toBe(true);
  });

  it("keeps one entry per edition, so a city can carry two tiers", () => {
    const genoa = events.filter((e) => e.city === "genoa");
    expect(genoa.map((g) => g.tier).sort()).toEqual([125, 75].sort());
  });
});

describe("challengerTier", () => {
  const events = parseChallengerCalendar(html);

  it("resolves TennisExplorer names by city and date", () => {
    expect(challengerTier(events, "Bari challenger", "2026-09-29")).toBe(50);
    expect(challengerTier(events, "Columbus 3 challenger", "2026-09-28")).toBe(75);
    expect(challengerTier(events, "Genoa 2 challenger", "2026-09-24")).toBe(75);
    expect(challengerTier(events, "Genoa challenger", "2026-09-10")).toBe(125);
    expect(challengerTier(events, "Porto challenger", "2026-09-29")).toBe(125);
    expect(challengerTier(events, "St. Tropez challenger", "2026-09-22")).toBe(125);
    expect(challengerTier(events, "Mouilleron-Le-Captif challenger", "2026-09-28")).toBe(75);
  });

  it("credits qualifying played before the listed week", () => {
    // Jingshan's week is listed from 29 Sep; qualifying ran on the 27th/28th.
    expect(challengerTier(events, "Jingshan challenger", "2026-09-27")).toBe(100);
  });

  it("returns null for an event it cannot place", () => {
    expect(challengerTier(events, "Atlantis challenger", "2026-09-28")).toBeNull();
  });

  it("normalises TennisExplorer city names", () => {
    expect(teChallengerCity("Columbus 3 challenger")).toBe("columbus");
    expect(teChallengerCity("St. Tropez challenger")).toBe("saint tropez");
  });
});
