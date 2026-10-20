/**
 * ATP Tour match results, from the official site.
 *
 * WHY THIS EXISTS
 *
 * TennisExplorer was the only source of current-season match results, and it
 * has two fatal problems: a corporate proxy began blocking the host outright
 * (SEC_E_UNTRUSTED_ROOT on the TLS handshake), and it costs one HTTP request
 * PER MATCH to learn the round and score — roughly 13,000 requests to backfill
 * a summer.
 *
 * atptour.com publishes the same information server-rendered, one page per
 * TOURNAMENT (~230 matches on a Slam results page), and the markup carries
 * things TennisExplorer never supplied:
 *
 *   - the ATP player id, in the profile href (/en/players/{slug}/{id}/overview)
 *     -> a stable key, which retires the name-matching guesswork that produced
 *        phantom duplicate players
 *   - an explicit winner marker, rather than inferring it from set counts
 *   - main draw vs qualifying, from the round label
 *   - seeds
 *
 * The page needs a real browser: atptour.com sits behind Cloudflare, which
 * rejects Node's TLS fingerprint regardless of User-Agent. `fetch-live.ts`
 * already solves that for the rankings and this reuses the same approach.
 *
 * Parsing and fetching are deliberately separate so the parser can be tested
 * offline against a checked-in fixture.
 */
import type { Round } from "../config/points-table";

export interface AtpResultPlayer {
  /** Display name, e.g. "Alexander Zverev". */
  fullName: string;
  /**
   * Normalised slug, comparable with `players.slug`.
   *
   * ATP's own href segment is NOT a clean slug: 35 of 232 players in the
   * reference capture carry raw spaces, apostrophes or dots, because the
   * convention is `firstname-lastname` with the surname's internal spaces
   * left intact - "pablo-llamas ruiz", "christopher-o'connell", "j.j.-wolf".
   * Normalised here so it can be joined against our own slugs; use `atpId`
   * when identity matters.
   */
  atpSlug: string;
  /** The href segment verbatim, for reconstructing an ATP profile URL. */
  atpSlugRaw: string;
  /**
   * Stable player id from the profile href, e.g. "z355".
   *
   * Not always an ATP id. Players without an ATP profile yet - qualifiers and
   * wildcards - appear with a Sportradar competitor id instead
   * ("sr:competitor:1149753"), normalised here to "sr-1149753". Check
   * `idSource` before treating this as an ATP identifier.
   */
  atpId: string;
  /** Which registry `atpId` belongs to. */
  idSource: "atp" | "sportradar";
  /** 3-letter IOC code, upper-cased, from the flag sprite href. */
  countryCode: string | null;
  /** Seed number, when shown. */
  seed: number | null;
  /** Games won per set, in order. */
  games: number[];
  /** Tiebreak points per set, aligned with `games`; null where no tiebreak. */
  tiebreaks: Array<number | null>;
  won: boolean;
}

export interface AtpResultMatch {
  /** Canonical round, or "W" is never used here — winners come from `won`. */
  round: Round;
  /** True when the round label said "Qualifying". */
  isQualifying: boolean;
  /** Raw label, kept for diagnosis: "Round of 16 - Arthur Ashe Stadium". */
  rawHeader: string;
  court: string | null;
  /**
   * ISO date the match was played, from the enclosing day accordion
   * ("Mon, 07 September, 2026 Day (15)"). Null only if a match sits outside
   * any day section.
   *
   * This matters more than it looks. Tennis Abstract stamps every match at an
   * event with the TOURNAMENT START date, which is why a flat 52-week window
   * missed the US Open entirely and every cross-source dedupe key on
   * played_on failed to collide. This source gives the real date.
   */
  playedOn: string | null;
  /** Exactly two entries. */
  players: [AtpResultPlayer, AtpResultPlayer];
  /** "6-2 6-2 7-6(3)" style, reconstructed from the cells. */
  scoreString: string;
}

/**
 * Round-label mapping.
 *
 * Deliberately exhaustive and deliberately strict: an unrecognised label
 * throws rather than falling back to a default. The `R48` bug in
 * `points-table.ts` is the cautionary tale — a round that silently resolved to
 * something adjacent scored 0 points for every affected player and nothing
 * failed. A hard error on an unknown label is far cheaper to notice.
 *
 * Draw-size labels ("Round of 128") map straight onto our ladder. Qualifying
 * labels map onto Q1/Q2/Q3 and set `isQualifying`.
 */
