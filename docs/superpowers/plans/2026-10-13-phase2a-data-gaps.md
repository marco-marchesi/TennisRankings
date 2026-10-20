# Phase 2a — Replay Data Gaps Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Score 2023-2025 results with the points tables that were actually in force, place every 2023-2025 ATP Challenger in its tier, score ITF women's events and the United Cup, so the replay's clean subset grows from ~1k / ~2.8k player-weeks to most of the window and the Phase 1b rule choices can be re-judged on real volume.

**Architecture:** A new `scraper/replay/points-eras.ts` holds per-season tables transcribed from cited sources and answers `eraPoints(tour, tier, round, variant, start)`; `editions.ts` asks it instead of the 2026-only `points-table.ts`, and emits a `points_era:*` gap only where no source exists. Challenger tiers for 2023-2025 come from Wikipedia's season pages (one row per edition: week, city, "Challenger NNN"), parsed into the existing `challenger-calendar.json`. Every change is judged by `pnpm replay` on the clean subset.

**Tech Stack:** TypeScript (tsx), Vitest, cheerio-free wikitext parsing, `scraper/http.ts` politeFetch.

**Spec:** `docs/superpowers/specs/2026-10-12-ranking-accounting-design.md` (Phase 2, "Known gaps up front", non-negotiables).

## Global Constraints

- No fitting to live-tennis.eu; no per-player overrides.
- Unknown tier or unsourced table = explicit gap (`points_era:<what>`, `challenger_tier`, `itf_wNN`), never a default.
- Every table cites its source (URL + access date) in a comment beside it.
- `pnpm replay:check` must stay green; baseline lowered only with `--force` and a ruling line in the ledger.
- Unit tests are offline: wikitext comes from fixtures in `scraper/__fixtures__/`.
- Commits only when the user asks (project rule) — "Commit" steps below become "stage and note in the ledger".

## Source findings (2026-10-13, Wikipedia raw wikitext)

