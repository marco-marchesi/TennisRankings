import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { parseDailyMatchList } from "../sources/tennis-explorer";

const fixture = (name: string) =>
  readFileSync(resolve(import.meta.dirname, "../__fixtures__", name), "utf8");

describe("parseDailyMatchList", () => {
  // On 2026-09-29 TennisExplorer rendered a two-match "UTR Pro Tennis Series 9"
  // table ABOVE the main results table. The parser read only
  // `table.result`.first(), so the whole day collapsed to 2 matches and every
  // Beijing / Tokyo result played that day was missing from the database.
  it("reads every main-content results table, not just the first", () => {
    const refs = parseDailyMatchList(fixture("te-matches-atp-2026-09-29.html"));
    const names = new Set(refs.map((r) => r.tournamentName));
    // 219 match-detail links in the main table = ~109 matches (two links each).
    expect(refs.length).toBeGreaterThan(100);
    expect(names.has("UTR Pro Tennis Series 9")).toBe(true);
    expect(names.has("Chengdu")).toBe(true);
  });

  it("ignores the sidebar tables", () => {
    const refs = parseDailyMatchList(fixture("te-matches-atp-2026-09-28.html"));
    // 271 detail links live in the one main table; the sidebar holds 6 more
    // ("interesting matches") that duplicate or add unrelated rows.
    expect(refs.length).toBeGreaterThan(100);
    expect(refs.length).toBeLessThanOrEqual(271 / 2 + 1);
  });

  it("never emits the same TE match twice", () => {
    const refs = parseDailyMatchList(fixture("te-matches-atp-2026-09-29.html"));
    const ids = refs.map((r) => r.teMatchId);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
