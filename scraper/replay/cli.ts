//   pnpm replay                       both tours, both modes, 2023-01-02..2026-06-08, top 500
//   pnpm replay -- --tour atp --mode delta --from 2025-01-06 --to 2025-12-29
//   pnpm replay -- --update-baseline  record the current scores as the gate (never lowers it without --force)
//   pnpm replay:check                 exit 1 if any covered run scores below baseline
//   pnpm replay -- --refresh          re-download the archive cache
//   pnpm replay -- --rules slots      score a counting-rule variant (own report + baseline key)
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { loadMatches, loadOfficial, loadPlayerNames } from "./archive";
import { buildEditions } from "./editions";
import { indexByPlayer } from "./ledger";
import { replayDelta, replayFull } from "./replay";
import {
  checkBaseline,
  renderSection,
  summarize,
  toBaseline,
  trendLine,
  type Baseline,
  type RunSummary,
} from "./report";
import { countingRules, DEFAULT_VARIANT, parseVariant, RULE_VARIANTS, type RuleVariant } from "./rules";
import type { Tour } from "./types";

const BASELINE_PATH = resolve(import.meta.dirname, "baseline.json");

function arg(name: string, fallback: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1]! : fallback;
}
const flag = (name: string) => process.argv.includes(`--${name}`);

async function main(): Promise<void> {
  const from = arg("from", "2023-01-02");
  const to = arg("to", "2026-06-08");
  const top = Number(arg("top", "500"));
  const tours: Tour[] = arg("tour", "both") === "both" ? ["atp", "wta"] : [arg("tour", "atp") as Tour];
  const modeArg = arg("mode", "both");
  const modes = modeArg === "both" ? ["full", "delta"] : [modeArg];
  const refresh = flag("refresh");
  const variant = arg("rules", DEFAULT_VARIANT) as RuleVariant;
  try {
    parseVariant(variant);
  } catch {
    console.error(`[replay] unknown --rules ${variant}; e.g. ${RULE_VARIANTS.join(", ")}, slots+overflow+refill>50`);
    process.exit(1);
  }
  const rulesFor = (tour: Tour) => (w: string, rank: number) => countingRules(tour, w, variant, rank);

  const summaries: RunSummary[] = [];
  const sections: string[] = [];
  // Full mode needs the 52 weeks before `from`; delta needs last year's
  // results to know what leaves.
  const years: number[] = [];
  for (let y = Number(from.slice(0, 4)) - 1; y <= Number(to.slice(0, 4)); y++) years.push(y);

  for (const tour of tours) {
    const { matches, skipped: badMatches } = await loadMatches(tour, years, refresh);
    const { byWeek, skipped: badRanks } = await loadOfficial(tour, from, to, refresh);
    const names = await loadPlayerNames(tour, refresh);
    const { editions, results } = buildEditions(tour, matches);
    const byPlayer = indexByPlayer(results);
    const weeks = [...byWeek.keys()].sort();
    console.log(
      `[replay] ${tour}: ${matches.length} matches (${badMatches} malformed), ${editions.size} editions, ` +
        `${weeks.length} official weeks (${badRanks} malformed rows)`,
    );
    for (const mode of modes) {
      const scores =
        mode === "full"
          ? replayFull(byWeek, byPlayer, rulesFor(tour), weeks, top)
          : replayDelta(byWeek, byPlayer, rulesFor(tour), weeks, top);
      const s = summarize(tour, mode, from, to, top, scores, variant);
      summaries.push(s);
      sections.push(renderSection(s, scores, names));
    }
  }

  const at = new Date().toISOString();
  mkdirSync("logs", { recursive: true });
  // Variant names carry "+" and ">", which Windows rejects in a file name.
  const suffix = variant === DEFAULT_VARIANT ? "" : `-${variant.replace(/[^a-z0-9]+/gi, "_")}`;
  const reportPath = `logs/replay-${at.slice(0, 10)}${suffix}.md`;
  writeFileSync(
    reportPath,
    [`# Replay ${at}`, "", `Window ${from} .. ${to}, top ${top}, rules ${variant}`, "", ...sections].join("\n"),
  );
  const trend = `${trendLine(at, summaries)}  rules=${variant}`;
  appendFileSync("logs/replay-trend.log", trend + "\n");
  console.log(trend);
  console.log(`[replay] report: ${reportPath}`);

  const baseline: Baseline = existsSync(BASELINE_PATH)
    ? (JSON.parse(readFileSync(BASELINE_PATH, "utf8")) as Baseline)
    : {};
  if (flag("update-baseline")) {
    const { baseline: next, lowered } = toBaseline(summaries, baseline, flag("force"));
    for (const k of lowered) {
      console.error(`[replay] ${k} scores BELOW its baseline${flag("force") ? " — lowered (--force)" : " — kept; pass --force to lower it"}`);
    }
    writeFileSync(BASELINE_PATH, JSON.stringify(next, null, 2) + "\n");
    console.log(`[replay] baseline updated: ${BASELINE_PATH}`);
    if (lowered.length && !flag("force")) process.exit(1);
  }
  if (flag("check")) {
    const fails = checkBaseline(summaries, baseline);
    for (const f of fails) console.error(`[replay] BELOW BASELINE ${f}`);
    if (fails.length) process.exit(1);
    console.log("[replay] at or above baseline");
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
