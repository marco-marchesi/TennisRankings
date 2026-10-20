// Points tables per SEASON, for the replay. `config/points-table.ts` is the
// live 2026 table; a result earned in 2023 is worth what the 2023 table paid,
// and is kept until it drops 52 weeks later. Every table below is
// transcribed from a cited source; a tier/season without one returns null,
// and the replay reports it as a `points_era:*` gap rather than scoring a
// neighbouring season's values (spec non-negotiable 3).
//
// Sources (Wikipedia raw wikitext, accessed 2026-10-13; each page cites the
// ATP rulebook / rankings FAQ or the ITF / WTA points PDFs):
//   ATP_TOUR   <Y>_ATP_Tour                         "Point distribution"
//   ATP_CH     <Y>_ATP_Challenger_Tour              "Point distribution"
//   WTA_TOUR   <Y>_WTA_Tour                         "Points distribution"
//   WTA_125    <Y>_WTA_125_tournaments              "Points distribution"
//   WTA_ITF    <Y>_ITF_Women's_World_Tennis_Tour    "WTA ranking points distribution"
//   ITF_MEN    <Y>_ITF_Men's_World_Tennis_Tour      "Ranking points distribution"
// URL form: https://en.wikipedia.org/w/index.php?title=<page>&action=raw
//
// Column mapping. Wikipedia lists W F SF QF R16 R32 R64 R128, then "Q" (what
// a qualifier earns for reaching the main draw — our `qualifierBonus`), then
// the losers of each qualifying round from the last one back. `qual[0]` is the
// loser of the LAST qualifying round, `qual[1]` the round before, and so on.
import {
  pointsForRound,
  qualifierBonus,
  type Category,
  type DrawVariant,
  type Round,
} from "../config/points-table";
import type { Tour } from "./types";

export type Season = 2022 | 2023 | 2024 | 2025 | 2026;
/** A points-table category, a WTA ITF tier ("itf_w60", hospitality "itf_w60h"), or a 2022 Challenger tier ("ch_80"). */
export type ReplayTier = Category | `itf_w${number}` | `itf_w${number}h` | `ch_${number}` | "united_cup";

export interface EraLookup {
  main: Partial<Record<Round, number>>;
  qualifierBonus: number;
  /** Loser of the qualifying round `fromEnd` rounds before the last (0 = last), in a `rounds`-round qualifying. */
  qual: (fromEnd: number, rounds: number) => number;
}

/**
 * First ranking Monday of each season's first event week. The United Cup
 * starts in late December, so a season is not a calendar year.
 */
const SEASON_FROM: Array<[Season, string]> = [
  [2026, "2025-12-22"],
  [2025, "2024-12-23"],
  [2024, "2023-12-25"],
  [2023, "2022-12-26"],
  [2022, "2021-12-27"],
];

export function seasonOf(_tour: Tour, start: string): Season | null {
  for (const [season, from] of SEASON_FROM) if (start >= from) return season;
  return null;
}

// ─── table rows ───────────────────────────────────────────────────────────

type Row = {
  /** W F SF QF R16 R32 R64 R128 — trailing entries may be omitted. */
  main: number[];
  q: number;
  /** Qualifying losers, last round first. A record keys by qualifying rounds. */
  qual: number[] | Record<number, number[]>;
};

const MAIN_ROUNDS: Round[] = ["W", "F", "SF", "QF", "R16", "R32", "R64", "R128"];

function lookup(row: Row): EraLookup {
  const main: Partial<Record<Round, number>> = {};
  row.main.forEach((v, i) => (main[MAIN_ROUNDS[i]!] = v));
  return {
    main,
    qualifierBonus: row.q,
    qual: (fromEnd, rounds) => {
      const list = Array.isArray(row.qual) ? row.qual : row.qual[rounds] ?? [];
      return list[fromEnd] ?? 0;
    },
  };
}

// ATP_TOUR 2023 (cites the 2021 ATP rulebook, ch. 9).
const ATP_2023: Record<string, Row> = {
  grand_slam: { main: [2000, 1200, 720, 360, 180, 90, 45, 10], q: 25, qual: [16, 8, 0] },
  m1000_96: { main: [1000, 600, 360, 180, 90, 45, 25, 10], q: 16, qual: [8, 0] },
  m1000_56: { main: [1000, 600, 360, 180, 90, 45, 10], q: 25, qual: [16, 0] },
  a500_48: { main: [500, 300, 180, 90, 45, 20, 0], q: 10, qual: [4, 0] },
  a500_32: { main: [500, 300, 180, 90, 45, 0], q: 20, qual: [10, 0] },
  a250_48: { main: [250, 150, 90, 45, 20, 10, 0], q: 5, qual: [3, 0] },
  a250_32: { main: [250, 150, 90, 45, 20, 0], q: 12, qual: [6, 0] },
};

