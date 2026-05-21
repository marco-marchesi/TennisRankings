// Tennis Abstract (Jeff Sackmann) CSV source.
//
// Sackmann's github.com/JeffSackmann/tennis_atp and /tennis_wta repos publish
// weekly-updated, CC-BY-licensed CSVs covering every official ranking and
// match since 1968. We use these as the historical backfill and the player-
// metadata source. Files we touch:
//
//   atp_players.csv          player_id,name_first,name_last,hand,dob,ioc,height,wikidata_id
//   atp_rankings_20s.csv     ranking_date,rank,player,points         (2020s data)
//   atp_rankings_current.csv same schema, current updates
//   wta_*  equivalents in the tennis_wta repo
//
// Everything here is read-only HTTP. No Cloudflare, no Playwright, no rate
// limiting concerns at GitHub's raw-content scale.

const TA_BASE = "https://raw.githubusercontent.com/JeffSackmann";

export type Tour = "atp" | "wta";

export interface TAPlayer {
  /** Tennis Abstract / Match Charting Project numeric ID, as a string. */
  playerId: string;
  firstName: string;
  lastName: string;
  hand: "right" | "left" | "unknown";
  /** ISO date (YYYY-MM-DD) or null when DOB unknown. */
  dateOfBirth: string | null;
  /** 3-letter IOC country code. */
  countryCode: string | null;
  heightCm: number | null;
  wikidataId: string | null;
}

export interface TARanking {
  /** ISO date (YYYY-MM-DD) of the Monday this ranking was published. */
  rankingDate: string;
  rank: number;
  playerId: string;
  points: number | null;
}

export interface TAMatch {
  taTourneyId: string;
  taMatchNum: number;
  /** ISO date (YYYY-MM-DD), derived from tourney_date column. */
  playedOn: string;
  tournamentName: string;
  /** "G" Grand Slam, "M" Masters/WTA1000, "A" ATP/WTA tour, "C" Challenger, "F" Finals, "D" Davis Cup. */
  tournamentLevel: string | null;
  surface: string | null;
  round: string;
  winnerId: string;
  winnerName: string;
  winnerCountry: string | null;
  loserId: string;
  loserName: string;
  loserCountry: string | null;
  score: string | null;
  matchMinutes: number | null;
}

/** Fetch the full player metadata table for a tour. */
export async function fetchPlayers(tour: Tour): Promise<TAPlayer[]> {
  const repo = tour === "atp" ? "tennis_atp" : "tennis_wta";
  const url = `${TA_BASE}/${repo}/master/${tour}_players.csv`;
  const text = await httpGet(url);
  const rows = parseCsv(text);
  return rows.map(toPlayer).filter((p): p is TAPlayer => p !== null);
}

/**
 * Fetch ranking history for the given decade buckets. Pass
 * `["10s", "20s", "current"]` to cover players' careers from 2010 onward —
 * which covers everyone currently in the top 50 since the oldest active top-
 * 50 player turned pro around 2003 and didn't break into top 50 until 2010+.
 */
export async function fetchRankings(tour: Tour, buckets: string[]): Promise<TARanking[]> {
  const repo = tour === "atp" ? "tennis_atp" : "tennis_wta";
  const all: TARanking[] = [];
  for (const b of buckets) {
    const url = `${TA_BASE}/${repo}/master/${tour}_rankings_${b}.csv`;
    try {
      const text = await httpGet(url);
      const rows = parseCsv(text);
      for (const r of rows) {
        const parsed = toRanking(r);
        if (parsed) all.push(parsed);
      }
    } catch (err) {
      console.warn(`[tennis-abstract] skipping ${url}:`, err instanceof Error ? err.message : err);
    }
  }
  return all;
}

/**
 * Fetch match history for the given years (e.g. ["2024", "2025", "2026"]).
 * Each year is one CSV file in Sackmann's repo. Returns all matches across
 * all years; the caller filters by player.
 */
export async function fetchMatches(tour: Tour, years: string[]): Promise<TAMatch[]> {
  const repo = tour === "atp" ? "tennis_atp" : "tennis_wta";
  const all: TAMatch[] = [];
  for (const y of years) {
    const url = `${TA_BASE}/${repo}/master/${tour}_matches_${y}.csv`;
    try {
      const text = await httpGet(url);
      const rows = parseCsv(text);
      for (const r of rows) {
        const m = toMatch(r);
        if (m) all.push(m);
      }
    } catch (err) {
      console.warn(`[tennis-abstract] skipping ${url}:`, err instanceof Error ? err.message : err);
    }
  }
  return all;
}

// ─── internals ───────────────────────────────────────────────────────────

async function httpGet(url: string): Promise<string> {
  const res = await fetch(url, {
    headers: {
      "User-Agent": "TennisRankingsBot/0.1 (research; +https://tennisrankings.example)",
    },
  });
  if (!res.ok) throw new Error(`fetch ${url} → ${res.status} ${res.statusText}`);
  return res.text();
}

