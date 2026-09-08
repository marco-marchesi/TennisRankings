// Entrypoint for `pnpm scraper:projections`.
//
// Computes live projections for both tours by:
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
  // Lookback window for "is this player currently in a tournament".
  //
  // MUST BE LONGER THAN THE LONGEST TOURNAMENT. It was 7 days, which is
  // shorter than a Grand Slam (15 days) or a 12-day Masters, so a first-round
  // loser at an event still in progress had their only match fall outside the
  // window, read as `not_playing`, and got nothing credited — while their
  // result from 52 weeks ago was still subtracted. That produced a cohort of
  // players wrong by exactly the first-round value.
  //
  // Measured against live-tennis.eu on 2026-09-08, mid-US-Open, ATP/WTA
  // players whose live total matches exactly (of ~199 and ~194 matched):
  //
  //   lookback   7  ->  61 / 60      (27 players short by exactly 10)
  //   lookback  14  ->  81 / 72
  //   lookback  21  ->  81 / 74      <- plateau
  //   lookback  28  ->  81 / 74
  //   lookback  35  ->  81 / 74
  //
  // 21 is the plateau and covers a 15-day Slam with slack. Longer buys
  // nothing and increases the chance of crediting an event that has actually
  // finished; at 21 days exactly one player hit that case, because
  // derive-live-state's `finished_tournaments` CTE excludes events with a
  // Final on record.
  const lookIdx = args.indexOf("--lookback");
  const lookbackDays =
    lookIdx >= 0 && args[lookIdx + 1] ? Number(args[lookIdx + 1]) : 21;

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
