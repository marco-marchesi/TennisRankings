// Hourly TennisExplorer scraper. Fetches the last N days of completed
// matches across ATP and WTA, maps each player to our `players.slug`, and
// upserts two rows per match (one per player perspective) into
// `player_recent_matches` with `source='tennis_explorer'`.
//
// What this enables — automatically, no other code changes:
//   - Live projections see fresh "current tournament" state (the 14-day
//     lookback in `derive-live-state.ts` picks up TE rows alongside TA).
//   - Player-profile "Recent matches" widget shows matches from today.
//   - Surface splits stay fresh.
//
// What this does NOT touch: Tennis Abstract's `scraper:backfill-matches`
// stays the canonical source for historical (pre-current-week) match data.
// TE owns "fresh", TA owns "deep history".

import { db, schema } from "@/db";
import { and, eq, inArray, ne, sql } from "drizzle-orm";
import {
  fetchDailyMatchList,
  fetchMatchDetail,
  type Tour,
  type TEMatchRef,
} from "./sources/tennis-explorer";
import { buildTePlayerIndex, resolveTePlayer, type TePlayerIndex } from "./te-player-resolver";
import { loadOfficialLevels, teTournamentLevel } from "./te-tournament-level";
import { loadChallengerEvents } from "./sources/atp-challenger-calendar";

export interface RunSummary {
  tour: Tour;
  date: string;
  matchesFetched: number;
  finishedMatches: number;
  rowsWritten: number;
  unmatchedPlayers: number;
  skippedNobodyMatched: number;
  /** Finished matches skipped because we already stored them. */
  alreadyHad: number;
}

export interface RunOptions {
  /** Days back from today to scrape. Default 2 = yesterday + today. */
  lookbackDays?: number;
  /** Days forward (including today) to scan for planned matches. Default 3. */
  lookaheadDays?: number;
  /** Restrict to one tour for ad-hoc testing. */
  tour?: Tour;
}

