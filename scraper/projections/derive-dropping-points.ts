// Computes "dropping points" for each player — the count that will roll off
// their 52-week rolling-sum window by the publish the live ranking projects to
// (see drop-horizon.ts: next Monday, or the Monday after a two-week event).
//
// Source: `player_recent_matches`. For each player, find the editions whose
// results leave the ranking before that publish, identify the deepest round
// they reached, look up the corresponding points, and sum across editions.
//
// Used as a fallback to `rankings_snapshots.drop_points` (which is the
// ATP-published value, captured directly during refresh). WTA's rankings
// page doesn't expose this column, so for WTA players we always rely on this
// derivation; for ATP we prefer the published value when present.
//
// Known approximations:
//   - We assume EVERY result counts (not "best 18 + 4 mandatory"), and we do
//     not promote the next-best result into the freed slot. For top players
//     who play more than 18 events the true net drop is smaller by their 19th
//     result — typically 1-65 points.
//   - Tournament category inference falls back to a default tier when level
//     code is ambiguous — see category-inference.ts for the rules.

import { db } from "@/db";
import { sql } from "drizzle-orm";
import { ROUNDS_IN_ORDER, canonicalizeRound, pointsForRound, type Round } from "../config/points-table";
import { inferCategory } from "./category-inference";
import { normSql } from "./tournament-key";
import { chargesResult, dropHorizon, editionEnd, expiryOf, type CurrentEvent } from "./drop-horizon";

interface Options {
  tour: "atp" | "wta";
  playerIds: number[];
  /**
   * Only count results expiring AFTER next Monday. For the ATP, whose
   * published Dropping column already states what leaves at next Monday's
   * publish, this returns just the extension a two-week event adds beyond it
   * (Shanghai 2025 while Shanghai 2026 is under way), so the two can be summed
   * without charging anything twice.
   */
  beyondNextMonday?: boolean;
}

/**
 * Returns a map of playerId → dropping points (always ≥ 0).
 * Players with nothing leaving the ranking get 0.
 */