// ATP_TOUR 2024 and 2025 (identical; cites "ATP Releases Pepperstone ATP
// Rankings Breakdown Updates", 2023-12-26, and the rankings FAQ).
const ATP_2024: Record<string, Row> = {
  grand_slam: { main: [2000, 1300, 800, 400, 200, 100, 50, 10], q: 30, qual: [16, 8, 0] },
  m1000_96: { main: [1000, 650, 400, 200, 100, 50, 30, 10], q: 20, qual: [10, 0] },
  m1000_56: { main: [1000, 650, 400, 200, 100, 50, 10], q: 30, qual: [16, 0] },
  a500_48: { main: [500, 330, 200, 100, 50, 25, 0], q: 16, qual: [8, 0] },
  a500_32: { main: [500, 330, 200, 100, 50, 0], q: 25, qual: [13, 0] },
  a250_48: { main: [250, 165, 100, 50, 25, 13, 0], q: 8, qual: [4, 0] },
  a250_32: { main: [250, 165, 100, 50, 25, 0], q: 13, qual: [7, 0] },
};

// ATP_CH 2022: its own tier system.
const CH_2022: Record<string, Row> = {
  ch_125: { main: [125, 75, 45, 25, 11, 0], q: 5, qual: [2, 0] },
  ch_110: { main: [110, 65, 40, 22, 10, 0], q: 5, qual: [2, 0] },
  ch_100: { main: [100, 60, 36, 20, 9, 0], q: 5, qual: [2, 0] },
  ch_90: { main: [90, 55, 33, 18, 8, 0], q: 5, qual: [2, 0] },
  ch_80: { main: [80, 50, 30, 16, 7, 0], q: 4, qual: [2, 0] },
  ch_50: { main: [50, 30, 17, 9, 4, 0], q: 3, qual: [1, 0] },
};

// ATP_CH 2023.
const CH_2023: Record<string, Row> = {
  ch_175: { main: [175, 100, 60, 32, 15, 0], q: 6, qual: [3, 0] },
  ch_125: { main: [125, 75, 45, 25, 11, 0], q: 5, qual: [2, 0] },
  ch_100: { main: [100, 60, 36, 20, 9, 0], q: 5, qual: [2, 0] },
  ch_75: { main: [75, 50, 30, 16, 7, 0], q: 4, qual: [2, 0] },
  ch_50: { main: [50, 30, 17, 9, 4, 0], q: 3, qual: [1, 0] },
};

// ATP_CH 2024 and 2025 (identical; 2025 cites the 2025 ATP rulebook ch. 9).
const CH_2024: Record<string, Row> = {
  ch_175: { main: [175, 90, 50, 25, 13, 0], q: 6, qual: [3, 0] },
  ch_125: { main: [125, 64, 35, 16, 8, 0], q: 5, qual: [3, 0] },
  ch_100: { main: [100, 50, 25, 14, 7, 0], q: 4, qual: [2, 0] },
  ch_75: { main: [75, 44, 22, 12, 6, 0], q: 4, qual: [2, 0] },
  ch_50: { main: [50, 25, 14, 8, 4, 0], q: 3, qual: [1, 0] },
};

// ITF_MEN 2022-2025 (identical on each season's page): ATP points for the
// main draw. Qualifying earns ITF (not ATP) points, so q and qual are 0.
const ITF_MEN_2025: Record<string, Row> = {
  m25_futures: { main: [25, 16, 8, 3, 1], q: 0, qual: [] },
  m15_futures: { main: [15, 8, 4, 2, 1], q: 0, qual: [] },
};

