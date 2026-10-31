/**
 * Per-player WTA results, with the OFFICIAL points of each event.
 *
 * `api.wtatennis.com/tennis/players/{id}/matches` lists a player's matches,
 * newest first, and every row carries `points_1` / `points_2`: that player's
 * total for the whole event, as the WTA scored it (qualifying included, ITF
 * events included). Grouped by event, that is the player's ranking breakdown
 * — the thing the WTA website does not otherwise publish, and the reason the
 * live WTA ranking could not apply the best-18 rule.
 *
 * The feed lags: an event appears once it has been counted in an official
 * ranking (the week in progress is never in it), so it describes exactly the
 * results behind the latest Monday publish.
 *
 * Cached per ranking week in data/wta-player-events/ (gitignored, like
 * data/archive/), refreshed when older than a day, because one request per
 * page per player at politeFetch's 1 req/s is several minutes for the top 300.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { politeFetch } from "../http";

const BASE = "https://api.wtatennis.com/tennis/players";
const CACHE_DIR = join(process.cwd(), "data", "wta-player-events");
const MAX_AGE_MS = 24 * 3600 * 1000;

export interface WtaEvent {
  /** `${tourn_nbr}-${year}`: unique per edition. */
  key: string;
  /** The WTA's tournament number, shared by every edition of an event. */
  nbr: string;
  year: number;
  /** "TOKYO", "MADRID 1000", "NEW BRAUNFELS". */
  name: string;
  /** "GS", "PM", "P", "IS", "C" (125), "ITF", "CH" (Finals), ... */
  level: string;
  /** Prize money in USD; for ITF events this names the tier (W15..W100). */
  prize: number | null;
  start: string;
  end: string;
  /** The player's official points for the event. */
  points: number;
}

interface CacheFile {
  fetchedAt: Record<string, number>;
  events: Record<string, WtaEvent[]>;
}

function readCache(file: string): CacheFile {
  if (!existsSync(file)) return { fetchedAt: {}, events: {} };
  try {
    return JSON.parse(readFileSync(file, "utf8")) as CacheFile;
  } catch {
    return { fetchedAt: {}, events: {} };
  }
}

/** One player's singles events starting on or after `since`, newest first. */
export async function fetchWtaPlayerEvents(wtaId: string, since: string): Promise<WtaEvent[]> {
  const byKey = new Map<string, WtaEvent>();
  for (let page = 0; page < 6; page++) {
    const res = await politeFetch(`${BASE}/${wtaId}/matches?sort=desc&pageSize=100&page=${page}`, {
      headers: { Accept: "application/json" },
    });
    const json = JSON.parse(await res.text()) as { matches?: Array<Record<string, any>> };
    const matches = json.matches ?? [];
    for (const m of matches) {
      if (m.s_d_flag !== "S") continue;
      const start = String(m.StartDate ?? "").slice(0, 10);
      if (start < since) continue;
      const me = String(m.player_1) === String(wtaId) ? 1 : 2;
      const points = Number(m[`points_${me}`] ?? 0) || 0;
      const key = `${m.tourn_nbr}-${m.tourn_year}`;
      const prev = byKey.get(key);
      if (prev && prev.points >= points) continue;
      byKey.set(key, {
        key,
        nbr: String(m.tourn_nbr),
        year: Number(m.tourn_year),
        name: String(m.TournamentName ?? m.tournament?.tournamentGroup?.name ?? ""),
        level: String(m.TournamentLevel ?? ""),
        prize: m.PrizeMoney == null ? null : Number(m.PrizeMoney),
        start,
        end: String(m.tournament?.endDate ?? start).slice(0, 10),
        points,
      });
    }
    const oldest = String(matches[matches.length - 1]?.StartDate ?? "").slice(0, 10);
    if (matches.length < 100 || oldest < since) break;
  }
  return [...byKey.values()].sort((a, b) => b.start.localeCompare(a.start));
}

/**
 * Events for many players, through the per-week cache. A player whose fetch
 * fails is left out (the caller falls back to its own derivation) rather than
 * failing the whole run.
 */
export async function loadWtaPlayerEvents(
  wtaIds: string[],
  weekOf: string,
  since: string,
): Promise<Map<string, WtaEvent[]>> {
  const file = join(CACHE_DIR, `${weekOf}.json`);
  const cache = readCache(file);
  const now = Date.now();
  let fetched = 0;
  let failed = 0;
  for (const id of wtaIds) {
    const at = cache.fetchedAt[id];
    if (at != null && now - at < MAX_AGE_MS && cache.events[id]) continue;
    try {
      cache.events[id] = await fetchWtaPlayerEvents(id, since);
      cache.fetchedAt[id] = now;
      fetched++;
    } catch (err) {
      failed++;
      console.warn(`[wta-player-events] ${id}: ${(err as Error).message}`);
    }
  }
  if (fetched > 0) {
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, JSON.stringify(cache));
  }
  if (fetched > 0 || failed > 0) {
    console.log(`[wta-player-events] week ${weekOf}: fetched ${fetched}, failed ${failed}, cached ${wtaIds.length - fetched - failed}`);
  }
  const out = new Map<string, WtaEvent[]>();
  for (const id of wtaIds) if (cache.events[id]) out.set(id, cache.events[id]!);
  return out;
}

/**
 * ITF tier ("itf_w100", "itf_w75", ...) for an event, from its prize money.
 * W75 events advertise $60,000; W50 $40,000; W35 $25,000; W15 $15,000.
 */
export function itfTierFromPrize(prize: number | null): string | null {
  if (prize == null || prize <= 0) return null;
  if (prize >= 100_000) return "itf_w100";
  if (prize >= 60_000) return "itf_w75";
  if (prize >= 40_000) return "itf_w50";
  if (prize >= 25_000) return "itf_w35";
  return "itf_w15";
}

/**
 * Prize money of a TennisExplorer ITF event, from its tournament page
 * ("(100,000 $, hard, women)"). Needed for the week in progress: the WTA
 * calendar lists an ITF event only once it is over, and an event new to the
 * calendar (New Braunfels 2026) has no history to borrow a tier from.
 * `teId` is the stored external_tourney_id, e.g. "new-braunfels-itf-2026".
 * Cached for good in data/wta-player-events/itf-prize.json.
 */
export async function teItfPrize(teId: string): Promise<number | null> {
  const file = join(CACHE_DIR, "itf-prize.json");
  let cache: Record<string, number | null> = {};
  if (existsSync(file)) {
    try {
      cache = JSON.parse(readFileSync(file, "utf8")) as Record<string, number | null>;
    } catch {
      cache = {};
    }
  }
  if (teId in cache && cache[teId] != null) return cache[teId]!;
  const m = teId.match(/^(.*)-(\d{4})$/);
  if (!m) return null;
  let prize: number | null = null;
  try {
    const res = await politeFetch(`https://www.tennisexplorer.com/${m[1]}/${m[2]}/wta-women/`);
    const html = await res.text();
    const hit = html.match(/\(([\d,]+)\s*\$\s*,[^)]*women\)/i);
    prize = hit ? Number(hit[1]!.replace(/,/g, "")) : null;
  } catch (err) {
    console.warn(`[wta-player-events] ITF prize ${teId}: ${(err as Error).message}`);
  }
  cache[teId] = prize;
  mkdirSync(CACHE_DIR, { recursive: true });
  writeFileSync(file, JSON.stringify(cache));
  return prize;
}
