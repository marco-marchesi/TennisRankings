# Phase 1b — Counting Slots Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace "best N by points" with the tours' real slot structure, choosing between competing readings of the rules by replay score rather than by guess.

**Architecture:** Each `PlayerResult` carries its category. The ledger fills ordered slots (ATP: 4 Slams, 8 mandatory 1000s; WTA: 4 Slams, best 6 of 7 combined 1000s, best 1 of 3 non-combined), then a pool of "others", then the Finals on top. Two open questions become explicit, switchable rule variants: whether an unused mandatory slot is lost or refilled from others (`refill`), and whether a 1000 result beyond its slot can count among the others (`overflow`). `pnpm replay -- --rules <variant>` scores each; the winner becomes the default, with the evidence recorded in the spec.

**Tech Stack:** TypeScript, Vitest; the Phase 1 replay harness.

**Spec:** `docs/superpowers/specs/2026-10-12-ranking-accounting-design.md` (Phase 1 findings: `best_n`, WTA non-combined 1000s).

## Global Constraints

- Every slot count cites `docs/ranking-rules.md` (ATP :17-27, WTA :255-264, :390-402).
- A variant is adopted only on replay evidence across all weeks and both modes, never from one player.
- Baseline only ratchets up; `--force` only with a ledgered ruling.
- Tests offline.

## Review Focus

1. Monte Carlo is a Masters 1000 but NOT mandatory (docs :162): it must fall to the others pool, not the mandatory slot. (Task 2 test.)
2. A player with fewer results than slots must not be charged zeros we cannot see (we have no acceptance lists): the `refill: false` variant loses only slot capacity, never points. (Task 2 test.)
3. The Finals stay on top of the slots in every variant. (Task 2 test.)
4. A non-default `--rules` run must not be compared against, or written into, the default baseline key. (Task 3 test.)
5. Two valid editions of the same Slam in one window (timing overlap) must not take two Slam slots silently — the 5th Slam result falls to others and is visible in `counted`. (Task 2 test.)

---

### Task 1: Category on every result

**Files:** Modify `scraper/replay/types.ts`, `scraper/replay/editions.ts`; Test `scraper/__tests__/replay-editions.test.ts`

