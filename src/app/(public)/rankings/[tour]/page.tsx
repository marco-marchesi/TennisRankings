import Link from "next/link";
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
    // Previously claimed "Updated every Monday from official sources", which
    // described only the settled snapshot — while the # and Pts columns on the
    // page are in-week projections for any player currently in a draw.
    description: `${t} rankings with points, weekly movement and points-expiry signals. Official weekly snapshot, with in-week rows showing a projected total for the next publish.`,
    path: `/rankings/${tour}`,
  });
}

export default async function RankingsPage({ params }: Params) {
  const { tour } = await params;
  if (!TOURS.includes(tour as Tour)) notFound();

  const rows = await getTopRanked({ tour: tour as Tour, limit: 800 });
  const week = rows[0]?.weekOf;
  // How many rows are actually mid-tournament.
  //
  // NOT `r.projection !== null`: the projections runner writes a row for every
  // player it scans, including a "(not playing)" sentinel, so that count is
  // just "everyone we projected" — which would claim a tournament is in
  // progress for players sitting at home.
  const activeCount = rows.filter(
    (r) => r.projection !== null && r.projection.status !== "not_playing",
  ).length;

  return (
    <div className="mx-auto max-w-5xl px-4 py-10">
      <nav aria-label="Breadcrumb" className="mb-2 text-xs text-[color:var(--muted-foreground)]">
        <Link href="/">Home</Link> ›{" "}
        <Link href="/rankings/atp">Rankings</Link> ›{" "}
        <span aria-current="page">{tour.toUpperCase()}</span>
      </nav>
      <h1 className="font-serif text-4xl md:text-5xl">
        {tour.toUpperCase()} Live Ranking
      </h1>
      {week && (
        <p className="mt-2 text-sm text-[color:var(--muted-foreground)]">
          Official ranking published {formatDate(week)} ·{" "}
          <span className="num">{rows.length}</span> players shown
        </p>
      )}
      {activeCount > 0 && (
        <p className="mt-1 text-sm text-[color:var(--muted-foreground)]">
          <span className="num">{activeCount}</span>{" "}
          {activeCount === 1 ? "player is" : "players are"} mid-tournament. The{" "}
          <strong>#</strong> and <strong>Pts</strong> columns show each
          player&apos;s projected total for the next publish, which differs from
          the published figure for those rows.
        </p>
      )}
      {rows.length === 0 ? (
        <p className="mt-6 rounded border border-[color:var(--border)] p-4 text-sm text-[color:var(--muted-foreground)]">
          No ranking data is stored for {tour.toUpperCase()} yet.
        </p>
      ) : (
        <div className="mt-6">
          <RankingsTable rows={rows} caption={`${tour.toUpperCase()} singles ranking, top ${rows.length}`} />
        </div>
      )}
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
