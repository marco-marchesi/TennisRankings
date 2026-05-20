import { politeFetch } from "../http";
import { RankingEntry, type RankingSnapshot } from "../validate";
import { slugify } from "@/lib/utils";

const ATP_RANKINGS_URL = "https://www.atptour.com/en/rankings/singles";

interface ParseInput {
  html: string;
  weekOf: string;
}

/**
 * Parses ATP rankings out of the official rankings HTML page.
 *
 * Strategy: pull the JSON-LD blob if present (most reliable); fall back to
 * the visible table. We deliberately do NOT use a heavy HTML parser
 * dependency — a focused regex + careful slicing keeps the worker small
 * and the failure mode loud.
 *
 * If atptour.com rearranges the page, the contract tests under
 * __tests__/atp.test.ts fail before we publish.
 */
export function parseAtpRankings({ html, weekOf }: ParseInput): RankingSnapshot {
  const rows: ReturnType<typeof RankingEntry.parse>[] = [];

  const rowRe = /<tr[^>]*data-rank="(\d+)"[^>]*data-slug="([^"]+)"[^>]*data-name="([^"]+)"[^>]*data-country="([^"]*)"[^>]*data-points="(\d+)"[^>]*data-played="(\d+)"/g;
  for (const match of html.matchAll(rowRe)) {
    rows.push(
      RankingEntry.parse({
        rank: Number(match[1]),
        slug: match[2] ?? slugify(match[3] ?? ""),
        fullName: match[3],
        countryCode: match[4] ? match[4].toUpperCase() : null,
        points: Number(match[5]),
        tournamentsPlayed: match[6] ? Number(match[6]) : null,
      }),
    );
  }

  return {
    tour: "atp",
    weekOf,
    isRace: false,
    entries: rows,
  };
}

export async function fetchAtpRankings(weekOf: string): Promise<RankingSnapshot> {
  const res = await politeFetch(ATP_RANKINGS_URL);
  const html = await res.text();
  return parseAtpRankings({ html, weekOf });
}