**Interfaces:** Produces `PlayerResult.category: Category | null` (the edition's).

- [ ] **Step 1: Failing test** — in `replay-editions.test.ts` add:

```ts
  it("carries the edition's category on every result", () => {
    expect(pts(results, "champ").category).toBe("atp_250");
  });
```

- [ ] **Step 2:** `pnpm vitest run scraper/__tests__/replay-editions.test.ts` — Expected: FAIL (`undefined` vs `atp_250`).
- [ ] **Step 3:** In `types.ts` add to `PlayerResult`: `/** The edition's category; null for a gap edition. */ category: Category | null;` (import `Category`). In `editions.ts` add `category: edition.category,` to the pushed result.
- [ ] **Step 4:** Same command — Expected: PASS. Then `pnpm typecheck` — fix the test helpers that build `PlayerResult` literals (`replay-ledger.test.ts`, `replay-score.test.ts`) by adding `category: null`.

---

### Task 2: Slot-based ledger with explicit variants

**Files:** Modify `scraper/replay/rules.ts`, `scraper/replay/ledger.ts`; Test `scraper/__tests__/replay-ledger.test.ts`

**Interfaces:**
- Produces `CountingRules { slots: Slot[]; others: number; finalsExtra: boolean; refill: boolean; overflow: boolean; bestN: number }`, `Slot { name: string; take: number; match: (r: PlayerResult) => boolean }`, `RuleVariant = "flat" | "slots" | "slots+refill" | "slots+overflow" | "slots+refill+overflow"`, `countingRules(tour, week, variant = DEFAULT_VARIANT)`.
- `ledgerFor(results, week, rules)` unchanged signature and return.
- `bestN` stays (= total counted excluding Finals) for the `best_n` cause.

- [ ] **Step 1: Failing tests** — replace the `countingRules` describe and add a slots describe in `replay-ledger.test.ts`:

```ts
import { countingRules, type CountingRules } from "@scraper/replay/rules";

const c = (points: number, category: PlayerResult["category"], name = "x", over: Partial<PlayerResult> = {}) =>
  r(points, "2025-01-06", { category, editionName: name, editionKey: `${name}${points}${Math.random()}`, ...over });

describe("countingRules", () => {
  it("ATP: 4 Slams + 8 mandatory 1000s + 7 others, 6 from the 2026 season (docs :17-27)", () => {
    const r25 = countingRules("atp", "2025-12-22", "slots");
    expect(r25.slots.map((s) => [s.name, s.take])).toEqual([["slam", 4], ["mandatory_1000", 8]]);
    expect(r25.others).toBe(7);
    expect(r25.bestN).toBe(19);
    expect(countingRules("atp", "2025-12-29", "slots").others).toBe(6);
  });

  it("WTA: 4 Slams + best 6 combined 1000s + best 1 non-combined + 7 others (docs :255-264)", () => {
    const w = countingRules("wta", "2025-06-02", "slots");
    expect(w.slots.map((s) => [s.name, s.take])).toEqual([["slam", 4], ["combined_1000", 6], ["non_combined_1000", 1]]);
    expect(w.others).toBe(7);
  });

  it("keeps the flat best-N reading available for comparison", () => {
    expect(countingRules("atp", "2025-06-02", "flat").slots).toEqual([]);
  });
});

describe("ledgerFor — slots", () => {
  const atp = (variant: Parameters<typeof countingRules>[2]) => countingRules("atp", "2025-06-02", variant);

  it("puts Monte Carlo among the others, not in a mandatory slot (docs :162)", () => {
    const res = [c(1000, "masters_1000", "Monte Carlo Masters"), ...Array.from({ length: 7 }, () => c(500, "atp_500"))];
    const led = ledgerFor(res, "2025-06-02", atp("slots"));
    // 7 others: the 1000 from Monte Carlo + six 500s; the seventh 500 is cut.
    expect(led.total).toBe(1000 + 6 * 500);
  });

  it("without refill, an unused slot loses capacity, never points", () => {
    const res = [c(2000, "grand_slam"), ...Array.from({ length: 9 }, () => c(250, "atp_250"))];
    const led = ledgerFor(res, "2025-06-02", atp("slots"));
    expect(led.total).toBe(2000 + 7 * 250);
  });

  it("with refill, unused Slam and 1000 slots go to the others", () => {
    const res = [c(2000, "grand_slam"), ...Array.from({ length: 9 }, () => c(250, "atp_250"))];
    expect(ledgerFor(res, "2025-06-02", atp("slots+refill")).total).toBe(2000 + 9 * 250);
  });

  it("WTA: only the best non-combined 1000 takes the slot; overflow decides the rest", () => {
    const w = (variant: Parameters<typeof countingRules>[2]) => countingRules("wta", "2025-06-02", variant);
    const res = [c(1000, "wta_1000_nc", "Wuhan"), c(120, "wta_1000_nc", "Dubai"), c(65, "wta_1000_nc", "Doha")];
    expect(ledgerFor(res, "2025-06-02", w("slots")).total).toBe(1000);
    expect(ledgerFor(res, "2025-06-02", w("slots+overflow")).total).toBe(1000 + 120 + 65);
  });

  it("keeps the Finals on top in every variant", () => {
    const res = [c(1500, "finals", "Tour Finals", { isFinals: true }), c(250, "atp_250")];
    for (const v of ["flat", "slots", "slots+refill"] as const) {
      expect(ledgerFor(res, "2025-06-02", atp(v)).total).toBe(1750);
    }
  });

  it("a fifth Slam result in the window does not take a Slam slot", () => {
    const res = [...Array.from({ length: 5 }, () => c(100, "grand_slam")), c(50, "atp_250")];
    const led = ledgerFor(res, "2025-06-02", atp("slots"));
    // 4 Slam slots; without overflow the 5th Slam result is dropped.
    expect(led.total).toBe(4 * 100 + 50);
  });
});
```

Keep the existing window/indexing tests; change their `rules` literal to `countingRules("atp", "2025-06-02", "flat")` with `bestN` overridden: `{ ...countingRules("atp", "2025-06-02", "flat"), bestN: 2, others: 2 }`.

- [ ] **Step 2:** `pnpm vitest run scraper/__tests__/replay-ledger.test.ts` — Expected: FAIL (no `slots` on rules).

- [ ] **Step 3: Implementation**

```ts
// scraper/replay/rules.ts
//
// Which results count. Slot structure from docs/ranking-rules.md
// (ATP :17-27, WTA :255-264, :390-402). Two points the doc leaves open are
// explicit variants, chosen by replay score — see the spec's "Phase 1b".
//   refill    an unused Slam / 1000 slot is filled from the others
//             (a player not accepted into the event) instead of lost
//   overflow  a 1000 result beyond its slot can still count as an "other"
import type { PlayerResult, Tour } from "./types";

export interface Slot {
  name: string;
  take: number;
  match: (r: PlayerResult) => boolean;
}

export interface CountingRules {
  slots: Slot[];
  others: number;
  finalsExtra: boolean;
  refill: boolean;
  overflow: boolean;
  /** Results counted excluding the Finals: slot takes + others. */
  bestN: number;
}

export type RuleVariant = "flat" | "slots" | "slots+refill" | "slots+overflow" | "slots+refill+overflow";
export const RULE_VARIANTS: RuleVariant[] = ["flat", "slots", "slots+refill", "slots+overflow", "slots+refill+overflow"];
export const DEFAULT_VARIANT: RuleVariant = "flat";

/** First ranking week of the 2026 ATP season, when best-19 became best-18 (docs :17-27). */
const ATP_BEST_18_FROM = "2025-12-29";

const isSlam = (r: PlayerResult) => r.category === "grand_slam" || r.category === "wta_grand_slam";
// Monte Carlo is a 1000 but not mandatory (docs :162).
const isMandatory1000 = (r: PlayerResult) => r.category === "masters_1000" && !/Monte Carlo/i.test(r.editionName);

export function countingRules(tour: Tour, week: string, variant: RuleVariant = DEFAULT_VARIANT): CountingRules {
  const refill = variant.includes("refill");
  const overflow = variant.includes("overflow");
  if (tour === "atp") {
    const others = week >= ATP_BEST_18_FROM ? 6 : 7;
    const bestN = 12 + others;
    if (variant === "flat") return { slots: [], others: bestN, finalsExtra: true, refill: false, overflow: true, bestN };
    return {
      slots: [
        { name: "slam", take: 4, match: isSlam },
        { name: "mandatory_1000", take: 8, match: isMandatory1000 },
      ],
      others,
      finalsExtra: true,
      refill,
      overflow,
      bestN,
    };
  }
  const bestN = 18;
  if (variant === "flat") return { slots: [], others: bestN, finalsExtra: true, refill: false, overflow: true, bestN };
  return {
    slots: [
      { name: "slam", take: 4, match: isSlam },
      { name: "combined_1000", take: 6, match: (r) => r.category === "wta_1000" },
      { name: "non_combined_1000", take: 1, match: (r) => r.category === "wta_1000_nc" },
    ],
    others: 7,
    finalsExtra: true,
    refill,
    overflow,
    bestN,
  };
}
```

```ts
// scraper/replay/ledger.ts — replace ledgerFor
export function ledgerFor(results: PlayerResult[], week: string, rules: CountingRules): LedgerTotal {
  const valid = results.filter((r) => r.entryWeek <= week && week < r.expiryWeek);
  const extra = rules.finalsExtra ? valid.filter((r) => r.isFinals) : [];
  let rest = valid.filter((r) => !(rules.finalsExtra && r.isFinals)).sort((a, b) => b.points - a.points);

  const counted: PlayerResult[] = [];
  let unused = 0;
  for (const slot of rules.slots) {
    const mine = rest.filter(slot.match);
    const taken = mine.slice(0, slot.take);
    counted.push(...taken);
    unused += slot.take - taken.length;
    const spill = new Set(rules.overflow ? [] : mine.slice(slot.take));
    rest = rest.filter((r) => !taken.includes(r) && !spill.has(r));
  }
  const othersTake = rules.others + (rules.refill ? unused : 0);
  counted.push(...rest.slice(0, othersTake), ...extra);

  return {
    total: counted.reduce((s, r) => s + r.points, 0),
    counted,
    valid,
    gaps: [...new Set(valid.flatMap((r) => r.gaps))],
  };
}
```

- [ ] **Step 4:** Same command — Expected: PASS. `pnpm vitest run scraper/__tests__/replay-` — Expected: PASS (default variant `flat` keeps Phase 1 behaviour, so `replay-score` is unchanged).

---

### Task 3: `--rules` flag, variant-scoped baseline keys

**Files:** Modify `scraper/replay/report.ts` (`summarize` gains `variant`), `scraper/replay/cli.ts`; Test `scraper/__tests__/replay-report.test.ts`

**Interfaces:** `summarize(tour, mode, from, to, top, scores, variant = DEFAULT_VARIANT)`; key gets `:rules=<variant>` appended ONLY when `variant !== DEFAULT_VARIANT`.

- [ ] **Step 1: Failing test** in `replay-report.test.ts`:

```ts
describe("summarize — rule variants", () => {
  it("keys a non-default variant apart from the default baseline", () => {
    const d = summarize("atp", "full", "2025-06-02", "2025-06-09", 500, scores);
    const v = summarize("atp", "full", "2025-06-02", "2025-06-09", 500, scores, "slots");
    expect(v.key).toBe(`${d.key}:rules=slots`);
    expect(v.mode).toBe("full");
  });
});
```

- [ ] **Step 2:** `pnpm vitest run scraper/__tests__/replay-report.test.ts` — Expected: FAIL.
- [ ] **Step 3:** In `summarize` add parameter `variant: string = DEFAULT_VARIANT` (import from `./rules`) and build `key` as `` `${tour}:${mode}:${from}:${to}:top${top}${variant === DEFAULT_VARIANT ? "" : `:rules=${variant}`}` ``. In `cli.ts`: `const variant = arg("rules", DEFAULT_VARIANT) as RuleVariant;` exit 1 with a message if `!RULE_VARIANTS.includes(variant)`; pass `(w) => countingRules(tour, w, variant)` to both replays and `variant` to `summarize`; print the variant in the report header.
- [ ] **Step 4:** Same command — PASS; `pnpm typecheck`.

---

### Task 4: Choose the variant on evidence

**Files:** Modify `scraper/replay/rules.ts` (`DEFAULT_VARIANT`), spec "Phase 1b" section, `scraper/replay/baseline.json`.

- [ ] **Step 1:** Run every variant: `for v in flat slots slots+refill slots+overflow slots+refill+overflow; do pnpm replay -- --rules $v; done`. Collect the trend lines.
- [ ] **Step 2:** Record a table (variant × tour × mode: exact, ≤10) in the spec under "Phase 1b — counting slots", plus `best_n` player-weeks per variant from each report.
- [ ] **Step 3:** Ruling per tour: the variant with the highest delta exact rate, tie-broken by full ≤10. If the two tours prefer different variants, make `countingRules` take a per-tour default (`DEFAULT_VARIANT_BY_TOUR`) and say so in the ledger.
- [ ] **Step 4:** Set the default; `pnpm vitest run scraper/__tests__/replay-` (update only the `flat`-assuming test literals, citing this task); `pnpm replay -- --update-baseline` — must not need `--force` (the winner scores ≥ flat by construction; if it does need it, stop and investigate).
- [ ] **Step 5:** `pnpm test`, `pnpm typecheck`, `pnpm lint`.

## After Phase 1b

The bye rule (docs :68, :464) is the next rule candidate, judged the same way. Then Phase 2 data work: ATP Challenger tiers before 2026, WTA ITF tables, era-specific points tables, United Cup.
