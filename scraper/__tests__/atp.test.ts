import { readFileSync } from "node:fs";
import { describe, it, expect } from "vitest";
import { parseAtpRankings } from "../sources/atp";
import { RankingSnapshot, snapshotSanityCheck } from "../validate";

const fixture = readFileSync(
  new URL("../__fixtures__/atp-rankings.html", import.meta.url),
  "utf-8",
);

describe("parseAtpRankings (contract test against real atptour.com HTML)", () => {
  const snap = parseAtpRankings({ html: fixture, weekOf: "2026-05-19" });

  it("parses the full top-100 ranking page", () => {
    expect(snap.entries.length).toBeGreaterThanOrEqual(100);
  });

  it("places Jannik Sinner at #1 with the expected fields", () => {
    expect(snap.entries[0]).toMatchObject({
      rank: 1,
      slug: "jannik-sinner",
      fullName: "Jannik Sinner",
      countryCode: "ITA",
    });
    expect(snap.entries[0]?.points).toBeGreaterThan(10000);
  });

  it("places Carlos Alcaraz at #2", () => {
    expect(snap.entries[1]).toMatchObject({
      rank: 2,
      slug: "carlos-alcaraz",
      countryCode: "ESP",
    });
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

  it("passes the full RankingSnapshot Zod schema", () => {
    expect(() => RankingSnapshot.parse(snap)).not.toThrow();
  });
});

describe("snapshotSanityCheck", () => {
  const snap = parseAtpRankings({ html: fixture, weekOf: "2026-05-19" });

  it("accepts a snapshot identical to the previous", () => {
    const result = snapshotSanityCheck(snap, snap);
    expect(result.ok).toBe(true);
    expect(result.deltaPct).toBe(0);
  });

  it("flags a snapshot where >threshold% of the top-50 has moved >=10 places", () => {
    const shuffled = {
      ...snap,
      entries: snap.entries.map((e, i) => ({
        ...e,
        rank: snap.entries.length - i,
      })),
    };
    const result = snapshotSanityCheck(snap, shuffled, 20);
    expect(result.ok).toBe(false);
    expect(result.deltaPct).toBeGreaterThan(20);
  });
});
