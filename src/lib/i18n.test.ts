import { describe, it, expect } from "vitest";
import { t, DEFAULT_LOCALE } from "./i18n";

describe("t (translation lookup)", () => {
  it("returns the English string by default", () => {
    expect(t("common.search.placeholder")).toMatch(/Search/);
  });

  it("falls back to the key when locale lacks a translation", () => {
    // @ts-expect-error — intentionally passing an unknown key
    expect(t("nonexistent.key")).toBe("nonexistent.key");
  });

  it("uses the default English dictionary when DEFAULT_LOCALE is queried", () => {
    expect(t("consent.accept", DEFAULT_LOCALE)).toBe("Accept");
  });
});
