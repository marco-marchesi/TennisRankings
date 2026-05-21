// Entrypoint for `pnpm scraper:projections`.
//
// Computes live projections for both tours' top-50 by:
//   1. Reading official + dropping points from rankings_snapshots (captured
//      verbatim from atptour.com during refresh).
//   2. Deriving each player's current tournament status from recent matches
//      (Tennis Abstract data already in player_recent_matches).
//   3. Running the status-aware calculator and writing to live_projections.
//
// Idempotent and safe to schedule on a cron.

import { runProjections } from "./runner";

async function main() {
  const args = process.argv.slice(2);
  const tourArg = args.find((a) => a === "atp" || a === "wta") as "atp" | "wta" | undefined;
  const topIdx = args.indexOf("--top");
  const topN = topIdx >= 0 && args[topIdx + 1] ? Number(args[topIdx + 1]) : 50;
  // Lookback window for "is this player currently in a tournament". Default
  // 7 days; can be widened (e.g. --lookback 35) to demonstrate the pipeline
  // when upstream match data is lagging.
  const lookIdx = args.indexOf("--lookback");
  const lookbackDays =
    lookIdx >= 0 && args[lookIdx + 1] ? Number(args[lookIdx + 1]) : 7;

  const tours = tourArg ? [tourArg] : (["atp", "wta"] as const);
  let totalWritten = 0;
  for (const t of tours) {
    const r = await runProjections({ tour: t, topN, lookbackDays });
    const written = r.inProgress + r.eliminated + r.wonTournament;
    totalWritten += written;
    console.log(
      `[projections] ${t.toUpperCase()}: scanned=${r.candidatesScanned}  ` +
        `inProgress=${r.inProgress}  eliminated=${r.eliminated}  ` +
        `wonTournament=${r.wonTournament}  notPlaying=${r.notPlaying}  ` +
        `written=${written}`,
    );
    if (r.skipped.length > 0) {
      console.log(`  skipped: ${r.skipped.map((s) => `${s.fullName} (${s.reason})`).join("; ")}`);
    }
  }
  console.log(`[projections] total written: ${totalWritten}`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
