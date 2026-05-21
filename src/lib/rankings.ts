import "server-only";
import { db, schema } from "@/db";
import { and, desc, eq, gte, sql } from "drizzle-orm";
import type { Tour } from "./constants";
import { mockTopRanked } from "@/lib/mock-data";

export interface RankingRow {
  rank: number;
  prevRank: number | null;
  player: {
    id: number;
    slug: string;
    fullName: string;
    countryCode: string | null;
    photoUrl: string | null;
    plays: "right" | "left" | "unknown" | null;
    dateOfBirth: string | null;
  };
  points: number;
  prevPoints: number | null;
  tournamentsPlayed: number | null;
  weekOf: string;
  /** Rank within their nationality at this snapshot week (1 = top from country). */
  nationalRank: number | null;
  /** Player's best (lowest-numbered) rank across all weekly snapshots in DB. */
  careerHighRank: number | null;
  /** Projected rank for the upcoming Monday publish (== rank when no projection exists). */
  projectedRank: number;
  /** Projected points total at next publish (== points when no projection exists). */
  projectedPoints: number;
  /** Projection columns — null when no live projection exists for this player. */
  projection: {
    status: "in_progress" | "eliminated" | "won_tournament" | "not_playing";
    tournamentName: string;
    pointsDelta: number;
    nextPoints: number | null;
    maxPossiblePoints: number | null;
    roundReached: string;
  } | null;
}

interface GetTopRankedInput {
  tour: Tour;
  limit?: number;
  weekOf?: string;
  race?: boolean;
}

