// Local cache of the Sackmann archive — the replay's ground truth: official
// weekly rankings with points, and every match with a stable per-edition
// `tourney_id`. Downloaded once into data/archive/ (gitignored) and parsed as
// plain CSV text; nothing in it is ever executed.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { parseCsv } from "../sources/tennis-abstract";
import type { ArchiveMatch, OfficialRow, Tour } from "./types";

const BASE =
  process.env.TA_BASE_URL ?? "https://raw.githubusercontent.com/Aneeshers/tennis-sackmann-archive/main";
export const CACHE_DIR = resolve(process.cwd(), "data", "archive");

/** Every match file for one season: tour level, qualifying/Challenger/125, ITF. */
export function matchFiles(tour: Tour, year: number): string[] {
  return tour === "atp"
    ? [`atp_matches_${year}.csv`, `atp_matches_qual_chall_${year}.csv`, `atp_matches_futures_${year}.csv`]
    : [`wta_matches_${year}.csv`, `wta_matches_qual_itf_${year}.csv`];
}

const RANKING_FILES = (tour: Tour) => [`${tour}_rankings_20s.csv`, `${tour}_rankings_current.csv`];

export async function readArchiveFile(tour: Tour, file: string, refresh = false): Promise<string> {
  const path = join(CACHE_DIR, tour, file);
  if (!refresh && existsSync(path)) return readFileSync(path, "utf8");
  const url = `${BASE}/${tour}/${file}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`[replay] archive fetch ${url} -> ${res.status}`);
  const text = await res.text();
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text);
  return text;
}

const isoCompact = (raw: string | undefined): string | null =>
  raw && /^\d{8}$/.test(raw) ? `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}` : null;
const intOrNull = (raw: string | undefined): number | null =>
  raw && /^\d+$/.test(raw) ? Number(raw) : null;

export function toArchiveMatch(row: Record<string, string>): ArchiveMatch | null {
  const tourneyDate = isoCompact(row.tourney_date);
  if (!row.tourney_id || !tourneyDate || !row.winner_id || !row.loser_id || !row.round) return null;
  return {
    tourneyId: row.tourney_id,
    tourneyName: row.tourney_name ?? "",
    level: row.tourney_level ?? "",
    drawSize: intOrNull(row.draw_size),
    tourneyDate,
    round: row.round,
    winnerId: row.winner_id,
    loserId: row.loser_id,
    winnerEntry: row.winner_entry || null,
    loserEntry: row.loser_entry || null,
    score: row.score || null,
    winnerRank: intOrNull(row.winner_rank),
    loserRank: intOrNull(row.loser_rank),
  };
}

export function toOfficialRow(row: Record<string, string>): OfficialRow | null {
  const week = isoCompact(row.ranking_date);
  const rank = intOrNull(row.rank);
  const points = intOrNull(row.points);
  if (!week || rank == null || rank < 1 || points == null || !row.player) return null;
  return { week, rank, playerId: row.player, points, tours: intOrNull(row.tours) };
}

export function parseMatches(text: string): { matches: ArchiveMatch[]; skipped: number } {
  const matches: ArchiveMatch[] = [];
  let skipped = 0;
  for (const row of parseCsv(text)) {
    const m = toArchiveMatch(row);
    if (m) matches.push(m);
    else skipped++;
  }
  return { matches, skipped };
}

/** Adds rows with `from <= week <= to` into `into`; returns how many rows were malformed. */
export function parseOfficial(
  text: string,
  from: string,
  to: string,
  into: Map<string, Map<string, OfficialRow>>,
): number {
  let skipped = 0;
  for (const row of parseCsv(text)) {
    const r = toOfficialRow(row);
    if (!r) {
      skipped++;
      continue;
    }
    if (r.week < from || r.week > to) continue;
    let week = into.get(r.week);
    if (!week) into.set(r.week, (week = new Map()));
    week.set(r.playerId, r);
  }
  return skipped;
}

export async function loadMatches(
  tour: Tour,
  years: number[],
  refresh = false,
): Promise<{ matches: ArchiveMatch[]; skipped: number }> {
  const matches: ArchiveMatch[] = [];
  let skipped = 0;
  for (const y of years) {
    for (const f of matchFiles(tour, y)) {
      const parsed = parseMatches(await readArchiveFile(tour, f, refresh));
      matches.push(...parsed.matches);
      skipped += parsed.skipped;
    }
  }
  return { matches, skipped };
}

export async function loadOfficial(
  tour: Tour,
  from: string,
  to: string,
  refresh = false,
): Promise<{ byWeek: Map<string, Map<string, OfficialRow>>; skipped: number }> {
  const byWeek = new Map<string, Map<string, OfficialRow>>();
  let skipped = 0;
  for (const f of RANKING_FILES(tour)) {
    skipped += parseOfficial(await readArchiveFile(tour, f, refresh), from, to, byWeek);
  }
  return { byWeek, skipped };
}

export async function loadPlayerNames(tour: Tour, refresh = false): Promise<Map<string, string>> {
  const names = new Map<string, string>();
  for (const row of parseCsv(await readArchiveFile(tour, `${tour}_players.csv`, refresh))) {
    if (row.player_id) names.set(row.player_id, `${row.name_first ?? ""} ${row.name_last ?? ""}`.trim());
  }
  return names;
}
