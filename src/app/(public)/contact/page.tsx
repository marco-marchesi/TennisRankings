import { buildMetadata } from "@/lib/seo";

export const metadata = buildMetadata({
  title: "Contact",
  description: "Get in touch with the TennisRankings team.",
  path: "/contact",
});

export default function ContactPage() {
  return (
    <article className="mx-auto max-w-xl px-4 py-10 prose dark:prose-invert">
      <h1>Contact</h1>
      <ul>
        <li>General: <a href="mailto:hello@tennisrankings.example">hello@tennisrankings.example</a></li>
        <li>Privacy / GDPR: <a href="mailto:privacy@tennisrankings.example">privacy@tennisrankings.example</a></li>
        <li>Security reports: <a href="mailto:security@tennisrankings.example">security@tennisrankings.example</a></li>
        <li>Press &amp; partnerships: <a href="mailto:press@tennisrankings.example">press@tennisrankings.example</a></li>
        <li>Scraper bot operator: <a href="mailto:bot@tennisrankings.example">bot@tennisrankings.example</a></li>
      </ul>
    </article>
  );
}
