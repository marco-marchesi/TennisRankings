// Past ATP Challenger tiers from Wikipedia's season pages.
//
// atptour.com's Challenger calendar lists the current season only, and the
// archive tags every Challenger "C" with no tier, so before 2026 the replay
// could not score a single Challenger result. "<YEAR> ATP Challenger Tour"
// on Wikipedia lists every edition, citing the ATP calendar:
//
//   |rowspan=6|January 6||rowspan=2|[[2025 Oeiras Indoors|Oeiras Indoors]]<br/>
//   [[Oeiras, Portugal|Oeiras]], Portugal <br/> Hard (i) – Challenger 75 – 32S/24Q/16D
//
// The week cell carries a rowspan, so a row without one belongs to the last
// week seen. Raw wikitext: https://en.wikipedia.org/w/index.php?title=<YEAR>_ATP_Challenger_Tour&action=raw
import { cityKey, type ChallengerEvent } from "./atp-challenger-calendar";

const MONTHS = [
  "january", "february", "march", "april", "may", "june", "july",
  "august", "september", "october", "november", "december",
];

// 80 / 90 / 110: the 2022 tiers.
const TIERS = new Set([50, 75, 80, 90, 100, 110, 125, 175]);

/** `[[a|b]]` -> b, `[[a]]` -> a, `{{...}}` and tags dropped. */
function plain(s: string): string {
  return s
    .replace(/\{\{[^}]*\}\}/g, "")
    .replace(/\[\[([^\]|]*)\|([^\]]*)\]\]/g, "$2")
    .replace(/\[\[([^\]]*)\]\]/g, "$1")
    .replace(/'''?/g, "")
    .replace(/<[^>]+>/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

const iso = (d: Date) => d.toISOString().slice(0, 10);

/**
 * Every edition on a season page's schedule. `season` is the page's year; a
 * December week listed before any other month opens the season and belongs to
 * the year before (2025's first week is "December 30" = 2024-12-30).
 */
export function parseWikiChallengerSeason(wikitext: string, season: number): ChallengerEvent[] {
  const out: ChallengerEvent[] = [];
  let week: string | null = null;
  let seenOtherMonth = false;
  for (const line of wikitext.split("\n")) {
    // Cancelled and other trailing sections reuse the row format.
    if (/^==[^=]/.test(line) && !/^==\s*Schedule\s*==/i.test(line)) {
      if (out.length > 0 || /cancel/i.test(line)) break;
    }
    const cells = line.split("||");
    const head = cells[0]!.match(/^\|(?:rowspan="?\d+"?\|)?\s*([A-Z][a-z]+) (\d{1,2})\s*$/);
    if (head) {
      const month = MONTHS.indexOf(head[1]!.toLowerCase());
      if (month >= 0) {
        if (month !== 11) seenOtherMonth = true;
        const year = month === 11 && !seenOtherMonth ? season - 1 : season;
        week = iso(new Date(Date.UTC(year, month, Number(head[2]))));
      }
    }
    const tierMatch = line.match(/– Challenger (\d+)\b/);
    if (!tierMatch || !week) continue;
    const tier = Number(tierMatch[1]);
    if (!TIERS.has(tier)) continue;
    // The tournament cell: name <br> City, Country <br> Surface – Challenger N.
    const cell = cells.find((c) => c.includes("– Challenger")) ?? line;
    const parts = cell.split(/<br\s*\/?>/i);
    const at = parts.findIndex((p) => /– Challenger \d+/.test(p));
    const place = at > 0 ? plain(parts[at - 1]!) : "";
    if (!place.includes(",")) continue;
    const city = cityKey(place.slice(0, place.lastIndexOf(",")));
    const end = new Date(`${week}T00:00:00Z`);
    end.setUTCDate(end.getUTCDate() + 6);
    out.push({ city, name: place, start: week, end: iso(end), tier: tier as ChallengerEvent["tier"] });
  }
  return out;
}
