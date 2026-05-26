import {
  pgTable,
  pgView,
  serial,
  text,
  integer,
  timestamp,
  boolean,
  date,
  index,
  uniqueIndex,
  primaryKey,
  pgEnum,
  jsonb,
  customType,
} from "drizzle-orm/pg-core";

// Drizzle has no built-in bytea type; this custom type plays nicely with
// node-postgres's Buffer-by-default behavior for binary columns.
const bytea = customType<{ data: Buffer; default: false }>({
  dataType() {
    return "bytea";
  },
});
import { relations, sql } from "drizzle-orm";

export const tour = pgEnum("tour", ["atp", "wta", "challenger", "itf"]);
export const surface = pgEnum("surface", ["hard", "clay", "grass", "carpet", "indoor_hard"]);
export const hand = pgEnum("hand", ["right", "left", "unknown"]);
export const tournamentCategory = pgEnum("tournament_category", [
  "grand_slam",
  "masters_1000",
  "atp_500",
  "atp_250",
  "wta_1000",
  "wta_500",
  "wta_250",
  "finals",
  "challenger",
  "futures",
  "olympics",
  "davis_cup",
]);

export const players = pgTable(
  "players",
  {
    id: serial("id").primaryKey(),
    slug: text("slug").notNull(),
    fullName: text("full_name").notNull(),
    firstName: text("first_name"),
    lastName: text("last_name"),
    countryCode: text("country_code"),
    dateOfBirth: date("date_of_birth"),
    height_cm: integer("height_cm"),
    plays: hand("plays").default("unknown"),
    /** "one-handed" | "two-handed" — scraped from Wikipedia infobox. */
    backhand: text("backhand"),
    turnedPro: integer("turned_pro"),
    photoUrl: text("photo_url"),
    photoAttribution: text("photo_attribution"),
    /** Downloaded image binary. Served via /api/player-photo/[slug]. */
    photoBytes: bytea("photo_bytes"),
    /** MIME type of `photoBytes` — "image/jpeg" / "image/png" etc. */
    photoContentType: text("photo_content_type"),
    /** When `photoBytes` was last successfully populated. NULL = never. */
    photoFetchedAt: timestamp("photo_fetched_at", { withTimezone: true }),
    /**
     * When we last ATTEMPTED to fetch a photo, success or 404. Used to rate-
     * limit retries for players who legitimately don't have a Wikipedia image
     * — without this we'd hammer Wikimedia every weekly run.
     */
    photoAttemptAt: timestamp("photo_attempt_at", { withTimezone: true }),
    wikipediaUrl: text("wikipedia_url"),
    /** Wikidata QID (e.g. "Q12421867") — bridge to wiki + photo lookups. */
    wikidataId: text("wikidata_id"),
    bio: text("bio"),
    tour: tour("tour").notNull(),
    active: boolean("active").default(true).notNull(),
    /** When `slug` was first locked in. Slug is never overwritten after this. */
    slugStableAt: timestamp("slug_stable_at", { withTimezone: true }),
    /**
     * Last time we saw this player in any official ranking snapshot. Players
     * who drop off the rankings list keep their data forever; this column
     * lets a future cleanup job find truly inactive rows without losing
     * recent retirees.
     */
    lastSeenInRankingsAt: timestamp("last_seen_in_rankings_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    slugIdx: uniqueIndex("players_slug_idx").on(t.slug),
    nameIdx: index("players_full_name_idx").on(t.fullName),
    tourIdx: index("players_tour_idx").on(t.tour),
  }),
);

export const scrapeRuns = pgTable(
  "scrape_runs",
  {
    id: serial("id").primaryKey(),
    source: text("source").notNull(),
    startedAt: timestamp("started_at", { withTimezone: true }).defaultNow().notNull(),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    status: text("status").notNull(),
    rowsWritten: integer("rows_written"),
    deltaPct: integer("delta_pct"),
    errorMessage: text("error_message"),
    fixtureHash: text("fixture_hash"),
  },
  (t) => ({
    sourceIdx: index("scrape_runs_source_idx").on(t.source),
    startedIdx: index("scrape_runs_started_idx").on(t.startedAt),
  }),
);

