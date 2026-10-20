import { describe, expect, it } from "vitest";
import { buildTePlayerIndex, resolveTePlayer } from "../te-player-resolver";

// A small slice of the real players table, including the collisions that
// produced cross-tour and wrong-sibling rows in player_recent_matches.
const ATP = [
  { id: 1, fullName: "Zachary Svajda" },
  { id: 2, fullName: "Trevor Svajda" },
  { id: 3, fullName: "Zhizhen Zhang" },
  { id: 4, fullName: "Daniel Merida Aguilar" },
  { id: 5, fullName: "Alejandro Davidovich Fokina" },
  { id: 6, fullName: "Jesper de Jong" },
  { id: 7, fullName: "Mackenzie Mcdonald" },
  { id: 8, fullName: "Juan Manuel Cerundolo" },
  { id: 9, fullName: "Francisco Cerundolo" },
  { id: 10, fullName: "Daniil Medvedev" },
];

const WTA = [
  { id: 101, fullName: "Shuai Zhang" },
  { id: 102, fullName: "Xinyu Wang" },
  { id: 103, fullName: "Xiyu Wang" },
];

describe("resolveTePlayer", () => {
  const atp = buildTePlayerIndex(ATP);
  const wta = buildTePlayerIndex(WTA);

  it("resolves a plain surname + initial", () => {
    expect(resolveTePlayer(atp, "medvedev-e0d2d", "Medvedev D.")).toBe(10);
  });

  it("uses the initial to separate siblings instead of taking the first hit", () => {
    // The old resolver returned candidates[0] for any surname collision, so
    // Trevor Svajda's matches were written to Zachary (or vice versa).
    expect(resolveTePlayer(atp, "svajda-cce6f", "Svajda T.")).toBe(2);
    expect(resolveTePlayer(atp, "svajda", "Svajda Z.")).toBe(1);
    expect(resolveTePlayer(atp, null, "Cerundolo J. M.")).toBe(8);
    expect(resolveTePlayer(atp, "cerundolo", "Cerundolo F.")).toBe(9);
  });

  it("stays inside the tour it was given", () => {
    // WTA "Zhang S." must never land on the ATP's Zhizhen Zhang — only the
    // WTA index is consulted for a WTA listing.
    expect(resolveTePlayer(wta, "zhang-2f389", "Zhang S.")).toBe(101);
    expect(resolveTePlayer(atp, "zhang-2f389", "Zhang S.")).toBeNull();
  });

  it("refuses to guess when the initial is shared", () => {
    expect(resolveTePlayer(wta, "wang", "Wang X.")).toBeNull();
  });

  it("returns null for a player we do not hold, even when the surname is known", () => {
    expect(resolveTePlayer(atp, "zhang-aa111", "Zhang Y.")).toBeNull();
  });

  it("handles multi-word surnames and a surname that is not the last token", () => {
    expect(resolveTePlayer(atp, "davidovich-fokina", "Davidovich Fokina A.")).toBe(5);
    expect(resolveTePlayer(atp, "de-jong-57322", "De Jong J.")).toBe(6);
    // "Daniel Merida Aguilar": TE writes just "Merida D.", and the old
    // last-1..3-segment suffix index never indexed "merida" on its own.
    expect(resolveTePlayer(atp, "merida", "Merida D.")).toBe(4);
  });

  it("uses TennisExplorer's player id to reject a same-initial sibling we do not hold", () => {
    // Bryce Nakashima (~#700) is not in our table; Brandon (#17) is. TE lists
    // both as "Nakashima B.", so only the TE id tells them apart.
    const idx = buildTePlayerIndex([
      { id: 33, fullName: "Brandon Nakashima", teSlug: "nakashima-5c1d9" },
    ]);
    expect(resolveTePlayer(idx, "nakashima-5c1d9", "Nakashima B.")).toBe(33);
    expect(resolveTePlayer(idx, "nakashima-8e7f2", "Nakashima B.")).toBeNull();
  });

  it("trusts a known TE id even when the listing name is unusual", () => {
    const idx = buildTePlayerIndex([{ id: 5, fullName: "Alejandro Davidovich Fokina", teSlug: "davidovich-fokina" }]);
    expect(resolveTePlayer(idx, "davidovich-fokina", "Davidovich-Fokina A.")).toBe(5);
  });

  it("matches case- and accent-insensitively", () => {
    expect(resolveTePlayer(atp, "mcdonald-4d935", "McDonald M.")).toBe(7);
  });
});
