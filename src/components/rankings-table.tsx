"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import type { RankingRow } from "@/lib/rankings";
import { RankDelta } from "./rank-delta";
import { formatNumber, ageFromDob } from "@/lib/utils";

interface Props {
  rows: RankingRow[];
  caption?: string;
  /**
   * When true, the table is rendered for the Race-to-Finals page: the
   * career-high column and the live-projection columns (+/-, Max) are
   * hidden. The Played column stays and shows YTD tournaments.
   */
  isRace?: boolean;
}

type SortKey = "rank" | "ch" | "age" | "country" | "delta";
type SortDir = "asc" | "desc";

function ageMatcher(expr: string): (age: number | null) => boolean {
  const trimmed = expr.trim();
  if (!trimmed) return () => true;
  const range = trimmed.match(/^(\d+)\s*-\s*(\d+)$/);
  if (range) {
    const lo = Number(range[1]);
    const hi = Number(range[2]);
    return (age) => age != null && age >= lo && age <= hi;
  }
  const lt = trimmed.match(/^<\s*=?\s*(\d+)$/);
  if (lt) {
    const n = Number(lt[1]);
    const inclusive = trimmed.includes("=");
    return (age) => age != null && (inclusive ? age <= n : age < n);
  }
  const gt = trimmed.match(/^>\s*=?\s*(\d+)$/);
  if (gt) {
    const n = Number(gt[1]);
    const inclusive = trimmed.includes("=");
    return (age) => age != null && (inclusive ? age >= n : age > n);
  }
  const exact = trimmed.match(/^(\d+)$/);
  if (exact) {
    const n = Number(exact[1]);
    return (age) => age === n;
  }
  return () => true;
}

function nullable<T extends number | string | null>(
  pick: (r: RankingRow) => T,
  dir: SortDir,
): (a: RankingRow, b: RankingRow) => number {
  return (a, b) => {
    const av = pick(a);
    const bv = pick(b);
    if (av === null && bv === null) return 0;
    if (av === null) return 1;
    if (bv === null) return -1;
    if (av < bv) return dir === "asc" ? -1 : 1;
    if (av > bv) return dir === "asc" ? 1 : -1;
    return 0;
  };
}

