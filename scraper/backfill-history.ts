// Historical-ranking backfill via Tennis Abstract.
//
// For each top-N (default 50) player on each tour, fetches their full weekly
// ranking history from Sackmann's CSVs and writes it into rankings_snapshots.
// Also fills in player metadata (DOB, hand, height) when our row is missing
// it. Idempotent: players whose history is already in the DB are skipped, so
// this can run repeatedly without duplicating work.
//
// Usage:
//   pnpm scraper:backfill-history                  # both tours, top 50
//   pnpm scraper:backfill-history atp              # one tour
//   pnpm scraper:backfill-history -- --top 100     # widen the net
//   pnpm scraper:backfill-history -- --force       # re-backfill even players already covered

import { db, schema } from "@/db";
import { and, desc, eq, sql, inArray } from "drizzle-orm";
import { fetchPlayers, fetchRankings, matchPlayer, type Tour, type TAPlayer, type TARanking } from "./sources/tennis-abstract";

// 2010s + 2020s + current is enough to cover every active top-50 player's
// full pro career. Going earlier costs bandwidth without helping anyone.
const RANKING_BUCKETS = ["10s", "20s", "current"];

// "Already backfilled" heuristic: more than this many historical snapshots
// for the player → assume Tennis Abstract has already been applied.
const BACKFILL_PRESENT_THRESHOLD = 10;

interface BackfillOptions {
  tour?: Tour;
  topN: number;
  force: boolean;
}

interface BackfillResult {
  tour: Tour;
  candidatesScanned: number;
  alreadyBackfilled: number;
  matched: number;
  unmatched: string[];
  snapshotsWritten: number;
  metadataUpdated: number;
}

export async function backfillHistory(opts: BackfillOptions): Promise<BackfillResult[]> {
  const tours: Tour[] = opts.tour ? [opts.tour] : ["atp", "wta"];
  const results: BackfillResult[] = [];
  for (const tour of tours) {
    results.push(await backfillTour(tour, opts));
  }
  return results;
}

