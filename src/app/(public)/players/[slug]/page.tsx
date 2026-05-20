import { notFound } from "next/navigation";
import Link from "next/link";
import Image from "next/image";
import { getPlayerBySlug } from "@/lib/players";
import { buildMetadata } from "@/lib/seo";
import { breadcrumbLd, personLd } from "@/lib/schema-org";
import { JsonLd } from "@/components/json-ld";
import { FormWidget } from "@/components/form-widget";

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

  // TODO: pull real recent form from matches table once scraper feeds it.
  const sampleForm: Array<{ result: "W" | "L"; surface?: "hard" | "clay" | "grass" }> = [
    { result: "W", surface: "hard" },
    { result: "W", surface: "hard" },
    { result: "L", surface: "hard" },
    { result: "W", surface: "clay" },
    { result: "W", surface: "clay" },
  ];

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
            {p.tour.toUpperCase()} singles · {p.countryCode}
          </p>
          <h1 className="mt-1 font-serif text-4xl md:text-5xl">{p.fullName}</h1>
          {p.bio && (
            <p className="mt-3 max-w-prose text-[color:var(--muted-foreground)]">
              {p.bio}
            </p>
          )}
          <div className="mt-4 flex flex-wrap gap-2 text-sm">
            <Link href={`/players/${p.slug}/history`} className="rounded-md border px-3 py-1.5">
              Ranking history
            </Link>
            <Link href={`/players/${p.slug}/h2h/jannik-sinner`} className="rounded-md border px-3 py-1.5">
              Head-to-head
            </Link>
          </div>
        </div>
      </header>

      <section className="mt-8 grid gap-6 md:grid-cols-2">
        <div className="rounded-lg border p-4">
          <h2 className="text-sm font-medium uppercase tracking-wide text-[color:var(--muted-foreground)]">
            Recent form
          </h2>
          <div className="mt-3">
            <FormWidget matches={sampleForm} />
          </div>
        </div>
        <div className="rounded-lg border p-4">
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
              <a className="underline" href={`https://www.atptour.com/en/players/${p.slug}`} rel="noopener nofollow">
                Official ATP profile
              </a>
            </li>
          </ul>
          {p.photoAttribution && (
            <p className="mt-3 text-xs text-[color:var(--muted-foreground)]">
              Photo: {p.photoAttribution}
            </p>
          )}
        </div>
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
