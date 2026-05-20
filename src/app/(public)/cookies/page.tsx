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
      <ul>
        <li><strong>Essential</strong> — theme preference (light/dark), consent choice. No tracking. Cannot be disabled because the site needs them to work.</li>
        <li><strong>Analytics</strong> — Plausible. Loaded only after you accept. Aggregated, no personal identifiers, no cross-site profile.</li>
        <li><strong>Account</strong> — secure HTTP-only session cookie. Set only after you sign in.</li>
      </ul>

      <h2>What we don't set</h2>
      <p>
        We do not use third-party advertising cookies, Facebook pixels, or
        session-replay tools. When advertising is enabled in a later phase
        we will list every vendor here and surface them in the consent
        banner before any cookie is set.
      </p>

      <h2>Changing your choice</h2>
      <p>
        You can change your consent at any time by clearing site data in
        your browser, or by clicking the "Cookie settings" link in the
        footer (coming soon).
      </p>
    </article>
  );
}
