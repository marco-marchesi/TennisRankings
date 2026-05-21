"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import type { LeaderboardCategory, LeaderboardEntry } from "@/lib/leaderboards";
import { formatNumber } from "@/lib/utils";

interface ColumnDef {
  key: string;
  label: string;
  title: string;
  /** "percent" → suffix with %; "int" → no decimals; default 1 decimal. */
  format?: "percent" | "int";
  /** Direction the column should sort in when first clicked. Defaults to desc. */
  defaultDir?: SortDir;
}

type SortDir = "asc" | "desc";
// Sort keys outside the stats blob get hard-coded keys.
type SortKey = "rank" | "player" | "matches" | string;

const CATEGORY_COLUMNS: Record<LeaderboardCategory, ColumnDef[]> = {
  serve: [
    { key: "unreturnable_pct", label: "Unreturnable", title: "% of serves the opponent couldn't put back in play (combines aces + unreturned-in-play)", format: "percent" },
    { key: "first_serve_won_pct", label: "1st Win", title: "% of points won when the first serve is returned in play", format: "percent" },
    { key: "second_serve_won_pct", label: "2nd Win", title: "% of points won when the second serve is returned in play", format: "percent" },
    { key: "serve_impact", label: "Impact", title: "Mean serve impact score — TA's composite of unreturnable + RiP-win + placement quality" },
  ],
  return: [
    { key: "return_in_play_pct", label: "In Play", title: "% of returns put back in play", format: "percent" },
    { key: "first_return_won_pct", label: "vs 1st", title: "% of points won returning first serves that were put in play", format: "percent" },
    { key: "second_return_won_pct", label: "vs 2nd", title: "% of points won returning second serves that were put in play", format: "percent" },
    { key: "return_winners_pct", label: "Winners", title: "% of returns that go in for clean winners", format: "percent" },
  ],
  rally: [
    { key: "avg_rally_length", label: "Avg Length", title: "Average shots per rally (serve counts as shot 1)" },
    { key: "short_rally_won_pct", label: "Short (1–3) Win", title: "Win % on rallies of 1–3 shots — captures serve & first-strike effectiveness", format: "percent" },
    { key: "mid_rally_won_pct", label: "Mid (4–6) Win", title: "Win % on rallies of 4–6 shots", format: "percent" },
    { key: "long_rally_won_pct", label: "Long (7+) Win", title: "Win % on rallies of 7–9 shots — the grinder's edge", format: "percent" },
  ],
  winners_errors: [
    { key: "winners_total", label: "Winners", title: "Total winners hit across charted matches", format: "int" },
    { key: "ufes_total", label: "Unforced Errors", title: "Total unforced errors across charted matches", format: "int" },
    { key: "winner_ufe_ratio", label: "W/UFE Ratio", title: "Winners ÷ Unforced Errors. Higher is better; 1.0 = break-even." },
  ],
};

function fmt(val: number | null | undefined, def: ColumnDef): string {
  if (val == null) return "—";
  if (def.format === "percent") return `${val.toFixed(1)}%`;
  if (def.format === "int") return formatNumber(Math.round(val));
  return val.toFixed(1);
}

// Nulls always sort to the end, regardless of direction.
function nullableCompare<T extends number | string | null>(
  a: T,
  b: T,
  dir: SortDir,
): number {
  if (a === null && b === null) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  if (a < b) return dir === "asc" ? -1 : 1;
  if (a > b) return dir === "asc" ? 1 : -1;
  return 0;
}

interface Props {
  rows: LeaderboardEntry[];
  category: LeaderboardCategory;
}

