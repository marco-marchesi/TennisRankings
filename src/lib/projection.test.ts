import { describe, it, expect } from "vitest";
import { computeProjection, type ProjectionInput } from "./projection";

const fixture: ProjectionInput[] = [
  { currentRank: 1, currentPoints: 11000, pointsExpiring: 2000, slug: "a", fullName: "Player A", countryCode: "ITA" },
  { currentRank: 2, currentPoints: 8000,  pointsExpiring: 0,    slug: "b", fullName: "Player B", countryCode: "ESP" },
  { currentRank: 3, currentPoints: 7000,  pointsExpiring: 200,  slug: "c", fullName: "Player C", countryCode: "GER" },
  { currentRank: 4, currentPoints: 6500,  pointsExpiring: 5500, slug: "d", fullName: "Player D", countryCode: "USA" },
];

describe("computeProjection", () => {
  it("subtracts expiring points to compute projected points", () => {
    const rows = computeProjection(fixture, 4);
    const a = rows.find((r) => r.player.slug === "a")!;
    expect(a.projectedPoints).toBe(11000 - 2000);
  });

  it("re-sorts by projected points (D falls below C)", () => {
    const rows = computeProjection(fixture, 4);
    const c = rows.findIndex((r) => r.player.slug === "c");
    const d = rows.findIndex((r) => r.player.slug === "d");
    expect(c).toBeLessThan(d);
  });

  it("ranks the new leader at projectedRank 1", () => {
    const rows = computeProjection(fixture, 4);
    expect(rows[0]!.projectedRank).toBe(1);
  });

  it("preserves the currentRank (Now) column unchanged", () => {
    const rows = computeProjection(fixture, 4);
    const d = rows.find((r) => r.player.slug === "d")!;
    expect(d.rank).toBe(4);
  });

  it("populates pointsExpiringIn4Weeks when window=4 and zeroes the 12w column", () => {
    const rows = computeProjection(fixture, 4);
    const a = rows.find((r) => r.player.slug === "a")!;
    expect(a.pointsExpiringIn4Weeks).toBe(2000);
    expect(a.pointsExpiringIn12Weeks).toBe(0);
  });

  it("populates pointsExpiringIn12Weeks when window=12 and zeroes the 4w column", () => {
    const rows = computeProjection(fixture, 12);
    const a = rows.find((r) => r.player.slug === "a")!;
    expect(a.pointsExpiringIn12Weeks).toBe(2000);
    expect(a.pointsExpiringIn4Weeks).toBe(0);
  });

  it("does not mutate the input array", () => {
    const before = JSON.stringify(fixture);
    computeProjection(fixture, 4);
    expect(JSON.stringify(fixture)).toBe(before);
  });

  it("is stable on an empty input", () => {
    expect(computeProjection([], 4)).toEqual([]);
  });
});
