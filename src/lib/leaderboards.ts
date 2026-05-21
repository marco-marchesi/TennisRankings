import "server-only";
import { db, schema } from "@/db";
import { and, asc, eq } from "drizzle-orm";

export type LeaderboardTour = "atp" | "wta";
export type LeaderboardCategory = "serve" | "return" | "rally" | "winners_errors";

export interface LeaderboardEntry {
  rank: number;
  playerName: string;
  playerSlug: string | null;
  countryCode: string | null;
  matches: number | null;
  stats: Record<string, number | null>;
}

export async function getLeaderboard(
  tour: LeaderboardTour,
  category: LeaderboardCategory,
): Promise<LeaderboardEntry[]> {
  try {
    const rows = await db
      .select({
        rank: schema.leaderboards.rank,
        playerName: schema.leaderboards.playerName,
        playerSlug: schema.leaderboards.playerSlug,
        countryCode: schema.leaderboards.countryCode,
        matches: schema.leaderboards.matches,
        stats: schema.leaderboards.stats,
      })
      .from(schema.leaderboards)
      .where(
        and(
          eq(schema.leaderboards.tour, tour),
          eq(schema.leaderboards.category, category),
          eq(schema.leaderboards.windowKey, "last_52"),
        ),
      )
      .orderBy(asc(schema.leaderboards.rank));
    return rows.map((r) => ({
      rank: r.rank,
      playerName: r.playerName,
      playerSlug: r.playerSlug,
      countryCode: r.countryCode,
      matches: r.matches,
      stats: (r.stats as Record<string, number | null>) ?? {},
    }));
  } catch {
    return [];
  }
}
