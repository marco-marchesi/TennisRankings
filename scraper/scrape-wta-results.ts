/**
 * Write WTA match results into player_recent_matches from api.wtatennis.com.
 *
 * The WTA half of the database had been frozen since Roland Garros: Tennis
 * Abstract's mirror ends 2026-05-25 with a deleted upstream, and
 * TennisExplorer — which was covering the gap — is blocked on this network.
 * That is the single largest reason the daily live-ranking comparison scored
 * far worse for WTA than for ATP.
 *
 * Two requests per event: none, actually — the calendar is one request for the
 * whole window, then one request per tournament returns every match at it,
 * main draw and qualifying together. No browser and no Cloudflare workaround.
 *
 * IDENTITY
 *
 * The API supplies stable WTA player ids. Resolution goes id -> slug -> strict
 * name, and every player resolved by slug or name has `players.wta_id`
 * written back, so the next run is keyed rather than matched. This is the
 * mechanism that retires name matching for WTA — the thing that produced 73
 * phantom duplicate players earlier in this project.
 *
 *   pnpm scraper:wta-results                       # last 21 days
 *   pnpm scraper:wta-results -- --from 2026-06-01 --to 2026-09-08
 *   pnpm scraper:wta-results -- --tournament 905 --year 2026
 *   pnpm scraper:wta-results -- --months 13        # full backfill window
 *   pnpm scraper:wta-results -- --from 2026-09-01 --to 2026-09-08 --dry
 */
