import { formatDate } from "@/lib/utils";

export interface RecentMatch {
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

interface Props {
  matches: RecentMatch[];
  /** When more than this many are passed, only the first N badges render. */
  limit?: number;
}

// Maps TA tournament-level codes to short user-facing labels.
const LEVEL_LABEL: Record<string, string> = {
  G: "Grand Slam",
  M: "Masters 1000",
  A: "Tour",
  C: "Challenger",
  F: "Year-end Finals",
  D: "Davis Cup",
};

const SURFACE_DOT: Record<string, string> = {
  Hard: "bg-sky-400",
  Clay: "bg-orange-400",
  Grass: "bg-green-500",
  Carpet: "bg-purple-400",
};

export function RecentResults({ matches, limit = 10 }: Props) {
  if (matches.length === 0) {
    return (
      <div className="rounded-lg border bg-[color:var(--muted)]/30 p-6 text-center text-sm text-[color:var(--muted-foreground)]">
        No recent matches recorded yet. Run <code>pnpm scraper:backfill-matches</code> to pull history from Tennis Abstract.
      </div>
    );
  }

  const display = matches.slice(0, limit);
  const wins = display.filter((m) => m.won).length;
  const losses = display.length - wins;

  return (
    <div className="rounded-lg border p-4">
      <div className="mb-3 flex items-center justify-between text-xs text-[color:var(--muted-foreground)]">
        <span>Last {display.length} matches</span>
        <span>
          <strong className="text-[color:var(--color-up)]">{wins}W</strong>
          <span className="mx-1">–</span>
          <strong className="text-[color:var(--color-down)]">{losses}L</strong>
        </span>
      </div>
      <ol className="flex flex-wrap gap-1.5">
        {display.map((m, i) => (
          <li key={`${m.playedOn}-${i}`}>
            <ResultBadge match={m} />
          </li>
        ))}
      </ol>
      <details className="mt-4 text-xs text-[color:var(--muted-foreground)]">
        <summary className="cursor-pointer select-none">Show details</summary>
        <ul className="mt-2 divide-y divide-[color:var(--border)]">
          {display.map((m, i) => (
            <li key={`row-${m.playedOn}-${i}`} className="flex items-baseline gap-3 py-1.5">
              <span
                className={
                  "inline-block w-5 text-center font-semibold " +
                  (m.won ? "text-[color:var(--color-up)]" : "text-[color:var(--color-down)]")
                }
              >
                {m.won ? "W" : "L"}
              </span>
              <span className="num w-20 text-[color:var(--muted-foreground)]">{formatDate(m.playedOn)}</span>
              <span className="flex-1 truncate">
                {m.tournamentName}
                {m.surface && (
                  <span className="ml-1 inline-block align-middle">
                    <span
                      aria-label={m.surface}
                      title={m.surface}
                      className={
                        "inline-block h-2 w-2 rounded-full align-middle " +
                        (SURFACE_DOT[m.surface] ?? "bg-gray-400")
                      }
                    />
                  </span>
                )}
                <span className="ml-2 text-[color:var(--muted-foreground)]">{m.round}</span>
              </span>
              <span className="truncate">
                {m.won ? "def. " : "lost to "}
                <span className="font-medium text-[color:var(--foreground)]">{m.opponentName}</span>
                {m.opponentCountry && <span className="ml-1">({m.opponentCountry})</span>}
              </span>
              {m.score && <span className="num text-[color:var(--muted-foreground)]">{m.score}</span>}
            </li>
          ))}
        </ul>
      </details>
    </div>
  );
}

function ResultBadge({ match: m }: { match: RecentMatch }) {
  const cls = m.won
    ? "bg-[color:var(--color-up)]/15 text-[color:var(--color-up)] border-[color:var(--color-up)]/40"
    : "bg-[color:var(--color-down)]/15 text-[color:var(--color-down)] border-[color:var(--color-down)]/40";
  const titleParts = [
    formatDate(m.playedOn),
    m.tournamentName + (m.tournamentLevel ? ` (${LEVEL_LABEL[m.tournamentLevel] ?? m.tournamentLevel})` : ""),
    `${m.round} · ${m.surface ?? "—"}`,
    `${m.won ? "def. " : "lost to "}${m.opponentName}${m.opponentCountry ? ` (${m.opponentCountry})` : ""}`,
    m.score ?? "",
  ];
  return (
    <span
      title={titleParts.filter(Boolean).join("\n")}
      className={
        "inline-flex h-7 w-7 items-center justify-center rounded-full border text-xs font-semibold " +
        cls
      }
      aria-label={`${m.won ? "Won" : "Lost"} vs ${m.opponentName} at ${m.tournamentName}, ${formatDate(m.playedOn)}`}
    >
      {m.won ? "W" : "L"}
    </span>
  );
}
