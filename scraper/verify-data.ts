/**
 * Read-only data verification.
 *
 * Answers four questions without opening a browser:
 *   1. How fresh and how deep is each tour's ranking snapshot?
 *   2. How well is match history covered for the players we rank?
 *   3. Does category inference classify those matches sensibly?
 *   4. How far is a naive 52-week points sum from the OFFICIAL published
 *      total, per player?
 *
 * (4) is an early, deliberately crude version of the reconciliation harness.
 * It has no slot caps (ATP best-18, WTA best-6-of-7 + best-1-of-3 + best-7),
 * so it will OVERSTATE any player whose counting results exceed their slots.
 * That is the point: the sign and size of the diff tell you which correction
 * matters next, and the per-tour split shows whether the ATP and WTA tables
 * are behaving differently.
 *
 *   pnpm scraper:verify
 */
import { sql } from "drizzle-orm";
import { db } from "@/db";
import {
  ROUNDS_IN_ORDER,
  canonicalizeRound,
  pointsForRound,
  type Round,
} from "./config/points-table";
import { inferCategory } from "./projections/category-inference";
import { runEntrypoint } from "./exit";

type Tour = "atp" | "wta";

interface MatchRow {
  // db.execute's generic requires an index signature.
  [key: string]: unknown;
  player_id: number;
  full_name: string;
  rank: number;
  official_points: number;
  tournament_name: string;
  tournament_level: string | null;
  round: string;
  won: boolean;
  played_on: string;
}

function pad(s: string | number, n: number): string {
  const str = String(s);
  return str.length >= n ? str.slice(0, n) : str + " ".repeat(n - str.length);
}
function padLeft(s: string | number, n: number): string {
  const str = String(s);
  return str.length >= n ? str : " ".repeat(n - str.length) + str;
}

async function snapshotOverview() {
  console.log("\n=== 1. Ranking snapshot freshness and depth ===\n");
  const rows = await db.execute<{
    tour: string;
    is_race: boolean;
    week_of: string;
    rows: number;
    max_rank: number;
    top_points: number;
  }>(sql`
    select p.tour, rs.is_race, rs.week_of::text as week_of,
           count(*)::int as rows, max(rs.rank)::int as max_rank,
           max(rs.points)::int as top_points
    from rankings_snapshots rs
    join players p on p.id = rs.player_id
    where rs.week_of = (
      select max(week_of) from rankings_snapshots rs2 where rs2.tour = rs.tour
    )
    group by p.tour, rs.is_race, rs.week_of
    order by p.tour, rs.is_race
  `);
  const list = (rows as unknown as { rows: typeof rows }).rows ?? rows;
  console.log(
    `${pad("tour", 6)}${pad("kind", 8)}${pad("week_of", 12)}${padLeft("rows", 6)}${padLeft("deepest", 9)}${padLeft("top pts", 9)}`,
  );
  for (const r of list as unknown as Array<Record<string, unknown>>) {
    console.log(
      pad(String(r.tour), 6) +
        pad(r.is_race ? "race" : "singles", 8) +
        pad(String(r.week_of), 12) +
        padLeft(String(r.rows), 6) +
        padLeft(String(r.max_rank), 9) +
        padLeft(String(r.top_points), 9),
    );
  }
}

async function matchCoverage(topN: number) {
  console.log(`\n=== 2. Match coverage for the top ${topN} ===\n`);
  const rows = await db.execute<Record<string, unknown>>(sql`
    with latest as (
      select p.tour, rs.player_id, rs.rank
      from rankings_snapshots rs
      join players p on p.id = rs.player_id
      where rs.is_race = false
        and rs.week_of = (
          select max(week_of) from rankings_snapshots rs2
          where rs2.tour = p.tour and rs2.is_race = false
        )
        and rs.rank <= ${topN}
    )
    select l.tour,
           count(*)::int as players,
           count(m.player_id)::int as with_matches,
           coalesce(max(m.last_played)::text, '-') as newest_match,
           coalesce(round(avg(m.n)::numeric, 1)::text, '0') as avg_matches
    from latest l
    left join (
      select player_id, count(*)::int as n, max(played_on) as last_played
      from player_recent_matches
      group by player_id
    ) m on m.player_id = l.player_id
    group by l.tour
    order by l.tour
  `);
  const list = ((rows as unknown as { rows: unknown[] }).rows ?? rows) as Array<Record<string, unknown>>;
  console.log(
    `${pad("tour", 6)}${padLeft("ranked", 8)}${padLeft("w/matches", 11)}${padLeft("avg", 7)}${pad("  newest match", 20)}`,
  );
  for (const r of list) {
    console.log(
      pad(String(r.tour), 6) +
        padLeft(String(r.players), 8) +
        padLeft(String(r.with_matches), 11) +
        padLeft(String(r.avg_matches), 7) +
        "  " +
        String(r.newest_match),
    );
  }
}

/**
 * Deepest round reached at one tournament, then the points for it.
 * Mirrors the deriver rule: lost -> that round; won the final -> champion;
 * won a non-final -> advanced one round on the ladder.
 */
function earnedAt(
  matches: MatchRow[],
  tour: Tour,
): { points: number; category: string; round: Round | "W" } | null {
  const first = matches[0]!;
  const category = inferCategory(tour, first.tournament_name, first.tournament_level);
  let deepestIdx = -1;
  let deepestRound: Round | null = null;
  let deepestWon = false;
  for (const m of matches) {
    const r = canonicalizeRound(m.round, category);
    if (!r) continue;
    const idx = ROUNDS_IN_ORDER.indexOf(r);
    if (idx > deepestIdx) {
      deepestIdx = idx;
      deepestRound = r;
      deepestWon = m.won;
    }
  }
  if (!deepestRound) return null;
  if (deepestWon) {
    if (deepestRound === "F") {
      return { points: pointsForRound(category, "W"), category, round: "W" };
    }
    const next = ROUNDS_IN_ORDER[deepestIdx + 1] ?? "W";
    return { points: pointsForRound(category, next), category, round: next };
  }
  return { points: pointsForRound(category, deepestRound), category, round: deepestRound };
}