export function LeaderboardTable({ rows, category }: Props) {
  const cols = CATEGORY_COLUMNS[category];
  const [sortKey, setSortKey] = useState<SortKey>("rank");
  const [sortDir, setSortDir] = useState<SortDir>("asc");

  function toggleSort(key: SortKey, defaultDir: SortDir = "desc") {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir(defaultDir);
    }
  }

  const sorted = useMemo(() => {
    const arr = [...rows];
    const cmp =
      sortKey === "rank"
        ? (a: LeaderboardEntry, b: LeaderboardEntry) => nullableCompare(a.rank, b.rank, sortDir)
        : sortKey === "player"
          ? (a: LeaderboardEntry, b: LeaderboardEntry) =>
              nullableCompare(a.playerName.toLowerCase(), b.playerName.toLowerCase(), sortDir)
          : sortKey === "matches"
            ? (a: LeaderboardEntry, b: LeaderboardEntry) => nullableCompare(a.matches, b.matches, sortDir)
            : // Stats key — read from the jsonb blob; nulls sort to end.
              (a: LeaderboardEntry, b: LeaderboardEntry) =>
                nullableCompare(a.stats[sortKey] ?? null, b.stats[sortKey] ?? null, sortDir);
    arr.sort(cmp);
    return arr;
  }, [rows, sortKey, sortDir]);

  if (rows.length === 0) {
    return (
      <div className="rounded-lg border bg-[color:var(--muted)]/30 p-8 text-center text-sm text-[color:var(--muted-foreground)]">
        No data yet. Run <code>pnpm scraper:leaderboards</code> to pull the latest figures from Tennis Abstract.
      </div>
    );
  }

  return (
    <div className="overflow-x-auto rounded-lg border">
      <table className="w-full text-sm">
        <thead className="bg-[color:var(--muted)]/60 text-left text-xs uppercase tracking-wide text-[color:var(--muted-foreground)]">
          <tr>
            <SortableTh
              label="#"
              colKey="rank"
              sortKey={sortKey}
              sortDir={sortDir}
              onToggle={(k) => toggleSort(k, "asc")}
              align="right"
              widthClass="w-12"
            />
            <SortableTh
              label="Player"
              colKey="player"
              sortKey={sortKey}
              sortDir={sortDir}
              onToggle={(k) => toggleSort(k, "asc")}
              align="left"
            />
            <SortableTh
              label="Matches"
              colKey="matches"
              sortKey={sortKey}
              sortDir={sortDir}
              onToggle={(k) => toggleSort(k, "desc")}
              align="right"
              widthClass="hidden w-16 sm:table-cell"
              title="Charted matches in the Last-52-week window"
            />
            {cols.map((c) => (
              <SortableTh
                key={c.key}
                label={c.label}
                colKey={c.key}
                sortKey={sortKey}
                sortDir={sortDir}
                onToggle={(k) => toggleSort(k, c.defaultDir ?? "desc")}
                align="right"
                widthClass="w-28"
                title={c.title}
              />
            ))}
          </tr>
        </thead>
        <tbody>
          {sorted.map((r) => (
            <tr key={`${r.rank}-${r.playerName}`} className="border-t hover:bg-[color:var(--muted)]/40">
              <td className="px-3 py-2 text-right num font-medium">{r.rank}</td>
              <td className="px-3 py-2">
                {r.playerSlug ? (
                  <Link href={`/players/${r.playerSlug}`} className="font-medium hover:underline">
                    {r.playerName}
                  </Link>
                ) : (
                  <span className="font-medium">{r.playerName}</span>
                )}
                {r.countryCode && (
                  <span className="ml-2 text-xs text-[color:var(--muted-foreground)]">
                    {r.countryCode}
                  </span>
                )}
              </td>
              <td className="hidden px-3 py-2 text-right num text-[color:var(--muted-foreground)] sm:table-cell">
                {r.matches ?? "—"}
              </td>
              {cols.map((c) => (
                <td key={c.key} className="px-3 py-2 text-right num">
                  {fmt(r.stats[c.key] ?? null, c)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

interface SortableThProps {
  label: string;
  colKey: SortKey;
  sortKey: SortKey;
  sortDir: SortDir;
  onToggle: (key: SortKey) => void;
  align?: "left" | "right";
  widthClass?: string;
  title?: string;
}

function SortableTh({ label, colKey, sortKey, sortDir, onToggle, align = "left", widthClass = "", title }: SortableThProps) {
  const isActive = sortKey === colKey;
  const arrow = isActive ? (sortDir === "asc" ? "▲" : "▼") : "";
  return (
    <th
      scope="col"
      className={`px-3 py-2 ${align === "right" ? "text-right" : "text-left"} ${widthClass}`}
      title={title}
      aria-sort={isActive ? (sortDir === "asc" ? "ascending" : "descending") : "none"}
    >
      <button
        type="button"
        onClick={() => onToggle(colKey)}
        className={`inline-flex items-center gap-1 ${align === "right" ? "ml-auto" : ""} hover:text-[color:var(--foreground)]`}
      >
        <span>{label}</span>
        {arrow && <span aria-hidden="true" className="text-[8px]">{arrow}</span>}
      </button>
    </th>
  );
}
