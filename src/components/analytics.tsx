"use client";

import { useEffect, useState } from "react";
import Script from "next/script";

const STORAGE_KEY = "tr.consent.v1";

export function Analytics() {
  const [consented, setConsented] = useState(false);

  useEffect(() => {
    const initial = localStorage.getItem(STORAGE_KEY) === "granted";
    setConsented(initial);
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      setConsented(detail === "granted");
    };
    document.addEventListener("tr:consent", handler);
    return () => document.removeEventListener("tr:consent", handler);
  }, []);

  if (!consented) return null;
  const domain = process.env.NEXT_PUBLIC_PLAUSIBLE_DOMAIN;
  if (!domain) return null;

  return (
    <Script
      strategy="afterInteractive"
      data-domain={domain}
      src="https://plausible.io/js/script.js"
    />
  );
}
