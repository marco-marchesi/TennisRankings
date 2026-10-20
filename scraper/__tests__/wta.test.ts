import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { describe, it, expect } from "vitest";
import { parseWtaRankings } from "../sources/wta";
import { RankingSnapshot } from "../validate";

const fixturePath = new URL("../__fixtures__/wta-rankings.html", import.meta.url);
const fixtureBytes = readFileSync(fixturePath);
const fixture = fixtureBytes.toString("utf-8");

/**
 * Contract test against a real wtatennis.com capture (2026-09-03).
 *
 * Assertions are deliberately STRUCTURAL. The previous version asserted
 * "Aryna Sabalenka at #1 with points > 5000", which says nothing about the
 * parser and fails for the wrong reason the moment the world number one
 * changes. What we actually want to detect is a WTA redesign breaking the
 * BEM class hooks (`tr.player-row`, `player-row__cell--*`,
 * `data-player-name`) that `sources/wta.ts` depends on.
 */
describe("parseWtaRankings (contract test against real wtatennis.com HTML)", () => {
  const snap = parseWtaRankings({ html: fixture, weekOf: "2026-08-31" });

  /**
   * Pins the fixture so re-recording it is a deliberate, visible act rather
   * than something that quietly changes what the suite proves.
   */
  it("fixture has not been re-recorded without updating this test", () => {
    const sha = createHash("sha256").update(fixtureBytes).digest("hex");
    expect(sha).toBe("d2d852fa772802caeaa1ea2949a32833439fa0d8e1ce5790d65ca05aba36a53c");
  });

  /**
   * 200, not 100. The WTA page paginates at 50 rows behind a `js-load-more`
   * button, and `fetch-live.ts` used to give up silently after the first
   * click timed out — yielding exactly 50 rows, below the zod floor of 100,
   * so no WTA ranking was written between 2026-05 and 2026-09. This fixture
   * is a post-fix capture; asserting 200 keeps that regression visible.
   */
  // See the ATP test of the same name: slug-only resolution duplicated every
  // player whose WTA spelling differed from ours ("Vaidehee" / "Vaidehi").
  it("carries wtatennis.com's player id on every row", () => {
    expect(snap.entries.every((e) => /^\d+$/.test(e.externalId ?? ""))).toBe(true);
    expect(snap.entries.find((e) => e.fullName === "Aryna Sabalenka")?.externalId).toBe("320760");
    expect(new Set(snap.entries.map((e) => e.externalId)).size).toBe(snap.entries.length);
  });

  it("parses a fully expanded page (200 rows, not the unexpanded 50)", () => {
    expect(snap.entries.length).toBeGreaterThanOrEqual(200);
  });

  it("ranks are contiguous from 1, ascending and unique", () => {
    const ranks = snap.entries.map((e) => e.rank);
    expect(ranks[0]).toBe(1);
    expect(ranks).toEqual([...ranks].sort((a, b) => a - b));
    expect(new Set(ranks).size).toBe(ranks.length);
    expect(ranks[ranks.length - 1]).toBe(ranks.length);
  });

  /**
   * A strong, season-independent parser check: if points were read from the
   * wrong column, the sequence would not be monotonic.
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
    expect(top.points).toBeGreaterThan(3000);
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

  it("tags the snapshot as WTA, not race", () => {
    expect(snap.tour).toBe("wta");
    expect(snap.isRace).toBe(false);
  });

  it("passes the full RankingSnapshot Zod schema", () => {
    expect(() => RankingSnapshot.parse(snap)).not.toThrow();
  });
});
