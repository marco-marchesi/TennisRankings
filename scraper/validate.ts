import { z } from "zod";

export const RankingEntry = z.object({
  rank: z.number().int().min(1).max(2500),
  slug: z.string().min(1),
  fullName: z.string().min(2).max(120),
  countryCode: z.string().length(3).nullable(),
  // The tour's own player id: atptour.com's "s0ag" from the profile href,
  // wtatennis.com's "320760" from data-player-id. snapshot.ts resolves players
  // by it first, so a spelling change on the tour site no longer spawns a
  // second player row.
  externalId: z.string().min(1).max(20).nullable().optional(),
  points: z.number().int().min(0).max(20000),
  // 80, not 40: below the top 100 challenger regulars exceed 40 events in a
  // 52-week window (seen on atptour.com's rankRange=1-400 page, 2026-09-28),
  // and a cap of 40 rejected the whole snapshot over one row.
  tournamentsPlayed: z.number().int().min(0).max(80).nullable(),
  // Optional: ATP/WTA pages display the player's integer age in a dedicated
  // cell. We capture it so the write layer can derive a stable dateOfBirth
  // (approximated to Jan 1 of birth year) for filtering by age band in UI.
  age: z.number().int().min(14).max(60).nullable().optional(),
  // ATP only — verbatim values from the rankings page's right-hand columns.
  // `pointsMove` is the published "+/-" delta, `dropPoints` is the published
  // "Dropping" count, `nextBestPoints` is the published "Next Best" value.
  // These are nullable because (a) WTA doesn't expose them and (b) when ATP
  // renders a "-" for that cell we coerce to null.
  // Generous bounds: race rankings can swing by 2000+ in a single week early
  // in the calendar, and "dropping" totals at year-end finals can exceed 1500.
  pointsMove: z.number().int().min(-20000).max(20000).nullable().optional(),
  dropPoints: z.number().int().min(0).max(20000).nullable().optional(),
  nextBestPoints: z.number().int().min(0).max(20000).nullable().optional(),
});

export type RankingEntry = z.infer<typeof RankingEntry>;

export const RankingSnapshot = z.object({
  tour: z.enum(["atp", "wta", "challenger", "itf"]),
  weekOf: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  isRace: z.boolean().default(false),
  entries: z.array(RankingEntry).min(100), // sanity floor
});

export type RankingSnapshot = z.infer<typeof RankingSnapshot>;

interface SanityCheckResult {
  ok: boolean;
  deltaPct: number;
  reason?: string;
}

/**
 * Reject snapshots that would cause an unbelievable jump versus the
 * previous snapshot. Catches partial scrapes and upstream layout
 * changes that yield garbage data.
 */
export function snapshotSanityCheck(
  prev: RankingSnapshot | null,
  next: RankingSnapshot,
  maxDeltaPct = Number(process.env.SCRAPER_MAX_DELTA_PCT ?? 20),
): SanityCheckResult {
  if (!prev) return { ok: true, deltaPct: 0, reason: "no previous snapshot" };

  const prevTop = new Map(prev.entries.slice(0, 50).map((e) => [e.slug, e.rank]));
  const nextTop = next.entries.slice(0, 50);
  let movers = 0;
  for (const n of nextTop) {
    const prevRank = prevTop.get(n.slug);
    if (!prevRank) {
      movers++;
      continue;
    }
    if (Math.abs(prevRank - n.rank) >= 10) movers++;
  }
  const deltaPct = Math.round((movers / 50) * 100);
  if (deltaPct > maxDeltaPct) {
    return {
      ok: false,
      deltaPct,
      reason: `Top-50 movement ${deltaPct}% exceeds threshold ${maxDeltaPct}%`,
    };
  }
  return { ok: true, deltaPct };
}
