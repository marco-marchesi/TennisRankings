import { describe, it, expect } from "vitest";
import { mockTopRanked, mostRecentMonday } from "./mock-data";

describe("mostRecentMonday", () => {
  it("returns the same date when given a Monday", () => {
    const monday = new Date("2026-05-18T12:00:00Z"); // Monday
    expect(mostRecentMonday(monday)).toBe("2026-05-18");
  });

  it("walks back to the previous Monday for a Sunday", () => {
    const sunday = new Date("2026-05-17T12:00:00Z"); // Sunday
    expect(mostRecentMonday(sunday)).toBe("2026-05-11");
  });

  it("walks back to the previous Monday for a Saturday", () => {
    const saturday = new Date("2026-05-16T12:00:00Z"); // Saturday
    expect(mostRecentMonday(saturday)).toBe("2026-05-11");
  });

  it("walks back to the previous Monday for a Tuesday", () => {
    const tuesday = new Date("2026-05-19T12:00:00Z");
    expect(mostRecentMonday(tuesday)).toBe("2026-05-18");
  });

  it("returns ISO date format YYYY-MM-DD", () => {
    expect(mostRecentMonday(new Date("2026-05-20"))).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

describe("mockTopRanked", () => {
  it("returns ATP rows for tour=atp", () => {
    const rows = mockTopRanked("atp", 5);
    expect(rows).toHaveLength(5);
    expect(rows[0].player.fullName).toBe("Jannik Sinner");
  });

  it("returns WTA rows for tour=wta", () => {
    const rows = mockTopRanked("wta", 5);
    expect(rows).toHaveLength(5);
    expect(rows[0].player.fullName).toMatch(/Świątek/);
  });

  it("assigns ranks 1..N in order", () => {
    const rows = mockTopRanked("atp", 10);
    expect(rows.map((r) => r.rank)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  });

  it("respects the limit", () => {
    expect(mockTopRanked("atp", 3)).toHaveLength(3);
    expect(mockTopRanked("wta", 1)).toHaveLength(1);
  });

  it("stamps the most recent Monday as weekOf on every row", () => {
    const rows = mockTopRanked("atp", 5);
    const monday = mostRecentMonday();
    for (const r of rows) expect(r.weekOf).toBe(monday);
  });
});