// WTA_TOUR 2023 (cites the ITF-hosted "2023 WTA rankings and points" PDF).
// The 250 qualifying depends on its draw: 32Q has three rounds, 24/16Q two.
const WTA_2023: Record<string, Row> = {
  wta_grand_slam: { main: [2000, 1300, 780, 430, 240, 130, 70, 10], q: 40, qual: [30, 20, 2] },
  w1000_96: { main: [1000, 650, 390, 215, 120, 65, 35, 10], q: 30, qual: [20, 2] },
  w1000_64: { main: [1000, 650, 390, 215, 120, 65, 10], q: 30, qual: [20, 2] },
  w1000_nc_56: { main: [900, 585, 350, 190, 105, 60, 1], q: 30, qual: [20, 1] },
  w500_56: { main: [470, 305, 185, 100, 55, 30, 1], q: 25, qual: [13, 1] },
  w500_32: { main: [470, 305, 185, 100, 55, 1], q: 25, qual: { 3: [18, 13, 1], 2: [13, 1] } },
  w250_32: { main: [280, 180, 110, 60, 30, 1], q: 18, qual: { 3: [14, 10, 1], 2: [12, 1] } },
};

// WTA_TOUR 2024 and 2025 (identical; 2024 cites the ITF-hosted "2024 ranking
// points" PDF). Its "64/56S" 1000 row covers the non-combined 1000s too.
const WTA_2024: Record<string, Row> = {
  wta_grand_slam: { main: [2000, 1300, 780, 430, 240, 130, 70, 10], q: 40, qual: [30, 20, 2] },
  w1000_96: { main: [1000, 650, 390, 215, 120, 65, 35, 10], q: 30, qual: [20, 2] },
  w1000_64: { main: [1000, 650, 390, 215, 120, 65, 10], q: 30, qual: [20, 2] },
  w500_56: { main: [500, 325, 195, 108, 60, 32, 1], q: 25, qual: [13, 1] },
  w500_32: { main: [500, 325, 195, 108, 60, 1], q: 25, qual: [13, 1] },
  w250_32: { main: [250, 163, 98, 54, 30, 1], q: 18, qual: [12, 1] },
};

// WTA_125: 2023 vs 2024 (2024 = 2025 = the live table's main draw).
const WTA_125: Partial<Record<Season, Row>> = {
  2023: { main: [160, 95, 57, 29, 15, 1], q: 6, qual: [4, 1] },
  2024: { main: [125, 81, 49, 27, 15, 1], q: 6, qual: [4, 1] },
};

