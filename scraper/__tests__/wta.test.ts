import { readFileSync } from "node:fs";
import { describe, it, expect } from "vitest";
import { parseWtaRankings } from "../sources/wta";
import { RankingSnapshot } from "../validate";

const fixture = readFileSync(
  new URL("../__fixtures__/wta-rankings.html", import.meta.url),
  "utf-8",
);

describe("parseWtaRankings (contract test against real wtatennis.com HTML)", () => {
  const snap = parseWtaRankings({ html: fixture, weekOf: "2026-05-19" });

  it("parses the full top-100 ranking page", () => {
    expect(snap.entries.length).toBeGreaterThanOrEqual(100);
  });

  it("places Aryna Sabalenka at #1 with the expected fields", () => {
    expect(snap.entries[0]).toMatchObject({
      rank: 1,
      slug: "aryna-sabalenka",
      fullName: "Aryna Sabalenka",
      countryCode: "BLR",
    });
    expect(snap.entries[0]?.points).toBeGreaterThan(5000);
  });

  it("ranks are strictly ascending and unique", () => {
    const ranks = snap.entries.map((e) => e.rank);
    expect(ranks).toEqual([...ranks].sort((a, b) => a - b));
    expect(new Set(ranks).size).toBe(ranks.length);
  });

  it("every entry has a non-empty slug and full name", () => {
    for (const e of snap.entries) {
      expect(e.slug).toMatch(/^[a-z0-9-]+$/);
      expect(e.fullName.length).toBeGreaterThan(1);
    }
  });

  it("at least 80% of entries have a country code (sanity floor)", () => {
    const withCountry = snap.entries.filter((e) => e.countryCode).length;
    expect(withCountry / snap.entries.length).toBeGreaterThanOrEqual(0.8);
  });

  it("tags the snapshot as WTA, not race", () => {
    expect(snap.tour).toBe("wta");
    expect(snap.isRace).toBe(false);
  });

  it("passes the full RankingSnapshot Zod schema", () => {
    expect(() => RankingSnapshot.parse(snap)).not.toThrow();
  });
});
