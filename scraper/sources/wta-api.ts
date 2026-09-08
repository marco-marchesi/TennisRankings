/**
 * WTA match results and tournament calendar, from the official WTA API.
 *
 * WHY THIS EXISTS
 *
 * The WTA half of the database was the worse half. Tennis Abstract's mirror
 * stops at Roland Garros (2026-05-25) and its upstream is deleted, so nothing
 * later will ever arrive from it. TennisExplorer was covering June onward, and
 * it is now blocked outright on this network. That left WTA match data frozen,
 * which is exactly why the live-ranking comparison scored so much worse for
 * WTA than for ATP.
 *
 * `api.wtatennis.com` is the site's own JSON backend and it needs no browser
 * and no Cloudflare workaround — plain HTTP, gzip, no key. Two endpoints do
 * everything:
 *
 *   GET /tennis/tournaments/?from=&to=&page=&pageSize=
 *       the calendar. Carries `level` ("Grand Slam" / "WTA 1000" / "WTA 500" /
 *       "WTA 250" / "WTA 125" / "ITF"), `surface` and `singlesDrawSize` —
 *       three things TennisExplorer never supplied, and the draw size is what
 *       makes round resolution exact rather than guessed.
 *
 *   GET /tennis/tournaments/{id}/{year}/matches?from=&to=
 *       every match at an event, main draw and qualifying, singles and
 *       doubles, in ONE request. Carries the WTA player id, a real per-match
 *       timestamp, per-set games, and an explicit winner code.
 *
 * WHAT IT FIXES BEYOND FRESHNESS
 *
 *   identity   `PlayerIDA` / `PlayerIDB` are stable WTA ids, so players are
 *              keyed rather than name-matched. Name matching is what produced
 *              73 phantom duplicate players earlier in this project.
 *   dates      `MatchTimeStamp` is the real match time. Tennis Abstract stamps
 *              every match at an event with the tournament START date, which
 *              is why 52-week windows and cross-source dedupe both failed.
 *   rounds     resolved from the draw size, so a 96-draw WTA 1000 gets R128
 *              for its first round and R64 for its second — the same slots the
 *              official points table uses.
 *
 * Parsing and fetching are separate so the parser can be tested offline
 * against a checked-in fixture.
 */
import type { Round } from "../config/points-table";
import { politeFetch } from "../http";
import { slugify } from "@/lib/utils";

export const WTA_API_BASE = "https://api.wtatennis.com/tennis";

/** Marks rows written from this source. */
export const WTA_API_SOURCE = "wta_api";

/* -------------------------------------------------------------------------- */
/* Tournaments                                                                */
/* -------------------------------------------------------------------------- */

export interface WtaTournament {
  /** WTA tournament group id, e.g. "905" for the US Open. */
  id: string;
  year: number;
  /** Sponsor title, e.g. "Abierto GNP Seguros - Monterrey, MEX". */
  title: string;
  /**
   * Short event name, e.g. "MONTERREY" / "US OPEN" / "CINCINNATI".
   *
   * This is the one that can be compared with the other feeds. See
   * `eventName()` for why it, and not `title`, is what gets stored.
   */
  groupName: string | null;
  /** "Grand Slam" | "WTA 1000" | "WTA 500" | "WTA 250" | "WTA 125" | "ITF". */
  level: string;
  surface: string | null;
  /** ISO date. */
  startDate: string;
  /** ISO date. */
  endDate: string;
  /**
   * Actual entry list size, which is often NOT a power of two: 96 and 94 for
   * the 12-day WTA 1000s, 28 for a WTA 500 with byes. Round resolution rounds
   * this up to the nominal draw, which is what the points table is indexed by.
   */
  singlesDrawSize: number | null;
  city: string | null;
  country: string | null;
  status: string | null;
}

/** Levels that award WTA ranking points under the tables we implement. */
export const WTA_TOUR_LEVELS = [
  "Grand Slam",
  "WTA Finals",
  "WTA 1000",
  "WTA 500",
  "WTA 250",
  "WTA 125",
] as const;

/**
 * Tour-level events only.
 *
 * ITF events (W15 through W100) do award ranking points, and this API covers
 * them — a genuine coverage win available later. They are excluded for now
 * because `points-table.ts` has no ITF tiers, so ingesting them would feed the
 * calculator matches it would score as though they were WTA 250s. Wrong points
 * are worse than absent points.
 */
