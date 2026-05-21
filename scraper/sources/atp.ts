import * as cheerio from "cheerio";
import { politeFetch } from "../http";
import { RankingEntry, type RankingSnapshot } from "../validate";
import { slugify } from "@/lib/utils";

const ATP_RANKINGS_URL = "https://www.atptour.com/en/rankings/singles";

interface ParseInput {
  html: string;
  weekOf: string;
  /** Pass true when parsing the Race-to-Finals page (same HTML structure). */
  isRace?: boolean;
}

/**
 * Parses ATP rankings from the official rankings HTML page.
 *
 * Walks each <tbody> row in the rankings table and extracts cells by their
 * semantic class — `.rank`, `.player`, `.points`, `.tourns`. The slug is
 * pulled from the player profile URL; the country code from the flag SVG's
 * `<use href="#flag-xxx">` reference.
 *
 * Rows missing a numeric rank are skipped so header/decoration rows don't
 * pollute the output. If atptour.com renames these class hooks, the contract
 * test under `__tests__/atp.test.ts` fails before we publish.
 */
export function parseAtpRankings({ html, weekOf, isRace = false }: ParseInput): RankingSnapshot {
  const $ = cheerio.load(html);
  const rows: ReturnType<typeof RankingEntry.parse>[] = [];

  // The page renders the same rankings twice — once as `mobile-table` (with
  // abbreviated names like "J. Sinner") and once as `desktop-table` (full
  // names). Scope to the desktop variant so both names and row counts are
  // correct without double-counting.
  $("table.desktop-table tbody tr").each((_, el) => {
    const $row = $(el);

    const rank = parseNumericCell($row.find("td.rank").first().text());
    if (rank === null || rank < 1) return;

    const $playerCell = $row.find("td.player").first();
    const $playerLink = $playerCell.find("a[href*='/players/']").first();
    const href = $playerLink.attr("href") ?? "";
    const nameFromSpan = $playerLink.find("span").first().text().trim();
    const fullName = nameFromSpan || $playerLink.text().trim();
    if (!fullName) return;

    const slugFromUrl = href.match(/\/players\/([^/]+)\//)?.[1] ?? "";
    const slug = slugFromUrl || slugify(fullName);
    if (!slug) return;

    const flagHref = $playerCell
      .find("svg use[href*='#flag-'], svg use[xlink\\:href*='#flag-']")
      .attr("href")
      ?? $playerCell.find("svg use").attr("href")
      ?? "";
    const countryMatch = flagHref.match(/#flag-([a-z]{3})/i);
    const countryCode = countryMatch?.[1] ? countryMatch[1].toUpperCase() : null;

    const points = parseNumericCell($row.find("td.points").first().text());
    if (points === null) return;

    const tournamentsPlayed = parseNumericCell($row.find("td.tourns").first().text());
    const age = parseNumericCell($row.find("td.age").first().text());

    // The right-hand columns on atptour.com expose the rolling-window state
    // explicitly: "+/-" (points move from last week), "Dropping" (points that
    // expire next Monday), and "Next Best" (highest non-countable result).
    // Capturing these natively is much more reliable than re-deriving them
    // from prior-year match data; ATP's published numbers already account
    // for best-18 + Slam-waiver edge cases.
    //
    // The Race page renders a different layout: `td.best` contains two child
    // spans (.next-points + .max-points) and there is no `td.drop` column at
    // all. We skip these fields on race pages — the dropping/best concepts
    // don't apply the same way to year-to-date race standings.
    const pointsMove = parsePointsMoveCell($row.find("td.pointsMove").first().text());
    const isRacePage = $row.find("td.current-tourn").length > 0;
    const dropPoints = isRacePage ? null : parseNumericCell($row.find("td.drop").first().text());
    const nextBestPoints = isRacePage ? null : parseNumericCell($row.find("td.best").first().text());

    rows.push(
      RankingEntry.parse({
        rank,
        slug,
        fullName,
        countryCode,
        points,
        tournamentsPlayed,
        age,
        pointsMove,
        dropPoints,
        nextBestPoints,
      }),
    );
  });

  return { tour: "atp", weekOf, isRace, entries: rows };
}

/**
 * Parses ATP-style cell text into a number, returning null for blanks, "-",
 * or anything non-numeric. Strips commas and whitespace so "14,700" → 14700.
 */
function parseNumericCell(text: string): number | null {
  const trimmed = text.trim();
  if (!trimmed || trimmed === "-") return null;
  const n = Number(trimmed.replace(/[,\s]/g, ""));
  return Number.isFinite(n) ? n : null;
}

/**
 * Parses the "+/-" cell which keeps its sign as a leading "+" or "-": e.g.
 * "+350" → 350, "-1000" → -1000, "-" → null. parseNumericCell would coerce
 * "-1000" wrong because it bails on leading "-", so we use a dedicated path.
 */
function parsePointsMoveCell(text: string): number | null {
  const trimmed = text.trim().replace(/[,\s]/g, "");
  if (!trimmed || trimmed === "-") return null;
  const n = Number(trimmed.startsWith("+") ? trimmed.slice(1) : trimmed);
  return Number.isFinite(n) ? n : null;
}

export async function fetchAtpRankings(weekOf: string): Promise<RankingSnapshot> {
  const res = await politeFetch(ATP_RANKINGS_URL);
  const html = await res.text();
  return parseAtpRankings({ html, weekOf });
}
