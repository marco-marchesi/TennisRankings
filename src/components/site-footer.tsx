import Link from "next/link";
import { SITE_NAME } from "@/lib/constants";

export function SiteFooter() {
  return (
    <footer className="mt-16 border-t bg-[color:var(--muted)]/40">
      <div className="mx-auto grid max-w-7xl gap-8 px-4 py-12 text-sm md:grid-cols-4">
        <div>
          <p className="font-serif text-lg">{SITE_NAME}</p>
          <p className="mt-2 max-w-xs text-[color:var(--muted-foreground)]">
            Independent tennis-rankings intelligence. Data sourced from
            atptour.com, wtatennis.com, and Wikipedia.
          </p>
        </div>

        <div>
          <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-[color:var(--muted-foreground)]">
            Rankings
          </h2>
          <ul className="space-y-2">
            <li><Link href="/rankings/atp">ATP</Link></li>
            <li><Link href="/rankings/wta">WTA</Link></li>
            <li><Link href="/race/atp">Race to Finals</Link></li>
          </ul>
        </div>

        <div>
          <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-[color:var(--muted-foreground)]">
            Learn
          </h2>
          <ul className="space-y-2">
            <li><Link href="/explainers/atp-points">How ATP points work</Link></li>
            <li><Link href="/explainers/points-expiry">Why points expire</Link></li>
          </ul>
        </div>

        <div>
          <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-[color:var(--muted-foreground)]">
            Site
          </h2>
          <ul className="space-y-2">
            <li><Link href="/privacy">Privacy</Link></li>
            <li><Link href="/cookies">Cookies</Link></li>
            <li><Link href="/about">About</Link></li>
            <li><Link href="/contact">Contact</Link></li>
          </ul>
        </div>
      </div>
      <div className="border-t px-4 py-6 text-center text-xs text-[color:var(--muted-foreground)]">
        © {new Date().getFullYear()} {SITE_NAME}. Not affiliated with the ATP,
        WTA, or ITF.
      </div>
    </footer>
  );
}
