import "server-only";
import { db, schema } from "@/db";
import { and, eq, or, sql } from "drizzle-orm";

export interface H2HRecord {
  total: { wins: number; losses: number };
  bySurface: Record<string, { wins: number; losses: number }>;
  matches: Array<{
    playedOn: string | null;
    tournament: string;
    surface: string;
    round: string;
    score: string | null;
    winnerSlug: string;
  }>;
}

export async function getHeadToHead(
  aSlug: string,
  bSlug: string,
): Promise<H2HRecord> {
  try {
    const [a] = await db
      .select({ id: schema.players.id, slug: schema.players.slug })
      .from(schema.players)
      .where(eq(schema.players.slug, aSlug))
      .limit(1);
    const [b] = await db
      .select({ id: schema.players.id, slug: schema.players.slug })
      .from(schema.players)
      .where(eq(schema.players.slug, bSlug))
      .limit(1);
    if (!a || !b) return empty();

    const rows = await db
      .select({
        playedOn: schema.matches.playedOn,
        round: schema.matches.round,
        score: schema.matches.score,
        winnerId: schema.matches.winnerPlayerId,
        tName: schema.tournaments.name,
        surface: schema.tournaments.surface,
      })
      .from(schema.matches)
      .innerJoin(
        schema.tournamentEditions,
        eq(schema.matches.editionId, schema.tournamentEditions.id),
      )
      .innerJoin(
        schema.tournaments,
        eq(schema.tournamentEditions.tournamentId, schema.tournaments.id),
      )
      .where(
        or(
          and(eq(schema.matches.playerAId, a.id), eq(schema.matches.playerBId, b.id)),
          and(eq(schema.matches.playerAId, b.id), eq(schema.matches.playerBId, a.id)),
        ),
      )
      .orderBy(sql`played_on DESC NULLS LAST`);

    const out: H2HRecord = empty();
    for (const m of rows) {
      const winnerSlug = m.winnerId === a.id ? a.slug : b.slug;
      const won = winnerSlug === a.slug;
      out.total.wins += won ? 1 : 0;
      out.total.losses += won ? 0 : 1;
      const s = m.surface;
      out.bySurface[s] ??= { wins: 0, losses: 0 };
      out.bySurface[s][won ? "wins" : "losses"]++;
      out.matches.push({
        playedOn: m.playedOn as unknown as string | null,
        tournament: m.tName,
        surface: m.surface,
        round: m.round,
        score: m.score,
        winnerSlug,
      });
    }
    return out;
  } catch {
    return empty();
  }
}

function empty(): H2HRecord {
  return { total: { wins: 0, losses: 0 }, bySurface: {}, matches: [] };
}
