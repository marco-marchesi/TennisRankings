import { rankDelta } from "@/lib/utils";

interface Props {
  prevRank: number | null | undefined;
  currentRank: number;
  className?: string;
}

// Accessibility: we never rely on colour alone — every delta carries a
// symbol (▲ ▼ –) AND a screen-reader-only verbal description.
export function RankDelta({ prevRank, currentRank, className }: Props) {
  const { dir, delta } = rankDelta(prevRank ?? null, currentRank);

  if (dir === "hold") {
    return (
      <span className={className} aria-label="no change">
        <span aria-hidden>–</span>
      </span>
    );
  }

  const color = dir === "up" ? "text-[color:var(--color-up)]" : "text-[color:var(--color-down)]";
  const symbol = dir === "up" ? "▲" : "▼";
  const verbal = dir === "up" ? "up" : "down";

  return (
    <span className={`${color} ${className ?? ""}`}>
      <span aria-hidden>{symbol}</span>
      <span aria-hidden className="ml-0.5 num">{delta}</span>
      <span className="sr-only">
        {verbal} {delta} {delta === 1 ? "place" : "places"}
      </span>
    </span>
  );
}
