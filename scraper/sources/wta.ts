import { politeFetch } from "../http";
import { RankingEntry, type RankingSnapshot } from "../validate";

const WTA_RANKINGS_URL = "https://www.wtatennis.com/rankings/singles";

interface ParseInput { html: string; weekOf: string }

export function parseWtaRankings({ html, weekOf }: ParseInput): RankingSnapshot {
  const rows: ReturnType<typeof RankingEntry.parse>[] = [];
  const rowRe = /<tr[^>]*data-rank="(\d+)"[^>]*data-slug="([^"]+)"[^>]*data-name="([^"]+)"[^>]*data-country="([^"]*)"[^>]*data-points="(\d+)"[^>]*data-played="(\d+)"/g;
  for (const m of html.matchAll(rowRe)) {
    rows.push(
      RankingEntry.parse({
        rank: Number(m[1]),
        slug: m[2],
        fullName: m[3],
        countryCode: m[4] ? m[4].toUpperCase() : null,
        points: Number(m[5]),
        tournamentsPlayed: m[6] ? Number(m[6]) : null,
      }),
    );
  }
  return { tour: "wta", weekOf, isRace: false, entries: rows };
}

export async function fetchWtaRankings(weekOf: string): Promise<RankingSnapshot> {
  const res = await politeFetch(WTA_RANKINGS_URL);
  const html = await res.text();
  return parseWtaRankings({ html, weekOf });
}