export async function scrapeDailyMatches(opts: RunOptions = {}): Promise<RunSummary[]> {
  const lookbackDays = Math.max(1, opts.lookbackDays ?? 2);
  const lookaheadDays = Math.max(0, opts.lookaheadDays ?? 3);
  const tours: Tour[] = opts.tour ? [opts.tour] : ["atp", "wta"];
  const summaries: RunSummary[] = [];

  // One index PER TOUR. A single cross-tour index is how WTA matches came to
  // be stored against ATP players (and ATP challengers against WTA players).
  const lookups = {
    atp: await buildPlayerLookup("atp"),
    wta: await buildPlayerLookup("wta"),
  };
  const levelDeps = {
    challengerEvents: loadChallengerEvents(),
    officialLevels: await loadOfficialLevels(lookbackDays + 14),
  };

  // Collected across all tours/dates, then bulk-replace at the end (planned
  // matches change rapidly — we wipe + rewrite rather than upsert).
  const upcomingRows: Array<typeof schema.playerUpcomingMatches.$inferInsert> = [];

  // Build the date window: [today - lookbackDays + 1 … today + lookaheadDays - 1].
  // Earlier dates: finished matches. Later dates: planned matches. Today: both.
  const today = new Date();
  const offsets: number[] = [];
  for (let d = lookbackDays - 1; d >= 0; d--) offsets.push(-d);
  for (let d = 1; d < lookaheadDays; d++) offsets.push(d);

  for (const tour of tours) {
    const lookup = lookups[tour];
    for (const offset of offsets) {
      const date = new Date(today.getTime() + offset * 24 * 60 * 60 * 1000);
      const dateStr = date.toISOString().slice(0, 10);
      const summary: RunSummary = {
        tour,
        date: dateStr,
        matchesFetched: 0,
        finishedMatches: 0,
        rowsWritten: 0,
        unmatchedPlayers: 0,
        skippedNobodyMatched: 0,
        alreadyHad: 0,
      };

      let refs: TEMatchRef[] = [];
      try {
        refs = await fetchDailyMatchList(date, tour);
      } catch (err) {
        console.error(
          `[daily-matches] ${tour}/${dateStr}: list fetch failed — ${err instanceof Error ? err.message : err}`,
        );
        summaries.push(summary);
        continue;
      }
      summary.matchesFetched = refs.length;
      const finished = refs.filter((r) => r.status === "finished");
      summary.finishedMatches = finished.length;

      // Collect planned (not-yet-started) matches for our top players. These
      // power the "Active tournament" card on the player profile. We DON'T
      // fetch match-detail for these — saves a request per match, and we
      // don't need the round/surface (the listing carries everything the
      // card needs: tournament, opponent, date, scheduled time).
      const planned = refs.filter((r) => r.status === "planned");
      for (const ref of planned) {
        const p1Id = resolvePlayerId(lookup, ref.p1Slug, ref.p1Name, ref.p1Country);
        const p2Id = resolvePlayerId(lookup, ref.p2Slug, ref.p2Name, ref.p2Country);
        if (p1Id) {
          upcomingRows.push({
            playerId: p1Id,
            source: "tennis_explorer",
            teMatchId: ref.teMatchId,
            scheduledDate: dateStr,
            scheduledTime: ref.time,
            tournamentSlug: ref.tournamentSlug,
            tournamentName: ref.tournamentName,
            tournamentLevel: teTournamentLevel(tour, ref.tournamentName, dateStr, levelDeps),
            opponentName: ref.p2Name,
            opponentCountry: ref.p2Country,
          });
        }
        if (p2Id && p2Id !== p1Id) {
          upcomingRows.push({
            playerId: p2Id,
            source: "tennis_explorer",
            teMatchId: ref.teMatchId,
            scheduledDate: dateStr,
            scheduledTime: ref.time,
            tournamentSlug: ref.tournamentSlug,
            tournamentName: ref.tournamentName,
            tournamentLevel: teTournamentLevel(tour, ref.tournamentName, dateStr, levelDeps),
            opponentName: ref.p1Name,
            opponentCountry: ref.p1Country,
          });
        }
      }

      for (const ref of finished) {
        const p1Id = resolvePlayerId(lookup, ref.p1Slug, ref.p1Name, ref.p1Country);
        const p2Id = resolvePlayerId(lookup, ref.p2Slug, ref.p2Name, ref.p2Country);

        if (!p1Id && !p2Id) {
          summary.skippedNobodyMatched++;
          continue;
        }
        if (!p1Id) summary.unmatchedPlayers++;
        if (!p2Id) summary.unmatchedPlayers++;
        // Surname collisions can resolve both TE sides to the same player
        // (e.g., two "Martinez"s, one missing TE's id-suffix). Inserting both
        // rows trips Postgres' "ON CONFLICT DO UPDATE cannot affect row a
        // second time". Drop the weaker side — we'd rather log + skip than
        // write a self-vs-self row.
        const collision = p1Id && p2Id && p1Id === p2Id;
        if (collision) {
          console.warn(
            `[daily-matches] ${ref.teMatchId}: both players resolved to id=${p1Id} (${ref.p1Name} vs ${ref.p2Name}) — keeping one side only`,
          );
          summary.unmatchedPlayers++;
        }
        const p1Final = p1Id;
        const p2Final = collision ? null : p2Id;

        // Skip the per-match detail fetch when we already hold this match
        // with a usable round. fetchMatchDetail is one politeFetch each, at
        // 1 req/s, and it used to run for EVERY finished match on EVERY run
        // — so a wide --lookback re-fetched thousands of matches it already
        // had. This is what makes a long backfill resumable: interrupt it,
        // re-run it, and it picks up where it stopped instead of starting over.
        const matchNumForLookup = (() => {
          const n = Number(ref.teMatchId);
          return Number.isFinite(n) && n < 2_000_000_000
            ? n
            : Math.floor(n % 2_000_000_000);
        })();
        const already = await db
          .select({ playerId: schema.playerRecentMatches.playerId })
          .from(schema.playerRecentMatches)
          .where(
            and(
              eq(schema.playerRecentMatches.source, "tennis_explorer"),
              eq(schema.playerRecentMatches.externalTourneyId, ref.tournamentSlug),
              eq(schema.playerRecentMatches.externalMatchNum, matchNumForLookup),
              ne(schema.playerRecentMatches.round, "—"),
            ),
          )
          .limit(1);
        if (already.length > 0) {
          summary.alreadyHad++;
          continue;
        }

        let detail;
        try {
          detail = await fetchMatchDetail(ref, tour);
        } catch (err) {
          console.warn(
            `[daily-matches] ${ref.teMatchId}: detail fetch failed — ${err instanceof Error ? err.message : err}`,
          );
          continue;
        }

        // TE doesn't give us an explicit per-match number — synthesize one
        // from the match ID so the (tourney, match-num) PK stays unique.
        // Hash the teMatchId into a stable small integer (Postgres int4 max
        // is 2^31). TE ids are themselves numeric; if they're under that,
        // use directly; otherwise modulo.
        const matchNumRaw = Number(ref.teMatchId);
        const externalMatchNum = Number.isFinite(matchNumRaw) && matchNumRaw < 2_000_000_000
          ? matchNumRaw
          : Math.floor(matchNumRaw % 2_000_000_000);

        const rows: Array<typeof schema.playerRecentMatches.$inferInsert> = [];
        if (p1Final) {
          rows.push({
            playerId: p1Final,
            source: "tennis_explorer",
            externalTourneyId: ref.tournamentSlug,
            externalMatchNum,
            playedOn: dateStr,
            tournamentName: ref.tournamentName,
            tournamentLevel: teTournamentLevel(tour, ref.tournamentName, dateStr, levelDeps),
            surface: detail.surface,
            round: detail.round || "—",
            opponentName: ref.p2Name,
            opponentCountry: ref.p2Country,
            won: detail.p1Won === true,
            score: detail.scoreString,
            matchMinutes: null,
          });
        }
        if (p2Final) {
          rows.push({
            playerId: p2Final,
            source: "tennis_explorer",
            externalTourneyId: ref.tournamentSlug,
            externalMatchNum,
            playedOn: dateStr,
            tournamentName: ref.tournamentName,
            tournamentLevel: teTournamentLevel(tour, ref.tournamentName, dateStr, levelDeps),
            surface: detail.surface,
            round: detail.round || "—",
            opponentName: ref.p1Name,
            opponentCountry: ref.p1Country,
            won: detail.p1Won === false,
            score: detail.scoreString,
            matchMinutes: null,
          });
        }
        if (rows.length === 0) continue;

        await withDbRetry(`insert ${rows.length} match row(s)`, () =>
          db
            .insert(schema.playerRecentMatches)
            .values(rows)
          .onConflictDoUpdate({
            target: [
              schema.playerRecentMatches.playerId,
              schema.playerRecentMatches.source,
              schema.playerRecentMatches.externalTourneyId,
              schema.playerRecentMatches.externalMatchNum,
            ],
            // Refresh mutable fields — TE updates score/round as a tournament
            // progresses past previously-played rounds.
            set: {
              playedOn: sql`excluded.played_on`,
              tournamentName: sql`excluded.tournament_name`,
              tournamentLevel: sql`excluded.tournament_level`,
              surface: sql`excluded.surface`,
              round: sql`excluded.round`,
              opponentName: sql`excluded.opponent_name`,
              opponentCountry: sql`excluded.opponent_country`,
              won: sql`excluded.won`,
              score: sql`excluded.score`,
            },
          }),
        );
        summary.rowsWritten += rows.length;
      }

      // Bump last-seen for touched players.
      const touchedIds = Array.from(
        new Set(
          finished.flatMap((r) => [
            resolvePlayerId(lookup, r.p1Slug, r.p1Name, r.p1Country),
            resolvePlayerId(lookup, r.p2Slug, r.p2Name, r.p2Country),
          ]),
        ),
      ).filter((id): id is number => id != null);
      if (touchedIds.length > 0) {
        await db
          .update(schema.players)
          .set({ lastSeenInRankingsAt: new Date() })
          .where(inArray(schema.players.id, touchedIds));
      }

      console.log(
        `[daily-matches] ${tour}/${dateStr}: ` +
          `fetched=${summary.matchesFetched} finished=${summary.finishedMatches} ` +
          `wrote=${summary.rowsWritten} unmatched=${summary.unmatchedPlayers} ` +
          `skipped=${summary.skippedNobodyMatched}`,
          `alreadyHad=${summary.alreadyHad}`,
      );
      summaries.push(summary);
    }
  }

  // Bulk-replace planned matches. We DELETE all TE rows first because
  // yesterday's "planned" list may include matches that have since been
  // postponed, finished, or rescheduled — keeping stale rows would
  // contaminate the "next opponent" card.
  await withDbRetry("wipe upcoming matches", () =>
    db.delete(schema.playerUpcomingMatches)
    .where(eq(schema.playerUpcomingMatches.source, "tennis_explorer"))
  );
  if (upcomingRows.length > 0) {
    // Dedup within the batch (same match could appear on multiple scrape
    // dates if TE shows it on two days; the PK would reject otherwise).
    const seen = new Set<string>();
    const deduped: typeof upcomingRows = [];
    for (const r of upcomingRows) {
      const key = `${r.playerId}::${r.teMatchId}`;
      if (seen.has(key)) continue;
      seen.add(key);
      deduped.push(r);
    }
    // Chunk inserts — postgres parameter limit is ~65k; each row has ~10 params.
    const CHUNK = 1000;
    for (let i = 0; i < deduped.length; i += CHUNK) {
      await withDbRetry(`insert upcoming chunk at ${i}`, () =>
        db.insert(schema.playerUpcomingMatches).values(deduped.slice(i, i + CHUNK)),
      );
    }
    console.log(`[daily-matches] upcoming matches written: ${deduped.length}`);
  } else {
    console.log(`[daily-matches] upcoming matches written: 0`);
  }

  return summaries;
}