export async function getTopRanked({
  tour,
  limit = 100,
  weekOf,
  race = false,
}: GetTopRankedInput): Promise<RankingRow[]> {
  try {
    const week =
      weekOf ??
      (await db
        .select({ w: sql<string>`max(${schema.rankingsSnapshots.weekOf})` })
        .from(schema.rankingsSnapshots)
        .where(
          and(
            eq(schema.rankingsSnapshots.tour, tour),
            eq(schema.rankingsSnapshots.isRace, race),
          ),
        )
        .then((rows) => rows[0]?.w));

    if (!week) return mockTopRanked(tour, limit);

    // One query that gives us everything: the current week's snapshot joined to
    // players, with national rank computed via a window function and career
    // high computed via a correlated subquery over the snapshots table.
    const rows = await db.execute<{
      rank: number;
      prev_rank: number | null;
      points: number;
      prev_points: number | null;
      tournaments_played: number | null;
      week_of: string;
      player_id: number;
      slug: string;
      full_name: string;
      country_code: string | null;
      photo_url: string | null;
      plays: "right" | "left" | "unknown" | null;
      date_of_birth: string | null;
      national_rank: number | null;
      career_high_rank: number | null;
      projected_rank: number;
      projected_points: number;
      proj_status: string | null;
      proj_tournament_name: string | null;
      proj_points_delta: number | null;
      proj_next_points: number | null;
      proj_max_points: number | null;
      proj_round_reached: string | null;
    }>(sql`
      with current_week as (
        select rs.*
        from rankings_snapshots rs
        where rs.tour = ${tour}
          and rs.week_of = ${week}
          and rs.is_race = ${race}
      ),
      with_national as (
        select
          cw.*,
          row_number() over (
            partition by p.country_code
            order by cw.rank
          ) as national_rank
        from current_week cw
        join players p on p.id = cw.player_id
        where p.country_code is not null
      ),
      all_rows as (
        select cw.*, null::int as national_rank
        from current_week cw
        join players p on p.id = cw.player_id
        where p.country_code is null
        union all
        select * from with_national
      )
      select
        ar.rank,
        ar.prev_rank,
        ar.points,
        ar.prev_points,
        -- ATP's Race rankings page doesn't expose a "tournaments played"
        -- column, so rankings_snapshots.tournaments_played is null for ATP
        -- race rows. Fall back to a YTD count of distinct tournaments from
        -- player_recent_matches. Returns null for players we haven't
        -- backfilled matches for (i.e. outside the top-50).
        coalesce(
          ar.tournaments_played,
          (
            select count(distinct prm.tournament_name)
            from player_recent_matches prm
            where prm.player_id = p.id
              and prm.played_on >= date_trunc('year', current_date)
          )
        ) as tournaments_played,
        ar.week_of,
        p.id as player_id,
        p.slug,
        p.full_name,
        p.country_code,
        p.photo_url,
        p.plays,
        p.date_of_birth,
        ar.national_rank,
        (
          select min(rs2.rank)
          from rankings_snapshots rs2
          where rs2.player_id = p.id and rs2.tour = ${tour} and rs2.is_race = false
        ) as career_high_rank,
        lp.status as proj_status,
        lp.tournament_name as proj_tournament_name,
        lp.points_delta as proj_points_delta,
        lp.next_points as proj_next_points,
        lp.max_possible_points as proj_max_points,
        lp.round_reached as proj_round_reached,
        coalesce(lp.next_points, ar.points) as projected_points,
        row_number() over (order by coalesce(lp.next_points, ar.points) desc) as projected_rank
      from all_rows ar
      join players p on p.id = ar.player_id
      left join live_projections lp on lp.player_id = p.id
      where ar.rank >= 1
      order by coalesce(lp.next_points, ar.points) desc
      limit ${limit};
    `);

    const result = (rows as unknown as { rows: Record<string, unknown>[] }).rows ?? (rows as unknown as Record<string, unknown>[]);
    if (!Array.isArray(result) || result.length === 0) return mockTopRanked(tour, limit);

    return result.map((r) => ({
      rank: Number(r.rank),
      prevRank: r.prev_rank == null ? null : Number(r.prev_rank),
      points: Number(r.points),
      prevPoints: r.prev_points == null ? null : Number(r.prev_points),
      tournamentsPlayed: r.tournaments_played == null ? null : Number(r.tournaments_played),
      weekOf: String(r.week_of),
      player: {
        id: Number(r.player_id),
        slug: String(r.slug),
        fullName: String(r.full_name),
        countryCode: (r.country_code as string | null) ?? null,
        photoUrl: (r.photo_url as string | null) ?? null,
        plays: (r.plays as "right" | "left" | "unknown" | null) ?? null,
        dateOfBirth: r.date_of_birth == null ? null : String(r.date_of_birth),
      },
      nationalRank: r.national_rank == null ? null : Number(r.national_rank),
      careerHighRank: r.career_high_rank == null ? null : Number(r.career_high_rank),
      projectedRank: Number(r.projected_rank),
      projectedPoints: Number(r.projected_points),
      projection:
        r.proj_status == null
          ? null
          : {
              status: String(r.proj_status) as "in_progress" | "eliminated" | "won_tournament" | "not_playing",
              tournamentName: String(r.proj_tournament_name ?? ""),
              pointsDelta: Number(r.proj_points_delta),
              nextPoints: r.proj_next_points == null ? null : Number(r.proj_next_points),
              maxPossiblePoints: r.proj_max_points == null ? null : Number(r.proj_max_points),
              roundReached: String(r.proj_round_reached ?? ""),
            },
    }));
  } catch (err) {
    // DB unreachable — fall back to mock so dev/preview is never empty.
    // eslint-disable-next-line no-console
    console.warn("getTopRanked failed, falling back to mock:", err);
    return mockTopRanked(tour, limit);
  }
}

export async function getPlayerRankingHistory(slug: string) {
  try {
    const rows = await db
      .select({
        weekOf: schema.rankingsSnapshots.weekOf,
        rank: schema.rankingsSnapshots.rank,
        points: schema.rankingsSnapshots.points,
      })
      .from(schema.rankingsSnapshots)
      .innerJoin(schema.players, eq(schema.rankingsSnapshots.playerId, schema.players.id))
      .where(and(eq(schema.players.slug, slug), eq(schema.rankingsSnapshots.isRace, false)))
      .orderBy(desc(schema.rankingsSnapshots.weekOf))
      .limit(260); // ~5 years of weekly data
    return rows;
  } catch {
    return [];
  }
}

