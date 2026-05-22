import "server-only";
import { db, schema } from "@/db";
import { eq, ilike, sql } from "drizzle-orm";
import { mockTopRanked } from "./mock-data";

export interface PlayerDetail {
  id: number;
  slug: string;
  fullName: string;
  countryCode: string | null;
  dateOfBirth: string | null;
  height_cm: number | null;
  plays: "right" | "left" | "unknown" | null;
  /** "one-handed" | "two-handed" — from Wikipedia infobox enrichment. */
  backhand: string | null;
  turnedPro: number | null;
  photoUrl: string | null;
  photoAttribution: string | null;
  /** Truthy when /api/player-photo/[slug] will serve a real image. */
  hasCachedPhoto: boolean;
  wikipediaUrl: string | null;
  bio: string | null;
  tour: "atp" | "wta" | "challenger" | "itf";
  /** Latest settled rank from rankings_snapshots (singles, not race). */
  currentRank: number | null;
  /** Latest settled points total. */
  currentPoints: number | null;
  /** Best (lowest) rank across all historical snapshots. */
  careerHighRank: number | null;
  /** ISO date of the week when career high was achieved (most recent if ties). */
  careerHighWeek: string | null;
  /** Race rank within the current calendar year (if scraped). */
  raceRank: number | null;
  /** National rank from the latest settled week. */
  nationalRank: number | null;
}

export interface RecentMatchRow {
  playedOn: string;
  tournamentName: string;
  tournamentLevel: string | null;
  surface: string | null;
  round: string;
  opponentName: string;
  opponentCountry: string | null;
  won: boolean;
  score: string | null;
}

export interface SurfaceSplit {
  surface: "Hard" | "Clay" | "Grass" | "Carpet";
  matches: number;
  wins: number;
  losses: number;
  setsWon: number;
  setsLost: number;
  gamesWon: number;
  gamesLost: number;
}

/**
 * Aggregates per-surface match outcomes for a player from
 * `player_recent_matches`. Returns one row per surface that has data,
 * ordered Hard → Clay → Grass → Carpet. Coverage is bounded by the
 * per-player match cap (`PER_PLAYER_LIMIT` in scraper/backfill-matches.ts)
 * — currently the last ~80 matches, which gives a representative ~12-month
 * slice for any top-50 player.
 */
export async function getSurfaceSplits(slug: string): Promise<SurfaceSplit[]> {
  try {
    // DISTINCT ON dedups the same logical match when both TA and TE rows
    // exist for it — preferring the TE row via the source-ordering trick
    // (TE alphabetises after TA → 0 wins the DISTINCT ON pick).
    const rows = await db.execute<{ surface: string | null; won: boolean; score: string | null }>(sql`
      select distinct on (prm.player_id, prm.played_on, lower(prm.opponent_name))
        prm.surface, prm.won, prm.score
      from player_recent_matches prm
      join players p on p.id = prm.player_id
      where p.slug = ${slug}
      order by prm.player_id, prm.played_on, lower(prm.opponent_name),
               case prm.source when 'tennis_explorer' then 0 else 1 end
    `);
    const matches =
      (rows as unknown as { rows: Array<{ surface: string | null; won: boolean; score: string | null }> })
        .rows ??
      (rows as unknown as Array<{ surface: string | null; won: boolean; score: string | null }>);

    const accum = new Map<SurfaceSplit["surface"], SurfaceSplit>();
    for (const m of matches) {
      const surf = normalizeSurface(m.surface);
      if (!surf) continue;
      const row = accum.get(surf) ?? {
        surface: surf,
        matches: 0,
        wins: 0,
        losses: 0,
        setsWon: 0,
        setsLost: 0,
        gamesWon: 0,
        gamesLost: 0,
      };
      row.matches++;
      if (m.won) row.wins++;
      else row.losses++;
      const parsed = parseScore(m.score ?? "", m.won);
      row.setsWon += parsed.setsWon;
      row.setsLost += parsed.setsLost;
      row.gamesWon += parsed.gamesWon;
      row.gamesLost += parsed.gamesLost;
      accum.set(surf, row);
    }
    const order: SurfaceSplit["surface"][] = ["Hard", "Clay", "Grass", "Carpet"];
    return order.map((s) => accum.get(s)).filter((r): r is SurfaceSplit => !!r);
  } catch {
    return [];
  }
}

