import { notFound } from "next/navigation";
import { getTopRanked } from "@/lib/rankings";
import { RankingsTable } from "@/components/rankings-table";
import { TOURS, type Tour } from "@/lib/constants";
import { buildMetadata } from "@/lib/seo";

interface Params { params: Promise<{ tour: string }> }

export const revalidate = 3600;
export const dynamicParams = false;
export function generateStaticParams() {
  return TOURS.map((t) => ({ tour: t }));
}

export async function generateMetadata({ params }: Params) {
  const { tour } = await params;
  return buildMetadata({
    title: `${tour.toUpperCase()} Race to Finals`,
    description: `Live ${tour.toUpperCase()} Race standings — calendar-year points only. Tracks who is on course for the year-end Finals.`,
    path: `/race/${tour}`,
  });
}

export default async function RacePage({ params }: Params) {
  const { tour } = await params;
  if (!TOURS.includes(tour as Tour)) notFound();
  const rows = await getTopRanked({ tour: tour as Tour, limit: 30, race: true });

  return (
    <div className="mx-auto max-w-5xl px-4 py-10">
      <h1 className="font-serif text-4xl md:text-5xl">
        {tour.toUpperCase()} Race to Finals
      </h1>
      <p className="mt-2 max-w-2xl text-[color:var(--muted-foreground)]">
        Calendar-year points only. The top 8 (singles) and top 8 pairs (doubles)
        qualify for the year-end Finals.
      </p>
      <div className="mt-6">
        <RankingsTable rows={rows} caption={`${tour.toUpperCase()} Race ranking`} isRace />
      </div>
    </div>
  );
}
