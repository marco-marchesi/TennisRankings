// The WTA live total from the player's real ranking breakdown.
//
// The WTA counts a player's best 18 results, so a live ranking does NOT simply
// add this week's result and subtract what drops:
//
//   - a new result no better than the last counted one changes nothing;
//   - a better one replaces it (Shnaider, Tokyo SF 195 over her 18th-best
//     60: live-tennis.eu +135, not +195);
//   - a dropping result that was not counted costs nothing.
//
// And not every result can be displaced. Grand Slams, the combined WTA 1000s
// and the Finals are mandatory: they count whatever they are worth, and a
// missed one counts as a zero ("zero-pointer") that still takes a slot. A new
// 500 result therefore competes only with the NON-mandatory counted results:
//   Rybakina, Tokyo QF 108: her 18th result is a 10 from Beijing, but it is
//     mandatory; her lowest counted non-mandatory result is 108 -> +0.
//   Linette, Guangzhou R16 30: her 10s are Slams and 1000s -> +0.
// The zero-pointers also explain why some official totals are the best 14 or
// 15 results rather than 18 (Udvardy, Yastremska).
//
// The feed does not list zero-pointers, so the number of real slots is
// CALIBRATED: the model is taken with the slot count that reproduces the
// official total exactly, and the live delta computed under it:
//
//   live = official + total(before - dropped + this week) - official
//
// Measured against live-tennis.eu on 2026-10-31 (WTA top 200, within 10):
//   naive (earned - dropped)                   167 / 199
//   best 18                                    183
//   mandatory model, slots calibrated          187
//   ... then best-K calibrated, then 18 slots  192
//   either model, fewest zero-pointers first   193
//
// `before` is the per-player event list from api.wtatennis.com
// (sources/wta-player-events.ts) restricted to what the official ranking of
// `weekStart` holds; which of those drop by the projected publish follows the
// same rules as the history-derived dropping (drop-horizon.ts).

import type { WtaEvent } from "../sources/wta-player-events";
import { itfTierFromPrize } from "../sources/wta-player-events";
import { addDays, chargesResult, expiryOf } from "./drop-horizon";

export const WTA_COUNTED_RESULTS = 18;

/**
 * City key shared by api.wtatennis.com names ("MADRID 1000", "QUERETARO 125",
 * "GLASGOW 2") and ours ("Madrid", "Queretaro 125", "Glasgow 2 ITF",
 * "Tokyo (Japan Open)").
 */
export function cityKey(name: string): string {
  return name
    .toLowerCase()
    .replace(/\([^)]*\)/g, " ")
    .replace(/\b(itf|wta|atp|wtt|open|1000|500|250|125)\b/g, " ")
    .replace(/[^a-z]+/g, "");
}

export function bestN(points: number[], n = WTA_COUNTED_RESULTS): number {
  return [...points].sort((a, b) => b - a).slice(0, n).reduce((s, p) => s + p, 0);
}

/** The two lowest ITF tiers reach the ranking a week late (replay/editions.ts enteredLate). */
function entersLate(e: WtaEvent): boolean {
  if (e.level !== "ITF") return false;
  const tier = itfTierFromPrize(e.prize);
  return tier === "itf_w15" || tier === "itf_w35";
}

export interface WtaBreakdown {
  /** Results the official ranking of `weekStart` holds. */
  before: WtaEvent[];
  /** Of those, the ones gone by the projected publish. */
  dropped: WtaEvent[];
}

export function wtaBreakdown(
  events: WtaEvent[],
  ctx: {
    weekStart: string;
    horizon: string;
    /**
     * Tour events on now, by WTA tournament number ("1056") -> first
     * main-draw date (null: qualifying only). Never by city: this week's
     * "Toronto ITF" matched the Toronto WTA 1000 and charged Sabalenka's
     * Canada result as dropping.
     */
    current: Map<string, string | null>;
  },
): WtaBreakdown {
  const before: WtaEvent[] = [];
  const dropped: WtaEvent[] = [];
  for (const e of events) {
    let expiry = expiryOf(e.end);
    if (entersLate(e)) expiry = addDays(expiry, 7);
    // Entered after this week's publish: not in the official total.
    if (addDays(expiry, -364) > ctx.weekStart) continue;
    // A later edition of the same event already counted replaced this one.
    const superseded = events.some(
      (o) => o.nbr === e.nbr && o.year > e.year && addDays(expiryOf(o.end), -364) <= ctx.weekStart,
    );
    if (superseded) continue;
    // Only an earlier edition of a TOUR event can be replaced by the one on
    // now. ITF events simply expire: they are weekly series ("MONASTIR 4",
    // "MONASTIR 5", ...) and any city match charged every past edition of
    // this week's Monastir as dropping.
    const replacedNow = e.level !== "ITF" && ctx.current.has(e.nbr) && e.end < addDays(ctx.weekStart, -180);
    const mdStart = replacedNow ? (ctx.current.get(e.nbr) ?? null) : null;
    const held = expiry > ctx.weekStart || (replacedNow && mdStart != null && mdStart < expiry);
    if (!held) continue;
    before.push(e);
    const charge = chargesResult({
      expiry,
      weekStart: ctx.weekStart,
      horizon: ctx.horizon,
      replacedNow,
      currentMainDrawStart: mdStart,
      nextLo: null,
      beyondNextMonday: false,
    });
    if (charge) dropped.push(e);
  }
  return { before, dropped };
}

/** A result this week, and whether its event is a mandatory one. */
export interface LiveResult {
  points: number;
  mandatory: boolean;
}

const NON_COMBINED_1000 = /DOHA|DUBAI|WUHAN/i;

/** Grand Slam, combined WTA 1000 or the Finals: counts whatever it is worth. */
export function isMandatory(e: WtaEvent): boolean {
  return e.level === "GS" || e.level === "CH" || (e.level === "PM" && !NON_COMBINED_1000.test(e.name));
}

function sum(xs: number[]): number {
  return xs.reduce((a, b) => a + b, 0);
}

/** Mandatory results all count; the best others fill what is left of `slots`. */
function mandatoryTotal(events: WtaEvent[], slots: number, extra: LiveResult[] = []): number {
  const mand = [...events.filter(isMandatory).map((e) => e.points), ...extra.filter((x) => x.mandatory).map((x) => x.points)];
  const others = [...events.filter((e) => !isMandatory(e)).map((e) => e.points), ...extra.filter((x) => !x.mandatory).map((x) => x.points)];
  return sum(mand) + bestN(others, Math.max(0, slots - mand.length));
}

/** Live delta: see the header. `official` anchors the calibration. */
export function wtaLiveDelta(b: WtaBreakdown, thisWeek: LiveResult[], official: number): number {
  const droppedKeys = new Set(b.dropped.map((e) => e.key));
  const kept = b.before.filter((e) => !droppedKeys.has(e.key));
  // Real slots left once zero-pointers are taken: the fewest zero-pointers
  // that explain the official total, under the mandatory model first and
  // plain best-N second at each count (a player with no mandatory results to
  // speak of is just best-N).
  const before = b.before.map((e) => e.points);
  const after = [...kept.map((e) => e.points), ...thisWeek.map((x) => x.points)];
  for (const slots of [18, 17, 16, 15, 14, 13, 12, 19, 20]) {
    if (mandatoryTotal(b.before, slots) === official) return mandatoryTotal(kept, slots, thisWeek) - official;
    if (bestN(before, slots) === official) return bestN(after, slots) - official;
  }
  return mandatoryTotal(kept, WTA_COUNTED_RESULTS, thisWeek) - mandatoryTotal(b.before, WTA_COUNTED_RESULTS);
}
