import { describe, it, expect } from "vitest";
import { renderToString } from "react-dom/server";
import { ProjectionTable } from "./projection-table";
import type { ProjectionRow } from "@/lib/projection";

const rows: ProjectionRow[] = [
  {
    rank: 1,
    projectedRank: 1,
    player: { slug: "a", fullName: "Player A", countryCode: "ITA" },
    currentPoints: 11000,
    pointsExpiringIn4Weeks: 2000,
    pointsExpiringIn12Weeks: 0,
    projectedPoints: 9000,
  },
  {
    rank: 4,
    projectedRank: 2,
    player: { slug: "d", fullName: "Player D", countryCode: "USA" },
    currentPoints: 6500,
    pointsExpiringIn4Weeks: 0,
    pointsExpiringIn12Weeks: 0,
    projectedPoints: 6500,
  },
];

describe("<ProjectionTable />", () => {
  it("renders one body row per projection entry", () => {
    const html = renderToString(<ProjectionTable rows={rows} />);
    const bodyRows = (html.match(/<tr[^>]*class="border-t/g) ?? []).length;
    expect(bodyRows).toBe(2);
  });

  it("renders an empty-state hint when no rows are passed", () => {
    const html = renderToString(<ProjectionTable rows={[]} />);
    expect(html).toMatch(/Projection backfills/);
  });

  it("highlights upward movers with a triangle", () => {
    const html = renderToString(<ProjectionTable rows={rows} />);
    expect(html).toContain("▲");
  });

  it("shows expiring points with a leading minus", () => {
    const html = renderToString(<ProjectionTable rows={rows} />);
    expect(html).toMatch(/−2[,.\s]000/);
  });
});
