import { notFound } from "next/navigation";
import { getTournamentBySlug } from "@/lib/tournaments";
import { buildMetadata } from "@/lib/seo";
import { breadcrumbLd, sportsEventLd } from "@/lib/schema-org";
import { JsonLd } from "@/components/json-ld";

interface Params { params: Promise<{ slug: string }> }

export const revalidate = 3600;

export async function generateMetadata({ params }: Params) {
  const { slug } = await params;
  const t = await getTournamentBySlug(slug);
  if (!t) return buildMetadata({ title: "Tournament not found", path: `/tournaments/${slug}`, noindex: true });
  return buildMetadata({
    title: `${t.name} — draw, schedule, prize money`,
    description: `${t.name} (${t.city}, ${t.countryCode}): draw, schedule, prize money breakdown, past winners and how ranking points are awarded.`,
    path: `/tournaments/${t.slug}`,
  });
}

export default async function TournamentPage({ params }: Params) {
  const { slug } = await params;
  const t = await getTournamentBySlug(slug);
  if (!t) notFound();
  const year = new Date().getUTCFullYear();

  return (
    <div className="mx-auto max-w-4xl px-4 py-10">
      <p className="text-xs uppercase tracking-wider text-[color:var(--muted-foreground)]">
        {t.category.replace(/_/g, " ")} · {t.surface} · {t.tour.toUpperCase()}
      </p>
      <h1 className="mt-1 font-serif text-4xl md:text-5xl">{t.name}</h1>
      <p className="mt-2 text-[color:var(--muted-foreground)]">
        {t.city}, {t.countryCode} · Draw {t.drawSize} · Winner takes {t.pointsWinner ?? "?"} points
      </p>

      <section className="mt-8 grid gap-3 md:grid-cols-3">
        <Card title="Prize money">
          {t.prizeMoneyUsd ? `$${t.prizeMoneyUsd.toLocaleString()}` : "—"}
        </Card>
        <Card title="Surface">
          {t.surface}
          {t.indoor ? " (indoor)" : ""}
        </Card>
        <Card title="Category">{t.category.replace(/_/g, " ")}</Card>
      </section>

      <p className="mt-8 text-sm text-[color:var(--muted-foreground)]">
        Past editions: <a className="underline" href={`/tournaments/${t.slug}/${year - 1}`}>{year - 1}</a>{" "}·{" "}
        <a className="underline" href={`/tournaments/${t.slug}/${year - 2}`}>{year - 2}</a>
      </p>

      <JsonLd
        data={[
          breadcrumbLd([
            { name: "Home", path: "/" },
            { name: "Tournaments", path: `/tournaments/${t.slug}` },
            { name: t.name, path: `/tournaments/${t.slug}` },
          ]),
          sportsEventLd({
            name: t.name,
            slug: t.slug,
            year,
            city: t.city,
            country: t.countryCode,
          }),
        ]}
      />
    </div>
  );
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border p-4">
      <div className="text-xs uppercase tracking-wide text-[color:var(--muted-foreground)]">{title}</div>
      <div className="mt-1 text-lg font-medium num">{children}</div>
    </div>
  );
}
