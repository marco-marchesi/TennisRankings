import { notFound } from "next/navigation";
import Link from "next/link";
import Image from "next/image";
import { getPlayerBySlug, getRecentMatches, getSurfaceSplits } from "@/lib/players";
import { getPlayerRankingHistory } from "@/lib/rankings";
import { buildMetadata } from "@/lib/seo";
import { breadcrumbLd, personLd } from "@/lib/schema-org";
import { JsonLd } from "@/components/json-ld";
import { RankingHistoryChart } from "@/components/ranking-history-chart";
import { RecentResults } from "@/components/recent-results";
import { SurfaceSplits } from "@/components/surface-splits";
import { ageFromDob, formatNumber, formatDate } from "@/lib/utils";

interface Params { params: Promise<{ slug: string }> }

export const revalidate = 3600;

export async function generateMetadata({ params }: Params) {
  const { slug } = await params;
  const p = await getPlayerBySlug(slug);
  if (!p) return buildMetadata({ title: "Player not found", path: `/players/${slug}`, noindex: true });
  return buildMetadata({
    title: `${p.fullName} — ranking, results, stats`,
    description: `${p.fullName} (${p.countryCode ?? ""}) — live ranking, points-breakdown, recent form, head-to-head, surface splits and ranking history.`,
    path: `/players/${p.slug}`,
    ogImagePath: `/players/${p.slug}/opengraph-image`,
  });
}

