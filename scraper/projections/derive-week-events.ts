// Every event each player has played in the current ranking week, scored with
// what they have secured there (event-points.ts).
//
// derive-live-state reports a single "current tournament" per player — the
// event of their LATEST match — which is right for display but loses credit
// the live total needs: qualifying played before the main draw, and a second
// event in the same week (a Challenger loser who then plays qualifying
// elsewhere). The live total is the sum over all of them.

import { sql } from "drizzle-orm";
import { db } from "@/db";
import { canonicalizeRound, type Category } from "../config/points-table";
import { inferCategory, isNonRankingEvent } from "./category-inference";
import { normSql } from "./tournament-key";
import { securedAtEvent, type EventMatch } from "./event-points";
import { normaliseTournamentKey } from "./derive-live-points";

export interface WeekEvent {
  key: string;
  name: string;
  category: Category;
  points: number;
  inProgress: boolean;
  /** Played a main-draw match (not only qualifying). */
  mainDraw: boolean;
}

interface Options {
  tour: "atp" | "wta";
  playerIds: number[];
  /** ITF tier ("itf_w100", ...) for an event name, when it can be priced. */
  itfTier?: (name: string) => string | null;
}

const SOURCE_RANK: Record<string, number> = { atp_site: 0, wta_api: 0, tennis_explorer: 1 };

/** Monday 00:00 UTC of the current ranking week, as an ISO date. */
export function currentWeekStart(now = new Date()): string {
  const d = new Date(now.getTime());
  const back = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - back);
  return d.toISOString().slice(0, 10);
}

export async function deriveWeekEvents(opts: Options): Promise<Map<number, WeekEvent[]>> {
  const out = new Map<number, WeekEvent[]>();
  if (opts.playerIds.length === 0) return out;
  const weekStart = currentWeekStart();
  // Qualifying for this week's events is played from the Friday before.
  const qualifyingFrom = new Date(Date.parse(`${weekStart}T00:00:00Z`) - 3 * 864e5).toISOString().slice(0, 10);

  // An event whose Final was played before this week is already in the
  // official total (the delayed-Final rule is derive-live-state's
  // finished_tournaments: a Monday/Tuesday Final of an event whose main draw
  // began before the week belongs to last week too).
  const res = await db.execute(sql`
    with es as (
      select ${normSql("prm.tournament_name")} as k, extract(year from prm.played_on)::int as yr,
             min(prm.played_on) as md_start
      from player_recent_matches prm join players p on p.id = prm.player_id
      where p.tour = ${opts.tour} and prm.round !~ '^Q[-0-9]' and prm.played_on >= current_date - 60
      group by 1, 2
    ),
    finished as (
      select distinct ${normSql("prm.tournament_name")} as k, extract(year from prm.played_on)::int as yr
      from player_recent_matches prm
      join players p on p.id = prm.player_id
      left join es on es.k = ${normSql("prm.tournament_name")} and es.yr = extract(year from prm.played_on)::int
      where p.tour = ${opts.tour} and prm.round = 'F'
        and (prm.played_on < ${weekStart}::date
             or (prm.played_on <= ${weekStart}::date + 1 and es.md_start < ${weekStart}::date - 1))
    )
    select prm.player_id, prm.tournament_name, prm.tournament_level, prm.round, prm.won,
           prm.played_on::text as played_on, prm.source,
           ${normSql("prm.tournament_name")} as k
    from player_recent_matches prm
    left join finished f on f.k = ${normSql("prm.tournament_name")}
                        and f.yr = extract(year from prm.played_on)::int
    where prm.player_id = any(array[${sql.join(opts.playerIds.map((id) => sql`${id}`), sql`, `)}]::int[])
      and f.k is null
      and (prm.played_on >= ${weekStart}::date
           or (prm.round ~ '^Q[-0-9]' and prm.played_on >= ${qualifyingFrom}::date))
      and prm.tournament_level is distinct from 'X'
  `);
  const rows = ((res as unknown as { rows?: Array<Record<string, unknown>> }).rows ??
    (res as unknown as Array<Record<string, unknown>>));

  // player -> event key -> rows
  const grouped = new Map<number, Map<string, Array<Record<string, unknown>>>>();
  for (const r of rows) {
    const pid = Number(r.player_id);
    const byEvent = grouped.get(pid) ?? new Map();
    // Grouped on the JS key, which also folds "Tokyo (Japan Open)" into
    // "Tokyo"; the SQL key does not, and would credit such an event twice.
    // The tier number goes too: the WTA API says "Courmayeur 125" where
    // TennisExplorer says "Courmayeur", and as two keys every WTA 125 result
    // was credited twice.
    const k = normaliseTournamentKey(String(r.tournament_name)).replace(/\b(125|250|500|1000)\b/g, " ").replace(/\s+/g, " ").trim();
    const arr = byEvent.get(k) ?? [];
    arr.push(r);
    byEvent.set(k, arr);
    grouped.set(pid, byEvent);
  }

  for (const [pid, byEvent] of grouped) {
    const events: WeekEvent[] = [];
    for (const [k, evRows] of byEvent) {
      // Category from the most informative row: a stored level wins.
      const withLevel = evRows.find((r) => r.tournament_level != null) ?? evRows[0]!;
      const name = String(withLevel.tournament_name);
      if (isNonRankingEvent(name)) continue;
      const category = inferCategory(opts.tour, name, (withLevel.tournament_level as string | null) ?? null);
      if (category === "non_ranking") continue;
      // One row per round: the feeds overlap, and the official one wins.
      const byRound = new Map<string, Record<string, unknown>>();
      for (const r of evRows) {
        const round = canonicalizeRound(String(r.round), category) ?? String(r.round);
        const prev = byRound.get(round);
        const rank = SOURCE_RANK[String(r.source)] ?? 2;
        if (!prev || rank < (SOURCE_RANK[String(prev.source)] ?? 2)) byRound.set(round, r);
      }
      const matches: EventMatch[] = [...byRound.values()].map((r) => ({
        round: String(r.round),
        won: r.won === true,
        playedOn: String(r.played_on),
      }));
      const itf = category === "itf" ? (opts.itfTier?.(name) ?? null) : null;
      const credit = securedAtEvent(opts.tour, category, matches, itf);
      // Any "Q..." label but "QF" is qualifying: TennisExplorer writes
      // "Q-R16", which canonicalizeRound cannot place.
      const mainDraw = matches.some((m) => !/^Q(?!F)/i.test(m.round.trim()));
      events.push({ key: k, name, category, points: credit.points, inProgress: credit.inProgress, mainDraw });
    }
    out.set(pid, events);
  }
  return out;
}
