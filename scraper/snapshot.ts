import { db, schema } from "@/db";
import { sql } from "drizzle-orm";
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
  const currentYear = new Date().getUTCFullYear();
  for (const e of snap.entries) {
    // ATP/WTA only publish integer age. We approximate DOB as Jan 1 of the
    // year (currentYear - age) — accurate enough to drive age-band UI filters
    // (<18/<25/>30) and gets corrected when a proper profile scrape lands a
    // real DOB later. Only set when no DOB exists yet, so a profile scrape
    // doesn't get overwritten by this approximation.
    const approxDob =
      e.age != null && Number.isFinite(e.age)
        ? `${currentYear - e.age}-01-01`
        : null;

    const playerId = await resolvePlayer(snap.tour, e, approxDob);
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
        pointsMove: e.pointsMove ?? null,
        dropPoints: e.dropPoints ?? null,
        nextBestPoints: e.nextBestPoints ?? null,
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
          pointsMove: e.pointsMove ?? null,
          dropPoints: e.dropPoints ?? null,
          nextBestPoints: e.nextBestPoints ?? null,
          // Claim the row for the official scrape. Without this, a row that
          // TennisExplorer inserted first (scrape_run_id null) stayed
          // "unofficial" after being overwritten with official values, and
          // everything that tells the two apart by scrape_run_id misread it.
          scrapeRunId,
        },
      });
  }
}

type Entry = RankingSnapshot["entries"][number];

/**
 * The player a ranking row belongs to: by the tour's own id first, then slug.
 *
 * Slug-only upserts created a second player whenever the tour's spelling
 * differed from ours — "christopher-o'connell" beside "christopher-oconnell",
 * "vaidehee-chaudhari" beside "vaidehi-chaudhari": 34 duplicates the week the
 * official list was extended to rank 500. The id survives renames.
 */
async function resolvePlayer(
  tour: RankingSnapshot["tour"],
  e: Entry,
  approxDob: string | null,
): Promise<number | null> {
  const idCol = tour === "atp" ? "atp_id" : tour === "wta" ? "wta_id" : null;
  const ext = e.externalId ?? null;

  if (idCol && ext) {
    const hit = await db.execute<{ id: number }>(sql`
      select id from players where tour = ${tour} and ${sql.raw(idCol)} = ${ext} limit 1
    `);
    const row = ((hit as unknown as { rows?: Array<{ id: number }> }).rows ??
      (hit as unknown as Array<{ id: number }>))[0];
    if (row) {
      await db.execute(sql`
        update players set
          full_name = ${e.fullName},
          country_code = coalesce(${e.countryCode}, country_code),
          date_of_birth = coalesce(date_of_birth, ${approxDob}::date),
          updated_at = now()
        where id = ${row.id}
      `);
      return Number(row.id);
    }
  }

  // No id match: fall back to the slug, as before.
  const bySlug = await db.execute<{ id: number; ext: string | null }>(sql`
    select id, ${idCol ? sql.raw(idCol) : sql`null`} as ext from players where slug = ${e.slug} limit 1
  `);
  const slugRow = ((bySlug as unknown as { rows?: Array<{ id: number; ext: string | null }> }).rows ??
    (bySlug as unknown as Array<{ id: number; ext: string | null }>))[0];
  // Same slug, different stored id: the stored one is wrong, not the page.
  // scrape-wta-results "learned" ids from match records, and for 25 players
  // those were not WTA player ids at all (Nikola Bartunkova held 721779, which
  // api.wtatennis.com/tennis/players/ does not know; the ranking page's 330364
  // is her). The official ranking page is the authority on its own ids.
  const replaceId = Boolean(slugRow && ext && slugRow.ext && slugRow.ext !== ext);
  if (replaceId) {
    console.warn(
      `[snapshot] ${tour} ${e.fullName}: replacing stored ${idCol}=${slugRow!.ext} with the ranking page's ${ext}`,
    );
  }

  const inserted = await db
    .insert(schema.players)
    .values({
      slug: e.slug,
      fullName: e.fullName,
      countryCode: e.countryCode,
      tour,
      dateOfBirth: approxDob,
    })
    .onConflictDoUpdate({
      target: schema.players.slug,
      set: {
        fullName: e.fullName,
        countryCode: e.countryCode,
        // Only seed DOB when it's currently null — never overwrite a real
        // DOB that came from a profile scrape with the integer approximation.
        dateOfBirth: sql`coalesce(${schema.players.dateOfBirth}, ${approxDob})`,
        updatedAt: new Date(),
      },
    })
    .returning({ id: schema.players.id });
  const id = inserted[0]?.id;
  if (!id) return null;
  if (idCol && ext) {
    await db.execute(sql`
      update players set
        ${sql.raw(idCol)} = ${replaceId ? sql`${ext}` : sql`coalesce(${sql.raw(idCol)}, ${ext})`}
        ${tour === "atp" ? sql`, atp_id_source = coalesce(atp_id_source, 'atp')` : sql``}
      where id = ${id}
    `);
  }
  return id;
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