| Table | 2023 | 2024 | 2025 | 2026 (docs/ranking-rules.md) |
|---|---|---|---|---|
| ATP Slam / 1000 / 500 / 250 main draw | old (F 1200, 1000 F 600, 500 F 300, 250 F 150) | new | = 2024 | = 2024 |
| ATP Slam qualifier bonus ("Q") | 25 | **30** | **30** | 25 ← conflict |
| ATP 1000 96S qualifying Q / Q2 / Q1 | 16 / 8 / 0 | **20 / 10 / 0** | 20 / 10 / 0 | 25 / 16 / 8 ← conflict |
| ATP 1000 56S qualifying Q / Q2 / Q1 | 25 / 16 / 0 | **30 / 16 / 0** | 30 / 16 / 0 | 25 / 16 / 8 ← conflict |
| Challenger (all tiers) | 175: 175/100/60/32/15/0 | 175: 175/90/50/25/13/**0** | = 2024 | R32 6/5/4/3/3 ← conflict (likely the Q column) |
| Challenger qualifier bonus (Q) | 6/5/5/4/3 | 6/5/4/4/3 | = 2024 | not modelled (0) |
| WTA 500 / 250 | 470 / 280 tables | 500 / 250 tables | = 2024 | = 2024 |
| WTA non-combined 1000 | 900 table | not listed separately | 1000 table (docs :319) | 1000 table |
| WTA non-combined 1000 qualifying | — | — | Q 30 / Q2 20 / Q1 2 (64/56S row) | ours: 25 / 13 / 1 ← conflict |
| WTA ITF | W25/W40/W60/W80/W100 (+H) | W15/W35/W50/W75/W100 | = 2024 | docs: winner only |
| ITF men M15/M25 | not found | not found | M25 25/16/8/3/1, M15 15/8/4/2/1 | = 2025 |

Sources: `https://en.wikipedia.org/w/index.php?title=<YEAR>_ATP_Tour&action=raw` (section "Point distribution"), `<YEAR>_WTA_Tour` ("Points distribution"), `<YEAR>_ATP_Challenger_Tour` ("Point distribution" + "Schedule"), `<YEAR>_ITF_Women's_World_Tennis_Tour` ("WTA ranking points distribution"), `2025_ITF_Men's_World_Tennis_Tour`. Wikipedia cites the ATP rulebook / FAQ and ITF PDFs for each.

The "conflict" rows are NOT decided by this table. Task 5 decides each one by replay on the season it applies to.

## Review Focus

1. A December-dated row on a season page (ATP 2025 Challengers start "December 30" = 2024-12-30) — must get the previous year, else the edition is unplaced.
2. A city hosting two editions a few weeks apart at different tiers ("Nonthaburi Challenger II") — lookup is city AND date; the parser must not merge them.
3. An edition that straddles a season boundary (United Cup starting 2023-12-29 is a 2024-season event) — era chosen by season start, not calendar year.
4. A WTA ITF "+H" (hospitality) level at an era that has no +H row — gap, not the non-H table.
5. A replay run after this phase whose clean exact rate falls because more (harder) weeks entered the clean subset — that is a composition change, not a regression; the ledger must say so before `--force`.

---

### Task 1: Season tables (`points-eras.ts`)

**Files:**
- Create: `scraper/replay/points-eras.ts`
- Test: `scraper/__tests__/replay-points-eras.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export type Season = 2023 | 2024 | 2025 | 2026;
  export type ReplayTier = Category | `itf_w${number}` | `itf_w${number}h`;
  export function seasonOf(tour: Tour, start: string): Season | null; // null = before 2023 season
  export interface EraLookup { table: Partial<Record<Round, number>>; qualifierBonus: number }
  export function eraTable(tour: Tour, tier: ReplayTier, season: Season, variant?: DrawVariant): EraLookup | null; // null = unsourced
  ```

- [ ] **Step 1: Write failing tests** pinning one row per source table and every boundary:

```ts
import { describe, expect, it } from "vitest";
import { eraTable, seasonOf } from "@scraper/replay/points-eras";
import { pointsForRound } from "@scraper/config/points-table";

describe("seasonOf", () => {
  it("dates a season by its first ranking week, not the calendar year", () => {
    expect(seasonOf("atp", "2023-12-29")).toBe(2024); // United Cup 2024
    expect(seasonOf("atp", "2024-12-30")).toBe(2025);
    expect(seasonOf("wta", "2023-01-02")).toBe(2023);
    expect(seasonOf("atp", "2022-11-14")).toBeNull();
  });
});

describe("eraTable", () => {
  it("ATP 2023 main draw is the old table", () => {
    expect(eraTable("atp", "grand_slam", 2023)!.table.F).toBe(1200);
    expect(eraTable("atp", "atp_500", 2023)!.table.F).toBe(300);
    expect(eraTable("atp", "atp_250", 2023, "d48")!.table.R32).toBe(10);
  });
  it("ATP 2024 and 2025 main draw equal the live 2026 table", () => {
    for (const season of [2024, 2025] as const)
      for (const r of ["W", "F", "SF", "QF", "R16", "R32", "R64", "R128"] as const)
        expect(eraTable("atp", "grand_slam", season)!.table[r] ?? 0).toBe(pointsForRound("grand_slam", r));
  });
  it("Challenger: 2023 vs 2024 tables, R32 zero", () => {
    expect(eraTable("atp", "ch_175", 2023)!.table.F).toBe(100);
    expect(eraTable("atp", "ch_175", 2024)!.table.F).toBe(90);
    expect(eraTable("atp", "ch_125", 2025)!.table.R32 ?? 0).toBe(0);
    expect(eraTable("atp", "ch_100", 2024)!.qualifierBonus).toBe(4);
  });
  it("WTA 2023 500 / 250 / non-combined 1000", () => {
    expect(eraTable("wta", "wta_500", 2023)!.table.W).toBe(470);
    expect(eraTable("wta", "wta_250", 2023)!.table.W).toBe(280);
    expect(eraTable("wta", "wta_1000_nc", 2023)!.table.W).toBe(900);
  });
  it("WTA ITF tiers per era, draw-dependent", () => {
    expect(eraTable("wta", "itf_w60", 2023, "d32")!.table.W).toBe(80);
    expect(eraTable("wta", "itf_w60h", 2023, "d32")!.table.W).toBe(100);
    expect(eraTable("wta", "itf_w35", 2024, "d32")!.table.R16).toBe(4);
    expect(eraTable("wta", "itf_w75", 2025, "d48")!.table.R32).toBe(5);
  });
  it("unsourced combinations are null, never a neighbour's table", () => {
    expect(eraTable("wta", "wta_1000_nc", 2024)).toBeNull();
    expect(eraTable("wta", "itf_w35", 2023)).toBeNull(); // no W35 in 2023
    expect(eraTable("atp", "m25_futures", 2023)).toBeNull();
    expect(eraTable("wta", "itf_w50h", 2024)).toBeNull();
  });
});
```

- [ ] **Step 2: Run** `pnpm vitest run scraper/__tests__/replay-points-eras.test.ts` — expect FAIL (module missing).

- [ ] **Step 3: Implement.** Transcribe the tables from the "Source findings" section verbatim (all rows of each Wikipedia table, singles only), one `const` per table with its source URL and access date in a comment. Season starts: `{2023: "2022-12-26", 2024: "2023-12-25", 2025: "2024-12-23", 2026: "2025-12-22"}` (the Monday of the week holding each season's first event). Seasons 2024/2025 ATP tour tiers and 2026 everything delegate to `pointsForRound` / `qualifierBonus` from `points-table.ts` **except** the conflict rows, which Task 5 settles; until then `eraTable` returns the Wikipedia value for 2024/2025 and the live table for 2026. Map the Wikipedia "Q" column to `qualifierBonus` and Q2/Q1 to our Q2/Q1 (non-Slam) or Q3/Q2/Q1 (Slam), matching `editions.ts` `scorePlayer`'s ladder. WTA ITF variant: `d48` = "48S, 32Q" row, `d32` = "32S, 32/24Q" row; a 32S event with a 48/64 qualifying draw uses its own row where the page lists one.

- [ ] **Step 4: Run tests** — expect PASS. Then `pnpm typecheck`.

- [ ] **Step 5: Stage** both files; ledger line "Task 1 done".

### Task 2: Score editions by season; WTA best 16 before 2024

**Files:**
- Modify: `scraper/replay/editions.ts` (drop `FIRST_SOURCED_SEASON`; use `eraTable`), `scraper/replay/category.ts` (ITF W levels → `ReplayTier` instead of gap), `scraper/replay/types.ts` (`Edition.tier: ReplayTier | null`), `scraper/replay/rules.ts` (WTA weeks before the 2024 season: flat best 16)
- Test: `scraper/__tests__/replay-editions.test.ts`, `replay-category.test.ts`, `replay-ledger.test.ts`

**Interfaces:**
- Consumes: `seasonOf`, `eraTable`, `ReplayTier` (Task 1).
- Produces: `PlayerResult.gaps` contains `points_era:<tour>:<tier>:<season>` only when `eraTable` is null; `itf_wNN` gaps disappear for sourced eras.

- [ ] **Step 1: Failing tests:**
  - editions: a 2023 ATP 500 (32 draw) final loser scores 300; a 2024 one 330, neither carries a gap.
  - editions: a 2024 WTA W35 (draw 32) semifinal loser scores 14 with no gap; a 2023 level "35" edition carries `points_era:wta:itf_w35:2023`.
  - editions: a 2024 Doha (`wta_1000_nc`) result carries `points_era:wta:wta_1000_nc:2024`.
  - category: `archiveCategory("wta", "60+H", ...)` → tier `itf_w60h`, gap null.
  - rules: `countingRules("wta", "2023-06-05")` → flat, `bestN` 16, no slots; `"2024-01-08"` → slot structure, 18.
- [ ] **Step 2: Run** them — FAIL.
- [ ] **Step 3: Implement.** In `scorePlayer` replace `pointsForRound(cat, …)` / `qualifierBonus(cat)` with the `EraLookup` for `(tour, tier, seasonOf(tour, start), variant)`; null lookup ⇒ points 0 + gap. Keep Finals on `finalsPoints` (2023 WTA Finals: +125/RR match… is NOT sourced precisely → gap `points_era:wta:finals:2023`). WTA best-16 source: 2023 WTA Rulebook XVI ("best 16 singles results"); WTA 2024 best 18 — cite in the comment.
- [ ] **Step 4: Run** the replay tests, then the full suite `pnpm test`.
- [ ] **Step 5: Measure:** `pnpm replay` — record the trend line in the ledger. Expect the clean subset to grow several-fold. Any clean exact rate drop goes to the ledger with the composition explanation (Review Focus 5) before `pnpm replay -- --update-baseline --force`.

### Task 3: 2023-2025 Challenger tiers from Wikipedia

**Files:**
- Create: `scraper/sources/wikipedia-challenger.ts`, `scraper/challenger-history.ts` (CLI), fixture `scraper/__fixtures__/wiki-2025-atp-challenger-excerpt.txt` (January table + one December row + a "II" edition, trimmed from the real page)
- Modify: `package.json` (`"scraper:challenger-history": "tsx scraper/challenger-history.ts"`), `scraper/config/challenger-calendar.json` (generated), CLAUDE.md commands list
- Test: `scraper/__tests__/wikipedia-challenger.test.ts`

**Interfaces:**
- Consumes: `ChallengerEvent`, `cityKey`, `saveChallengerEvents` from `scraper/sources/atp-challenger-calendar.ts`.
- Produces: `parseWikiChallengerSeason(wikitext: string, season: number): ChallengerEvent[]`.

- [ ] **Step 1: Failing tests** on the fixture:

```ts
const events = parseWikiChallengerSeason(fixture, 2025);
expect(events).toContainEqual(expect.objectContaining({ city: "canberra", start: "2024-12-30", end: "2025-01-05", tier: 125 }));
expect(events.filter((e) => e.city === "nonthaburi").map((e) => e.start)).toEqual(["2024-12-30", "2025-01-06"]);
expect(events.every((e) => [50, 75, 100, 125, 175].includes(e.tier))).toBe(true);
// cancelled rows (no "Challenger NNN") are skipped, not defaulted
```

- [ ] **Step 2: Run** — FAIL.
- [ ] **Step 3: Implement.** Walk the wikitext line by line: a `|rowspan=N|<Month> <Day>||` cell sets the current week; a tournament cell `[[...]]<br/>[[City]], Country <br/> Surface – Challenger NNN – ...` yields one event (`city = cityKey` of the link text's display part; `end = start + 6`). A month later than the page's January in a season's first table (December) means `season - 1`. The CLI fetches `https://en.wikipedia.org/w/index.php?title=<Y>_ATP_Challenger_Tour&action=raw` through `politeFetch` for `--years 2023,2024,2025`, refuses to save when a season parses fewer than 150 events, and merges via `saveChallengerEvents`.
- [ ] **Step 4: Run tests**, then `pnpm scraper:challenger-history -- --years 2023,2024,2025`; `git diff --stat scraper/config/challenger-calendar.json`.
- [ ] **Step 5: Measure:** `pnpm replay`; the `challenger_tier` cause count must drop by ≥ 90%. List the unresolved archive names (archive name ≠ city, e.g. sponsor names) in the ledger; fix by alias only when the date and tier match a single event — never by guessing a tier.

### Task 4: United Cup

**Files:**
- Modify: `scraper/replay/archive.ts` + `types.ts` (`winnerRank`, `loserRank` from `winner_rank`/`loser_rank`), `scraper/replay/category.ts` (`united_cup` → tier, not gap, for seasons with a sourced table), `scraper/replay/editions.ts` (per-match scoring)
- Create: `scraper/replay/united-cup.ts`
- Test: `scraper/__tests__/replay-united-cup.test.ts`

**Interfaces:**
- Produces: `unitedCupPoints(season: Season, stage: "RR" | "QF" | "SF" | "F", oppRank: number | null): number | null` (null = unsourced, e.g. unranked opponent band missing).

- [ ] **Step 1:** Fetch the "Points distribution"/"Ranking points" section of `2023_United_Cup`, `2024_United_Cup`, `2025_United_Cup` (raw wikitext) and transcribe each into `united-cup.ts` with its citation. If a season's page has no table, that season stays a gap.
- [ ] **Step 2: Failing tests:** a 2024 group-stage win over a #8 scores 55 (docs :131-139), a final win over #300 scores 35, a loss scores 0, a sum across matches equals the per-player result, an unsourced season returns null.
- [ ] **Step 3: Run** — FAIL. **Step 4: Implement** (sum of per-win values per player; ATP only — the WTA does not award United Cup points per docs :486; verify in the 2024 WTA table which lists United Cup "500 (max)" → if WTA awards them, score WTA too and say so in the ledger). **Step 5: Run tests; `pnpm replay`; record.**

### Task 5: Settle the table conflicts by replay

**Files:**
- Modify: `scraper/replay/points-eras.ts` (one switch per conflict, default = source value), `scraper/replay/cli.ts` (`--table <conflict>=<value>`), and — only for conflicts the replay settles against our live table — `scraper/config/points-table.ts` + `scraper/config/points-table.test.ts` + `docs/ranking-rules.md`
- Test: `scraper/__tests__/replay-points-eras.test.ts`

Conflicts (name = the CLI key): `atp-slam-qbonus` (25|30), `atp-1000-q` (wiki|docs), `wta-1000nc-q` (wiki|ours), `ch-r32` (0|docs), `ch-qbonus` (wiki|0).

- [ ] **Step 1: Failing test** that `--table ch-r32=docs` makes `eraTable("atp","ch_175",2026).table.R32 === 6` and the default is 0 for 2024/2025.
- [ ] **Step 2–3:** implement the switches; run tests.
- [ ] **Step 4:** For each conflict, run the replay on the season it concerns (2026 conflicts: `--from 2026-01-05`; 2024/25: full window) with each value, delta and full, and read the **clean** rates and their N. Table the results in the ledger.
- [ ] **Step 5:** A value is adopted only when it wins on the clean subset with a margin the ledger states in player-weeks. If it differs from `points-table.ts`, change the live table and its test with the citation "replay 2026-10-13, clean subset, +N player-weeks" plus the source. Ties stay with the written source.

### Task 6: Re-judge, re-baseline, document, review

**Files:**
- Modify: `scraper/replay/rules.ts` (DEFAULT_VARIANT only if the re-run changes the winner), `scraper/replay/baseline.json`, spec "Measured baseline" + "Phase 2a" section, `CLAUDE.md` (replay section: seasons are sourced 2023+), memory `replay-judge-clean-subset.md`

- [ ] **Step 1:** Re-run all Phase 1b variants (`pnpm replay -- --rules <v>` for each in `RULE_VARIANTS` plus `refill>50/100/200`) on the grown clean subset; table them in the spec.
- [ ] **Step 2:** Re-test the bye rule (docs :68) as a variant if the residuals show bye-holders in the worst list.
- [ ] **Step 3:** `pnpm replay -- --update-baseline` (no `--force` unless the ledger carries the ruling); `pnpm test`, `pnpm typecheck`, `pnpm lint`.
- [ ] **Step 4:** Dispatch a fresh code reviewer (opus) over the Phase 2a diff with the spec; fix findings test-first.
- [ ] **Step 5:** Update the spec, CLAUDE.md, memory; report to the user with the before/after table.

---

Phase 2b (canonical `edition_key` / `match_key` on `player_recent_matches`, every reader on the new dedupe key) gets its own plan after this one lands, written from these numbers.
