import { describe, expect, it } from "vitest";
import { securedAtEvent, type EventMatch } from "./event-points";

const m = (round: string, won: boolean): EventMatch => ({ round, won, playedOn: "2026-10-27" });

// Every expectation is a live-tennis.eu delta from 2026-10-31 (see the header
// of event-points.ts), minus the player's dropping points.
describe("securedAtEvent", () => {
  it("credits the round lost in, and the next round while still alive", () => {
    expect(securedAtEvent("atp", "atp_500", [m("R32", true), m("R16", true), m("QF", false)]).points).toBe(100);
    expect(securedAtEvent("atp", "atp_500", [m("R32", true), m("R16", true), m("QF", true)])).toEqual({
      points: 200,
      inProgress: true,
    });
  });

  it("treats QF as a main-draw round, not qualifying", () => {
    expect(securedAtEvent("atp", "atp_500", [m("QF", false)]).points).toBe(100);
  });

  it("adds the qualifier's value to the main-draw result (Machac, Vienna)", () => {
    expect(securedAtEvent("atp", "atp_500", [m("Q1", true), m("Q2", true), m("R32", false)]).points).toBe(25);
  });

  it("adds the lost qualifying round to a lucky loser's main-draw result (Altmaier, Basel)", () => {
    expect(
      securedAtEvent("atp", "atp_500", [m("Q1", true), m("Q2", false), m("R32", true), m("R16", false)]).points,
    ).toBe(63);
  });

  it("keeps only the qualifying points for a WTA qualifier who loses her first match (Dart, Osaka)", () => {
    expect(securedAtEvent("wta", "wta_250", [m("Q1", true), m("Q2", true), m("R32", false)]).points).toBe(18);
    // ...but adds them once she has won one (Parks, Tokyo QF: 108 + 25).
    expect(
      securedAtEvent("wta", "wta_500", [m("Q1", true), m("Q2", true), m("R32", true), m("R16", true), m("QF", false)])
        .points,
    ).toBe(133);
  });

  it("prices an ITF event from its tier, on a 32 draw (Liutova, New Braunfels W100 QF)", () => {
    expect(securedAtEvent("wta", "itf", [m("1R", true), m("2R", true), m("QF", false)], "itf_w100").points).toBe(21);
    expect(securedAtEvent("wta", "itf", [m("QF", false)], null).points).toBe(0);
  });
});
