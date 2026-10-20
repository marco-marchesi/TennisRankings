import type { Category, DrawVariant } from "../config/points-table";
import type { ReplayTier } from "./points-eras";

export type Tour = "atp" | "wta";

/** One singles match row from the archive's match CSVs. */
export interface ArchiveMatch {
  tourneyId: string;
  tourneyName: string;
  level: string;
  drawSize: number | null;
  /** `tourney_date`: the edition's start week, NOT the day the match was played. */
  tourneyDate: string;
  round: string;
  winnerId: string;
  loserId: string;
  winnerEntry: string | null;
  loserEntry: string | null;
  score: string | null;
  /** Ranks entering the event; null = unranked or missing. */
  winnerRank?: number | null;
  loserRank?: number | null;
}

/** One player's row in an official weekly ranking. */
export interface OfficialRow {
  week: string;
  rank: number;
  playerId: string;
  points: number;
  /** Events counted — present in the WTA files only. */
  tours: number | null;
}

/** One edition of one event, as the archive's `tourney_id` identifies it. */
export interface Edition {
  key: string;
  tour: Tour;
  name: string;
  level: string;
  drawSize: number | null;
  start: string;
  category: Category | null;
  /** What scores it: the category, or a WTA ITF tier (category null). */
  tier: ReplayTier | null;
  variant: DrawVariant | undefined;
  /** Why `tier` is null. */
  gap: string | null;
}

/** What one player earned at one edition, and when it counts. */
export interface PlayerResult {
  playerId: string;
  editionKey: string;
  editionName: string;
  points: number;
  /** The edition's category; null for a gap edition. */
  category: Category | null;
  /** Reached the main draw. A qualifying-only result takes no Slam/1000 slot. */
  mainDraw: boolean;
  /** First ranking Monday the result counts in. */
  entryWeek: string;
  /** First ranking Monday it no longer counts in. */
  expiryWeek: string;
  isFinals: boolean;
  /** Data-quality flags (tier gap, incomplete draw). Empty when clean. */
  gaps: string[];
}
