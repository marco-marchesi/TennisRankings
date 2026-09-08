// Shared category-inference logic. Both `derive-live-state` (for current-week
// projections) and `derive-dropping-points` (for 52-weeks-ago dropping) need
// to map a tournament's Tennis Abstract `tourney_level` + name into our
// Category enum. We unify the logic here so they can't drift apart.

import type { Category } from "../config/points-table";

// ATP 500 events as of 2026. Tournaments at TA level "A" with names matching
// this set are 500-tier; otherwise 250.
// docs/ranking-rules.md:171 says there are 16 ATP 500s. This set had 13 —
// Basel, Munich and Almaty were missing, so those events degraded to
// atp_250 and a title there was credited 250 instead of 500.
const ATP_500_TOURNAMENTS = new Set([
  "Acapulco", "Almaty", "Barcelona", "Basel", "Beijing", "Doha", "Dubai",
  "Halle", "Hamburg", "Munich", "Queen's Club", "Rio de Janeiro", "Rotterdam",
  "Tokyo", "Vienna", "Washington",
]);

// WTA 500 events (the WTA "P" tier covers both 500 and the older 700-level
// events; we map both to wta_500 since the points structure is the same).
// NOTE "Beijing" is deliberately NOT here. It is a combined WTA 1000
// (docs/ranking-rules.md:397) and listing it in both sets made the tier
// depend on which branch ran first: the `level === "P"` path resolved it to
// wta_500 while the name-fallback path resolved it to wta_1000.
const WTA_500_TOURNAMENTS = new Set([
  "Stuttgart", "Charleston", "Strasbourg", "Berlin", "San Diego", "Adelaide",
  "Tokyo", "Seoul", "Monterrey", "Abu Dhabi", "Linz", "Ningbo", "Zhengzhou",
  "Merida", "Eastbourne", "Bad Homburg", "Nottingham", "Prague", "Cluj",
  "Hua Hin", "Hobart", "Auckland", "Brisbane",
]);

// WTA 125 events. Previously absent, so they fell through to wta_250 and a
// title was credited 250 instead of 125 (docs/ranking-rules.md:362-371).
const WTA_125_MARKERS = new Set(["125", "WTA125"]);

const GRAND_SLAMS = new Set([
  "Australian Open", "Roland Garros", "French Open", "Wimbledon", "US Open",
]);
const MASTERS_1000_TOURNAMENTS = new Set([
  "Indian Wells", "Miami", "Monte Carlo", "Madrid Masters", "Rome Masters",
  "Madrid", "Rome", "Canada", "Toronto", "Montreal", "Cincinnati",
  "Shanghai", "Paris Masters", "Paris", "Bercy",
]);
// WTA combined 1000s — best 6 of 7 count, winner earns 1000 pts.
// docs/ranking-rules.md:390-397 lists exactly seven; Guadalajara is not one
// of them (it was a 1000 only in 2022 when it hosted the Finals).
const WTA_1000_COMBINED = new Set([
  "Indian Wells", "Miami", "Madrid", "Rome", "Canada", "Toronto", "Montreal",
  "Cincinnati", "Beijing",
]);
// WTA non-combined 1000s (best 1 of 3 separate slot) — winner earns 900 pts
const WTA_1000_NC = new Set(["Doha", "Dubai", "Wuhan"]);

function matchesAny(name: string, set: Set<string>): boolean {
  for (const t of set) if (name.includes(t)) return true;
  return false;
}

/**
 * Levels exactly as `api.wtatennis.com` states them.
 *
 * Preferred over the Tennis Abstract letters wherever available, because they
 * are unambiguous: TA's "P" covers both WTA 500 and WTA 250, so the letter
 * path has to guess the tier from the event name and gets it wrong for any
 * event missing from `WTA_500_TOURNAMENTS`. "WTA 1000" is deliberately absent
 * — combined (1000 pts) and non-combined (900 pts) still have to be split by
 * name.
 */
const WTA_API_EXACT_LEVELS: Record<string, Category> = {
  "Grand Slam": "wta_grand_slam",
  "WTA Finals": "finals",
  "WTA 500": "wta_500",
  "WTA 250": "wta_250",
  "WTA 125": "wta_125",
};

export function inferCategory(
  tour: "atp" | "wta",
  tournamentName: string,
  level: string | null,
): Category {
  if (tour === "wta" && level) {
    const exact = WTA_API_EXACT_LEVELS[level];
    if (exact) return exact;
    if (level === "WTA 1000") {
      return matchesAny(tournamentName, WTA_1000_NC) ? "wta_1000_nc" : "wta_1000";
    }
  }

  if (level === "F") return "finals";
  if (level === "D") return "davis_cup";
  if (level === "O") return "olympics";

  // Grand Slams: same events, different per-round points between tours.
  if (level === "G") return tour === "wta" ? "wta_grand_slam" : "grand_slam";
  if (matchesAny(tournamentName, GRAND_SLAMS)) return tour === "wta" ? "wta_grand_slam" : "grand_slam";

  if (tour === "atp") {
    if (level === "M") return "masters_1000";
    if (level === "C") return "ch_125";
    if (level === "A") {
      return matchesAny(tournamentName, ATP_500_TOURNAMENTS) ? "atp_500" : "atp_250";
    }
    // No tier letter — match by name. Masters 1000 → 500 → 250 priority.
    if (matchesAny(tournamentName, MASTERS_1000_TOURNAMENTS)) return "masters_1000";
    if (matchesAny(tournamentName, ATP_500_TOURNAMENTS)) return "atp_500";
    return "atp_250";
  }

  // WTA path
  if (level === "PM" || level === "M") {
    // Distinguish combined (1000 pts) from non-combined (900 pts) by name.
    return matchesAny(tournamentName, WTA_1000_NC) ? "wta_1000_nc" : "wta_1000";
  }
  // WTA 125s carry "125" in the event name on both feeds. Checked before the
  // tier letters because TA labels some of them "P"/"I", which would
  // otherwise land them on the 500/250 tables and double their value.
  if (matchesAny(tournamentName, WTA_125_MARKERS)) return "wta_125";
  if (level === "P") {
    return matchesAny(tournamentName, WTA_500_TOURNAMENTS) ? "wta_500" : "wta_250";
  }
  if (level === "I") return "wta_250";
  // TA reuses "C" across tours. On the ATP it is a Challenger; on the WTA the
  // nearest equivalent tier is the 125 series, not the men's CH125 table.
  if (level === "C") return "wta_125";
  if (level === "W") return "wta_250";
  // No tier letter — match by name. Non-combined 1000 → combined 1000 → 500 → 250.
  if (matchesAny(tournamentName, WTA_1000_NC)) return "wta_1000_nc";
  if (matchesAny(tournamentName, WTA_1000_COMBINED)) return "wta_1000";
  if (matchesAny(tournamentName, WTA_500_TOURNAMENTS)) return "wta_500";
  return "wta_250";
}
