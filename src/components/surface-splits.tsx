import type { SurfaceSplit } from "@/lib/players";
import { formatNumber } from "@/lib/utils";

interface Props {
  splits: SurfaceSplit[];
  /** Optional caption telling the reader what slice of matches this covers. */
  coverageNote?: string;
}

const SURFACE_DOT: Record<SurfaceSplit["surface"], string> = {
  Hard: "bg-sky-400",
  Clay: "bg-orange-400",
  Grass: "bg-green-500",
  Carpet: "bg-purple-400",
};

function pct(num: number, den: number): string {
  if (den === 0) return "—";
  return `${((num / den) * 100).toFixed(1)}%`;
}

export function SurfaceSplits({ splits, coverageNote }: Props) {
  if (splits.length === 0) {
    return (
      <div className="rounded-lg border bg-[color:var(--muted)]/30 p-6 text-center text-sm text-[color:var(--muted-foreground)]">
        No match data yet for surface analysis.
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {coverageNote && (
        <p className="text-xs text-[color:var(--muted-foreground)]">{coverageNote}</p>
      )}
      <div className="overflow-x-auto rounded-lg border">
        <table className="w-full text-sm">
          <thead className="bg-[color:var(--muted)]/60 text-left text-xs uppercase tracking-wide text-[color:var(--muted-foreground)]">
            <tr>
              <th scope="col" className="px-3 py-2">Surface</th>
              <th scope="col" className="px-3 py-2 text-right num">M</th>
              <th scope="col" className="px-3 py-2 text-right num">W-L</th>
              <th scope="col" className="px-3 py-2 text-right num">Win%</th>
              <th scope="col" className="hidden px-3 py-2 text-right num sm:table-cell">Sets W-L</th>
              <th scope="col" className="hidden px-3 py-2 text-right num sm:table-cell">Set%</th>
              <th scope="col" className="hidden px-3 py-2 text-right num md:table-cell">Games W-L</th>
              <th scope="col" className="px-3 py-2 text-right num">Game%</th>
            </tr>
          </thead>
          <tbody>
            {splits.map((s) => {
              const totalSets = s.setsWon + s.setsLost;
              const totalGames = s.gamesWon + s.gamesLost;
              return (
                <tr key={s.surface} className="border-t hover:bg-[color:var(--muted)]/40">
                  <td className="px-3 py-2">
                    <span className="inline-flex items-center gap-2">
                      <span
                        aria-hidden
                        className={`inline-block h-2.5 w-2.5 rounded-full ${SURFACE_DOT[s.surface]}`}
                      />
                      {s.surface}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-right num">{s.matches}</td>
                  <td className="px-3 py-2 text-right num">
                    {s.wins}-{s.losses}
                  </td>
                  <td className="px-3 py-2 text-right num font-medium">{pct(s.wins, s.matches)}</td>
                  <td className="hidden px-3 py-2 text-right num sm:table-cell">
                    {s.setsWon}-{s.setsLost}
                  </td>
                  <td className="hidden px-3 py-2 text-right num sm:table-cell">
                    {pct(s.setsWon, totalSets)}
                  </td>
                  <td className="hidden px-3 py-2 text-right num md:table-cell">
                    {formatNumber(s.gamesWon)}-{formatNumber(s.gamesLost)}
                  </td>
                  <td className="px-3 py-2 text-right num">{pct(s.gamesWon, totalGames)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
