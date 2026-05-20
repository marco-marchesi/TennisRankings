import { describe, it, expect } from "vitest";
import { renderToString } from "react-dom/server";
import { RankingsTable } from "./rankings-table";
import { mockTopRanked } from "@/lib/mock-data";

describe("<RankingsTable />", () => {
  it("renders one body row per ranking entry", () => {
    const rows = mockTopRanked("atp", 10);
    const html = renderToString(<RankingsTable rows={rows} />);
    const bodyRows = (html.match(/<tr[^>]*class="border-t/g) ?? []).length;
    expect(bodyRows).toBe(10);
  });

  it("links each player name to /players/<slug>", () => {
    const rows = mockTopRanked("atp", 3);
    const html = renderToString(<RankingsTable rows={rows} />);
    expect(html).toContain('href="/players/jannik-sinner"');
    expect(html).toContain('href="/players/carlos-alcaraz"');
  });

  it("formats point totals with thousand-separators", () => {
    const rows = mockTopRanked("atp", 1);
    const html = renderToString(<RankingsTable rows={rows} />);
    expect(html).toMatch(/11[,.\s]830/);
  });

  it("renders an accessible caption when supplied", () => {
    const rows = mockTopRanked("atp", 5);
    const html = renderToString(
      <RankingsTable rows={rows} caption="ATP top 5" />,
    );
    expect(html).toMatch(/<caption[^>]*>ATP top 5/);
  });

  it("hides the Δ pts column when showPointsDelta=false", () => {
    const rows = mockTopRanked("atp", 3);
    const html = renderToString(
      <RankingsTable rows={rows} showPointsDelta={false} />,
    );
    expect(html).not.toContain("Δ pts");
  });
});
