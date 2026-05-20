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
  };
  points: number;
  prevPoints: number | null;
  tournamentsPlayed: number | null;
  weekOf: string;
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

    const rows = await db
      .select({
        rank: schema.rankingsSnapshots.rank,
        prevRank: schema.rankingsSnapshots.prevRank,
        points: schema.rankingsSnapshots.points,
        prevPoints: schema.rankingsSnapshots.prevPoints,
        tournamentsPlayed: schema.rankingsSnapshots.tournamentsPlayed,
        weekOf: schema.rankingsSnapshots.weekOf,
        playerId: schema.players.id,
        slug: schema.players.slug,
        fullName: schema.players.fullName,
        countryCode: schema.players.countryCode,
        photoUrl: schema.players.photoUrl,
        plays: schema.players.plays,
      })
      .from(schema.rankingsSnapshots)
      .innerJoin(schema.players, eq(schema.rankingsSnapshots.playerId, schema.players.id))
      .where(
        and(
          eq(schema.rankingsSnapshots.tour, tour),
          eq(schema.rankingsSnapshots.weekOf, week),
          eq(schema.rankingsSnapshots.isRace, race),
          gte(schema.rankingsSnapshots.rank, 1),
        ),
      )
      .orderBy(schema.rankingsSnapshots.rank)
      .limit(limit);

    if (rows.length === 0) return mockTopRanked(tour, limit);

    return rows.map((r) => ({
      rank: r.rank,
      prevRank: r.prevRank,
      points: r.points,
      prevPoints: r.prevPoints,
      tournamentsPlayed: r.tournamentsPlayed,
      weekOf: String(r.weekOf),
      player: {
        id: r.playerId,
        slug: r.slug,
        fullName: r.fullName,
        countryCode: r.countryCode,
        photoUrl: r.photoUrl,
        plays: r.plays,
      },
    }));
  } catch {
    // DB unreachable — fall back to mock so dev/preview is never empty.
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
