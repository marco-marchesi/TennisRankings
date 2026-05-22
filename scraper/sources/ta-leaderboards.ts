// Fetcher + parser for Tennis Abstract's "Last 52 weeks" leaderboard reports.
// Eight HTML pages — four categories × two tours — each a single table of
// player rows with a long roster of MCP (Match Charting Project) columns.
//
// We don't store every column. Instead we pick a curated 4-5 stats per
// category, chosen for readability and shared mental model with how
// commentators talk about the game.

import * as cheerio from "cheerio";

export type Tour = "atp" | "wta";
export type Category = "serve" | "return" | "rally" | "winners_errors";

interface SourceUrls {
  [c: string]: string;
}

const URLS: Record<Tour, SourceUrls> = {
  atp: {
    serve: "https://tennisabstract.com/reports/mcp_leaders_serve_men_last52.html",
    return: "https://tennisabstract.com/reports/mcp_leaders_return_men_last52.html",
    rally: "https://tennisabstract.com/reports/mcp_leaders_rally_men_last52.html",
    winners_errors: "https://tennisabstract.com/reports/winners_errors_leaders_men_last52.html",
  },
  wta: {
    serve: "https://tennisabstract.com/reports/mcp_leaders_serve_women_last52.html",
    return: "https://tennisabstract.com/reports/mcp_leaders_return_women_last52.html",
    rally: "https://tennisabstract.com/reports/mcp_leaders_rally_women_last52.html",
    winners_errors: "https://tennisabstract.com/reports/winners_errors_leaders_women_last52.html",
  },
};

// Column-by-index map for each category. Indices verified May 2026 against
// the LIVE structure of TA's clean tbody-replicated table (see `parseLeaderboard`
// for which table we read). If TA reshapes a report, update these — easy
// way to verify is `scraper/__debug-leaderboard.ts`.
const COLUMN_MAP: Record<Category, Record<string, number>> = {
  // [0] Player [1] Matches [2] Unret% [3] <=3W% [4] RiP W% [5] SvImpact
  // [6] 1st: Unret% [7] 1st: <=3W% [8] 1st: RiP W% [9] 1st: SvImpact
  // [10] 1st: D Wide% [11] 1st: A Wide% [12] 1st: BP Wide%
  // [13] 2nd: Unret% [14] 2nd: <=3W% [15] 2nd: RiP W%
  // [16] 2nd: D Wide% [17] 2nd: A Wide% [18] 2nd: BP Wide% [19] 2ndAgg
  serve: {
    matches: 1,
    unreturnable_pct: 2,
    first_serve_won_pct: 8,   // 1st: RiP W%
    second_serve_won_pct: 15, // 2nd: RiP W%
    serve_impact: 5,          // overall SvImpact
  },
  // [0] Player [1] Matches [2] RiP% [3] RiP W% [4] RetWnr% [5] Wnr-FH%
  // [6] RDI [7] Slice% [8] 1st: RiP% [9] 1st: RiP W%
  // [10] 1st: RetWnr% [11] 1st: RDI [12] 1st: Slice%
  // [13] 2nd: RiP% [14] 2nd: RiP W% [15] 2nd: RetWnr% [16] 2nd: RDI [17] 2nd: Slice%
  return: {
    matches: 1,
    return_in_play_pct: 2,
    first_return_won_pct: 9,
    second_return_won_pct: 14,
    return_winners_pct: 4,
  },
  // [0] Player [1] Matches [2] RallyLen [3] RLen-Serve [4] RLen-Return
  // [5] 1-3 W% [6] 4-6 W% [7] 7-9 W% [8] 10+ W%
  // [9] FH/GS [10] BH Slice% [11] FHP/Match [12] FHP/100 [13] BHP/Match [14] BHP/100
  rally: {
    matches: 1,
    avg_rally_length: 2,
    short_rally_won_pct: 5,
    mid_rally_won_pct: 6,
    long_rally_won_pct: 7,
  },
  // [0] Player [1] Matches [2] Winners [3] UFEs [4] Ratio [5] Wnr/Pt [6] UFE/Pt
  // [7] RallyWinners [8] RallyUFEs [9] RallyRatio ...
  winners_errors: {
    matches: 1,
    winners_total: 2,
    ufes_total: 3,
    winner_ufe_ratio: 4,
  },
};

export interface LeaderboardRow {
  tour: Tour;
  category: Category;
  rank: number;
  playerName: string;
  taPlayerId: string | null;
  countryCode: string | null;
  matches: number | null;
  stats: Record<string, number | null>;
}

export async function fetchLeaderboard(tour: Tour, category: Category): Promise<LeaderboardRow[]> {
  const url = URLS[tour]?.[category];
  if (!url) throw new Error(`unknown tour/category: ${tour}/${category}`);
  const res = await fetch(url, {
    headers: {
      "User-Agent": "TennisRankingsBot/0.1 (https://tennisrankings.example; contact: dev@tennisrankings.example)",
    },
  });
  if (!res.ok) throw new Error(`${url} → ${res.status} ${res.statusText}`);
  const html = await res.text();
  return parseLeaderboard(html, tour, category);
}

