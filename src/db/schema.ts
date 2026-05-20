import {
  pgTable,
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
} from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";

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
    turnedPro: integer("turned_pro"),
    photoUrl: text("photo_url"),
    photoAttribution: text("photo_attribution"),
    wikipediaUrl: text("wikipedia_url"),
    bio: text("bio"),
    tour: tour("tour").notNull(),
    active: boolean("active").default(true).notNull(),
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

export type Player = typeof players.$inferSelect;
export type RankingSnapshot = typeof rankingsSnapshots.$inferSelect;
export type Tournament = typeof tournaments.$inferSelect;
export type Match = typeof matches.$inferSelect;
