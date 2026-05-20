import Link from "next/link";
import type { ProjectionRow } from "@/lib/projection";
import { formatNumber } from "@/lib/utils";

interface Props { rows: ProjectionRow[] }

export function ProjectionTable({ rows }: Props) {
  if (rows.length === 0) {
    return (
      <div className="mt-4 rounded-lg border bg-[color:var(--muted)]/30 p-8 text-center text-sm text-[color:var(--muted-foreground)]">
        Projection backfills once the scraper imports the per-player points
        breakdown. Until then, see the headline rankings on{" "}
        <Link href="/rankings/atp" className="underline">/rankings/atp</Link>.
      </div>
    );
  }

  return (
    <div className="mt-4 overflow-hidden rounded-lg border">
      <table className="w-full text-sm">
        <thead className="bg-[color:var(--muted)]/60 text-left text-xs uppercase tracking-wide text-[color:var(--muted-foreground)]">
          <tr>
            <th scope="col" className="px-3 py-2 text-right num">Now</th>
            <th scope="col" className="px-3 py-2 text-right num">→</th>
            <th scope="col" className="px-3 py-2">Player</th>
            <th scope="col" className="px-3 py-2 text-right num">Current pts</th>
            <th scope="col" className="px-3 py-2 text-right num">Expiring</th>
            <th scope="col" className="px-3 py-2 text-right num">Projected</th>
            <th scope="col" className="px-3 py-2 text-right num">Δ</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const delta = r.rank - r.projectedRank;
            const color =
              delta > 0
                ? "text-[color:var(--color-up)]"
                : delta < 0
                ? "text-[color:var(--color-down)]"
                : "text-[color:var(--muted-foreground)]";
            return (
              <tr key={r.player.slug} className="border-t hover:bg-[color:var(--muted)]/40">
                <td className="px-3 py-2 text-right num">{r.rank}</td>
                <td className={`px-3 py-2 text-right num font-medium ${color}`}>{r.projectedRank}</td>
                <td className="px-3 py-2">
                  <Link href={`/players/${r.player.slug}`} className="font-medium hover:underline">
                    {r.player.fullName}
                  </Link>{" "}
                  <span className="text-xs text-[color:var(--muted-foreground)]">{r.player.countryCode}</span>
                </td>
                <td className="px-3 py-2 text-right num">{formatNumber(r.currentPoints)}</td>
                <td className="px-3 py-2 text-right num text-[color:var(--color-down)]">
                  {r.pointsExpiringIn4Weeks > 0 ? `−${formatNumber(r.pointsExpiringIn4Weeks)}` : "—"}
                </td>
                <td className="px-3 py-2 text-right num">{formatNumber(r.projectedPoints)}</td>
                <td className={`px-3 py-2 text-right num ${color}`}>
                  {delta === 0 ? "–" : delta > 0 ? `▲ ${delta}` : `▼ ${Math.abs(delta)}`}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
