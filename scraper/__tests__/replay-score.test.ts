import { describe, expect, it } from "vitest";
import { replayDelta, replayFull } from "@scraper/replay/replay";
import type { CountingRules } from "@scraper/replay/rules";
import type { OfficialRow, PlayerResult } from "@scraper/replay/types";

// Phase 1 "best N by points" rules, built in full so tests do not depend on the default variant.
const flat = (n: number): CountingRules => ({ slots: [], others: n, finalsExtra: true, refill: false, overflow: true, bestN: n });

const off = (week: string, rows: Array<[string, number, number]>) =>
  new Map(rows.map(([pid, rank, points]) => [pid, { week, rank, playerId: pid, points, tours: null } as OfficialRow]));
const res = (pid: string, points: number, entryWeek: string, expiryWeek: string, gaps: string[] = []): PlayerResult => ({
  playerId: pid, editionKey: `${pid}-${entryWeek}`, editionName: "x", points, category: null, mainDraw: true, entryWeek, expiryWeek, isFinals: false, gaps,
});

describe("replayFull", () => {
  const byWeek = new Map([["2025-06-02", off("2025-06-02", [["a", 1, 300], ["b", 2, 200], ["c", 3, 50]])]]);
  const results = new Map([
    ["a", [res("a", 300, "2025-01-06", "2026-01-05")]],
    ["b", [res("b", 150, "2025-01-06", "2026-01-05"), res("b", 0, "2025-01-06", "2026-01-05", ["challenger_tier"])]],
  ]);
  const [score] = replayFull(byWeek, results, () => flat(18), ["2025-06-02"], 10);

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

  it("blames best_n only when a result that scores was left out", () => {
    const byWeek1 = new Map([["2025-06-02", off("2025-06-02", [["z", 1, 150]])]]);
    const zeroLeftOut = new Map([["z", [res("z", 100, "2025-01-06", "2026-01-05"), res("z", 0, "2025-01-06", "2026-01-05")]]]);
    const [s] = replayFull(byWeek1, zeroLeftOut, () => flat(1), ["2025-06-02"], 10);
    expect(s!.residuals[0]!.causes).toEqual(["unexplained"]);
  });

  it("only judges players inside the top N", () => {
    const [s] = replayFull(byWeek, results, () => flat(18), ["2025-06-02"], 1);
    expect(s!.judged).toBe(1);
  });
});

describe("replayDelta", () => {
  const rules = () => flat(18);

  it("applies the counting rules: a result that was never counted changes nothing when it leaves", () => {
    // Official did not move when a small result outside the best N expired.
    // Delta used to charge every leaving result in full (and could only blame
    // best_n); it now adds OUR ledger's change, so the counting rules act on
    // the prediction and rule variants can be compared on it (Phase 1b).
    const byWeek = new Map([
      ["2025-06-02", off("2025-06-02", [["a", 1, 500]])],
      ["2025-06-09", off("2025-06-09", [["a", 1, 500]])],
    ]);
    const results = new Map([
      ["a", [res("a", 500, "2025-01-06", "2026-01-05"), res("a", 25, "2024-06-10", "2025-06-09")]],
    ]);
    const [score] = replayDelta(byWeek, results, () => flat(1), ["2025-06-02", "2025-06-09"], 10);
    expect(score!.exact).toBe(1);
  });

  it("scores a rule variant differently when the variant changes what counts", () => {
    // Under best-1 the leaving 25 was uncounted (no change); under best-2 it
    // was counted, so our ledger drops 25 while the official stays put.
    const byWeek = new Map([
      ["2025-06-02", off("2025-06-02", [["a", 1, 500]])],
      ["2025-06-09", off("2025-06-09", [["a", 1, 500]])],
    ]);
    const results = new Map([
      ["a", [res("a", 500, "2025-01-06", "2026-01-05"), res("a", 25, "2024-06-10", "2025-06-09")]],
    ]);
    const [score] = replayDelta(byWeek, results, () => flat(2), ["2025-06-02", "2025-06-09"], 10);
    expect(score!.residuals[0]!.delta).toBe(-25);
  });

  it("adds what enters and removes what leaves between two published weeks", () => {
    const byWeek = new Map([
      ["2025-06-02", off("2025-06-02", [["a", 1, 1000]])],
      ["2025-06-09", off("2025-06-09", [["a", 1, 1150]])],
    ]);
    const results = new Map([
      ["a", [res("a", 250, "2025-06-09", "2026-06-08"), res("a", 100, "2024-06-10", "2025-06-09")]],
    ]);
    const [score] = replayDelta(byWeek, results, rules, ["2025-06-02", "2025-06-09"], 10);
    expect(score!.week).toBe("2025-06-09");
    expect(score!.exact).toBe(1);
  });

  it("spans a two-week gap between published weeks", () => {
    const byWeek = new Map([
      ["2025-12-22", off("2025-12-22", [["a", 1, 1000]])],
      ["2026-01-05", off("2026-01-05", [["a", 1, 1250]])],
    ]);
    const results = new Map([["a", [res("a", 250, "2025-12-29", "2026-12-28")]]]);
    const [score] = replayDelta(byWeek, results, rules, ["2025-12-22", "2026-01-05"], 10);
    expect(score!.exact).toBe(1);
  });

  it("flags a player missing from the previous week", () => {
    const byWeek = new Map([
      ["2025-06-02", off("2025-06-02", [])],
      ["2025-06-09", off("2025-06-09", [["n", 1, 10]])],
    ]);
    const [score] = replayDelta(byWeek, new Map(), rules, ["2025-06-02", "2025-06-09"], 10);
    expect(score!.residuals[0]!.causes).toEqual(["new_in_ranking"]);
  });
});