// ─── player matching ─────────────────────────────────────────────────────

type PlayerLookup = TePlayerIndex;

async function buildPlayerLookup(tour: Tour): Promise<PlayerLookup> {
  const rows = await db
    .select({ id: schema.players.id, fullName: schema.players.fullName, teSlug: schema.players.teSlug })
    .from(schema.players)
    .where(eq(schema.players.tour, tour));
  return buildTePlayerIndex(rows);
}

/** Tour-scoped surname + initial match; null rather than a guess. */
function resolvePlayerId(
  lookup: PlayerLookup,
  teSlug: string | null,
  teName: string,
  _teCountry: string | null,
): number | null {
  return resolveTePlayer(lookup, teSlug, teName);
}

// ─── small helpers ───────────────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2);
  const tourArg = args.find((a) => a === "atp" || a === "wta") as Tour | undefined;
  const lookIdx = args.indexOf("--lookback");
  const lookbackDays =
    lookIdx >= 0 && args[lookIdx + 1] ? Number(args[lookIdx + 1]) : 2;
  const aheadIdx = args.indexOf("--lookahead");
  const lookaheadDays =
    aheadIdx >= 0 && args[aheadIdx + 1] ? Number(args[aheadIdx + 1]) : 3;

  console.log(`[daily-matches] tours=${tourArg ?? "atp+wta"}  lookback=${lookbackDays}d  lookahead=${lookaheadDays}d`);
  const summaries = await scrapeDailyMatches({ tour: tourArg, lookbackDays, lookaheadDays });
  const totalRows = summaries.reduce((acc, s) => acc + s.rowsWritten, 0);
  console.log(`[daily-matches] total rows written: ${totalRows}`);
}

