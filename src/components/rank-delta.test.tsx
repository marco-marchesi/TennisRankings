import { describe, it, expect } from "vitest";
import { renderToString } from "react-dom/server";
import { RankDelta } from "./rank-delta";

describe("<RankDelta />", () => {
  it("renders an upward triangle and 'up N places' SR label when rank improves", () => {
    const html = renderToString(<RankDelta prevRank={10} currentRank={7} />);
    expect(html).toContain("▲");
    expect(html).toMatch(/up 3/);
  });

  it("renders a downward triangle and 'down N places' SR label when rank worsens", () => {
    const html = renderToString(<RankDelta prevRank={5} currentRank={9} />);
    expect(html).toContain("▼");
    expect(html).toMatch(/down 4/);
  });

  it("renders the no-change glyph (–) when ranks are equal", () => {
    const html = renderToString(<RankDelta prevRank={4} currentRank={4} />);
    expect(html).toMatch(/(–|aria-label="no change")/);
  });

  it("renders the no-change glyph when prevRank is null (new entry)", () => {
    const html = renderToString(<RankDelta prevRank={null} currentRank={50} />);
    expect(html).toContain("no change");
  });

  it("singularises the SR label for a 1-place move", () => {
    const html = renderToString(<RankDelta prevRank={5} currentRank={4} />);
    expect(html).toMatch(/up 1 place(?!s)/);
  });
});