async function reconcile(topN: number) {
  console.log(`\n=== 3 + 4. Naive 52-week sum vs official published points (top ${topN}) ===\n`);

  const rows = await db.execute<MatchRow>(sql`
    with latest as (
      select p.tour, rs.player_id, rs.rank, rs.points, p.full_name
      from rankings_snapshots rs
      join players p on p.id = rs.player_id
      where rs.is_race = false
        and rs.week_of = (
          select max(week_of) from rankings_snapshots rs2
          where rs2.tour = p.tour and rs2.is_race = false
        )
        and rs.rank <= ${topN}
    ),
    deduped as (
      -- Date-free dedupe key. The documented (player, played_on, opponent)
      -- key cannot collide across sources, because Tennis Abstract stamps
      -- every match at an event with the tournament START date while
      -- TennisExplorer uses the real match date.
      select distinct on (
        prm.player_id, prm.tournament_name, prm.round, lower(prm.opponent_name)
      )
        prm.player_id, prm.tournament_name, prm.tournament_level,
        prm.round, prm.won, prm.played_on
      from player_recent_matches prm
      join latest l on l.player_id = prm.player_id
      where prm.played_on >= (current_date - interval '52 weeks')
      order by prm.player_id, prm.tournament_name, prm.round,
               lower(prm.opponent_name),
               case prm.source when 'atp_site' then 0 when 'tennis_explorer' then 1 else 2 end
    )
    select l.tour, l.player_id, l.full_name, l.rank,
           l.points as official_points,
           d.tournament_name, d.tournament_level, d.round, d.won,
           d.played_on::text as played_on
    from latest l
    join deduped d on d.player_id = l.player_id
    order by l.tour, l.rank
  `);
  const list = ((rows as unknown as { rows: unknown[] }).rows ?? rows) as unknown as Array<
    MatchRow & { tour: Tour }
  >;

  // player -> tournament -> matches
  const byPlayer = new Map<
    number,
    { tour: Tour; name: string; rank: number; official: number; events: Map<string, MatchRow[]> }
  >();
  for (const r of list) {
    let p = byPlayer.get(r.player_id);
    if (!p) {
      p = {
        tour: r.tour,
        name: r.full_name,
        rank: Number(r.rank),
        official: Number(r.official_points),
        events: new Map(),
      };
      byPlayer.set(r.player_id, p);
    }
    const key = r.tournament_name;
    const arr = p.events.get(key) ?? [];
    arr.push(r);
    p.events.set(key, arr);
  }

  const categoryCounts = new Map<string, number>();
  const perTour: Record<Tour, Array<{ name: string; rank: number; official: number; computed: number }>> = {
    atp: [],
    wta: [],
  };

  for (const p of byPlayer.values()) {
    let total = 0;
    for (const matches of p.events.values()) {
      const e = earnedAt(matches, p.tour);
      if (!e) continue;
      total += e.points;
      categoryCounts.set(e.category, (categoryCounts.get(e.category) ?? 0) + 1);
    }
    perTour[p.tour].push({ name: p.name, rank: p.rank, official: p.official, computed: total });
  }

  console.log("Category distribution across counted events:");
  for (const [cat, n] of [...categoryCounts.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`   ${pad(cat, 18)} ${padLeft(n, 5)}`);
  }

  for (const tour of ["atp", "wta"] as Tour[]) {
    const players = perTour[tour].sort((a, b) => a.rank - b.rank);
    if (players.length === 0) {
      console.log(`\n${tour.toUpperCase()}: no players with match data.`);
      continue;
    }
    const ratios = players.map((p) => (p.official > 0 ? p.computed / p.official : 0));
    const median = ratios.slice().sort((a, b) => a - b)[Math.floor(ratios.length / 2)]!;
    const within10 = players.filter(
      (p) => p.official > 0 && Math.abs(p.computed - p.official) / p.official <= 0.1,
    ).length;

    console.log(
      `\n${tour.toUpperCase()}: ${players.length} players with matches · ` +
        `median computed/official = ${median.toFixed(2)} · ` +
        `${within10} within 10%`,
    );
    console.log(
      `   ${pad("rk", 4)}${pad("player", 24)}${padLeft("official", 9)}${padLeft("computed", 9)}${padLeft("diff", 9)}${padLeft("ratio", 7)}`,
    );
    for (const p of players.slice(0, 10)) {
      const diff = p.computed - p.official;
      console.log(
        "   " +
          pad(p.rank, 4) +
          pad(p.name, 24) +
          padLeft(p.official, 9) +
          padLeft(p.computed, 9) +
          padLeft((diff > 0 ? "+" : "") + diff, 9) +
          padLeft(p.official > 0 ? (p.computed / p.official).toFixed(2) : "-", 7),
      );
    }
  }
}

async function main() {
  const args = process.argv.slice(2);
  const topIdx = args.indexOf("--top");
  const topN = topIdx >= 0 && args[topIdx + 1] ? Number(args[topIdx + 1]) : 200;

  await snapshotOverview();
  await matchCoverage(topN);
  await reconcile(topN);
  console.log("");
}

runEntrypoint(main());