const ROUND_LABELS: Record<string, { round: Round; qualifying: boolean }> = {
  "round of 128": { round: "R128", qualifying: false },
  "round of 64": { round: "R64", qualifying: false },
  "round of 32": { round: "R32", qualifying: false },
  "round of 16": { round: "R16", qualifying: false },
  "quarter-finals": { round: "QF", qualifying: false },
  "quarterfinals": { round: "QF", qualifying: false },
  "quarter finals": { round: "QF", qualifying: false },
  "semi-finals": { round: "SF", qualifying: false },
  "semifinals": { round: "SF", qualifying: false },
  "semi finals": { round: "SF", qualifying: false },
  finals: { round: "F", qualifying: false },
  final: { round: "F", qualifying: false },
  "1st round qualifying": { round: "Q1", qualifying: true },
  "2nd round qualifying": { round: "Q2", qualifying: true },
  "3rd round qualifying": { round: "Q3", qualifying: true },
};

export class UnknownAtpRoundError extends Error {
  constructor(label: string) {
    super(
      `Unrecognised ATP round label "${label}". Add it to ROUND_LABELS in ` +
        `scraper/sources/atp-results.ts. Refusing to guess, because a wrong ` +
        `round silently mis-scores every affected player.`,
    );
    this.name = "UnknownAtpRoundError";
  }
}

function mapRound(header: string): { round: Round; qualifying: boolean; court: string | null } {
  // "Round of 16 - Arthur Ashe Stadium" -> label + court
  const parts = header.split(" - ");
  const label = parts[0]!.trim().toLowerCase();
  const court = parts.length > 1 ? parts.slice(1).join(" - ").trim() : null;
  const hit = ROUND_LABELS[label];
  if (!hit) throw new UnknownAtpRoundError(parts[0]!.trim());
  return { round: hit.round, qualifying: hit.qualifying, court };
}

