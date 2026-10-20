import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { describe, it, expect } from "vitest";
import { parseAtpRankings } from "../sources/atp";
import { RankingSnapshot, snapshotSanityCheck } from "../validate";

const fixturePath = new URL("../__fixtures__/atp-rankings.html", import.meta.url);
const fixtureBytes = readFileSync(fixturePath);
const fixture = fixtureBytes.toString("utf-8");

/**
 * Contract test against a real atptour.com capture (2026-09-03).
 *
 * Assertions are deliberately STRUCTURAL. This file used to assert "Jannik
 * Sinner at #1" and "Carlos Alcaraz at #2" — which tells us nothing about the
 * parser and breaks whenever the rankings move. Alcaraz had already dropped
 * to #3 by this capture, so those tests would now fail for a reason that has
 * nothing to do with the code.
 *
 * What we want to catch is atptour.com changing the CSS hooks
 * `sources/atp.ts` depends on: `table.desktop-table`, `td.rank`, `td.player`,
 * `td.points`, `td.tourns`, `td.age`, `td.pointsMove`, and the country flag
 * read from `svg use[href*='#flag-xxx']`.
 */
describe("parseAtpRankings (contract test against real atptour.com HTML)", () => {
  const snap = parseAtpRankings({ html: fixture, weekOf: "2026-08-31" });

  it("fixture has not been re-recorded without updating this test", () => {
    const sha = createHash("sha256").update(fixtureBytes).digest("hex");
    expect(sha).toBe("ec00692ff9054eb40785f0ace2eb5daf0829f562205f78ff7bf4c26620a8f2b3");
  });

  it("parses the full top-100 ranking page", () => {
    expect(snap.entries.length).toBeGreaterThanOrEqual(100);
  });

  it("ranks are contiguous from 1, ascending and unique", () => {
    const ranks = snap.entries.map((e) => e.rank);
    expect(ranks[0]).toBe(1);
    expect(ranks).toEqual([...ranks].sort((a, b) => a - b));
    expect(new Set(ranks).size).toBe(ranks.length);
    expect(ranks[ranks.length - 1]).toBe(ranks.length);
  });

  /**
   * Strong, season-independent check that points came from the right column:
   * read the wrong one and this sequence stops being monotonic.
   */
  it("points are non-increasing as rank increases", () => {
    for (let i = 1; i < snap.entries.length; i++) {
      const prev = snap.entries[i - 1]!;
      const cur = snap.entries[i]!;
      expect(
        prev.points,
        `rank ${prev.rank} (${prev.points}) should not have fewer points than rank ${cur.rank} (${cur.points})`,
      ).toBeGreaterThanOrEqual(cur.points);
    }
  });

  it("the world number one has a plausible points total", () => {
    const top = snap.entries[0]!;
    expect(top.points).toBeGreaterThan(4000);
    expect(top.points).toBeLessThan(20000);
    expect(snap.entries[snap.entries.length - 1]!.points).toBeGreaterThan(0);
  });

  it("every entry has a slug-shaped id and a multi-token name", () => {
    for (const e of snap.entries) {
      expect(e.slug).toMatch(/^[a-z0-9-]+$/);
      expect(e.fullName.trim().split(/\s+/).length).toBeGreaterThanOrEqual(2);
    }
  });

  it("slugs are unique", () => {
    const slugs = snap.entries.map((e) => e.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
  });

  it("country codes are 3-letter IOC codes where present, on ≥95% of rows", () => {
    const withCountry = snap.entries.filter((e) => e.countryCode);
    for (const e of withCountry) {
      expect(e.countryCode).toMatch(/^[A-Z]{3}$/);
    }
    expect(withCountry.length / snap.entries.length).toBeGreaterThanOrEqual(0.95);
  });

  // The tour's own player id. Resolving players by slug alone created a second
  // player whenever atptour.com's slug differed from ours ("christopher-o'connell"
  // vs "christopher-oconnell") — 34 duplicates the week the list went to 500.
  it("carries atptour.com's player id on every row", () => {
    expect(snap.entries.every((e) => /^[a-z0-9]{4}$/.test(e.externalId ?? ""))).toBe(true);
    expect(snap.entries.find((e) => e.fullName === "Jannik Sinner")?.externalId).toBe("s0ag");
    expect(new Set(snap.entries.map((e) => e.externalId)).size).toBe(snap.entries.length);
  });

  it("tags the snapshot as ATP, not race", () => {
    expect(snap.tour).toBe("atp");
    expect(snap.isRace).toBe(false);
  });

  it("passes the full RankingSnapshot Zod schema", () => {
    expect(() => RankingSnapshot.parse(snap)).not.toThrow();
  });
});

describe("snapshotSanityCheck", () => {
  const snap = parseAtpRankings({ html: fixture, weekOf: "2026-08-31" });

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
