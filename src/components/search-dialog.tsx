"use client";

import { Search } from "lucide-react";
import { useEffect, useState, useTransition } from "react";

interface SearchHit {
  slug: string;
  fullName: string;
  countryCode: string | null;
  rank: number | null;
  tour: "atp" | "wta";
}

export function SearchTrigger() {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [results, setResults] = useState<SearchHit[]>([]);
  const [, startTransition] = useTransition();

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "/" && document.activeElement?.tagName !== "INPUT") {
        e.preventDefault();
        setOpen(true);
      }
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  useEffect(() => {
    if (!q || q.length < 2) {
      setResults([]);
      return;
    }
    const controller = new AbortController();
    startTransition(async () => {
      try {
        const res = await fetch(`/api/search?q=${encodeURIComponent(q)}`, {
          signal: controller.signal,
        });
        if (res.ok) setResults(await res.json());
      } catch {
        /* ignore */
      }
    });
    return () => controller.abort();
  }, [q]);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex h-9 items-center gap-2 rounded-md border px-3 text-sm text-[color:var(--muted-foreground)] transition-colors hover:bg-[color:var(--muted)]"
        aria-label="Search players"
      >
        <Search size={14} aria-hidden />
        <span className="hidden sm:inline">Search…</span>
        <kbd className="ml-2 hidden rounded border px-1.5 py-0.5 text-xs sm:inline">/</kbd>
      </button>

      {open && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Search players"
          className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 p-4 pt-20"
          onClick={(e) => {
            if (e.target === e.currentTarget) setOpen(false);
          }}
        >
          <div className="w-full max-w-lg overflow-hidden rounded-lg border bg-[var(--background)] shadow-2xl">
            <input
              autoFocus
              type="search"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search players…"
              className="w-full bg-transparent px-4 py-3 text-base outline-none"
            />
            <ul className="max-h-72 overflow-y-auto border-t">
              {results.map((r) => (
                <li key={r.slug}>
                  <a
                    href={`/players/${r.slug}`}
                    className="flex items-center justify-between px-4 py-2 hover:bg-[color:var(--muted)]"
                  >
                    <span>
                      {r.fullName}{" "}
                      <span className="text-xs text-[color:var(--muted-foreground)]">
                        {r.countryCode}
                      </span>
                    </span>
                    <span className="text-xs uppercase text-[color:var(--muted-foreground)]">
                      {r.tour} #{r.rank ?? "—"}
                    </span>
                  </a>
                </li>
              ))}
              {q && q.length >= 2 && results.length === 0 && (
                <li className="px-4 py-3 text-sm text-[color:var(--muted-foreground)]">
                  No players match "{q}".
                </li>
              )}
            </ul>
          </div>
        </div>
      )}
    </>
  );
}
