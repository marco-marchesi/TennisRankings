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
import { comparisonSlug, namesMatch } from "./sources/live-tennis";
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

export async function expandRankings(
  tour: Tour,
  /** Rebuild a PAST week from TE's archive (`--date 2026-09-21`). */
  opts: { date?: string } = {},
): Promise<RunSummary> {
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
  const te = await fetchRanking(tour, TOP_N, opts.date);
  const teRows = te.rows;
  if (teRows.length === 0) return summary;
  summary.rowsTouched = teRows.length;

  // 2. Write into the week TE SAYS it is showing, and only when that is the
  //    latest OFFICIAL week.
  //
  //    This used to anchor to max(week_of) in our own table. When the official
  //    refresh failed (Cloudflare, 2026-09-14 and 2026-09-28), max(week_of)
  //    was still the PREVIOUS week, so TE's new list was written on top of the
  //    old official top 100 — and because TE's ranks 84 / 86 / 95 / 100 were
  //    held by different players than the official ones, two players ended up
  //    sharing each of those ranks. Refusing loudly is better: the official
  //    refresh now fails loudly too, and the fix belongs there.
  const officialWeekRow = await db.execute<{ w: string | null }>(sql`
    select max(week_of)::text as w from rankings_snapshots
    where tour = ${tour} and is_race = false and scrape_run_id is not null
      and (${opts.date ?? null}::date is null or week_of = ${opts.date ?? null}::date)
  `);
  const officialWeek =
    (((officialWeekRow as unknown as { rows?: Array<{ w: string | null }> }).rows ??
      (officialWeekRow as unknown as Array<{ w: string | null }>))[0]?.w) ?? null;
  if (!te.weekOf) {
    throw new Error(`[expand-rankings] ${tour}: could not read TennisExplorer's ranking date`);
  }
  if (te.weekOf !== officialWeek) {
    throw new Error(
      `[expand-rankings] ${tour}: TennisExplorer shows the ${te.weekOf} ranking but the latest ` +
        `OFFICIAL week is ${officialWeek ?? "none"} — refusing to mix two weeks in one bucket. ` +
        `Re-run once both sources show the same week.`,
    );
  }
  const writeWeek = te.weekOf;
  summary.weekOf = writeWeek;

  //    TE only EXTENDS the official list. Ranks the official scrape covered
  //    (ATP 1-500, WTA 1-500) and players it placed are left alone entirely —
  //    including not resolving their names, which is where TE's rotated
  //    "Belen Teichmann Jil" style names used to spawn phantom players.
  type OfficialRow = { player_id: number; rank: number; points: number; full_name: string };
  const officialRes = await db.execute<OfficialRow>(sql`
    select rs.player_id, rs.rank, rs.points, p.full_name
    from rankings_snapshots rs join players p on p.id = rs.player_id
    where rs.tour = ${tour} and rs.is_race = false and rs.week_of = ${writeWeek}
      and rs.scrape_run_id is not null
  `);
  const officialRows =
    (officialRes as unknown as { rows?: OfficialRow[] }).rows ??
    (officialRes as unknown as OfficialRow[]);
  const officialIds = new Set(officialRows.map((r) => Number(r.player_id)));
  const officialDepth = officialRows.reduce((m, r) => Math.max(m, Number(r.rank)), 0);

  // Remove this week's TE-derived rows that the official list now covers.
  // They are leftovers from before TE was limited to ranks beyond the
  // official depth, and they are exactly the rows that put a second player on
  // an official rank (e.g. the "Belen Teichmann Jil" phantom at #184). Only
  // when the official week is complete — rows it wrote carry scrape_run_id
  // (snapshot.ts), so a genuine official row is never matched here.
  if (officialRows.length >= 100 && officialDepth > 0) {
    await db.execute(sql`
      delete from rankings_snapshots
      where tour = ${tour} and is_race = false and week_of = ${writeWeek}
        and scrape_run_id is null and rank <= ${officialDepth}
    `);
  }

  // 3. Build lookup maps (slug, slug-suffix, normalized-name) for the players
  //    we already have in this tour.
  const existingPlayers = await db
    .select({
      id: schema.players.id,
      slug: schema.players.slug,
      fullName: schema.players.fullName,
      teSlug: schema.players.teSlug,
    })
    .from(schema.players)
    .where(eq(schema.players.tour, tour));
  const slugToId = new Map<string, number>();
  const teSlugToId = new Map<string, number>();
  for (const p of existingPlayers) if (p.teSlug) teSlugToId.set(p.teSlug, p.id);
  const suffixSlugToId = new Map<string, number[]>();
  const nameToId = new Map<string, number>();
  const sortedNameToId = new Map<string, number>();
  const allPlayers: Array<{ id: number; fullName: string }> = [];
  for (const p of existingPlayers) {
    slugToId.set(p.slug, p.id);
    nameToId.set(normalizeName(p.fullName), p.id);
    sortedNameToId.set(comparisonSlug(p.fullName, true), p.id);
    allPlayers.push({ id: p.id, fullName: p.fullName });
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

  await learnTeSlugs(tour, teRows, officialRows);

  for (const r of teRows) {
    if (r.rank <= officialDepth) continue;
    const playerId = await resolveOrCreatePlayer(r, tour, {
      teSlugToId,
      slugToId,
      suffixSlugToId,
      nameToId,
      sortedNameToId,
      allPlayers,
      now,
      summary,
    });
    if (playerId == null) continue;
    // Already placed by the official list at a rank within its depth: TE's
    // rank for them is from a different source and must not add a second one.
    if (officialIds.has(playerId)) continue;
    touchedPlayerIds.push(playerId);

    // Insert (or update) the snapshot. Never clobber rows that came from the
    // authoritative ATP/WTA scrape (scrape_run_id set) — they own
    // dropPoints/nextBest and our TE-derived row doesn't have those.
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
          rank: sql`case when ${schema.rankingsSnapshots.scrapeRunId} is null then excluded.rank else ${schema.rankingsSnapshots.rank} end`,
          points: sql`case when ${schema.rankingsSnapshots.scrapeRunId} is null then excluded.points else ${schema.rankingsSnapshots.points} end`,
          // Always overwrite rank_move — TE is the only source for it,
          // so a fresh scrape's value is always more current.
          rankMove: sql`excluded.rank_move`,
        },
      });
    summary.snapshotsInserted++;
    if (r.rankMove != null) summary.rankMovesCaptured++;
  }

  // Drop this week's TE rows that this fetch did not produce — rows written
  // from a different week's list (the 2026-09-21 ATP bucket held TE's 09-28
  // list) or for a player TE no longer places. Makes a week's TE layer exactly
  // what TE published for it, so re-running is idempotent.
  if (touchedPlayerIds.length >= 100) {
    await db.execute(sql`
      delete from rankings_snapshots
      where tour = ${tour} and is_race = false and week_of = ${writeWeek}
        and scrape_run_id is null
        and not (player_id = any(array[${sql.join(touchedPlayerIds.map((id) => sql`${id}`), sql`, `)}]::int[]))
    `);
  }

  if (touchedPlayerIds.length > 0 && !opts.date) {
    await db
      .update(schema.players)
      .set({ lastSeenInRankingsAt: now })
      .where(inArray(schema.players.id, touchedPlayerIds));
  }

  return summary;
}