describe("rank-dependent rules", () => {
  it("passes each player's official rank to the rules", () => {
    const byWeek = new Map([["2025-06-02", off("2025-06-02", [["a", 7, 100]])]]);
    const seen: number[] = [];
    replayFull(byWeek, new Map(), (_w, rank) => { seen.push(rank); return flat(18); }, ["2025-06-02"], 10);
    expect(seen).toEqual([7]);
  });
});

describe("delta — review fixes", () => {
  it("uses ONE rank for both ledgers of a step, so a rank cutoff cannot flip mid-step", () => {
    const byWeek = new Map([
      ["2025-06-02", off("2025-06-02", [["a", 98, 500]])],
      ["2025-06-09", off("2025-06-09", [["a", 103, 500]])],
    ]);
    const seen: Array<[string, number]> = [];
    replayDelta(byWeek, new Map(), (w, rank) => { seen.push([w, rank]); return flat(18); }, ["2025-06-02", "2025-06-09"], 500);
    expect(seen.map(([, rank]) => rank)).toEqual([98, 98]);
  });

  it("blames best_n when a result outside the counted set leaves", () => {
    // The 30 was never counted (best 1), so our ledger does not move, but
    // the official one did: the counting rule decided this residual.
    const byWeek = new Map([
      ["2025-06-02", off("2025-06-02", [["a", 1, 530]])],
      ["2025-06-09", off("2025-06-09", [["a", 1, 500]])],
    ]);
    const results = new Map([
      ["a", [res("a", 500, "2025-01-06", "2026-01-05"), res("a", 30, "2024-06-10", "2025-06-09")]],
    ]);
    const [score] = replayDelta(byWeek, results, () => flat(1), ["2025-06-02", "2025-06-09"], 10);
    expect(score!.residuals[0]!.causes).toContain("best_n");
  });
});

describe("clean subset", () => {
  it("counts the player-weeks whose results carry no data gap", () => {
    const byWeek = new Map([["2025-06-02", off("2025-06-02", [["a", 1, 300], ["b", 2, 200]])]]);
    const results = new Map([
      ["a", [res("a", 300, "2025-01-06", "2026-01-05")]],
      ["b", [res("b", 150, "2025-01-06", "2026-01-05", ["challenger_tier"])]],
    ]);
    const [s] = replayFull(byWeek, results, () => flat(18), ["2025-06-02"], 10);
    expect(s!.clean).toEqual({ judged: 1, exact: 1, within10: 1 });
  });
});
