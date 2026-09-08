/**
 * Daily accuracy report: our numbers vs live-tennis.eu.
 *
 * Writes a human-readable diff to logs/. Designed to be run by a scheduled
 * task after the in-week refresh, so the comparison is against fresh data.
 *
 * Four tables are compared:
 *   ATP / WTA official  -> our published snapshot   (rankings_snapshots)
 *   ATP / WTA live      -> our projected total      (live_projections)
 *
 * WHY BOTH: the website shows the projected number and sorts by it, so the
 * official comparison alone hides the errors a visitor actually sees. The two
 * behave very differently — as of 2026-09 the official tables sit at ~195/200
 * while the live ones are far worse.
 *
 * A "live" difference is not automatically a bug. live-tennis.eu updates as
 * each match finishes; we only know what the last daily-matches run stored.
 * Worked example from 2026-09-04, Zverev:
 *   we held only his 1R win  -> reached R64 -> secured  50 -> 7790-100+50  = 7740
 *   LT had his R64 win too   -> reached R32 -> secured 100 -> 7790-100+100 = 7790
 * Same rule, one match of lag. That is why the report separates STALENESS
 * (we are behind on matches) from real disagreement, and prints the newest
 * match date we hold.
 *
 *   pnpm scraper:compare-live
 *   pnpm scraper:compare-live -- --top 200 --out logs/live-diff.log
 */
import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { sql } from "drizzle-orm";
import { db } from "@/db";
import {
  fetchLiveTennis,
  ltPath,
  namesMatch,
  type LiveTennisRow,
  type LtPageKind,
} from "./sources/live-tennis";
import { runEntrypoint } from "./exit";

type Tour = "atp" | "wta";

interface OurRow {
  rank: number;
  fullName: string;
  points: number;
  status: string | null;
}

interface Diff {
  rank: number;
  name: string;
  ours: number | null;
  theirs: number;
  kind: "points" | "player" | "missing";
  ourName?: string;
  status?: string | null;
}

interface TableResult {
  label: string;
  tour: Tour;
  kind: LtPageKind;
  judged: number;
  correct: number;
  rankCorrect: number;
  within10: number;
  within50: number;
  diffs: Diff[];
  duplicateRanks: string[];
  ltRows: number;
  ourRows: number;
}

async function ourTable(tour: Tour, kind: LtPageKind): Promise<OurRow[]> {
  const isRace = kind === "race";
  const live = kind === "live";
  const res = await db.execute<Record<string, unknown>>(sql`
    with cur as (
      select rs.player_id, rs.rank, rs.points, p.full_name
      from rankings_snapshots rs
      join players p on p.id = rs.player_id
      where rs.tour = ${tour}
        and rs.is_race = ${isRace}
        and rs.week_of = (
          select max(week_of) from rankings_snapshots
          where tour = ${tour} and is_race = ${isRace}
        )
    )
    select
      case when ${live}
        then row_number() over (order by coalesce(lp.next_points, cur.points) desc)
        else cur.rank end as rank,
      cur.full_name,
      case when ${live} then coalesce(lp.next_points, cur.points) else cur.points end as points,
      lp.status
    from cur
    left join live_projections lp on lp.player_id = cur.player_id
    order by rank
  `);
  const rows = ((res as unknown as { rows: unknown[] }).rows ?? res) as Array<
    Record<string, unknown>
  >;
  return rows.map((r) => ({
    rank: Number(r.rank),
    fullName: String(r.full_name),
    points: Number(r.points),
    status: (r.status as string | null) ?? null,
  }));
}

function compare(
  label: string,
  tour: Tour,
  kind: LtPageKind,
  ours: OurRow[],
  theirs: LiveTennisRow[],
  topN: number,
): TableResult {
  const out: TableResult = {
    label,
    tour,
    kind,
    judged: 0,
    correct: 0,
    rankCorrect: 0,
    within10: 0,
    within50: 0,
    diffs: [],
    duplicateRanks: [],
    ltRows: theirs.length,
    ourRows: ours.filter((r) => r.rank <= topN).length,
  };

  const byRank = new Map<number, OurRow[]>();
  for (const r of ours) {
    if (r.rank > topN) continue;
    const arr = byRank.get(r.rank) ?? [];
    arr.push(r);
    byRank.set(r.rank, arr);
  }
  for (const [rank, rows] of byRank) {
    if (rows.length > 1) {
      out.duplicateRanks.push(`rank ${rank}: ${rows.map((r) => r.fullName).join(" | ")}`);
    }
  }

  for (const lt of theirs) {
    if (lt.rank > topN || lt.points === null) continue;
    out.judged++;
    const candidates = byRank.get(lt.rank) ?? [];
    if (candidates.length === 0) {
      out.diffs.push({ rank: lt.rank, name: lt.fullName, ours: null, theirs: lt.points, kind: "missing" });
      continue;
    }
    const match = candidates.find((c) => namesMatch(c.fullName, lt.fullName));
    if (!match) {
      out.diffs.push({
        rank: lt.rank,
        name: lt.fullName,
        ours: candidates[0]!.points,
        theirs: lt.points,
        kind: "player",
        ourName: candidates.map((c) => c.fullName).join(" | "),
      });
      continue;
    }
    out.rankCorrect++;
    const d = match.points - lt.points;
    if (Math.abs(d) <= 10) out.within10++;
    if (Math.abs(d) <= 50) out.within50++;
    if (d === 0) {
      out.correct++;
    } else {
      out.diffs.push({
        rank: lt.rank,
        name: lt.fullName,
        ours: match.points,
        theirs: lt.points,
        kind: "points",
        status: match.status,
      });
    }
  }
  out.diffs.sort((a, b) => {
    const da = a.ours === null ? Infinity : Math.abs(a.ours - a.theirs);
    const db_ = b.ours === null ? Infinity : Math.abs(b.ours - b.theirs);
    return db_ - da;
  });
  return out;
}

