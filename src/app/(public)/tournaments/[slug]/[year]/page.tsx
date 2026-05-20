import { notFound } from "next/navigation";
import { getTournamentBySlug } from "@/lib/tournaments";
import { buildMetadata } from "@/lib/seo";

interface Params { params: Promise<{ slug: string; year: string }> }

export const revalidate = 86400;

export async function generateMetadata({ params }: Params) {
  const { slug, year } = await params;
  const t = await getTournamentBySlug(slug);
  if (!t) return buildMetadata({ title: "Not found", path: `/tournaments/${slug}/${year}`, noindex: true });
  return buildMetadata({
    title: `${t.name} ${year} — draw, results, winner`,
    description: `${t.name} ${year} edition: full draw, round-by-round results, prize money, and the eventual winner.`,
    path: `/tournaments/${t.slug}/${year}`,
  });
}

export default async function EditionPage({ params }: Params) {
  const { slug, year } = await params;
  const t = await getTournamentBySlug(slug);
  if (!t) notFound();

  return (
    <div className="mx-auto max-w-3xl px-4 py-10">
      <h1 className="font-serif text-3xl md:text-4xl">
        {t.name} {year}
      </h1>
      <p className="mt-2 text-[color:var(--muted-foreground)]">
        Edition page placeholder — backfills when the scraper imports draw data
        from atptour.com/wtatennis.com.
      </p>
    </div>
  );
}