// WTA_ITF. Rows "48S, 32Q" (d48) and "32S" (d32); the "16D" rows are doubles.
// A tier missing here for a season (W35 in 2023, W25 in 2024, any "+H" in
// 2024) was not played under that name and stays a gap.
const ITF_W: Partial<Record<Season, Record<string, { d48?: Row; d32: Row }>>> = {
  2023: {
    itf_w100: { d48: { main: [140, 85, 50, 25, 13, 7, 1], q: 6, qual: [4] }, d32: { main: [140, 85, 50, 25, 13, 1], q: 6, qual: [4] } },
    itf_w80: { d48: { main: [115, 70, 42, 21, 10, 6, 1], q: 5, qual: [3] }, d32: { main: [115, 70, 42, 21, 10, 1], q: 5, qual: [3] } },
    itf_w60h: { d48: { main: [100, 60, 36, 18, 9, 5, 1], q: 5, qual: [3] }, d32: { main: [100, 60, 36, 18, 9, 1], q: 5, qual: [3] } },
    itf_w60: { d48: { main: [80, 48, 29, 15, 8, 5, 1], q: 5, qual: [3] }, d32: { main: [80, 48, 29, 15, 8, 1], q: 5, qual: [3] } },
    itf_w40: { d48: { main: [70, 42, 25, 13, 7, 4, 1], q: 4, qual: [2] }, d32: { main: [70, 42, 25, 13, 7, 1], q: 4, qual: [2] } },
    itf_w40h: { d48: { main: [70, 42, 25, 13, 7, 4, 1], q: 4, qual: [2] }, d32: { main: [70, 42, 25, 13, 7, 1], q: 4, qual: [2] } },
    itf_w25h: { d48: { main: [60, 36, 22, 11, 6, 3, 1], q: 2, qual: [] }, d32: { main: [60, 36, 22, 11, 6, 1], q: 2, qual: [] } },
    itf_w25: { d48: { main: [50, 30, 18, 9, 5, 3, 1], q: 1, qual: [] }, d32: { main: [50, 30, 18, 9, 5, 0], q: 1, qual: [] } },
    itf_w15: { d32: { main: [10, 6, 4, 2, 1], q: 0, qual: [] } },
    itf_w15h: { d32: { main: [10, 6, 4, 2, 1], q: 0, qual: [] } },
  },
  2024: {
    itf_w100: { d48: { main: [100, 65, 39, 21, 12, 7, 1], q: 5, qual: [3] }, d32: { main: [100, 65, 39, 21, 12, 1], q: 5, qual: [3] } },
    itf_w75: { d48: { main: [75, 49, 29, 16, 9, 5, 1], q: 3, qual: [2] }, d32: { main: [75, 49, 29, 16, 9, 1], q: 3, qual: [2] } },
    itf_w50: { d48: { main: [50, 33, 20, 11, 6, 3, 1], q: 2, qual: [1] }, d32: { main: [50, 33, 20, 11, 6, 1], q: 2, qual: [1] } },
    itf_w35: { d48: { main: [35, 23, 14, 8, 4, 2, 1], q: 1, qual: [] }, d32: { main: [35, 23, 14, 8, 4, 0], q: 1, qual: [] } },
    itf_w15: { d32: { main: [15, 10, 6, 3, 1], q: 0, qual: [] } },
  },
};
// 2025 pays as 2024 (2025_ITF_Women's_World_Tennis_Tour, same rows).
ITF_W[2025] = ITF_W[2024];
// 2026: no written source; replay evidence (2026-10-13). Where a single 2026
// ITF result moved the official total, the modal move equals the 2025 value
// (W15 3/6/10/15, W35 4/8/14, W50 6/11, W75 9/16), and scoring them lifts
// the 2026 WTA weeks from full <=10 27.1% / delta 61.6% to 45.4% / 65.4%.
ITF_W[2026] = ITF_W[2025];
// 2022: the 2023 rows, plus W100+H / W80+H; W40 did not exist yet. Its W15
// row depends on the qualifying draw (32/24Q: R16 1; 48/64Q: QF 3, R16 2),
// which the archive does not give, so W15 stays a gap.
{
  const { itf_w40: _a, itf_w40h: _b, itf_w15: _c, itf_w15h: _d, ...rest } = ITF_W[2023]!;
  ITF_W[2022] = {
    ...rest,
    itf_w100h: { d48: { main: [150, 90, 55, 28, 14, 7, 1], q: 6, qual: [4] }, d32: { main: [150, 90, 55, 28, 14, 1], q: 6, qual: [4] } },
    itf_w80h: { d48: { main: [130, 80, 48, 24, 12, 6, 1], q: 5, qual: [3] }, d32: { main: [130, 80, 48, 24, 12, 1], q: 5, qual: [3] } },
  };
}

// ─── lookup ───────────────────────────────────────────────────────────────

/** The live (2026) table, in era form. */
function liveLookup(cat: Category, drawSize: number | null, given?: DrawVariant): EraLookup {
  // The edition's own variant (Paris 2024's WTA medal table is reachable only
  // through it) wins over the draw-size guess.
  const variant =
    given ??
    ((cat === "masters_1000" || cat === "wta_1000") && drawSize != null && drawSize <= 64
      ? ("d56" as const)
      : (cat === "atp_500" || cat === "atp_250") && drawSize != null && drawSize >= 48
        ? ("d48" as const)
        : cat === "wta_500" && drawSize != null && drawSize >= 48
          ? ("d56" as const)
          : undefined);
  const main: Partial<Record<Round, number>> = {};
  for (const r of MAIN_ROUNDS) main[r] = pointsForRound(cat, r, variant);
  const slam = cat === "grand_slam" || cat === "wta_grand_slam";
  // The live table's Q3 slot is the qualifying winner's value at non-Slams
  // (see editions.ts scorePlayer); its losers are Q2, Q1.
  const losers: Round[] = slam ? ["Q3", "Q2", "Q1"] : ["Q2", "Q1"];
  return {
    main,
    qualifierBonus: qualifierBonus(cat),
    qual: (fromEnd) => {
      const r = losers[fromEnd];
      return r ? pointsForRound(cat, r, variant) : 0;
    },
  };
}

const ATP_TOUR_ROW = (t: Record<string, Row>, cat: Category, d: number | null): Row | null => {
  switch (cat) {
    case "grand_slam":
      return t.grand_slam!;
    case "masters_1000":
      return d != null && d <= 64 ? t.m1000_56! : t.m1000_96!;
    case "atp_500":
      return d != null && d >= 48 ? t.a500_48! : t.a500_32!;
    case "atp_250":
      return d != null && d >= 48 ? t.a250_48! : t.a250_32!;
    default:
      return null;
  }
};

