"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

// Minimal CMP placeholder. Production should integrate Klaro!
// (https://github.com/klaro-org/klaro-js) configured with TCF v2.2 vendors so
// AdSense/affiliates consent flows correctly. Until then, this banner gates
// analytics + ad scripts via the `consent` state below.
const STORAGE_KEY = "tr.consent.v1";

type Consent = "granted" | "denied" | null;

export function ConsentBanner() {
  const [consent, setConsent] = useState<Consent>(null);

  useEffect(() => {
    const stored = localStorage.getItem(STORAGE_KEY) as Consent;
    setConsent(stored);
  }, []);

  if (consent !== null) return null;

  const set = (value: "granted" | "denied") => {
    localStorage.setItem(STORAGE_KEY, value);
    setConsent(value);
    document.dispatchEvent(new CustomEvent("tr:consent", { detail: value }));
  };

  return (
    <div
      role="dialog"
      aria-label="Cookie consent"
      className="fixed inset-x-0 bottom-0 z-50 border-t bg-[var(--background)]/95 backdrop-blur"
    >
      <div className="mx-auto flex max-w-7xl flex-col gap-3 px-4 py-4 text-sm md:flex-row md:items-center">
        <p className="flex-1">
          We use a small set of cookies for analytics and (later) ads. No
          tracking happens until you choose. See our{" "}
          <Link href="/cookies" className="underline">
            cookie policy
          </Link>
          .
        </p>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => set("denied")}
            className="rounded-md border px-3 py-1.5"
          >
            Reject all
          </button>
          <button
            type="button"
            onClick={() => set("granted")}
            className="rounded-md bg-[color:var(--foreground)] px-3 py-1.5 text-[color:var(--background)]"
          >
            Accept
          </button>
        </div>
      </div>
    </div>
  );
}
