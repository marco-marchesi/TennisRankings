// Lightweight i18n shim. Phase 3 swaps this for next-intl with
// locale-prefixed routes (/, /es, /fr) and a Crowdin/Lokalise pipeline.
//
// Until then we ship a single English dictionary so the call sites are
// already wrapped — i.e. no churn in pages when next-intl lands.

import { DEFAULT_LOCALE, type Locale } from "./constants";

type Dict = Record<string, string>;

const en: Dict = {
  "common.search.placeholder": "Search players…",
  "rankings.weekOf": "Week of",
  "rankings.lastUpdated": "Last updated",
  "projection.headline": "Where the rankings are heading",
  "consent.message":
    "We use a small set of cookies for analytics and (later) ads. No tracking happens until you choose.",
  "consent.accept": "Accept",
  "consent.reject": "Reject all",
};

const dictionaries: Record<Locale, Dict> = {
  en,
  es: { ...en /* TODO: translate */ },
  fr: { ...en /* TODO: translate */ },
};

export function t(key: keyof typeof en, locale: Locale = DEFAULT_LOCALE): string {
  return dictionaries[locale][key] ?? key;
}

export { DEFAULT_LOCALE };
