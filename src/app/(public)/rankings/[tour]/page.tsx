import { notFound } from "next/navigation";
import { getTopRanked } from "@/lib/rankings";
import { RankingsTable } from "@/components/rankings-table";
import { TOURS, type Tour } from "@/lib/constants";
import { buildMetadata } from "@/lib/seo";
import { itemListLd, breadcrumbLd } from "@/lib/schema-org";
import { JsonLd } from "@/components/json-ld";
import { formatDate } from "@/lib/utils";

interface Params {
  params: Promise<{ tour: string }>;
}

export const revalidate = 3600;
export const dynamicParams = false;

export function generateStaticParams() {
  return TOURS.map((t) => ({ tour: t }));
}

export async function generateMetadata({ params }: Params) {
  const { tour } = await params;
  const t = tour.toUpperCase();
  return buildMetadata({
    title: `${t} Live Ranking`,
    description: `Live ${t} rankings, points, weekly changes and points-expiry signals. Updated every Monday from official sources.`,
    path: `/rankings/${tour}`,
  });
}

export default async function RankingsPage({ params }: Params) {
  const { tour } = await params;
  if (!TOURS.includes(tour as Tour)) notFound();

  const rows = await getTopRanked({ tour: tour as Tour, limit: 800 });
  const week = rows[0]?.weekOf;

  return (
    <div className="mx-auto max-w-5xl px-4 py-10">
      <nav aria-label="Breadcrumb" className="mb-2 text-xs text-[color:var(--muted-foreground)]">
        <a href="/">Home</a> ›{" "}
        <a href="/rankings/atp">Rankings</a> ›{" "}
        <span aria-current="page">{tour.toUpperCase()}</span>
      </nav>
      <h1 className="font-serif text-4xl md:text-5xl">
        {tour.toUpperCase()} Live Ranking
      </h1>
      {week && (
        <p className="mt-2 text-sm text-[color:var(--muted-foreground)]">
          Week of {formatDate(week)} ·{" "}
          <span className="num">{rows.length}</span> players shown
        </p>
      )}
      <div className="mt-6">
        <RankingsTable rows={rows} caption={`${tour.toUpperCase()} singles ranking, top ${rows.length}`} />
      </div>
      <JsonLd
        data={[
          breadcrumbLd([
            { name: "Home", path: "/" },
            { name: "Rankings", path: "/rankings/atp" },
            { name: tour.toUpperCase(), path: `/rankings/${tour}` },
          ]),
          itemListLd({
            name: `${tour.toUpperCase()} Ranking`,
            items: rows.slice(0, 50).map((r) => ({
              position: r.rank,
              name: r.player.fullName,
              url: `${process.env.NEXT_PUBLIC_SITE_URL ?? ""}/players/${r.player.slug}`,
            })),
          }),
        ]}
      />
    </div>
  );
}
