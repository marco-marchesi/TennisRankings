import { describe, it, expect } from "vitest";
import { renderToString } from "react-dom/server";
import { FormWidget } from "./form-widget";

describe("<FormWidget />", () => {
  it("renders one li per match", () => {
    const html = renderToString(
      <FormWidget
        matches={[
          { result: "W", surface: "hard" },
          { result: "L", surface: "clay" },
          { result: "W", surface: "grass" },
        ]}
      />,
    );
    const liCount = (html.match(/<li/g) ?? []).length;
    expect(liCount).toBe(3);
  });

  it("uses a surface glyph when surface is provided", () => {
    const html = renderToString(
      <FormWidget matches={[{ result: "W", surface: "hard" }]} />,
    );
    expect(html).toContain("■"); // hard glyph
  });

  it("falls back to a +/− glyph when no surface is provided", () => {
    const html = renderToString(
      <FormWidget matches={[{ result: "W" }, { result: "L" }]} />,
    );
    expect(html).toContain("+");
    expect(html).toContain("−");
  });

  it("emits an accessible aria-label for the list", () => {
    const html = renderToString(
      <FormWidget matches={[{ result: "W" }]} />,
    );
    expect(html).toMatch(/aria-label="[^"]*Recent form/);
  });

  it("emits a screen-reader description on every match", () => {
    const html = renderToString(
      <FormWidget
        matches={[{ result: "W", surface: "clay", opponent: "Sinner" }]}
      />,
    );
    expect(html).toMatch(/Win against Sinner on clay/);
  });
});
