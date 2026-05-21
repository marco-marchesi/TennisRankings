// One-shot "pull latest rankings live and write them to the DB" script.
//
// Uses the Playwright fetcher (same one the validator uses) to get real
// rendered HTML for both tours, runs the production parser on it, then
// upserts via writeRankingSnapshot. Intended for local dev / manual runs;
// the production scraper (`scraper/index.ts`) still uses politeFetch with
// the bot UA and will work once deployed from a non-blocked IP.

import { db, schema } from "@/db";
import { eq } from "drizzle-orm";
import { fetchLive } from "./fetch-live";
import { parseAtpRankings } from "./sources/atp";
import { parseWtaRankings } from "./sources/wta";
import { writeRankingSnapshot } from "./snapshot";
import { RankingSnapshot } from "./validate";
import { backfillHistory } from "./backfill-history";

type RefreshTarget =
  | { source: "atp"; tour: "atp"; isRace: false }
  | { source: "wta"; tour: "wta"; isRace: false }
  | { source: "atp-race"; tour: "atp"; isRace: true }
  | { source: "wta-race"; tour: "wta"; isRace: true };

const ALL_TARGETS: RefreshTarget[] = [
  { source: "atp", tour: "atp", isRace: false },
  { source: "wta", tour: "wta", isRace: false },
  { source: "atp-race", tour: "atp", isRace: true },
  { source: "wta-race", tour: "wta", isRace: true },
];

function mostRecentMonday(): string {
  const d = new Date();
  const day = d.getUTCDay();
  const diff = (day + 6) % 7;
  d.setUTCDate(d.getUTCDate() - diff);
  return d.toISOString().slice(0, 10);
}

async function refreshOne(t: RefreshTarget) {
  console.log(`[refresh] ${t.source}: fetching live HTML...`);
  let html: string;
  try {
    ({ html } = await fetchLive(t.source));
  } catch (err) {
    console.error(`[refresh] ${t.source}: fetch FAILED — ${err instanceof Error ? err.message : err}`);
    return;
  }
  const weekOf = mostRecentMonday();

  const snap =
    t.tour === "atp"
      ? parseAtpRankings({ html, weekOf, isRace: t.isRace })
      : parseWtaRankings({ html, weekOf, isRace: t.isRace });

  console.log(`[refresh] ${t.source}: parsed ${snap.entries.length} entries for week ${weekOf}`);

  const check = RankingSnapshot.safeParse(snap);
  if (!check.success) {
    console.error(`[refresh] ${t.source}: schema check FAILED — refusing to write`);
    console.error(check.error.issues.slice(0, 5));
    return;
  }

  const [run] = await db
    .insert(schema.scrapeRuns)
    .values({ source: `refresh:${t.source}`, status: "started" })
    .returning({ id: schema.scrapeRuns.id });
  if (!run) {
    console.error(`[refresh] ${t.source}: could not insert scrape_runs row`);
    return;
  }

  try {
    await writeRankingSnapshot(snap, run.id);
    await db
      .update(schema.scrapeRuns)
      .set({
        status: "ok",
        finishedAt: new Date(),
        rowsWritten: snap.entries.length,
      })
      .where(eq(schema.scrapeRuns.id, run.id));
    console.log(`[refresh] ${t.source}: wrote ${snap.entries.length} rows OK`);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await db
      .update(schema.scrapeRuns)
      .set({ status: "failed", finishedAt: new Date(), errorMessage: message })
      .where(eq(schema.scrapeRuns.id, run.id));
    console.error(`[refresh] ${t.source}: FAILED — ${message}`);
  }
}

async function main() {
  // First non-flag arg picks targets; flags ("--no-backfill" etc.) are handled separately.
  const arg = process.argv.slice(2).find((a) => !a.startsWith("--"));
  let targets: RefreshTarget[];
  if (!arg) {
    targets = ALL_TARGETS;
  } else if (arg === "rankings") {
    targets = ALL_TARGETS.filter((t) => !t.isRace);
  } else if (arg === "race") {
    targets = ALL_TARGETS.filter((t) => t.isRace);
  } else {
    targets = ALL_TARGETS.filter((t) => t.source === arg || t.tour === arg);
  }
  if (targets.length === 0) {
    console.error(`[refresh] no targets matched "${arg}". Try: atp | wta | atp-race | wta-race | race | rankings`);
    process.exit(1);
  }

  for (const t of targets) {
    await refreshOne(t);
  }

  // After a successful settled-rankings refresh, look for new top-50 entrants
  // we haven't yet pulled history for and queue a Tennis Abstract backfill.
  // Race-only runs don't trigger this — race standings don't reveal new top-50
  // entrants that the singles snapshot didn't already show.
  const ranTopTier = targets.some((t) => !t.isRace);
  if (ranTopTier) {
    await maybeBackfillHistory();
  }
}

async function maybeBackfillHistory() {
  const noBackfillFlag = process.argv.includes("--no-backfill");
  if (noBackfillFlag) return;
  try {
    console.log(`[refresh] checking for new top-50 entrants needing history backfill...`);
    const results = await backfillHistory({ topN: 50, force: false });
    for (const r of results) {
      const needed = r.candidatesScanned - r.alreadyBackfilled;
      if (needed > 0) {
        console.log(
          `[refresh] ${r.tour.toUpperCase()}: backfilled ${r.matched}/${needed} new top-50 player(s), ` +
            `+${r.snapshotsWritten} historical snapshots`,
        );
      }
    }
  } catch (err) {
    console.error(`[refresh] backfill skipped due to error:`, err instanceof Error ? err.message : err);
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
