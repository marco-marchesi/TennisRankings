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

/**
 * Refresh one target. Returns true only when a snapshot was written.
 *
 * Every attempt now leaves a scrape_runs row. The previous version inserted
 * that row only AFTER a successful fetch + schema check, and on either failure
 * logged to stderr and returned — so the process exited 0, Weekly-Update.ps1
 * printed "OK", and the database kept no trace of the attempt. That is exactly
 * how the ATP rankings for 2026-09-14 and 2026-09-28 went missing: atptour.com
 * served a Cloudflare interstitial, it parsed to 0 rows, and nothing noticed
 * until live-tennis.eu disagreed with us about 85 of the top 200.
 */
async function refreshOne(t: RefreshTarget): Promise<boolean> {
  const [run] = await db
    .insert(schema.scrapeRuns)
    .values({ source: `refresh:${t.source}`, status: "started" })
    .returning({ id: schema.scrapeRuns.id });
  if (!run) {
    console.error(`[refresh] ${t.source}: could not insert scrape_runs row`);
    return false;
  }
  const fail = async (message: string) => {
    console.error(`[refresh] ${t.source}: FAILED — ${message}`);
    await db
      .update(schema.scrapeRuns)
      .set({ status: "failed", finishedAt: new Date(), errorMessage: message.slice(0, 2000) })
      .where(eq(schema.scrapeRuns.id, run.id));
    return false;
  };

  const weekOf = mostRecentMonday();
  let snap: ReturnType<typeof parseAtpRankings> | null = null;
  let lastProblem = "";
  // Anti-bot interstitials are intermittent; one retry in a fresh browser
  // clears most of them.
  for (let attempt = 1; attempt <= 2 && !snap; attempt++) {
    console.log(`[refresh] ${t.source}: fetching live HTML (attempt ${attempt})...`);
    let html: string;
    try {
      ({ html } = await fetchLive(t.source));
    } catch (err) {
      lastProblem = `fetch failed — ${err instanceof Error ? err.message : String(err)}`;
      console.warn(`[refresh] ${t.source}: ${lastProblem}`);
      continue;
    }
    const parsed =
      t.tour === "atp"
        ? parseAtpRankings({ html, weekOf, isRace: t.isRace })
        : parseWtaRankings({ html, weekOf, isRace: t.isRace });
    console.log(`[refresh] ${t.source}: parsed ${parsed.entries.length} entries for week ${weekOf}`);
    const check = RankingSnapshot.safeParse(parsed);
    if (!check.success) {
      lastProblem =
        `schema check failed on ${html.length} bytes — ` +
        JSON.stringify(check.error.issues.slice(0, 3));
      console.warn(`[refresh] ${t.source}: ${lastProblem}`);
      continue;
    }
    snap = parsed;
  }
  if (!snap) return fail(lastProblem || "no snapshot produced");

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
    return true;
  } catch (err) {
    return fail(err instanceof Error ? err.message : String(err));
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

  const failed: string[] = [];
  for (const t of targets) {
    if (!(await refreshOne(t))) failed.push(t.source);
  }

  // After a successful settled-rankings refresh, look for new top-50 entrants
  // we haven't yet pulled history for and queue a Tennis Abstract backfill.
  // Race-only runs don't trigger this — race standings don't reveal new top-50
  // entrants that the singles snapshot didn't already show.
  const ranTopTier = targets.some((t) => !t.isRace);
  if (ranTopTier) {
    await maybeBackfillHistory();
  }

  if (failed.length > 0) {
    console.error(`[refresh] ${failed.length} target(s) FAILED: ${failed.join(", ")}`);
    process.exit(1);
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
