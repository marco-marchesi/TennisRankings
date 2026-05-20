import { describe, it, expect } from "vitest";
import {
  RankingEntry,
  RankingSnapshot,
  snapshotSanityCheck,
} from "../validate";

const goodEntry = {
  rank: 1,
  slug: "test-player",
  fullName: "Test Player",
  countryCode: "ITA",
  points: 10000,
  tournamentsPlayed: 18,
};

describe("RankingEntry schema", () => {
  it("accepts a well-formed entry", () => {
    expect(() => RankingEntry.parse(goodEntry)).not.toThrow();
  });

  it("rejects rank 0 or negative", () => {
    expect(() => RankingEntry.parse({ ...goodEntry, rank: 0 })).toThrow();
    expect(() => RankingEntry.parse({ ...goodEntry, rank: -3 })).toThrow();
  });

  it("rejects rank above 2500 (sanity ceiling)", () => {
    expect(() => RankingEntry.parse({ ...goodEntry, rank: 9999 })).toThrow();
  });

  it("rejects points above 20000 (sanity ceiling)", () => {
    expect(() => RankingEntry.parse({ ...goodEntry, points: 50000 })).toThrow();
  });

  it("rejects negative points", () => {
    expect(() => RankingEntry.parse({ ...goodEntry, points: -1 })).toThrow();
  });

  it("accepts a null country code", () => {
    expect(() => RankingEntry.parse({ ...goodEntry, countryCode: null })).not.toThrow();
  });

  it("rejects a 2-character country code (must be ISO-3)", () => {
    expect(() => RankingEntry.parse({ ...goodEntry, countryCode: "IT" })).toThrow();
  });

  it("rejects fullName under 2 chars", () => {
    expect(() => RankingEntry.parse({ ...goodEntry, fullName: "x" })).toThrow();
  });

  it("rejects an absurdly long fullName", () => {
    expect(() =>
      RankingEntry.parse({ ...goodEntry, fullName: "x".repeat(200) }),
    ).toThrow();
  });
});

describe("RankingSnapshot schema", () => {
  it("rejects fewer than 100 entries (sanity floor) at the schema layer", () => {
    expect(() =>
      RankingSnapshot.parse({
        tour: "atp",
        weekOf: "2026-05-18",
        isRace: false,
        entries: Array.from({ length: 10 }, (_, i) => ({
          ...goodEntry,
          rank: i + 1,
          slug: `p${i}`,
        })),
      }),
    ).toThrow();
  });

  it("rejects an invalid weekOf format", () => {
    expect(() =>
      RankingSnapshot.parse({
        tour: "atp",
        weekOf: "May 18 2026",
        isRace: false,
        entries: Array.from({ length: 100 }, (_, i) => ({
          ...goodEntry,
          rank: i + 1,
          slug: `p${i}`,
        })),
      }),
    ).toThrow();
  });
});

describe("snapshotSanityCheck", () => {
  function makeSnap(ranks: number[]) {
    return {
      tour: "atp" as const,
      weekOf: "2026-05-18",
      isRace: false,
      entries: ranks.map((r) => ({
        rank: r,
        slug: `p-${r}`,
        fullName: `Player ${r}`,
        countryCode: "USA",
        points: 1000 - r,
        tournamentsPlayed: 20,
      })),
    };
  }

  it("accepts a first-time snapshot when no previous exists", () => {
    const snap = makeSnap(Array.from({ length: 50 }, (_, i) => i + 1));
    const result = snapshotSanityCheck(null, snap);
    expect(result.ok).toBe(true);
  });

  it("accepts identical snapshots with deltaPct of 0", () => {
    const snap = makeSnap(Array.from({ length: 50 }, (_, i) => i + 1));
    const result = snapshotSanityCheck(snap, snap);
    expect(result.ok).toBe(true);
    expect(result.deltaPct).toBe(0);
  });

  it("rejects a snapshot where every player has moved 10+ places", () => {
    const prev = makeSnap(Array.from({ length: 50 }, (_, i) => i + 1));
    const next = {
      ...prev,
      entries: prev.entries.map((e, i) => ({ ...e, rank: i + 21 })),
    };
    const result = snapshotSanityCheck(prev, next, 20);
    expect(result.ok).toBe(false);
    expect(result.deltaPct).toBeGreaterThan(20);
  });

  it("treats new entrants in the top 50 as movers", () => {
    const prev = makeSnap(Array.from({ length: 50 }, (_, i) => i + 1));
    const next = {
      ...prev,
      entries: Array.from({ length: 50 }, (_, i) => ({
        rank: i + 1,
        slug: `new-${i}`,
        fullName: `New ${i}`,
        countryCode: "FRA",
        points: 1000 - i,
        tournamentsPlayed: 20,
      })),
    };
    const result = snapshotSanityCheck(prev, next, 20);
    expect(result.ok).toBe(false);
    expect(result.deltaPct).toBe(100);
  });

  it("respects a custom threshold", () => {
    const prev = makeSnap(Array.from({ length: 50 }, (_, i) => i + 1));
    const next = makeSnap(Array.from({ length: 50 }, (_, i) => i + 1));
    next.entries[0]!.rank = 2;
    next.entries[1]!.rank = 1;
    const result = snapshotSanityCheck(prev, next, 0);
    expect(result.ok).toBe(true);
  });
});
