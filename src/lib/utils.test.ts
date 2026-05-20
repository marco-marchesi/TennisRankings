import { describe, it, expect } from "vitest";
import { rankDelta, slugify, formatNumber } from "./utils";

describe("rankDelta", () => {
  it("returns 'up' when current rank is better (smaller) than previous", () => {
    expect(rankDelta(10, 7)).toEqual({ dir: "up", delta: 3 });
  });
  it("returns 'down' when current rank is worse than previous", () => {
    expect(rankDelta(5, 8)).toEqual({ dir: "down", delta: 3 });
  });
  it("returns 'hold' when ranks match", () => {
    expect(rankDelta(4, 4)).toEqual({ dir: "hold", delta: 0 });
  });
  it("returns 'hold' when previous rank is null", () => {
    expect(rankDelta(null, 5)).toEqual({ dir: "hold", delta: 0 });
  });
});

describe("slugify", () => {
  it("lowercases, strips accents, joins with hyphens", () => {
    expect(slugify("Jannik Sinner")).toBe("jannik-sinner");
    expect(slugify("Iga Świątek")).toBe("iga-swiatek");
  });
});

describe("formatNumber", () => {
  it("formats numbers with the default en-GB locale", () => {
    expect(formatNumber(11830)).toMatch(/11.830|11,830/);
  });
});
