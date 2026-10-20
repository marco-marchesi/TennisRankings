// Archive matches -> editions (one per tourney_id, across ALL files: a tour
// event's qualifying lives in *_qual_chall / *_qual_itf under the same id) ->
// what each player earned there and when it counts.
import { finalsPoints, type Round } from "../config/points-table";
import { addDays, mondayAfter } from "../projections/drop-horizon";
import type { ChallengerEvent } from "../sources/atp-challenger-calendar";
import { archiveCategory } from "./category";
import { eraTable, seasonOf, type ReplayTier } from "./points-eras";
import { unitedCupPoints, type UnitedCupMatch, type UnitedCupStage } from "./united-cup";
import type { ArchiveMatch, Edition, PlayerResult, Tour } from "./types";

const MD_LADDER: Round[] = ["R128", "R64", "R32", "R16", "QF", "SF", "F"];

interface Played {
  md: Array<{ idx: number; won: boolean }>;
  q: Array<{ n: number; won: boolean }>;
  rrWins: number;
  wonSf: boolean;
  wonFinal: boolean;
  enteredAsQualifier: boolean;
}

function newPlayed(): Played {
  return { md: [], q: [], rrWins: 0, wonSf: false, wonFinal: false, enteredAsQualifier: false };
}

export function buildEditions(
  tour: Tour,
  matches: ArchiveMatch[],
  challengerEvents?: ChallengerEvent[],
): { editions: Map<string, Edition>; results: PlayerResult[] } {
  const byId = new Map<string, ArchiveMatch[]>();
  for (const m of matches) {
    const list = byId.get(m.tourneyId);
    if (list) list.push(m);
    else byId.set(m.tourneyId, [m]);
  }

  const editions = new Map<string, Edition>();
  const results: PlayerResult[] = [];

  for (const [tourneyId, rows] of byId) {
    // Main-draw rows carry the real draw size; qualifying rows carry the
    // qualifying draw's.
    const md = rows.filter((r) => !r.round.startsWith("Q"));
    const meta = md[0] ?? rows[0]!;
    const start = rows.reduce((min, r) => (r.tourneyDate < min ? r.tourneyDate : min), meta.tourneyDate);
    const tier = archiveCategory(tour, meta.level, meta.tourneyName, meta.drawSize, start, challengerEvents);
    const edition: Edition = {
      key: `${tour}:${tourneyId}`,
      tour,
      name: meta.tourneyName,
      level: meta.level,
      drawSize: meta.drawSize,
      start,
      category: tier.category,
      tier: (tier.replayTier as ReplayTier | undefined) ?? tier.category,
      variant: tier.variant,
      gap: tier.gap,
    };
    editions.set(edition.key, edition);

    const played = new Map<string, Played>();
    const get = (pid: string) => {
      let p = played.get(pid);
      if (!p) played.set(pid, (p = newPlayed()));
      return p;
    };
    // United Cup points are per match (united-cup.ts), so keep each player's.
    const ucMatches = new Map<string, UnitedCupMatch[]>();
    let maxQ = 0;
    for (const r of rows) {
      if (edition.tier === "united_cup" && ["RR", "QF", "SF", "F"].includes(r.round)) {
        const stage = r.round as UnitedCupStage;
        for (const [pid, won, opp] of [[r.winnerId, true, r.loserRank], [r.loserId, false, r.winnerRank]] as const) {
          const list = ucMatches.get(pid) ?? [];
          list.push({ stage, won, oppRank: opp ?? null });
          ucMatches.set(pid, list);
        }
      }
      const q = r.round.match(/^Q(\d)$/);
      for (const [pid, won, entry] of [
        [r.winnerId, true, r.winnerEntry],
        [r.loserId, false, r.loserEntry],
      ] as const) {
        const p = get(pid);
        if (entry === "Q") p.enteredAsQualifier = true;
        if (q) {
          const n = Number(q[1]);
          maxQ = Math.max(maxQ, n);
          p.q.push({ n, won });
        } else if (r.round === "RR") {
          if (won) p.rrWins++;
        } else {
          const idx = MD_LADDER.indexOf(r.round as Round);
          if (idx < 0) continue;
          p.md.push({ idx, won });
          if (won && r.round === "SF") p.wonSf = true;
          if (won && r.round === "F") p.wonFinal = true;
        }
      }
    }

    const entryWeek = addDays(
      mondayOnOrAfter(addDays(start, finalOffsetDays(edition))),
      enteredLate(edition) ? 7 : 0,
    );
    // The ATP Finals leave on the Monday after the last regular event of the
    // following season, a week before their 52 weeks (docs/ranking-rules.md:11).
    const atpFinals = tour === "atp" && edition.category === "finals";
    const expiryWeek = addDays(entryWeek, atpFinals ? 357 : 364);

    // An event that can never award points produces no result at all: its
    // rows would only count toward best_n and raise false data flags.
    if (edition.category && ZERO_POINT.has(edition.category)) continue;
    for (const [playerId, p] of played) {
      const scored =
        edition.tier === "united_cup" ? scoreUnitedCup(edition, ucMatches.get(playerId) ?? []) : scorePlayer(edition, p, maxQ);
      results.push({
        playerId,
        editionKey: edition.key,
        editionName: edition.name,
        points: scored.points,
        category: edition.category,
        mainDraw: p.md.length > 0 || p.rrWins > 0 || p.wonSf || p.wonFinal,
        entryWeek,
        expiryWeek,
        isFinals: edition.category === "finals",
        gaps: scored.gaps,
      });
    }
  }
  return { editions, results };
}

