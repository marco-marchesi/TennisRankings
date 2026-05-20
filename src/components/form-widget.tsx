interface Match {
  result: "W" | "L";
  surface?: "hard" | "clay" | "grass" | null;
  opponent?: string;
}

interface Props {
  matches: Match[]; // most recent first
  size?: "sm" | "md";
}

const SURFACE_GLYPH: Record<string, string> = {
  hard: "■",
  clay: "▲",
  grass: "●",
};

// CB-safe: shape carries the surface, color carries the result, AND every
// dot has a verbal label. Never relies on color alone.
export function FormWidget({ matches, size = "md" }: Props) {
  const dim = size === "sm" ? "h-4 w-4 text-[10px]" : "h-6 w-6 text-xs";
  return (
    <ul className="flex gap-1" aria-label="Recent form (last matches, most recent first)">
      {matches.map((m, i) => {
        const win = m.result === "W";
        const glyph = (m.surface && SURFACE_GLYPH[m.surface]) ?? (win ? "+" : "−");
        const tone = win
          ? "bg-[color:var(--color-up)]/15 text-[color:var(--color-up)]"
          : "bg-[color:var(--color-down)]/15 text-[color:var(--color-down)]";
        return (
          <li
            key={i}
            className={`${dim} ${tone} inline-flex items-center justify-center rounded-sm border border-current/30`}
            title={`${win ? "Won" : "Lost"}${m.opponent ? ` vs ${m.opponent}` : ""}${m.surface ? ` on ${m.surface}` : ""}`}
          >
            <span aria-hidden>{glyph}</span>
            <span className="sr-only">
              {win ? "Win" : "Loss"}
              {m.opponent ? ` against ${m.opponent}` : ""}
              {m.surface ? ` on ${m.surface}` : ""}
            </span>
          </li>
        );
      })}
    </ul>
  );
}
