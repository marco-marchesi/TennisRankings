import * as cheerio from "cheerio";
import { politeFetch } from "../http";
import { RankingEntry, type RankingSnapshot } from "../validate";
import { slugify } from "@/lib/utils";

const WTA_RANKINGS_URL = "https://www.wtatennis.com/rankings/singles";

interface ParseInput {
  html: string;
  weekOf: string;
  /** Pass true when parsing the Race-to-Finals page (same HTML structure). */
  isRace?: boolean;
}

/**
 * Parses WTA rankings from wtatennis.com using cheerio.
 *
 * Each row is a `<tr class="player-row" data-player-name="..." data-player-id="...">`
 * with BEM-style cells:
 *   .player-row__cell--rank, --player, --age, --tournaments, --points
 *
 * The country code lives both in a `.player-cell__country--XXX` modifier class
 * and in the visible country span; we read the span text since it's the
 * source of truth and matches our ISO-3 expectation.
 *
 * `tr.player-row-drawer` are expandable detail rows interleaved between
 * player rows — we filter them out by selecting only `tr.player-row`.
 */
export function parseWtaRankings({ html, weekOf, isRace = false }: ParseInput): RankingSnapshot {
  const $ = cheerio.load(html);
  const rows: ReturnType<typeof RankingEntry.parse>[] = [];

  $("tr.player-row").each((_, el) => {
    const $row = $(el);
    const fullName = ($row.attr("data-player-name") ?? "").trim();
    if (!fullName) return;

    const rank = parseNumericCell($row.find("td.player-row__cell--rank .player-row__rank").first().text());
    if (rank === null || rank < 1) return;

    const points = parseNumericCell($row.find("td.player-row__cell--points").first().text());
    if (points === null) return;

    const tournamentsPlayed = parseNumericCell(
      $row.find("td.player-row__cell--tournaments").first().text(),
    );
    const age = parseNumericCell($row.find("td.player-row__cell--age").first().text());

    // Country: prefer the visible 3-letter code span, then fall back to the
    // class modifier (`player-cell__country--BLR`) so we still resolve when
    // markup tweaks remove the span text.
    let countryCode: string | null = null;
    const countrySpan = $row.find(".player-cell__country").first().text().trim();
    const match3 = countrySpan.match(/^[A-Z]{3}$/);
    if (match3) {
      countryCode = countrySpan;
    } else {
      const classes = $row.find(".player-cell__country").attr("class") ?? "";
      const m = classes.match(/player-cell__country--([A-Z]{3})/);
      if (m?.[1]) countryCode = m[1];
    }

    rows.push(
      RankingEntry.parse({
        rank,
        slug: slugify(fullName),
        fullName,
        countryCode,
        points,
        tournamentsPlayed,
        age,
      }),
    );
  });

  return { tour: "wta", weekOf, isRace, entries: rows };
}

function parseNumericCell(text: string): number | null {
  const trimmed = text.trim();
  if (!trimmed || trimmed === "-") return null;
  const n = Number(trimmed.replace(/[,\s]/g, ""));
  return Number.isFinite(n) ? n : null;
}

export async function fetchWtaRankings(weekOf: string): Promise<RankingSnapshot> {
  const res = await politeFetch(WTA_RANKINGS_URL);
  const html = await res.text();
  return parseWtaRankings({ html, weekOf });
}
