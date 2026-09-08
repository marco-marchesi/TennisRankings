import { buildMetadata } from "@/lib/seo";

export const metadata = buildMetadata({
  title: "Cookie policy",
  description: "What cookies and similar technologies TennisRankings uses.",
  path: "/cookies",
});

export default function CookiePage() {
  return (
    <article className="mx-auto max-w-2xl px-4 py-10 prose dark:prose-invert">
      <h1>Cookie policy</h1>
      <p><strong>Last updated:</strong> {new Date().toISOString().slice(0, 10)}</p>

      <h2>What we set</h2>
      <p>
        No cookies. The site has no accounts and no analytics, so there is no
        session cookie, no consent cookie and no tracking cookie.
      </p>

      <h2>Local storage</h2>
      <p>
        One entry, <code>theme</code>, remembers whether you chose light or
        dark mode. It stays in your browser, is never sent to us, and clearing
        site data removes it.
      </p>

      <h2>What we don&apos;t set</h2>
      <p>
        No third-party advertising cookies, no tracking pixels, no
        session-replay tools, no analytics of any kind.
      </p>

    </article>
  );
}
