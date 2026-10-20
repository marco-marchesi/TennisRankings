// Archive level code + name + draw -> points-table category, for the replay.
//
// Deliberately STRICTER than projections/category-inference.ts: anything that
// cannot be placed returns category null with a gap reason, so the replay
// reports it as a data gap rather than scoring a guessed tier. (The live
// inference maps an ATP "C" to ch_125 and lets ITF levels fall to atp_250.)
import type { Category, DrawVariant } from "../config/points-table";
import { ATP_500_TOURNAMENTS, WTA_1000_NC } from "../projections/category-inference";
import {
  challengerTierForWeek,
  loadChallengerEvents,
  teChallengerCity,
  type ChallengerEvent,
} from "../sources/atp-challenger-calendar";
import type { Tour } from "./types";

export interface ArchiveTier {
  category: Category | null;
  variant?: DrawVariant;
  gap: string | null;
  /**
   * A tier only the replay's season tables know, category null: WTA ITF
   * ("itf_w60", hospitality "itf_w60h") and 2022's Challenger 80/90/110.
   */
  replayTier?: string;
}

const hit = (category: Category, variant?: DrawVariant): ArchiveTier => ({ category, variant, gap: null });
const gap = (reason: string): ArchiveTier => ({ category: null, variant: undefined, gap: reason });

/**
 * Archive Challenger names whose city the calendar (atptour.com, Wikipedia)
 * spells differently. Tried only after the archive's own name finds nothing,
 * and each was checked to match exactly one edition that week (2026-10-13):
 * "Guangzhou" is its own city in September 2025 but "Nansha" in April.
 */
const CHALLENGER_CITY_ALIASES: Record<string, string> = {
  "rome ga": "rome",
  "ottignies louvain": "ottignies louvain la neuve",
  "palo alto": "stanford",
  bengaluru: "bangalore",
  luedenscheid: "ludenscheid",
  manacor: "mallorca",
  "shenzhen longhua": "shenzhen",
  "shenzhen futian": "shenzhen",
  montemar: "alicante",
  "buenos aires tigre": "tigre",
  "cap cana": "punta cana",
  guangzhou: "nansha",
  "guangzhou huangpu": "guangzhou",
  "costa do sauipe": "sauipe",
  "lima los inkas": "lima",
  cuernavaca: "morelos",
  "santa cruz de la sierra": "santa cruz",
  "istanbul ttf": "istanbul",
  heilbronn: "heilbronn bad rappenau",
  // 2022
  "el espinar": "segovia",
  "salvador de bahia": "salvador",
  "santa cruz": "santa cruz de la sierra",
  tulln: "tulln an der donau",
  biel: "biel bienne",
  "buenos aires": "tigre", // only when no Buenos Aires edition that week (Jan, Apr 2022)
};

function challengerArchiveTier(events: ChallengerEvent[], name: string, start: string) {
  const own = name.replace(/\s*CH$/i, "");
  const tier = challengerTierForWeek(events, own, start);
  if (tier) return tier;
  const alias = CHALLENGER_CITY_ALIASES[teChallengerCity(own)];
  return alias ? challengerTierForWeek(events, alias, start) : null;
}

const UPGRADED_TO_500_IN_2025 = new Set(["Doha", "Munich"]);

/** The 2023 non-mandatory WTA 1000s, which the archive tags "P" (64 draw). */
const WTA_P_1000_2023 = new Set(["Dubai", "Doha", "Montreal", "Toronto", "Cincinnati", "Guadalajara"]);

function inSet(name: string, set: Set<string>): boolean {
  for (const t of set) if (name.includes(t)) return true;
  return false;
}

