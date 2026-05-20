import "server-only";
import { db, schema } from "@/db";
import { and, eq, lte, sql } from "drizzle-orm";

export interface ProjectionInput {
  currentRank: number;
  currentPoints: number;
  pointsExpiring: number;
  slug: string;
  fullName: string;
  countryCode: string | null;
}

/**
 * Pure projection math: subtract expiring points, re-sort, attach the
 * new rank to each row. Extracted so it can be unit-tested without a DB.
 */
export function computeProjection(
  input: ProjectionInput[],
  expiringWindow: 4 | 12,
): ProjectionRow[] {
  const stage1 = input.map((p) => ({
    ...p,
    projectedPoints: p.currentPoints - p.pointsExpiring,
  }));
  stage1.sort((a, b) => b.projectedPoints - a.projectedPoints);
  return stage1.map((p, i) => ({
    rank: p.currentRank,
    projectedRank: i + 1,
    player: { slug: p.slug, fullName: p.fullName, countryCode: p.countryCode },
    currentPoints: p.currentPoints,
    pointsExpiringIn4Weeks: expiringWindow === 4 ? p.pointsExpiring : 0,
    pointsExpiringIn12Weeks: expiringWindow === 12 ? p.pointsExpiring : 0,
    projectedPoints: p.projectedPoints,
  }));
}

export interface ProjectionRow {
  rank: number;
  player: { slug: string; fullName: string; countryCode: string | null };
  currentPoints: number;
  pointsExpiringIn4Weeks: number;
  pointsExpiringIn12Weeks: number;
  projectedPoints: number;
  projectedRank: number;
}

/**
 * "Projection" = where players will sit once the next round of expiring
 * points falls off the rolling 52-week window. This is the killer
 * feature live-tennis.eu monetises poorly.
 *
 * Algorithm (real version, phase 2):
 *   1. For each player in current top N: sum points expiring in the
 *      window (next 4 / 12 weeks) from `player_points_breakdown`.
 *   2. Subtract expiring from current points → projected points.
 *   3. Re-sort by projected points → projected rank.
 *
 * Below we return a deterministic stub when no breakdown data is loaded
 * yet, so the page renders the moment the scraper imports rankings.
 */
export async function getProjection(tour: "atp" | "wta", weeksAhead: 4 | 12 = 4): Promise<ProjectionRow[]> {
  try {
    const latest = await db
      .select({ w: sql<string>`max(${schema.rankingsSnapshots.weekOf})` })
      .from(schema.rankingsSnapshots)
      .where(eq(schema.rankingsSnapshots.tour, tour));
    const weekOf = latest[0]?.w;
    if (!weekOf) return [];

    const cutoff = new Date(weekOf);
    cutoff.setDate(cutoff.getDate() + weeksAhead * 7);

    const rows = await db
      .select({
        rank: schema.rankingsSnapshots.rank,
        points: schema.rankingsSnapshots.points,
        playerId: schema.players.id,
        slug: schema.players.slug,
        fullName: schema.players.fullName,
        countryCode: schema.players.countryCode,
        expiringSoon: sql<number>`COALESCE(SUM(CASE WHEN ${schema.playerPointsBreakdown.expiresWeekOf} <= ${cutoff.toISOString().slice(0, 10)} THEN ${schema.playerPointsBreakdown.points} ELSE 0 END), 0)`,
      })
      .from(schema.rankingsSnapshots)
      .innerJoin(schema.players, eq(schema.rankingsSnapshots.playerId, schema.players.id))
      .leftJoin(
        schema.playerPointsBreakdown,
        eq(schema.playerPointsBreakdown.playerId, schema.players.id),
      )
      .where(
        and(
          eq(schema.rankingsSnapshots.tour, tour),
          eq(schema.rankingsSnapshots.weekOf, weekOf),
          lte(schema.rankingsSnapshots.rank, 100),
        ),
      )
      .groupBy(
        schema.rankingsSnapshots.rank,
        schema.rankingsSnapshots.points,
        schema.players.id,
        schema.players.slug,
        schema.players.fullName,
        schema.players.countryCode,
      )
      .orderBy(schema.rankingsSnapshots.rank);

    return computeProjection(
      rows.map((r) => ({
        currentRank: r.rank,
        currentPoints: r.points,
        pointsExpiring: Number(r.expiringSoon ?? 0),
        slug: r.slug,
        fullName: r.fullName,
        countryCode: r.countryCode,
      })),
      weeksAhead,
    );
  } catch {
    return [];
  }
}