export function isTourLevel(level: string): boolean {
  return (WTA_TOUR_LEVELS as readonly string[]).includes(level);
}

function str(v: unknown): string | null {
  return typeof v === "string" && v.length > 0 ? v : null;
}

function num(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && /^\d+$/.test(v)) return Number(v);
  return null;
}

export interface TournamentPage {
  tournaments: WtaTournament[];
  /** Total across all pages, from `pageInfo.numEntries`. */
  numEntries: number;
  page: number;
  pageSize: number;
}

/**
 * Parse one tournament record.
 *
 * The same shape appears in the calendar's `content[]` and embedded as
 * `tournament` in the matches response, so both paths share this.
 */
export function parseTournamentRecord(raw: unknown): WtaTournament | null {
  const t = (raw ?? {}) as Record<string, unknown>;
  const group = (t.tournamentGroup ?? {}) as Record<string, unknown>;
  const id = num(group.id) ?? num(t.liveScoringId);
  const year = num(t.year);
  const startDate = str(t.startDate);
  const endDate = str(t.endDate);
  // An event with no id, year or dates cannot be fetched or windowed, so
  // there is nothing useful to keep.
  if (id == null || year == null || !startDate || !endDate) return null;
  return {
    id: String(id),
    year,
    title: str(t.title) ?? str(group.name) ?? `WTA ${id}`,
    groupName: str(group.name),
    level: str(t.level) ?? str(group.level) ?? "",
    surface: str(t.surface),
    startDate,
    endDate,
    singlesDrawSize: num(t.singlesDrawSize),
    city: str(t.city),
    country: str(t.country),
    status: str(t.status),
  };
}

/**
 * Parse one page of the calendar endpoint.
 *
 * The envelope is `{ pageInfo, content }`. `pageInfo.numPages` is reported as
 * 0 regardless of the real total, so pagination has to be driven by
 * `numEntries` and the page length instead.
 */
export function parseTournamentList(json: unknown): TournamentPage {
  const root = (json ?? {}) as Record<string, unknown>;
  const info = (root.pageInfo ?? {}) as Record<string, unknown>;
  const content = Array.isArray(root.content)
    ? root.content
    : Array.isArray(json)
      ? (json as unknown[])
      : [];

  const tournaments: WtaTournament[] = [];
  for (const raw of content) {
    const parsed = parseTournamentRecord(raw);
    if (parsed) tournaments.push(parsed);
  }

  return {
    tournaments,
    numEntries: num(info.numEntries) ?? tournaments.length,
    page: num(info.page) ?? 0,
    pageSize: num(info.pageSize) ?? tournaments.length,
  };
}

async function getJson(url: string): Promise<unknown> {
  const res = await politeFetch(url, { headers: { Accept: "application/json" } });
  const text = await res.text();
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new Error(
      `${url}: expected JSON, got ${text.length} bytes starting ` +
        `${JSON.stringify(text.slice(0, 80))}`,
    );
  }
}

export interface FetchTournamentsOptions {
  /** ISO date, inclusive. */
  from: string;
  /** ISO date, inclusive. */
  to: string;
  /** Restrict to tour-level events. Default true. */
  tourLevelOnly?: boolean;
  /** Safety valve; the calendar returns ~800 rows for a 13-month window. */
  maxPages?: number;
}