export async function deriveDroppingPoints(opts: Options): Promise<Map<number, number>> {
  const result = new Map<number, number>();
  if (opts.playerIds.length === 0) return result;

  // WHAT DROPS
  //
  // Everything that leaves the ranking between this week's official publish
  // and the publish the live ranking projects to (see drop-horizon.ts):
  //
  //   (a) results whose 52 weeks run out inside (weekStart, horizon] — which,
  //       in the first week of a two-week event, includes the event after it
  //       (Wuhan 2025 during Beijing 2026); and
  //   (b) results from an event whose next edition is being played NOW, which
  //       replace last year's regardless of the 52-week date. A player drops
  //       these whether or not they entered this year (Sinner was not in the
  //       2026 US Open draw but still lost his 2025 final's 1,300).
  //
  // Excluded: a result whose event already held its NEXT edition before this
  // week. The official ranking dropped it then; charging it again on its
  // 52-week date would double-count.
  //
  // The previous version implemented only (b), and before that a flat window
  // 364 days back, which missed every TA row because TA dates all matches
  // with the tournament START (the 2025 US Open is 2025-08-25). Verified
  // against live-tennis.eu:
  //   Sabalenka  8575 - 2000 + 130 = 6705       (2025 US Open champion)
  //   Gauff      7244 - 390 - 1000 + 10 = 5864  (Beijing + Wuhan 2025)
  const weekStart = isoDate(mostRecentMonday(new Date()));
  const weekStartDate = new Date(`${weekStart}T00:00:00Z`);

  // Names must be compared NORMALIZED, never as raw strings — see
  // `tournament-key.ts`, which also records why this deliberately does NOT
  // strip tier suffixes (doing so merges the Madrid Challenger into the
  // Madrid Masters, and this function charges points by event identity).
  const NORM = normSql;

  // Events on now (or starting within the week), with their first dates in
  // the current edition. Looked up over 21 days so the second week of a
  // two-week event still sees its real start.
  const nowRes = await db.execute(sql`
    with cur as (
      select ${NORM("prm.tournament_name")} as key, prm.tournament_name as name,
             prm.tournament_level as level, prm.round, prm.played_on
      from player_recent_matches prm
      join players p on p.id = prm.player_id
      where p.tour = ${opts.tour}
        and prm.played_on >= ${isoDate(addDays(weekStartDate, -21))}
      union all
      select ${NORM("pum.tournament_name")}, pum.tournament_name, pum.tournament_level,
             'MD' as round, pum.scheduled_date
      from player_upcoming_matches pum
      join players p on p.id = pum.player_id
      where p.tour = ${opts.tour}
        and pum.scheduled_date >= ${weekStart}
        and pum.scheduled_date < ${isoDate(addDays(weekStartDate, 7))}
    )
    select key, max(name) as name, max(level) as level,
           (min(played_on) filter (where round not like 'Q%'))::text as first_md,
           min(played_on)::text as first_any
    from cur
    group by key
    having max(played_on) >= ${weekStart}
  `);
  const nowRows = rowsOf(nowRes).map((r) => ({
    key: String(r.key),
    name: String(r.name),
    level: (r.level as string | null) ?? null,
    firstMainDraw: (r.first_md as string | null) ?? null,
    firstAny: String(r.first_any),
  }));
  // Event key -> first main-draw date of its edition being played now.
  const mainDrawStartByKey = new Map(
    nowRows.filter((r) => r.key && r.key !== "—").map((r) => [r.key, r.firstMainDraw] as const),
  );
  const currentEvents: CurrentEvent[] = nowRows.map((r) => ({
    name: r.name,
    category: inferCategory(opts.tour, r.name, r.level),
    firstMainDraw: r.firstMainDraw,
    firstAny: r.firstAny,
  }));
  const horizon = dropHorizon(weekStart, currentEvents);

  // Candidate results: editions from roughly a year before the horizon.
  const lo = isoDate(addDays(weekStartDate, -400));
  const hi = isoDate(addDays(new Date(`${horizon}T00:00:00Z`), -330));

  // DISTINCT ON dedups the same logical match when several feeds wrote a row
  // for it, preferring the official sources via the source-CASE tiebreak.
  //
  // Keyed on (player, NORMALISED tournament, edition year, round). Every other
  // candidate key has been tried and fails, because the feeds agree on nothing
  // else about the same match. For Janice Tjen's Monterrey R32:
  //
  //   wta_api           "Monterrey"  R32  2026-08-24  "Dayana Yastremska"
  //   tennis_explorer   "Monterrey"  1R   2026-08-25  "Yastremska D."
  //
  //   played_on   differs (one day, or the whole tournament for TA rows)
  //   opponent    differs in FORMAT, so an opponent-keyed dedupe never
  //               collided and both rows survived
  //   round       differs in LABEL ("1R" / "R32"), canonicalised below
  //
  // (player, edition, round) is sound as a unique key because a player plays
  // at most ONE match per round at an event. The exception is a round-robin
  // group (the season finals), where several matches share round "RR" and
  // this will keep only one — acceptable, since `earnedAtTournament` already
  // scores by deepest round rather than by RR record.
  //
  // `ed` gives each edition's date span across the whole tour (for its end
  // date) and `next_lo` the start of the following year's edition (to skip
  // results the official ranking already replaced).
  const raw = await db.execute(sql`
    with ed as (
      select ${NORM("prm.tournament_name")} as key,
             extract(year from prm.played_on)::int as yr,
             min(prm.played_on)::text as lo, max(prm.played_on)::text as hi
      from player_recent_matches prm
      join players p on p.id = prm.player_id
      where p.tour = ${opts.tour}
        and prm.played_on >= ${lo}
      group by 1, 2
    )
    select distinct on (
      prm.player_id, ${NORM("prm.tournament_name")}, extract(year from prm.played_on), prm.round
    )
      prm.player_id, prm.tournament_name,
      ${NORM("prm.tournament_name")} as tournament_key,
      extract(year from prm.played_on)::int as yr,
      prm.tournament_level, prm.round, prm.won,
      ed.lo as ed_lo, ed.hi as ed_hi,
      (select min(n.lo) from ed n where n.key = ed.key and n.yr = ed.yr + 1) as next_lo
    from player_recent_matches prm
    join ed on ed.key = ${NORM("prm.tournament_name")}
           and ed.yr = extract(year from prm.played_on)::int
    where prm.player_id = any(array[${sql.join(opts.playerIds.map((id) => sql`${id}`), sql`, `)}]::int[])
      and prm.played_on >= ${lo}
      and prm.played_on <= ${hi}
    order by prm.player_id, ${NORM("prm.tournament_name")}, extract(year from prm.played_on), prm.round,
             case prm.source when 'atp_site' then 0 when 'wta_api' then 0 when 'tennis_explorer' then 1 else 2 end
  `);
  const rows = rowsOf(raw).map((r) => ({
    playerId: Number(r.player_id),
    tournamentName: String(r.tournament_name),
    tournamentKey: String(r.tournament_key),
    year: Number(r.yr),
    tournamentLevel: (r.tournament_level as string | null) ?? null,
    round: String(r.round),
    won: Boolean(r.won),
    edLo: String(r.ed_lo),
    edHi: String(r.ed_hi),
    nextLo: r.next_lo == null ? null : String(r.next_lo),
  }));

  // Group by (player, edition). Each group is the player's matches at that
  // edition, and the deepest one says what they earned.
  //
  // This used to group on the RAW name, which meant one edition became one
  // group PER SPELLING and every group's points were added together. With
  // both an official-feed row and a TennisExplorer row for the same event,
  // players were charged twice what they were defending: Sabalenka's 2025 US
  // Open title came to 4,000 rather than 2,000, and Iva Jovic's R64 to 140
  // rather than 70.
  const groups = new Map<string, typeof rows>();
  for (const r of rows) {
    const key = `${r.playerId}::${r.tournamentKey}::${r.year}`;
    const existing = groups.get(key);
    if (existing) existing.push(r);
    else groups.set(key, [r]);
  }

  for (const matches of groups.values()) {
    const first = matches[0]!;
    const category = inferCategory(opts.tour, first.tournamentName, first.tournamentLevel);
    const expiry = expiryOf(editionEnd(first.edLo, first.edHi, category, first.tournamentName));
    const charge = chargesResult({
      expiry,
      weekStart,
      horizon,
      replacedNow: mainDrawStartByKey.has(first.tournamentKey),
      currentMainDrawStart: mainDrawStartByKey.get(first.tournamentKey) ?? null,
      nextLo: first.nextLo,
      beyondNextMonday: opts.beyondNextMonday ?? false,
    });
    if (!charge) continue;
    const earned = earnedAtTournament(matches.map((m) => ({ round: m.round, won: m.won })), category);
    if (earned === 0) continue;
    result.set(first.playerId, (result.get(first.playerId) ?? 0) + earned);
  }

  return result;
}