/**
 * Record TennisExplorer's player id on the official players it lists.
 *
 * Only on proof: same week, same rank AND same points as an official row, and
 * at least one shared name token. That combination cannot pair two different
 * players, which the name-only paths above can. scrape-daily-matches uses
 * these ids to tell a known player from a same-surname, same-initial player we
 * do not hold (Brandon vs Bryce Nakashima: TE lists both as "Nakashima B.").
 */
async function learnTeSlugs(
  tour: Tour,
  teRows: Array<{ rank: number; points: number; teSlug: string; displayName: string }>,
  officialRows: Array<{ player_id: number; rank: number; points: number; full_name: string }>,
): Promise<number> {
  const words = (s: string) =>
    new Set(
      s
        .normalize("NFKD")
        .replace(/[̀-ͯ]/g, "")
        .toLowerCase()
        .split(/[^a-z]+/)
        .filter((w) => w.length >= 3),
    );
  const byRank = new Map<number, typeof officialRows>();
  for (const o of officialRows) {
    const list = byRank.get(Number(o.rank)) ?? [];
    list.push(o);
    byRank.set(Number(o.rank), list);
  }
  const pairs: Array<{ id: number; slug: string }> = [];
  for (const r of teRows) {
    if (!r.teSlug) continue;
    const te = words(r.displayName);
    const hits = (byRank.get(r.rank) ?? []).filter(
      (o) => Number(o.points) === r.points && [...words(o.full_name)].some((w) => te.has(w)),
    );
    if (hits.length === 1) pairs.push({ id: Number(hits[0]!.player_id), slug: r.teSlug });
  }
  for (const { id, slug } of pairs) {
    // A slug belongs to one player: release it from anyone else first.
    await db.execute(sql`
      update players set te_slug = null
      where te_slug = ${slug} and id <> ${id} and tour = ${tour}
    `);
    await db.execute(sql`update players set te_slug = ${slug} where id = ${id}`);
  }
  console.log(`[expand-rankings] ${tour.toUpperCase()}: learned ${pairs.length} TennisExplorer player id(s)`);
  return pairs.length;
}