import { eq, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { namesMatch } from "./sources/live-tennis";
import {
  eventName,
  fetchTournaments,
  fetchWtaMatches,
  WTA_API_SOURCE,
  wtaTournamentLevel,
  type MatchParseResult,
  type WtaTournament,
} from "./sources/wta-api";
import { stableMatchNumber } from "./stable-match-number";
import { runEntrypoint } from "./exit";

interface RunSummary {
  tournaments: number;
  matchesParsed: number;
  rowsWritten: number;
  byWtaId: number;
  bySlug: number;
  byName: number;
  unresolved: number;
  unresolvedNames: Set<string>;
  wtaIdsBackfilled: number;
  skippedNoDate: number;
  unresolvedRounds: string[];
  unresolvedWinners: string[];
  failures: string[];
}

function emptySummary(): RunSummary {
  return {
    tournaments: 0,
    matchesParsed: 0,
    rowsWritten: 0,
    byWtaId: 0,
    bySlug: 0,
    byName: 0,
    unresolved: 0,
    unresolvedNames: new Set(),
    wtaIdsBackfilled: 0,
    skippedNoDate: 0,
    unresolvedRounds: [],
    unresolvedWinners: [],
    failures: [],
  };
}

interface PlayerLookup {
  byWtaId: Map<string, number>;
  bySlug: Map<string, number>;
  all: Array<{ id: number; fullName: string }>;
  /** Ids learned this run, to write back once at the end. */
  learned: Map<number, string>;
}

async function loadWtaPlayers(): Promise<PlayerLookup> {
  const rows = await db
    .select({
      id: schema.players.id,
      slug: schema.players.slug,
      fullName: schema.players.fullName,
      wtaId: schema.players.wtaId,
    })
    .from(schema.players)
    .where(eq(schema.players.tour, "wta"));

  const byWtaId = new Map<string, number>();
  const bySlug = new Map<string, number>();
  for (const r of rows) {
    if (r.wtaId) byWtaId.set(r.wtaId, r.id);
    bySlug.set(r.slug, r.id);
  }
  return {
    byWtaId,
    bySlug,
    all: rows.map((r) => ({ id: r.id, fullName: r.fullName })),
    learned: new Map(),
  };
}

/**
 * Resolve one API player to a `players.id`.
 *
 * `namesMatch` is called with `{ fuzzy: false }` because this WRITES data and
 * the fuzzy branch pairs genuinely different players ("Ekaterina Maklakova"
 * with "Ekaterina Makarova"). Attaching a match to the wrong player is worse
 * than reporting it unresolved: an unresolved player is visible in the run
 * summary, a mis-attached one silently corrupts a points total.
 */
function resolvePlayer(
  lookup: PlayerLookup,
  p: { wtaId: string; slug: string; fullName: string },
  summary: RunSummary,
): number | null {
  const byId = lookup.byWtaId.get(p.wtaId);
  if (byId != null) {
    summary.byWtaId++;
    return byId;
  }

  const bySlug = lookup.bySlug.get(p.slug);
  if (bySlug != null) {
    summary.bySlug++;
    lookup.byWtaId.set(p.wtaId, bySlug);
    lookup.learned.set(bySlug, p.wtaId);
    return bySlug;
  }

  const hits = lookup.all.filter((q) => namesMatch(q.fullName, p.fullName, { fuzzy: false }));
  if (hits.length === 1) {
    summary.byName++;
    const id = hits[0]!.id;
    lookup.byWtaId.set(p.wtaId, id);
    lookup.learned.set(id, p.wtaId);
    return id;
  }

  summary.unresolved++;
  summary.unresolvedNames.add(p.fullName);
  return null;
}

/**
 * Persist the WTA ids learned by slug/name matching.
 *
 * Done once at the end rather than per player, and only for rows that do not
 * already hold an id, so a manual correction is never overwritten.
 */
async function writeBackWtaIds(lookup: PlayerLookup, summary: RunSummary): Promise<void> {
  for (const [playerId, wtaId] of lookup.learned) {
    await db
      .update(schema.players)
      .set({ wtaId })
      .where(sql`${schema.players.id} = ${playerId} and ${schema.players.wtaId} is null`);
    summary.wtaIdsBackfilled++;
  }
}

async function ingestTournament(
  t: WtaTournament,
  lookup: PlayerLookup,
  summary: RunSummary,
  dry: boolean,
): Promise<void> {
  let parsed: MatchParseResult;
  try {
    parsed = await fetchWtaMatches({
      id: t.id,
      year: t.year,
      singlesDrawSize: t.singlesDrawSize,
      startDate: t.startDate,
      endDate: t.endDate,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message.split("\n")[0]! : String(err);
    summary.failures.push(`${t.year}-${t.id} ${t.title}: ${msg}`);
    console.warn(`[wta-results] ${t.year}-${t.id} FAILED — ${msg}`);
    return;
  }

  summary.tournaments++;
  summary.matchesParsed += parsed.matches.length;
  summary.unresolvedRounds.push(...parsed.unresolvedRounds.map((r) => `${t.id}/${r}`));
  summary.unresolvedWinners.push(...parsed.unresolvedWinners.map((r) => `${t.id}/${r}`));

  // The matches response embeds its own tournament record. Prefer it over the
  // calendar row: it is the same source of truth one level closer to the
  // matches, and it is present even when the caller passed only an id.
  const meta = parsed.tournament ?? t;
  const level = wtaTournamentLevel(meta.level);
  const rows: Array<typeof schema.playerRecentMatches.$inferInsert> = [];

  for (const m of parsed.matches) {
    if (!m.playedOn) {
      summary.skippedNoDate++;
      continue;
    }
    const externalMatchNum = stableMatchNumber(
      m.round,
      m.players.map((p) => p.wtaId),
    );
    for (let side = 0; side < 2; side++) {
      const me = m.players[side]!;
      const them = m.players[1 - side]!;
      const playerId = resolvePlayer(lookup, me, summary);
      if (playerId == null) continue;
      rows.push({
        playerId,
        source: WTA_API_SOURCE,
        externalTourneyId: `${t.year}-${t.id}`,
        externalMatchNum,
        playedOn: m.playedOn,
        tournamentName: eventName(meta),
        tournamentLevel: level,
        surface: meta.surface,
        round: m.round,
        opponentName: them.fullName,
        opponentCountry: them.countryCode,
        won: me.won,
        score: m.scoreString || null,
        matchMinutes: null,
      });
    }
  }

  console.log(
    `[wta-results] ${meta.year}-${meta.id.padEnd(5)} ${(meta.level || "?").padEnd(11)} ` +
      `${String(parsed.matches.length).padStart(3)} matches -> ${String(rows.length).padStart(3)} rows  ${meta.title.slice(0, 44)}` +
      (dry ? "  (dry run, nothing written)" : ""),
  );
  if (dry || rows.length === 0) return;

  const CHUNK = 300;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const slice = rows.slice(i, i + CHUNK);
    await db
      .insert(schema.playerRecentMatches)
      .values(slice)
      .onConflictDoUpdate({
        target: [
          schema.playerRecentMatches.playerId,
          schema.playerRecentMatches.source,
          schema.playerRecentMatches.externalTourneyId,
          schema.playerRecentMatches.externalMatchNum,
        ],
        set: {
          playedOn: sql`excluded.played_on`,
          round: sql`excluded.round`,
          won: sql`excluded.won`,
          score: sql`excluded.score`,
          tournamentName: sql`excluded.tournament_name`,
          tournamentLevel: sql`excluded.tournament_level`,
          surface: sql`excluded.surface`,
          opponentCountry: sql`excluded.opponent_country`,
        },
      });
    summary.rowsWritten += slice.length;
  }
}

function isoDaysAgo(days: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}

function isoMonthsAgo(months: number): string {
  const d = new Date();
  d.setUTCMonth(d.getUTCMonth() - months);
  return d.toISOString().slice(0, 10);
}

function argValue(args: string[], flag: string): string | null {
  const i = args.indexOf(flag);
  return i >= 0 && args[i + 1] ? args[i + 1]! : null;
}

async function main() {
  const args = process.argv.slice(2);
  const dry = args.includes("--dry");
  const allLevels = args.includes("--all-levels");
  const year = Number(argValue(args, "--year") ?? new Date().getUTCFullYear());
  const limit = Number(argValue(args, "--limit") ?? Infinity);
  const months = argValue(args, "--months");

  const to = argValue(args, "--to") ?? isoDaysAgo(0);
  const from =
    argValue(args, "--from") ?? (months ? isoMonthsAgo(Number(months)) : isoDaysAgo(21));

  let targets: WtaTournament[];
  const explicit = args.reduce<string[]>((acc, a, i) => {
    if (a === "--tournament" && args[i + 1]) acc.push(args[i + 1]!);
    return acc;
  }, []);

  if (explicit.length > 0) {
    // No calendar lookup needed: the matches response embeds its own
    // tournament record, including the draw size that names numeric rounds.
    targets = explicit.map((id) => ({
      id,
      year,
      title: `WTA ${id}`,
      groupName: null,
      level: "",
      surface: null,
      startDate: `${year}-01-01`,
      endDate: `${year}-12-31`,
      singlesDrawSize: null,
      city: null,
      country: null,
      status: null,
    }));
  } else {
    targets = await fetchTournaments({ from, to, tourLevelOnly: !allLevels });
    console.log(
      `[wta-results] ${targets.length} ${allLevels ? "" : "tour-level "}event(s) in ${from}..${to}`,
    );
  }

  if (targets.length === 0) {
    console.log("[wta-results] nothing to do");
    return;
  }
  targets = targets
    .slice()
    .sort((a, b) => a.startDate.localeCompare(b.startDate))
    .slice(0, limit);

  const lookup = await loadWtaPlayers();
  console.log(
    `[wta-results] ${lookup.all.length} WTA players available ` +
      `(${lookup.byWtaId.size} already carry a wta_id)`,
  );

  const summary = emptySummary();
  for (const t of targets) {
    await ingestTournament(t, lookup, summary, dry);
  }
  if (!dry) await writeBackWtaIds(lookup, summary);

  console.log(
    `\n[wta-results] tournaments=${summary.tournaments} matches=${summary.matchesParsed} ` +
      `rows=${summary.rowsWritten} byWtaId=${summary.byWtaId} bySlug=${summary.bySlug} ` +
      `byName=${summary.byName} unresolved=${summary.unresolved} ` +
      `wtaIdsLearned=${summary.wtaIdsBackfilled} noDate=${summary.skippedNoDate}`,
  );
  if (summary.unresolvedNames.size > 0) {
    const names = [...summary.unresolvedNames].slice(0, 12);
    console.log(
      `[wta-results] unresolved players (${summary.unresolvedNames.size} distinct, first ${names.length}): ${names.join(", ")}`,
    );
  }
  // Rounds and winners that could not be resolved are NOT silently dropped:
  // an unnamed round is a match nobody gets points for, which is exactly the
  // kind of gap that looked like a ranking-formula bug last time.
  if (summary.unresolvedRounds.length > 0) {
    console.log(
      `[wta-results] unresolved rounds: ${summary.unresolvedRounds.length} ` +
        `(${summary.unresolvedRounds.slice(0, 6).join(", ")})`,
    );
  }
  if (summary.unresolvedWinners.length > 0) {
    console.log(
      `[wta-results] unresolved winner codes: ${summary.unresolvedWinners.length} ` +
        `(${summary.unresolvedWinners.slice(0, 6).join(", ")})`,
    );
  }
  for (const f of summary.failures) console.log(`[wta-results] failure: ${f}`);

  // A tournament that could not be fetched is a real failure. An unresolved
  // player is expected (qualifiers outside our top-800). Unresolved rounds are
  // expected too — Grand Slam qualifying carries an empty RoundID — so they
  // are reported but do not fail the run.
  if (summary.failures.length > 0) process.exitCode = 1;
}

runEntrypoint(main());