function rowsOf(res: unknown): Array<Record<string, unknown>> {
  return (
    (res as { rows?: Array<Record<string, unknown>> }).rows ??
    (res as Array<Record<string, unknown>>)
  );
}

interface MatchOutcome {
  round: string;
  won: boolean;
}

/**
 * Given a player's match list at one tournament, compute how many points they
 * walked away with. The rule:
 *   - The DEEPEST round in their list is the round they reached.
 *   - If they LOST that deepest match → they were eliminated there →
 *     earned = pointsForRound(category, deepestRound).
 *   - If they WON that deepest match AND it was the F → they won the title →
 *     earned = pointsForRound(category, "W").
 *   - If they WON that deepest match but it wasn't F → either they won the
 *     title (data missing F row) or data is incomplete. Treat as advanced to
 *     the next round (conservative).
 */
function earnedAtTournament(matches: MatchOutcome[], category: ReturnType<typeof inferCategory>): number {
  if (matches.length === 0) return 0;
  // Rank each match by its position on the progression ladder. Higher = deeper.
  //
  // The raw label MUST go through canonicalizeRound first. Sources emit
  // "1R" / "R1" / "1st Round", and scrape-daily-matches writes a literal "—"
  // when TennisExplorer exposes no round at all. Passing those straight to
  // indexOf() returned -1, so deepestMatch stayed null and this function
  // silently returned 0 dropping. Because only sources/atp.ts populates
  // rankings_snapshots.drop_points, this is the ONLY dropping source for WTA,
  // so that silent zero meant WTA players never dropped anything.
  let deepestIdx = -1;
  let deepestRound: Round | null = null;
  let deepestWon = false;
  for (const m of matches) {
    const round = canonicalizeRound(m.round, category);
    if (!round) continue;
    const idx = ROUNDS_IN_ORDER.indexOf(round);
    if (idx > deepestIdx) {
      deepestIdx = idx;
      deepestRound = round;
      deepestWon = m.won;
    }
  }
  if (!deepestRound) return 0;

  if (deepestWon) {
    if (deepestRound === "F") return pointsForRound(category, "W");
    // Won this round, no subsequent match recorded → advanced one round and
    // stopped there. ROUNDS_IN_ORDER (not ALL_ROUNDS) is required here: R48
    // used to sit between R64 and R32, so every R64 winner was promoted into
    // a round worth 0 points in every category except ch_50.
    const nextRound = ROUNDS_IN_ORDER[deepestIdx + 1] ?? "W";
    return pointsForRound(category, nextRound);
  }
  // Lost at the deepest round → that's their finishing position.
  return pointsForRound(category, deepestRound);
}

function addDays(d: Date, n: number): Date {
  return new Date(d.getTime() + n * 24 * 60 * 60 * 1000);
}

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** Monday 00:00 UTC of the current ranking week. */
function mostRecentMonday(d: Date): Date {
  const out = new Date(d.getTime());
  const dow = out.getUTCDay(); // 0 = Sunday
  const back = (dow + 6) % 7;
  out.setUTCDate(out.getUTCDate() - back);
  out.setUTCHours(0, 0, 0, 0);
  return out;
}
