// Match-history backfill via Tennis Abstract.
//
// For each top-N (default 50) player on each tour, fetch the last ~20
// completed matches and write them to `player_recent_matches`. Sourced from
// Sackmann's atp_matches_{YYYY}.csv / wta_matches_{YYYY}.csv. We pull three
// years (current + previous two) which always covers ≥20 matches for any
// active top-50 player (typical pro plays 50-80 matches/year).
//
// Usage:
//   pnpm scraper:backfill-matches                  # both tours
//   pnpm scraper:backfill-matches atp              # one tour
//   pnpm scraper:backfill-matches -- --top 100
//
// Idempotent: PK is (player_id, ta_tourney_id, ta_match_num), so re-running
// after new matches roll in just upserts the new ones.

import { db, schema } from "@/db";
import { and, desc, eq, sql } from "drizzle-orm";
import { fetchMatches, type Tour, type TAMatch } from "./sources/tennis-abstract";

// Cap on stored matches per player. ~80 covers a full season for any active
// top-50 player (typical pro plays 60-80 matches/year) — needed for accurate
// Played-YTD counts on the race view. Storage cost is ~100KB per player.
const PER_PLAYER_LIMIT = 80;

function currentYear(): number {
  return new Date().getUTCFullYear();
}

interface BackfillMatchesOptions {
  tour?: Tour;
  topN: number;
}

interface MatchesResult {
  tour: Tour;
  candidates: number;
  matched: number;
  matchesWritten: number;
  noWikidataId: string[];
}

export async function backfillMatches(opts: BackfillMatchesOptions): Promise<MatchesResult[]> {
  const tours: Tour[] = opts.tour ? [opts.tour] : ["atp", "wta"];
  const out: MatchesResult[] = [];
  for (const tour of tours) {
    out.push(await backfillOne(tour, opts.topN));
  }
  return out;
}

async function backfillOne(tour: Tour, topN: number): Promise<MatchesResult> {
  const result: MatchesResult = { tour, candidates: 0, matched: 0, matchesWritten: 0, noWikidataId: [] };

  // Find the latest settled week and pull the top-N for this tour. We carry
  // wikidataId because Tennis Abstract's match files key on the same numeric
  // ID as their players file — we already saved it during ranking backfill.
  const latestWeekRow = await db
    .select({ w: sql<string>`max(${schema.rankingsSnapshots.weekOf})` })
    .from(schema.rankingsSnapshots)
    .where(
      and(eq(schema.rankingsSnapshots.tour, tour), eq(schema.rankingsSnapshots.isRace, false)),
    );
  const latestWeek = latestWeekRow[0]?.w;
  if (!latestWeek) {
    console.warn(`[backfill-matches] ${tour}: no settled snapshot — run scraper:refresh first`);
    return result;
  }

  // Tennis Abstract's match CSV uses the player_id from players.csv as
  // winner_id / loser_id — that's a numeric string. We need to know each
  // player's TA id to filter the match list. We don't currently persist
  // ta_player_id on our players row; instead we look it up by matching the
  // wikidata_id, which we DID persist during ranking backfill. (Two players
  // with the same wikidata_id is impossible, so this is unambiguous.)
  //
  // Actually simpler: fetch the TA players list once, name-match like
  // backfill-history does, then we have a slug→ta_id mapping for free.
  const topPlayers = await db
    .select({
      id: schema.players.id,
      fullName: schema.players.fullName,
      countryCode: schema.players.countryCode,
      wikidataId: schema.players.wikidataId,
    })
    .from(schema.rankingsSnapshots)
    .innerJoin(schema.players, eq(schema.players.id, schema.rankingsSnapshots.playerId))
    .where(
      and(
        eq(schema.rankingsSnapshots.tour, tour),
        eq(schema.rankingsSnapshots.weekOf, latestWeek),
        eq(schema.rankingsSnapshots.isRace, false),
      ),
    )
    .orderBy(schema.rankingsSnapshots.rank)
    .limit(topN);
  result.candidates = topPlayers.length;

  // Fetch the last 3 years of matches in one bulk download.
  const y = currentYear();
  const years = [String(y - 2), String(y - 1), String(y)];
  console.log(`[backfill-matches] ${tour}: fetching ${years.join(", ")} CSVs...`);
  const allMatches = await fetchMatches(tour, years);
  console.log(`[backfill-matches] ${tour}: ${allMatches.length} matches loaded across ${years.length} years`);

  // Index matches by participant id so per-player filter is O(1).
  const matchesByPlayer = new Map<string, TAMatch[]>();
  for (const m of allMatches) {
    pushTo(matchesByPlayer, m.winnerId, m);
    pushTo(matchesByPlayer, m.loserId, m);
  }

  // To find the player's TA id we use the wikidata_id → ta_id mapping. We
  // build that on demand by walking the players CSV; but we already have
  // wikidataId on each row, so derive the TA id directly from the matches
  // table by finding any match where (winner_name+winner_ioc) matches our
  // (fullName+countryCode). That's a one-time O(matches × players) scan but
  // we only do it for the top-N (50) players × ~10k matches = 500k ops,
  // fine.
  for (const p of topPlayers) {
    const taId = findTaIdForPlayer(p.fullName, p.countryCode, allMatches);
    if (!taId) {
      result.noWikidataId.push(p.fullName);
      continue;
    }
    result.matched++;

    const playerMatches = (matchesByPlayer.get(taId) ?? [])
      .slice()
      .sort((a, b) => (a.playedOn < b.playedOn ? 1 : a.playedOn > b.playedOn ? -1 : 0))
      .slice(0, PER_PLAYER_LIMIT);

    if (playerMatches.length === 0) continue;

    const values = playerMatches.map((m) => {
      const isWinner = m.winnerId === taId;
      return {
        playerId: p.id,
        taTourneyId: m.taTourneyId,
        taMatchNum: m.taMatchNum,
        playedOn: m.playedOn,
        tournamentName: m.tournamentName,
        tournamentLevel: m.tournamentLevel,
        surface: m.surface,
        round: m.round,
        opponentName: isWinner ? m.loserName : m.winnerName,
        opponentCountry: isWinner ? m.loserCountry : m.winnerCountry,
        won: isWinner,
        score: m.score,
        matchMinutes: m.matchMinutes,
      };
    });

    await db
      .insert(schema.playerRecentMatches)
      .values(values)
      .onConflictDoUpdate({
        target: [
          schema.playerRecentMatches.playerId,
          schema.playerRecentMatches.taTourneyId,
          schema.playerRecentMatches.taMatchNum,
        ],
        set: {
          // Reset the mutable fields in case a previous entry had stale data.
          playedOn: sql`excluded.played_on`,
          tournamentName: sql`excluded.tournament_name`,
          tournamentLevel: sql`excluded.tournament_level`,
          surface: sql`excluded.surface`,
          round: sql`excluded.round`,
          opponentName: sql`excluded.opponent_name`,
          opponentCountry: sql`excluded.opponent_country`,
          won: sql`excluded.won`,
          score: sql`excluded.score`,
          matchMinutes: sql`excluded.match_minutes`,
        },
      });
    result.matchesWritten += values.length;
  }

  return result;
}

