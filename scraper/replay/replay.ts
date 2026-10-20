// Score our totals against the official ranking.
//
//   full   ledger total at week W vs official(W): tests rules AND data depth.
//   delta  official(W0) + (our ledger(W1) - our ledger(W0)) vs official(W1):
//          tests week-to-week rules, counting rules included, anchored on the
//          official number so it needs less than 52 weeks of clean data.
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
  /**
   * The same counts over player-weeks whose results carry NO data gap
   * (unknown tier, unsourced era, incomplete draw). The fair judge between
   * rule variants: a gap biases full mode toward counting more results and
   * delta mode toward counting fewer.
   */
  clean: { judged: number; exact: number; within10: number };
}

type ByWeek = Map<string, Map<string, OfficialRow>>;

/** Counting rules for a week and a player's official rank that week (acceptance follows rank). */
export type RulesFor = (week: string, rank: number) => CountingRules;

function score(
  week: string,
  official: Map<string, OfficialRow>,
  top: number,
  ours: (row: OfficialRow) => { total: number; causes: string[]; clean: boolean },
): WeekScore {
  const s: WeekScore = {
    week, judged: 0, exact: 0, within10: 0, within50: 0, residuals: [],
    clean: { judged: 0, exact: 0, within10: 0 },
  };
  for (const row of official.values()) {
    if (row.rank > top) continue;
    s.judged++;
    const mine = ours(row);
    const delta = mine.total - row.points;
    const abs = Math.abs(delta);
    if (abs === 0) s.exact++;
    if (abs <= 10) s.within10++;
    if (abs <= 50) s.within50++;
    if (mine.clean) {
      s.clean.judged++;
      if (abs === 0) s.clean.exact++;
      if (abs <= 10) s.clean.within10++;
    }
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
  rulesFor: RulesFor,
  weeks: string[],
  top: number,
): WeekScore[] {
  return weeks.map((week) => {
    return score(week, byWeek.get(week) ?? new Map(), top, (row) => {
      const led = ledgerFor(resultsByPlayer.get(row.playerId) ?? [], week, rulesFor(week, row.rank));
      const causes = [...led.gaps];
      if (led.valid.length === 0) causes.push("no_results");
      else if (cutSomethingThatScores(led.valid, led.counted)) causes.push("best_n");
      return { total: led.total, causes, clean: led.valid.length > 0 && led.gaps.length === 0 };
    });
  });
}

/** Did the best-N cut leave out a result worth points? A 0-point extra changes nothing. */
function cutSomethingThatScores(valid: PlayerResult[], counted: PlayerResult[]): boolean {
  const kept = new Set(counted);
  return valid.some((r) => !kept.has(r) && r.points > 0);
}

export function replayDelta(
  byWeek: ByWeek,
  resultsByPlayer: Map<string, PlayerResult[]>,
  rulesFor: RulesFor,
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
        // Our ledger's CHANGE, not the raw sum of what entered and left: a
        // result outside the counted set changes nothing, and that is exactly
        // what the counting rules decide.
        // ONE rank for both ledgers: a rank-dependent rule (refill>K) must not
        // flip between the two halves of a step because the rank moved.
        const rank = prev.get(row.playerId)?.rank ?? row.rank;
        const led0 = ledgerFor(results, w0, rulesFor(w0, rank));
        const led1 = ledgerFor(results, w1, rulesFor(w1, rank));
        const total = base + led1.total - led0.total;
        const causes = [...new Set([...entering, ...leaving].flatMap((r) => r.gaps))];
        if (!prev.has(row.playerId)) causes.push("new_in_ranking");
        // The counting structure decided this residual if a scoring result
        // changed counted status, or entered/left without being counted.
        const counted0 = new Set(led0.counted);
        const counted1 = new Set(led1.counted);
        const moved = results.some(
          (r) =>
            r.points > 0 &&
            !entering.includes(r) &&
            !leaving.includes(r) &&
            counted0.has(r) !== counted1.has(r),
        );
        const uncounted =
          entering.some((r) => r.points > 0 && !counted1.has(r)) ||
          leaving.some((r) => r.points > 0 && !counted0.has(r));
        if (moved || uncounted) causes.push("best_n");
        const clean = prev.has(row.playerId) && led0.gaps.length === 0 && led1.gaps.length === 0;
        return { total, causes, clean };
      }),
    );
  }
  return out;
}
