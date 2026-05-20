import Link from "next/link";
import { buildMetadata } from "@/lib/seo";

export const metadata = buildMetadata({
  title: "Premium — TennisRankings",
  description:
    "Ad-free browsing, instant email alerts on rank changes for your followed players, CSV exports, and an embeddable widget for your blog.",
  path: "/premium",
});

const FEATURES = [
  { title: "Ad-free everywhere", desc: "No banner ads, no consent banner once you’re signed in." },
  { title: "Instant alerts", desc: "Email and push the moment a followed player wins, loses, or moves rank." },
  { title: "Full CSV exports", desc: "Every ranking, every player, every week — straight into your spreadsheet." },
  { title: "Embed widget", desc: "Drop a live mini-rankings table into your own blog with one line of code." },
];

export default function PremiumPage() {
  const enabled = process.env.NEXT_PUBLIC_PREMIUM_ENABLED === "true";
  return (
    <div className="mx-auto max-w-3xl px-4 py-12">
      <p className="text-xs uppercase tracking-wider text-[color:var(--muted-foreground)]">
        TennisRankings · Premium
      </p>
      <h1 className="mt-2 font-serif text-4xl md:text-5xl">
        Support the project. Get the deepest tools.
      </h1>
      <p className="mt-4 max-w-prose text-[color:var(--muted-foreground)]">
        Premium is how this stays independent. €4/month or €36/year — cancel any
        time. No betting referrals required.
      </p>

      <ul className="mt-8 grid gap-3 md:grid-cols-2">
        {FEATURES.map((f) => (
          <li key={f.title} className="rounded-lg border p-4">
            <h2 className="font-medium">{f.title}</h2>
            <p className="mt-1 text-sm text-[color:var(--muted-foreground)]">
              {f.desc}
            </p>
          </li>
        ))}
      </ul>

      <div className="mt-8">
        {enabled ? (
          <Link
            href="/account/checkout"
            className="rounded-md bg-[color:var(--foreground)] px-5 py-2.5 text-sm text-[color:var(--background)]"
          >
            Subscribe — €4/month
          </Link>
        ) : (
          <p className="rounded-md border p-3 text-sm text-[color:var(--muted-foreground)]">
            Premium is in private beta. Drop your email on the homepage to be
            invited when it opens.
          </p>
        )}
      </div>
    </div>
  );
}