export function parseLeaderboard(html: string, tour: Tour, category: Category): LeaderboardRow[] {
  const $ = cheerio.load(html);

  // TA's reports render the same dataset in two `<table>`s — the first has a
  // malformed structure where all `<td>` cells collapse into a single row,
  // the second is a clean one-row-per-player table. We pick the table whose
  // rows include the most player-profile links (`<a href="...?p=...">`),
  // which reliably identifies the cleanly-structured copy.
  //
  // We track the *index* of the best table rather than the element itself —
  // cheerio's element type is awkward to spell across versions (no public
  // `cheerio.AnyNode` export), and `$("table").eq(idx)` gives us a Cheerio
  // wrapper with full chainable typing.
  let bestIdx = -1;
  let bestCount = 0;
  $("table").each((idx, t) => {
    const linkRows = $(t).find("tr").filter((__, tr) => $(tr).find("a[href*='?p=']").length > 0);
    if (linkRows.length > bestCount) {
      bestCount = linkRows.length;
      bestIdx = idx;
    }
  });
  if (bestIdx < 0 || bestCount === 0) return [];

  const bestTable = $("table").eq(bestIdx);
  const colMap = COLUMN_MAP[category];
  const result: LeaderboardRow[] = [];

  bestTable.find("tr").each((_idx, tr) => {
    // Only real data rows — they have a player-profile link as their first
    // cell. Anything else (header, separator, summary) is filtered out.
    const link = $(tr).find("a[href*='?p=']").first();
    if (link.length === 0) return;

    const cells = $(tr).find("td").toArray();
    // A clean per-player row has roughly 15–25 cells. TA's report HTML is
    // malformed in a way that causes cheerio to collapse all per-player tds
    // into ONE giant first row (1000+ cells). Skip those — the real per-row
    // copies are picked up in subsequent iterations.
    if (cells.length === 0 || cells.length > 30) return;

    const playerCell = $(cells[0]);
    const playerName = (link.text() || playerCell.text()).trim();
    if (!playerName) return;
    const href = link.attr("href") ?? "";
    // TA URL forms include "?p=AlexDeMinaur" and "?p=200221/Alex-De-Minaur"
    // (newer style with the numeric id). Take whatever's there as-is.
    const taPlayerId = href.match(/[?&]p=([^&]+)/)?.[1] ?? null;

    const flagAlt = playerCell.find("img").first().attr("alt") ?? null;
    const countryCode = flagAlt && /^[A-Z]{3}$/.test(flagAlt) ? flagAlt : null;

    const stats: Record<string, number | null> = {};
    for (const [key, idx] of Object.entries(colMap)) {
      const cell = cells[idx];
      stats[key] = cell ? parseNumericCell($(cell).text()) : null;
    }
    const matches = stats.matches as number | null;
    delete stats.matches;

    result.push({
      tour,
      category,
      rank: 0, // assigned after re-sort below
      playerName,
      taPlayerId,
      countryCode,
      matches,
      stats,
    });
  });

  // TA's reports default-sort by a key that's not specific to the displayed
  // category (e.g. the Rally page lists players in serve-impact order, not
  // rally-aggregate order). Re-rank here by a sensible per-category headline
  // metric so each tab shows a meaningful leader.
  result.sort((a, b) => categorySortScore(category, b) - categorySortScore(category, a));
  for (let i = 0; i < result.length; i++) {
    result[i]!.rank = i + 1;
  }
  return result;
}

/**
 * Per-category aggregate "score" used to rank a row. Picked to be the metric
 * most readers would expect when they open that tab — never just the first
 * column, since TA's column ordering isn't tied to relevance.
 */
function categorySortScore(category: Category, row: LeaderboardRow): number {
  const s = row.stats;
  const num = (v: number | null | undefined) => (typeof v === "number" ? v : 0);
  if (category === "serve") {
    // serve_impact already aggregates 1st+2nd serve effectiveness.
    return num(s.serve_impact);
  }
  if (category === "return") {
    // Return Depth Index isn't in our captured fields, so we proxy with the
    // composite of 1st + 2nd serve return-won %, weighted equally.
    return num(s.first_return_won_pct) + num(s.second_return_won_pct);
  }
  if (category === "rally") {
    // Average of short/mid/long win % gives a meaningful "rally winner".
    return (
      num(s.short_rally_won_pct) +
      num(s.mid_rally_won_pct) +
      num(s.long_rally_won_pct)
    );
  }
  // winners_errors: ratio is the canonical headline metric.
  return num(s.winner_ufe_ratio);
}

/**
 * Parses a TA cell into a number. Handles percentage suffix ("63.4%"), commas,
 * and the common "-" / blank placeholders. Returns null when not numeric.
 */
function parseNumericCell(text: string): number | null {
  const trimmed = text.replace(/ /g, " ").trim();
  if (!trimmed || trimmed === "-" || trimmed === "—") return null;
  const stripped = trimmed.replace(/[,%\s]/g, "");
  const n = Number(stripped);
  return Number.isFinite(n) ? n : null;
}
