// TennisExplorer fetcher + parser.
//
// Why TE? Tennis Abstract's CSVs lag tournaments by 1-3 weeks. TE publishes
// completed matches the same day, often within minutes of the final point.
// We use it as a "fresh" overlay on top of `player_recent_matches`, with
// TA continuing to own the long-tail history.
//
// Two endpoints:
//   1. /matches/?type={atp,wta}-single&year=Y&month=M&day=D
//      Daily match list. One HTTP call per (tour, date). Parsed as a single
//      table.result of (tournament header row, then pairs of match rows).
//   2. /match-detail/?id={teMatchId}
//      Per-match page. Holds the round (td.round) and the
//      "{tournament}, {round}, {surface}" header we use to pin down surface.
//
// No Cloudflare. All requests go through `politeFetch` (1s/host throttle,
// kill-switch via SCRAPER_KILL_SWITCH).

import * as cheerio from "cheerio";
import { politeFetch } from "../http";
import { inferCategory } from "../projections/category-inference";
import type { Category } from "../config/points-table";

const BASE = "https://www.tennisexplorer.com";

export type Tour = "atp" | "wta";

export interface TEMatchRef {
  /** "3210567" from /match-detail/?id=3210567 — the source-side primary key. */
  teMatchId: string;
  /** TE's tournament URL slug: "/hamburg/2026/atp-men/" → "hamburg-2026". */
  tournamentSlug: string;
  /** Display name: "Hamburg" / "Roland Garros". From the head row. */
  tournamentName: string;
  /** "finished" | "live" | "planned" — controls whether we persist the row. */
  status: "finished" | "live" | "planned";
  /** Scheduled / kick-off time on the listing page ("HH:MM" or "—"). */
  time: string | null;
  p1Name: string;
  p1Slug: string | null;
  p1Country: string | null;
  p2Name: string;
  p2Slug: string | null;
  p2Country: string | null;
  /** Sets won by player 1 (e.g. 2 for a 2-0 win). null when match hasn't started. */
  p1Sets: number | null;
  p2Sets: number | null;
  /** Per-set games, ordered. e.g. ["6-0", "6-3"] for a straight-set win. */
  setScores: string[];
}

export interface TEMatch extends TEMatchRef {
  /** R128 / R64 / R32 / R16 / QF / SF / F — normalised to our codes. */
  round: string;
  /** "Hard" / "Clay" / "Grass" / "Carpet". Pulled from match-detail page. */
  surface: string | null;
  /** Mapped to our Category enum via inferCategory(). */
  category: Category | null;
  /** Combined score string in TA format, e.g. "6-0 6-3". */
  scoreString: string | null;
  /** True if p1 won the match (2-0 or 2-1 with more sets). */
  p1Won: boolean | null;
}

export async function fetchDailyMatchList(date: Date, tour: Tour): Promise<TEMatchRef[]> {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, "0");
  const d = String(date.getUTCDate()).padStart(2, "0");
  const url = `${BASE}/matches/?type=${tour}-single&year=${y}&month=${m}&day=${d}`;
  const res = await politeFetch(url);
  const html = await res.text();
  return parseDailyMatchList(html);
}