export const rankingsSnapshots = pgTable(
  "rankings_snapshots",
  {
    id: serial("id").primaryKey(),
    tour: tour("tour").notNull(),
    weekOf: date("week_of").notNull(),
    playerId: integer("player_id").notNull().references(() => players.id, { onDelete: "cascade" }),
    rank: integer("rank").notNull(),
    points: integer("points").notNull(),
    tournamentsPlayed: integer("tournaments_played"),
    prevRank: integer("prev_rank"),
    prevPoints: integer("prev_points"),
    /**
     * Points published in the "+/-" column on atptour.com — net change from
     * the previous week's published total. Captured verbatim so the UI can
     * cross-check our own computed delta against the ATP-published value.
     */
    pointsMove: integer("points_move"),
    /**
     * Net rank change from the previous published week. Sourced from
     * TennisExplorer's "Move" column. Negative = moved up the list.
     */
    rankMove: integer("rank_move"),
    /**
     * Points published in the "Dropping" column — the count that will roll
     * off the 52-week window on the NEXT Monday publish. This is the
     * authoritative input to the projection calculator's `pointsBeingDefended`
     * — much more reliable than trying to derive it from prior-year match
     * results, since ATP's rolling-window rule has edge cases (best-18, Slam
     * waiver, etc.) that the published number already accounts for.
     */
    dropPoints: integer("drop_points"),
    /**
     * "Next Best" — the highest non-countable result that would become
     * countable if a player adds nothing this week. Drives a more accurate
     * projection (a player who has a 250-pt non-countable can't actually lose
     * a full 1000 even if their Masters result rolls off). Captured here for
     * future use; not yet wired into the calculator.
     */
    nextBestPoints: integer("next_best_points"),
    scrapeRunId: integer("scrape_run_id").references(() => scrapeRuns.id),
    isRace: boolean("is_race").default(false).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    unique: uniqueIndex("rankings_snapshots_unique_idx").on(t.tour, t.weekOf, t.playerId, t.isRace),
    rankIdx: index("rankings_snapshots_rank_idx").on(t.tour, t.weekOf, t.rank),
    playerWeekIdx: index("rankings_snapshots_player_week_idx").on(t.playerId, t.weekOf),
  }),
);

export const tournaments = pgTable(
  "tournaments",
  {
    id: serial("id").primaryKey(),
    slug: text("slug").notNull(),
    name: text("name").notNull(),
    city: text("city"),
    countryCode: text("country_code"),
    category: tournamentCategory("category").notNull(),
    surface: surface("surface").notNull(),
    tour: tour("tour").notNull(),
    drawSize: integer("draw_size"),
    indoor: boolean("indoor").default(false),
    pointsWinner: integer("points_winner"),
    prizeMoneyUsd: integer("prize_money_usd"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    slugIdx: uniqueIndex("tournaments_slug_idx").on(t.slug),
    tourIdx: index("tournaments_tour_idx").on(t.tour),
  }),
);

export const tournamentEditions = pgTable(
  "tournament_editions",
  {
    id: serial("id").primaryKey(),
    tournamentId: integer("tournament_id").notNull().references(() => tournaments.id, { onDelete: "cascade" }),
    year: integer("year").notNull(),
    startDate: date("start_date"),
    endDate: date("end_date"),
    winnerPlayerId: integer("winner_player_id").references(() => players.id),
    runnerUpPlayerId: integer("runner_up_player_id").references(() => players.id),
    drawData: jsonb("draw_data"),
  },
  (t) => ({
    uniq: uniqueIndex("tournament_editions_unique").on(t.tournamentId, t.year),
  }),
);

export const matches = pgTable(
  "matches",
  {
    id: serial("id").primaryKey(),
    editionId: integer("edition_id").notNull().references(() => tournamentEditions.id, { onDelete: "cascade" }),
    round: text("round").notNull(),
    playerAId: integer("player_a_id").notNull().references(() => players.id),
    playerBId: integer("player_b_id").notNull().references(() => players.id),
    winnerPlayerId: integer("winner_player_id").references(() => players.id),
    score: text("score"),
    durationMinutes: integer("duration_minutes"),
    playedOn: date("played_on"),
  },
  (t) => ({
    editionIdx: index("matches_edition_idx").on(t.editionId),
    pairIdx: index("matches_pair_idx").on(t.playerAId, t.playerBId),
  }),
);

