// Fills out ranks 101–800 from Tennis Abstract's current-rankings CSV.
//
// Why split paths? ATP/WTA's HTML rankings only render top 100, and they're
// the only place that publishes the "Dropping" column we need for live
// projections. Ranks 101–800 don't get projection treatment; they're just
// the rolling snapshot for searching, discovery, and (eventually) historical
// movement charts of players who pop in and out of the top 100.
//
// Guarantees:
//   - SLUG STABILITY: existing players are matched by Tennis Abstract's
//     numeric player_id (stored on the row at first encounter). Once a slug
//     is set, this script never overwrites it — even if TA changes the
//     person's listed name.
//   - SOFT RETIREMENT: we bump `last_seen_in_rankings_at` on every player we
//     touch. Players who fall out of the top 800 are NOT deleted; they're
//     just stale.

import { db, schema } from "@/db";
import { and, eq, inArray, sql } from "drizzle-orm";
import { fetchPlayers, fetchRankings, type Tour, type TAPlayer } from "./sources/tennis-abstract";
import { slugify } from "@/lib/utils";

const TOP_N = 800;

interface RunSummary {
  tour: Tour;
  weekOf: string | null;
  rowsTouched: number;
  playersInserted: number;
  playersMatchedByTaId: number;
  playersMatchedByName: number;
  snapshotsInserted: number;
}

