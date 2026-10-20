import { describe, expect, it } from "vitest";
import { normaliseTournamentKey } from "../projections/derive-live-points";

describe("normaliseTournamentKey", () => {
  it("groups the feeds' spellings of one event", () => {
    // atptour.com vs TennisExplorer for the 2026 Japan Open. Two keys meant
    // two groups, and a player was credited once per feed.
    expect(normaliseTournamentKey("Tokyo (Japan Open)")).toBe(normaliseTournamentKey("Tokyo"));
    expect(normaliseTournamentKey("US Open")).toBe(normaliseTournamentKey("Us Open"));
    expect(normaliseTournamentKey("Cincinnati WTA")).toBe(normaliseTournamentKey("Cincinnati"));
  });
});
