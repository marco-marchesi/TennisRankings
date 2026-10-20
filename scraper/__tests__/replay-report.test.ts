import { describe, expect, it } from "vitest";
import { causeCounts, checkBaseline, renderSection, summarize, toBaseline, trendLine } from "@scraper/replay/report";
import type { WeekScore } from "@scraper/replay/replay";

const scores: WeekScore[] = [
  { week: "2025-06-02", judged: 4, exact: 2, within10: 3, within50: 4, clean: { judged: 0, exact: 0, within10: 0 }, residuals: [
    { playerId: "1", rank: 1, official: 100, ours: 90, delta: -10, causes: ["challenger_tier"] },
    { playerId: "2", rank: 2, official: 100, ours: 70, delta: -30, causes: ["challenger_tier", "best_n"] },
  ] },
  { week: "2025-06-09", judged: 4, exact: 4, within10: 4, within50: 4, clean: { judged: 0, exact: 0, within10: 0 }, residuals: [] },
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
  it("fails when the baseline covers none of the runs", () => {
    // A different --top/--from/--to, or a misspelled --tour, compared
    // nothing and still printed "at or above baseline".
    const fails = checkBaseline([s], {});
    expect(fails).toHaveLength(1);
    expect(fails[0]).toContain("no baseline entry");
  });

  it("ignores an uncovered run when another run was compared", () => {
    const other = summarize("wta", "full", "2025-06-02", "2025-06-09", 500, scores);
    expect(checkBaseline([s, other], { [s.key]: { exactRate: 0.75, within10Rate: 0.875 } })).toEqual([]);
  });
});

describe("toBaseline", () => {
  const s = summarize("atp", "full", "2025-06-02", "2025-06-09", 500, scores);

  it("refuses to lower a stored rate unless forced, and names the run", () => {
    const prior = { [s.key]: { exactRate: 0.9, within10Rate: 0.9 } };
    const kept = toBaseline([s], prior, false);
    expect(kept.lowered).toEqual([s.key]);
    expect(kept.baseline).toEqual(prior);
    const forced = toBaseline([s], prior, true);
    expect(forced.baseline[s.key]!.exactRate).toBe(0.75);
  });

  it("raises a stored rate", () => {
    const prior = { [s.key]: { exactRate: 0.5, within10Rate: 0.5 } };
    const r = toBaseline([s], prior, false);
    expect(r.lowered).toEqual([]);
    expect(r.baseline[s.key]!.exactRate).toBe(0.75);
  });
});

describe("renderSection", () => {
  it("names players and shows the worst residuals", () => {
    const md = renderSection(summarize("atp", "full", "2025-06-02", "2025-06-09", 500, scores), scores, new Map([["2", "Jannik Sinner"]]));
    expect(md).toContain("Jannik Sinner");
    expect(md).toContain("challenger_tier");
  });
});

describe("summarize — rule variants", () => {
  it("keys a non-default variant apart from the default baseline", () => {
    const d = summarize("atp", "full", "2025-06-02", "2025-06-09", 500, scores);
    const v = summarize("atp", "full", "2025-06-02", "2025-06-09", 500, scores, "slots");
    expect(v.key).toBe(`${d.key}:rules=slots`);
    expect(v.mode).toBe("full");
  });
});

describe("summarize — clean subset", () => {
  it("pools the clean subset and shows it in the trend line", () => {
    const withClean = scores.map((s) => ({ ...s, clean: { judged: 2, exact: 1, within10: 2 } }));
    const s = summarize("atp", "delta", "2025-06-02", "2025-06-09", 500, withClean);
    expect(s.clean).toEqual({ judged: 4, exact: 2, within10: 4 });
    expect(trendLine("t", [s])).toContain("clean 50.0%");
  });
});

describe("baseline — clean subset", () => {
  const withClean = scores.map((s) => ({ ...s, clean: { judged: 2, exact: 1, within10: 2 } }));
  const s = summarize("atp", "delta", "2025-06-02", "2025-06-09", 500, withClean);

  it("stores the clean exact rate", () => {
    expect(toBaseline([s], {}, false).baseline[s.key]!.cleanExactRate).toBe(0.5);
  });

  it("fails the gate when the clean exact rate drops", () => {
    const fails = checkBaseline([s], { [s.key]: { exactRate: 0, within10Rate: 0, cleanExactRate: 0.6 } });
    expect(fails).toHaveLength(1);
    expect(fails[0]).toContain("clean");
  });
});