/** "/en/players/alexander-zverev/z355/overview" -> slug + id */
function parseProfileHref(href: string | undefined): {
  slug: string;
  slugRaw: string;
  id: string;
  idSource: "atp" | "sportradar";
} | null {
  if (!href) return null;
  const m = href.match(/\/players\/([^/]+)\/([^/]+)\//);
  if (!m) return null;
  const raw = decodeURIComponent(m[1]!);
  const slug = raw
    .toLowerCase()
    .replace(/['’.]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  const rawId = decodeURIComponent(m[2]!);
  // Qualifiers and wildcards with no ATP profile carry a Sportradar
  // competitor id instead: "sr:competitor:1149753".
  const sr = rawId.match(/^sr:competitor:(\d+)$/i);
  return sr
    ? { slug, slugRaw: raw, id: `sr-${sr[1]}`, idSource: "sportradar" as const }
    : { slug, slugRaw: raw, id: rawId, idSource: "atp" as const };
}

/** "/assets/atptour/assets/flags.svg#flag-ger" -> "GER" */
function parseFlag(href: string | undefined): string | null {
  if (!href) return null;
  const m = href.match(/#flag-([a-z]{3})$/i);
  return m ? m[1]!.toUpperCase() : null;
}

/**
 * A score cell holds the games won, and for a tiebreak set ALSO the tiebreak
 * points, as a second text node: "6\n   3" means 6 games and a 3-point
 * tiebreak, i.e. this side lost 7-6(3). The first cell of every row is blank.
 */
function parseScoreCell(text: string): { games: number | null; tiebreak: number | null } {
  const nums = text.match(/\d+/g);
  if (!nums || nums.length === 0) return { games: null, tiebreak: null };
  return {
    games: Number(nums[0]),
    tiebreak: nums.length > 1 ? Number(nums[1]) : null,
  };
}

function buildScoreString(a: AtpResultPlayer, b: AtpResultPlayer): string {
  const sets: string[] = [];
  for (let i = 0; i < Math.max(a.games.length, b.games.length); i++) {
    const ga = a.games[i];
    const gb = b.games[i];
    if (ga == null || gb == null) continue;
    // The tiebreak points belong to the LOSER of that set, which is how the
    // conventional "7-6(3)" notation reads.
    const tb = a.tiebreaks[i] ?? b.tiebreaks[i] ?? null;
    sets.push(tb == null ? `${ga}-${gb}` : `${ga}-${gb}(${tb})`);
  }
  return sets.join(" ");
}

/**
 * Parse an atptour.com tournament results page.
 *
 * Uses cheerio, already a dependency. Selectors verified against a 2026-09
 * capture of /en/scores/current/us-open/560/results (232 matches).
 */
const MONTHS: Record<string, number> = {
  january: 1, february: 2, march: 3, april: 4, may: 5, june: 6,
  july: 7, august: 8, september: 9, october: 10, november: 11, december: 12,
};

/** "Mon, 07 September, 2026 Day (15)" -> "2026-09-07" */
export function parseAtpDayHeading(text: string): string | null {
  const m = text.match(/(\d{1,2})\s+([A-Za-z]+),?\s+(\d{4})/);
  if (!m) return null;
  const month = MONTHS[m[2]!.toLowerCase()];
  if (!month) return null;
  const day = Number(m[1]);
  const year = Number(m[3]);
  if (day < 1 || day > 31) return null;
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

export async function parseAtpResults(html: string): Promise<AtpResultMatch[]> {
  const cheerio = await import("cheerio");
  const $ = cheerio.load(html);
  const out: AtpResultMatch[] = [];

  // Matches are grouped into day accordions, whose heading carries the date.
  // Build a lookup from match element -> ISO date before walking the matches,
  // so a match outside any accordion still parses (with a null date) rather
  // than being dropped.
  //
  // ============================================================
  // THE DAY PANELS ARE NOT A COMPLETE PER-DAY INDEX. DO NOT TRUST
  // THEM BLINDLY — THIS COST US 122 WRONGLY DATED US OPEN ROWS.
  // ============================================================
  //
  // Verified against the checked-in US Open 2026 capture: 13 day panels hold
  // 232 matches, but they are split 140 / 32 / 32 / 9 / 7 / 1 / 1 / 1 / 1 / 1
  // / 1 / 2 / 4. The later days hold only the FEATURED matches of that day
  // (one or four), and everything else is dumped into the "Day (1)" panel —
  // dating 61 of 64 first-round matches to 2026-08-24, six days before the
  // main draw began. There is no per-day URL, no day query parameter and no
  // ISO timestamp anywhere in the markup, so a single fetch cannot do better.
  //
  // A wrong date is worse here than no date. `played_on` drives both the
  // 52-week dropping window and the in-week credit, and because the
  // documented cross-source dedupe keys on `played_on`, a wrongly dated row
  // does not collide with the correctly dated TennisExplorer row for the same
  // match — so the match is counted TWICE.
  //
  // The dump panel is identifiable and a legitimate day is not: one real day
  // never spans three or more different main-draw rounds. Panels that do are
  // treated as carrying no date, the writer skips those rows, and the
  // correctly dated source keeps the match. Coverage is lost deliberately in
  // exchange for not corrupting every points sum that touches these rows.
  const MAX_MAIN_DRAW_ROUNDS_PER_DAY = 2;
  const dateFor = new Map<unknown, string>();
  $(".atp_accordion-item").each((_, accEl) => {
    const heading = $(accEl)
      .find(".atp_accordion-head, .accordion-head, button, h3, h4")
      .first()
      .text()
      .replace(/\s+/g, " ")
      .trim();
    const iso = parseAtpDayHeading(heading);
    if (!iso) return;

    const mainDrawRounds = new Set<Round>();
    $(accEl)
      .find("div.match")
      .each((__, mEl) => {
        const header = $(mEl).find(".match-header").text().replace(/\s+/g, " ").trim();
        if (!header) return;
        let mapped: ReturnType<typeof mapRound>;
        try {
          mapped = mapRound(header);
        } catch {
          return; // an unknown label is reported by the main pass below
        }
        if (!mapped.qualifying) mainDrawRounds.add(mapped.round);
      });
    if (mainDrawRounds.size > MAX_MAIN_DRAW_ROUNDS_PER_DAY) return;

    $(accEl)
      .find("div.match")
      // Braces matter: cheerio's each() treats a returned value as a
      // break signal, and Map.set returns the Map.
      .each((__, mEl) => {
        dateFor.set(mEl, iso);
      });
  });

  $("div.match").each((_, matchEl) => {
    const $m = $(matchEl);
    const rawHeader = $m.find(".match-header").text().replace(/\s+/g, " ").trim();
    if (!rawHeader) return;
    const { round, qualifying, court } = mapRound(rawHeader);

    const infos = $m.find(".player-info");
    const stats = $m.find(".stats-item");
    // Singles only. Doubles rows carry two names per side and are skipped
    // rather than mangled into a singles record.
    if (infos.length !== 2) return;

    const players: AtpResultPlayer[] = [];
    for (let side = 0; side < 2; side++) {
      const $p = infos.eq(side);
      const link = $p.find(".name a").first();
      const profile = parseProfileHref(link.attr("href"));
      if (!profile) return; // no stable id -> skip rather than guess
      const seedText = $p.find(".name span").first().text().trim();
      const seedMatch = seedText.match(/\((\d+)\)/);

      const cells = stats
        .eq(side)
        .find(".scores .score-item")
        .map((__, c) => $(c).text())
        .get();
      const parsed = cells.map(parseScoreCell).filter((c) => c.games !== null);

      players.push({
        fullName: link.text().replace(/\s+/g, " ").trim(),
        atpSlug: profile.slug,
        atpSlugRaw: profile.slugRaw,
        atpId: profile.id,
        idSource: profile.idSource,
        countryCode: parseFlag($p.find("svg use").attr("href")),
        seed: seedMatch ? Number(seedMatch[1]) : null,
        games: parsed.map((c) => c.games!),
        tiebreaks: parsed.map((c) => c.tiebreak),
        won: $p.find(".winner").length > 0,
      });
    }
    if (players.length !== 2) return;

    const [a, b] = players as [AtpResultPlayer, AtpResultPlayer];
    out.push({
      round,
      isQualifying: qualifying,
      rawHeader,
      court,
      playedOn: dateFor.get(matchEl) ?? null,
      players: [a, b],
      scoreString: buildScoreString(a, b),
    });
  });

  return out;
}

export interface AtpResultsTarget {
  /** ATP tournament slug, e.g. "us-open". */
  slug: string;
  /** ATP tournament id, e.g. "560". */
  tournamentId: string;
  /** Season. Current-year events live under /current/, past under /archive/. */
  year: number;
  /** Force the archive path even for the current year. */
  archive?: boolean;
}

export function atpResultsUrl(t: AtpResultsTarget): string {
  const nowYear = new Date().getUTCFullYear();
  const useArchive = t.archive ?? t.year < nowYear;
  return useArchive
    ? `https://www.atptour.com/en/scores/archive/${t.slug}/${t.tournamentId}/${t.year}/results`
    : `https://www.atptour.com/en/scores/current/${t.slug}/${t.tournamentId}/results`;
}

/**
 * Fetch and parse one tournament's results.
 *
 * Requires Chromium: atptour.com is behind Cloudflare, which rejects Node's
 * TLS fingerprint whatever User-Agent is sent. This is one page per
 * tournament, not per match, so the request cost is trivial next to the
 * per-match crawl it replaces.
 */
export async function fetchAtpResults(t: AtpResultsTarget): Promise<AtpResultMatch[]> {
  const { withPage, gotoPastChallenge } = await import("../browser");
  const url = atpResultsUrl(t);
  const html = await withPage(
    async (page) => {
      // Throws CloudflareChallengeError on an uncleared interstitial, instead
      // of letting it surface as "parsed 0 matches ... or the markup changed".
      await gotoPastChallenge(page, url);
      await page.waitForSelector("div.match", { timeout: 45_000 }).catch(() => {});
      return page.content();
    },
    { width: 1400, height: 1000 },
  );
  const matches = await parseAtpResults(html);
  if (matches.length === 0) {
    throw new Error(
      `${url}: parsed 0 matches from ${html.length} bytes. Either the ` +
        `tournament has no results yet, or the markup changed — check ` +
        `div.match / .player-info / .score-item in atp-results.ts.`,
    );
  }
  return matches;
}
