/**
 * Required wrapper around any odds/affiliate link.
 *
 *  - Visible "ad" / "affiliate" label (FTC + UK ASA + EU UCPD).
 *  - 18+ gate signal.
 *  - Responsible-gambling link.
 *  - `rel="sponsored nofollow noopener"` on every outgoing link.
 *  - Hidden in countries where it's illegal — geo-blocking happens on the
 *    edge (Cloudflare worker / Next middleware) and the parent passes
 *    `visible={false}` in those cases.
 */
import Link from "next/link";

interface Props {
  visible?: boolean;
  children: React.ReactNode;
}

export function BettingDisclosure({ visible = true, children }: Props) {
  if (!visible) return null;
  return (
    <aside
      aria-label="Affiliate disclosure"
      className="rounded-lg border border-amber-400/40 bg-amber-50/30 p-3 text-xs dark:bg-amber-950/30"
    >
      <p className="font-medium uppercase tracking-wider">
        Affiliate · 18+
      </p>
      <div className="mt-2">{children}</div>
      <p className="mt-2 text-[color:var(--muted-foreground)]">
        We may earn a commission from bookmakers linked above. Gambling can
        be addictive — please play responsibly.{" "}
        <Link href="https://www.begambleaware.org/" className="underline">
          BeGambleAware
        </Link>
        .
      </p>
    </aside>
  );
}