export function parseDailyMatchList(html: string): TEMatchRef[] {
  const $ = cheerio.load(html);
  const table = $("table.result").first();
  const rows = table.find("tr").toArray();
  const out: TEMatchRef[] = [];

  // Walk rows. State carries the "current tournament" — set when we see a
  // head.flags row, then attached to subsequent match-row pairs until the
  // next head.flags row.
  let currentTournament: { name: string; slug: string } | null = null;

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]!;
    const cls = $(row).attr("class") ?? "";
    const $row = $(row);

    if (/\bhead\b/.test(cls)) {
      // Tournament header: <a href="/hamburg/2026/atp-men/">Hamburg</a>
      const link = $row.find("a").first();
      const slugMatch = (link.attr("href") ?? "").match(/^\/([^/]+)\/(\d{4})\//);
      const name = link.text().trim() || $row.find(".t-name").text().trim();
      if (slugMatch && name) {
        currentTournament = {
          name,
          slug: `${slugMatch[1]}-${slugMatch[2]}`,
        };
      } else {
        currentTournament = null;
      }
      continue;
    }

    // A match consumes TWO consecutive non-head rows. The first row has
    // class "fRow" (or similar) and a <td.first.time> column; the second
    // has the same parity colour but no time cell.
    if (!/\bfRow\b/.test(cls) && !$row.find("td.first.time").length) continue;
    if (!currentTournament) continue;

    const p2Row = rows[i + 1];
    if (!p2Row) break;
    const $p2 = $(p2Row);

    const p1Cells = $row.find("td").toArray();
    const p2Cells = $p2.find("td").toArray();
    if (p1Cells.length < 4 || p2Cells.length < 4) continue;

    // Match-detail link — distinguishes a real match row from filler.
    const detailLink = $row.find("a[href*='/match-detail/']").first();
    const teMatchId = (detailLink.attr("href") ?? "").match(/[?&]id=(\d+)/)?.[1];
    if (!teMatchId) continue;

    // Player 1: first <td.t-name> link → name + slug
    const p1NameCell = $row.find("td.t-name").first();
    const p1NameLink = p1NameCell.find("a").first();
    const p1Name = stripSeed(p1NameLink.text() || p1NameCell.text());
    const p1Slug = extractPlayerSlug(p1NameLink.attr("href") ?? "");
    const p1Country = $row.find("td.t-name img").first().attr("alt") ?? null;

    // Player 2 row: name is the first <td.t-name>; no time column → the
    // name td is td[0] not td[1].
    const p2NameCell = $p2.find("td.t-name").first();
    const p2NameLink = p2NameCell.find("a").first();
    const p2Name = stripSeed(p2NameLink.text() || p2NameCell.text());
    const p2Slug = extractPlayerSlug(p2NameLink.attr("href") ?? "");
    const p2Country = $p2.find("td.t-name img").first().attr("alt") ?? null;

    // Time + status
    // TE sometimes inlines "Live streams1xBet" or other ad text into the
    // time cell. Pull just the HH:MM and ignore the rest.
    const timeCellText = $row.find("td.first.time").text();
    const timeMatch = timeCellText.match(/\b(\d{1,2}:\d{2})\b/);
    const time = timeMatch ? timeMatch[1]! : null;
    // Status: if both players have numeric set columns, it's finished/live.
    // TE doesn't expose a status string in markup directly; we infer:
    //   - both result columns populated with sets won → finished/live
    //   - one or both empty → planned
    const p1ResultText = $row.find("td.result").first().text().trim();
    const p2ResultText = $p2.find("td.result").first().text().trim();
    const p1Sets = parseIntOrNull(p1ResultText);
    const p2Sets = parseIntOrNull(p2ResultText);

    const setScores: string[] = [];
    const p1ScoreCells = $row.find("td.score").toArray();
    const p2ScoreCells = $p2.find("td.score").toArray();
    for (let s = 0; s < Math.min(p1ScoreCells.length, p2ScoreCells.length); s++) {
      const a = $(p1ScoreCells[s]!).text().trim();
      const b = $(p2ScoreCells[s]!).text().trim();
      if (!a && !b) continue;
      if (!a || !b) continue;
      setScores.push(`${normaliseSetCell(a)}-${normaliseSetCell(b)}`);
    }

    let status: TEMatchRef["status"];
    if (p1Sets == null || p2Sets == null) status = "planned";
    else if (p1Sets + p2Sets >= 2 && (p1Sets >= 2 || p2Sets >= 2)) status = "finished";
    else status = "live";

    out.push({
      teMatchId,
      tournamentSlug: currentTournament.slug,
      tournamentName: currentTournament.name,
      status,
      time,
      p1Name,
      p1Slug,
      p1Country: cleanCountry(p1Country),
      p2Name,
      p2Slug,
      p2Country: cleanCountry(p2Country),
      p1Sets,
      p2Sets,
      setScores,
    });

    i++; // skip the second row of this match
  }

  return out;
}

export async function fetchMatchDetail(ref: TEMatchRef, tour: Tour): Promise<TEMatch> {
  const url = `${BASE}/match-detail/?id=${ref.teMatchId}`;
  const res = await politeFetch(url);
  const html = await res.text();
  return parseMatchDetail(html, ref, tour);
}

