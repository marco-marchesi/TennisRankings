"use client";

import Link from "next/link";

/**
 * Honest failure state.
 *
 * The data-access layer used to swallow database errors and return
 * `mockTopRanked()` / `mockPlayer()` — hardcoded 2024 fixtures — with only a
 * `console.warn`. Because every page sets `revalidate = 3600`, a single
 * transient error baked fabricated rankings into the ISR cache for an hour
 * with nothing in the UI to indicate the numbers were invented. Those
 * fallbacks now throw, and land here instead.
 */
export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="mx-auto max-w-xl px-4 py-24 text-center">
      <p className="text-xs uppercase tracking-wider text-[color:var(--muted-foreground)]">
        Data unavailable
      </p>
      <h1 className="mt-2 font-serif text-4xl">No numbers to show.</h1>
      <p className="mt-3 text-[color:var(--muted-foreground)]">
        We couldn&apos;t reach the rankings database. Rather than show you stale
        or invented figures, we show you nothing.
      </p>
      <div className="mt-6 flex items-center justify-center gap-4 text-sm">
        <button onClick={reset} className="underline">
          Try again
        </button>
        <Link href="/" className="underline">
          Home
        </Link>
      </div>
      {process.env.NODE_ENV === "development" && (
        <pre className="mt-8 overflow-x-auto rounded border border-[color:var(--border)] p-3 text-left text-xs text-[color:var(--muted-foreground)]">
          {error.message}
        </pre>
      )}
    </div>
  );
}
