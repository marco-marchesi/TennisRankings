"use client";

import { useMemo, useState } from "react";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
  Brush,
  Legend,
} from "recharts";

interface Row {
  weekOf: string | Date;
  rank: number;
  points: number;
}

interface Props {
  data: Row[];
}

type Metric = "rank" | "points";

const COLORS: Record<Metric, string> = {
  rank: "var(--color-up)",
  points: "#6366f1", // indigo — distinct enough from green when both lines are visible
};

const LABELS: Record<Metric, string> = {
  rank: "Rank",
  points: "Points",
};

export function RankingHistoryChart({ data }: Props) {
  // Both metrics default ON — the user spec is "if both tapped show both",
  // and both-on is the most informative default.
  const [showRank, setShowRank] = useState(true);
  const [showPoints, setShowPoints] = useState(true);

  // Brush sets [startIndex, endIndex]. Null = view full range.
  const [zoom, setZoom] = useState<{ start: number; end: number } | null>(null);

  const cleaned = useMemo(
    () =>
      [...data]
        .map((r) => ({
          weekOf: typeof r.weekOf === "string" ? r.weekOf : r.weekOf.toISOString().slice(0, 10),
          rank: r.rank,
          points: r.points,
        }))
        .sort((a, b) => a.weekOf.localeCompare(b.weekOf)),
    [data],
  );

  if (cleaned.length === 0) {
    return (
      <div className="rounded-lg border bg-[color:var(--muted)]/30 p-8 text-center text-sm text-[color:var(--muted-foreground)]">
        No ranking history available yet. Data backfills as the scraper runs
        weekly snapshots.
      </div>
    );
  }

  // Both off → coerce one back on. Keeps the chart from going blank.
  const anyOn = showRank || showPoints;
  const effectiveRank = anyOn ? showRank : true;
  const effectivePoints = anyOn ? showPoints : false;

  function toggle(metric: Metric) {
    if (metric === "rank") setShowRank((v) => !v);
    else setShowPoints((v) => !v);
  }

  function resetZoom() {
    setZoom(null);
  }
  function zoomIn() {
    // Shrink the visible window toward its centre by 25% on each side.
    const start = zoom?.start ?? 0;
    const end = zoom?.end ?? cleaned.length - 1;
    const width = end - start;
    if (width <= 3) return;
    const shrink = Math.max(1, Math.round(width * 0.25));
    setZoom({ start: start + shrink, end: end - shrink });
  }
  function zoomOut() {
    const start = zoom?.start ?? 0;
    const end = zoom?.end ?? cleaned.length - 1;
    const width = end - start;
    const grow = Math.max(1, Math.round(width * 0.33));
    setZoom({
      start: Math.max(0, start - grow),
      end: Math.min(cleaned.length - 1, end + grow),
    });
  }

  const brushStart = zoom?.start ?? 0;
  const brushEnd = zoom?.end ?? cleaned.length - 1;

  return (
    <div className="rounded-lg border p-4">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        {(["rank", "points"] as const).map((k) => {
          const isOn = k === "rank" ? effectiveRank : effectivePoints;
          return (
            <button
              key={k}
              type="button"
              onClick={() => toggle(k)}
              aria-pressed={isOn}
              className={
                "rounded-md border px-3 py-1.5 text-xs transition-colors " +
                (isOn
                  ? "bg-[color:var(--foreground)] text-[color:var(--background)] border-[color:var(--foreground)]"
                  : "hover:bg-[color:var(--muted)]/40")
              }
              style={isOn ? undefined : { color: COLORS[k] }}
            >
              <span
                aria-hidden
                className="mr-1 inline-block h-2 w-2 rounded-full align-middle"
                style={{ backgroundColor: COLORS[k] }}
              />
              {LABELS[k]}
            </button>
          );
        })}
        <div className="ml-auto inline-flex overflow-hidden rounded-md border text-xs">
          <button
            type="button"
            onClick={zoomOut}
            aria-label="Zoom out"
            className="px-3 py-1.5 hover:bg-[color:var(--muted)]/40"
          >
            −
          </button>
          <button
            type="button"
            onClick={zoomIn}
            aria-label="Zoom in"
            className="border-x px-3 py-1.5 hover:bg-[color:var(--muted)]/40"
          >
            +
          </button>
          <button
            type="button"
            onClick={resetZoom}
            aria-label="Reset zoom"
            className="px-3 py-1.5 hover:bg-[color:var(--muted)]/40"
          >
            Reset
          </button>
        </div>
      </div>
      <div className="h-80">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={cleaned} margin={{ top: 5, right: 16, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" opacity={0.2} />
            <XAxis dataKey="weekOf" tick={{ fontSize: 11 }} minTickGap={50} />
            {effectiveRank && (
              <YAxis
                yAxisId="rank"
                reversed
                tick={{ fontSize: 11 }}
                width={45}
                stroke={COLORS.rank}
                label={{
                  value: "Rank",
                  angle: -90,
                  position: "insideLeft",
                  style: { textAnchor: "middle", fill: COLORS.rank, fontSize: 11 },
                }}
              />
            )}
            {effectivePoints && (
              <YAxis
                yAxisId="points"
                orientation="right"
                tick={{ fontSize: 11 }}
                width={55}
                stroke={COLORS.points}
                label={{
                  value: "Points",
                  angle: 90,
                  position: "insideRight",
                  style: { textAnchor: "middle", fill: COLORS.points, fontSize: 11 },
                }}
              />
            )}
            <Tooltip
              contentStyle={{
                backgroundColor: "var(--background)",
                border: "1px solid var(--border)",
                fontSize: 12,
              }}
            />
            <Legend wrapperStyle={{ fontSize: 11 }} />
            {effectiveRank && (
              <Line
                yAxisId="rank"
                name="Rank"
                type="monotone"
                dataKey="rank"
                stroke={COLORS.rank}
                dot={false}
                strokeWidth={2}
                isAnimationActive={false}
              />
            )}
            {effectivePoints && (
              <Line
                yAxisId="points"
                name="Points"
                type="monotone"
                dataKey="points"
                stroke={COLORS.points}
                dot={false}
                strokeWidth={2}
                isAnimationActive={false}
              />
            )}
            <Brush
              dataKey="weekOf"
              height={22}
              stroke="var(--muted-foreground)"
              startIndex={brushStart}
              endIndex={brushEnd}
              onChange={(range) => {
                if (range == null) return;
                const { startIndex, endIndex } = range as { startIndex?: number; endIndex?: number };
                if (typeof startIndex === "number" && typeof endIndex === "number") {
                  setZoom({ start: startIndex, end: endIndex });
                }
              }}
              travellerWidth={8}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
      <p className="mt-2 text-xs text-[color:var(--muted-foreground)]">
        Drag the handles on the bar below the chart to zoom into a date range,
        or use +/− to step. Toggle Rank/Points to show one or both series.
      </p>
    </div>
  );
}
