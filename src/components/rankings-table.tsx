import Link from "next/link";
import type { RankingRow } from "@/lib/rankings";
import { RankDelta } from "./rank-delta";
import { formatNumber } from "@/lib/utils";

interface Props {
  rows: RankingRow[];
  showPointsDelta?: boolean;
  caption?: string;
}

export function RankingsTable({ rows, showPointsDelta = true, caption }: Props) {
  return (
    <div className="overflow-hidden rounded-lg border">
      <table className="w-full text-sm">
        {caption && <caption className="sr-only">{caption}</caption>}
        <thead className="bg-[color:var(--muted)]/60 text-left text-xs uppercase tracking-wide text-[color:var(--muted-foreground)]">
          <tr>
            <th scope="col" className="px-3 py-2 text-right num w-12">#</th>
            <th scope="col" className="px-2 py-2 w-12" aria-label="Delta" />
            <th scope="col" className="px-3 py-2">Player</th>
            <th scope="col" className="px-3 py-2 text-right num w-24">Points</th>
            {showPointsDelta && (
              <th scope="col" className="px-3 py-2 text-right num w-20">Δ pts</th>
            )}
            <th scope="col" className="hidden px-3 py-2 text-right num w-16 md:table-cell">Played</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const ptsDelta =
              r.prevPoints != null ? r.points - r.prevPoints : null;
            return (
              <tr
                key={r.player.id}
                className="border-t hover:bg-[color:var(--muted)]/40"
              >
                <td className="px-3 py-2 text-right num font-medium">{r.rank}</td>
                <td className="px-2 py-2">
                  <RankDelta prevRank={r.prevRank ?? null} currentRank={r.rank} />
                </td>
                <td className="px-3 py-2">
                  <Link
                    href={`/players/${r.player.slug}`}
                    className="font-medium hover:underline"
                  >
                    {r.player.fullName}
                  </Link>
                  {r.player.countryCode && (
                    <span className="ml-2 text-xs text-[color:var(--muted-foreground)]">
                      {r.player.countryCode}
                    </span>
                  )}
                </td>
                <td className="px-3 py-2 text-right num">
                  {formatNumber(r.points)}
                </td>
                {showPointsDelta && (
                  <td className="px-3 py-2 text-right num">
                    {ptsDelta == null ? (
                      <span className="text-[color:var(--muted-foreground)]">—</span>
                    ) : ptsDelta === 0 ? (
                      <span className="text-[color:var(--muted-foreground)]">0</span>
                    ) : ptsDelta > 0 ? (
                      <span className="text-[color:var(--color-up)]">+{ptsDelta}</span>
                    ) : (
                      <span className="text-[color:var(--color-down)]">{ptsDelta}</span>
                    )}
                  </td>
                )}
                <td className="hidden px-3 py-2 text-right num text-[color:var(--muted-foreground)] md:table-cell">
                  {r.tournamentsPlayed ?? "—"}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
