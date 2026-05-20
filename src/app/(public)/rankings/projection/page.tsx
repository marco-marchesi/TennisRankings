import { getProjection } from "@/lib/projection";
import { ProjectionTable } from "@/components/projection-table";
import { buildMetadata } from "@/lib/seo";

export const revalidate = 3600;

export const metadata = buildMetadata({
  title: "ATP & WTA Ranking Projection — points expiring soon",
  description:
    "Where the rankings are heading. Subtract points expiring in the next 4 / 12 weeks from current totals and re-sort. The live-tennis.eu projection, finally legible.",
  path: "/rankings/projection",
});

export default async function ProjectionPage() {
  const [atp, wta] = await Promise.all([
    getProjection("atp", 4),
    getProjection("wta", 4),
  ]);

  return (
    <div className="mx-auto max-w-6xl px-4 py-10">
      <h1 className="font-serif text-4xl md:text-5xl">Ranking projection</h1>
      <p className="mt-2 max-w-2xl text-[color:var(--muted-foreground)]">
        Points expire 52 weeks after they were won. This table shows where the
        top 100 will sit once the points expiring in the next four weeks fall
        off. Green = moving up, red = moving down.
      </p>

      <section className="mt-8">
        <h2 className="font-serif text-2xl">ATP — projected top 30</h2>
        <ProjectionTable rows={atp.slice(0, 30)} />
      </section>

      <section className="mt-10">
        <h2 className="font-serif text-2xl">WTA — projected top 30</h2>
        <ProjectionTable rows={wta.slice(0, 30)} />
      </section>
    </div>
  );
}
