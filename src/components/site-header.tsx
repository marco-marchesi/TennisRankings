import Link from "next/link";
import { SITE_NAME } from "@/lib/constants";
import { ThemeToggle } from "./theme-toggle";
import { SearchTrigger } from "./search-dialog";

const nav = [
  { href: "/rankings/atp", label: "ATP" },
  { href: "/rankings/wta", label: "WTA" },
  { href: "/rankings/projection", label: "Projection" },
  { href: "/race/atp", label: "Race" },
  { href: "/explainers/atp-points", label: "Explainers" },
];

export function SiteHeader() {
  return (
    <header className="sticky top-0 z-40 w-full border-b bg-[var(--background)]/80 backdrop-blur">
      <div className="mx-auto flex h-14 max-w-7xl items-center gap-6 px-4">
        <Link
          href="/"
          className="font-serif text-xl font-medium tracking-tight"
          aria-label={`${SITE_NAME} home`}
        >
          {SITE_NAME}
        </Link>

        <nav
          aria-label="Primary"
          className="hidden items-center gap-5 text-sm md:flex"
        >
          {nav.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="text-[color:var(--muted-foreground)] transition-colors hover:text-[color:var(--foreground)]"
            >
              {item.label}
            </Link>
          ))}
        </nav>

        <div className="ml-auto flex items-center gap-2">
          <SearchTrigger />
          <ThemeToggle />
        </div>
      </div>
    </header>
  );
}
