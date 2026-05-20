import "server-only";
import { db, schema } from "@/db";
import { eq, ilike, sql } from "drizzle-orm";
import { mockTopRanked } from "./mock-data";

export interface PlayerDetail {
  id: number;
  slug: string;
  fullName: string;
  countryCode: string | null;
  dateOfBirth: string | null;
  height_cm: number | null;
  plays: "right" | "left" | "unknown" | null;
  turnedPro: number | null;
  photoUrl: string | null;
  photoAttribution: string | null;
  wikipediaUrl: string | null;
  bio: string | null;
  tour: "atp" | "wta" | "challenger" | "itf";
}

export async function getPlayerBySlug(slug: string): Promise<PlayerDetail | null> {
  try {
    const [p] = await db
      .select()
      .from(schema.players)
      .where(eq(schema.players.slug, slug))
      .limit(1);
    if (!p) return mockPlayer(slug);
    return {
      ...p,
      dateOfBirth: p.dateOfBirth as unknown as string | null,
    } as PlayerDetail;
  } catch {
    return mockPlayer(slug);
  }
}

export async function searchPlayers(q: string, limit = 8) {
  if (!q || q.length < 2) return [];
  try {
    const rows = await db
      .select({
        slug: schema.players.slug,
        fullName: schema.players.fullName,
        countryCode: schema.players.countryCode,
        tour: schema.players.tour,
        rank: sql<number | null>`(
          SELECT rank FROM ${schema.rankingsSnapshots} rs
          WHERE rs.player_id = ${schema.players.id}
            AND rs.is_race = false
          ORDER BY rs.week_of DESC LIMIT 1
        )`,
      })
      .from(schema.players)
      .where(ilike(schema.players.fullName, `%${q}%`))
      .limit(limit);
    if (rows.length > 0) return rows;
  } catch {
    /* fall through to mock */
  }
  // Mock fallback for dev/preview
  const all = [...mockTopRanked("atp", 10), ...mockTopRanked("wta", 10)];
  return all
    .filter((r) => r.player.fullName.toLowerCase().includes(q.toLowerCase()))
    .slice(0, limit)
    .map((r) => ({
      slug: r.player.slug,
      fullName: r.player.fullName,
      countryCode: r.player.countryCode,
      tour: r.rank > 100 ? "wta" : ("atp" as const),
      rank: r.rank,
    }));
}

export async function listAllPlayerSlugs(): Promise<Array<{ slug: string; updatedAt: Date }>> {
  try {
    const rows = await db
      .select({ slug: schema.players.slug, updatedAt: schema.players.updatedAt })
      .from(schema.players);
    if (rows.length > 0) return rows;
  } catch {
    /* fall through */
  }
  return [...mockTopRanked("atp", 10), ...mockTopRanked("wta", 10)].map((r) => ({
    slug: r.player.slug,
    updatedAt: new Date(),
  }));
}

function mockPlayer(slug: string): PlayerDetail | null {
  const all = [...mockTopRanked("atp", 10), ...mockTopRanked("wta", 10)];
  const hit = all.find((r) => r.player.slug === slug);
  if (!hit) return null;
  return {
    id: hit.player.id,
    slug: hit.player.slug,
    fullName: hit.player.fullName,
    countryCode: hit.player.countryCode,
    dateOfBirth: null,
    height_cm: null,
    plays: hit.player.plays,
    turnedPro: null,
    photoUrl: null,
    photoAttribution: null,
    wikipediaUrl: `https://en.wikipedia.org/wiki/${encodeURIComponent(hit.player.fullName)}`,
    bio: null,
    tour: hit.player.id < 100 ? "atp" : "wta",
  };
}
