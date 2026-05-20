import { notFound } from "next/navigation";
import { getPlayerBySlug } from "@/lib/players";
import { getHeadToHead } from "@/lib/h2h";
import { buildMetadata } from "@/lib/seo";

interface Params { params: Promise<{ slug: string; opponent: string }> }

export const revalidate = 3600;

export async function generateMetadata({ params }: Params) {
  const { slug, opponent } = await params;
  const [a, b] = await Promise.all([getPlayerBySlug(slug), getPlayerBySlug(opponent)]);
  if (!a || !b) return buildMetadata({ title: "H2H not found", path: `/players/${slug}/h2h/${opponent}`, noindex: true });
  return buildMetadata({
    title: `${a.fullName} vs ${b.fullName} — head-to-head`,
    description: `Complete head-to-head between ${a.fullName} and ${b.fullName}: total record, surface splits, every match.`,
    path: `/players/${a.slug}/h2h/${b.slug}`,
  });
}

export default async function H2HPage({ params }: Params) {
  const { slug, opponent } = await params;
  const [a, b] = await Promise.all([getPlayerBySlug(slug), getPlayerBySlug(opponent)]);
  if (!a || !b) notFound();
  const record = await getHeadToHead(a.slug, b.slug);

  return (
    <div className="mx-auto max-w-3xl px-4 py-10">
      <h1 className="font-serif text-3xl md:text-4xl">
        {a.fullName} <span className="text-[color:var(--muted-foreground)]">vs</span> {b.fullName}
      </h1>
      <div className="mt-6 grid grid-cols-3 gap-3">
        <Stat label={`${a.fullName} wins`} value={record.total.wins} tone="up" />
        <Stat label="Total" value={record.total.wins + record.total.losses} />
        <Stat label={`${b.fullName} wins`} value={record.total.losses} tone="down" />
      </div>

      <section className="mt-8">
        <h2 className="font-serif text-xl">By surface</h2>
        <ul className="mt-3 grid gap-2 md:grid-cols-3">
          {Object.entries(record.bySurface).map(([surface, r]) => (
            <li key={surface} className="rounded-md border p-3 text-sm">
              <div className="uppercase tracking-wide text-[color:var(--muted-foreground)] text-xs">{surface}</div>
              <div className="mt-1 num">
                {r.wins} – {r.losses}
              </div>
            </li>
          ))}
          {Object.keys(record.bySurface).length === 0 && (
            <li className="rounded-md border p-3 text-sm text-[color:var(--muted-foreground)]">
              No completed matches in the database yet — backfills as the
              scraper imports ATP/WTA match data.
            </li>
          )}
        </ul>
      </section>
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: number; tone?: "up" | "down" }) {
  const color = tone === "up" ? "text-[color:var(--color-up)]" : tone === "down" ? "text-[color:var(--color-down)]" : "";
  return (
    <div className="rounded-lg border p-4 text-center">
      <div className={`font-serif text-4xl num ${color}`}>{value}</div>
      <div className="mt-1 text-xs text-[color:var(--muted-foreground)]">{label}</div>
    </div>
  );
}
