// Computes "dropping points" for each player — the count that will roll off
// their 52-week rolling-sum window on next Monday's publish.
//
// Source: `player_recent_matches` (Tennis Abstract). For each player, find
// tournaments that started ~52 weeks ago, identify the deepest round they
// reached, look up the corresponding points, and sum across tournaments.
//
// Used as a fallback to `rankings_snapshots.drop_points` (which is the
// ATP-published value, captured directly during refresh). WTA's rankings
// page doesn't expose this column, so for WTA players we always rely on this
// derivation; for ATP we prefer the published value when present.
//
// Known approximations:
//   - We assume EVERY result counts (not "best 18 + 4 mandatory"). For top
//     players who play more than 22 events, this slightly overestimates the
//     drop. For ranks ~30+, the approximation is exact.
//   - Tournament category inference falls back to a default tier when level
//     code is ambiguous — see category-inference.ts for the rules.

import { db } from "@/db";
import { sql } from "drizzle-orm";
import { ROUNDS_IN_ORDER, canonicalizeRound, pointsForRound, type Round } from "../config/points-table";
import { inferCategory } from "./category-inference";

interface Options {
  tour: "atp" | "wta";
  playerIds: number[];
}

/**
 * Returns a map of playerId → dropping points (always ≥ 0).
 * Players with no matches in the dropping window get 0.
 */
export async function deriveDroppingPoints(opts: Options): Promise<Map<number, number>> {
  const result = new Map<number, number>();
  if (opts.playerIds.length === 0) return result;

  // WHAT DROPS THIS WEEK
  //
  // A result drops when the next edition of that event begins. So the events
  // dropping now are the ones being PLAYED now — and a player drops last
  // year's points there whether or not they entered this year (Sinner is not
  // in the 2026 US Open draw but still loses his 2025 final's 1,300).
  //
  // The previous implementation took every match in a flat 14-day window
  // centred 364 days back. That failed badly, because Tennis Abstract stamps
  // every match at an event with the TOURNAMENT START date: the 2025 US Open
  // is dated 2025-08-25, which sits outside the window
  // [2025-08-28 .. 2025-09-11] computed on 2026-09-03. Sabalenka's title
  // defence was therefore invisible, and since the WTA publishes no
  // drop_points column this derivation is the ONLY source for that tour.
  //
  // Verified against live-tennis.eu's live ranking:
  //   Sabalenka  8575 - 2000 + 130 = 6705  (2025 US Open champion)
  //   Anisimova  4533 - 1300 +  70 = 3303  (2025 US Open finalist)
  // Both exact.
  //
  // So: find the events with matches in the current ranking week, then charge
  // each player their result at the same event one year ago.
  const today = new Date();
  const weekStart = isoDate(mostRecentMonday(today));

  // Names must be compared NORMALIZED, never as raw strings.
  //
  // Tennis Abstract writes "Us Open"; TennisExplorer writes "US Open". A pure
  // casing difference between the two feeds silently zeroed every dropping
  // calculation, and because the WTA publishes no drop_points column that
  // made the entire WTA live ranking wrong — Sabalenka appeared 1,940 points
  // too high because her 2025 US Open title never registered as dropping.
  //
  // The same normalisation also bridges the tier suffixes the feeds disagree
  // on: TA "Rome Masters" vs TE "Rome", TA "Cincinnati" (WTA) vs TE
  // "Cincinnati WTA".
  const NORM = (col: string) =>
    sql.raw(
      `regexp_replace(regexp_replace(lower(${col}), '\s+(masters|wta|atp|itf|challenger)\b.*$', ''), '\s+', ' ', 'g')`,
    );

  const eventsNow = await db.execute<{ tournament_name: string }>(sql`
    select distinct ${NORM("prm.tournament_name")} as tournament_name
    from player_recent_matches prm
    join players p on p.id = prm.player_id
    where p.tour = ${opts.tour}
      and prm.played_on >= ${weekStart}
  `);
  const eventRows =
    (eventsNow as unknown as { rows: Array<Record<string, unknown>> }).rows ??
    (eventsNow as unknown as Array<Record<string, unknown>>);
  const currentEventNames = eventRows
    .map((r) => String(r.tournament_name))
    .filter((n) => n && n !== "—");

  if (currentEventNames.length === 0) return result;

  // A year ago, generously bracketed: editions move by up to a few weeks
  // between years, and the stored date may be the tournament start rather
  // than the match date.
  const lo = isoDate(addDays(today, -400));
  const hi = isoDate(addDays(today, -330));

  // DISTINCT ON dedups the same logical match if both TA and TE wrote rows
  // for it — preferring TE via the source-CASE tiebreak. Keyed on
  // (tournament, round, opponent) rather than on played_on, because the two
  // sources disagree about the date: TA stores the tournament start, TE the
  // real match date, so a date-based key can never collide.
  const raw = await db.execute<{
    player_id: number;
    tournament_name: string;
    tournament_level: string | null;
    round: string;
    won: boolean;
    played_on: string;
  }>(sql`
    select distinct on (
      prm.player_id, prm.tournament_name, prm.round, lower(prm.opponent_name)
    )
      prm.player_id, prm.tournament_name, prm.tournament_level,
      prm.round, prm.won, prm.played_on
    from player_recent_matches prm
    where prm.player_id = any(array[${sql.join(opts.playerIds.map((id) => sql`${id}`), sql`, `)}]::int[])
      and prm.played_on >= ${lo}
      and prm.played_on <= ${hi}
      and ${NORM("prm.tournament_name")} = any(array[${sql.join(
        currentEventNames.map((n) => sql`${n}`),
        sql`, `,
      )}]::text[])
    order by prm.player_id, prm.tournament_name, prm.round,
             lower(prm.opponent_name),
             case prm.source when 'atp_site' then 0 when 'tennis_explorer' then 1 else 2 end
  `);
  const rawRows =
    (raw as unknown as { rows: Array<Record<string, unknown>> }).rows ??
    (raw as unknown as Array<Record<string, unknown>>);
  const rows = rawRows.map((r) => ({
    playerId: Number(r.player_id),
    tournamentName: String(r.tournament_name),
    tournamentLevel: (r.tournament_level as string | null) ?? null,
    round: String(r.round),
    won: Boolean(r.won),
    playedOn: String(r.played_on),
  }));

  // Group by (player, tournament_name). Each group is the player's matches at
  // that tournament. The deepest match tells us how many points they earned.
  type Key = string;
  const groups = new Map<Key, typeof rows>();
  for (const r of rows) {
    const key = `${r.playerId}::${r.tournamentName}`;
    const existing = groups.get(key);
    if (existing) existing.push(r);
    else groups.set(key, [r]);
  }

  for (const matches of groups.values()) {
    const first = matches[0]!;
    const category = inferCategory(opts.tour, first.tournamentName, first.tournamentLevel);
    const earned = earnedAtTournament(matches.map((m) => ({ round: m.round, won: m.won })), category);
    if (earned === 0) continue;
    const prior = result.get(first.playerId) ?? 0;
    result.set(first.playerId, prior + earned);
  }

  return result;
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
