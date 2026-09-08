import { buildMetadata } from "@/lib/seo";

export const metadata = buildMetadata({
  title: "Privacy policy",
  description: "How TennisRankings handles your data.",
  path: "/privacy",
});

export default function PrivacyPage() {
  return (
    <article className="mx-auto max-w-2xl px-4 py-10 prose dark:prose-invert">
      <h1>Privacy policy</h1>
      <p><strong>Last updated:</strong> {new Date().toISOString().slice(0, 10)}</p>

      <h2>What we collect</h2>
      <p>
        Nothing that identifies you. There are no accounts, no sign-in, no
        newsletter and no email collection. We store no personal data about
        visitors at all.
      </p>

      <h2>Cookies and analytics</h2>
      <p>
        We set no tracking cookies and use no third-party advertising or
        tracking scripts.
      </p>

      <h2>What the site does store</h2>
      <p>
        Only public tennis data: player rankings, match results, tournament
        results and biographical details sourced from the ATP and WTA sites,
        Tennis Abstract, TennisExplorer, Wikidata and Wikipedia.
      </p>

      <h2>Data location</h2>
      <p>Our database is hosted on Neon in the EU.</p>

      <h2>Your rights</h2>
      <p>
        Because we hold no personal data about visitors, there is nothing to
        access, rectify, erase or port. If you believe a page shows personal
        data about you that should not be there, get in touch via the contact
        page and we will remove it.
      </p>
    </article>
  );
}