const entryFile = process.argv[1] ?? "";
if (entryFile.endsWith("scrape-daily-matches.ts") || entryFile.endsWith("scrape-daily-matches.js")) {
  main()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}

/**
 * Retry a database operation through a transient connection failure.
 *
 * The Neon serverless driver speaks HTTP, and a long crawl (this job runs for
 * hours at TennisExplorer's 1 req/s) reliably hits the occasional ECONNRESET
 * or 10s connect timeout. A single failed insert used to abort the whole run:
 * four of five chunks of the 2026-06/08 backfill died that way, one of them
 * after writing 60+ days of matches.
 *
 * Only connection-shaped errors are retried. A constraint violation is a real
 * bug and must still surface immediately.
 */
async function withDbRetry<T>(label: string, fn: () => Promise<T>): Promise<T> {
  const MAX = 4;
  let lastErr: unknown;
  for (let attempt = 1; attempt <= MAX; attempt++) {
    try {
      return await fn();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const transient =
        /fetch failed|ECONNRESET|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|Connect Timeout|socket hang up|terminating connection|Client has encountered a connection error/i.test(
          msg,
        );
      if (!transient || attempt === MAX) throw err;
      lastErr = err;
      const backoffMs = 1000 * 2 ** (attempt - 1);
      console.warn(
        `[daily-matches] ${label}: transient DB error (attempt ${attempt}/${MAX}), ` +
          `retrying in ${backoffMs}ms — ${msg.split("\n")[0]}`,
      );
      await new Promise((r) => setTimeout(r, backoffMs));
    }
  }
  throw lastErr;
}