/**
 * Days from the archive's `tourney_date` to the final. Measured on the 2025
 * calendar: a Slam's date is its Monday and the final the Sunday 13 days
 * later; a two-week 1000's date is its first day and the final falls 11 days
 * later on whatever weekday that is (Cincinnati Thu 7 -> Mon 18 Aug); a
 * one-week event's final is within 6 days of its date.
 *
 * Whether a 1000 runs two weeks is read from its draw: Canada and Cincinnati
 * were 56-draw single weeks until 2025, so the name cannot tell.
 */
function finalOffsetDays(edition: Edition): number {
  const cat = edition.category;
  if (cat === "grand_slam" || cat === "wta_grand_slam") return 13;
  if (cat === "masters_1000" || cat === "wta_1000") {
    return edition.drawSize != null && edition.drawSize >= 96 ? 11 : 6;
  }
  return 6;
}

/**
 * The two lowest WTA ITF tiers (W15 and W25 in 2023, W15 and W35 from 2024)
 * reach the WTA ranking a week after the rest. Replay evidence, 2026-10-13:
 * of single-result steps where the official total moved by exactly the
 * result, W15 / W25 / W35 moved the FOLLOWING week ~4x as often as the same
 * week (2023-2025, 1,300+ results); W40 and up moved the same week ~3x as
 * often as the next. The ATP's ITF tier likewise: M15 2025 next/same week
 * 526/203, M25 237/75.
 */
function enteredLate(edition: Edition): boolean {
  if (edition.tier === "m15_futures" || edition.tier === "m25_futures") return true;
  if (edition.tour !== "wta" || !edition.tier?.startsWith("itf_w")) return false;
  const n = Number(edition.tier.match(/^itf_w(\d+)/)![1]);
  return n === 15 || n === (edition.start < "2023-12-25" ? 25 : 35);
}

/** A final played on a Monday is already in that Monday's ranking (Cincinnati 2025). */
function mondayOnOrAfter(d: string): string {
  return new Date(`${d}T00:00:00Z`).getUTCDay() === 1 ? d : mondayAfter(d);
}

/** Categories that can never award points. */
const ZERO_POINT = new Set(["davis_cup", "non_ranking"]);

function scoreUnitedCup(edition: Edition, matches: UnitedCupMatch[]): { points: number; gaps: string[] } {
  const season = seasonOf(edition.tour, edition.start);
  const points = season ? unitedCupPoints(edition.tour, season, matches) : null;
  return points == null ? { points: 0, gaps: [`points_era:${edition.tour}:united_cup:${season ?? "?"}`] } : { points, gaps: [] };
}

function scorePlayer(edition: Edition, p: Played, maxQ: number): { points: number; gaps: string[] } {
  const tier = edition.tier;
  if (!tier) return { points: 0, gaps: [edition.gap ?? "unknown_tier"] };
  // Each result is worth what its own season's table paid (points-eras.ts).
  // A tier/season no source covers is a gap, never a neighbour's values.
  const season = seasonOf(edition.tour, edition.start);
  const table = season ? eraTable(edition.tour, tier, season, edition.drawSize, edition.variant) : null;
  if (!table) return { points: 0, gaps: [`points_era:${edition.tour}:${tier}:${season ?? edition.start.slice(0, 4)}`] };
  if (tier === "finals") {
    return { points: finalsPoints({ rrWins: p.rrWins, wonSf: p.wonSf, wonFinal: p.wonFinal }), gaps: [] };
  }
  const gaps: string[] = [];
  if (p.md.length > 0) {
    const deepest = p.md.reduce((a, b) => (b.idx > a.idx ? b : a));
    let round: Round;
    if (!deepest.won) round = MD_LADDER[deepest.idx]!;
    else if (MD_LADDER[deepest.idx] === "F") round = "W";
    else {
      round = MD_LADDER[deepest.idx + 1]!;
      gaps.push("incomplete_edition");
    }
    const qualifier = p.q.length > 0 || p.enteredAsQualifier;
    let points = table.main[round] ?? 0;
    // A WTA qualifier who loses her first main-draw match earns the qualifying
    // points only, not the first-round points on top. Replay evidence,
    // 2026-10-13: WTA full exact 9.8% -> 19.2%, clean delta 77.0% -> 79.6% of
    // 41.7k player-weeks; the same rule on the ATP scored lower (clean delta
    // 77.7% -> 77.5%), so ATP qualifiers keep it.
    if (qualifier && edition.tour === "wta" && p.md.length === 1 && !p.md[0]!.won) points = 0;
    if (qualifier) points += table.qualifierBonus;
    return { points, gaps };
  }
  const lost = p.q.find((x) => !x.won);
  if (!lost) return { points: 0, gaps: ["incomplete_edition"] };
  // Counted from the END of the qualifying ladder: the last round's loser is
  // `qual(0)`, whatever the round is called.
  return { points: table.qual(maxQ - lost.n, maxQ), gaps };
}
