// Computes the live-projection table for every top-N player on a tour, using:
//   - Official + dropping points from rankings_snapshots (captured directly
//     from atptour.com's Dropping column during refresh).
//   - Each player's current tournament state derived from recent matches
//     (Tennis Abstract data via player_recent_matches).
//
// Idempotent: re-running for a tour wipes that tour's projections and writes
// fresh ones. Players who aren't currently playing don't get a row — UI
// treats absence as "no projection".

import { db, schema } from "@/db";
import { and, eq, inArray, sql } from "drizzle-orm";
import { computeProjection } from "./calculator";
import { deriveLiveStates } from "./derive-live-state";
import { deriveDroppingPoints } from "./derive-dropping-points";
import { deriveLivePoints } from "./derive-live-points";
import { currentEditions } from "./derive-dropping-points";
import { currentWeekStart, deriveWeekEvents } from "./derive-week-events";
import { inferCategory } from "./category-inference";
import { cityKey, wtaBreakdown, wtaLiveDelta, type LiveResult, type WtaBreakdown } from "./wta-best-n";
import { itfTierFromPrize, loadWtaPlayerEvents, teItfPrize, type WtaEvent } from "../sources/wta-player-events";
import { addDays } from "./drop-horizon";
import { pointsForRound, type Category } from "../config/points-table";

/** Results the WTA counts whatever they are worth (wta-best-n.ts). */
function isMandatoryCategory(c: Category): boolean {
  return c === "wta_grand_slam" || c === "wta_1000" || c === "finals";
}

export interface ProjectionRunResult {
  tour: "atp" | "wta";
  candidatesScanned: number;
  notPlaying: number;
  inProgress: number;
  eliminated: number;
  wonTournament: number;
  skipped: { fullName: string; reason: string }[];
}

interface RunOptions {
  tour: "atp" | "wta";
  topN: number;
  /** Days back to look for "current week" matches. Default 7. */
  lookbackDays?: number;
}