function pushTo<K, V>(map: Map<K, V[]>, key: K, val: V) {
  const list = map.get(key);
  if (list) list.push(val);
  else map.set(key, [val]);
}

/**
 * Walks the match list looking for the first row where one of the participant
 * names + countries matches our player. Returns that side's TA id. Cheaper
 * than re-downloading the TA players CSV when we just need one ID lookup
 * per player.
 */
function findTaIdForPlayer(fullName: string, countryCode: string | null, all: TAMatch[]): string | null {
  const target = normalize(fullName);
  for (const m of all) {
    if (normalize(m.winnerName) === target && (!countryCode || m.winnerCountry === countryCode)) {
      return m.winnerId;
    }
    if (normalize(m.loserName) === target && (!countryCode || m.loserCountry === countryCode)) {
      return m.loserId;
    }
  }
  return null;
}

function normalize(s: string): string {
  return s
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[-_]/g, " ")
    .replace(/[^a-z0-9 ]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

async function main() {
  const args = process.argv.slice(2);
  const tourArg = args.find((a) => a === "atp" || a === "wta") as Tour | undefined;
  const topIdx = args.indexOf("--top");
  const topN = topIdx >= 0 && args[topIdx + 1] ? Number(args[topIdx + 1]) : 50;

  console.log(`[backfill-matches] tours: ${tourArg ?? "atp+wta"}  topN: ${topN}`);
  const results = await backfillMatches({ tour: tourArg, topN });
  for (const r of results) {
    console.log(
      `[backfill-matches] ${r.tour.toUpperCase()}: scanned=${r.candidates} matched=${r.matched} ` +
        `matches+${r.matchesWritten} unmatched=${r.noWikidataId.length}`,
    );
    if (r.noWikidataId.length > 0 && r.noWikidataId.length <= 10) {
      console.log(`           unmatched: ${r.noWikidataId.join(", ")}`);
    }
  }
}

const entryFile = process.argv[1] ?? "";
if (entryFile.endsWith("backfill-matches.ts") || entryFile.endsWith("backfill-matches.js")) {
  main()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
