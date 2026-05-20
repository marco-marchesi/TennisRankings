"use client";

import { useState } from "react";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
} from "recharts";

interface Row {
  weekOf: string | Date;
  rank: number;
  points: number;
}

interface Props {
  data: Row[];
}

export function RankingHistoryChart({ data }: Props) {
  const [metric, setMetric] = useState<"rank" | "points">("rank");

  if (data.length === 0) {
    return (
      <div className="rounded-lg border bg-[color:var(--muted)]/30 p-8 text-center text-sm text-[color:var(--muted-foreground)]">
        No ranking history available yet. Data backfills as the scraper runs
        weekly snapshots.
      </div>
    );
  }

  const cleaned = [...data]
    .map((r) => ({
      weekOf: typeof r.weekOf === "string" ? r.weekOf : r.weekOf.toISOString().slice(0, 10),
      rank: r.rank,
      points: r.points,
    }))
    .sort((a, b) => a.weekOf.localeCompare(b.weekOf));

  return (
    <div className="rounded-lg border p-4">
      <div className="mb-3 flex items-center gap-2">
        <div className="ml-auto inline-flex overflow-hidden rounded-md border text-xs">
          {(["rank", "points"] as const).map((k) => (
            <button
              key={k}
              type="button"
              onClick={() => setMetric(k)}
              aria-pressed={metric === k}
              className={`px-3 py-1.5 ${
                metric === k
                  ? "bg-[color:var(--foreground)] text-[color:var(--background)]"
                  : ""
              }`}
            >
              {k}
            </button>
          ))}
        </div>
      </div>
      <div className="h-72">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={cleaned}>
            <CartesianGrid strokeDasharray="3 3" opacity={0.2} />
            <XAxis dataKey="weekOf" tick={{ fontSize: 12 }} />
            <YAxis
              reversed={metric === "rank"}
              tick={{ fontSize: 12 }}
              width={50}
            />
            <Tooltip />
            <Line
              type="monotone"
              dataKey={metric}
              stroke="var(--color-up)"
              dot={false}
              strokeWidth={2}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
