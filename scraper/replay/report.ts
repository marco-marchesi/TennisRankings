import type { Residual, WeekScore } from "./replay";
import { DEFAULT_VARIANT } from "./rules";

export interface RunSummary {
  key: string;
  tour: string;
  mode: string;
  weeks: number;
  judged: number;
  exact: number;
  within10: number;
  within50: number;
  /** Player-weeks with no data gap: the fair judge between rule variants. */
  clean: { judged: number; exact: number; within10: number };
}

export type Baseline = Record<
  string,
  { exactRate: number; within10Rate: number; /** Absent in entries written before it existed. */ cleanExactRate?: number }
>;

export function summarize(
  tour: string,
  mode: string,
  from: string,
  to: string,
  top: number,
  scores: WeekScore[],
  variant: string = DEFAULT_VARIANT,
): RunSummary {
  const sum = (f: (s: WeekScore) => number) => scores.reduce((t, s) => t + f(s), 0);
  // A non-default rule variant gets its own key: it must never be gated
  // against, or written into, the default baseline.
  const rules = variant === DEFAULT_VARIANT ? "" : `:rules=${variant}`;
  return {
    key: `${tour}:${mode}:${from}:${to}:top${top}${rules}`,
    tour,
    mode,
    weeks: scores.length,
    judged: sum((s) => s.judged),
    exact: sum((s) => s.exact),
    within10: sum((s) => s.within10),
    within50: sum((s) => s.within50),
    clean: {
      judged: sum((s) => s.clean?.judged ?? 0),
      exact: sum((s) => s.clean?.exact ?? 0),
      within10: sum((s) => s.clean?.within10 ?? 0),
    },
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
  // A gate that compared nothing must not pass: a different window, --top or
  // a misspelled --tour would otherwise print "at or above baseline".
  if (!summaries.some((s) => baseline[s.key])) {
    return [`no baseline entry for ${summaries.map((s) => s.key).join(", ")}`];
  }
  const fails: string[] = [];
  for (const s of summaries) {
    const b = baseline[s.key];
    if (!b) continue;
    const exact = rate(s.exact, s.judged);
    const w10 = rate(s.within10, s.judged);
    const clean = rate(s.clean.exact, s.clean.judged);
    // 1e-9: rates are recomputed from integers; only a real drop may fail.
    const cleanDropped = b.cleanExactRate != null && clean + 1e-9 < b.cleanExactRate;
    if (exact + 1e-9 < b.exactRate || w10 + 1e-9 < b.within10Rate || cleanDropped) {
      fails.push(
        `${s.key}: exact ${(100 * exact).toFixed(2)}% (baseline ${(100 * b.exactRate).toFixed(2)}%), ` +
          `<=10 ${(100 * w10).toFixed(2)}% (baseline ${(100 * b.within10Rate).toFixed(2)}%), ` +
          `clean exact ${(100 * clean).toFixed(2)}% (baseline ${b.cleanExactRate == null ? "n/a" : (100 * b.cleanExactRate).toFixed(2) + "%"})`,
      );
    }
  }
  return fails;
}

/**
 * The new baseline, and the runs whose stored rate it would LOWER. Without
 * `force`, a lowering run keeps its stored entry: the gate only ratchets up.
 */
export function toBaseline(
  summaries: RunSummary[],
  prior: Baseline,
  force: boolean,
): { baseline: Baseline; lowered: string[] } {
  const baseline: Baseline = { ...prior };
  const lowered: string[] = [];
  for (const s of summaries) {
    const next = {
      exactRate: rate(s.exact, s.judged),
      within10Rate: rate(s.within10, s.judged),
      cleanExactRate: rate(s.clean.exact, s.clean.judged),
    };
    const old = prior[s.key];
    const cleanFell = old?.cleanExactRate != null && next.cleanExactRate + 1e-9 < old.cleanExactRate;
    if (old && (next.exactRate + 1e-9 < old.exactRate || next.within10Rate + 1e-9 < old.within10Rate || cleanFell)) {
      lowered.push(s.key);
      if (!force) continue;
    }
    baseline[s.key] = next;
  }
  return { baseline, lowered };
}

export function trendLine(at: string, summaries: RunSummary[]): string {
  return `${at}  ${summaries
    .map(
      (s) =>
        `${s.tour}-${s.mode}=${pct(s.exact, s.judged)}(<=10 ${pct(s.within10, s.judged)}; ` +
        `clean ${pct(s.clean.exact, s.clean.judged)} of ${s.clean.judged})`,
    )
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
      `<=50 ${pct(summary.within50, summary.judged)}. Clean subset (no data gap): ${summary.clean.judged} ` +
      `player-weeks, exact ${pct(summary.clean.exact, summary.clean.judged)}, <=10 ${pct(summary.clean.within10, summary.clean.judged)}`,
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
