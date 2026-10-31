// Points a player has SECURED at one event of the current week, from their
// matches there (qualifying included).
//
// The live ranking credits, per event:
//   - main draw, last match lost        -> that round's value
//   - main draw, last match won (not F) -> the next round's value (secured
//                                          whatever happens next)
//   - won the final                     -> the title
//   - qualifier                         -> main-draw value + the qualifier's
//                                          value (the table's Q3 slot at a
//                                          non-Slam, qualifierBonus at a Slam)
//   - lucky loser                       -> main-draw value + the value of the
//                                          qualifying round they lost
//   - lost in qualifying                -> that qualifying round's value
//
// Verified against live-tennis.eu, 2026-10-31 (Basel / Vienna / Tokyo week):
//   Machac     qualified, lost Vienna R32:  0 + 25        - 10 dropping = +15
//   Altmaier   lucky loser, lost Basel R16: 50 + 13 (Q2)  - 100         = -37
//   Brunold    lucky loser, lost Basel R32:  0 + 13                     = +13
//   Parks      qualified, lost Tokyo QF:   108 + 25       - 54          = +79
//   Dart       qualified, lost Osaka R32 (WTA): 18, not 18 + 1 — a WTA
//              qualifier who loses her first main-draw match keeps the
//              qualifying points only (replay evidence, editions.ts).
//
// Before this, qualifying matches were ignored whenever a main-draw match
// existed (the event's LAST match decides the status), so every qualifier and
// lucky loser was short by the qualifying value.

import {
  canonicalizeRound,
  pointsForRound,
  qualifierBonus,
  ROUNDS_IN_ORDER,
  type Category,
  type Round,
} from "../config/points-table";
import { eraTable } from "../replay/points-eras";

export interface EventMatch {
  round: string;
  won: boolean;
  playedOn: string;
}

const MAIN: Round[] = ["R128", "R64", "R32", "R16", "QF", "SF", "F", "W"];
const ITF_LADDER: Round[] = ["R32", "R16", "QF", "SF", "F", "W"];

/**
 * Value lookup for one event. `itfTier` ("itf_w100", ...) prices an ITF event,
 * which the live points table cannot (its "itf" category scores 0).
 */
function valueOf(category: Category, itfTier: string | null): (r: Round) => number {
  if (category === "itf" && itfTier) {
    const t = eraTable("wta", itfTier as never, 2026, 32);
    if (t) {
      return (r: Round) => {
        if (r === "Q3") return t.qualifierBonus;
        if (r === "Q1" || r === "Q2") return t.qual(r === "Q2" ? 0 : 1, 2);
        return t.main[r] ?? 0;
      };
    }
  }
  return (r: Round) => pointsForRound(category, r);
}

function canonical(raw: string, category: Category): Round | null {
  if (category === "itf") {
    // TennisExplorer numbers ITF rounds "1R", "2R": a 32 draw. The generic
    // fallback maps them onto a 128 ladder (1R -> R128), which every ITF
    // table prices at nothing.
    const n = raw.trim().toUpperCase().match(/^(?:R)?(\d)(?:R)?$/);
    if (n) return ITF_LADDER[Number(n[1]) - 1] ?? null;
  }
  return canonicalizeRound(raw, category);
}

export interface EventCredit {
  points: number;
  /** Still alive in the main draw or qualifying. */
  inProgress: boolean;
}

export function securedAtEvent(
  tour: "atp" | "wta",
  category: Category,
  matches: EventMatch[],
  itfTier: string | null = null,
): EventCredit {
  const value = valueOf(category, itfTier);
  const slam = category === "grand_slam" || category === "wta_grand_slam";
  const qualifierValue = slam ? qualifierBonus(category) : value("Q3");

  const md: Array<{ round: Round; won: boolean }> = [];
  const q: Array<{ round: Round; won: boolean }> = [];
  for (const m of matches) {
    const r = canonical(m.round, category);
    if (!r) continue;
    // /^Q\d$/, not startsWith("Q"): "QF" is a main-draw round.
    (/^Q\d$/.test(r) ? q : md).push({ round: r, won: m.won });
  }
  const deepest = <T extends { round: Round }>(xs: T[]) =>
    xs.reduce((a, b) => (ROUNDS_IN_ORDER.indexOf(b.round) > ROUNDS_IN_ORDER.indexOf(a.round) ? b : a));

  if (md.length > 0) {
    const last = deepest(md);
    let points: number;
    let inProgress = false;
    if (!last.won) points = value(last.round);
    else if (last.round === "F") points = value("W");
    else {
      points = value(MAIN[MAIN.indexOf(last.round) + 1] ?? "W");
      inProgress = true;
    }
    if (q.length > 0) {
      const lastQ = deepest(q);
      if (lastQ.won) {
        if (tour === "wta" && md.length === 1 && !md[0]!.won) points = 0;
        points += qualifierValue;
      } else {
        points += value(lastQ.round);
      }
    }
    return { points, inProgress };
  }

  if (q.length === 0) return { points: 0, inProgress: false };
  const lastQ = deepest(q);
  if (!lastQ.won) return { points: value(lastQ.round), inProgress: false };
  // Won a qualifying round with no main-draw match yet: secured the next
  // qualifying round's loser value, or the qualifier's value after the last.
  const lastRound = slam ? "Q3" : "Q2";
  if (lastQ.round === lastRound || lastQ.round === "Q3") return { points: qualifierValue, inProgress: true };
  const next = lastQ.round === "Q1" ? "Q2" : "Q3";
  return { points: next === "Q3" && !slam ? qualifierValue : value(next), inProgress: true };
}
