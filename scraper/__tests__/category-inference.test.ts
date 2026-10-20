import { describe, expect, it } from "vitest";
import { inferCategory } from "../projections/category-inference";

// Every case below is a real TennisExplorer name from player_recent_matches,
// stored with tournament_level "A". Before these rules they all fell through
// to atp_250 / wta_250.
describe("inferCategory — events TennisExplorer lists without a tier", () => {
  it("scores exhibitions and team events as non-ranking", () => {
    for (const name of [
      "UTR Pro Tennis Series 3",
      "UTR Pro Match Series",
      "Laver Cup",
      "Asian Games",
    ]) {
      expect(inferCategory("atp", name, "A")).toBe("non_ranking");
    }
    expect(inferCategory("wta", "Billie Jean King Cup", "A")).toBe("non_ranking");
  });

  it("recognises ITF events instead of promoting them to a 250", () => {
    expect(inferCategory("wta", "Baza ITF", "A")).toBe("itf");
    expect(inferCategory("atp", "Maanshan 11 ITF", "A")).toBe("itf");
    // "Rome" is a Masters by name; "Rome ITF" must not inherit that.
    expect(inferCategory("wta", "Rome ITF", null)).toBe("itf");
  });

  it("uses the resolved Challenger tier, else the modal ch_75", () => {
    expect(inferCategory("atp", "Bari challenger", "CH50")).toBe("ch_50");
    expect(inferCategory("atp", "Porto challenger", "CH125")).toBe("ch_125");
    expect(inferCategory("atp", "Genoa 2 challenger", "A")).toBe("ch_75");
    // "Madrid" is a Masters by name; the Madrid Challenger is not.
    expect(inferCategory("atp", "Madrid challenger", null)).toBe("ch_75");
  });

  it("never scores a Challenger on the WTA side", () => {
    expect(inferCategory("wta", "Columbus 3 challenger", "A")).toBe("non_ranking");
  });

  it("leaves real tour events alone", () => {
    expect(inferCategory("atp", "Tokyo (Japan Open)", "A")).toBe("atp_500");
    expect(inferCategory("atp", "Chengdu", "A")).toBe("atp_250");
    expect(inferCategory("atp", "Beijing", null)).toBe("atp_500");
    expect(inferCategory("wta", "Beijing", "WTA 1000")).toBe("wta_1000");
    expect(inferCategory("wta", "Wuhan", "PM")).toBe("wta_1000_nc");
    expect(inferCategory("wta", "Seoul", "WTA 250")).toBe("wta_250");
  });
});