function normalizeSurface(s: string | null): SurfaceSplit["surface"] | null {
  if (!s) return null;
  const lower = s.toLowerCase();
  if (lower.includes("hard")) return "Hard";
  if (lower.includes("clay")) return "Clay";
  if (lower.includes("grass")) return "Grass";
  if (lower.includes("carpet")) return "Carpet";
  return null;
}

/**
 * Parses a Tennis Abstract score string from the perspective of the player
 * whose `won` flag is given. Score format examples:
 *   "6-4 6-2"               two-set straight-set win
 *   "7-6(5) 6-4"            with a tiebreak
 *   "6-3 4-6 7-5"           three-set match
 *   "6-2 1-0 RET"           opponent retired
 *   "W/O" / "DEF"           walkover / default — no games counted
 * The CSV writes the winner's score first ("6-4 6-2" means winner won 6,
 * loser won 4). We flip if the player lost.
 */
function parseScore(
  score: string,
  playerWon: boolean,
): { setsWon: number; setsLost: number; gamesWon: number; gamesLost: number } {
  const empty = { setsWon: 0, setsLost: 0, gamesWon: 0, gamesLost: 0 };
  if (!score) return empty;
  if (/^(W\/O|WO|DEF|RET)$/i.test(score.trim())) return empty;

  let winnerGames = 0;
  let loserGames = 0;
  let winnerSets = 0;
  let loserSets = 0;
  // Drop terminal "RET" tokens so they don't trip the per-set parser.
  const setStrs = score
    .split(/\s+/)
    .filter((s) => s && !/^(RET|W\/O|WO|DEF)$/i.test(s));
  for (const s of setStrs) {
    const cleaned = s.replace(/\([^)]*\)/g, "");
    const m = cleaned.match(/^(\d+)-(\d+)$/);
    if (!m) continue;
    const a = Number(m[1]);
    const b = Number(m[2]);
    winnerGames += a;
    loserGames += b;
    if (a > b) winnerSets++;
    else if (b > a) loserSets++;
  }
  return playerWon
    ? { setsWon: winnerSets, setsLost: loserSets, gamesWon: winnerGames, gamesLost: loserGames }
    : { setsWon: loserSets, setsLost: winnerSets, gamesWon: loserGames, gamesLost: winnerGames };
}

export async function getRecentMatches(slug: string, limit = 10): Promise<RecentMatchRow[]> {
  try {
    // Two-step dedup: pick one row per (date, opponent) preferring the
    // tennis_explorer source via the source-CASE ordering, then re-sort
    // chronologically and apply the row limit.
    const raw = await db.execute<{
      played_on: string;
      tournament_name: string;
      tournament_level: string | null;
      surface: string | null;
      round: string;
      opponent_name: string;
      opponent_country: string | null;
      won: boolean;
      score: string | null;
    }>(sql`
      with deduped as (
        select distinct on (prm.player_id, prm.played_on, lower(prm.opponent_name))
          prm.played_on, prm.tournament_name, prm.tournament_level,
          prm.surface, prm.round, prm.opponent_name, prm.opponent_country,
          prm.won, prm.score
        from player_recent_matches prm
        join players p on p.id = prm.player_id
        where p.slug = ${slug}
        order by prm.player_id, prm.played_on, lower(prm.opponent_name),
                 case prm.source when 'tennis_explorer' then 0 else 1 end
      )
      select * from deduped order by played_on desc limit ${limit};
    `);
    const rows =
      (raw as unknown as { rows: Array<Record<string, unknown>> }).rows ??
      (raw as unknown as Array<Record<string, unknown>>);
    return rows.map((r) => ({
      playedOn: String(r.played_on),
      tournamentName: String(r.tournament_name),
      tournamentLevel: (r.tournament_level as string | null) ?? null,
      surface: (r.surface as string | null) ?? null,
      round: String(r.round),
      opponentName: String(r.opponent_name),
      opponentCountry: (r.opponent_country as string | null) ?? null,
      won: Boolean(r.won),
      score: (r.score as string | null) ?? null,
    }));
  } catch {
    return [];
  }
}

export interface ActiveTournament {
  tournamentName: string;
  tournamentLevel: string | null;
  scheduledDate: string;
  scheduledTime: string | null;
  opponentName: string;
  opponentCountry: string | null;
}

/**
 * Returns the player's next scheduled match if one exists in the upcoming
 * window we've scraped from TennisExplorer. Used to render the "Active
 * tournament" card on the player profile. Returns null when the player
 * isn't scheduled to play next — the card is hidden in that case.
 */
