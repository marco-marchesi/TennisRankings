import { describe, expect, it } from "vitest";
import {
  chargesResult,
  dropHorizon,
  dropsWithin,
  editionEnd,
  expiryOf,
  mondayAfter,
} from "../projections/drop-horizon";

describe("mondayAfter", () => {
  it("is the next Monday, never the same day", () => {
    expect(mondayAfter("2025-10-12")).toBe("2025-10-13"); // Sunday
    expect(mondayAfter("2025-10-11")).toBe("2025-10-13"); // Saturday
    expect(mondayAfter("2026-09-28")).toBe("2026-10-05"); // Monday
  });
});

describe("dropHorizon", () => {
  const week = "2026-09-28";

  it("is next Monday when only single-week events are on", () => {
    expect(
      dropHorizon(week, [
        { name: "Seoul", category: "wta_250", firstMainDraw: "2026-09-28", firstAny: "2026-09-26" },
      ]),
    ).toBe("2026-10-05");
  });

  it("reaches past a two-week 1000 still in qualifying (Beijing 2026)", () => {
    expect(
      dropHorizon(week, [
        { name: "Beijing", category: "wta_1000", firstMainDraw: null, firstAny: "2026-09-28" },
      ]),
    ).toBe("2026-10-12");
  });

  it("is next Monday in the second week of a two-week event", () => {
    expect(
      dropHorizon("2026-10-05", [
        { name: "Beijing", category: "wta_1000", firstMainDraw: "2026-09-30", firstAny: "2026-09-28" },
      ]),
    ).toBe("2026-10-12");
  });

  it("treats 56-draw Masters as single-week", () => {
    expect(
      dropHorizon("2026-04-06", [
        { name: "Monte Carlo", category: "masters_1000", firstMainDraw: "2026-04-05", firstAny: "2026-04-04" },
      ]),
    ).toBe("2026-04-13");
  });
});

describe("expiry", () => {
  it("expires Wuhan 2025 and Beijing 2025 by Beijing 2026's publish", () => {
    const week = "2026-09-28";
    const horizon = "2026-10-12";
    // Wuhan 2025 final: Sun 12 Oct 2025 -> in the ranking from 13 Oct 2025.
    expect(expiryOf("2025-10-12")).toBe("2026-10-12");
    expect(dropsWithin(expiryOf("2025-10-12"), week, horizon)).toBe(true);
    // Beijing 2025 final: Sun 5 Oct 2025.
    expect(dropsWithin(expiryOf("2025-10-05"), week, horizon)).toBe(true);
    // Tokyo 2025 (final 26 Oct) still counts on 12 Oct 2026.
    expect(dropsWithin(expiryOf("2025-10-26"), week, horizon)).toBe(false);
    // Already gone from the official ranking of this week.
    expect(dropsWithin(expiryOf("2025-09-21"), week, horizon)).toBe(false);
  });

  it("keeps an expired result while the edition replacing it straddles the expiry", () => {
    // Week 2 of Beijing 2026 (main draw from 30 Sep). Beijing 2025's 52 weeks
    // ran out on 5 Oct, yet the official WTA ranking of 5 Oct still held it:
    // Anisimova's 2025 title (1000) only left on 12 Oct, when Beijing 2026
    // replaced it. Skipping on expiry left every Beijing 2025 result
    // uncharged all week: Anisimova +1000, Noskova +649, Pegula/Gauff +390.
    const beijing = { weekStart: "2026-10-05", horizon: "2026-10-12", beyondNextMonday: false };
    expect(
      chargesResult({
        ...beijing, expiry: "2026-10-05", replacedNow: true, currentMainDrawStart: "2026-09-30",
        nextLo: "2026-09-28",
      }),
    ).toBe(true);

    // Wuhan 2026, whose main draw STARTS on 12 Oct - the very Monday Wuhan
    // 2025 expired. The official ranking of 12 Oct had already dropped it
    // (Gauff 5974 without her 2025 title); charging it again gave -1000.
    const wuhan = { weekStart: "2026-10-12", horizon: "2026-10-19", beyondNextMonday: false };
    expect(
      chargesResult({
        ...wuhan, expiry: "2026-10-12", replacedNow: true, currentMainDrawStart: "2026-10-12",
        nextLo: "2026-10-10",
      }),
    ).toBe(false);
    // Same while only qualifying is on record.
    expect(
      chargesResult({
        ...wuhan, expiry: "2026-10-12", replacedNow: true, currentMainDrawStart: null,
        nextLo: "2026-10-10",
      }),
    ).toBe(false);
    // Same name, expired weeks before this edition began: a different edition
    // of a repeated event (weekly ITFs in one city), long out of the ranking.
    expect(
      chargesResult({
        ...wuhan, expiry: "2026-09-14", replacedNow: true, currentMainDrawStart: "2026-10-12",
        nextLo: "2026-10-10",
      }),
    ).toBe(false);
  });

  it("charges what expires by the projected publish, and nothing already gone", () => {
    const base = {
      weekStart: "2026-10-05", horizon: "2026-10-12", beyondNextMonday: false,
      currentMainDrawStart: null,
    };
    // Not being replayed and past expiry: already out of the official ranking.
    expect(chargesResult({ ...base, expiry: "2026-10-05", replacedNow: false, nextLo: null })).toBe(false);
    // Next edition already held before this week: dropped then.
    expect(
      chargesResult({ ...base, expiry: "2026-10-12", replacedNow: false, nextLo: "2026-09-14" }),
    ).toBe(false);
    // Expires at next Monday's publish: charged.
    expect(chargesResult({ ...base, expiry: "2026-10-12", replacedNow: false, nextLo: null })).toBe(true);
    // Being replayed now and not yet expired: charged.
    expect(
      chargesResult({
        ...base, expiry: "2026-10-26", replacedNow: true, currentMainDrawStart: "2026-10-07",
        nextLo: "2026-10-05",
      }),
    ).toBe(true);
    // ATP: the published Dropping column covers next Monday already.
    expect(
      chargesResult({
        ...base, beyondNextMonday: true, expiry: "2026-10-05", replacedNow: true,
        currentMainDrawStart: "2026-09-30", nextLo: "2026-09-28",
      }),
    ).toBe(false);
  });

  it("derives the end of a TA-only edition from its start date", () => {
    // Tennis Abstract dates every match with the tournament start.
    expect(editionEnd("2025-10-06", "2025-10-06", "wta_1000_nc", "Wuhan")).toBe("2025-10-12");
    expect(editionEnd("2025-09-24", "2025-10-05", "wta_1000", "Beijing")).toBe("2025-10-05");
  });
});