// Per-player current-tournament projection. One row per player, rewritten on
// every projections-run so this table is always a "current state" snapshot.
// Players NOT currently playing have no row here — the UI treats absence as
// "no projection", matching how live-tennis.eu blanks the Next/Max columns
// for inactive players.
//
// Statuses:
//   in_progress     — player has won their latest match and has more rounds
//                     to play. nextPoints + maxPossiblePoints both filled.
//   eliminated      — player lost their latest match this week. Per the
//                     user's UX spec: nextPoints reverts to currentPoints
//                     (a.k.a. "official ranking"), maxPossiblePoints is null.
//   won_tournament  — player won the final. nextPoints == maxPossiblePoints
//                     == projected total with the winner reward.
export const liveProjections = pgTable(
  "live_projections",
  {
    playerId: integer("player_id")
      .primaryKey()
      .references(() => players.id, { onDelete: "cascade" }),
    /** "in_progress" | "eliminated" | "won_tournament" */
    status: text("status").notNull(),
    /** Tournament name verbatim from the match record. */
    tournamentName: text("tournament_name").notNull(),
    /** Inferred category enum string — used by the points-table lookup. */
    tournamentCategory: text("tournament_category").notNull(),
    /** Round whose points are secured (see calculator semantics). */
    roundReached: text("round_reached").notNull(),
    /** Dropping points pulled from rankings_snapshots.drop_points. */
    pointsBeingDefended: integer("points_being_defended").notNull().default(0),
    /** Net points change vs current total at next Monday publish. */
    pointsDelta: integer("points_delta").notNull(),
    /** Projected new points total. NULL when status == eliminated per spec. */
    nextPoints: integer("next_points"),
    /** Max possible total if the player wins out. NULL when not in-progress. */
    maxPossiblePoints: integer("max_possible_points"),
    nextRank: integer("next_rank"),
    maxPossibleRank: integer("max_possible_rank"),
    /**
     * "Live" totals — settled Monday points PLUS week-to-date points won
     * (per round, per category) from matches in player_recent_matches.
     * Matches the semantics of live-tennis.eu's `/en/atp-live-ranking`
     * page: each finished match in the current ranking week contributes
     * its points immediately. Mirror columns exist for race.
     *
     * Null when no in-week play has happened for the player — UI then
     * falls back to the settled rank/points on rankings_snapshots.
     */
    livePoints: integer("live_points"),
    liveRank: integer("live_rank"),
    liveRacePoints: integer("live_race_points"),
    liveRaceRank: integer("live_race_rank"),
    /**
     * Positions gained (positive) or lost (negative) vs the settled
     * Monday rank for the same player. = settled_rank − live_rank.
     */
    liveRankChange: integer("live_rank_change"),
    computedAt: timestamp("computed_at", { withTimezone: true }).defaultNow().notNull(),
  },
);

// Denormalized recent-results store powering the player-profile last-N-matches
// widget. Sourced from Tennis Abstract's per-year atp_matches_YYYY.csv and
// wta_matches_YYYY.csv. We bake the tournament + opponent identifiers into
// strings here rather than FK'ing to `matches`/`tournaments` because (a) we
// don't need the full match-graph normalization for this view and (b) many
// opponents won't exist in our `players` table (lower-ranked players we
// haven't backfilled).
export const playerRecentMatches = pgTable(
  "player_recent_matches",
  {
    playerId: integer("player_id")
      .notNull()
      .references(() => players.id, { onDelete: "cascade" }),
    /**
     * Source feed for this row. Determines how `external_tourney_id` and
     * `external_match_num` are interpreted, and used as a tie-breaker when
     * the same logical match exists in multiple sources (TennisExplorer
     * preferred — fresher than Tennis Abstract by 1-3 weeks).
     */
    source: text("source").notNull().default("tennis_abstract"),
    /**
     * Source-specific tournament identifier. For Tennis Abstract: "2024-580"
     * style. For Tennis Explorer: a tournament URL slug like "hamburg-2026".
     * Combined with `source` it uniquely identifies a tournament edition.
     */
    externalTourneyId: text("external_tourney_id").notNull(),
    /** Source-specific match number within the tournament. */
    externalMatchNum: integer("external_match_num").notNull(),
    playedOn: date("played_on").notNull(),
    tournamentName: text("tournament_name").notNull(),
    /** Tournament-level code. TA uses "G"/"M"/"A"/"C"/"F"/"D"; TennisExplorer maps to the same letters at insert time. */
    tournamentLevel: text("tournament_level"),
    /** "Hard" | "Clay" | "Grass" | "Carpet" — capitalized to match TA. */
    surface: text("surface"),
    /** Round code: R128 / R64 / R32 / R16 / QF / SF / F. */
    round: text("round").notNull(),
    opponentName: text("opponent_name").notNull(),
    opponentCountry: text("opponent_country"),
    won: boolean("won").notNull(),
    score: text("score"),
    matchMinutes: integer("match_minutes"),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.playerId, t.source, t.externalTourneyId, t.externalMatchNum] }),
    playerDateIdx: index("player_recent_matches_player_date_idx").on(t.playerId, t.playedOn),
  }),
);

