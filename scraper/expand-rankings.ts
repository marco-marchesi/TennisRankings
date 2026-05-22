// Fills out ranks 101–800 from TennisExplorer's weekly ranking page.
//
// We use TE (not Tennis Abstract) for this because TE exposes the "Move"
// column — the per-row rank change from the previous published week —
// which TA's CSV doesn't. Capturing the move lets the rankings UI draw
// up/down arrows without re-deriving from a prior snapshot.
//
// What we DON'T get from TE: player metadata (DOB, height, hand,
// wikidata_id). New players from TE land with minimal info. They'll be
// filled in later by `enrich-players` (Wikidata search by name) or by
// `backfill-history` (which pulls TA's metadata for ranked players).
//
// Guarantees:
//   - SLUG STABILITY: existing players are matched by `players.slug`
//     (with suffix-based fuzzy matching for TE's "lastname-id" form).
//     Once a slug is set, this script never overwrites it.
//   - SOFT RETIREMENT: every touched player gets a fresh
//     `last_seen_in_rankings_at`. Players who fall off the top 800 are
//     not deleted, just stale.

import { db, schema } from "@/db";
import { and, eq, inArray, sql } from "drizzle-orm";
import { fetchRanking, type Tour } from "./sources/tennis-explorer-rankings";
import { slugify } from "@/lib/utils";

const TOP_N = 800;

interface RunSummary {
  tour: Tour;
  weekOf: string | null;
  rowsTouched: number;
  playersInserted: number;
  playersMatchedBySlug: number;
  playersMatchedByName: number;
  snapshotsInserted: number;
  rankMovesCaptured: number;
}

export async function expandRankings(tour: Tour): Promise<RunSummary> {
  const summary: RunSummary = {
    tour,
    weekOf: null,
    rowsTouched: 0,
    playersInserted: 0,
    playersMatchedBySlug: 0,
    playersMatchedByName: 0,
    snapshotsInserted: 0,
    rankMovesCaptured: 0,
  };

  // 1. Pull the full top-N from TE (16 pages × 50 rows for top-800).
  const teRows = await fetchRanking(tour, TOP_N);
  if (teRows.length === 0) return summary;
  summary.rowsTouched = teRows.length;

  // 2. Anchor to the most-recently-scraped ATP/WTA week so top-800 rows
  //    share a `week_of` bucket with the top-100 official rows. Lets the UI
  //    query "this week's rankings" with no UNION.
  const anchorRow = await db
    .select({ w: sql<string>`max(${schema.rankingsSnapshots.weekOf})` })
    .from(schema.rankingsSnapshots)
    .where(
      and(eq(schema.rankingsSnapshots.tour, tour), eq(schema.rankingsSnapshots.isRace, false)),
    );
  const writeWeek = anchorRow[0]?.w ?? new Date().toISOString().slice(0, 10);
  summary.weekOf = writeWeek;

  // 3. Build lookup maps (slug, slug-suffix, normalized-name) for the players
  //    we already have in this tour.
  const existingPlayers = await db
    .select({ id: schema.players.id, slug: schema.players.slug, fullName: schema.players.fullName })
    .from(schema.players)
    .where(eq(schema.players.tour, tour));
  const slugToId = new Map<string, number>();
  const suffixSlugToId = new Map<string, number[]>();
  const nameToId = new Map<string, number>();
  for (const p of existingPlayers) {
    slugToId.set(p.slug, p.id);
    nameToId.set(normalizeName(p.fullName), p.id);
    // Index by progressively-shorter slug suffixes (last 1-3 segments) so
    // we can match TE's "sinner-8b8e8" against our "jannik-sinner".
    const seg = p.slug.split("-");
    for (let i = 1; i <= Math.min(3, seg.length); i++) {
      const suf = seg.slice(-i).join("-");
      if (suf.length < 3) continue;
      const list = suffixSlugToId.get(suf) ?? [];
      list.push(p.id);
      suffixSlugToId.set(suf, list);
    }
  }

  const now = new Date();
  const touchedPlayerIds: number[] = [];

  for (const r of teRows) {
    const playerId = await resolveOrCreatePlayer(r, tour, {
      slugToId,
      suffixSlugToId,
      nameToId,
      now,
      summary,
    });
    if (playerId == null) continue;
    touchedPlayerIds.push(playerId);

    // Insert (or update) the snapshot. Never clobber top-100 rows that came
    // from the authoritative ATP/WTA scrape — they own dropPoints/nextBest
    // and our TE-derived row doesn't have those.
    await db
      .insert(schema.rankingsSnapshots)
      .values({
        tour,
        weekOf: writeWeek,
        playerId,
        rank: r.rank,
        points: r.points,
        rankMove: r.rankMove,
        isRace: false,
      })
      .onConflictDoUpdate({
        target: [
          schema.rankingsSnapshots.tour,
          schema.rankingsSnapshots.weekOf,
          schema.rankingsSnapshots.playerId,
          schema.rankingsSnapshots.isRace,
        ],
        set: {
          rank: sql`case when ${schema.rankingsSnapshots.rank} > 100 or ${schema.rankingsSnapshots.rank} is null then excluded.rank else ${schema.rankingsSnapshots.rank} end`,
          points: sql`case when ${schema.rankingsSnapshots.rank} > 100 or ${schema.rankingsSnapshots.rank} is null then excluded.points else ${schema.rankingsSnapshots.points} end`,
          // Always overwrite rank_move — TE is the only source for it,
          // so a fresh scrape's value is always more current.
          rankMove: sql`excluded.rank_move`,
        },
      });
    summary.snapshotsInserted++;
    if (r.rankMove != null) summary.rankMovesCaptured++;
  }

  if (touchedPlayerIds.length > 0) {
    await db
      .update(schema.players)
      .set({ lastSeenInRankingsAt: now })
      .where(inArray(schema.players.id, touchedPlayerIds));
  }

  return summary;
}

