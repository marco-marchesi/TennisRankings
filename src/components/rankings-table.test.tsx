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

  it("hides the projection columns when no rows have a projection", () => {
    const rows = mockTopRanked("atp", 3); // mock data has projection: null
    const html = renderToString(<RankingsTable rows={rows} />);
    expect(html).not.toContain(">+/-<");
    expect(html).not.toContain(">Next<");
    expect(html).not.toContain(">Max<");
  });

  it("renders inline column filters for Age and Ctry", () => {
    const rows = mockTopRanked("atp", 5);
    const html = renderToString(<RankingsTable rows={rows} />);
    expect(html).toContain('aria-label="Filter by age"');
    expect(html).toContain('aria-label="Filter by country code"');
  });

  it("marks sortable headers with aria-sort=none initially except the active default", () => {
    const rows = mockTopRanked("atp", 5);
    const html = renderToString(<RankingsTable rows={rows} />);
    // rank is the default sort, so its header has aria-sort=ascending
    expect(html).toMatch(/aria-sort="ascending"/);
    // CH, Age, Ctry, +/- start as none
    expect(html).toMatch(/aria-sort="none"/);
  });
});
