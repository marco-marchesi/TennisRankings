import { buildMetadata } from "@/lib/seo";

export const metadata = buildMetadata({
  title: "Odds unavailable in your region",
  description:
    "Betting affiliate content is not shown in regions where it is regulated. The rest of TennisRankings is fully available.",
  path: "/odds/unavailable",
  noindex: true,
});

export default function OddsUnavailablePage() {
  return (
    <div className="mx-auto max-w-xl px-4 py-16 text-center">
      <h1 className="font-serif text-3xl">Odds not shown in your region</h1>
      <p className="mt-3 text-[color:var(--muted-foreground)]">
        Betting content is regulated in your country. The rest of the site —
        rankings, projections, head-to-heads, history — is fully available.
      </p>
    </div>
  );
}
