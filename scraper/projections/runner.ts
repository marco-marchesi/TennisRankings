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
  });

  // 3. Wipe the previous run for this tour's players. Done by playerId rather
  //    than tour-keyed so a single transactionless batch is fine.
  await db.delete(schema.liveProjections).where(inArray(schema.liveProjections.playerId, playerIds));

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
    const dropping = opts.tour === "atp"
      ? (snap.dropPoints ?? 0)
      : (derivedDropping.get(state.playerId) ?? 0);

    const projection = computeProjection({
      currentPoints: snap.points,
      droppingPoints: dropping,
      nextBestPoints: snap.nextBestPoints ?? 0,
      status: state.status,
      category: state.tournamentCategory ?? undefined,
      roundReached: state.roundReached ?? undefined,
    });

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

  return result;
}
