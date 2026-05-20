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
        Public browsing requires no account. If you choose to enable
        analytics via the consent banner, we collect aggregated, anonymised
        page-view statistics through Plausible. We do not use third-party
        tracking cookies.
      </p>

      <h2>Accounts</h2>
      <p>
        If you sign up to follow players or receive alerts, we store your
        email address and the list of players you follow. You can export or
        delete this data at any time from your account page.
      </p>

      <h2>Newsletter</h2>
      <p>
        Subscribers receive a single confirmation email and weekly digest.
        Each email includes a one-click unsubscribe link.
      </p>

      <h2>Data location</h2>
      <p>
        Our database is hosted on Neon in the EU. Email is sent via Resend.
        All processing happens in the EU.
      </p>

      <h2>Your rights</h2>
      <p>
        Under GDPR you have the right of access, rectification, erasure,
        restriction, portability and objection. Email{" "}
        <a href="mailto:privacy@tennisrankings.example">
          privacy@tennisrankings.example
        </a>{" "}
        and we will respond within 30 days.
      </p>
    </article>
  );
}