export async function runProjections(opts: RunOptions): Promise<ProjectionRunResult> {
  const result: ProjectionRunResult = {
    tour: opts.tour,
    candidatesScanned: 0,
    notPlaying: 0,
    inProgress: 0,
    eliminated: 0,
    wonTournament: 0,
    skipped: [],
  };

  // 1. Derive live state for each top-N player.
  const liveStates = await deriveLiveStates({
    tour: opts.tour,
    topN: opts.topN,
    lookbackDays: opts.lookbackDays,
  });
  result.candidatesScanned = liveStates.length;

  // 2. Pull current points + dropping points from the latest settled snapshot
  //    for every player we're scoring.
  const playerIds = liveStates.map((s) => s.playerId);
  if (playerIds.length === 0) return result;

  const snapshotRows = await db
    .select({
      playerId: schema.rankingsSnapshots.playerId,
      points: schema.rankingsSnapshots.points,
      dropPoints: schema.rankingsSnapshots.dropPoints,
      nextBestPoints: schema.rankingsSnapshots.nextBestPoints,
      rank: schema.rankingsSnapshots.rank,
    })
    .from(schema.rankingsSnapshots)
    .where(
      and(
        eq(schema.rankingsSnapshots.tour, opts.tour),
        eq(schema.rankingsSnapshots.isRace, false),
        eq(
          schema.rankingsSnapshots.weekOf,
          sql`(select max(week_of) from rankings_snapshots where tour = ${opts.tour} and is_race = false)`,
        ),
        inArray(schema.rankingsSnapshots.playerId, playerIds),
      ),
    );
  const byPlayer = new Map(snapshotRows.map((r) => [r.playerId, r]));

  // 2b. Derive dropping points from match history. Used as fallback when the
  //     scraped value is null (always for WTA; sometimes for ATP qualifiers).
  const derivedDropping = await deriveDroppingPoints({
    tour: opts.tour,
    playerIds,
    // ATP: the published column covers next Monday; derive only what a
    // two-week event adds beyond it.
    beyondNextMonday: opts.tour === "atp",
  });

  // 2c. Everything each player has secured this week, event by event
  //     (qualifying, a second event, lucky losers - derive-week-events.ts).
  const weekStart = currentWeekStart();
  const editions = await currentEditions(opts.tour, weekStart);
  // A Slam or 1000 whose MAIN DRAW is under way this week: what drops is a
  // mandatory result, whose slot the new edition fills - no next-best
  // promotion (see below). Main-draw matches only, so next week's Masters
  // qualifying on the weekend does not count.
  const mdRows = await db.execute(sql`
    select distinct prm.tournament_name, prm.tournament_level
    from player_recent_matches prm join players p on p.id = prm.player_id
    where p.tour = ${opts.tour} and prm.round !~ '^Q[-0-9]'
      and prm.played_on >= ${weekStart}::date and prm.played_on < ${weekStart}::date + 7
  `);
  const mandatoryWeek = ((((mdRows as unknown) as { rows?: Array<Record<string, unknown>> }).rows ??
    ((mdRows as unknown) as Array<Record<string, unknown>>))).some((r) => {
    const c = inferCategory(opts.tour, String(r.tournament_name), (r.tournament_level as string | null) ?? null);
    return c === "grand_slam" || c === "masters_1000";
  });

  // WTA: each player's official breakdown, for the best-18 rule.
  const breakdowns = new Map<number, WtaBreakdown>();
  let itfTier: ((name: string) => string | null) | undefined;
  if (opts.tour === "wta") {
    const idRows = await db.execute(sql`
      select id, wta_id from players
      where id = any(array[${sql.join(playerIds.map((id) => sql`${id}`), sql`, `)}]::int[])
        and wta_id is not null
    `);
    const ids = (((idRows as unknown) as { rows?: Array<Record<string, unknown>> }).rows ??
      ((idRows as unknown) as Array<Record<string, unknown>>)).map((r) => ({
      playerId: Number(r.id),
      wtaId: String(r.wta_id),
    }));
    const weekOf = String(
      (await db.execute(sql`select max(week_of)::text as w from rankings_snapshots where tour = 'wta' and is_race = false`) as unknown as {
        rows: Array<{ w: string }>;
      }).rows[0]!.w,
    );
    const events = await loadWtaPlayerEvents(
      ids.map((i) => i.wtaId),
      weekOf,
      addDays(weekStart, -430),
    );
    // Tour events on now, keyed as wtaBreakdown expects: by WTA tournament
    // number, from the wta_api rows.
    const current = new Map<string, string | null>();
    const nbrRows = await db.execute(sql`
      select split_part(external_tourney_id, '-', 2) as nbr,
             (min(played_on) filter (where round !~ '^Q[-0-9]'))::text as md
      from player_recent_matches
      where source = 'wta_api' and played_on >= ${weekStart}::date - 21
      group by 1
      having max(played_on) >= ${weekStart}::date
    `);
    for (const r of (((nbrRows as unknown) as { rows?: Array<Record<string, unknown>> }).rows ??
      ((nbrRows as unknown) as Array<Record<string, unknown>>))) {
      current.set(String(r.nbr), (r.md as string | null) ?? null);
    }
    // Prize money of each ITF event by city, newest edition first.
    const itfPrize = new Map<string, { year: number; prize: number | null }>();
    for (const list of events.values()) {
      for (const e of list as WtaEvent[]) {
        if (e.level !== "ITF") continue;
        const k = cityKey(e.name);
        const prev = itfPrize.get(k);
        if (!prev || e.year > prev.year) itfPrize.set(k, { year: e.year, prize: e.prize });
      }
    }
    // This week's ITF events, priced from their TennisExplorer page first.
    const itfNow = await db.execute(sql`
      select distinct tournament_name, external_tourney_id from player_recent_matches
      where source = 'tennis_explorer' and tournament_level = 'ITF'
        and played_on >= ${weekStart}::date - 3
    `);
    const tePrize = new Map<string, number | null>();
    for (const r of (((itfNow as unknown) as { rows?: Array<Record<string, unknown>> }).rows ??
      ((itfNow as unknown) as Array<Record<string, unknown>>))) {
      if (!r.external_tourney_id) continue;
      tePrize.set(cityKey(String(r.tournament_name)), await teItfPrize(String(r.external_tourney_id)));
    }
    itfTier = (name) =>
      itfTierFromPrize(tePrize.get(cityKey(name)) ?? itfPrize.get(cityKey(name))?.prize ?? null);
    for (const { playerId, wtaId } of ids) {
      const list = events.get(wtaId);
      if (!list || list.length === 0) continue;
      breakdowns.set(playerId, wtaBreakdown(list, { weekStart, horizon: editions.horizon, current }));
    }
  }
  const weekEvents = await deriveWeekEvents({ tour: opts.tour, playerIds, itfTier });

  // 3. Wipe the previous run for this ENTIRE tour, not just the players we are
  //    about to rewrite. Deleting only `playerIds` (the current top-N) left a
  //    frozen row behind for anyone who dropped out of the top-N, and
  //    src/lib/rankings.ts prefers lp.next_points over the settled points
  //    whenever a row exists — so a stale projection outranked live data
  //    indefinitely.
  await db.execute(sql`
    delete from live_projections
    where player_id in (select id from players where tour = ${opts.tour})
  `);

  // 4. Compute + write per-player projections.
  for (const state of liveStates) {
    const snap = byPlayer.get(state.playerId);
    if (!snap) {
      result.skipped.push({ fullName: `playerId=${state.playerId}`, reason: "no settled snapshot" });
      continue;
    }

    if (state.status === "in_progress") result.inProgress++;
    else if (state.status === "eliminated") result.eliminated++;
    else if (state.status === "won_tournament") result.wonTournament++;
    else if (state.status === "not_playing") result.notPlaying++;

    // not_playing rows still get persisted: their delta = -dropping (modulo
    // nextBest) and the UI uses these rows to project rank movement across
    // the table. Skipping them would leave gaps in the "live ranking" view.
    // Dropping-points source of truth depends on the tour:
    //
    //   ATP: take rankings_snapshots.drop_points exactly. ATP publishes "-"
    //   for players with nothing rolling off (we store that as null) and a
    //   number for everyone else. The "-" case must NOT trigger our history
    //   derivation — because the major-tournament rolloff rule (points stay
    //   until the next edition starts) means a player who reached RG-F last
    //   May has 1300 points still counted, and they only drop when RG starts
    //   the following year, not on a flat 52-week timer.
    //
    //   WTA: rankings_snapshots.drop_points is always null (the WTA HTML
    //   doesn't publish this column). Use the history-derived value as the
    //   best approximation. Known caveat: this overestimates for Slam-result
    //   roll-offs that haven't reached their next edition yet.
    //   ATP beyond next Monday: during the first week of a two-week Masters
    //   the live ranking already drops last year's edition, which ATP's
    //   column will only show a week later. That extension is derived and
    //   added (deriveDroppingPoints with beyondNextMonday).
    let dropping = opts.tour === "atp"
      ? (snap.dropPoints ?? 0) + (derivedDropping.get(state.playerId) ?? 0)
      : (derivedDropping.get(state.playerId) ?? 0);

    // This week's results. A player drawn into an event of THIS week who has
    // not played yet is credited its first-round value (live-tennis.eu
    // credits Gauff 10 before her Beijing 2026 opener); derive-live-state
    // only reports an upcoming event when it falls inside the week.
    const events = weekEvents.get(state.playerId) ?? [];
    const thisWeek: LiveResult[] = events.map((e) => ({ points: e.points, mandatory: isMandatoryCategory(e.category) }));
    if (events.length === 0 && state.status === "in_progress" && state.tournamentCategory && state.roundReached) {
      thisWeek.push({
        points: pointsForRound(state.tournamentCategory, state.roundReached),
        mandatory: isMandatoryCategory(state.tournamentCategory),
      });
    }
    const earned = thisWeek.reduce((a, b) => a + b.points, 0);
    const playedMainDraw = events.some((e) => e.mainDraw);

    let delta: number;
    const bd = breakdowns.get(state.playerId);
    if (bd) {
      dropping = bd.dropped.reduce((a, e) => a + e.points, 0);
      delta = wtaLiveDelta(bd, thisWeek, snap.points);
    } else if (
      opts.tour === "atp" && (snap.dropPoints ?? 0) > 0 && (snap.nextBestPoints ?? 0) > 0 &&
      !mandatoryWeek && !playedMainDraw
    ) {
      // Best-of-N on the ATP: when a non-mandatory result drops, the best
      // result outside the counted set (the published Next Best) takes its
      // slot unless this week's result is better. live-tennis.eu, 2026-10-31:
      //   Kecmanovic  -50 + max(0, 13)  = -37
      //   Marozsan    -10 + max(13, 25) = +15
      //   Dzumhur     -40 + max(0, 7)   = -33
      // Not for a Slam or 1000: that slot is mandatory and the new edition
      // fills it (Auger-Aliassime, Zverev: +50 / +40 too high when promoted).
      // Nor for a player who reached a main draw this week: the new result
      // takes the freed slot even when it is worth 0 (F. Cerundolo, lost
      // Vienna R32: -100, not -100 + 50; Etcheverry, Bergs likewise).
      delta = Math.max(earned, snap.nextBestPoints ?? 0) - dropping;
    } else {
      delta = earned - dropping;
    }

    const projection = computeProjection({
      currentPoints: snap.points,
      droppingPoints: dropping,
      nextBestPoints: snap.nextBestPoints ?? 0,
      status: state.status,
      category: state.tournamentCategory ?? undefined,
      roundReached: state.roundReached ?? undefined,
    });

    projection.pointsDelta = delta;
    projection.nextPoints = snap.points + delta;

    await db.insert(schema.liveProjections).values({
      playerId: state.playerId,
      status: state.status,
      // For not_playing, we still need values for the NOT NULL columns —
      // mark them with sentinel strings so DB queries can filter them out
      // when grouping projections by tournament.
      tournamentName: state.tournamentName ?? "(not playing)",
      tournamentCategory: state.tournamentCategory ?? "atp_250",
      roundReached: state.roundReached ?? "-",
      pointsBeingDefended: dropping,
      pointsDelta: projection.pointsDelta,
      nextPoints: projection.nextPoints,
      maxPossiblePoints: projection.maxPossiblePoints,
      nextRank: null,
      maxPossibleRank: null,
      computedAt: new Date(),
    });
  }

  // 5. Backfill projected ranks for the rows we wrote. For each projection,
  //    next_rank = 1 + count(players in same tour with settled points > my
  //    next_points). Approximation: treats every OTHER player's points as
  //    static — fine for the snapshot-vs-projection comparison we want.
  await db.execute(sql`
    update live_projections lp
    set
      next_rank = (
        case when lp.next_points is null then null else
          1 + (
            select count(*) from rankings_snapshots rs
            join players p2 on p2.id = rs.player_id
            where rs.week_of = (select max(week_of) from rankings_snapshots where tour = ${opts.tour} and is_race = false)
              and rs.is_race = false
              and p2.tour = ${opts.tour}
              and rs.points > lp.next_points
          )
        end
      ),
      max_possible_rank = (
        case when lp.max_possible_points is null then null else
          1 + (
            select count(*) from rankings_snapshots rs
            join players p2 on p2.id = rs.player_id
            where rs.week_of = (select max(week_of) from rankings_snapshots where tour = ${opts.tour} and is_race = false)
              and rs.is_race = false
              and p2.tour = ${opts.tour}
              and rs.points > lp.max_possible_points
          )
        end
      )
    from players p
    where lp.player_id = p.id and p.tour = ${opts.tour};
  `);

  // 6. Live points / rank (and race equivalents). This is independent of
  //    the projection math above — it's a pure restatement of what the
  //    settled snapshot WOULD be if today's in-week match points were
  //    already published. Matches the semantics of live-tennis.eu's
  //    /en/atp-live-ranking page. Persisted to the same live_projections
  //    row via UPDATE since we only need to add columns to existing rows.
  const livePointsRows = await deriveLivePoints({
    tour: opts.tour,
    topN: Math.max(opts.topN, 200),
  });
  for (const r of livePointsRows) {
    await db.execute(sql`
      update live_projections set
        live_points = ${r.livePoints},
        live_rank = ${r.liveRank},
        live_race_points = ${r.liveRacePoints},
        live_race_rank = ${r.liveRaceRank},
        live_rank_change = ${r.liveRankChange}
      where player_id = ${r.playerId}
    `);
  }

  return result;
}