interface ResolveCtx {
  /** TennisExplorer player id -> ours (players.te_slug). */
  teSlugToId: Map<string, number>;
  slugToId: Map<string, number>;
  suffixSlugToId: Map<string, number[]>;
  nameToId: Map<string, number>;
  /**
   * Token-SORTED name key -> player id. TennisExplorer renders names surname
   * first ("Cerundolo Juan Manuel") and `reorderName()` rotates the tokens
   * rather than reordering them correctly, so the order-sensitive `nameToId`
   * lookup missed and a phantom duplicate player was created. Sorting the
   * tokens makes the two renderings equal.
   */
  sortedNameToId: Map<string, number>;
  /** Every known player, for the tolerant last-resort comparison. */
  allPlayers: Array<{ id: number; fullName: string }>;
  now: Date;
  summary: RunSummary;
}

async function resolveOrCreatePlayer(
  r: { teSlug: string; fullName: string; countryCode: string | null },
  tour: Tour,
  ctx: ResolveCtx,
): Promise<number | null> {
  // 0. TennisExplorer's own player id, when we have learned it. Strongest of
  //    all: it survives every spelling TE uses. Without it, rebuilding a past
  //    week re-created "Abedallah Shelbayh" beside the merged "Abdullah
  //    Shelbayh", whose TE id was already known.
  const byTeSlug = ctx.teSlugToId.get(r.teSlug);
  if (byTeSlug != null) {
    ctx.summary.playersMatchedBySlug++;
    return byTeSlug;
  }

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

  // 3. Normalized-name match (order-sensitive).
  const nameKey = normalizeName(r.fullName);
  const byName = ctx.nameToId.get(nameKey);
  if (byName != null) {
    ctx.summary.playersMatchedByName++;
    return byName;
  }

  // 3b. Order-INSENSITIVE name match.
  //
  // This is the step whose absence created phantom players. TE gives names
  // surname-first and reorderName() rotates the tokens, so
  // "Juan Manuel Cerundolo" arrived as "Manuel Cerundolo Juan" — which step 3
  // could never match. The result was a second player row and therefore two
  // rows claiming the same rank: 203 rows in the ATP top-200 across five
  // duplicated ranks (Cerundolo, Tirante, Burruchaga, Merida, Shevchenko).
  const sortedKey = comparisonSlug(r.fullName, true);
  const bySorted = ctx.sortedNameToId.get(sortedKey);
  if (bySorted != null) {
    ctx.summary.playersMatchedByName++;
    return bySorted;
  }

  // 3c. Tolerant last resort: spelling variants (apostrophes, letter folding,
  //     transliteration, extra given names). Accepted ONLY when exactly one
  //     known player matches, so an ambiguous name still creates a new row
  //     rather than silently merging two people.
  const fuzzy = ctx.allPlayers.filter((p) =>
    namesMatch(p.fullName, r.fullName, { fuzzy: false }),
  );
  if (fuzzy.length === 1) {
    ctx.summary.playersMatchedByName++;
    return fuzzy[0]!.id;
  }
  if (fuzzy.length > 1) {
    console.warn(
      `[expand-rankings] "${r.fullName}" matches ` +
        `${fuzzy.map((f) => f.fullName).join(", ")} — ambiguous, ` +
        `creating a new row instead of guessing`,
    );
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
      teSlug: r.teSlug || null,
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
  const dateIdx = args.indexOf("--date");
  const date = dateIdx >= 0 ? args[dateIdx + 1] : undefined;
  let failed = 0;
  for (const t of tours) {
    let s: RunSummary;
    try {
      s = await expandRankings(t, { date });
    } catch (err) {
      failed++;
      console.error(err instanceof Error ? err.message : err);
      continue;
    }
    console.log(
      `[expand-rankings] ${t.toUpperCase()}: week=${s.weekOf}  rows=${s.rowsTouched}  ` +
        `inserted=${s.playersInserted}  matchedBySlug=${s.playersMatchedBySlug}  ` +
        `matchedByName=${s.playersMatchedByName}  snapshots+=${s.snapshotsInserted}  ` +
        `rankMoves=${s.rankMovesCaptured}`,
    );
  }
  if (failed > 0) process.exit(1);
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