export async function getActiveTournament(slug: string): Promise<ActiveTournament | null> {
  try {
    const raw = await db.execute<{
      tournament_name: string;
      tournament_level: string | null;
      scheduled_date: string;
      scheduled_time: string | null;
      opponent_name: string;
      opponent_country: string | null;
    }>(sql`
      select pum.tournament_name, pum.tournament_level,
             pum.scheduled_date, pum.scheduled_time,
             pum.opponent_name, pum.opponent_country
      from player_upcoming_matches pum
      join players p on p.id = pum.player_id
      where p.slug = ${slug}
        and pum.scheduled_date >= current_date
      order by pum.scheduled_date asc, coalesce(pum.scheduled_time, '99:99') asc
      limit 1;
    `);
    const rows =
      (raw as unknown as { rows: Array<Record<string, unknown>> }).rows ??
      (raw as unknown as Array<Record<string, unknown>>);
    if (rows.length === 0) return null;
    const r = rows[0]!;
    return {
      tournamentName: String(r.tournament_name),
      tournamentLevel: (r.tournament_level as string | null) ?? null,
      scheduledDate: String(r.scheduled_date),
      scheduledTime: (r.scheduled_time as string | null) ?? null,
      opponentName: String(r.opponent_name),
      opponentCountry: (r.opponent_country as string | null) ?? null,
    };
  } catch {
    return null;
  }
}

export async function getPlayerBySlug(slug: string): Promise<PlayerDetail | null> {
  try {
    const rows = await db.execute<{
      id: number;
      slug: string;
      full_name: string;
      country_code: string | null;
      date_of_birth: string | null;
      height_cm: number | null;
      plays: "right" | "left" | "unknown" | null;
      backhand: string | null;
      turned_pro: number | null;
      photo_url: string | null;
      photo_attribution: string | null;
      has_cached_photo: boolean;
      wikipedia_url: string | null;
      bio: string | null;
      tour: "atp" | "wta" | "challenger" | "itf";
      current_rank: number | null;
      current_points: number | null;
      career_high_rank: number | null;
      career_high_week: string | null;
      race_rank: number | null;
      national_rank: number | null;
    }>(sql`
      with target as (
        select * from players where slug = ${slug} limit 1
      ),
      latest as (
        select rs.* from rankings_snapshots rs
        join target t on t.id = rs.player_id
        where rs.is_race = false
        order by rs.week_of desc
        limit 1
      ),
      latest_race as (
        select rs.* from rankings_snapshots rs
        join target t on t.id = rs.player_id
        where rs.is_race = true
        order by rs.week_of desc
        limit 1
      ),
      ch as (
        select rs.rank, rs.week_of
        from rankings_snapshots rs
        join target t on t.id = rs.player_id
        where rs.is_race = false
        order by rs.rank asc, rs.week_of desc
        limit 1
      ),
      nat as (
        select row_number() over (order by rs.rank) as national_rank
        from rankings_snapshots rs
        join players p on p.id = rs.player_id
        where rs.is_race = false
          and rs.week_of = (select week_of from latest)
          and p.country_code = (select country_code from target)
          and rs.rank <= (select rank from latest)
        order by rs.rank desc
        limit 1
      )
      select
        t.id, t.slug, t.full_name, t.country_code, t.date_of_birth::text as date_of_birth,
        t.height_cm, t.plays, t.backhand, t.turned_pro, t.photo_url, t.photo_attribution,
        (t.photo_bytes is not null) as has_cached_photo,
        t.wikipedia_url, t.bio, t.tour,
        (select rank from latest) as current_rank,
        (select points from latest) as current_points,
        (select rank from ch) as career_high_rank,
        (select week_of::text from ch) as career_high_week,
        (select rank from latest_race) as race_rank,
        (select national_rank from nat) as national_rank
      from target t;
    `);
    const result = (rows as unknown as { rows: Record<string, unknown>[] }).rows ?? (rows as unknown as Record<string, unknown>[]);
    const r = Array.isArray(result) ? result[0] : undefined;
    if (!r) return mockPlayer(slug);

    return {
      id: Number(r.id),
      slug: String(r.slug),
      fullName: String(r.full_name),
      countryCode: (r.country_code as string | null) ?? null,
      dateOfBirth: r.date_of_birth == null ? null : String(r.date_of_birth),
      height_cm: r.height_cm == null ? null : Number(r.height_cm),
      plays: (r.plays as "right" | "left" | "unknown" | null) ?? null,
      backhand: (r.backhand as string | null) ?? null,
      turnedPro: r.turned_pro == null ? null : Number(r.turned_pro),
      photoUrl: (r.photo_url as string | null) ?? null,
      photoAttribution: (r.photo_attribution as string | null) ?? null,
      hasCachedPhoto: Boolean(r.has_cached_photo),
      wikipediaUrl: (r.wikipedia_url as string | null) ?? null,
      bio: (r.bio as string | null) ?? null,
      tour: (r.tour as PlayerDetail["tour"]),
      currentRank: r.current_rank == null ? null : Number(r.current_rank),
      currentPoints: r.current_points == null ? null : Number(r.current_points),
      careerHighRank: r.career_high_rank == null ? null : Number(r.career_high_rank),
      careerHighWeek: r.career_high_week == null ? null : String(r.career_high_week),
      raceRank: r.race_rank == null ? null : Number(r.race_rank),
      nationalRank: r.national_rank == null ? null : Number(r.national_rank),
    };
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn("getPlayerBySlug failed, falling back to mock:", err);
    return mockPlayer(slug);
  }
}

