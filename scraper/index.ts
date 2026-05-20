import { db, schema } from "@/db";
import { fetchAtpRankings } from "./sources/atp";
import { fetchWtaRankings } from "./sources/wta";
import { snapshotSanityCheck, type RankingSnapshot } from "./validate";
import { writeRankingSnapshot, revalidateAfterSnapshot } from "./snapshot";

const isDryRun = process.argv.includes("--dry");

function mostRecentMonday(): string {
  const d = new Date();
  const day = d.getUTCDay();
  const diff = (day + 6) % 7;
  d.setUTCDate(d.getUTCDate() - diff);
  return d.toISOString().slice(0, 10);
}

async function recordRun(source: string, status: string, extra: Partial<{
  rowsWritten: number;
  deltaPct: number;
  errorMessage: string;
}>) {
  const [row] = await db
    .insert(schema.scrapeRuns)
    .values({
      source,
      status,
      finishedAt: new Date(),
      rowsWritten: extra.rowsWritten,
      deltaPct: extra.deltaPct,
      errorMessage: extra.errorMessage,
    })
    .returning({ id: schema.scrapeRuns.id });
  return row?.id ?? 0;
}

async function runTour(name: "atp" | "wta", fetcher: () => Promise<RankingSnapshot>) {
  console.log(`[scraper] starting ${name}`);
  try {
    const snap = await fetcher();
    const prev = await loadPrevious(name);
    const sanity = snapshotSanityCheck(prev, snap);
    if (!sanity.ok) {
      await recordRun(name, "rejected", {
        deltaPct: sanity.deltaPct,
        errorMessage: sanity.reason,
      });
      console.error(`[scraper] ${name} REJECTED: ${sanity.reason}`);
      return;
    }
    if (isDryRun) {
      console.log(`[scraper] ${name} OK (dry run, ${snap.entries.length} rows, Δ${sanity.deltaPct}%)`);
      return;
    }
    const runId = await recordRun(name, "started", {});
    await writeRankingSnapshot(snap, runId);
    await recordRun(name, "ok", { rowsWritten: snap.entries.length, deltaPct: sanity.deltaPct });
    await revalidateAfterSnapshot(snap);
    console.log(`[scraper] ${name} OK (${snap.entries.length} rows, Δ${sanity.deltaPct}%)`);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    await recordRun(name, "failed", { errorMessage: msg });
    console.error(`[scraper] ${name} FAILED: ${msg}`);
  }
}

async function loadPrevious(_tour: "atp" | "wta"): Promise<RankingSnapshot | null> {
  // TODO: read previous week's snapshot from DB. Returning null defers
  // sanity-check until the second run lands.
  return null;
}

async function main() {
  const weekOf = mostRecentMonday();
  console.log(`[scraper] week of ${weekOf} (dry=${isDryRun})`);
  await runTour("atp", () => fetchAtpRankings(weekOf));
  await runTour("wta", () => fetchWtaRankings(weekOf));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
