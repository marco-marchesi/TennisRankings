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
import { eq, inArray, sql } from "drizzle-orm";
import {
  fetchDailyMatchList,
  fetchMatchDetail,
  type Tour,
  type TEMatchRef,
} from "./sources/tennis-explorer";
import type { Category } from "./config/points-table";

export interface RunSummary {
  tour: Tour;
  date: string;
  matchesFetched: number;
  finishedMatches: number;
  rowsWritten: number;
  unmatchedPlayers: number;
  skippedNobodyMatched: number;
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

  // Pre-load the player lookup index — one DB roundtrip per run, then in-
  // memory matching for every TE player we encounter.
  const lookup = await buildPlayerLookup();

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
            tournamentLevel: null,
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
            tournamentLevel: null,
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
            tournamentLevel: tournamentLevelFromCategory(detail.category),
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
            tournamentLevel: tournamentLevelFromCategory(detail.category),
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

        await db
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
          });
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
      );
      summaries.push(summary);
    }
  }

  // Bulk-replace planned matches. We DELETE all TE rows first because
  // yesterday's "planned" list may include matches that have since been
  // postponed, finished, or rescheduled — keeping stale rows would
  // contaminate the "next opponent" card.
  await db
    .delete(schema.playerUpcomingMatches)
    .where(eq(schema.playerUpcomingMatches.source, "tennis_explorer"));
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
      await db.insert(schema.playerUpcomingMatches).values(deduped.slice(i, i + CHUNK));
    }
    console.log(`[daily-matches] upcoming matches written: ${deduped.length}`);
  } else {
    console.log(`[daily-matches] upcoming matches written: 0`);
  }

  return summaries;
}

// ─── player matching ─────────────────────────────────────────────────────

interface PlayerLookup {
  bySuffixSlug: Map<string, Array<{ id: number; slug: string; country: string | null }>>;
  byNormalizedName: Map<string, Array<{ id: number; slug: string; country: string | null }>>;
}

async function buildPlayerLookup(): Promise<PlayerLookup> {
  const rows = await db
    .select({
      id: schema.players.id,
      slug: schema.players.slug,
      fullName: schema.players.fullName,
      countryCode: schema.players.countryCode,
    })
    .from(schema.players);

  const bySuffixSlug = new Map<string, Array<{ id: number; slug: string; country: string | null }>>();
  const byNormalizedName = new Map<string, Array<{ id: number; slug: string; country: string | null }>>();

  for (const r of rows) {
    const entry = { id: r.id, slug: r.slug, country: r.countryCode };

    // Index by progressively-shorter slug suffixes. Our slug "alex-de-minaur"
    // indexes "de-minaur" and "minaur" as well — TE often only gives us the
    // last name. Cap at the last 3 segments so we don't index 1-letter keys.
    const segments = r.slug.split("-");
    for (let i = 1; i <= Math.min(3, segments.length); i++) {
      const suffix = segments.slice(-i).join("-");
      if (suffix.length < 3) continue;
      pushTo(bySuffixSlug, suffix, entry);
    }

    // Normalized name (full string, NFKD-stripped, hyphens-as-spaces).
    pushTo(byNormalizedName, normaliseName(r.fullName), entry);
  }

  return { bySuffixSlug, byNormalizedName };
}

/**
 * Match a TennisExplorer player to one of ours. Layered strategy:
 *   1. Strip TE's id-disambiguation suffix ("humbert-e2553" → "humbert") and
 *      look up by slug suffix. The most common case.
 *   2. Failing that, normalise the listing name (drop the trailing initial)
 *      and check for an exact match on `players.full_name`.
 *   3. Country tie-break when multiple candidates match.
 */
function resolvePlayerId(
  lookup: PlayerLookup,
  teSlug: string | null,
  teName: string,
  teCountry: string | null,
): number | null {
  if (teSlug) {
    const cleaned = stripIdSuffix(teSlug);
    const hits = lookup.bySuffixSlug.get(cleaned);
    if (hits) {
      const tieBroken = pickByCountry(hits, teCountry);
      if (tieBroken) return tieBroken;
    }
  }
  // Drop trailing initial: "De Minaur A." → "de minaur"
  const nameKey = normaliseName(teName.replace(/\s+[A-Z]\.\s*$/, ""));
  if (nameKey) {
    const hits = lookup.byNormalizedName.get(nameKey);
    if (hits) {
      const tieBroken = pickByCountry(hits, teCountry);
      if (tieBroken) return tieBroken;
    }
  }
  return null;
}

function pickByCountry(
  candidates: Array<{ id: number; slug: string; country: string | null }>,
  teCountry: string | null,
): number | null {
  if (candidates.length === 0) return null;
  if (candidates.length === 1) return candidates[0]!.id;
  // Country tie-break: 2-letter ISO (TE) vs 3-letter ISO (us) — compare
  // prefix-only or rely on the country mapping at insert time. For now we
  // prefer an exact 3-letter match.
  if (teCountry) {
    const byCountry = candidates.find((c) => c.country === teCountry);
    if (byCountry) return byCountry.id;
  }
  return candidates[0]!.id;
}

/**
 * "humbert-e2553" → "humbert"  ; "de-minaur" → "de-minaur"
 * Heuristic: drop the last segment if it's 4+ chars and contains a digit.
 * TE uses these short alphanumeric suffixes to disambiguate name collisions.
 */
function stripIdSuffix(slug: string): string {
  const parts = slug.split("-");
  if (parts.length < 2) return slug;
  const last = parts[parts.length - 1]!;
  if (last.length >= 4 && /\d/.test(last)) return parts.slice(0, -1).join("-");
  return slug;
}

function normaliseName(s: string): string {
  return s
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[-_]/g, " ")
    .replace(/[^a-z0-9 ]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

// ─── small helpers ───────────────────────────────────────────────────────

function pushTo<V>(m: Map<string, V[]>, k: string, v: V) {
  const list = m.get(k);
  if (list) list.push(v);
  else m.set(k, [v]);
}

/**
 * Map our internal Category enum back to a TA-style single-letter level
 * string. Existing downstream code (derive-live-state, derive-dropping-
 * points) reads tournament_level expecting these letters — emitting the
 * matching code keeps the read paths working without case-by-case branching.
 */
function tournamentLevelFromCategory(cat: Category | null): string | null {
  if (!cat) return null;
  if (cat === "grand_slam") return "G";
  if (cat === "masters_1000" || cat === "wta_1000") return "M";
  if (cat === "finals") return "F";
  if (cat === "davis_cup") return "D";
  if (cat === "olympics") return "O";
  if (cat.startsWith("ch_")) return "C";
  // atp_500, atp_250, wta_500, wta_250 all share "A" in TA's scheme.
  return "A";
}

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