/**
 * Tiny CSV parser tuned for Tennis Abstract files. The data uses plain commas,
 * no embedded commas in fields, no quoting, no escapes. Anything more complex
 * (like commas in player names) would require a real CSV library — we have
 * not seen any so far across hundreds of thousands of rows.
 */
function parseCsv(text: string): Record<string, string>[] {
  const lines = text.trim().split(/\r?\n/);
  if (lines.length < 2) return [];
  const header = lines[0]!.split(",");
  const out: Record<string, string>[] = [];
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    if (!line) continue;
    const cells = line.split(",");
    const row: Record<string, string> = {};
    for (let j = 0; j < header.length; j++) {
      row[header[j]!] = (cells[j] ?? "").trim();
    }
    out.push(row);
  }
  return out;
}

function toPlayer(row: Record<string, string>): TAPlayer | null {
  const playerId = row.player_id;
  const firstName = row.name_first;
  const lastName = row.name_last;
  if (!playerId || !firstName || !lastName) return null;

  const handRaw = (row.hand ?? "").toUpperCase();
  const hand: TAPlayer["hand"] =
    handRaw === "R" ? "right" : handRaw === "L" ? "left" : "unknown";

  const dob = parseDateCompact(row.dob);
  const country = (row.ioc ?? "").toUpperCase();
  const heightStr = row.height ?? "";
  const heightCm = heightStr && /^\d+$/.test(heightStr) ? Number(heightStr) : null;

  return {
    playerId,
    firstName,
    lastName,
    hand,
    dateOfBirth: dob,
    countryCode: country.length === 3 ? country : null,
    heightCm,
    wikidataId: row.wikidata_id || null,
  };
}

function toRanking(row: Record<string, string>): TARanking | null {
  const rankingDate = parseDateCompact(row.ranking_date);
  const rankStr = row.rank;
  const playerId = row.player;
  if (!rankingDate || !rankStr || !playerId) return null;
  const rank = Number(rankStr);
  if (!Number.isFinite(rank) || rank < 1) return null;
  const pointsStr = row.points ?? "";
  const points = pointsStr && /^\d+$/.test(pointsStr) ? Number(pointsStr) : null;
  return { rankingDate, rank, playerId, points };
}

function toMatch(row: Record<string, string>): TAMatch | null {
  const taTourneyId = row.tourney_id;
  const taMatchNumRaw = row.match_num;
  const playedOn = parseDateCompact(row.tourney_date);
  const winnerId = row.winner_id;
  const loserId = row.loser_id;
  if (!taTourneyId || !taMatchNumRaw || !playedOn || !winnerId || !loserId) return null;
  const taMatchNum = Number(taMatchNumRaw);
  if (!Number.isFinite(taMatchNum)) return null;
  const tournamentName = row.tourney_name ?? "";
  if (!tournamentName) return null;
  const round = row.round ?? "";
  if (!round) return null;
  const minutesRaw = row.minutes ?? "";
  const matchMinutes = minutesRaw && /^\d+$/.test(minutesRaw) ? Number(minutesRaw) : null;
  return {
    taTourneyId,
    taMatchNum,
    playedOn,
    tournamentName,
    tournamentLevel: row.tourney_level || null,
    surface: row.surface || null,
    round,
    winnerId,
    winnerName: row.winner_name ?? "",
    winnerCountry: (row.winner_ioc ?? "").toUpperCase() || null,
    loserId,
    loserName: row.loser_name ?? "",
    loserCountry: (row.loser_ioc ?? "").toUpperCase() || null,
    score: row.score || null,
    matchMinutes,
  };
}

/** "20240722" → "2024-07-22" ; empty/invalid → null. */
function parseDateCompact(raw: string | undefined): string | null {
  if (!raw || !/^\d{8}$/.test(raw)) return null;
  return `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}`;
}

/**
 * Best-effort match between one of our DB players and a TA player row.
 * Compares normalized names; on ties prefers the entry whose country matches
 * ours. Returns null when nothing plausibly matches — caller decides whether
 * to skip or fall back to a slower fuzzy search.
 */
export function matchPlayer(
  ours: { fullName: string; countryCode: string | null },
  candidates: TAPlayer[],
): TAPlayer | null {
  const ourName = normalizeName(ours.fullName);
  const hits = candidates.filter((c) => {
    const candidateName = normalizeName(`${c.firstName} ${c.lastName}`);
    return candidateName === ourName;
  });
  if (hits.length === 0) return null;
  if (hits.length === 1) return hits[0]!;
  // Multiple hits → prefer country match, then most recent activity (we don't
  // have activity in the candidate row, so just return the country match).
  const byCountry = hits.find((h) => h.countryCode === ours.countryCode);
  return byCountry ?? hits[0]!;
}

function normalizeName(s: string): string {
  return s
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    // Convert hyphens to spaces FIRST so "Auger-Aliassime" matches TA's
    // "Auger Aliassime". Otherwise stripping non-alphanumerics collapses the
    // two parts of a hyphenated surname into one token and the names differ.
    .replace(/[-_]/g, " ")
    .replace(/[^a-z0-9 ]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}