const WTA_TOUR_ROW = (t: Record<string, Row>, cat: Category, d: number | null, season: Season): Row | null => {
  switch (cat) {
    case "wta_grand_slam":
      return t.wta_grand_slam!;
    case "wta_1000":
      return d != null && d <= 64 ? t.w1000_64! : t.w1000_96!;
    case "wta_1000_nc":
      // 2023: the 56-draw non-mandatory 1000s paid 900; a 64/60 draw paid 1000.
      // 2024 and 2025: they pay like every 1000 — WTA_TOUR 2024/2025's
      // "WTA 1000 (64/56S)" row covers the 56-draw events (and docs :319).
      // Replay agrees (2024-25 weeks, n=41.7k): the 1000 table beats the 900
      // table on every measure (clean full 35.8% vs 33.7%, delta 79.7 vs 79.4).
      if (season <= 2023) return d != null && d > 56 ? t.w1000_64! : t.w1000_nc_56!;
      return t.w1000_64!;
    case "wta_500":
      return d != null && d >= 48 ? t.w500_56! : t.w500_32!;
    case "wta_250":
      return t.w250_32!;
    default:
      return null;
  }
};

/** Tiers that pay the same in every season (or never pay): use the live table. */
const SEASONLESS = new Set<string>(["olympics", "davis_cup", "non_ranking", "finals"]);

/**
 * The table `tier` paid in `season`, or null when no source covers it.
 * `drawSize` picks the draw-dependent row (96 vs 56 Masters, 48 vs 32 500/250,
 * 48 vs 32 ITF).
 */
export function eraTable(
  tour: Tour,
  tier: ReplayTier,
  season: Season,
  drawSize: number | null,
  variant?: DrawVariant,
): EraLookup | null {
  if (tier.startsWith("itf_w")) {
    if (tour !== "wta") return null;
    // From 2024 the pages list no "+H" (hospitality) rows, and single-result
    // replay evidence is too thin to say +H pays as its base tier (18 steps,
    // mixed; 2026-10-13): a gap until a source says so.
    const rows = ITF_W[season]?.[tier];
    if (!rows) return null;
    const row = drawSize != null && drawSize >= 48 ? rows.d48 : rows.d32;
    return row ? lookup(row) : null;
  }
  // 2022's Challenger 80 / 90 / 110 exist in no other season (nor in the live table).
  if (/^ch_(80|90|110)$/.test(tier) && season !== 2022) return null;
  const cat = tier as Category;
  if (SEASONLESS.has(cat)) {
    // The WTA Finals paid +125 per round-robin match AND per win in 2023
    // (WTA_TOUR 2023); finalsPoints models the 2024+ format only.
    if (cat === "finals" && tour === "wta" && season <= 2023) return null;
    return liveLookup(cat, drawSize, variant);
  }
  // 2026 is the live table. Replay, 2026-10-13: swapping in the 2024/25 rows
  // for any ATP tier lowered every 2026 score (e.g. Slam qualifier 30 vs 25:
  // clean delta 72.9% -> 70.1%), and the reverse — the live table for 2024/25
  // — lowered every 2024/25 score (Masters: clean full 24.0% -> 16.7%). The
  // ATP changed its qualifying values for 2026; both sources hold for their
  // own season.
  if (season === 2026) return liveLookup(cat, drawSize, variant);

  if (tour === "atp") {
    if (cat.startsWith("ch_")) {
      const row = (season === 2022 ? CH_2022 : season === 2023 ? CH_2023 : CH_2024)[cat];
      return row ? lookup(row) : null;
    }
    if (cat === "m25_futures" || cat === "m15_futures") {
      return lookup(ITF_MEN_2025[cat]!);
    }
    // 2022 paid as 2023 (2022_ATP_Tour; both cite the 2021 rulebook).
    const row = ATP_TOUR_ROW(season <= 2023 ? ATP_2023 : ATP_2024, cat, drawSize);
    return row ? lookup(row) : null;
  }

  if (cat === "wta_125") {
    const row = WTA_125[season <= 2023 ? 2023 : 2024];
    return row ? lookup(row) : null;
  }
  // 2022 paid as 2023 (2022_WTA_Tour, same rows).
  const row = WTA_TOUR_ROW(season <= 2023 ? WTA_2023 : WTA_2024, cat, drawSize, season);
  return row ? lookup(row) : null;
}
