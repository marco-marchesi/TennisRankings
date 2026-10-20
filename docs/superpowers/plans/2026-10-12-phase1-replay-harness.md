# Phase 1 — Replay Harness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Score our ranking rules against the official weekly ATP/WTA rankings, every week from 2023 to 2026-06, so every future rule or data change is measured instead of guessed.

**Architecture:** A self-contained `scraper/replay/` module. It caches the Sackmann archive locally, groups matches into editions by `tourney_id`, scores each player's result per edition with the existing points table and a strict tier mapping that reports unknowns as gaps, builds each player's 52-week ledger at every official week, and compares totals to the official ones in two modes (full ledger, and week-to-week delta). A CLI writes a markdown report, a trend line, and gates on a committed baseline.

**Tech Stack:** TypeScript (tsx), Vitest, Node `fetch` + `fs`. No DB access — the replay runs entirely on the archive.

**Spec:** `docs/superpowers/specs/2026-10-12-ranking-accounting-design.md`

## Global Constraints

- No fitting to live-tennis.eu; no per-player overrides; no fudge factors.
- An unknown tier is a gap (`category: null` + gap string), never a default tier.
- Every rule constant cites `docs/ranking-rules.md` or replay evidence.
- Tests are offline: no network, no DB. Data comes from inline fixtures.
- The archive is untrusted data: parsed as CSV text only, cached under `data/archive/` (gitignored).
- `scraper/` code imports no Next.js/React.

## Review Focus

1. A tour event's qualifying rows live in `*_qual_chall` / `*_qual_itf` with the SAME `tourney_id` as its main draw in `*_matches_YYYY` — they must form ONE edition, or qualifiers are scored twice. (Task 3 test "merges qualifying from another file".)
2. Ranking weeks are not always 7 days apart (holiday freezes, two-week events). Delta mode must charge everything entering/leaving in `(w0, w1]`, however long. (Task 5 test "spans a two-week gap".)
3. A ranked player with no results in our data (protected ranking, missing ITF event) must be reported with cause `no_results`, never crash or vanish. (Task 5 test.)
4. Malformed archive rows (blank `tourney_id`, non-numeric points, missing date) are skipped and counted, not thrown. (Task 1 test.)
5. A player whose deepest recorded main-draw match was a WIN but who has no later match (incomplete draw data) is credited the next round AND flagged `incomplete_edition`. (Task 3 test.)

---

### Task 1: Archive cache and parsers

**Files:**
- Create: `scraper/replay/types.ts`
- Create: `scraper/replay/archive.ts`
- Modify: `scraper/sources/tennis-abstract.ts:191` (export `parseCsv`)
- Modify: `.gitignore` (add `data/archive/`)
- Test: `scraper/__tests__/replay-archive.test.ts`

**Interfaces:**
- Produces: types `Tour`, `ArchiveMatch`, `OfficialRow`, `Edition`, `PlayerResult`; functions `toArchiveMatch(row)`, `toOfficialRow(row)`, `parseMatches(text)`, `parseOfficial(text, from, to, into)`, `loadMatches(tour, years, refresh?)`, `loadOfficial(tour, from, to, refresh?)`, `loadPlayerNames(tour, refresh?)`.

- [ ] **Step 1: Write the failing test**

```ts
// scraper/__tests__/replay-archive.test.ts
import { describe, expect, it } from "vitest";
import { parseMatches, parseOfficial, toArchiveMatch, toOfficialRow } from "@scraper/replay/archive";
import type { OfficialRow } from "@scraper/replay/types";

const MATCH_HEADER =
  "tourney_id,tourney_name,surface,draw_size,tourney_level,tourney_date,match_num,winner_id,winner_seed,winner_entry,winner_name,winner_hand,winner_ht,winner_ioc,winner_age,loser_id,loser_seed,loser_entry,loser_name,loser_hand,loser_ht,loser_ioc,loser_age,score,best_of,round,minutes";

describe("toArchiveMatch", () => {
  it("reads the fields the replay needs", () => {
    const m = toArchiveMatch({
      tourney_id: "2025-580", tourney_name: "Australian Open", draw_size: "128",
      tourney_level: "G", tourney_date: "20250113", winner_id: "1", loser_id: "2",
      winner_entry: "Q", loser_entry: "", score: "6-1 6-2 6-3", round: "R128",
    });
    expect(m).toEqual({
      tourneyId: "2025-580", tourneyName: "Australian Open", level: "G", drawSize: 128,
      tourneyDate: "2025-01-13", round: "R128", winnerId: "1", loserId: "2",
      winnerEntry: "Q", loserEntry: null, score: "6-1 6-2 6-3",
    });
  });

  it("rejects a row without an edition id or date", () => {
    expect(toArchiveMatch({ tourney_id: "", tourney_date: "20250113", winner_id: "1", loser_id: "2", round: "F" })).toBeNull();
    expect(toArchiveMatch({ tourney_id: "x", tourney_date: "", winner_id: "1", loser_id: "2", round: "F" })).toBeNull();
  });
});

describe("parseMatches", () => {
  it("skips malformed rows and counts them", () => {
    const text = [
      MATCH_HEADER,
      "2025-580,Australian Open,Hard,128,G,20250113,1,1,,,A,R,,ITA,,2,,,B,R,,USA,,6-1 6-2 6-3,5,R128,90",
      ",Broken,Hard,128,G,20250113,2,1,,,A,R,,ITA,,2,,,B,R,,USA,,6-1,5,R128,90",
    ].join("\n");
    const { matches, skipped } = parseMatches(text);
    expect(matches).toHaveLength(1);
    expect(skipped).toBe(1);
  });
});

describe("toOfficialRow / parseOfficial", () => {
  it("reads rank, points and the optional tours column", () => {
    expect(toOfficialRow({ ranking_date: "20260105", rank: "1", player: "214544", points: "10490", tours: "17" }))
      .toEqual({ week: "2026-01-05", rank: 1, playerId: "214544", points: 10490, tours: 17 });
    expect(toOfficialRow({ ranking_date: "20260105", rank: "3", player: "9", points: "" })).toBeNull();
  });

  it("keeps only weeks inside the window", () => {
    const into = new Map<string, Map<string, OfficialRow>>();
    const text = "ranking_date,rank,player,points\n20221226,1,1,100\n20230102,1,1,110\n20230109,1,1,120";
    const skipped = parseOfficial(text, "2023-01-02", "2023-01-02", into);
    expect([...into.keys()]).toEqual(["2023-01-02"]);
    expect(into.get("2023-01-02")!.get("1")!.points).toBe(110);
    expect(skipped).toBe(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run scraper/__tests__/replay-archive.test.ts`
Expected: FAIL — cannot resolve `@scraper/replay/archive`.

- [ ] **Step 3: Write the implementation**

In `scraper/sources/tennis-abstract.ts` change `function parseCsv(` to `export function parseCsv(`.

Append to `.gitignore`:

```
# replay harness: local cache of the Sackmann archive
data/archive/
```

```ts
// scraper/replay/types.ts
import type { Category, DrawVariant } from "../config/points-table";

export type Tour = "atp" | "wta";

/** One singles match row from the archive's match CSVs. */
export interface ArchiveMatch {
  tourneyId: string;
  tourneyName: string;
  level: string;
  drawSize: number | null;
  /** `tourney_date`: the edition's start week, NOT the day the match was played. */
  tourneyDate: string;
  round: string;
  winnerId: string;
  loserId: string;
  winnerEntry: string | null;
  loserEntry: string | null;
  score: string | null;
}

/** One player's row in an official weekly ranking. */
export interface OfficialRow {
  week: string;
  rank: number;
  playerId: string;
  points: number;
  /** Events counted — present in the WTA files only. */
  tours: number | null;
}

/** One edition of one event, as the archive's `tourney_id` identifies it. */
export interface Edition {
  key: string;
  tour: Tour;
  name: string;
  level: string;
  drawSize: number | null;
  start: string;
  category: Category | null;
  variant: DrawVariant | undefined;
  /** Why `category` is null. */
  gap: string | null;
}

/** What one player earned at one edition, and when it counts. */
export interface PlayerResult {
  playerId: string;
  editionKey: string;
  editionName: string;
  points: number;
  /** First ranking Monday the result counts in. */
  entryWeek: string;
  /** First ranking Monday it no longer counts in. */
  expiryWeek: string;
  isFinals: boolean;
  /** Data-quality flags (tier gap, incomplete draw). Empty when clean. */
  gaps: string[];
}
```