// Scheduled (not-yet-played) matches we know about from TennisExplorer.
// Refreshed on every hourly scrape — wiped+rewritten rather than upserted,
// because schedules change rapidly (postponed matches, order shuffles).
//
// Only used to power the "Active tournament" card on the player profile —
// the projections runner does NOT key off this table.
export const playerUpcomingMatches = pgTable(
  "player_upcoming_matches",
  {
    playerId: integer("player_id")
      .notNull()
      .references(() => players.id, { onDelete: "cascade" }),
    source: text("source").notNull().default("tennis_explorer"),
    /** TennisExplorer match id ("3210567"). Unique per source. */
    teMatchId: text("te_match_id").notNull(),
    scheduledDate: date("scheduled_date").notNull(),
    /** "HH:MM" local-to-TE if the listing showed one. */
    scheduledTime: text("scheduled_time"),
    tournamentSlug: text("tournament_slug"),
    tournamentName: text("tournament_name").notNull(),
    tournamentLevel: text("tournament_level"),
    opponentName: text("opponent_name").notNull(),
    opponentCountry: text("opponent_country"),
    fetchedAt: timestamp("fetched_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.playerId, t.source, t.teMatchId] }),
    playerDateIdx: index("player_upcoming_player_date_idx").on(t.playerId, t.scheduledDate),
  }),
);

export const playerPointsBreakdown = pgTable(
  "player_points_breakdown",
  {
    id: serial("id").primaryKey(),
    playerId: integer("player_id").notNull().references(() => players.id, { onDelete: "cascade" }),
    editionId: integer("edition_id").notNull().references(() => tournamentEditions.id, { onDelete: "cascade" }),
    points: integer("points").notNull(),
    roundReached: text("round_reached"),
    expiresWeekOf: date("expires_week_of").notNull(),
    isMandatory: boolean("is_mandatory").default(false),
  },
  (t) => ({
    playerIdx: index("ppb_player_idx").on(t.playerId),
    expiresIdx: index("ppb_expires_idx").on(t.expiresWeekOf),
  }),
);