export default async function PlayerPage({ params }: Params) {
  const { slug } = await params;
  const p = await getPlayerBySlug(slug);
  if (!p) notFound();
  const [history, recentMatches, surfaceSplits] = await Promise.all([
    getPlayerRankingHistory(slug),
    getRecentMatches(slug, 10),
    getSurfaceSplits(slug),
  ]);

  return (
    <div className="mx-auto max-w-5xl px-4 py-10">
      <nav aria-label="Breadcrumb" className="text-xs text-[color:var(--muted-foreground)]">
        <Link href="/">Home</Link> ›{" "}
        <Link href={`/rankings/${p.tour}`}>{p.tour.toUpperCase()}</Link> ›{" "}
        <span aria-current="page">{p.fullName}</span>
      </nav>

      <header className="mt-3 flex items-start gap-6">
        <div className="hidden h-24 w-24 shrink-0 overflow-hidden rounded-full border bg-[color:var(--muted)] md:block">
          {p.photoUrl ? (
            <Image
              src={p.photoUrl}
              alt={`${p.fullName}, ${p.countryCode ?? "tennis player"}`}
              width={96}
              height={96}
              className="h-full w-full object-cover"
            />
          ) : (
            <div className="flex h-full w-full items-center justify-center text-2xl font-serif text-[color:var(--muted-foreground)]">
              {p.fullName.split(" ").map((s) => s[0]).join("").slice(0, 2)}
            </div>
          )}
        </div>
        <div className="flex-1">
          <p className="text-xs uppercase tracking-wider text-[color:var(--muted-foreground)]">
            {p.tour.toUpperCase()} singles · {p.countryCode ?? "—"}
            {p.nationalRank ? <span className="ml-1">·  #{p.nationalRank} from {p.countryCode}</span> : null}
          </p>
          <h1 className="mt-1 font-serif text-4xl md:text-5xl">{p.fullName}</h1>
          {p.bio && (
            <p className="mt-3 max-w-prose text-[color:var(--muted-foreground)]">
              {p.bio}
            </p>
          )}
          <div className="mt-4 flex flex-wrap gap-2 text-sm">
            <Link href={`/players/${p.slug}/history`} className="rounded-md border px-3 py-1.5">
              Full ranking history
            </Link>
          </div>
        </div>
      </header>

      {/* Quick-stats panel — populated from the latest settled snapshot. */}
      <section className="mt-6 grid grid-cols-2 gap-4 rounded-lg border p-4 sm:grid-cols-4">
        <div>
          <p className="text-xs uppercase tracking-wide text-[color:var(--muted-foreground)]">Current rank</p>
          <p className="mt-1 text-2xl font-serif">{p.currentRank ?? "—"}</p>
        </div>
        <div>
          <p className="text-xs uppercase tracking-wide text-[color:var(--muted-foreground)]">Points</p>
          <p className="mt-1 text-2xl font-serif">{p.currentPoints != null ? formatNumber(p.currentPoints) : "—"}</p>
        </div>
        <div>
          <p className="text-xs uppercase tracking-wide text-[color:var(--muted-foreground)]">Career high</p>
          <p className="mt-1 text-2xl font-serif">
            {p.careerHighRank ?? "—"}
            {p.careerHighWeek && (
              <span className="ml-1 text-xs text-[color:var(--muted-foreground)]">({formatDate(p.careerHighWeek)})</span>
            )}
          </p>
        </div>
        <div>
          <p className="text-xs uppercase tracking-wide text-[color:var(--muted-foreground)]">Age</p>
          <p className="mt-1 text-2xl font-serif">{ageFromDob(p.dateOfBirth) ?? "—"}</p>
        </div>
        {p.raceRank != null && (
          <div>
            <p className="text-xs uppercase tracking-wide text-[color:var(--muted-foreground)]">Race rank</p>
            <p className="mt-1 text-2xl font-serif">{p.raceRank}</p>
          </div>
        )}
        {p.plays && p.plays !== "unknown" && (
          <div>
            <p className="text-xs uppercase tracking-wide text-[color:var(--muted-foreground)]">Plays</p>
            <p className="mt-1 text-2xl font-serif capitalize">{p.plays}-handed</p>
            {p.backhand && (
              <p className="text-xs text-[color:var(--muted-foreground)]">{p.backhand} backhand</p>
            )}
          </div>
        )}
        {p.height_cm && (
          <div>
            <p className="text-xs uppercase tracking-wide text-[color:var(--muted-foreground)]">Height</p>
            <p className="mt-1 text-2xl font-serif">{p.height_cm} cm</p>
          </div>
        )}
        {p.turnedPro && (
          <div>
            <p className="text-xs uppercase tracking-wide text-[color:var(--muted-foreground)]">Turned pro</p>
            <p className="mt-1 text-2xl font-serif">{p.turnedPro}</p>
          </div>
        )}
      </section>

      <section className="mt-8">
        <h2 className="mb-3 text-sm font-medium uppercase tracking-wide text-[color:var(--muted-foreground)]">
          Recent matches
        </h2>
        <RecentResults matches={recentMatches} />
      </section>

      <section className="mt-8">
        <h2 className="mb-3 text-sm font-medium uppercase tracking-wide text-[color:var(--muted-foreground)]">
          By surface
        </h2>
        <SurfaceSplits
          splits={surfaceSplits}
          coverageNote={`Computed from the last ${surfaceSplits.reduce((n, s) => n + s.matches, 0)} matches we have on file — roughly the trailing 12 months for active top-50 players.`}
        />
      </section>

      <section className="mt-8">
        <h2 className="mb-3 text-sm font-medium uppercase tracking-wide text-[color:var(--muted-foreground)]">
          Ranking history
          <span className="ml-2 normal-case text-xs text-[color:var(--muted-foreground)]">
            ({history.length} {history.length === 1 ? "weekly snapshot" : "weekly snapshots"})
          </span>
        </h2>
        <RankingHistoryChart data={history} />
        {history.length < 4 && (
          <p className="mt-2 text-xs text-[color:var(--muted-foreground)]">
            History accumulates as the weekly scraper runs. Single-point charts will fill in over the coming Mondays.
          </p>
        )}
      </section>

      <section className="mt-8 rounded-lg border p-4">
        <h2 className="text-sm font-medium uppercase tracking-wide text-[color:var(--muted-foreground)]">
          Sources
        </h2>
        <ul className="mt-2 text-sm">
          {p.wikipediaUrl && (
            <li>
              <a className="underline" href={p.wikipediaUrl} rel="noopener nofollow">
                Wikipedia
              </a>
            </li>
          )}
          <li>
            <a
              className="underline"
              href={`https://www.atptour.com/en/players/${p.slug}`}
              rel="noopener nofollow"
            >
              Official {p.tour.toUpperCase()} profile
            </a>
          </li>
        </ul>
        {p.photoAttribution && (
          <p className="mt-3 text-xs text-[color:var(--muted-foreground)]">
            Photo: {p.photoAttribution}
          </p>
        )}
      </section>

      <JsonLd
        data={[
          breadcrumbLd([
            { name: "Home", path: "/" },
            { name: p.tour.toUpperCase(), path: `/rankings/${p.tour}` },
            { name: p.fullName, path: `/players/${p.slug}` },
          ]),
          personLd({
            name: p.fullName,
            slug: p.slug,
            birthDate: p.dateOfBirth,
            nationality: p.countryCode,
            image: p.photoUrl,
            description: p.bio ?? `${p.fullName} — professional tennis player.`,
            sameAs: p.wikipediaUrl ? [p.wikipediaUrl] : undefined,
          }),
        ]}
      />
    </div>
  );
}
