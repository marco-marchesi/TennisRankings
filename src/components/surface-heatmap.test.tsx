import { describe, it, expect } from "vitest";
import { renderToString } from "react-dom/server";
import { SurfaceHeatmap } from "./surface-heatmap";

describe("<SurfaceHeatmap />", () => {
  it("renders one cell per surface entry", () => {
    const html = renderToString(
      <SurfaceHeatmap
        playerName="Test"
        cells={[
          { surface: "hard", wins: 30, losses: 10 },
          { surface: "clay", wins: 20, losses: 15 },
          { surface: "grass", wins: 5, losses: 5 },
        ]}
      />,
    );
    const li = (html.match(/<li[^>]/g) ?? []).length;
    expect(li).toBe(3);
  });

  it("computes win percentages correctly", () => {
    const html = renderToString(
      <SurfaceHeatmap
        playerName="Test"
        cells={[{ surface: "hard", wins: 3, losses: 1 }]}
      />,
    );
    expect(html).toMatch(/75%/);
  });

  it("emits accessible aria-labels including W/L counts", () => {
    const html = renderToString(
      <SurfaceHeatmap
        playerName="Test"
        cells={[{ surface: "clay", wins: 12, losses: 4 }]}
      />,
    );
    expect(html).toMatch(/aria-label="clay: 12 wins, 4 losses, 75% win rate"/);
  });

  it("handles a 0–0 row without dividing by zero", () => {
    const html = renderToString(
      <SurfaceHeatmap
        playerName="Test"
        cells={[{ surface: "grass", wins: 0, losses: 0 }]}
      />,
    );
    expect(html).toMatch(/0%/);
  });
});
