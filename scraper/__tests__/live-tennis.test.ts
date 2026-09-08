import { readFileSync } from "node:fs";
import { describe, it, expect } from "vitest";
import { parseLiveTennisHtml, comparisonSlug, ltPath, namesMatch } from "../sources/live-tennis";

/**
 * Offline contract test for the live-tennis.eu parser, against a real capture
 * (2026-09-03, /en/official-atp-ranking).
 *
 * This exists because the parser silently broke: LT switched from unquoted to
 * quoted class attributes (`class=rk` -> `class="rk"`), every regex stopped
 * matching, and the parser returned an empty array. The only consumer was a
 * LIVE_TESTS-gated test whose warn-and-bail branches then passed while
 * comparing nothing at all. A layout change should fail here, in 200ms, with
 * no network.
 */
const fixture = readFileSync(
  new URL("../__fixtures__/live-tennis-atp-official.html", import.meta.url),
  "utf-8",
);

describe("parseLiveTennisHtml", () => {
  const rows = parseLiveTennisHtml(fixture);

  it("parses a substantial number of rows (not zero)", () => {
    expect(rows.length).toBeGreaterThanOrEqual(100);
  });

  it("ranks start at 1 and are ascending", () => {
    expect(rows[0]!.rank).toBe(1);
    const ranks = rows.map((r) => r.rank);
    expect(ranks).toEqual([...ranks].sort((a, b) => a - b));
  });

  it("reads a name and a points total for every row", () => {
    for (const r of rows.slice(0, 100)) {
      expect(r.fullName.trim().length).toBeGreaterThan(2);
      expect(r.points, `rank ${r.rank} ${r.fullName} has no points`).not.toBeNull();
      expect(r.points!).toBeGreaterThan(0);
    }
  });

  /**
   * The structural check that catches a column shift: read the wrong cell and
   * this monotonicity breaks immediately.
   */
  it("points are non-increasing as rank increases", () => {
    for (let i = 1; i < Math.min(rows.length, 150); i++) {
      expect(
        rows[i - 1]!.points!,
        `rank ${rows[i - 1]!.rank} (${rows[i - 1]!.points}) vs rank ${rows[i]!.rank} (${rows[i]!.points})`,
      ).toBeGreaterThanOrEqual(rows[i]!.points!);
    }
  });

  it("does not read the age column as points", () => {
    // Ages are 15-45; a points total at the top of the game is thousands.
    expect(rows[0]!.points!).toBeGreaterThan(1000);
  });
});

describe("comparisonSlug", () => {
  /**
   * The whole point of the sorted variant: sources disagree on token ORDER
   * for multi-part names, and `reorderName()` in tennis-explorer-rankings.ts
   * rotated them, which created phantom duplicate players.
   */
  it("treats rotated name tokens as the same person when sorting", () => {
    expect(comparisonSlug("Juan Manuel Cerundolo", true)).toBe(
      comparisonSlug("Manuel Cerundolo Juan", true),
    );
    expect(comparisonSlug("Thiago Agustin Tirante", true)).toBe(
      comparisonSlug("Agustin Tirante Thiago", true),
    );
    expect(comparisonSlug("Roman Andres Burruchaga", true)).toBe(
      comparisonSlug("Andres Burruchaga Roman", true),
    );
  });

  it("keeps order significant when not sorting", () => {
    expect(comparisonSlug("Juan Manuel Cerundolo")).toBe("juan-manuel-cerundolo");
    expect(comparisonSlug("Manuel Cerundolo Juan")).toBe("manuel-cerundolo-juan");
  });

  it("strips accents", () => {
    expect(comparisonSlug("Félix Auger-Aliassime")).toBe("felix-auger-aliassime");
  });

  it("does not conflate genuinely different people", () => {
    expect(comparisonSlug("Carlos Alcaraz", true)).not.toBe(
      comparisonSlug("Jannik Sinner", true),
    );
  });
});

describe("ltPath", () => {
  it("builds the six page paths", () => {
    expect(ltPath("atp", "official")).toBe("/en/official-atp-ranking");
    expect(ltPath("wta", "official")).toBe("/en/official-wta-ranking");
    expect(ltPath("atp", "race")).toBe("/en/atp-race");
    expect(ltPath("wta", "race")).toBe("/en/wta-race");
    expect(ltPath("atp", "live")).toBe("/en/atp-live-ranking");
    expect(ltPath("wta", "live")).toBe("/en/wta-live-ranking");
  });
});

describe("namesMatch must not cross-match different players", () => {
  /**
   * These three are distinct ATP players. An edit-distance rule scaled by
   * name length paired all of them, which attributed Arthur Fils's points to
   * Arthur Fery and produced a phantom +1737 discrepancy.
   */
  it.each([
    ["Arthur Fery", "Arthur Fils"],
    ["Arthur Gea", "Arthur Fery"],
    ["Arthur Gea", "Arthur Fils"],
    ["Ekaterina Maklakova", "Ekaterina Makarova"],
    ["Carlos Alcaraz", "Carlos Taberner"],
  ] as const)("%s is not %s", (a, b) => {
    expect(namesMatch(a, b)).toBe(false);
  });

  it("still matches genuine transliterations sharing a token", () => {
    expect(namesMatch("Liudmila Samsonova", "Ludmilla Samsonova")).toBe(true);
    expect(namesMatch("Yuliia Starodubtseva", "Yulia Starodubtseva")).toBe(true);
  });

  it("still matches rotations and splits without fuzzy", () => {
    expect(namesMatch("Juan Manuel Cerundolo", "Manuel Cerundolo Juan", { fuzzy: false })).toBe(true);
    expect(namesMatch("Yeon Woo Ku", "Yeonwoo Ku", { fuzzy: false })).toBe(true);
  });
});
