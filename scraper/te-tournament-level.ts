// The `tournament_level` a TennisExplorer row is stored with.
//
// TE never states a tier. The writer used to run inferCategory() on the bare
// name and map the result back to a TA letter, so everything that was not a
// known Slam / 1000 / 500 became "A" (= 250): ITFs, Challengers, UTR
// exhibitions, the Laver Cup, the Asian Games — and WTA 125s such as
// "Porto WTA", which is a 125 on the official feed.
//
// Resolution order:
//   1. non-ranking events                 -> "X"
//   2. ITF events                         -> "ITF"   (tier unknown, scores 0)
//   3. Challengers                        -> "CH50".."CH175" from the ATP
//                                            calendar, "CH" when unplaced
//   4. WTA events the official WTA feed also carries that week -> its level
//      verbatim ("WTA 125", "WTA 250", ...)
//   5. otherwise the name-based inference, as a TA letter

import { challengerTier, type ChallengerEvent } from "./sources/atp-challenger-calendar";
import { inferCategory, isNonRankingEvent } from "./projections/category-inference";
import type { Category } from "./config/points-table";

export interface OfficialLevelRow {
  key: string;
  playedOn: string;
  level: string;
}

/** Comparison key shared by TE and the official WTA feed ("Porto WTA" = "Porto 125"). */
export function officialEventKey(name: string): string {
  return name
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\b(wta|atp|125|wta125)\b/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export function levelFromCategory(cat: Category): string {
  if (cat === "grand_slam" || cat === "wta_grand_slam") return "G";
  if (cat === "masters_1000" || cat === "wta_1000" || cat === "wta_1000_nc") return "M";
  if (cat === "finals") return "F";
  if (cat === "davis_cup") return "D";
  if (cat === "olympics") return "O";
  if (cat === "non_ranking") return "X";
  if (cat === "itf" || cat === "m15_futures" || cat === "m25_futures") return "ITF";
  if (cat.startsWith("ch_")) return `CH${cat.slice(3)}`;
  if (cat === "wta_125") return "WTA 125";
  // atp_500, atp_250, wta_500, wta_250 share "A" in TA's scheme.
  return "A";
}

export function teTournamentLevel(
  tour: "atp" | "wta",
  teName: string,
  playedOn: string,
  deps: { challengerEvents: ChallengerEvent[]; officialLevels?: OfficialLevelRow[] },
): string {
  if (isNonRankingEvent(teName)) return "X";
  if (/\bITF\b/i.test(teName)) return "ITF";
  if (/\bchallenger\b/i.test(teName)) {
    if (tour === "wta") return "X";
    const tier = challengerTier(deps.challengerEvents, teName, playedOn);
    return tier ? `CH${tier}` : "CH";
  }
  if (tour === "wta" && deps.officialLevels?.length) {
    const key = officialEventKey(teName);
    const t = Date.parse(playedOn);
    const hit = deps.officialLevels.find(
      (r) => r.key === key && Math.abs(Date.parse(r.playedOn) - t) <= 10 * 86_400_000,
    );
    if (hit) return hit.level;
  }
  return levelFromCategory(inferCategory(tour, teName, null));
}

/**
 * Official WTA event levels for the last `days` days, from the rows the WTA
 * API writer stored. Loaded once per run.
 */
export async function loadOfficialLevels(days: number): Promise<OfficialLevelRow[]> {
  const { db } = await import("@/db");
  const { sql } = await import("drizzle-orm");
  const res = await db.execute<{ tournament_name: string; played_on: string; tournament_level: string }>(sql`
    select distinct on (prm.tournament_name, prm.played_on)
      prm.tournament_name, prm.played_on::text as played_on, prm.tournament_level
    from player_recent_matches prm
    where prm.source = 'wta_api'
      and prm.tournament_level is not null
      and prm.played_on >= current_date - ${days}::int
  `);
  const rows =
    (res as unknown as { rows?: Array<Record<string, string>> }).rows ??
    (res as unknown as Array<Record<string, string>>);
  return rows.map((r) => ({
    key: officialEventKey(r.tournament_name!),
    playedOn: r.played_on!,
    level: r.tournament_level!,
  }));
}