export function parseMatchDetail(html: string, ref: TEMatchRef, tour: Tour): TEMatch {
  const $ = cheerio.load(html);

  // Round: <td class="round">QF</td>
  const roundRaw = $("td.round").first().text().trim();
  const round = normaliseRound(roundRaw);

  // Surface: pulled from the "{tournament}, {round-word}, {surface}" header
  // that TE renders near the top of the body. Body-text regex is the most
  // resilient extraction — TE's header markup varies between layouts.
  const surface = extractSurface($("body").text());

  const category = inferCategory(tour, ref.tournamentName, null);

  const scoreString = ref.setScores.length > 0 ? ref.setScores.join(" ") : null;
  const p1Won =
    ref.p1Sets == null || ref.p2Sets == null ? null : ref.p1Sets > ref.p2Sets;

  return { ...ref, round, surface, category, scoreString, p1Won };
}

// ─── helpers ──────────────────────────────────────────────────────────────

function stripSeed(name: string): string {
  // "Sinner J. (1)" → "Sinner J."  ; "De Minaur A. (3)" → "De Minaur A."
  return name.replace(/\s*\([^)]*\)\s*$/, "").replace(/\s+/g, " ").trim();
}

function extractPlayerSlug(href: string): string | null {
  // /player/sinner-jannik/ → "sinner-jannik"
  // /player/humbert-e2553/ → "humbert-e2553" (TE sometimes suffixes IDs)
  const m = href.match(/^\/player\/([^/]+)\//);
  return m?.[1] ?? null;
}

function cleanCountry(s: string | null | undefined): string | null {
  if (!s) return null;
  const trimmed = s.trim().toUpperCase();
  return /^[A-Z]{2,3}$/.test(trimmed) ? trimmed : null;
}

function parseIntOrNull(text: string): number | null {
  if (!text) return null;
  const n = Number(text);
  return Number.isFinite(n) ? n : null;
}

/**
 * TE writes tiebreak set scores as "610" meaning "6 with the opponent
 * winning 10 points in the TB" — i.e. "6-7(10)" from the loser's POV. We
 * normalise to a plain set-score like "6" (the tb digits drop on this
 * side; the opponent's set-cell will carry them too as e.g. "710").
 *
 * Long term, parsing "610" → "6(10)" is a presentation choice. For our
 * purposes — building a TA-style "6-0 6-3" score string — the first
 * digit is the games count, which is all the score parser in
 * `src/lib/players.ts` cares about.
 */
function normaliseSetCell(s: string): string {
  // "610" → "6"; "710" → "7"; otherwise as-is.
  if (/^\d{2,}$/.test(s) && (s.startsWith("6") || s.startsWith("7"))) {
    return s.charAt(0);
  }
  return s;
}

function normaliseRound(raw: string): string {
  const t = raw.trim().toLowerCase();
  if (!t) return "";
  if (t === "qf" || t.includes("quarter")) return "QF";
  if (t === "sf" || t.includes("semi")) return "SF";
  if (t === "f" || t === "final" || t.includes("final")) return "F";
  if (t === "r16" || t.includes("round of 16") || t.includes("4th round") || t.includes("fourth")) return "R16";
  if (t === "r32" || t.includes("round of 32") || t.includes("3rd round") || t.includes("third")) return "R32";
  if (t === "r64" || t.includes("round of 64") || t.includes("2nd round") || t.includes("second")) return "R64";
  if (t === "r128" || t.includes("round of 128") || t.includes("1st round") || t.includes("first")) return "R128";
  // Unknown — keep the raw text so it's at least diagnose-able.
  return raw.trim();
}

const HEADER_PAT =
  /([A-Za-z][A-Za-z .'\-]+),\s*(first round|second round|third round|fourth round|round of \d+|quarterfinal|semifinal|final|qualification|qualifying|qualifier)[A-Za-z\s,]*,\s*(clay|hard|grass|carpet|indoor)/i;

function extractSurface(text: string): string | null {
  const m = text.match(HEADER_PAT);
  if (!m) return null;
  const raw = (m[3] ?? "").toLowerCase();
  if (raw === "clay") return "Clay";
  if (raw === "hard") return "Hard";
  if (raw === "grass") return "Grass";
  if (raw === "carpet") return "Carpet";
  if (raw === "indoor") return "Hard"; // indoor hard is the universal default
  return null;
}
