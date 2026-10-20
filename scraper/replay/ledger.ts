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
  let rest = valid.filter((r) => !(rules.finalsExtra && r.isFinals)).sort((a, b) => b.points - a.points);

  // Slots first (best results of each kind), then the others, then the Finals.
  const counted: PlayerResult[] = [];
  let unused = 0;
  for (const slot of rules.slots) {
    const mine = rest.filter(slot.match);
    const taken = new Set(mine.slice(0, slot.take));
    counted.push(...taken);
    unused += slot.take - taken.size;
    const spill = new Set(rules.overflow ? [] : mine.slice(slot.take));
    rest = rest.filter((r) => !taken.has(r) && !spill.has(r));
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
