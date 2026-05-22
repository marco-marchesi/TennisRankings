// Shared category-inference logic. Both `derive-live-state` (for current-week
// projections) and `derive-dropping-points` (for 52-weeks-ago dropping) need
// to map a tournament's Tennis Abstract `tourney_level` + name into our
// Category enum. We unify the logic here so they can't drift apart.

import type { Category } from "../config/points-table";

// ATP 500 events as of 2026. Tournaments at TA level "A" with names matching
// this set are 500-tier; otherwise 250.
const ATP_500_TOURNAMENTS = new Set([
  "Acapulco", "Barcelona", "Beijing", "Doha", "Dubai", "Halle", "Hamburg",
  "Queen's Club", "Rio de Janeiro", "Rotterdam", "Tokyo", "Vienna", "Washington",
]);

// WTA 500 events (the WTA "P" tier covers both 500 and the older 700-level
// events; we map both to wta_500 since the points structure is the same).
const WTA_500_TOURNAMENTS = new Set([
  "Stuttgart", "Charleston", "Strasbourg", "Berlin", "San Diego",
  "Tokyo", "Beijing", "Adelaide",
]);

// Used when the upstream feed doesn't supply a tier code (TennisExplorer
// gives us tournament name only — no "G"/"M"/"A"). We pin down Grand Slams
// and Masters 1000s / WTA 1000s by name before falling through to the 500
// list.
const GRAND_SLAMS = new Set([
  "Australian Open", "Roland Garros", "French Open", "Wimbledon", "US Open",
]);
const MASTERS_1000_TOURNAMENTS = new Set([
  "Indian Wells", "Miami", "Monte Carlo", "Madrid Masters", "Rome Masters",
  "Madrid", "Rome", "Canada", "Toronto", "Montreal", "Cincinnati",
  "Shanghai", "Paris Masters", "Paris", "Bercy",
]);
const WTA_1000_TOURNAMENTS = new Set([
  "Indian Wells", "Miami", "Madrid", "Rome", "Canada", "Toronto", "Montreal",
  "Cincinnati", "Wuhan", "Beijing", "Doha", "Dubai", "Guadalajara",
]);

function matchesAny(name: string, set: Set<string>): boolean {
  for (const t of set) if (name.includes(t)) return true;
  return false;
}

export function inferCategory(
  tour: "atp" | "wta",
  tournamentName: string,
  level: string | null,
): Category {
  // Grand Slams are universal across tours.
  if (level === "G") return "grand_slam";
  if (level === "F") return "finals";
  if (level === "D") return "davis_cup";
  if (level === "O") return "olympics";

  // Name-based pre-check: catches the case where the feed didn't supply a
  // tier code (TennisExplorer gives us tournament name only). We pin down
  // Slams + 1000s by name before falling through to the tier-letter logic.
  if (matchesAny(tournamentName, GRAND_SLAMS)) return "grand_slam";

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

  if (level === "PM") return "wta_1000";
  if (level === "M") return "wta_1000";
  if (level === "P") {
    return matchesAny(tournamentName, WTA_500_TOURNAMENTS) ? "wta_500" : "wta_250";
  }
  if (level === "I") return "wta_250";
  if (level === "C") return "ch_125";
  if (level === "W") return "wta_250";
  // No tier letter — match by name. 1000 → 500 → 250 priority.
  if (matchesAny(tournamentName, WTA_1000_TOURNAMENTS)) return "wta_1000";
  if (matchesAny(tournamentName, WTA_500_TOURNAMENTS)) return "wta_500";
  return "wta_250";
}