async function backfillTour(tour: Tour, opts: BackfillOptions): Promise<BackfillResult> {
  const result: BackfillResult = {
    tour,
    candidatesScanned: 0,
    alreadyBackfilled: 0,
    matched: 0,
    unmatched: [],
    snapshotsWritten: 0,
    metadataUpdated: 0,
  };

  // Find the latest settled week and pull the top-N for this tour.
  const latestWeekRow = await db
    .select({ w: sql<string>`max(${schema.rankingsSnapshots.weekOf})` })
    .from(schema.rankingsSnapshots)
    .where(
      and(eq(schema.rankingsSnapshots.tour, tour), eq(schema.rankingsSnapshots.isRace, false)),
    );
  const latestWeek = latestWeekRow[0]?.w;
  if (!latestWeek) {
    console.warn(`[backfill] ${tour}: no settled snapshot — run scraper:refresh first`);
    return result;
  }

  const topPlayers = await db
    .select({
      id: schema.players.id,
      slug: schema.players.slug,
      fullName: schema.players.fullName,
      countryCode: schema.players.countryCode,
      dateOfBirth: schema.players.dateOfBirth,
      height_cm: schema.players.height_cm,
      plays: schema.players.plays,
      rank: schema.rankingsSnapshots.rank,
    })
    .from(schema.rankingsSnapshots)
    .innerJoin(schema.players, eq(schema.players.id, schema.rankingsSnapshots.playerId))
    .where(
      and(
        eq(schema.rankingsSnapshots.tour, tour),
        eq(schema.rankingsSnapshots.weekOf, latestWeek),
        eq(schema.rankingsSnapshots.isRace, false),
      ),
    )
    .orderBy(schema.rankingsSnapshots.rank)
    .limit(opts.topN);

  result.candidatesScanned = topPlayers.length;

  // Filter to players who need backfill. A simple count-based heuristic: if
  // the player has more than N historical snapshots already, skip them.
  const playerIds = topPlayers.map((p) => p.id);
  const counts = await db
    .select({
      playerId: schema.rankingsSnapshots.playerId,
      count: sql<number>`count(*)::int`,
    })
    .from(schema.rankingsSnapshots)
    .where(
      and(
        eq(schema.rankingsSnapshots.isRace, false),
        inArray(schema.rankingsSnapshots.playerId, playerIds),
      ),
    )
    .groupBy(schema.rankingsSnapshots.playerId);
  const countByPlayer = new Map(counts.map((c) => [c.playerId, c.count]));

  const needsBackfill = topPlayers.filter((p) => {
    if (opts.force) return true;
    const have = countByPlayer.get(p.id) ?? 0;
    if (have >= BACKFILL_PRESENT_THRESHOLD) {
      result.alreadyBackfilled++;
      return false;
    }
    return true;
  });

  if (needsBackfill.length === 0) {
    console.log(`[backfill] ${tour}: all top ${opts.topN} already covered`);
    return result;
  }

  console.log(
    `[backfill] ${tour}: ${needsBackfill.length}/${topPlayers.length} need backfill — fetching Tennis Abstract CSVs...`,
  );

  // One bulk fetch of players + rankings. Cached in memory across this run.
  const taPlayers = await fetchPlayers(tour);
  const taRankings = await fetchRankings(tour, RANKING_BUCKETS);

  // Index rankings by player id for O(1) lookup inside the loop.
  const rankingsByPlayer = new Map<string, TARanking[]>();
  for (const r of taRankings) {
    const list = rankingsByPlayer.get(r.playerId);
    if (list) list.push(r);
    else rankingsByPlayer.set(r.playerId, [r]);
  }

  for (const p of needsBackfill) {
    const taPlayer = matchPlayer({ fullName: p.fullName, countryCode: p.countryCode }, taPlayers);
    if (!taPlayer) {
      result.unmatched.push(p.fullName);
      continue;
    }
    result.matched++;

    // Update player metadata. Tennis Abstract is more authoritative than the
    // approximate DOB derived from the integer age in ATP's rankings table,
    // so overwrite whenever TA has a value — even if we already had one. The
    // approximation always ends in -01-01; spotting it lets us be conservative
    // for the (rare) case where a real DOB was manually set elsewhere.
    const existingDobIsApprox = p.dateOfBirth
      ? String(p.dateOfBirth).endsWith("-01-01")
      : true;
    const metaUpdates: Partial<typeof schema.players.$inferInsert> = {};
    if (taPlayer.dateOfBirth && existingDobIsApprox) metaUpdates.dateOfBirth = taPlayer.dateOfBirth;
    if (taPlayer.heightCm && !p.height_cm) metaUpdates.height_cm = taPlayer.heightCm;
    if (taPlayer.hand !== "unknown" && (!p.plays || p.plays === "unknown")) metaUpdates.plays = taPlayer.hand;
    // Wikidata QID is the key to fetching photos + backhand later.
    if (taPlayer.wikidataId) metaUpdates.wikidataId = taPlayer.wikidataId;
    if (Object.keys(metaUpdates).length > 0) {
      metaUpdates.updatedAt = new Date();
      await db.update(schema.players).set(metaUpdates).where(eq(schema.players.id, p.id));
      result.metadataUpdated++;
    }

    // Write all historical rankings for this player. Use upsert so we never
    // collide with the current week or with prior backfill runs.
    const myRankings = rankingsByPlayer.get(taPlayer.playerId) ?? [];
    if (myRankings.length === 0) continue;

    // Batch in chunks to avoid huge single statements.
    const chunkSize = 500;
    for (let i = 0; i < myRankings.length; i += chunkSize) {
      const chunk = myRankings.slice(i, i + chunkSize);
      const values = chunk.map((r) => ({
        tour,
        weekOf: r.rankingDate,
        playerId: p.id,
        rank: r.rank,
        points: r.points ?? 0,
        isRace: false,
      }));
      await db
        .insert(schema.rankingsSnapshots)
        .values(values)
        .onConflictDoNothing();
      result.snapshotsWritten += values.length;
    }
  }

  return result;
}

async function main() {
  const args = process.argv.slice(2);
  const tourArg = args.find((a) => a === "atp" || a === "wta") as Tour | undefined;
  const topIdx = args.indexOf("--top");
  const topN = topIdx >= 0 && args[topIdx + 1] ? Number(args[topIdx + 1]) : 50;
  const force = args.includes("--force");

  console.log(`[backfill] tours: ${tourArg ?? "atp+wta"}  topN: ${topN}  force: ${force}`);
  const results = await backfillHistory({ tour: tourArg, topN, force });
  for (const r of results) {
    console.log(
      `[backfill] ${r.tour.toUpperCase()}: scanned=${r.candidatesScanned} matched=${r.matched} ` +
        `already=${r.alreadyBackfilled} unmatched=${r.unmatched.length} ` +
        `snapshots+${r.snapshotsWritten} metaUpdated=${r.metadataUpdated}`,
    );
    if (r.unmatched.length > 0 && r.unmatched.length <= 10) {
      console.log(`           unmatched: ${r.unmatched.join(", ")}`);
    } else if (r.unmatched.length > 10) {
      console.log(`           unmatched (first 10): ${r.unmatched.slice(0, 10).join(", ")}`);
    }
  }
}

// Run main() when invoked as a script. tsx sets process.argv[1] to the
// .ts file path, while ESM `import.meta.url` is a file:// URL — string
// comparison is too fragile across OS-specific path separators and tsx's
// loader, so we just check that the entry filename matches.
const entryFile = process.argv[1] ?? "";
if (entryFile.endsWith("backfill-history.ts") || entryFile.endsWith("backfill-history.js")) {
  main()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