// --- Auth.js tables (Drizzle adapter expects these names) ---
export const users = pgTable("users", {
  id: text("id").primaryKey(),
  name: text("name"),
  email: text("email").notNull().unique(),
  emailVerified: timestamp("email_verified", { withTimezone: true }),
  image: text("image"),
  premiumUntil: timestamp("premium_until", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const accounts = pgTable(
  "accounts",
  {
    userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    type: text("type").notNull(),
    provider: text("provider").notNull(),
    providerAccountId: text("provider_account_id").notNull(),
    refresh_token: text("refresh_token"),
    access_token: text("access_token"),
    expires_at: integer("expires_at"),
    token_type: text("token_type"),
    scope: text("scope"),
    id_token: text("id_token"),
    session_state: text("session_state"),
  },
  (t) => ({ pk: primaryKey({ columns: [t.provider, t.providerAccountId] }) }),
);

export const sessions = pgTable("sessions", {
  sessionToken: text("session_token").primaryKey(),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  expires: timestamp("expires", { withTimezone: true }).notNull(),
});

export const verificationTokens = pgTable(
  "verification_tokens",
  {
    identifier: text("identifier").notNull(),
    token: text("token").notNull(),
    expires: timestamp("expires", { withTimezone: true }).notNull(),
  },
  (t) => ({ pk: primaryKey({ columns: [t.identifier, t.token] }) }),
);

export const userFollowedPlayers = pgTable(
  "user_followed_players",
  {
    userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    playerId: integer("player_id").notNull().references(() => players.id, { onDelete: "cascade" }),
    notifyOnResult: boolean("notify_on_result").default(true).notNull(),
    notifyOnRankChange: boolean("notify_on_rank_change").default(true).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({ pk: primaryKey({ columns: [t.userId, t.playerId] }) }),
);

export const newsletterSubscribers = pgTable(
  "newsletter_subscribers",
  {
    id: serial("id").primaryKey(),
    email: text("email").notNull(),
    locale: text("locale").default("en"),
    confirmed: boolean("confirmed").default(false).notNull(),
    confirmationToken: text("confirmation_token"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({ emailIdx: uniqueIndex("newsletter_email_idx").on(t.email) }),
);

// --- Relations ---
export const playersRelations = relations(players, ({ many }) => ({
  rankings: many(rankingsSnapshots),
  points: many(playerPointsBreakdown),
}));

export const rankingsSnapshotsRelations = relations(rankingsSnapshots, ({ one }) => ({
  player: one(players, { fields: [rankingsSnapshots.playerId], references: [players.id] }),
}));

export const tournamentsRelations = relations(tournaments, ({ many }) => ({
  editions: many(tournamentEditions),
}));

// ─── MCP Leaderboards ─────────────────────────────────────────────────────
// Match Charting Project leaderboards — sourced from Tennis Abstract's
// pre-computed "Last 52" reports (4 categories × 2 tours = 8 source URLs).
// Stats payload is jsonb since the per-category column shape differs and we
// don't want to fight a wide-table layout. The (tour, category, window, rank)
// PK lets us atomically replace a category on each scraper run.
export const leaderboards = pgTable(
  "leaderboards",
  {
    tour: text("tour").notNull(),
    category: text("category").notNull(), // serve | return | rally | winners_errors
    windowKey: text("window_key").notNull().default("last_52"),
    rank: integer("rank").notNull(),
    playerName: text("player_name").notNull(),
    /** Best-effort match to our players.slug — null when no DB row found. */
    playerSlug: text("player_slug"),
    /** Tennis Abstract's player identifier from `?p=...` in their URLs. */
    taPlayerId: text("ta_player_id"),
    countryCode: text("country_code"),
    matches: integer("matches"),
    stats: jsonb("stats").notNull(),
    scrapedAt: timestamp("scraped_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.tour, t.category, t.windowKey, t.rank] }),
    playerIdx: index("leaderboards_player_idx").on(t.playerSlug),
  }),
);

export type Player = typeof players.$inferSelect;
export type RankingSnapshot = typeof rankingsSnapshots.$inferSelect;
export type Tournament = typeof tournaments.$inferSelect;
export type Match = typeof matches.$inferSelect;

// ─── Race views ───────────────────────────────────────────────────────────
//
// Convenience views over the latest race-rankings snapshot for each tour.
// The view encapsulates three things:
//   1. The "current week" subquery (latest week_of for the relevant tour+race),
//   2. The join to players (so all denormalized profile fields come along),
//   3. The Played-YTD fallback (race HTML doesn't publish a Played column,
//      so we count distinct tournaments per player from player_recent_matches
//      since January 1).
//
// Now any consumer — page, SQL exploration, BI tool, ad-hoc psql — can just
// `select * from atp_race` without re-implementing the week-detection or
// fallback logic.

const raceViewColumns = {
  rank: integer("rank"),
  points: integer("points"),
  weekOf: date("week_of"),
  playerId: integer("player_id"),
  slug: text("slug"),
  fullName: text("full_name"),
  countryCode: text("country_code"),
  dateOfBirth: date("date_of_birth"),
  heightCm: integer("height_cm"),
  plays: text("plays"),
  photoUrl: text("photo_url"),
  tournamentsPlayed: integer("tournaments_played"),
};

export const atpRaceView = pgView("atp_race", raceViewColumns).as(sql`
  select
    rs.rank,
    rs.points,
    rs.week_of,
    p.id as player_id,
    p.slug,
    p.full_name,
    p.country_code,
    p.date_of_birth,
    p.height_cm,
    p.plays::text as plays,
    p.photo_url,
    coalesce(
      rs.tournaments_played,
      (
        select count(distinct prm.tournament_name)::int
        from player_recent_matches prm
        where prm.player_id = p.id
          and prm.played_on >= date_trunc('year', current_date)
      )
    ) as tournaments_played
  from rankings_snapshots rs
  join players p on p.id = rs.player_id
  where rs.tour = 'atp'
    and rs.is_race = true
    and rs.week_of = (
      select max(week_of) from rankings_snapshots
      where tour = 'atp' and is_race = true
    )
  order by rs.rank
`);

export const wtaRaceView = pgView("wta_race", raceViewColumns).as(sql`
  select
    rs.rank,
    rs.points,
    rs.week_of,
    p.id as player_id,
    p.slug,
    p.full_name,
    p.country_code,
    p.date_of_birth,
    p.height_cm,
    p.plays::text as plays,
    p.photo_url,
    coalesce(
      rs.tournaments_played,
      (
        select count(distinct prm.tournament_name)::int
        from player_recent_matches prm
        where prm.player_id = p.id
          and prm.played_on >= date_trunc('year', current_date)
      )
    ) as tournaments_played
  from rankings_snapshots rs
  join players p on p.id = rs.player_id
  where rs.tour = 'wta'
    and rs.is_race = true
    and rs.week_of = (
      select max(week_of) from rankings_snapshots
      where tour = 'wta' and is_race = true
    )
  order by rs.rank
`);