/** Fetch the calendar for a date window, following pagination. */
export async function fetchTournaments(opts: FetchTournamentsOptions): Promise<WtaTournament[]> {
  const pageSize = 100;
  const maxPages = opts.maxPages ?? 20;
  const out: WtaTournament[] = [];
  const seen = new Set<string>();

  for (let page = 0; page < maxPages; page++) {
    const url =
      `${WTA_API_BASE}/tournaments/?from=${encodeURIComponent(opts.from)}` +
      `&to=${encodeURIComponent(opts.to)}&page=${page}&pageSize=${pageSize}`;
    const parsed = parseTournamentList(await getJson(url));
    for (const t of parsed.tournaments) {
      const key = `${t.id}-${t.year}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(t);
    }
    // Stop on a short page, or once every advertised entry has been seen.
    if (parsed.tournaments.length < pageSize) break;
    if (parsed.numEntries > 0 && (page + 1) * pageSize >= parsed.numEntries) break;
  }

  return (opts.tourLevelOnly ?? true) ? out.filter((t) => isTourLevel(t.level)) : out;
}

/* -------------------------------------------------------------------------- */
/* Rounds                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Round ladder, longest first. A draw of nominal size N plays the tail of this
 * list starting at `R{N}`.
 */
const MAIN_LADDER: readonly Round[] = ["R128", "R64", "R32", "R16", "QF", "SF", "F"];

/** Qualifying ladder, in playing order. */
const QUAL_LADDER: readonly Round[] = ["Q1", "Q2", "Q3"];

/**
 * Nominal (power-of-two) draw size for an entry list of `n`.
 *
 * Real draws are frequently not powers of two — 96 and 94 for the 12-day WTA
 * 1000s, 28 for a WTA 500, 56 for a two-week 1000. Seeds take byes and the
 * SECOND round is then the true Round of N/2, which is precisely how the
 * points table is laid out: a 96-draw 1000 pays R128 points to a first-round
 * loser and R64 points to a bye holder who loses their opener.
 */
export function nominalDrawSize(n: number): number {
  let size = 4;
  while (size < n && size < 128) size *= 2;
  return size;
}

/** The rounds a main draw of this entry-list size actually plays, in order. */
export function mainDrawLadder(singlesDrawSize: number): Round[] {
  const nominal = nominalDrawSize(singlesDrawSize);
  const idx = MAIN_LADDER.indexOf(`R${nominal}` as Round);
  if (idx >= 0) return [...MAIN_LADDER.slice(idx)];
  // Nominal 8 and 4 have no "R8"/"R4" label — they start at QF and SF.
  if (nominal <= 4) return [...MAIN_LADDER.slice(5)];
  return [...MAIN_LADDER.slice(4)];
}

export interface RoundResolution {
  round: Round;
  isQualifying: boolean;
}

/**
 * Map a WTA `RoundID` onto our canonical round.
 *
 * The API's scheme, verified against three 2026 events of different draw
 * sizes (US Open 128, Cincinnati 96, Memphis 32):
 *
 *   "1".."4"   numeric rounds counted from the FIRST round played, so their
 *              meaning depends on the draw size — "1" is R128 at a 96-draw
 *              1000 and R32 at a 32-draw 250.
 *   "Q"        quarter-final. Not qualifying; `DrawLevelType` says that.
 *   "S"        semi-final.
 *   "F"        final.
 *
 * `DrawLevelType` is "M" for main draw and "Q" for qualifying.
 *
 * Returns null rather than guessing when the id cannot be resolved. Two real
 * cases hit this: Grand Slam qualifying, where every match carries an EMPTY
 * RoundID, and round-robin formats. A wrong round silently mis-scores every
 * affected player, which is the failure mode this project has already paid
 * for twice.
 */
export function resolveWtaRound(input: {
  roundId: string;
  drawLevelType: string;
  singlesDrawSize: number | null;
  /** Distinct numeric qualifying round ids present at this event, ascending. */
  qualifyingRoundIds?: number[];
}): RoundResolution | null {
  const raw = (input.roundId ?? "").trim().toUpperCase();
  const isQualifying = (input.drawLevelType ?? "").trim().toUpperCase() === "Q";

  if (isQualifying) {
    const n = /^\d+$/.test(raw) ? Number(raw) : null;
    if (n == null) return null;
    const present = (input.qualifyingRoundIds ?? []).slice().sort((a, b) => a - b);
    const position = present.indexOf(n);
    // The points tables key off the FINAL qualifying round, so anchor there
    // and count backwards: a three-round qualifying draw maps 1/2/3 onto
    // Q1/Q2/Q3, a two-round draw maps 1/2 onto Q2/Q3. This is an
    // approximation for short qualifying draws, where the true first-round
    // value is lower than Q2's — worth at most a couple of points, and only
    // for players who qualified rather than entered directly.
    if (position < 0 || present.length === 0) {
      return n >= 1 && n <= 3 ? { round: QUAL_LADDER[n - 1]!, isQualifying: true } : null;
    }
    const ladder = QUAL_LADDER.slice(Math.max(0, QUAL_LADDER.length - present.length));
    const round = ladder[Math.min(position, ladder.length - 1)];
    return round ? { round, isQualifying: true } : null;
  }

  if (raw === "Q") return { round: "QF", isQualifying: false };
  if (raw === "S") return { round: "SF", isQualifying: false };
  if (raw === "F") return { round: "F", isQualifying: false };

  if (/^\d+$/.test(raw)) {
    if (input.singlesDrawSize == null) return null;
    const ladder = mainDrawLadder(input.singlesDrawSize);
    const round = ladder[Number(raw) - 1];
    return round ? { round, isQualifying: false } : null;
  }

  return null;
}

/* -------------------------------------------------------------------------- */
/* Matches                                                                    */
/* -------------------------------------------------------------------------- */

export interface WtaMatchPlayer {
  /** Stable WTA player id, e.g. "326408". */
  wtaId: string;
  firstName: string;
  lastName: string;
  /** "Iga Swiatek" — first then last, as the API supplies them. */
  fullName: string;
  /** Normalised, comparable with `players.slug`. */
  slug: string;
  /** 3-letter IOC code, upper-cased. */
  countryCode: string | null;
  seed: number | null;
  /** Games won per set, in order. Empty for a walkover. */
  games: number[];
  won: boolean;
}

export interface WtaMatch {
  /** API match id, e.g. "LS74124818". Not stable enough to key on alone. */
  matchId: string;
  tourneyId: string;
  year: number;
  round: Round;
  isQualifying: boolean;
  /**
   * ISO date the match was played, from `MatchTimeStamp` (UTC), clamped to the
   * tournament window. A late-night session in the Americas can therefore read
   * one day later than the local date — immaterial for a 52-week window, and
   * the clamp stops a match escaping its own event.
   */
  playedOn: string | null;
  /** Exactly two entries; index 0 is the API's side A. */
  players: [WtaMatchPlayer, WtaMatchPlayer];
  /** 0 when side A won, 1 when side B won. */
  winnerSide: 0 | 1;
  /** The loser retired mid-match. */
  retired: boolean;
  /** The loser withdrew before play. */
  walkover: boolean;
  /** Winner-first, e.g. "6-2 6-4" or "6-7(6) 6-4 6-3". */
  scoreString: string;
}

/**
 * `Winner` is a status code, not a side index. Verified against Cincinnati
 * 2026, cross-checked with the `ResultString` "winner d loser" ordering:
 * even codes mean side A won, odd codes mean side B won, and the magnitude
 * carries how the match ended.
 *
 * Anything outside this map is left unresolved rather than folded into a
 * default — the set scores cannot settle a walkover, and the abbreviated
 * names in `ResultString` are not a safe tiebreaker.
 */
const WINNER_CODES: Record<string, { side: 0 | 1; retired: boolean; walkover: boolean }> = {
  "2": { side: 0, retired: false, walkover: false },
  "3": { side: 1, retired: false, walkover: false },
  "4": { side: 0, retired: true, walkover: false },
  "5": { side: 1, retired: true, walkover: false },
  "6": { side: 0, retired: false, walkover: true },
  "7": { side: 1, retired: false, walkover: true },
};

/**
 * Score tail of `ResultString`, e.g. "6-7(6),6-4,6-3" with an optional
 * "Ret'd" / "W/O" suffix.
 *
 * Anchored at the end of the string so it cannot bite into a player's name.
 * The reason to read it at all is tiebreak detail: the `ScoreSet*` fields
 * carry games only, so "7-6" alone loses the "(3)".
 */
const SCORE_TAIL =
  /(\d{1,2}-\d{1,2}(?:\(\d{1,2}\))?(?:\s*,\s*\d{1,2}-\d{1,2}(?:\(\d{1,2}\))?)*)\s*(?:Ret'?d|Retired|W\/O|Walkover|Def\.?)?\s*$/i;

function scoreFromResultString(result: string | null): string | null {
  if (!result) return null;
  const m = result.match(SCORE_TAIL);
  if (!m) return null;
  return m[1]!
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
    .join(" ");
}

export interface MatchParseContext {
  tourneyId: string;
  year: number;
  /**
   * Fallback only. The matches response EMBEDS the full tournament record,
   * including `singlesDrawSize`, so the parser is normally self-sufficient and
   * needs no calendar lookup to name a numeric round.
   */
  singlesDrawSize?: number | null;
  /** Fallback clamp bounds for `playedOn`. */
  startDate?: string;
  endDate?: string;
}

export interface MatchParseResult {
  /** The tournament record embedded in the response, when present. */
  tournament: WtaTournament | null;
  matches: WtaMatch[];
  /** Doubles rows, skipped by design. */
  skippedDoubles: number;
  /** Rows whose round could not be resolved — reported, never guessed. */
  unresolvedRounds: string[];
  /** Rows whose `Winner` code is not in `WINNER_CODES`. */
  unresolvedWinners: string[];
  /** Rows still in progress or not yet played. */
  unfinished: number;
}

/** Games won per set for one side, in order. Empty for a walkover. */
function gamesFor(raw: Record<string, unknown>, side: "A" | "B"): number[] {
  const games: number[] = [];
  for (let set = 1; set <= 5; set++) {
    const g = num(raw[`ScoreSet${set}${side}`]);
    if (g == null) break;
    games.push(g);
  }
  return games;
}

/**
 * Winner derived from the set scores, for the records where `Winner` is "0".
 *
 * Three of 6,454 matches in the 13-month window carry Winner="0" with
 * MatchState="F" and a complete score — all of them WTA 125 FINALS, i.e. a
 * title and 125 points that would otherwise go uncredited. Verified against
 * Guadalajara 125 2025 (LS001): Udvardy 6-1 5-7 3-6 Eala, so side B won.
 *
 * Deliberately conservative. It requires a decisive majority of at least two
 * sets, so a retirement ("6-0, 3-0 Ret'd") stays unresolved and reported
 * rather than being scored from a partial scoreline.
 */
function winnerFromSets(a: number[], b: number[]): 0 | 1 | null {
  let setsA = 0;
  let setsB = 0;
  for (let i = 0; i < Math.min(a.length, b.length); i++) {
    const hi = Math.max(a[i]!, b[i]!);
    const lo = Math.min(a[i]!, b[i]!);
    // Only a COMPLETED set counts. Without this check "0-6, 0-3 Ret'd" reads
    // as two sets to nil and invents a straight-sets win out of a retirement.
    if (hi < 6) continue;
    if (hi - lo < 2 && hi !== 7) continue;
    if (a[i]! > b[i]!) setsA++;
    else setsB++;
  }
  if (Math.max(setsA, setsB) < 2 || setsA === setsB) return null;
  return setsA > setsB ? 0 : 1;
}

function playerSide(
  raw: Record<string, unknown>,
  side: "A" | "B",
  won: boolean,
): WtaMatchPlayer | null {
  const wtaId = str(raw[`PlayerID${side}`]);
  const firstName = str(raw[`PlayerNameFirst${side}`]) ?? "";
  const lastName = str(raw[`PlayerNameLast${side}`]) ?? "";
  if (!wtaId || (!firstName && !lastName)) return null;
  const fullName = `${firstName} ${lastName}`.replace(/\s+/g, " ").trim();
  const seed = num(raw[`Seed${side}`]);
  return {
    wtaId,
    firstName,
    lastName,
    fullName,
    slug: slugify(fullName),
    countryCode: str(raw[`PlayerCountry${side}`])?.toUpperCase() ?? null,
    seed: seed != null && seed > 0 ? seed : null,
    games: gamesFor(raw, side),
    won,
  };
}

function clampDate(iso: string, from?: string, to?: string): string {
  if (from && iso < from) return from;
  if (to && iso > to) return to;
  return iso;
}

/** Parse the matches endpoint for one tournament. */
export function parseWtaMatches(json: unknown, ctx: MatchParseContext): MatchParseResult {
  const root = (json ?? {}) as Record<string, unknown>;
  const rows = Array.isArray(root.matches)
    ? root.matches
    : Array.isArray(json)
      ? (json as unknown[])
      : [];

  const tournament = parseTournamentRecord(root.tournament);
  const singlesDrawSize = tournament?.singlesDrawSize ?? ctx.singlesDrawSize ?? null;
  const startDate = tournament?.startDate ?? ctx.startDate;
  const endDate = tournament?.endDate ?? ctx.endDate;

  const result: MatchParseResult = {
    tournament,
    matches: [],
    skippedDoubles: 0,
    unresolvedRounds: [],
    unresolvedWinners: [],
    unfinished: 0,
  };

  // Qualifying rounds are numbered from the first round played, so how many
  // rounds the draw has is needed before any single one can be named. Collect
  // that first.
  const qualifyingRoundIds = [
    ...new Set(
      rows
        .map((r) => (r ?? {}) as Record<string, unknown>)
        .filter(
          (r) =>
            String(r.DrawLevelType ?? "").toUpperCase() === "Q" &&
            String(r.DrawMatchType ?? "").toUpperCase() === "S" &&
            /^\d+$/.test(String(r.RoundID ?? "").trim()),
        )
        .map((r) => Number(String(r.RoundID).trim())),
    ),
  ].sort((a, b) => a - b);

  for (const rawRow of rows) {
    const raw = (rawRow ?? {}) as Record<string, unknown>;

    // Singles only. A doubles row carries two names per side and would be
    // mangled into a nonsense singles record.
    if (String(raw.DrawMatchType ?? "").toUpperCase() !== "S") {
      result.skippedDoubles++;
      continue;
    }

    // "F" is the finished state. Anything else has no result to store.
    if (String(raw.MatchState ?? "").toUpperCase() !== "F") {
      result.unfinished++;
      continue;
    }

    let winner = WINNER_CODES[String(raw.Winner ?? "").trim()];
    if (!winner) {
      // Winner="0" means the code was never entered, not that the match is
      // unfinished. Fall back to the set scores, which are present.
      const derived = winnerFromSets(gamesFor(raw, "A"), gamesFor(raw, "B"));
      if (derived != null) winner = { side: derived, retired: false, walkover: false };
    }
    if (!winner) {
      result.unresolvedWinners.push(
        `${str(raw.MatchID) ?? "?"} Winner=${JSON.stringify(raw.Winner)}`,
      );
      continue;
    }

    const round = resolveWtaRound({
      roundId: String(raw.RoundID ?? ""),
      drawLevelType: String(raw.DrawLevelType ?? ""),
      singlesDrawSize,
      qualifyingRoundIds,
    });
    if (!round) {
      result.unresolvedRounds.push(
        `${str(raw.MatchID) ?? "?"} ${String(raw.DrawLevelType ?? "?")}/${String(raw.RoundID ?? "")}`,
      );
      continue;
    }

    const a = playerSide(raw, "A", winner.side === 0);
    const b = playerSide(raw, "B", winner.side === 1);
    if (!a || !b) continue;

    const ts = str(raw.MatchTimeStamp);
    let playedOn: string | null = null;
    if (ts) {
      const d = new Date(ts);
      if (!Number.isNaN(d.getTime())) {
        playedOn = clampDate(d.toISOString().slice(0, 10), startDate, endDate);
      }
    }

    const winnerPlayer = winner.side === 0 ? a : b;
    const loserPlayer = winner.side === 0 ? b : a;
    const reconstructed: string[] = [];
    for (let i = 0; i < Math.max(winnerPlayer.games.length, loserPlayer.games.length); i++) {
      const gw = winnerPlayer.games[i];
      const gl = loserPlayer.games[i];
      if (gw == null || gl == null) continue;
      reconstructed.push(`${gw}-${gl}`);
    }
    // Prefer the ResultString tail (it has tiebreak points) but only when it
    // agrees with the structured fields on set count, so a mis-parse cannot
    // substitute a wrong score.
    // ResultString is "winner d loser <score>"; ScoreString is the bare
    // score, already winner-first, and appears on the records that omit
    // ResultString. Both carry the tiebreak points the ScoreSet* fields drop.
    const fromResult =
      scoreFromResultString(str(raw.ResultString)) ?? scoreFromResultString(str(raw.ScoreString));
    const useResult =
      fromResult != null && fromResult.split(" ").length === reconstructed.length;
    let scoreString = useResult ? fromResult! : reconstructed.join(" ");
    if (winner.retired) scoreString = `${scoreString} RET`.trim();
    if (winner.walkover) scoreString = `${scoreString} W/O`.trim();

    result.matches.push({
      matchId: str(raw.MatchID) ?? `${ctx.tourneyId}-${ctx.year}-${result.matches.length}`,
      tourneyId: ctx.tourneyId,
      year: ctx.year,
      round: round.round,
      isQualifying: round.isQualifying,
      playedOn,
      players: [a, b],
      winnerSide: winner.side,
      retired: winner.retired,
      walkover: winner.walkover,
      scoreString,
    });
  }

  return result;
}

export function wtaMatchesUrl(tourneyId: string, year: number, window?: { from?: string; to?: string }): string {
  const qs: string[] = [];
  if (window?.from) qs.push(`from=${encodeURIComponent(window.from)}`);
  if (window?.to) qs.push(`to=${encodeURIComponent(window.to)}`);
  const suffix = qs.length > 0 ? `?${qs.join("&")}` : "";
  return `${WTA_API_BASE}/tournaments/${encodeURIComponent(tourneyId)}/${year}/matches${suffix}`;
}

/**
 * Fetch and parse one tournament's matches.
 *
 * Deliberately fetches the WHOLE event rather than a date window: it is one
 * request either way, and a window would drop the early rounds a player's
 * points total depends on.
 */
export async function fetchWtaMatches(t: {
  id: string;
  year: number;
  /** Fallbacks, used only if the response omits its tournament block. */
  singlesDrawSize?: number | null;
  startDate?: string;
  endDate?: string;
}): Promise<MatchParseResult> {
  const json = await getJson(wtaMatchesUrl(t.id, t.year));
  return parseWtaMatches(json, {
    tourneyId: t.id,
    year: t.year,
    singlesDrawSize: t.singlesDrawSize ?? null,
    startDate: t.startDate,
    endDate: t.endDate,
  });
}

/**
 * Tier string to store in `player_recent_matches.tournament_level`.
 *
 * The API's own level is kept VERBATIM rather than squeezed into one of Tennis
 * Abstract's tier letters, because it is strictly more informative:
 * TA's "P" covers both WTA 500 and 250, so a letter would throw away a
 * distinction the API states outright and force `inferCategory` back to
 * guessing from the event name. `inferCategory` understands these strings
 * directly.
 *
 * Qualifying is NOT marked here. The round (Q1/Q2/Q3) already selects the
 * qualifying column of the points table, and a qualifying loss at a Slam is
 * still worth Slam qualifying points — overwriting the tier would discard
 * exactly the information needed to score it.
 */
export function wtaTournamentLevel(level: string): string | null {
  return isTourLevel(level) ? level : null;
}

/** Tokens that stay upper-case when the API's SHOUTY group name is cased. */
const ACRONYMS = new Set(["US", "DC", "UK", "UAE", "ATP", "WTA", "ITF", "GNP", "BNP"]);

/**
 * The name to STORE for an event.
 *
 * Uses the API's short `tournamentGroup.name`, not its sponsor `title`,
 * because the stored name is what every cross-source comparison joins on and
 * the sponsor title shares nothing with the other feeds:
 *
 *   wta_api title      "Abierto GNP Seguros - Monterrey, MEX"
 *   tennis_explorer    "Monterrey"
 *   wta_api groupName  "MONTERREY"                <- aligns
 *
 * Storing the title split every WTA event into two "tournaments" in the
 * projections, and since the deriver credits each group separately, players
 * were credited TWICE. Measured on 2026-09-08: Janice Tjen held her Monterrey
 * R32 under both feeds with a different name, round label ("R32" / "1R"), date
 * (08-24 / 08-25) and opponent format ("Dayana Yastremska" /
 * "Yastremska D."), so no dedupe key could ever collide them. That is what
 * put Iva Jovic 451 points above live-tennis.eu.
 *
 * Title-cased for display, preserving known acronyms so "US OPEN" does not
 * become "Us Open".
 */
export function eventName(t: Pick<WtaTournament, "groupName" | "title" | "id">): string {
  const raw = t.groupName ?? t.title;
  return raw
    .split(/\s+/)
    .map((word) =>
      ACRONYMS.has(word.toUpperCase())
        ? word.toUpperCase()
        : word.charAt(0).toUpperCase() + word.slice(1).toLowerCase(),
    )
    .join(" ");
}