export async function searchPlayers(q: string, limit = 8) {
  if (!q || q.length < 2) return [];
  try {
    // Raw SQL — Drizzle's nested-${tableRef} interpolation produces a
    // subquery that returns the wrong rank (rank-of-rank, not the row).
    // Hand-written CTE keeps the lateral lookup unambiguous.
    const raw = await db.execute<{
      slug: string;
      full_name: string;
      country_code: string | null;
      tour: "atp" | "wta" | "challenger" | "itf";
      rank: number | null;
    }>(sql`
      select p.slug, p.full_name, p.country_code, p.tour,
             (
               select rs.rank
               from rankings_snapshots rs
               where rs.player_id = p.id
                 and rs.is_race = false
               order by rs.week_of desc
               limit 1
             ) as rank
      from players p
      where p.full_name ilike ${`%${q}%`}
      limit ${limit};
    `);
    const rs =
      (raw as unknown as { rows: Array<Record<string, unknown>> }).rows ??
      (raw as unknown as Array<Record<string, unknown>>);
    if (rs.length > 0) {
      return rs.map((r) => ({
        slug: String(r.slug),
        fullName: String(r.full_name),
        countryCode: (r.country_code as string | null) ?? null,
        tour: r.tour as "atp" | "wta" | "challenger" | "itf",
        rank: r.rank == null ? null : Number(r.rank),
      }));
    }
  } catch {
    /* fall through to mock */
  }
  // Mock fallback for dev/preview
  const all = [...mockTopRanked("atp", 10), ...mockTopRanked("wta", 10)];
  return all
    .filter((r) => r.player.fullName.toLowerCase().includes(q.toLowerCase()))
    .slice(0, limit)
    .map((r) => ({
      slug: r.player.slug,
      fullName: r.player.fullName,
      countryCode: r.player.countryCode,
      tour: r.rank > 100 ? "wta" : ("atp" as const),
      rank: r.rank,
    }));
}

export async function listAllPlayerSlugs(): Promise<Array<{ slug: string; updatedAt: Date }>> {
  try {
    const rows = await db
      .select({ slug: schema.players.slug, updatedAt: schema.players.updatedAt })
      .from(schema.players);
    if (rows.length > 0) return rows;
  } catch {
    /* fall through */
  }
  return [...mockTopRanked("atp", 10), ...mockTopRanked("wta", 10)].map((r) => ({
    slug: r.player.slug,
    updatedAt: new Date(),
  }));
}

function mockPlayer(slug: string): PlayerDetail | null {
  const all = [...mockTopRanked("atp", 10), ...mockTopRanked("wta", 10)];
  const hit = all.find((r) => r.player.slug === slug);
  if (!hit) return null;
  return {
    id: hit.player.id,
    slug: hit.player.slug,
    fullName: hit.player.fullName,
    countryCode: hit.player.countryCode,
    dateOfBirth: null,
    height_cm: null,
    plays: hit.player.plays,
    backhand: null,
    turnedPro: null,
    photoUrl: null,
    photoAttribution: null,
    hasCachedPhoto: false,
    wikipediaUrl: `https://en.wikipedia.org/wiki/${encodeURIComponent(hit.player.fullName)}`,
    bio: null,
    tour: hit.player.id < 100 ? "atp" : "wta",
    currentRank: hit.rank,
    currentPoints: hit.points,
    careerHighRank: hit.rank,
    careerHighWeek: hit.weekOf,
    raceRank: null,
    nationalRank: hit.nationalRank,
  };
}