export function RankingsTable({ rows, caption, isRace = false }: Props) {
  const [sortKey, setSortKey] = useState<SortKey>("rank");
  const [sortDir, setSortDir] = useState<SortDir>("asc");
  const [ageFilter, setAgeFilter] = useState("");
  const [countryFilter, setCountryFilter] = useState("");

  function toggleSort(key: SortKey) {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir(key === "delta" ? "desc" : "asc");
    }
  }

  const filteredSorted = useMemo(() => {
    const ageMatch = ageMatcher(ageFilter);
    const ccFilter = countryFilter.trim().toUpperCase();

    const filtered = rows.filter((r) => {
      const age = ageFromDob(r.player.dateOfBirth);
      if (!ageMatch(age)) return false;
      if (ccFilter) {
        const cc = r.player.countryCode ?? "";
        if (!cc.startsWith(ccFilter)) return false;
      }
      return true;
    });

    const cmp: (a: RankingRow, b: RankingRow) => number =
      sortKey === "rank"
        ? // Race uses the official race rank from the snapshot; the main
          // ranking view uses the projected next-Monday rank.
          nullable((r) => (isRace ? r.rank : r.projectedRank), sortDir)
        : sortKey === "ch"
          ? nullable((r) => r.careerHighRank, sortDir)
          : sortKey === "age"
            ? nullable((r) => ageFromDob(r.player.dateOfBirth), sortDir)
            : sortKey === "country"
              ? nullable((r) => r.player.countryCode, sortDir)
              : nullable((r) => r.projection?.pointsDelta ?? null, sortDir);

    return [...filtered].sort(cmp);
  }, [rows, ageFilter, countryFilter, sortKey, sortDir]);

  const showCareerHigh = !isRace;
  const anyProjection = !isRace && filteredSorted.some((r) => r.projection !== null);

  return (
    <div className="space-y-2">
      <p className="text-xs text-[color:var(--muted-foreground)]">
        Click any column header to sort. Showing {filteredSorted.length} of {rows.length} players.
        {!isRace && " Pts column is the projected total at next Monday's publish."}
      </p>
      <div className="overflow-x-auto rounded-lg border">
        <table className="w-full text-sm">
          {caption && <caption className="sr-only">{caption}</caption>}
          <thead className="bg-[color:var(--muted)]/60 text-left text-xs uppercase tracking-wide text-[color:var(--muted-foreground)]">
            <tr>
              <SortableTh label="#" colKey="rank" sortKey={sortKey} sortDir={sortDir} onToggle={toggleSort} align="right" widthClass="w-12" title={isRace ? "Race rank" : "Projected rank for next Monday"} />
              <th scope="col" className="px-2 py-2 w-14" aria-label="Rank change since current ATP publish" />
              {showCareerHigh && (
                <SortableTh label="CH" colKey="ch" sortKey={sortKey} sortDir={sortDir} onToggle={toggleSort} align="right" widthClass="hidden w-16 md:table-cell" title="Career High" />
              )}
              <th scope="col" className="px-3 py-2">Player</th>
              <SortableTh
                label="Age"
                colKey="age"
                sortKey={sortKey}
                sortDir={sortDir}
                onToggle={toggleSort}
                align="right"
                widthClass="hidden w-20 sm:table-cell"
                filter={
                  <input
                    value={ageFilter}
                    onChange={(e) => setAgeFilter(e.target.value)}
                    placeholder="<25"
                    aria-label="Filter by age"
                    className="mt-1 w-full rounded border bg-transparent px-1 py-0.5 text-[10px] font-normal normal-case tracking-normal"
                  />
                }
              />
              <SortableTh
                label="Ctry"
                colKey="country"
                sortKey={sortKey}
                sortDir={sortDir}
                onToggle={toggleSort}
                align="right"
                widthClass="hidden w-24 md:table-cell"
                filter={
                  <input
                    value={countryFilter}
                    onChange={(e) => setCountryFilter(e.target.value)}
                    placeholder="ITA"
                    maxLength={3}
                    aria-label="Filter by country code"
                    className="mt-1 w-full rounded border bg-transparent px-1 py-0.5 text-[10px] font-normal normal-case tracking-normal uppercase"
                  />
                }
              />
              <th scope="col" className="px-3 py-2 text-right num w-24" title={isRace ? "Race points" : "Projected next-Monday points total"}>Pts</th>
              {anyProjection && (
                <>
                  <SortableTh
                    label="+/-"
                    colKey="delta"
                    sortKey={sortKey}
                    sortDir={sortDir}
                    onToggle={toggleSort}
                    align="right"
                    widthClass="w-20"
                    title="Live points delta this week"
                  />
                  <th scope="col" className="hidden px-3 py-2 text-right num w-24 lg:table-cell" title="Max possible points if player wins out their current tournament">Max</th>
                </>
              )}
              <th scope="col" className="hidden px-3 py-2 text-right num w-16 md:table-cell">Played</th>
            </tr>
          </thead>
          <tbody>
            {filteredSorted.map((r) => {
              const age = ageFromDob(r.player.dateOfBirth);
              const proj = r.projection;
              const displayRank = isRace ? r.rank : r.projectedRank;
              const displayPoints = isRace ? r.points : r.projectedPoints;
              return (
                <tr key={r.player.id} className="border-t hover:bg-[color:var(--muted)]/40">
                  <td className="px-3 py-2 text-right num font-medium">{displayRank}</td>
                  <td className="px-2 py-2">
                    {/* Live rank-change indicator: official → projected. On the
                        race view we still show week-over-week movement since
                        there's no separate "projection" concept. */}
                    {isRace ? (
                      <RankDelta prevRank={r.prevRank ?? null} currentRank={r.rank} />
                    ) : (
                      <RankDelta prevRank={r.rank} currentRank={r.projectedRank} />
                    )}
                  </td>
                  {showCareerHigh && (
                    <td className="hidden px-3 py-2 text-right num text-[color:var(--muted-foreground)] md:table-cell">
                      {r.careerHighRank ?? "—"}
                    </td>
                  )}
                  <td className="px-3 py-2">
                    <Link href={`/players/${r.player.slug}`} className="font-medium hover:underline">
                      {r.player.fullName}
                    </Link>
                  </td>
                  <td className="hidden px-3 py-2 text-right num text-[color:var(--muted-foreground)] sm:table-cell">
                    {age ?? "—"}
                  </td>
                  <td className="hidden px-3 py-2 text-right num text-[color:var(--muted-foreground)] md:table-cell">
                    {r.player.countryCode ?? "—"}
                  </td>
                  <td className="px-3 py-2 text-right num">{formatNumber(displayPoints)}</td>
                  {anyProjection && (
                    <>
                      <td className="px-3 py-2 text-right num">
                        {proj == null ? (
                          <span className="text-[color:var(--muted-foreground)]">—</span>
                        ) : proj.pointsDelta === 0 ? (
                          <span className="text-[color:var(--muted-foreground)]">0</span>
                        ) : proj.pointsDelta > 0 ? (
                          <span className="text-[color:var(--color-up)]">+{proj.pointsDelta}</span>
                        ) : (
                          <span className="text-[color:var(--color-down)]">{proj.pointsDelta}</span>
                        )}
                      </td>
                      <td className="hidden px-3 py-2 text-right num lg:table-cell">
                        {proj?.maxPossiblePoints == null ? (
                          <span className="text-[color:var(--muted-foreground)]">—</span>
                        ) : (
                          formatNumber(proj.maxPossiblePoints)
                        )}
                      </td>
                    </>
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
  filter?: React.ReactNode;
}

function SortableTh({ label, colKey, sortKey, sortDir, onToggle, align = "left", widthClass = "", title, filter }: SortableThProps) {
  const isActive = sortKey === colKey;
  const arrow = isActive ? (sortDir === "asc" ? "▲" : "▼") : "";
  return (
    <th
      scope="col"
      className={`px-3 py-2 align-top ${align === "right" ? "text-right" : "text-left"} ${widthClass}`}
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
      {filter}
    </th>
  );
}
