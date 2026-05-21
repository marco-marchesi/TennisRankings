import { notFound } from "next/navigation";
import Link from "next/link";
import { getLeaderboard, type LeaderboardCategory } from "@/lib/leaderboards";
import { LeaderboardTable } from "@/components/leaderboard-table";
import { TOURS, type Tour } from "@/lib/constants";
import { buildMetadata } from "@/lib/seo";

const CATEGORIES: { key: LeaderboardCategory; label: string; blurb: string }[] = [
  {
    key: "serve",
    label: "Serve",
    blurb: "Who's hardest to break — Last-52-week serve performance from Tennis Abstract's Match Charting Project.",
  },
  {
    key: "return",
    label: "Return",
    blurb: "Who returns best — return-in-play %, points won off each serve, and outright winners.",
  },
  {
    key: "rally",
    label: "Rally",
    blurb: "Who wins the patterns — point-construction stats segmented by rally length.",
  },
  {
    key: "winners_errors",
    label: "Winners & Errors",
    blurb: "Aggression vs. control — total winners, unforced errors, and the W/UFE ratio.",
  },
];

interface Params {
  params: Promise<{ tour: string }>;
}

interface SearchParams {
  searchParams: Promise<{ c?: string }>;
}

export const revalidate = 3600;
export const dynamicParams = false;

export function generateStaticParams() {
  return TOURS.map((t) => ({ tour: t }));
}

export async function generateMetadata({ params }: Params) {
  const { tour } = await params;
  return buildMetadata({
    title: `${tour.toUpperCase()} Leaderboards — serve, return, rally, winners`,
    description: `${tour.toUpperCase()} match-charting leaderboards from Tennis Abstract: who serves hardest, returns best, wins long rallies, and racks up the cleanest winner-to-error ratios over the last 52 weeks.`,
    path: `/leaderboards/${tour}`,
  });
}

export default async function LeaderboardsPage({ params, searchParams }: Params & SearchParams) {
  const { tour } = await params;
  if (!TOURS.includes(tour as Tour)) notFound();
  const { c } = await searchParams;
  const activeKey = (CATEGORIES.find((cat) => cat.key === c)?.key ?? "serve") as LeaderboardCategory;
  const active = CATEGORIES.find((cat) => cat.key === activeKey)!;
  const rows = await getLeaderboard(tour as "atp" | "wta", activeKey);

  return (
    <div className="mx-auto max-w-6xl px-4 py-10">
      <nav aria-label="Breadcrumb" className="mb-2 text-xs text-[color:var(--muted-foreground)]">
        <Link href="/">Home</Link> › <span aria-current="page">{tour.toUpperCase()} Leaderboards</span>
      </nav>
      <h1 className="font-serif text-4xl md:text-5xl">
        {tour.toUpperCase()} Leaderboards
      </h1>
      <p className="mt-2 max-w-2xl text-[color:var(--muted-foreground)]">
        Last-52-week stats from Tennis Abstract's Match Charting Project — the
        point-by-point dataset volunteers have been hand-tagging since 2013.
      </p>

      {/* Category tabs */}
      <div className="mt-6 flex flex-wrap gap-2 border-b">
        {CATEGORIES.map((cat) => {
          const isActive = cat.key === activeKey;
          return (
            <Link
              key={cat.key}
              href={`/leaderboards/${tour}?c=${cat.key}`}
              className={
                "rounded-t-md px-4 py-2 text-sm transition-colors " +
                (isActive
                  ? "border-b-2 border-[color:var(--foreground)] font-medium"
                  : "text-[color:var(--muted-foreground)] hover:text-[color:var(--foreground)]")
              }
              aria-current={isActive ? "page" : undefined}
            >
              {cat.label}
            </Link>
          );
        })}
      </div>

      <section className="mt-6">
        <p className="mb-3 text-sm text-[color:var(--muted-foreground)]">{active.blurb}</p>
        <LeaderboardTable rows={rows} category={activeKey} />
      </section>

      <p className="mt-6 text-xs text-[color:var(--muted-foreground)]">
        Source: <a className="underline" rel="noopener nofollow" href="https://tennisabstract.com/">Tennis Abstract</a> Match Charting Project (CC-BY).
        Updated whenever <code>pnpm scraper:leaderboards</code> runs.
      </p>
    </div>
  );
}
