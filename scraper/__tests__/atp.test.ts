import { readFileSync } from "node:fs";
import { describe, it, expect } from "vitest";
import { parseAtpRankings } from "../sources/atp";
import { snapshotSanityCheck } from "../validate";

const fixture = readFileSync(
  new URL("../__fixtures__/atp-top10.html", import.meta.url),
  "utf-8",
);

describe("parseAtpRankings (contract test against frozen fixture)", () => {
  it("parses every row in the fixture", () => {
    const snap = parseAtpRankings({ html: fixture, weekOf: "2026-05-18" });
    expect(snap.entries.length).toBe(10);
    expect(snap.entries[0]).toMatchObject({
      rank: 1,
      slug: "jannik-sinner",
      fullName: "Jannik Sinner",
      countryCode: "ITA",
      points: 11830,
    });
  });

  it("ranks are strictly ascending and unique", () => {
    const snap = parseAtpRankings({ html: fixture, weekOf: "2026-05-18" });
    const ranks = snap.entries.map((e) => e.rank);
    expect(ranks).toEqual([...ranks].sort((a, b) => a - b));
    expect(new Set(ranks).size).toBe(ranks.length);
  });
});

describe("snapshotSanityCheck", () => {
  it("accepts a snapshot identical to the previous", () => {
    const snap = parseAtpRankings({ html: fixture, weekOf: "2026-05-18" });
    const result = snapshotSanityCheck(snap, snap);
    expect(result.ok).toBe(true);
    expect(result.deltaPct).toBe(0);
  });

  it("flags a snapshot where >threshold% of the top-50 has moved >=10 places", () => {
    const snap = parseAtpRankings({ html: fixture, weekOf: "2026-05-18" });
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
