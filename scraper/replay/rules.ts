// Which results count. Slot structure from docs/ranking-rules.md
// (ATP :17-27, WTA :255-264, :390-402). Two points the doc leaves open are
// explicit variants, chosen by replay score — see the spec's "Phase 1b".
//   refill    an unused Slam / 1000 slot is filled from the others
//             (a player not accepted into the event) instead of lost
//   overflow  a 1000 result beyond its slot can still count as an "other"
// Mandatory-event zeros and the ATP Finals expiry are handled elsewhere or
// not yet modelled; the replay measures what each omission costs.
import type { PlayerResult, Tour } from "./types";

export interface Slot {
  name: string;
  take: number;
  match: (r: PlayerResult) => boolean;
}

export interface CountingRules {
  slots: Slot[];
  others: number;
  /** The year-end Finals counts on top of everything else. */
  finalsExtra: boolean;
  refill: boolean;
  overflow: boolean;
  /** Results counted excluding the Finals: slot takes + others. */
  bestN: number;
}

/**
 * "flat", or "slots" plus any of "+overflow", "+refill", "+refill>K",
 * "+flat>K". "refill>K" refills an unused slot only for a player ranked below
 * K (Slams are mandatory "if accepted", docs :21, and acceptance follows
 * ranking). "flat>K" drops the slots for a player ranked below K.
 */
export type RuleVariant = string;
export const RULE_VARIANTS: RuleVariant[] = [
  "flat",
  "slots",
  "slots+refill",
  "slots+overflow",
  "slots+refill+overflow",
];
/**
 * Chosen by replay on the clean subset (player-weeks with no data gap),
 * re-judged in Phase 2a (2026-10-13) once the season tables and Challenger
 * tiers grew that subset to ~67k ATP / ~74k WTA player-weeks (from ~1k / ~3k
 * in Phase 1b, when "refill>50" won narrowly). Refilling every player's
 * unused Slam / 1000 slot beats any rank cutoff on both tours (ATP clean
 * full 44.2% / delta 89.3% vs 44.0 / 88.9 at >50; WTA 30.8 / 77.0 vs
 * 30.6 / 76.7). "flat" scores slightly higher on the ATP (44.6 / 89.5), but
 * not consistently: where it alone is exact it wins 2023-24 and loses 2026
 * (top 30: 6 vs 27), so the written slot structure (docs :17-27) stands.
 * Overflow matters only on the WTA (combined 1000s beyond six).
 */
export const DEFAULT_VARIANT: RuleVariant = "slots+refill+overflow";

interface ParsedVariant {
  flat: boolean;
  /** Players ranked worse than this count their flat best N, no slots. */
  flatAbove: number | null;
  overflow: boolean;
  refill: boolean;
  /** Refill only when the player's rank is worse than this. */
  refillAbove: number | null;
}

export function parseVariant(variant: RuleVariant): ParsedVariant {
  if (variant === "flat") return { flat: true, flatAbove: null, overflow: true, refill: false, refillAbove: null };
  const [head, ...mods] = variant.split("+");
  if (head !== "slots") throw new Error(`unknown rule variant "${variant}"`);
  const out: ParsedVariant = { flat: false, flatAbove: null, overflow: false, refill: false, refillAbove: null };
  for (const m of mods) {
    const cut = m.match(/^refill>(\d+)$/);
    if (m === "overflow") out.overflow = true;
    else if (/^flat>\d+$/.test(m)) out.flatAbove = Number(m.slice(5));
    else if (m === "refill") out.refill = true;
    else if (cut) {
      out.refill = true;
      out.refillAbove = Number(cut[1]);
    } else throw new Error(`unknown rule variant "${variant}"`);
  }
  return out;
}

/** First ranking week of the 2026 ATP season, when best-19 became best-18 (docs :17-27). */
const ATP_BEST_18_FROM = "2025-12-29";
/**
 * First ranking week of the 2024 WTA season. Before it the WTA counted "a
 * maximum of 16 tournaments for singles" (en.wikipedia.org WTA_rankings,
 * oldid 1162000864, June 2023) with no Slam / 1000 slots modelled.
 */
const WTA_BEST_18_FROM = "2024-01-01";

// Slot matches require a main-draw result: a player who only played
// qualifying was not accepted, so the result counts among the others.
const isSlam = (r: PlayerResult) =>
  r.mainDraw && (r.category === "grand_slam" || r.category === "wta_grand_slam");
// Monte Carlo is a 1000 but not mandatory (docs :162).
const isMandatory1000 = (r: PlayerResult) =>
  r.mainDraw && r.category === "masters_1000" && !/Monte Carlo/i.test(r.editionName);

export function countingRules(
  tour: Tour,
  week: string,
  variant: RuleVariant = DEFAULT_VARIANT,
  rank: number = Number.POSITIVE_INFINITY,
): CountingRules {
  const parsed = parseVariant(variant);
  const v = parsed.flatAbove != null && rank > parsed.flatAbove ? { ...parsed, flat: true } : parsed;
  const refill = v.refill && (v.refillAbove == null || rank > v.refillAbove);
  const overflow = v.overflow;
  if (tour === "atp") {
    const others = week >= ATP_BEST_18_FROM ? 6 : 7;
    const bestN = 12 + others;
    if (v.flat) return { slots: [], others: bestN, finalsExtra: true, refill: false, overflow: true, bestN };
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
  if (week < WTA_BEST_18_FROM) {
    return { slots: [], others: 16, finalsExtra: true, refill: false, overflow: true, bestN: 16 };
  }
  const bestN = 18;
  if (v.flat) return { slots: [], others: bestN, finalsExtra: true, refill: false, overflow: true, bestN };
  return {
    slots: [
      { name: "slam", take: 4, match: isSlam },
      { name: "combined_1000", take: 6, match: (r) => r.mainDraw && r.category === "wta_1000" },
      { name: "non_combined_1000", take: 1, match: (r) => r.mainDraw && r.category === "wta_1000_nc" },
    ],
    others: 7,
    finalsExtra: true,
    refill,
    overflow,
    bestN,
  };
}
