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

  if (tour === "atp") {
    // ATP Tennis Abstract levels: A=tour, M=Masters, C=Challenger.
    if (level === "M") return "masters_1000";
    if (level === "C") return "ch_125"; // TODO: distinguish tiers when draw_size is captured
    if (level === "A") {
      return [...ATP_500_TOURNAMENTS].some((t) => tournamentName.includes(t))
        ? "atp_500"
        : "atp_250";
    }
    return "atp_250";
  }

  // WTA Tennis Abstract levels: PM=Premier Mandatory (1000), P=Premier
  // (500/700), I=International (250), C=Challenger, W=some legacy mini-tier.
  if (level === "PM") return "wta_1000";
  if (level === "M") return "wta_1000"; // some files use "M" interchangeably
  if (level === "P") {
    return [...WTA_500_TOURNAMENTS].some((t) => tournamentName.includes(t))
      ? "wta_500"
      : "wta_250";
  }
  if (level === "I") return "wta_250";
  if (level === "C") return "ch_125";
  if (level === "W") return "wta_250"; // legacy WTA "international plus" — treat as 250
  return "wta_250";
}
