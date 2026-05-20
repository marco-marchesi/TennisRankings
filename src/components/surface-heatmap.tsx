interface Cell {
  surface: "hard" | "clay" | "grass";
  wins: number;
  losses: number;
}

interface Props { cells: Cell[]; playerName: string }

/**
 * Win-% heatmap by surface. Three boxes, sized by sample count, coloured by
 * win-rate, with a tooltip on hover. Numbers shown directly — colour is a
 * secondary cue (CB-safe).
 */
export function SurfaceHeatmap({ cells, playerName }: Props) {
  const max = Math.max(1, ...cells.map((c) => c.wins + c.losses));
  return (
    <figure>
      <figcaption className="sr-only">{playerName} — win-loss by surface</figcaption>
      <ul className="grid grid-cols-3 gap-3">
        {cells.map((c) => {
          const played = c.wins + c.losses;
          const pct = played > 0 ? Math.round((c.wins / played) * 100) : 0;
          const sizePct = Math.max(50, Math.round((played / max) * 100));
          const hue = Math.round(120 * (pct / 100)); // 0 red → 120 green
          return (
            <li
              key={c.surface}
              className="rounded-lg border p-4 text-center"
              style={{
                background: `color-mix(in oklch, hsl(${hue} 70% 45%), transparent ${100 - sizePct}%)`,
              }}
              aria-label={`${c.surface}: ${c.wins} wins, ${c.losses} losses, ${pct}% win rate`}
            >
              <div className="text-xs uppercase tracking-wide opacity-80">{c.surface}</div>
              <div className="mt-1 font-serif text-3xl num">{pct}%</div>
              <div className="text-xs opacity-80 num">
                {c.wins} – {c.losses}
              </div>
            </li>
          );
        })}
      </ul>
    </figure>
  );
}
