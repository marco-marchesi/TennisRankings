import Link from "next/link";
import { SITE_TAGLINE } from "@/lib/constants";
import { getTopRanked } from "@/lib/rankings";
import { RankingsTable } from "@/components/rankings-table";
import { buildMetadata } from "@/lib/seo";

export const revalidate = 3600;

export const metadata = buildMetadata({
  title: "Live ATP & WTA rankings — smarter projections",
  description:
    "The smartest tennis-rankings site. Live ATP & WTA tables, points-expiry, head-to-heads, and what-if simulators — built for fans who want depth.",
  path: "/",
});

export default async function HomePage() {
  const [atp, wta] = await Promise.all([
    getTopRanked({ tour: "atp", limit: 10 }),
    getTopRanked({ tour: "wta", limit: 10 }),
  ]);

  return (
    <div className="mx-auto max-w-7xl px-4 py-10">
      <section className="mb-12">
        <p className="text-xs uppercase tracking-wider text-[color:var(--muted-foreground)]">
          Rankings · Projections · Points-expiry · Head-to-head
        </p>
        <h1 className="mt-2 font-serif text-4xl leading-tight md:text-6xl">
          {SITE_TAGLINE}
        </h1>
        <p className="mt-4 max-w-2xl text-[color:var(--muted-foreground)]">
          Independent ATP & WTA ranking intelligence. Every player, every
          point, every Monday — plus tools the incumbents never built.
        </p>
        <div className="mt-6 flex gap-3">
          <Link
            href="/rankings/projection"
            className="rounded-md bg-[color:var(--foreground)] px-4 py-2 text-sm text-[color:var(--background)]"
          >
            See the projection →
          </Link>
          <Link
            href="/explainers/atp-points"
            className="rounded-md border px-4 py-2 text-sm"
          >
            How rankings work
          </Link>
        </div>
      </section>

      <section className="grid gap-8 md:grid-cols-2">
        <div>
          <div className="mb-3 flex items-baseline justify-between">
            <h2 className="font-serif text-2xl">ATP — Top 10</h2>
            <Link href="/rankings/atp" className="text-sm underline">
              Full table →
            </Link>
          </div>
          <RankingsTable rows={atp} />
        </div>
        <div>
          <div className="mb-3 flex items-baseline justify-between">
            <h2 className="font-serif text-2xl">WTA — Top 10</h2>
            <Link href="/rankings/wta" className="text-sm underline">
              Full table →
            </Link>
          </div>
          <RankingsTable rows={wta} />
        </div>
      </section>
    </div>
  );
}