```ts
// scraper/replay/archive.ts
//
// Local cache of the Sackmann archive — the replay's ground truth: official
// weekly rankings with points, and every match with a stable per-edition
// `tourney_id`. Downloaded once into data/archive/ (gitignored) and parsed as
// plain CSV text; nothing in it is ever executed.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { parseCsv } from "../sources/tennis-abstract";
import type { ArchiveMatch, OfficialRow, Tour } from "./types";

const BASE =
  process.env.TA_BASE_URL ?? "https://raw.githubusercontent.com/Aneeshers/tennis-sackmann-archive/main";
export const CACHE_DIR = resolve(process.cwd(), "data", "archive");

/** Every match file for one season: tour level, qualifying/Challenger/125, ITF. */
export function matchFiles(tour: Tour, year: number): string[] {
  return tour === "atp"
    ? [`atp_matches_${year}.csv`, `atp_matches_qual_chall_${year}.csv`, `atp_matches_futures_${year}.csv`]
    : [`wta_matches_${year}.csv`, `wta_matches_qual_itf_${year}.csv`];
}

const RANKING_FILES = (tour: Tour) => [`${tour}_rankings_20s.csv`, `${tour}_rankings_current.csv`];

export async function readArchiveFile(tour: Tour, file: string, refresh = false): Promise<string> {
  const path = join(CACHE_DIR, tour, file);
  if (!refresh && existsSync(path)) return readFileSync(path, "utf8");
  const url = `${BASE}/${tour}/${file}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`[replay] archive fetch ${url} -> ${res.status}`);
  const text = await res.text();
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text);
  return text;
}

const isoCompact = (raw: string | undefined): string | null =>
  raw && /^\d{8}$/.test(raw) ? `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}` : null;
const intOrNull = (raw: string | undefined): number | null =>
  raw && /^\d+$/.test(raw) ? Number(raw) : null;

export function toArchiveMatch(row: Record<string, string>): ArchiveMatch | null {
  const tourneyDate = isoCompact(row.tourney_date);
  if (!row.tourney_id || !tourneyDate || !row.winner_id || !row.loser_id || !row.round) return null;
  return {
    tourneyId: row.tourney_id,
    tourneyName: row.tourney_name ?? "",
    level: row.tourney_level ?? "",
    drawSize: intOrNull(row.draw_size),
    tourneyDate,
    round: row.round,
    winnerId: row.winner_id,
    loserId: row.loser_id,
    winnerEntry: row.winner_entry || null,
    loserEntry: row.loser_entry || null,
    score: row.score || null,
  };
}

export function toOfficialRow(row: Record<string, string>): OfficialRow | null {
  const week = isoCompact(row.ranking_date);
  const rank = intOrNull(row.rank);
  const points = intOrNull(row.points);
  if (!week || rank == null || rank < 1 || points == null || !row.player) return null;
  return { week, rank, playerId: row.player, points, tours: intOrNull(row.tours) };
}

export function parseMatches(text: string): { matches: ArchiveMatch[]; skipped: number } {
  const matches: ArchiveMatch[] = [];
  let skipped = 0;
  for (const row of parseCsv(text)) {
    const m = toArchiveMatch(row);
    if (m) matches.push(m);
    else skipped++;
  }
  return { matches, skipped };
}

/** Adds rows with `from <= week <= to` into `into`; returns how many rows were malformed. */
export function parseOfficial(
  text: string,
  from: string,
  to: string,
  into: Map<string, Map<string, OfficialRow>>,
): number {
  let skipped = 0;
  for (const row of parseCsv(text)) {
    const r = toOfficialRow(row);
    if (!r) {
      skipped++;
      continue;
    }
    if (r.week < from || r.week > to) continue;
    let week = into.get(r.week);
    if (!week) into.set(r.week, (week = new Map()));
    week.set(r.playerId, r);
  }
  return skipped;
}

export async function loadMatches(
  tour: Tour,
  years: number[],
  refresh = false,
): Promise<{ matches: ArchiveMatch[]; skipped: number }> {
  const matches: ArchiveMatch[] = [];
  let skipped = 0;
  for (const y of years) {
    for (const f of matchFiles(tour, y)) {
      const parsed = parseMatches(await readArchiveFile(tour, f, refresh));
      matches.push(...parsed.matches);
      skipped += parsed.skipped;
    }
  }
  return { matches, skipped };
}

export async function loadOfficial(
  tour: Tour,
  from: string,
  to: string,
  refresh = false,
): Promise<{ byWeek: Map<string, Map<string, OfficialRow>>; skipped: number }> {
  const byWeek = new Map<string, Map<string, OfficialRow>>();
  let skipped = 0;
  for (const f of RANKING_FILES(tour)) {
    skipped += parseOfficial(await readArchiveFile(tour, f, refresh), from, to, byWeek);
  }
  return { byWeek, skipped };
}