export async function expandRankings(tour: Tour): Promise<RunSummary> {
  const summary: RunSummary = {
    tour,
    weekOf: null,
    rowsTouched: 0,
    playersInserted: 0,
    playersMatchedByTaId: 0,
    playersMatchedByName: 0,
    snapshotsInserted: 0,
  };

  // 1. Pull the latest weekly slice from TA's CSV.
  const rankings = await fetchRankings(tour, ["current"]);
  if (rankings.length === 0) return summary;
  const taLatest = rankings.reduce(
    (acc, r) => (r.rankingDate > acc ? r.rankingDate : acc),
    rankings[0]!.rankingDate,
  );
  const thisWeek = rankings.filter((r) => r.rankingDate === taLatest && r.rank <= TOP_N);
  summary.rowsTouched = thisWeek.length;

  // 2. Decide which week_of to write under. We anchor to the most recent
  //    ATP/WTA-scraped week so all top-800 rows live in the same `week_of`
  //    bucket — that lets the UI query "this week's rankings" without
  //    UNIONing across two date columns. If no ATP/WTA scrape exists yet,
  //    fall back to TA's own date.
  const anchorRow = await db
    .select({ w: sql<string>`max(${schema.rankingsSnapshots.weekOf})` })
    .from(schema.rankingsSnapshots)
    .where(
      and(eq(schema.rankingsSnapshots.tour, tour), eq(schema.rankingsSnapshots.isRace, false)),
    );
  const writeWeek = anchorRow[0]?.w ?? taLatest;
  summary.weekOf = writeWeek;

  if (thisWeek.length === 0) return summary;

  // 2. Pull the player metadata file so we have names/countries/DOBs.
  const taPlayers = await fetchPlayers(tour);
  const taById = new Map(taPlayers.map((p) => [p.playerId, p]));

  // 3. Build the slug→existingPlayerId map for the players we already have.
  //    Two lookup paths:
  //      a) Slug match — strongest, used for first-time imports during the
  //         Tennis Abstract backfill.
  //      b) (TA player_id, name) match if we ever add a column for TA id.
  //    For now we use slug only; future-proofing TODO if we start writing
  //    `ta_player_id` on the players row.
  const existingPlayers = await db
    .select({ id: schema.players.id, slug: schema.players.slug, fullName: schema.players.fullName })
    .from(schema.players)
    .where(eq(schema.players.tour, tour));
  const slugToId = new Map(existingPlayers.map((p) => [p.slug, p.id]));
  const nameToId = new Map(
    existingPlayers.map((p) => [normalizeName(p.fullName), p.id]),
  );

  // 4. For each ranking row, resolve to a `players.id` (creating new rows as
  //    needed), then insert the snapshot.
  const now = new Date();
  const touchedPlayerIds: number[] = [];

  for (const r of thisWeek) {
    const ta = taById.get(r.playerId);
    if (!ta) continue; // No metadata → can't construct a sensible player row.

    const candidateSlug = slugify(`${ta.firstName} ${ta.lastName}`);
    let playerId: number | undefined = slugToId.get(candidateSlug);
    if (playerId !== undefined) {
      summary.playersMatchedByTaId++;
    } else {
      const altMatch = nameToId.get(normalizeName(`${ta.firstName} ${ta.lastName}`));
      if (altMatch) {
        playerId = altMatch;
        summary.playersMatchedByName++;
      }
    }

    if (playerId === undefined) {
      // First time seeing this player. Insert a minimal players row.
      const dobFromTa = ta.dateOfBirth;
      const inserted = await db
        .insert(schema.players)
        .values({
          slug: candidateSlug,
          fullName: `${ta.firstName} ${ta.lastName}`,
          firstName: ta.firstName,
          lastName: ta.lastName,
          countryCode: ta.countryCode,
          dateOfBirth: dobFromTa,
          height_cm: ta.heightCm,
          plays: ta.hand,
          wikidataId: ta.wikidataId,
          tour,
          slugStableAt: now,
          lastSeenInRankingsAt: now,
        })
        .onConflictDoUpdate({
          target: schema.players.slug,
          // Fill in any TA-sourced metadata that's still null on the existing
          // row. Players first inserted by `scraper:refresh` (ATP/WTA HTML)
          // arrive without wikidata_id / height / hand — without this fill
          // they'd be invisible to `enrich-players`, which keys off wikidata_id.
          // `coalesce(existing, new)` keeps existing data when present.
          set: {
            wikidataId: sql`coalesce(${schema.players.wikidataId}, ${ta.wikidataId ?? null})`,
            height_cm: sql`coalesce(${schema.players.height_cm}, ${ta.heightCm ?? null})`,
            plays: sql`case when ${schema.players.plays} is null or ${schema.players.plays} = 'unknown' then ${ta.hand}::hand else ${schema.players.plays} end`,
            dateOfBirth: sql`coalesce(${schema.players.dateOfBirth}, ${ta.dateOfBirth ?? null}::date)`,
            countryCode: sql`coalesce(${schema.players.countryCode}, ${ta.countryCode ?? null})`,
            lastSeenInRankingsAt: now,
            updatedAt: now,
          },
        })
        .returning({ id: schema.players.id });
      playerId = inserted[0]?.id;
      if (playerId !== undefined) {
        slugToId.set(candidateSlug, playerId);
        summary.playersInserted++;
      } else {
        continue;
      }
    } else {
      // Existing player matched by slug. Same metadata-fill logic — players
      // first seen via ATP/WTA HTML lacked TA's fields, so we patch them in
      // when present without overwriting real data.
      const taPlays =
        ta.hand !== "unknown" ? sql`${ta.hand}::hand` : sql`null::hand`;
      await db
        .update(schema.players)
        .set({
          wikidataId: sql`coalesce(${schema.players.wikidataId}, ${ta.wikidataId ?? null})`,
          height_cm: sql`coalesce(${schema.players.height_cm}, ${ta.heightCm ?? null})`,
          plays: sql`case when ${schema.players.plays} is null or ${schema.players.plays} = 'unknown' then ${taPlays} else ${schema.players.plays} end`,
          dateOfBirth: sql`coalesce(${schema.players.dateOfBirth}, ${ta.dateOfBirth ?? null}::date)`,
          countryCode: sql`coalesce(${schema.players.countryCode}, ${ta.countryCode ?? null})`,
          lastSeenInRankingsAt: now,
          updatedAt: now,
        })
        .where(eq(schema.players.id, playerId));
    }

    touchedPlayerIds.push(playerId);

    // Insert the rankings_snapshot. Use onConflictDoNothing — if the row
    // already exists (e.g. backfilled previously) we leave it alone.
    await db
      .insert(schema.rankingsSnapshots)
      .values({
        tour,
        weekOf: writeWeek,
        playerId,
        rank: r.rank,
        points: r.points ?? 0,
        isRace: false,
      })
      .onConflictDoUpdate({
        target: [
          schema.rankingsSnapshots.tour,
          schema.rankingsSnapshots.weekOf,
          schema.rankingsSnapshots.playerId,
          schema.rankingsSnapshots.isRace,
        ],
        // Only fill in if the existing row had no rank — meaning the ATP/WTA
        // scrape didn't cover this player. Never clobber an authoritative
        // top-100 row with a TA-derived 101+ rank.
        set: {
          rank: sql`case when ${schema.rankingsSnapshots.rank} > 100 or ${schema.rankingsSnapshots.rank} is null then excluded.rank else ${schema.rankingsSnapshots.rank} end`,
          points: sql`case when ${schema.rankingsSnapshots.rank} > 100 or ${schema.rankingsSnapshots.rank} is null then excluded.points else ${schema.rankingsSnapshots.points} end`,
        },
      });
    summary.snapshotsInserted++;
  }

  // 5. Bump last_seen_in_rankings_at for every player we touched. Done in a
  //    single statement after the loop for efficiency.
  if (touchedPlayerIds.length > 0) {
    await db
      .update(schema.players)
      .set({ lastSeenInRankingsAt: now })
      .where(inArray(schema.players.id, touchedPlayerIds));
  }

  return summary;
}

function normalizeName(s: string): string {
  return s
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[-_]/g, " ")
    .replace(/[^a-z0-9 ]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

async function main() {
  const args = process.argv.slice(2);
  const tourArg = args.find((a) => a === "atp" || a === "wta") as Tour | undefined;
  const tours: Tour[] = tourArg ? [tourArg] : ["atp", "wta"];
  for (const t of tours) {
    const s = await expandRankings(t);
    console.log(
      `[expand-rankings] ${t.toUpperCase()}: week=${s.weekOf}  rows=${s.rowsTouched}  ` +
        `inserted=${s.playersInserted}  matchedBySlug=${s.playersMatchedByTaId}  ` +
        `matchedByName=${s.playersMatchedByName}  snapshots+=${s.snapshotsInserted}`,
    );
  }
}

const entryFile = process.argv[1] ?? "";
if (entryFile.endsWith("expand-rankings.ts") || entryFile.endsWith("expand-rankings.js")) {
  main()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
