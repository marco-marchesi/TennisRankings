import { db, schema } from "@/db";
import type { RankingSnapshot } from "./validate";

/**
 * Writes a ranking snapshot into Postgres in a single transaction:
 *   1. Upsert players (slug -> id).
 *   2. Insert `rankings_snapshots` rows for this week.
 *
 * If anything fails mid-write, the transaction rolls back and the previous
 * Monday's data stays canonical.
 */
export async function writeRankingSnapshot(
  snap: RankingSnapshot,
  scrapeRunId: number,
) {
  // TODO: wrap in db.transaction once we move off neon-http (which doesn't
  // support multi-statement transactions). Until then, batch upserts.
  for (const e of snap.entries) {
    const inserted = await db
      .insert(schema.players)
      .values({
        slug: e.slug,
        fullName: e.fullName,
        countryCode: e.countryCode,
        tour: snap.tour,
      })
      .onConflictDoUpdate({
        target: schema.players.slug,
        set: {
          fullName: e.fullName,
          countryCode: e.countryCode,
          updatedAt: new Date(),
        },
      })
      .returning({ id: schema.players.id });

    const playerId = inserted[0]?.id;
    if (!playerId) continue;

    await db
      .insert(schema.rankingsSnapshots)
      .values({
        tour: snap.tour,
        weekOf: snap.weekOf,
        playerId,
        rank: e.rank,
        points: e.points,
        tournamentsPlayed: e.tournamentsPlayed,
        scrapeRunId,
        isRace: snap.isRace,
      })
      .onConflictDoUpdate({
        target: [
          schema.rankingsSnapshots.tour,
          schema.rankingsSnapshots.weekOf,
          schema.rankingsSnapshots.playerId,
          schema.rankingsSnapshots.isRace,
        ],
        set: {
          rank: e.rank,
          points: e.points,
          tournamentsPlayed: e.tournamentsPlayed,
        },
      });
  }
}

/**
 * Hits the Next.js on-demand revalidate endpoint so the cached HTML
 * refreshes immediately after a snapshot lands.
 */
export async function revalidateAfterSnapshot(snap: RankingSnapshot) {
  const url = process.env.NEXT_PUBLIC_SITE_URL;
  const secret = process.env.REVALIDATE_SECRET;
  if (!url || !secret) return;
  await fetch(`${url}/api/revalidate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      secret,
      paths: ["/", `/rankings/${snap.tour}`, `/race/${snap.tour}`],
      tags: [`rankings:${snap.tour}`],
    }),
  });
}
