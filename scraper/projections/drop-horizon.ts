// Pure date rules behind the WTA dropping derivation.
//
// WHAT LIVE-TENNIS.EU MEASURES
//
// Its live ranking is the ranking as it will be published AFTER the event in
// progress finishes. For a one-week event that is next Monday. For a two-week
// event (a Slam, or a 96-draw 1000) in its first week it is the Monday after
// the SECOND week — and every result that expires by then is gone.
//
// Verified 2026-09-29, week 1 of Beijing (main draw 30 Sep - 11 Oct):
//
//   Gauff  7244 - 390 (Beijing 2025 SF) - 1000 (Wuhan 2025 title) + 10 = 5864
//
// Wuhan 2025 ended 12 Oct 2025, entered the ranking on 13 Oct 2025 and expires
// 52 weeks later, on 12 Oct 2026 — the same Monday Beijing 2026 is published.
// The previous derivation only charged results from events being played THIS
// week, so it dropped Beijing and kept Wuhan: Gauff +990, Pegula +650,
// Paolini +379, Sabalenka +325 against live-tennis.eu.

import type { Category } from "../config/points-table";

const DAY = 86_400_000;

export const iso = (t: number) => new Date(t).toISOString().slice(0, 10);
export const addDays = (d: string, n: number) => iso(Date.parse(`${d}T00:00:00Z`) + n * DAY);

/** The Monday strictly after `d` (a Sunday's next Monday is the day after). */
export function mondayAfter(d: string): string {
  const dow = new Date(`${d}T00:00:00Z`).getUTCDay(); // 0 = Sunday
  const ahead = (8 - dow) % 7 || 7;
  return addDays(d, ahead);
}

/** Events whose main draw runs twelve days or more. */
export function isTwoWeekEvent(category: Category, name: string): boolean {
  if (category === "grand_slam" || category === "wta_grand_slam") return true;
  // 96-draw 1000s. Monte Carlo and Paris are 56-draw single-week Masters; the
  // WTA's non-combined 1000s (Doha, Dubai, Wuhan) are single-week too.
  if (category === "masters_1000") return !/monte|paris|bercy/i.test(name);
  if (category === "wta_1000") return true;
  return false;
}

/** Main-draw length in days, first match to final. */
export function eventLengthDays(category: Category, name: string): number {
  if (category === "grand_slam" || category === "wta_grand_slam") return 14;
  return isTwoWeekEvent(category, name) ? 11 : 6;
}

export interface CurrentEvent {
  name: string;
  category: Category;
  /** First main-draw match stored, if any has been played or scheduled. */
  firstMainDraw: string | null;
  /** First match of any kind (qualifying included). */
  firstAny: string;
}

/**
 * The Monday whose publish the live ranking is projecting to.
 * `weekStart` is the Monday of the current ranking week.
 */
export function dropHorizon(weekStart: string, events: CurrentEvent[]): string {
  let horizon = addDays(weekStart, 7);
  for (const e of events) {
    if (!isTwoWeekEvent(e.category, e.name)) continue;
    const slam = e.category === "grand_slam" || e.category === "wta_grand_slam";
    // Before the main draw starts only qualifying is on record: a Slam's
    // qualifying week precedes it by 7 days, a 1000's by about 2.
    const start = e.firstMainDraw ?? addDays(e.firstAny, slam ? 7 : 2);
    const end = addDays(start, eventLengthDays(e.category, e.name));
    const h = mondayAfter(end);
    if (h > horizon) horizon = h;
  }
  return horizon;
}

/**
 * The Monday a result stops counting: 52 weeks after the Monday it entered
 * the ranking (the Monday after the edition ended).
 */
export function expiryOf(editionEnd: string): string {
  return addDays(mondayAfter(editionEnd), 364);
}

/**
 * Best estimate of when an edition ended. Tennis Abstract stamps every match
 * with the tournament START date, so an edition known only from TA rows has
 * lo == hi and its end has to be derived from its length.
 */
export function editionEnd(lo: string, hi: string, category: Category, name: string): string {
  if (hi > lo) return hi;
  return addDays(lo, eventLengthDays(category, name));
}

/** Does a result expiring on `expiry` leave the ranking inside (weekStart, horizon]? */
export function dropsWithin(expiry: string, weekStart: string, horizon: string): boolean {
  return expiry > weekStart && expiry <= horizon;
}

/**
 * Should one past edition's result be charged as dropping?
 *
 * An expired result normally left the official ranking on its expiry Monday.
 * The exception is when the edition replacing it was already under way on
 * that Monday: the old result is then kept until the new one is counted.
 * Both observed in October 2026 (WTA):
 *
 *   Beijing 2025 expired Mon 5 Oct, mid-way through Beijing 2026 (main draw
 *   from 30 Sep). The official ranking of 5 Oct still held it; it left on
 *   12 Oct. Skipping it as expired left Anisimova +1000 all week.
 *
 *   Wuhan 2025 expired Mon 12 Oct, the day Wuhan 2026's main draw began. The
 *   official ranking of 12 Oct had already dropped it (Gauff 5974); charging
 *   it again because Wuhan is "being replayed" gave Gauff -1000.
 */
export function chargesResult(r: {
  expiry: string;
  weekStart: string;
  horizon: string;
  /** This event's next edition is being played now. */
  replacedNow: boolean;
  /** First main-draw date of that current edition; null if only qualifying is on record. */
  currentMainDrawStart: string | null;
  /** Start of this event's following edition, if one is on record. */
  nextLo: string | null;
  /** ATP: count only what leaves after next Monday (see derive-dropping-points). */
  beyondNextMonday: boolean;
}): boolean {
  if (r.beyondNextMonday && r.expiry <= addDays(r.weekStart, 7)) return false;
  if (r.replacedNow) {
    if (r.expiry > r.weekStart) return true;
    return r.currentMainDrawStart != null && r.currentMainDrawStart < r.expiry;
  }
  // The next edition was already held before this week: the official ranking
  // dropped this result then, so it is not ours to charge again.
  if (r.nextLo != null && r.nextLo < r.weekStart) return false;
  return dropsWithin(r.expiry, r.weekStart, r.horizon);
}