export function archiveCategory(
  tour: Tour,
  level: string,
  name: string,
  drawSize: number | null,
  start: string,
  challengerEvents: ChallengerEvent[] = loadChallengerEvents(),
): ArchiveTier {
  // Team events with per-match scoring by opponent rank
  // (docs/ranking-rules.md:131-139), tagged as ordinary tour events.
  // united-cup.ts scores it per match; the ATP Cup (2020-22) stays a gap.
  if (/United Cup/i.test(name)) return { category: null, variant: undefined, gap: null, replayTier: "united_cup" };
  if (/ATP Cup/i.test(name)) return gap("united_cup");

  if (tour === "atp") {
    // Before the level: the archive tags the 2023 Tour Finals "A", the 2022
    // NextGen Finals "A" and the Laver Cup "A".
    if (/Next ?Gen|Laver Cup/i.test(name)) return hit("non_ranking");
    if (/Tour Finals/i.test(name)) return hit("finals");
    switch (level) {
      case "G":
        return hit("grand_slam");
      case "M":
        // Monte Carlo and Paris are 56-draw (docs/ranking-rules.md:52-66).
        return hit("masters_1000", drawSize != null && drawSize <= 64 ? "d56" : undefined);
      case "A": {
        const d48 = drawSize != null && drawSize >= 48 ? ("d48" as const) : undefined;
        // ATP_500_TOURNAMENTS is the 2026 list; Doha and Munich joined it in 2025.
        const was250 = start < "2025-01-01" && inSet(name, UPGRADED_TO_500_IN_2025);
        return hit(inSet(name, ATP_500_TOURNAMENTS) && !was250 ? "atp_500" : "atp_250", d48);
      }
      case "F":
        return hit("finals");
      case "D":
        return hit("davis_cup");
      case "O":
        return hit("olympics");
      case "C": {
        const tier = challengerArchiveTier(challengerEvents, name, start);
        if (!tier) return gap("challenger_tier");
        if (tier === 80 || tier === 90 || tier === 110) return { category: null, variant: undefined, gap: null, replayTier: `ch_${tier}` };
        return hit(`ch_${tier}` as Category);
      }
      case "15":
        return hit("m15_futures");
      case "25":
        return hit("m25_futures");
      default:
        return gap(`level:${level}`);
    }
  }

  // ITF levels: "60", "60+H". Scored by points-eras.ts, which knows which
  // season each tier existed in.
  const itf = level.match(/^(\d+)(\+H)?$/);
  if (itf) return { category: null, variant: undefined, gap: null, replayTier: `itf_w${itf[1]}${itf[2] ? "h" : ""}` };
  switch (level) {
    case "G":
      return hit("wta_grand_slam");
    case "PM":
      if (inSet(name, WTA_1000_NC)) return hit("wta_1000_nc");
      return hit("wta_1000", drawSize != null && drawSize <= 64 ? "d56" : undefined);
    case "P":
      // The archive tags non-mandatory 1000s "P" too: Doha and Dubai 2024
      // (PM from 2025), and 2023's 64-draw Dubai / Montreal / Toronto /
      // Cincinnati / Guadalajara. Draw size alone cannot tell (Brisbane is
      // a 64-draw 500), so name AND era decide.
      if (start >= "2024-01-01" && inSet(name, WTA_1000_NC)) return hit("wta_1000_nc");
      if (start < "2024-01-01" && (drawSize ?? 0) >= 56 && inSet(name, WTA_P_1000_2023)) return hit("wta_1000_nc");
      return hit("wta_500", drawSize != null && drawSize >= 48 ? "d56" : undefined);
    case "I":
      return hit("wta_250");
    case "C":
      return hit("wta_125");
    case "F":
      // "Fort Worth / Cancun / Riyadh Finals". The archive also tags the
      // Elite Trophy (2023 "Zhuhai") "F"; it is not the Finals.
      return /Finals/i.test(name) ? hit("finals") : gap("elite_trophy");
    case "D":
      // Billie Jean King Cup: no ranking points.
      return hit("non_ranking");
    case "O":
      // Only Paris 2024 awarded WTA points (docs/ranking-rules.md:467).
      return start.startsWith("2024") ? hit("olympics", "d64") : hit("olympics");
    default:
      return gap(`level:${level}`);
  }
}