interface ResolveCtx {
  slugToId: Map<string, number>;
  suffixSlugToId: Map<string, number[]>;
  nameToId: Map<string, number>;
  now: Date;
  summary: RunSummary;
}

async function resolveOrCreatePlayer(
  r: { teSlug: string; fullName: string; countryCode: string | null },
  tour: Tour,
  ctx: ResolveCtx,
): Promise<number | null> {
  // 1. Direct slug match — strongest, used when TE's slug already matches.
  const direct = ctx.slugToId.get(r.teSlug);
  if (direct != null) {
    ctx.summary.playersMatchedBySlug++;
    return direct;
  }

  // 2. Slug-suffix match — TE's "sinner-8b8e8" → our "jannik-sinner". Strip
  //    TE's id-suffix ("8b8e8") then look up by the cleaned remainder.
  const cleaned = stripIdSuffix(r.teSlug);
  if (cleaned !== r.teSlug) {
    const direct2 = ctx.slugToId.get(cleaned);
    if (direct2 != null) {
      ctx.summary.playersMatchedBySlug++;
      return direct2;
    }
    const candidates = ctx.suffixSlugToId.get(cleaned);
    if (candidates && candidates.length === 1) {
      ctx.summary.playersMatchedBySlug++;
      return candidates[0]!;
    }
  }

  // 3. Normalized-name match.
  const nameKey = normalizeName(r.fullName);
  const byName = ctx.nameToId.get(nameKey);
  if (byName != null) {
    ctx.summary.playersMatchedByName++;
    return byName;
  }

  // 4. Insert a minimal player row. No DOB/height/hand/wikidata — those get
  //    filled later by `enrich-players` (Wikidata search) or
  //    `backfill-history` (TA metadata file).
  const newSlug = slugify(r.fullName);
  if (!newSlug) return null;
  const inserted = await db
    .insert(schema.players)
    .values({
      slug: newSlug,
      fullName: r.fullName,
      firstName: r.fullName.split(/\s+/)[0]!,
      lastName: r.fullName.split(/\s+/).slice(1).join(" ") || r.fullName,
      countryCode: null, // TE flag class is 2-letter; our DB is 3-letter ISO
      tour,
      slugStableAt: ctx.now,
      lastSeenInRankingsAt: ctx.now,
    })
    .onConflictDoUpdate({
      target: schema.players.slug,
      set: {
        lastSeenInRankingsAt: ctx.now,
        updatedAt: ctx.now,
      },
    })
    .returning({ id: schema.players.id });
  const id = inserted[0]?.id;
  if (id == null) return null;
  ctx.slugToId.set(newSlug, id);
  ctx.summary.playersInserted++;
  return id;
}

/**
 * TE attaches alphanumeric id-suffixes to disambiguate name collisions
 * ("humbert-e2553"). Strip the last segment when it's 4+ chars and
 * contains a digit — same heuristic as scrape-daily-matches.ts.
 */
function stripIdSuffix(slug: string): string {
  const parts = slug.split("-");
  if (parts.length < 2) return slug;
  const last = parts[parts.length - 1]!;
  if (last.length >= 4 && /\d/.test(last)) return parts.slice(0, -1).join("-");
  return slug;
}

function normalizeName(s: string): string {
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
  const tours: Tour[] = tourArg ? [tourArg] : ["atp", "wta"];
  for (const t of tours) {
    const s = await expandRankings(t);
    console.log(
      `[expand-rankings] ${t.toUpperCase()}: week=${s.weekOf}  rows=${s.rowsTouched}  ` +
        `inserted=${s.playersInserted}  matchedBySlug=${s.playersMatchedBySlug}  ` +
        `matchedByName=${s.playersMatchedByName}  snapshots+=${s.snapshotsInserted}  ` +
        `rankMoves=${s.rankMovesCaptured}`,
    );
  }
}

const entryFile = process.argv[1] ?? "";
if (entryFile.endsWith("expand-rankings.ts") || entryFile.endsWith("expand-rankings.js")) {
  main()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
