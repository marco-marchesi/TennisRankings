// Fetcher + parser for TennisExplorer's weekly singles rankings.
//
// Why TE for the top-800 expand: TE's ranking page carries a "Move" column
// (delta from the previous published week) that Tennis Abstract's CSV
// doesn't expose. Capturing this lets us colour the rankings UI with
// per-row movement arrows without re-deriving from a prior snapshot.
//
// URL form:
//   https://www.tennisexplorer.com/ranking/atp-men/?page=N
//   https://www.tennisexplorer.com/ranking/wta-women/?page=N
//
// 50 rows per page. Top 800 = 16 pages per tour.

import * as cheerio from "cheerio";
import { politeFetch } from "../http";

export type Tour = "atp" | "wta";

export interface TERankingRow {
  rank: number;
  /** Player slug as TE exposes it ("sinner-8b8e8"). Useful as a stable id. */
  teSlug: string;
  /** Full display name in TE's "Lastname Firstname" form. */
  displayName: string;
  /** Same name re-ordered to "Firstname Lastname" so it matches our players. */
  fullName: string;
  /** Best-effort 2-letter country code derived from the flag span class. */
  countryCode: string | null;
  points: number;
  /** Net rank change from the previous published week. Null when TE shows "-". */
  rankMove: number | null;
}

const ROWS_PER_PAGE = 50;

const URLS: Record<Tour, string> = {
  atp: "https://www.tennisexplorer.com/ranking/atp-men/",
  wta: "https://www.tennisexplorer.com/ranking/wta-women/",
};

export async function fetchRanking(tour: Tour, topN: number): Promise<TERankingRow[]> {
  const pages = Math.ceil(topN / ROWS_PER_PAGE);
  const all: TERankingRow[] = [];
  for (let p = 1; p <= pages; p++) {
    const url = `${URLS[tour]}?page=${p}`;
    const res = await politeFetch(url);
    const html = await res.text();
    const rows = parseRanking(html);
    if (rows.length === 0) break; // beyond the published list
    all.push(...rows);
    if (all.length >= topN) break;
  }
  return all.slice(0, topN);
}

export function parseRanking(html: string): TERankingRow[] {
  const $ = cheerio.load(html);
  // The page renders multiple `<table class="result">` tables — header
  // filters, ranking, side widgets. We pick the table whose rows contain
  // a `td.rank.first` cell (rank "1.", "2." …).
  const tables = $("table.result").toArray();
  let bestTable: ReturnType<typeof $> | null = null;
  let bestCount = 0;
  for (const t of tables) {
    const c = $(t).find("td.rank.first").length;
    if (c > bestCount) {
      bestCount = c;
      bestTable = $(t);
    }
  }
  if (!bestTable || bestCount === 0) return [];

  const out: TERankingRow[] = [];
  bestTable.find("tbody tr").each((_idx, tr) => {
    const $tr = $(tr);
    const rankCell = $tr.find("td.rank.first").first();
    if (rankCell.length === 0) return;
    const rank = parseInt(rankCell.text().replace(/\D/g, ""), 10);
    if (!Number.isFinite(rank)) return;

    // TE encodes direction in a CSS class on an inner <div>:
    //   <div class="oup">5</div>    — player moved UP 5 places (improved)
    //   <div class="odown">3</div>  — player moved DOWN 3 places (worsened)
    //   <div>-</div>                — no change (or first publication)
    // We follow the ATP/WTA convention: positive = improved, negative = worsened.
    const moveDiv = $tr.find("td.prevrank div").first();
    const moveClass = moveDiv.attr("class") ?? "";
    const moveMag = parseInt(moveDiv.text().replace(/\D/g, ""), 10);
    let rankMove: number | null = null;
    if (Number.isFinite(moveMag)) {
      if (moveClass.includes("oup")) rankMove = moveMag;
      else if (moveClass.includes("odown")) rankMove = -moveMag;
    }

    const nameLink = $tr.find("td.t-name a").first();
    const href = nameLink.attr("href") ?? "";
    const teSlug = href.match(/^\/player\/([^/]+)\//)?.[1] ?? "";
    const displayName = nameLink.text().trim();
    if (!teSlug || !displayName) return;
    const fullName = reorderName(displayName);

    const flagSpan = $tr.find("td.tl span.fl").first();
    const flagClass = flagSpan.attr("class") ?? "";
    const cc = flagClass.match(/\bfl-([a-z]{2,3})\b/)?.[1] ?? null;
    const countryCode = cc ? cc.toUpperCase() : null;

    const pointsText = $tr.find("td.long-point").first().text().trim();
    const points = parseInt(pointsText.replace(/[^\d]/g, ""), 10);
    if (!Number.isFinite(points)) return;

    out.push({ rank, teSlug, displayName, fullName, countryCode, points, rankMove });
  });
  return out;
}

/**
 * TE shows "Sinner Jannik" — flip to "Jannik Sinner" so it matches the
 * canonical first-name-first form we use everywhere else. Heuristic: if
 * the string is two whitespace-separated tokens, swap them. For 3+
 * tokens we treat everything-but-last as the surname (e.g. "De Minaur
 * Alex" → "Alex De Minaur").
 */
function reorderName(taLastFirst: string): string {
  const parts = taLastFirst.split(/\s+/).filter(Boolean);
  if (parts.length < 2) return taLastFirst;
  const first = parts[parts.length - 1]!;
  const last = parts.slice(0, -1).join(" ");
  return `${first} ${last}`;
}
