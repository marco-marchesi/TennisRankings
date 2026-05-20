import { describe, it, expect } from "vitest";
import { parseWtaRankings } from "../sources/wta";

const fixture = `
<tr data-rank="1" data-slug="iga-swiatek" data-name="Iga Świątek" data-country="POL" data-points="10715" data-played="18"></tr>
<tr data-rank="2" data-slug="aryna-sabalenka" data-name="Aryna Sabalenka" data-country="" data-points="8725" data-played="19"></tr>
<tr data-rank="3" data-slug="coco-gauff" data-name="Coco Gauff" data-country="USA" data-points="7150" data-played="22"></tr>
`;

describe("parseWtaRankings", () => {
  it("parses every row in the fixture", () => {
    const snap = parseWtaRankings({ html: fixture, weekOf: "2026-05-18" });
    expect(snap.entries).toHaveLength(3);
  });

  it("preserves non-ASCII characters in names", () => {
    const snap = parseWtaRankings({ html: fixture, weekOf: "2026-05-18" });
    expect(snap.entries[0]!.fullName).toBe("Iga Świątek");
  });

  it("maps empty country attribute to null", () => {
    const snap = parseWtaRankings({ html: fixture, weekOf: "2026-05-18" });
    expect(snap.entries[1]!.countryCode).toBeNull();
  });

  it("tags the snapshot as WTA, not race", () => {
    const snap = parseWtaRankings({ html: fixture, weekOf: "2026-05-18" });
    expect(snap.tour).toBe("wta");
    expect(snap.isRace).toBe(false);
  });
});
