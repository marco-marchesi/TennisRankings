import { z } from "zod";

export const RankingEntry = z.object({
  rank: z.number().int().min(1).max(2500),
  slug: z.string().min(1),
  fullName: z.string().min(2).max(120),
  countryCode: z.string().length(3).nullable(),
  points: z.number().int().min(0).max(20000),
  tournamentsPlayed: z.number().int().min(0).max(40).nullable(),
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
