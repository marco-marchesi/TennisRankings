// Fetches & persists all eight Tennis Abstract MCP leaderboards (four
// categories × two tours, "Last 52" window). Idempotent: each (tour,
// category) is wiped before re-write so re-runs land cleanly. Best-effort
// matches TA's player names back to our `players.slug` for profile linking.

import { db, schema } from "@/db";
import { and, eq, ilike, inArray } from "drizzle-orm";
import { fetchLeaderboard, type Category, type LeaderboardRow, type Tour } from "./sources/ta-leaderboards";

const CATEGORIES: Category[] = ["serve", "return", "rally", "winners_errors"];

interface Summary {
  tour: Tour;
  category: Category;
  rowsWritten: number;
  unmatchedSlugs: string[];
}

export async function runLeaderboardScrape(opts?: { tour?: Tour; category?: Category }): Promise<Summary[]> {
  const tours: Tour[] = opts?.tour ? [opts.tour] : ["atp", "wta"];
  const cats: Category[] = opts?.category ? [opts.category] : CATEGORIES;
  const summaries: Summary[] = [];
  for (const t of tours) {
    for (const c of cats) {
      try {
        const rows = await fetchLeaderboard(t, c);
        const summary = await persist(t, c, rows);
        summaries.push(summary);
        console.log(
          `[leaderboards] ${t}/${c}: ${rows.length} rows, ${summary.unmatchedSlugs.length} unmatched`,
        );
      } catch (err) {
        console.error(`[leaderboards] ${t}/${c} FAILED:`, err instanceof Error ? err.message : err);
        summaries.push({ tour: t, category: c, rowsWritten: 0, unmatchedSlugs: [] });
      }
    }
  }
  return summaries;
}

async function persist(tour: Tour, category: Category, rows: LeaderboardRow[]): Promise<Summary> {
  const summary: Summary = { tour, category, rowsWritten: 0, unmatchedSlugs: [] };

  // Best-effort match of TA player names to our `players.slug`. We do one
  // bulk query to keep this O(1) per category.
  const taPlayerIds = rows.map((r) => r.taPlayerId).filter((id): id is string => !!id);
  const slugByTaId = new Map<string, string>();
  if (taPlayerIds.length > 0) {
    // TA's id is camel-cased "AlexDeMinaur"; our slug is "alex-de-minaur".
    // Compute a normalized form for both sides and join.
    const normalizedTaIds = taPlayerIds.map(taIdToNormalized);
    const dbPlayers = await db
      .select({ slug: schema.players.slug, fullName: schema.players.fullName })
      .from(schema.players);
    const normalizedToSlug = new Map<string, string>();
    for (const p of dbPlayers) {
      normalizedToSlug.set(slugToNormalized(p.slug), p.slug);
    }
    for (let i = 0; i < taPlayerIds.length; i++) {
      const norm = normalizedTaIds[i]!;
      const slug = normalizedToSlug.get(norm);
      if (slug) slugByTaId.set(taPlayerIds[i]!, slug);
    }
  }

  // Atomic-ish replace: wipe this (tour, category, window) and rewrite.
  await db
    .delete(schema.leaderboards)
    .where(
      and(
        eq(schema.leaderboards.tour, tour),
        eq(schema.leaderboards.category, category),
        eq(schema.leaderboards.windowKey, "last_52"),
      ),
    );

  for (const r of rows) {
    const slug = r.taPlayerId ? slugByTaId.get(r.taPlayerId) ?? null : null;
    if (!slug) summary.unmatchedSlugs.push(r.playerName);
    await db.insert(schema.leaderboards).values({
      tour: r.tour,
      category: r.category,
      windowKey: "last_52",
      rank: r.rank,
      playerName: r.playerName,
      playerSlug: slug,
      taPlayerId: r.taPlayerId,
      countryCode: r.countryCode,
      matches: r.matches,
      stats: r.stats,
      scrapedAt: new Date(),
    });
    summary.rowsWritten++;
  }

  return summary;
}

function taIdToNormalized(taId: string): string {
  // Two URL forms in the wild:
  //   "AlexDeMinaur"            (old camelcase style, used in serve/return/rally)
  //   "207411/Jesper-De-Jong"   (newer numeric-prefix style, used in winners_errors)
  // Strip the numeric prefix and any non-alphanumerics, lower-case the rest.
  const stripped = taId.replace(/^\d+\//, "");
  return stripped.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function slugToNormalized(slug: string): string {
  // "alex-de-minaur" -> "alexdeminaur"
  return slug.toLowerCase().replace(/[^a-z0-9]/g, "");
}

async function main() {
  const args = process.argv.slice(2);
  const tourArg = args.find((a) => a === "atp" || a === "wta") as Tour | undefined;
  const catArg = args.find((a) => CATEGORIES.includes(a as Category)) as Category | undefined;
  await runLeaderboardScrape({ tour: tourArg, category: catArg });
}

const entryFile = process.argv[1] ?? "";
if (entryFile.endsWith("leaderboards.ts") || entryFile.endsWith("leaderboards.js")) {
  main()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
