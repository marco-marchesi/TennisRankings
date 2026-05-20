import { notFound } from "next/navigation";
import { getPlayerBySlug } from "@/lib/players";
import { getPlayerRankingHistory } from "@/lib/rankings";
import { buildMetadata } from "@/lib/seo";
import { RankingHistoryChart } from "@/components/ranking-history-chart";

interface Params { params: Promise<{ slug: string }> }

export const revalidate = 3600;

export async function generateMetadata({ params }: Params) {
  const { slug } = await params;
  const p = await getPlayerBySlug(slug);
  if (!p) return buildMetadata({ title: "Not found", path: `/players/${slug}/history`, noindex: true });
  return buildMetadata({
    title: `${p.fullName} — ranking history`,
    description: `Full ranking history for ${p.fullName}: career-high, week-by-week movement, points trajectory.`,
    path: `/players/${p.slug}/history`,
  });
}

export default async function HistoryPage({ params }: Params) {
  const { slug } = await params;
  const p = await getPlayerBySlug(slug);
  if (!p) notFound();
  const history = await getPlayerRankingHistory(slug);

  return (
    <div className="mx-auto max-w-4xl px-4 py-10">
      <h1 className="font-serif text-3xl md:text-4xl">{p.fullName} — Ranking history</h1>
      <p className="mt-2 text-[color:var(--muted-foreground)]">
        Career-high and week-by-week movement. Toggle between rank and points.
      </p>
      <div className="mt-6">
        <RankingHistoryChart data={history} />
      </div>
    </div>
  );
}
