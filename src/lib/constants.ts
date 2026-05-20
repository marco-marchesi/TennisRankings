export const SITE_NAME = "TennisRankings";
export const SITE_TAGLINE = "The smartest tennis rankings site.";
export const SITE_DESCRIPTION =
  "Live ATP and WTA rankings, projections, points-expiry tracking, head-to-heads, surface splits, and what-if simulators. Built for tennis fans who want depth, not just numbers.";
export const SITE_URL =
  process.env.NEXT_PUBLIC_SITE_URL ?? "https://tennisrankings.example";
export const DEFAULT_LOCALE = "en";
export const SUPPORTED_LOCALES = ["en", "es", "fr"] as const;
export type Locale = (typeof SUPPORTED_LOCALES)[number];

export const TOURS = ["atp", "wta"] as const;
export type Tour = (typeof TOURS)[number];

export const SURFACES = ["hard", "clay", "grass"] as const;
export type Surface = (typeof SURFACES)[number];

export const ATP_BEST_RESULTS_COUNT = 18;
export const WTA_BEST_RESULTS_COUNT = 16;
export const RANKING_WINDOW_WEEKS = 52;