function pad(s: string | number, n: number) {
  const t = String(s);
  return t.length >= n ? t.slice(0, n) : t + " ".repeat(n - t.length);
}
function padL(s: string | number, n: number) {
  const t = String(s);
  return t.length >= n ? t : " ".repeat(n - t.length) + t;
}

interface Freshness {
  lines: string[];
  /** Largest number of whole days between today and the newest match held. */
  worstStaleDays: number;
}

async function dataFreshness(): Promise<Freshness> {
  const res = await db.execute<Record<string, unknown>>(sql`
    select p.tour,
           max(prm.played_on)::text as newest_match,
           max(lp.computed_at)::text as projections_computed,
           (current_date - max(prm.played_on))::int as stale_days
    from players p
    left join player_recent_matches prm on prm.player_id = p.id
    left join live_projections lp on lp.player_id = p.id
    group by p.tour order by p.tour
  `);
  const rows = ((res as unknown as { rows: unknown[] }).rows ?? res) as Array<
    Record<string, unknown>
  >;
  let worst = 0;
  const lines = rows.map((r) => {
    const stale = r.stale_days == null ? 999 : Number(r.stale_days);
    if (stale > worst) worst = stale;
    const flag = stale > 1 ? `  <-- ${stale} days stale` : "";
    return (
      `  ${pad(String(r.tour), 5)} newest match held: ${r.newest_match}` +
      `   projections computed: ${r.projections_computed ?? "never"}${flag}`
    );
  });
  return { lines, worstStaleDays: worst };
}

