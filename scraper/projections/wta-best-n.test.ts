import { describe, expect, it } from "vitest";
import type { WtaEvent } from "../sources/wta-player-events";
import { wtaBreakdown, wtaLiveDelta } from "./wta-best-n";

let n = 0;
const ev = (name: string, level: string, points: number, end = "2026-06-14", nbr = String(++n)): WtaEvent => ({
  key: `${nbr}-${end.slice(0, 4)}`,
  nbr,
  year: Number(end.slice(0, 4)),
  name,
  level,
  prize: null,
  start: end,
  end,
  points,
});
const ctx = { weekStart: "2026-10-26", horizon: "2026-11-02", current: new Map<string, string | null>() };

describe("wtaLiveDelta", () => {
  it("does not let a 500 result displace a mandatory one (Rybakina, Tokyo QF 108: +0)", () => {
    const events = [
      ev("US OPEN", "GS", 2000), ev("AUSTRALIAN OPEN", "GS", 2000), ev("WIMBLEDON", "GS", 130), ev("ROLAND GARROS", "GS", 70),
      ev("TORONTO", "PM", 650), ev("INDIAN WELLS", "PM", 650), ev("MIAMI", "PM", 390), ev("ROME", "PM", 215),
      ev("CINCINNATI", "PM", 215), ev("MADRID 1000", "PM", 120), ev("BEIJING", "PM", 10),
      ev("DOHA", "PM", 215), ev("DUBAI", "PM", 120), ev("WTA FINALS", "CH", 1500, "2025-11-08"),
      ev("NINGBO", "P", 500), ev("STUTTGART", "P", 500), ev("QUEENS", "P", 108), ev("BRISBANE", "P", 108), ev("BERLIN", "P", 1),
    ];
    const official = 9501;
    const bd = wtaBreakdown(events, ctx);
    expect(wtaLiveDelta(bd, [{ points: 108, mandatory: false }], official)).toBe(0);
  });

  it("replaces the 18th result when nothing is mandatory to protect it", () => {
    const events = Array.from({ length: 19 }, (_, i) => ev(`EVENT ${i}`, "IS", 100 - i));
    const official = events.slice(0, 18).reduce((a, e) => a + e.points, 0);
    // 18th best is 83; a new 90 replaces it.
    expect(wtaLiveDelta(wtaBreakdown(events, ctx), [{ points: 90, mandatory: false }], official)).toBe(7);
  });

  it("charges only what leaves the counted set", () => {
    // A result from the week of 2025-10-27 expires at the projected publish.
    const events = [ev("HONG KONG", "IS", 54, "2025-11-02"), ev("SEOUL", "IS", 250)];
    const bd = wtaBreakdown(events, ctx);
    expect(bd.dropped.map((e) => e.name)).toEqual(["HONG KONG"]);
    expect(wtaLiveDelta(bd, [], 304)).toBe(-54);
  });

  it("never treats an ITF series as replaced by this week's edition", () => {
    const events = [ev("MONASTIR 4", "ITF", 50, "2026-03-01")];
    const bd = wtaBreakdown(events, { ...ctx, current: new Map([["1", "2026-10-26"]]) });
    expect(bd.dropped).toEqual([]);
  });
});