export async function loadPlayerNames(tour: Tour, refresh = false): Promise<Map<string, string>> {
  const names = new Map<string, string>();
  for (const row of parseCsv(await readArchiveFile(tour, `${tour}_players.csv`, refresh))) {
    if (row.player_id) names.set(row.player_id, `${row.name_first ?? ""} ${row.name_last ?? ""}`.trim());
  }
  return names;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run scraper/__tests__/replay-archive.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add scraper/replay/types.ts scraper/replay/archive.ts scraper/sources/tennis-abstract.ts .gitignore scraper/__tests__/replay-archive.test.ts
git commit -m "feat(replay): cache and parse the Sackmann archive as ground truth"
```

---

### Task 2: Strict tier mapping for archive editions

**Files:**
- Create: `scraper/replay/category.ts`
- Modify: `scraper/projections/category-inference.ts:13,52` (export `ATP_500_TOURNAMENTS`, `WTA_1000_NC`)
- Test: `scraper/__tests__/replay-category.test.ts`

**Interfaces:**
- Consumes: `challengerTier(events, name, playedOn)`, `loadChallengerEvents()` from `scraper/sources/atp-challenger-calendar.ts`.
- Produces: `archiveCategory(tour, level, name, drawSize, start, challengerEvents?) → { category: Category | null; variant?: DrawVariant; gap: string | null }`.

Level codes observed in the 2025 files: ATP `G M A F D O C 15 25`; WTA `G PM P I C F D O 15 35 50 75 100 35+H 50+H`. WTA `P` holds only 500s and `I` only 250s in 2025 (Abu Dhabi … Washington are all `P`).

- [ ] **Step 1: Write the failing test**

```ts
// scraper/__tests__/replay-category.test.ts
import { describe, expect, it } from "vitest";
import { archiveCategory } from "@scraper/replay/category";
import type { ChallengerEvent } from "@scraper/sources/atp-challenger-calendar";

const CAL: ChallengerEvent[] = [
  { city: "bengaluru", name: "Bengaluru, India", start: "2026-01-05", end: "2026-01-10", tier: 125 },
];
const cat = (tour: "atp" | "wta", level: string, name: string, draw: number | null = 32, start = "2025-03-03") =>
  archiveCategory(tour, level, name, draw, start, CAL);

describe("archiveCategory — ATP", () => {
  it("maps tour levels", () => {
    expect(cat("atp", "G", "Australian Open", 128)).toEqual({ category: "grand_slam", variant: undefined, gap: null });
    expect(cat("atp", "M", "Indian Wells Masters", 96).category).toBe("masters_1000");
    expect(cat("atp", "M", "Monte Carlo Masters", 56).variant).toBe("d56");
    expect(cat("atp", "A", "Basel", 32).category).toBe("atp_500");
    expect(cat("atp", "A", "Washington", 48)).toEqual({ category: "atp_500", variant: "d48", gap: null });
    expect(cat("atp", "A", "Marseille", 28).category).toBe("atp_250");
    expect(cat("atp", "F", "Tour Finals", 8).category).toBe("finals");
    expect(cat("atp", "15", "M15 Antalya", 32).category).toBe("m15_futures");
    expect(cat("atp", "25", "M25 Rome", 32).category).toBe("m25_futures");
  });

  it("awards nothing for Next Gen Finals and Davis Cup", () => {
    expect(cat("atp", "F", "Next Gen Finals", 8).category).toBe("non_ranking");
    expect(cat("atp", "D", "Davis Cup Finals", 4).category).toBe("davis_cup");
  });

  it("reports what it cannot score as a gap, never a default tier", () => {
    expect(cat("atp", "A", "United Cup", 18)).toEqual({ category: null, variant: undefined, gap: "united_cup" });
    expect(cat("atp", "C", "Abidjan 1 CH", 32)).toEqual({ category: null, variant: undefined, gap: "challenger_tier" });
    expect(cat("atp", "Z", "Mystery", 32).gap).toBe("level:Z");
  });

  it("resolves a Challenger tier from the calendar when it covers the week", () => {
    expect(cat("atp", "C", "Bengaluru CH", 32, "2026-01-05").category).toBe("ch_125");
  });
});

describe("archiveCategory — WTA", () => {
  it("maps tour levels", () => {
    expect(cat("wta", "G", "Wimbledon", 128).category).toBe("wta_grand_slam");
    expect(cat("wta", "PM", "Beijing", 96).category).toBe("wta_1000");
    expect(cat("wta", "PM", "Wuhan", 56).category).toBe("wta_1000_nc");
    expect(cat("wta", "PM", "Doha", 64).category).toBe("wta_1000_nc");
    expect(cat("wta", "P", "Stuttgart", 28).category).toBe("wta_500");
    expect(cat("wta", "I", "Hobart", 32).category).toBe("wta_250");
    expect(cat("wta", "C", "Lisbon 125", 32).category).toBe("wta_125");
    expect(cat("wta", "D", "BJK Cup Finals", 12).category).toBe("non_ranking");
  });

  it("scores the Paris 2024 Olympics with the WTA's medal table", () => {
    expect(cat("wta", "O", "Paris Olympics", 64, "2024-07-27")).toEqual({ category: "olympics", variant: "d64", gap: null });
  });

  it("flags ITF tiers that have no points table yet", () => {
    expect(cat("wta", "50+H", "W50 Rome", 32).gap).toBe("itf_w50");
    expect(cat("wta", "15", "W15 Monastir", 32).gap).toBe("itf_w15");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run scraper/__tests__/replay-category.test.ts`
Expected: FAIL — cannot resolve `@scraper/replay/category`.

- [ ] **Step 3: Write the implementation**

In `scraper/projections/category-inference.ts` change `const ATP_500_TOURNAMENTS` to `export const ATP_500_TOURNAMENTS` and `const WTA_1000_NC` to `export const WTA_1000_NC`.

```ts
// scraper/replay/category.ts
//
// Archive level code + name + draw -> points-table category, for the replay.
//
// Deliberately STRICTER than projections/category-inference.ts: anything that
// cannot be placed returns category null with a gap reason, so the replay
// reports it as a data gap rather than scoring a guessed tier. (The live
// inference maps an ATP "C" to ch_125 and lets ITF levels fall to atp_250.)
import type { Category, DrawVariant } from "../config/points-table";
import { ATP_500_TOURNAMENTS, WTA_1000_NC } from "../projections/category-inference";
import {
  challengerTier,
  loadChallengerEvents,
  type ChallengerEvent,
} from "../sources/atp-challenger-calendar";
import type { Tour } from "./types";

export interface ArchiveTier {
  category: Category | null;
  variant?: DrawVariant;
  gap: string | null;
}

const hit = (category: Category, variant?: DrawVariant): ArchiveTier => ({ category, variant, gap: null });
const gap = (reason: string): ArchiveTier => ({ category: null, variant: undefined, gap: reason });

function inSet(name: string, set: Set<string>): boolean {
  for (const t of set) if (name.includes(t)) return true;
  return false;
}

export function archiveCategory(
  tour: Tour,
  level: string,
  name: string,
  drawSize: number | null,
  start: string,
  challengerEvents: ChallengerEvent[] = loadChallengerEvents(),
): ArchiveTier {
  if (tour === "atp") {
    switch (level) {
      case "G":
        return hit("grand_slam");
      case "M":
        // Monte Carlo and Paris are 56-draw (docs/ranking-rules.md:52-66).
        return hit("masters_1000", drawSize != null && drawSize <= 64 ? "d56" : undefined);
      case "A": {
        // Per-match team scoring, not a draw (docs/ranking-rules.md:131).
        if (/United Cup/i.test(name)) return gap("united_cup");
        const d48 = drawSize != null && drawSize >= 48 ? ("d48" as const) : undefined;
        return hit(inSet(name, ATP_500_TOURNAMENTS) ? "atp_500" : "atp_250", d48);
      }
      case "F":
        return /Next Gen/i.test(name) ? hit("non_ranking") : hit("finals");
      case "D":
        return hit("davis_cup");
      case "O":
        return hit("olympics");
      case "C": {
        const tier = challengerTier(challengerEvents, name.replace(/\s*CH$/i, ""), start);
        return tier ? hit(`ch_${tier}` as Category) : gap("challenger_tier");
      }
      case "15":
        return hit("m15_futures");
      case "25":
        return hit("m25_futures");
      default:
        return gap(`level:${level}`);
    }
  }

  const itf = level.match(/^(\d+)(?:\+H)?$/);
  if (itf) return gap(`itf_w${itf[1]}`);
  switch (level) {
    case "G":
      return hit("wta_grand_slam");
    case "PM":
      if (inSet(name, WTA_1000_NC)) return hit("wta_1000_nc");
      return hit("wta_1000", drawSize != null && drawSize <= 64 ? "d56" : undefined);
    case "P":
      return hit("wta_500");
    case "I":
      return hit("wta_250");
    case "C":
      return hit("wta_125");
    case "F":
      return hit("finals");
    case "D":
      // Billie Jean King Cup: no ranking points.
      return hit("non_ranking");
    case "O":
      // Only Paris 2024 awarded WTA points (docs/ranking-rules.md:467).
      return start.startsWith("2024") ? hit("olympics", "d64") : hit("olympics");
    default:
      return gap(`level:${level}`);
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run scraper/__tests__/replay-category.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add scraper/replay/category.ts scraper/projections/category-inference.ts scraper/__tests__/replay-category.test.ts
git commit -m "feat(replay): strict archive tier mapping that reports unknown tiers as gaps"
```

---

### Task 3: Editions and per-player results

**Files:**
- Create: `scraper/replay/editions.ts`
- Test: `scraper/__tests__/replay-editions.test.ts`

**Interfaces:**
- Consumes: `archiveCategory` (Task 2); `pointsForRound`, `qualifierBonus`, `finalsPoints`, `Round` from `scraper/config/points-table.ts`; `addDays`, `mondayAfter`, `eventLengthDays` from `scraper/projections/drop-horizon.ts`; `ArchiveMatch`, `Edition`, `PlayerResult` (Task 1).
- Produces: `buildEditions(tour, matches, challengerEvents?) → { editions: Map<string, Edition>; results: PlayerResult[] }`.

Rules encoded (each tested):
- One edition per `tourney_id`, across all files.
- Main-draw finish: lost at round R → R; won the F → W; won a round with nothing later recorded → next round + `incomplete_edition`.
- Came through qualifying (played a Q match or entry `Q`) and reached the main draw → main-draw points + `qualifierBonus(category)` (docs/ranking-rules.md:45, :284).
- Lost in qualifying → that Q round, labelled from the END of the qualifying ladder (last Q round = `Q3`, one before = `Q2`, earlier = `Q1`), because 2-round and 3-round qualifying both end in the round the table calls Q3.
- Finals: additive `finalsPoints` (RR wins, SF win, final win).
- Entry Monday = Monday after `start + eventLengthDays − 1`; expiry = entry + 364 days.

- [ ] **Step 1: Write the failing test**

```ts
// scraper/__tests__/replay-editions.test.ts
import { describe, expect, it } from "vitest";
import { buildEditions } from "@scraper/replay/editions";
import type { ArchiveMatch } from "@scraper/replay/types";

const m = (over: Partial<ArchiveMatch>): ArchiveMatch => ({
  tourneyId: "2025-0001", tourneyName: "Marseille", level: "A", drawSize: 28,
  tourneyDate: "2025-02-10", round: "R32", winnerId: "W", loserId: "L",
  winnerEntry: null, loserEntry: null, score: "6-1 6-1", ...over,
});
const pts = (results: ReturnType<typeof buildEditions>["results"], pid: string) =>
  results.find((r) => r.playerId === pid)!;

describe("buildEditions", () => {
  // ATP 250, 28 draw, 2-round qualifying.
  const marseille = [
    m({ round: "Q1", winnerId: "q", loserId: "q1loser", drawSize: 16 }),
    m({ round: "Q2", winnerId: "q", loserId: "q2loser", drawSize: 16 }),
    m({ round: "R32", winnerId: "q", loserId: "r32loser" }),
    m({ round: "R16", winnerId: "champ", loserId: "q" }),
    m({ round: "QF", winnerId: "champ", loserId: "qfloser" }),
    m({ round: "SF", winnerId: "champ", loserId: "sfloser" }),
    m({ round: "F", winnerId: "champ", loserId: "finalist" }),
  ];
  const { editions, results } = buildEditions("atp", marseille, []);

  it("builds one edition keyed by tour and tourney_id", () => {
    expect([...editions.keys()]).toEqual(["atp:2025-0001"]);
    expect(editions.get("atp:2025-0001")!.category).toBe("atp_250");
  });

  it("scores main-draw finishes from the points table", () => {
    expect(pts(results, "champ").points).toBe(250);
    expect(pts(results, "finalist").points).toBe(165);
    expect(pts(results, "sfloser").points).toBe(100);
    expect(pts(results, "qfloser").points).toBe(50);
    expect(pts(results, "r32loser").points).toBe(0);
  });

  it("adds the qualifier bonus to a qualifier's main-draw points", () => {
    // Lost in R16 (25) after qualifying (+12 at a 250).
    expect(pts(results, "q").points).toBe(25 + 12);
  });

  it("labels qualifying losses from the end of the ladder", () => {
    // 2-round qualifying: the Q2 loser lost the LAST round -> table's Q3 (12).
    expect(pts(results, "q2loser").points).toBe(12);
    expect(pts(results, "q1loser").points).toBe(6);
  });

  it("dates entry the Monday after the event and expiry 52 weeks later", () => {
    expect(pts(results, "champ").entryWeek).toBe("2025-02-17");
    expect(pts(results, "champ").expiryWeek).toBe("2026-02-16");
  });

  it("merges qualifying from another file into the same edition", () => {
    const slam = [
      m({ tourneyId: "2025-580", tourneyName: "Australian Open", level: "G", drawSize: 128, tourneyDate: "2025-01-13", round: "Q3", winnerId: "qual", loserId: "q3loser" }),
      m({ tourneyId: "2025-580", tourneyName: "Australian Open", level: "G", drawSize: 128, tourneyDate: "2025-01-13", round: "R128", winnerId: "x", loserId: "qual" }),
    ];
    const built = buildEditions("atp", slam, []);
    expect(built.editions.size).toBe(1);
    expect(built.results.filter((r) => r.playerId === "qual")).toHaveLength(1);
    // R128 loss (10) + slam qualifier bonus (25).
    expect(pts(built.results, "qual").points).toBe(35);
    expect(pts(built.results, "q3loser").points).toBe(16);
    expect(pts(built.results, "x").entryWeek).toBe("2025-01-27");
  });

  it("credits the next round and flags an incomplete draw", () => {
    const partial = [m({ tourneyId: "2025-9", round: "QF", winnerId: "alive", loserId: "out" })];
    const r = pts(buildEditions("atp", partial, []).results, "alive");
    expect(r.points).toBe(100); // reached SF at a 250
    expect(r.gaps).toContain("incomplete_edition");
  });

  it("scores the Finals additively", () => {
    const finals = [
      m({ tourneyId: "2025-605", tourneyName: "Tour Finals", level: "F", drawSize: 8, tourneyDate: "2025-11-09", round: "RR", winnerId: "A", loserId: "B" }),
      m({ tourneyId: "2025-605", tourneyName: "Tour Finals", level: "F", drawSize: 8, tourneyDate: "2025-11-09", round: "RR", winnerId: "A", loserId: "C" }),
      m({ tourneyId: "2025-605", tourneyName: "Tour Finals", level: "F", drawSize: 8, tourneyDate: "2025-11-09", round: "SF", winnerId: "A", loserId: "D" }),
      m({ tourneyId: "2025-605", tourneyName: "Tour Finals", level: "F", drawSize: 8, tourneyDate: "2025-11-09", round: "F", winnerId: "E", loserId: "A" }),
    ];
    const r = pts(buildEditions("atp", finals, []).results, "A");
    expect(r.points).toBe(2 * 200 + 400);
    expect(r.isFinals).toBe(true);
  });

  it("gives a gap edition's players zero points and the gap flag", () => {
    const cup = [m({ tourneyId: "2025-8888", tourneyName: "United Cup", level: "A", drawSize: 18, round: "RR" })];
    const r = pts(buildEditions("atp", cup, []).results, "W");
    expect(r.points).toBe(0);
    expect(r.gaps).toEqual(["united_cup"]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run scraper/__tests__/replay-editions.test.ts`
Expected: FAIL — cannot resolve `@scraper/replay/editions`.

- [ ] **Step 3: Write the implementation**

```ts
// scraper/replay/editions.ts
//
// Archive matches -> editions (one per tourney_id, across ALL files: a tour
// event's qualifying lives in *_qual_chall / *_qual_itf under the same id) ->
// what each player earned there and when it counts.
import {
  finalsPoints,
  pointsForRound,
  qualifierBonus,
  type Round,
} from "../config/points-table";
import { addDays, eventLengthDays, mondayAfter } from "../projections/drop-horizon";
import type { ChallengerEvent } from "../sources/atp-challenger-calendar";
import { archiveCategory } from "./category";
import type { ArchiveMatch, Edition, PlayerResult, Tour } from "./types";

const MD_LADDER: Round[] = ["R128", "R64", "R32", "R16", "QF", "SF", "F"];

interface Played {
  md: Array<{ idx: number; won: boolean }>;
  q: Array<{ n: number; won: boolean }>;
  rrWins: number;
  wonSf: boolean;
  wonFinal: boolean;
  enteredAsQualifier: boolean;
}

function newPlayed(): Played {
  return { md: [], q: [], rrWins: 0, wonSf: false, wonFinal: false, enteredAsQualifier: false };
}

export function buildEditions(
  tour: Tour,
  matches: ArchiveMatch[],
  challengerEvents?: ChallengerEvent[],
): { editions: Map<string, Edition>; results: PlayerResult[] } {
  const byId = new Map<string, ArchiveMatch[]>();
  for (const m of matches) {
    const list = byId.get(m.tourneyId);
    if (list) list.push(m);
    else byId.set(m.tourneyId, [m]);
  }

  const editions = new Map<string, Edition>();
  const results: PlayerResult[] = [];

  for (const [tourneyId, rows] of byId) {
    // Main-draw rows carry the real draw size; qualifying rows carry the
    // qualifying draw's.
    const md = rows.filter((r) => !r.round.startsWith("Q"));
    const meta = md[0] ?? rows[0]!;
    const start = rows.reduce((min, r) => (r.tourneyDate < min ? r.tourneyDate : min), meta.tourneyDate);
    const tier = archiveCategory(tour, meta.level, meta.tourneyName, meta.drawSize, start, challengerEvents);
    const edition: Edition = {
      key: `${tour}:${tourneyId}`,
      tour,
      name: meta.tourneyName,
      level: meta.level,
      drawSize: meta.drawSize,
      start,
      category: tier.category,
      variant: tier.variant,
      gap: tier.gap,
    };
    editions.set(edition.key, edition);

    const played = new Map<string, Played>();
    const get = (pid: string) => {
      let p = played.get(pid);
      if (!p) played.set(pid, (p = newPlayed()));
      return p;
    };
    let maxQ = 0;
    for (const r of rows) {
      const q = r.round.match(/^Q(\d)$/);
      for (const [pid, won, entry] of [
        [r.winnerId, true, r.winnerEntry],
        [r.loserId, false, r.loserEntry],
      ] as const) {
        const p = get(pid);
        if (entry === "Q") p.enteredAsQualifier = true;
        if (q) {
          const n = Number(q[1]);
          maxQ = Math.max(maxQ, n);
          p.q.push({ n, won });
        } else if (r.round === "RR") {
          if (won) p.rrWins++;
        } else {
          const idx = MD_LADDER.indexOf(r.round as Round);
          if (idx < 0) continue;
          p.md.push({ idx, won });
          if (won && r.round === "SF") p.wonSf = true;
          if (won && r.round === "F") p.wonFinal = true;
        }
      }
    }

    const length = edition.category ? eventLengthDays(edition.category, edition.name) : 6;
    const entryWeek = mondayAfter(addDays(start, length - 1));
    const expiryWeek = addDays(entryWeek, 364);

    for (const [playerId, p] of played) {
      const scored = scorePlayer(edition, p, maxQ);
      results.push({
        playerId,
        editionKey: edition.key,
        editionName: edition.name,
        points: scored.points,
        entryWeek,
        expiryWeek,
        isFinals: edition.category === "finals",
        gaps: scored.gaps,
      });
    }
  }
  return { editions, results };
}

function scorePlayer(edition: Edition, p: Played, maxQ: number): { points: number; gaps: string[] } {
  const cat = edition.category;
  if (!cat) return { points: 0, gaps: [edition.gap ?? "unknown_tier"] };
  if (cat === "finals") {
    return { points: finalsPoints({ rrWins: p.rrWins, wonSf: p.wonSf, wonFinal: p.wonFinal }), gaps: [] };
  }
  const gaps: string[] = [];
  if (p.md.length > 0) {
    const deepest = p.md.reduce((a, b) => (b.idx > a.idx ? b : a));
    let round: Round;
    if (!deepest.won) round = MD_LADDER[deepest.idx]!;
    else if (MD_LADDER[deepest.idx] === "F") round = "W";
    else {
      round = MD_LADDER[deepest.idx + 1]!;
      gaps.push("incomplete_edition");
    }
    let points = pointsForRound(cat, round, edition.variant);
    if (p.q.length > 0 || p.enteredAsQualifier) points += qualifierBonus(cat);
    return { points, gaps };
  }
  const lost = p.q.find((x) => !x.won);
  if (!lost) return { points: 0, gaps: ["incomplete_edition"] };
  const fromEnd = maxQ - lost.n;
  const label: Round = fromEnd === 0 ? "Q3" : fromEnd === 1 ? "Q2" : "Q1";
  return { points: pointsForRound(cat, label, edition.variant), gaps };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run scraper/__tests__/replay-editions.test.ts`
Expected: PASS (9 tests).

- [ ] **Step 5: Commit**

```bash
git add scraper/replay/editions.ts scraper/__tests__/replay-editions.test.ts
git commit -m "feat(replay): build editions and per-player results from archive matches"
```

---

### Task 4: Counting rules and the ledger

**Files:**
- Create: `scraper/replay/rules.ts`
- Create: `scraper/replay/ledger.ts`
- Test: `scraper/__tests__/replay-ledger.test.ts`

**Interfaces:**
- Consumes: `PlayerResult`, `Tour` (Task 1).
- Produces: `CountingRules { bestN: number; finalsExtra: boolean }`; `countingRules(tour, week)`; `indexByPlayer(results) → Map<string, PlayerResult[]>`; `ledgerFor(results, week, rules) → LedgerTotal { total; counted: PlayerResult[]; valid: PlayerResult[]; gaps: string[] }`.

- [ ] **Step 1: Write the failing test**

```ts
// scraper/__tests__/replay-ledger.test.ts
import { describe, expect, it } from "vitest";
import { indexByPlayer, ledgerFor } from "@scraper/replay/ledger";
import { countingRules } from "@scraper/replay/rules";
import type { PlayerResult } from "@scraper/replay/types";

const r = (points: number, entryWeek: string, over: Partial<PlayerResult> = {}): PlayerResult => ({
  playerId: "p", editionKey: `e${points}${entryWeek}`, editionName: "x", points, entryWeek,
  expiryWeek: "2026-01-05", isFinals: false, gaps: [], ...over,
});

describe("countingRules", () => {
  it("counts 19 ATP results through 2025 and 18 from the 2026 season", () => {
    // docs/ranking-rules.md:17-27
    expect(countingRules("atp", "2025-12-22").bestN).toBe(19);
    expect(countingRules("atp", "2025-12-29").bestN).toBe(18);
    expect(countingRules("wta", "2025-06-02").bestN).toBe(18);
  });
});

describe("ledgerFor", () => {
  const rules = { bestN: 2, finalsExtra: true };

  it("counts a result from its entry Monday until the Monday before expiry", () => {
    const res = [r(100, "2025-03-03", { expiryWeek: "2026-03-02" })];
    expect(ledgerFor(res, "2025-02-24", rules).total).toBe(0);
    expect(ledgerFor(res, "2025-03-03", rules).total).toBe(100);
    expect(ledgerFor(res, "2026-02-23", rules).total).toBe(100);
    expect(ledgerFor(res, "2026-03-02", rules).total).toBe(0);
  });

  it("keeps only the best N, plus the Finals on top", () => {
    const res = [
      r(500, "2025-01-06"), r(250, "2025-01-06"), r(100, "2025-01-06"),
      r(1500, "2025-01-06", { isFinals: true }),
    ];
    const led = ledgerFor(res, "2025-06-02", rules);
    expect(led.total).toBe(500 + 250 + 1500);
    expect(led.valid).toHaveLength(4);
    expect(led.counted).toHaveLength(3);
  });

  it("collects the gaps of every valid result", () => {
    const res = [r(0, "2025-01-06", { gaps: ["challenger_tier"] }), r(0, "2025-01-06", { gaps: ["challenger_tier"] })];
    expect(ledgerFor(res, "2025-06-02", rules).gaps).toEqual(["challenger_tier"]);
  });

  it("indexes results by player", () => {
    const idx = indexByPlayer([r(1, "2025-01-06"), r(2, "2025-01-06", { playerId: "q" })]);
    expect(idx.get("p")).toHaveLength(1);
    expect(idx.get("q")).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run scraper/__tests__/replay-ledger.test.ts`
Expected: FAIL — cannot resolve `@scraper/replay/ledger`.

- [ ] **Step 3: Write the implementation**

```ts
// scraper/replay/rules.ts
//
// How many results count. Deliberately minimal: mandatory-event zeros, the
// WTA's separate 1000 slots and the ATP Finals expiry exception are NOT
// modelled yet. The replay measures what each omission costs before any of
// them is added.
import type { Tour } from "./types";

export interface CountingRules {
  bestN: number;
  /** The year-end Finals counts on top of the best N. */
  finalsExtra: boolean;
}

/** First ranking week of the 2026 ATP season, when best-19 became best-18 (docs/ranking-rules.md:17-27). */
const ATP_BEST_18_FROM = "2025-12-29";

export function countingRules(tour: Tour, week: string): CountingRules {
  if (tour === "atp") return { bestN: week >= ATP_BEST_18_FROM ? 18 : 19, finalsExtra: true };
  // docs/ranking-rules.md:255-268: best 18, WTA Finals as an extra result.
  return { bestN: 18, finalsExtra: true };
}
```

```ts
// scraper/replay/ledger.ts
//
// A player's counted results at one ranking week, and their total.
import type { CountingRules } from "./rules";
import type { PlayerResult } from "./types";

export interface LedgerTotal {
  total: number;
  counted: PlayerResult[];
  /** Every result inside its 52-week window, counted or not. */
  valid: PlayerResult[];
  gaps: string[];
}

export function indexByPlayer(results: PlayerResult[]): Map<string, PlayerResult[]> {
  const out = new Map<string, PlayerResult[]>();
  for (const r of results) {
    const list = out.get(r.playerId);
    if (list) list.push(r);
    else out.set(r.playerId, [r]);
  }
  return out;
}

export function ledgerFor(results: PlayerResult[], week: string, rules: CountingRules): LedgerTotal {
  const valid = results.filter((r) => r.entryWeek <= week && week < r.expiryWeek);
  const extra = rules.finalsExtra ? valid.filter((r) => r.isFinals) : [];
  const pool = valid
    .filter((r) => !(rules.finalsExtra && r.isFinals))
    .sort((a, b) => b.points - a.points);
  const counted = [...pool.slice(0, rules.bestN), ...extra];
  return {
    total: counted.reduce((s, r) => s + r.points, 0),
    counted,
    valid,
    gaps: [...new Set(valid.flatMap((r) => r.gaps))],
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run scraper/__tests__/replay-ledger.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add scraper/replay/rules.ts scraper/replay/ledger.ts scraper/__tests__/replay-ledger.test.ts
git commit -m "feat(replay): counting rules and per-player 52-week ledger"
```

---

### Task 5: Replay scoring (full and delta)

**Files:**
- Create: `scraper/replay/replay.ts`
- Test: `scraper/__tests__/replay-score.test.ts`

**Interfaces:**
- Consumes: `ledgerFor`, `CountingRules` (Task 4); `OfficialRow`, `PlayerResult` (Task 1).
- Produces:
  - `Residual { playerId; rank; official; ours; delta; causes: string[] }`
  - `WeekScore { week; judged; exact; within10; within50; residuals: Residual[] }`
  - `replayFull(byWeek, resultsByPlayer, rulesFor: (week) => CountingRules, weeks, top) → WeekScore[]`
  - `replayDelta(byWeek, resultsByPlayer, weeks, top) → WeekScore[]`

Causes, in the order they are checked: the gaps of the results involved (`challenger_tier`, `itf_w50`, `united_cup`, `incomplete_edition`, …); `no_results` (we hold no valid result for a ranked player — full mode); `new_in_ranking` (not in the previous week — delta mode); `best_n` (more valid results than count — full mode); otherwise `unexplained`.

- [ ] **Step 1: Write the failing test**

```ts
// scraper/__tests__/replay-score.test.ts
import { describe, expect, it } from "vitest";
import { replayDelta, replayFull } from "@scraper/replay/replay";
import type { OfficialRow, PlayerResult } from "@scraper/replay/types";

const off = (week: string, rows: Array<[string, number, number]>) =>
  new Map(rows.map(([pid, rank, points]) => [pid, { week, rank, playerId: pid, points, tours: null } as OfficialRow]));
const res = (pid: string, points: number, entryWeek: string, expiryWeek: string, gaps: string[] = []): PlayerResult => ({
  playerId: pid, editionKey: `${pid}-${entryWeek}`, editionName: "x", points, entryWeek, expiryWeek, isFinals: false, gaps,
});

describe("replayFull", () => {
  const byWeek = new Map([["2025-06-02", off("2025-06-02", [["a", 1, 300], ["b", 2, 200], ["c", 3, 50]])]]);
  const results = new Map([
    ["a", [res("a", 300, "2025-01-06", "2026-01-05")]],
    ["b", [res("b", 150, "2025-01-06", "2026-01-05"), res("b", 0, "2025-01-06", "2026-01-05", ["challenger_tier"])]],
  ]);
  const [score] = replayFull(byWeek, results, () => ({ bestN: 18, finalsExtra: true }), ["2025-06-02"], 10);

  it("counts exact and near matches", () => {
    expect(score!.judged).toBe(3);
    expect(score!.exact).toBe(1);
  });

  it("attributes every residual to a cause", () => {
    const by = new Map(score!.residuals.map((r) => [r.playerId, r]));
    expect(by.get("b")!.causes).toEqual(["challenger_tier"]);
    expect(by.get("b")!.delta).toBe(-50);
    expect(by.get("c")!.causes).toEqual(["no_results"]);
  });

  it("only judges players inside the top N", () => {
    const [s] = replayFull(byWeek, results, () => ({ bestN: 18, finalsExtra: true }), ["2025-06-02"], 1);
    expect(s!.judged).toBe(1);
  });
});

describe("replayDelta", () => {
  it("adds what enters and removes what leaves between two published weeks", () => {
    const byWeek = new Map([
      ["2025-06-02", off("2025-06-02", [["a", 1, 1000]])],
      ["2025-06-09", off("2025-06-09", [["a", 1, 1150]])],
    ]);
    const results = new Map([
      ["a", [res("a", 250, "2025-06-09", "2026-06-08"), res("a", 100, "2024-06-10", "2025-06-09")]],
    ]);
    const [score] = replayDelta(byWeek, results, ["2025-06-02", "2025-06-09"], 10);
    expect(score!.week).toBe("2025-06-09");
    expect(score!.exact).toBe(1);
  });

  it("spans a two-week gap between published weeks", () => {
    const byWeek = new Map([
      ["2025-12-22", off("2025-12-22", [["a", 1, 1000]])],
      ["2026-01-05", off("2026-01-05", [["a", 1, 1250]])],
    ]);
    const results = new Map([["a", [res("a", 250, "2025-12-29", "2026-12-28")]]]);
    const [score] = replayDelta(byWeek, results, ["2025-12-22", "2026-01-05"], 10);
    expect(score!.exact).toBe(1);
  });

  it("flags a player missing from the previous week", () => {
    const byWeek = new Map([
      ["2025-06-02", off("2025-06-02", [])],
      ["2025-06-09", off("2025-06-09", [["n", 1, 10]])],
    ]);
    const [score] = replayDelta(byWeek, new Map(), ["2025-06-02", "2025-06-09"], 10);
    expect(score!.residuals[0]!.causes).toEqual(["new_in_ranking"]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run scraper/__tests__/replay-score.test.ts`
Expected: FAIL — cannot resolve `@scraper/replay/replay`.

- [ ] **Step 3: Write the implementation**

```ts
// scraper/replay/replay.ts
//
// Score our totals against the official ranking.
//
//   full   ledger total at week W vs official(W): tests rules AND data depth.
//   delta  official(W0) + what entered - what left in (W0, W1] vs official(W1):
//          tests week-to-week rules without needing 52 weeks of clean data.
import { ledgerFor } from "./ledger";
import type { CountingRules } from "./rules";
import type { OfficialRow, PlayerResult } from "./types";

export interface Residual {
  playerId: string;
  rank: number;
  official: number;
  ours: number;
  delta: number;
  causes: string[];
}

export interface WeekScore {
  week: string;
  judged: number;
  exact: number;
  within10: number;
  within50: number;
  residuals: Residual[];
}

type ByWeek = Map<string, Map<string, OfficialRow>>;

function score(
  week: string,
  official: Map<string, OfficialRow>,
  top: number,
  ours: (row: OfficialRow) => { total: number; causes: string[] },
): WeekScore {
  const s: WeekScore = { week, judged: 0, exact: 0, within10: 0, within50: 0, residuals: [] };
  for (const row of official.values()) {
    if (row.rank > top) continue;
    s.judged++;
    const mine = ours(row);
    const delta = mine.total - row.points;
    const abs = Math.abs(delta);
    if (abs === 0) s.exact++;
    if (abs <= 10) s.within10++;
    if (abs <= 50) s.within50++;
    if (abs !== 0) {
      s.residuals.push({
        playerId: row.playerId,
        rank: row.rank,
        official: row.points,
        ours: mine.total,
        delta,
        causes: mine.causes.length ? mine.causes : ["unexplained"],
      });
    }
  }
  s.residuals.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));
  return s;
}

export function replayFull(
  byWeek: ByWeek,
  resultsByPlayer: Map<string, PlayerResult[]>,
  rulesFor: (week: string) => CountingRules,
  weeks: string[],
  top: number,
): WeekScore[] {
  return weeks.map((week) => {
    const rules = rulesFor(week);
    return score(week, byWeek.get(week) ?? new Map(), top, (row) => {
      const led = ledgerFor(resultsByPlayer.get(row.playerId) ?? [], week, rules);
      const causes = [...led.gaps];
      if (led.valid.length === 0) causes.push("no_results");
      else if (led.valid.length > rules.bestN) causes.push("best_n");
      return { total: led.total, causes };
    });
  });
}

export function replayDelta(
  byWeek: ByWeek,
  resultsByPlayer: Map<string, PlayerResult[]>,
  weeks: string[],
  top: number,
): WeekScore[] {
  const out: WeekScore[] = [];
  for (let i = 1; i < weeks.length; i++) {
    const w0 = weeks[i - 1]!;
    const w1 = weeks[i]!;
    const prev = byWeek.get(w0) ?? new Map<string, OfficialRow>();
    out.push(
      score(w1, byWeek.get(w1) ?? new Map(), top, (row) => {
        const results = resultsByPlayer.get(row.playerId) ?? [];
        const entering = results.filter((r) => w0 < r.entryWeek && r.entryWeek <= w1);
        const leaving = results.filter((r) => w0 < r.expiryWeek && r.expiryWeek <= w1);
        const base = prev.get(row.playerId)?.points ?? 0;
        const total =
          base + entering.reduce((s, r) => s + r.points, 0) - leaving.reduce((s, r) => s + r.points, 0);
        const causes = [...new Set([...entering, ...leaving].flatMap((r) => r.gaps))];
        if (!prev.has(row.playerId)) causes.push("new_in_ranking");
        return { total, causes };
      }),
    );
  }
  return out;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run scraper/__tests__/replay-score.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add scraper/replay/replay.ts scraper/__tests__/replay-score.test.ts
git commit -m "feat(replay): score full-ledger and week-to-week totals against official rankings"
```

---

### Task 6: Report, baseline gate and CLI

**Files:**
- Create: `scraper/replay/report.ts`
- Create: `scraper/replay/cli.ts`
- Create: `scraper/replay/baseline.json` (written by the first `--update-baseline` run in Task 7)
- Modify: `package.json` (scripts `replay`, `replay:check`)
- Test: `scraper/__tests__/replay-report.test.ts`

**Interfaces:**
- Consumes: everything above.
- Produces: `RunSummary { key; tour; mode; weeks; judged; exact; within10; within50 }`; `summarize(tour, mode, from, to, top, scores)`; `causeCounts(scores) → Array<[cause, players]>`; `renderSection(summary, scores, names) → string`; `trendLine(at, summaries) → string`; `checkBaseline(summaries, baseline) → string[]`; `Baseline = Record<string, { exactRate: number; within10Rate: number }>`.

- [ ] **Step 1: Write the failing test**

```ts
// scraper/__tests__/replay-report.test.ts
import { describe, expect, it } from "vitest";
import { causeCounts, checkBaseline, renderSection, summarize } from "@scraper/replay/report";
import type { WeekScore } from "@scraper/replay/replay";

const scores: WeekScore[] = [
  { week: "2025-06-02", judged: 4, exact: 2, within10: 3, within50: 4, residuals: [
    { playerId: "1", rank: 1, official: 100, ours: 90, delta: -10, causes: ["challenger_tier"] },
    { playerId: "2", rank: 2, official: 100, ours: 70, delta: -30, causes: ["challenger_tier", "best_n"] },
  ] },
  { week: "2025-06-09", judged: 4, exact: 4, within10: 4, within50: 4, residuals: [] },
];

describe("summarize", () => {
  it("pools all weeks and keys the run by tour, mode and window", () => {
    const s = summarize("atp", "full", "2025-06-02", "2025-06-09", 500, scores);
    expect(s).toMatchObject({ key: "atp:full:2025-06-02:2025-06-09:top500", weeks: 2, judged: 8, exact: 6, within10: 7 });
  });
});

describe("causeCounts", () => {
  it("counts residual players per cause, most frequent first", () => {
    expect(causeCounts(scores)).toEqual([["challenger_tier", 2], ["best_n", 1]]);
  });
});

describe("checkBaseline", () => {
  const s = summarize("atp", "full", "2025-06-02", "2025-06-09", 500, scores);
  it("passes at or above the baseline", () => {
    expect(checkBaseline([s], { [s.key]: { exactRate: 0.75, within10Rate: 0.875 } })).toEqual([]);
  });
  it("fails below the baseline and names the run", () => {
    const fails = checkBaseline([s], { [s.key]: { exactRate: 0.8, within10Rate: 0.875 } });
    expect(fails).toHaveLength(1);
    expect(fails[0]).toContain(s.key);
  });
  it("ignores runs the baseline does not cover", () => {
    expect(checkBaseline([s], {})).toEqual([]);
  });
});

describe("renderSection", () => {
  it("names players and shows the worst residuals", () => {
    const md = renderSection(summarize("atp", "full", "2025-06-02", "2025-06-09", 500, scores), scores, new Map([["2", "Jannik Sinner"]]));
    expect(md).toContain("Jannik Sinner");
    expect(md).toContain("challenger_tier");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run scraper/__tests__/replay-report.test.ts`
Expected: FAIL — cannot resolve `@scraper/replay/report`.

- [ ] **Step 3: Write the implementation**

```ts
// scraper/replay/report.ts
import type { Residual, WeekScore } from "./replay";

export interface RunSummary {
  key: string;
  tour: string;
  mode: string;
  weeks: number;
  judged: number;
  exact: number;
  within10: number;
  within50: number;
}

export type Baseline = Record<string, { exactRate: number; within10Rate: number }>;

export function summarize(
  tour: string,
  mode: string,
  from: string,
  to: string,
  top: number,
  scores: WeekScore[],
): RunSummary {
  const sum = (f: (s: WeekScore) => number) => scores.reduce((t, s) => t + f(s), 0);
  return {
    key: `${tour}:${mode}:${from}:${to}:top${top}`,
    tour,
    mode,
    weeks: scores.length,
    judged: sum((s) => s.judged),
    exact: sum((s) => s.exact),
    within10: sum((s) => s.within10),
    within50: sum((s) => s.within50),
  };
}

const rate = (n: number, d: number) => (d === 0 ? 0 : n / d);
const pct = (n: number, d: number) => `${(100 * rate(n, d)).toFixed(1)}%`;

export function causeCounts(scores: WeekScore[]): Array<[string, number]> {
  const counts = new Map<string, number>();
  for (const s of scores) for (const r of s.residuals) for (const c of r.causes) counts.set(c, (counts.get(c) ?? 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
}

export function checkBaseline(summaries: RunSummary[], baseline: Baseline): string[] {
  const fails: string[] = [];
  for (const s of summaries) {
    const b = baseline[s.key];
    if (!b) continue;
    const exact = rate(s.exact, s.judged);
    const w10 = rate(s.within10, s.judged);
    // 1e-9: rates are recomputed from integers; only a real drop may fail.
    if (exact + 1e-9 < b.exactRate || w10 + 1e-9 < b.within10Rate) {
      fails.push(
        `${s.key}: exact ${(100 * exact).toFixed(2)}% (baseline ${(100 * b.exactRate).toFixed(2)}%), ` +
          `<=10 ${(100 * w10).toFixed(2)}% (baseline ${(100 * b.within10Rate).toFixed(2)}%)`,
      );
    }
  }
  return fails;
}

export function toBaseline(summaries: RunSummary[], prior: Baseline): Baseline {
  const out: Baseline = { ...prior };
  for (const s of summaries) {
    out[s.key] = { exactRate: rate(s.exact, s.judged), within10Rate: rate(s.within10, s.judged) };
  }
  return out;
}

export function trendLine(at: string, summaries: RunSummary[]): string {
  return `${at}  ${summaries
    .map((s) => `${s.tour}-${s.mode}=${pct(s.exact, s.judged)}(<=10 ${pct(s.within10, s.judged)})`)
    .join("  ")}`;
}

function residualRow(r: Residual, names: Map<string, string>): string {
  const name = names.get(r.playerId) ?? r.playerId;
  return `| ${r.rank} | ${name} | ${r.official} | ${r.ours} | ${r.delta > 0 ? "+" : ""}${r.delta} | ${r.causes.join(", ")} |`;
}

export function renderSection(summary: RunSummary, scores: WeekScore[], names: Map<string, string>): string {
  const lines: string[] = [];
  lines.push(`## ${summary.tour.toUpperCase()} — ${summary.mode}`);
  lines.push("");
  lines.push(
    `${summary.weeks} weeks, ${summary.judged} player-weeks judged: ` +
      `exact ${pct(summary.exact, summary.judged)}, <=10 ${pct(summary.within10, summary.judged)}, ` +
      `<=50 ${pct(summary.within50, summary.judged)}`,
  );
  lines.push("");
  lines.push("### Residual causes (player-weeks)");
  lines.push("");
  lines.push("| cause | player-weeks |");
  lines.push("|---|---|");
  for (const [c, n] of causeCounts(scores)) lines.push(`| ${c} | ${n} |`);
  lines.push("");
  lines.push("### Per week");
  lines.push("");
  lines.push("| week | judged | exact | <=10 | <=50 |");
  lines.push("|---|---|---|---|---|");
  for (const s of scores) {
    lines.push(`| ${s.week} | ${s.judged} | ${pct(s.exact, s.judged)} | ${pct(s.within10, s.judged)} | ${pct(s.within50, s.judged)} |`);
  }
  // The latest week that has residuals: a clean final week would show nothing.
  const last = [...scores].reverse().find((s) => s.residuals.length > 0);
  if (last) {
    lines.push("");
    lines.push(`### Worst residuals, ${last.week}`);
    lines.push("");
    lines.push("| rank | player | official | ours | delta | causes |");
    lines.push("|---|---|---|---|---|---|");
    for (const r of last.residuals.slice(0, 25)) lines.push(residualRow(r, names));
  }
  lines.push("");
  return lines.join("\n");
}
```

```ts
// scraper/replay/cli.ts
//
//   pnpm replay                       both tours, both modes, 2023-01-02..2026-06-08, top 500
//   pnpm replay -- --tour atp --mode delta --from 2025-01-06 --to 2025-12-29
//   pnpm replay -- --update-baseline  record the current scores as the gate
//   pnpm replay:check                 exit 1 if any covered run scores below baseline
//   pnpm replay -- --refresh          re-download the archive cache
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { loadMatches, loadOfficial, loadPlayerNames } from "./archive";
import { buildEditions } from "./editions";
import { indexByPlayer } from "./ledger";
import { replayDelta, replayFull } from "./replay";
import {
  checkBaseline,
  renderSection,
  summarize,
  toBaseline,
  trendLine,
  type Baseline,
  type RunSummary,
} from "./report";
import { countingRules } from "./rules";
import type { Tour } from "./types";

const BASELINE_PATH = resolve(import.meta.dirname, "baseline.json");

function arg(name: string, fallback: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1]! : fallback;
}
const flag = (name: string) => process.argv.includes(`--${name}`);

async function main(): Promise<void> {
  const from = arg("from", "2023-01-02");
  const to = arg("to", "2026-06-08");
  const top = Number(arg("top", "500"));
  const tours: Tour[] = arg("tour", "both") === "both" ? ["atp", "wta"] : [arg("tour", "atp") as Tour];
  const modeArg = arg("mode", "both");
  const modes = modeArg === "both" ? ["full", "delta"] : [modeArg];
  const refresh = flag("refresh");

  const summaries: RunSummary[] = [];
  const sections: string[] = [];
  // Full mode needs the 52 weeks before `from`; delta needs last year's
  // results to know what leaves.
  const years: number[] = [];
  for (let y = Number(from.slice(0, 4)) - 1; y <= Number(to.slice(0, 4)); y++) years.push(y);

  for (const tour of tours) {
    const { matches, skipped: badMatches } = await loadMatches(tour, years, refresh);
    const { byWeek, skipped: badRanks } = await loadOfficial(tour, from, to, refresh);
    const names = await loadPlayerNames(tour, refresh);
    const { editions, results } = buildEditions(tour, matches);
    const byPlayer = indexByPlayer(results);
    const weeks = [...byWeek.keys()].sort();
    console.log(
      `[replay] ${tour}: ${matches.length} matches (${badMatches} malformed), ${editions.size} editions, ` +
        `${weeks.length} official weeks (${badRanks} malformed rows)`,
    );
    for (const mode of modes) {
      const scores =
        mode === "full"
          ? replayFull(byWeek, byPlayer, (w) => countingRules(tour, w), weeks, top)
          : replayDelta(byWeek, byPlayer, weeks, top);
      const s = summarize(tour, mode, from, to, top, scores);
      summaries.push(s);
      sections.push(renderSection(s, scores, names));
    }
  }

  const at = new Date().toISOString();
  mkdirSync("logs", { recursive: true });
  const reportPath = `logs/replay-${at.slice(0, 10)}.md`;
  writeFileSync(reportPath, [`# Replay ${at}`, "", `Window ${from} .. ${to}, top ${top}`, "", ...sections].join("\n"));
  appendFileSync("logs/replay-trend.log", trendLine(at, summaries) + "\n");
  console.log(trendLine(at, summaries));
  console.log(`[replay] report: ${reportPath}`);

  const baseline: Baseline = existsSync(BASELINE_PATH)
    ? (JSON.parse(readFileSync(BASELINE_PATH, "utf8")) as Baseline)
    : {};
  if (flag("update-baseline")) {
    writeFileSync(BASELINE_PATH, JSON.stringify(toBaseline(summaries, baseline), null, 2) + "\n");
    console.log(`[replay] baseline updated: ${BASELINE_PATH}`);
  }
  if (flag("check")) {
    const fails = checkBaseline(summaries, baseline);
    for (const f of fails) console.error(`[replay] BELOW BASELINE ${f}`);
    if (fails.length) process.exit(1);
    console.log("[replay] at or above baseline");
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
```

In `package.json` `scripts`, add after `"scraper:projections"`:

```json
    "replay": "tsx scraper/replay/cli.ts",
    "replay:check": "tsx scraper/replay/cli.ts --check",
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run scraper/__tests__/replay-report.test.ts`
Expected: PASS (6 tests).

Then: `pnpm typecheck && pnpm lint`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add scraper/replay/report.ts scraper/replay/cli.ts package.json scraper/__tests__/replay-report.test.ts
git commit -m "feat(replay): markdown report, trend log, baseline gate and CLI"
```

---

### Task 7: First run, baseline, documentation

**Files:**
- Create: `scraper/replay/baseline.json` (generated)
- Modify: `docs/superpowers/specs/2026-10-12-ranking-accounting-design.md` ("Measured baseline")
- Modify: `CLAUDE.md` (Commands + a "Replay harness" section)

- [ ] **Step 1: Fill the cache and run the full window**

Run: `pnpm replay`
Expected: both tours load (one-time download of ~25 files into `data/archive/`), a trend line prints, `logs/replay-<date>.md` exists.

- [ ] **Step 2: Sanity-check the report before trusting it**

Open `logs/replay-<date>.md`. Verify by hand for one top-10 ATP player in one week: the official points, the ledger's counted results (temporarily log `ledgerFor(...).counted` for that player id), and that each counted result matches the real event and round. If the counted list is wrong, fix the cause in the owning task's code with a test before recording anything.

- [ ] **Step 3: Record the baseline**

Run: `pnpm replay -- --update-baseline`, then `pnpm replay:check`
Expected: `at or above baseline`.

- [ ] **Step 4: Document**

In the spec's "Measured baseline" section, paste the trend line and the top five residual causes per tour and mode, with player-week counts. In `CLAUDE.md` Commands add:

```bash
pnpm replay                     # score our rules vs official weekly rankings (archive, 2023..2026-06)
pnpm replay:check               # exit 1 if any run scores below scraper/replay/baseline.json
```

and under Architecture a short "Replay harness" section: what it measures, that the official ranking (not live-tennis.eu) is ground truth, that unknown tiers are gaps, and that a rule change must keep `pnpm replay:check` green and update the baseline only when it improves.

- [ ] **Step 5: Commit**

```bash
git add scraper/replay/baseline.json docs/superpowers/specs/2026-10-12-ranking-accounting-design.md CLAUDE.md
git commit -m "chore(replay): record the Phase 1 baseline"
```

---

## After Phase 1

Write the Phase 2 plan from the residual causes the baseline reports. The
largest causes decide the order (expected candidates: `challenger_tier`,
`itf_w*`, `best_n`, `united_cup`), each closed with a sourced table or a
fetched data set and a replay improvement — never a default.