async function main() {
  const args = process.argv.slice(2);
  const topIdx = args.indexOf("--top");
  const topN = topIdx >= 0 && args[topIdx + 1] ? Number(args[topIdx + 1]) : 200;
  const outIdx = args.indexOf("--out");
  const today = new Date().toISOString().slice(0, 10);
  const outPath = outIdx >= 0 && args[outIdx + 1] ? args[outIdx + 1]! : join("logs", `live-diff-${today}.log`);

  const TABLES: Array<{ label: string; tour: Tour; kind: LtPageKind }> = [
    { label: "ATP official", tour: "atp", kind: "official" },
    { label: "WTA official", tour: "wta", kind: "official" },
    { label: "ATP live", tour: "atp", kind: "live" },
    { label: "WTA live", tour: "wta", kind: "live" },
  ];

  const lines: string[] = [];
  const stamp = new Date().toISOString();
  lines.push("=".repeat(78));
  lines.push(`live-tennis.eu comparison — ${stamp}   top ${topN}`);
  lines.push("=".repeat(78));
  lines.push("");
  const fresh = await dataFreshness();
  lines.push("DATA FRESHNESS (a live difference may simply mean we are behind)");
  lines.push(...fresh.lines);
  lines.push("");

  // A stale match table makes the LIVE comparison meaningless, and saying so
  // loudly is the difference between "our maths is wrong" and "we are blind".
  // On 2026-09-08 the match data was five days old because a proxy began
  // blocking tennisexplorer.com (SEC_E_UNTRUSTED_ROOT on the TLS handshake,
  // plus an HTML block page over plain HTTP). That dropped the live tables to
  // 12/200 and 0/200 while the official tables held at 198/200 and 199/200.
  // Without this banner, that reads as a points bug.
  if (fresh.worstStaleDays > 1) {
    lines.push("!".repeat(78));
    lines.push(
      `!! MATCH DATA IS ${fresh.worstStaleDays} DAYS STALE - the LIVE comparison below is not meaningful.`,
    );
    lines.push("!! The official tables are still valid; they do not depend on match data.");
    lines.push("!!");
    lines.push("!! Most likely the TennisExplorer step could not run. Check:");
    lines.push("!!   curl -sv --max-time 10 https://www.tennisexplorer.com/ 2>&1 | findstr schannel");
    lines.push("!! A TLS 'untrusted root' or an HTML block page means the network is blocking");
    lines.push("!! that host, not that the scraper is broken - every other source (ATP, WTA,");
    lines.push("!! live-tennis.eu, GitHub) can be reachable while this one is not.");
    lines.push("!".repeat(78));
    lines.push("");
  }

  const results: TableResult[] = [];
  for (const t of TABLES) {
    let theirs: LiveTennisRow[];
    try {
      theirs = await fetchLiveTennis(ltPath(t.tour, t.kind));
    } catch (err) {
      lines.push(`${t.label}: FETCH FAILED — ${err instanceof Error ? err.message : err}`);
      lines.push("");
      continue;
    }
    const ours = await ourTable(t.tour, t.kind);
    const r = compare(t.label, t.tour, t.kind, ours, theirs, topN);
    results.push(r);
  }

  lines.push("SUMMARY");
  lines.push(
    `  ${pad("table", 14)}${padL("exact", 8)}${padL("<=10", 7)}${padL("<=50", 7)}${padL("rank ok", 9)}${padL("judged", 8)}${padL("dupRank", 9)}`,
  );
  for (const r of results) {
    lines.push(
      `  ${pad(r.label, 14)}${padL(r.correct, 8)}${padL(r.within10, 7)}${padL(r.within50, 7)}${padL(r.rankCorrect, 9)}${padL(r.judged, 8)}${padL(r.duplicateRanks.length, 9)}`,
    );
  }
  lines.push("");

  for (const r of results) {
    lines.push("-".repeat(78));
    lines.push(
      `${r.label}: ${r.correct}/${r.judged} exact  ` +
        `(LT returned ${r.ltRows} rows, we hold ${r.ourRows} in the top ${topN})`,
    );
    if (r.duplicateRanks.length > 0) {
      lines.push(`  DUPLICATE RANKS — always a defect, two players cannot share a position:`);
      for (const d of r.duplicateRanks) lines.push(`    ${d}`);
    }
    if (r.diffs.length === 0) {
      lines.push("  no differences");
      lines.push("");
      continue;
    }
    const missing = r.diffs.filter((d) => d.kind === "missing");
    const wrongPlayer = r.diffs.filter((d) => d.kind === "player");
    const wrongPoints = r.diffs.filter((d) => d.kind === "points");
    lines.push(
      `  differences: ${wrongPoints.length} points, ${wrongPlayer.length} wrong player, ${missing.length} rank we have no row for`,
    );
    for (const d of wrongPoints) {
      const delta = d.ours! - d.theirs;
      lines.push(
        `    PTS  #${padL(d.rank, 3)} ${pad(d.name, 26)} ours ${padL(d.ours!, 6)}  LT ${padL(d.theirs, 6)}  ` +
          `${delta > 0 ? "+" : ""}${delta}${d.status ? `  [${d.status}]` : ""}`,
      );
    }
    for (const d of wrongPlayer) {
      lines.push(`    WHO  #${padL(d.rank, 3)} LT ${pad(d.name, 26)} ours ${d.ourName}`);
    }
    for (const d of missing) {
      lines.push(`    GAP  #${padL(d.rank, 3)} LT ${pad(d.name, 26)} we have no row at this rank`);
    }
    lines.push("");
  }

  const report = lines.join("\n") + "\n";
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, report, "utf-8");

  // Also append a one-line trend record, so progress over days is greppable
  // without opening every daily file.
  const trendPath = join("logs", "live-diff-trend.log");
  const trend =
    `${stamp}  ` +
    results
      .map((r) => `${r.label.replace(" ", "-")}=${r.correct}/${r.judged}`)
      .join("  ") +
    // Tag stale runs so a dip in the trend line is attributable at a glance,
    // rather than looking like a regression in the maths.
    (fresh.worstStaleDays > 1 ? `  STALE=${fresh.worstStaleDays}d` : "") +
    "\n";
  appendFileSync(trendPath, trend, "utf-8");

  process.stdout.write(report);
  process.stdout.write(`\nwritten to ${outPath}\nappended to ${trendPath}\n`);

  // Non-zero when a duplicate rank exists: that is unambiguously our bug,
  // unlike a points difference which may be staleness.
  const dupes = results.reduce((n, r) => n + r.duplicateRanks.length, 0);
  if (dupes > 0) {
    process.stderr.write(`\n${dupes} duplicated rank(s) — see the report.\n`);
    process.exit(1);
  }
}

runEntrypoint(main());
