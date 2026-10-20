// ATP Challenger calendar → the tier (50/75/100/125/175) of every event.
//
// WHY
//
// TennisExplorer, our only feed for Challenger results, names the event
// ("Bari challenger", "Genoa 2 challenger") but never states its tier.
// Category inference therefore fell through to its catch-all, `atp_250`, and a
// Challenger 50 title was credited 250 points. The tier is published on
// atptour.com's Challenger calendar, one entry per edition:
//
//   <span class="name">Bari, Italy</span> ... <span class="Date">28 September
//   - 4 October, 2026</span> ... <span class="">Challenger 50</span>
//
// Cities host several editions a year at DIFFERENT tiers (Genoa: 125 on
// 7-13 Sep, 75 on 21-27 Sep 2026), so lookups key on city AND date.

import * as cheerio from "cheerio";

/** 80 / 90 / 110 existed only in 2022 (2022_ATP_Challenger_Tour). */
export type ChallengerTier = 50 | 75 | 80 | 90 | 100 | 110 | 125 | 175;

export interface ChallengerEvent {
  /** Normalised city key ("saint tropez", "mouilleron le captif"). */
  city: string;
  /** Display name as listed ("Saint-Tropez, France"). */
  name: string;
  start: string; // ISO date
  end: string; // ISO date
  tier: ChallengerTier;
}

const MONTHS: Record<string, number> = {
  january: 1, february: 2, march: 3, april: 4, may: 5, june: 6, july: 7,
  august: 8, september: 9, october: 10, november: 11, december: 12,
};

export function cityKey(s: string): string {
  return s
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\bst\.?\s/g, "saint ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

const iso = (y: number, m: number, d: number) =>
  `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;

/**
 * "28 September - 4 October, 2026" | "7 - 13 September, 2026" |
 * "29 December, 2025 - 4 January, 2026" -> [start, end]
 */
export function parseDateRange(text: string): [string, string] | null {
  const t = text.replace(/\s+/g, " ").trim();
  const [a, b] = t.split(/\s+-\s+/);
  if (!a || !b) return null;
  const end = b.match(/^(\d{1,2}) ([A-Za-z]+),? (\d{4})$/);
  if (!end) return null;
  const endDay = Number(end[1]);
  const endMonth = MONTHS[end[2]!.toLowerCase()];
  const endYear = Number(end[3]);
  if (!endMonth) return null;
  const start = a.match(/^(\d{1,2})(?: ([A-Za-z]+))?,?(?: (\d{4}))?$/);
  if (!start) return null;
  const startDay = Number(start[1]);
  const startMonth = start[2] ? MONTHS[start[2].toLowerCase()] : endMonth;
  if (!startMonth) return null;
  const startYear = start[3] ? Number(start[3]) : startMonth > endMonth ? endYear - 1 : endYear;
  return [iso(startYear, startMonth, startDay), iso(endYear, endMonth, endDay)];
}

export function parseChallengerCalendar(html: string): ChallengerEvent[] {
  const $ = cheerio.load(html);
  const out: ChallengerEvent[] = [];
  $("li").each((_i, li) => {
    const $li = $(li);
    const name = $li.find("span.name").first().text().replace(/\s+/g, " ").trim();
    const date = $li.find("span.Date").first().text();
    // The category stamp's alt text ("Challenger Tour-125") is on EVERY entry;
    // the "Challenger 125" label in .mid-section is only rendered for current
    // and upcoming events, so past editions have none.
    const stamp = $li.find("img.events_banner").first().attr("alt") ?? "";
    const label = $li
      .find(".mid-section span")
      .toArray()
      .map((s) => $(s).text().trim())
      .find((x) => /^Challenger \d+$/.test(x));
    const tierText = stamp.match(/Challenger Tour-(\d+)/)?.[1] ?? label?.replace(/\D/g, "");
    if (!name || !date || !tierText) return;
    const tier = Number(tierText);
    if (![50, 75, 100, 125, 175].includes(tier)) return;
    const range = parseDateRange(date);
    if (!range) return;
    const city = cityKey(name.split(",")[0]!);
    out.push({ city, name, start: range[0], end: range[1], tier: tier as ChallengerEvent["tier"] });
  });
  return out;
}

/**
 * TennisExplorer's name for a Challenger -> its city key.
 * "Genoa 2 challenger" -> "genoa"; "St. Tropez challenger" -> "saint tropez";
 * "Mouilleron-Le-Captif challenger" -> "mouilleron le captif".
 */
export function teChallengerCity(teName: string): string {
  return cityKey(teName.replace(/\bchallenger\b/i, "").replace(/\s\d+\s*$/, "").trim());
}

const dayMs = 86_400_000;

/**
 * The tier of the Challenger TennisExplorer calls `teName`, played on
 * `playedOn`. Qualifying starts up to two days before the listed week, so the
 * window is widened by 3 days on the front and 1 on the back.
 */
export function challengerTier(
  events: ChallengerEvent[],
  teName: string,
  playedOn: string,
): ChallengerEvent["tier"] | null {
  const city = teChallengerCity(teName);
  const t = Date.parse(playedOn);
  const hits = events.filter(
    (e) =>
      e.city === city &&
      t >= Date.parse(e.start) - 3 * dayMs &&
      t <= Date.parse(e.end) + 1 * dayMs,
  );
  const tiers = [...new Set(hits.map((h) => h.tier))];
  return tiers.length === 1 ? tiers[0]! : null;
}

/**
 * The tier of the edition in `name`'s city whose week starts within 3 days of
 * `weekStart` — for the archive, whose `tourney_date` is the event's week.
 * `challengerTier` widens its window past the event's end for TennisExplorer
 * match dates, which makes a city's back-to-back editions (Oeiras 1 ending
 * Sunday 12 Jan, Oeiras 2 starting Monday 13 Jan) ambiguous.
 */
export function challengerTierForWeek(
  events: ChallengerEvent[],
  name: string,
  weekStart: string,
): ChallengerEvent["tier"] | null {
  const city = teChallengerCity(name);
  const t = Date.parse(weekStart);
  const hits = events.filter((e) => e.city === city && Math.abs(Date.parse(e.start) - t) <= 3 * dayMs);
  const tiers = [...new Set(hits.map((h) => h.tier))];
  return tiers.length === 1 ? tiers[0]! : null;
}

// ─── persistence ──────────────────────────────────────────────────────────
//
// The calendar is fetched by `pnpm scraper:challenger-calendar` (Weekly-Update
// runs it) and committed as JSON, so scoring never depends on a live request
// to a Cloudflare-fronted site succeeding at the moment a match is written.

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

export const CALENDAR_PATH = resolve(import.meta.dirname, "../config/challenger-calendar.json");

let cached: ChallengerEvent[] | null = null;

export function loadChallengerEvents(): ChallengerEvent[] {
  if (cached) return cached;
  cached = existsSync(CALENDAR_PATH)
    ? (JSON.parse(readFileSync(CALENDAR_PATH, "utf8")) as ChallengerEvent[])
    : [];
  return cached;
}

export async function fetchChallengerCalendar(): Promise<ChallengerEvent[]> {
  const { withPage, gotoPastChallenge } = await import("../browser");
  const html = await withPage(async (page) => {
    await gotoPastChallenge(page, "https://www.atptour.com/en/atp-challenger-tour/calendar");
    await page.waitForSelector("img.events_banner", { timeout: 30_000 }).catch(() => {});
    return page.content();
  });
  const events = parseChallengerCalendar(html);
  if (events.length < 100) {
    throw new Error(`challenger calendar: parsed only ${events.length} events from ${html.length} bytes`);
  }
  return events;
}

/** Merge a fresh fetch into the stored file (keeps past years), then save. */
export function saveChallengerEvents(fresh: ChallengerEvent[]): number {
  const key = (e: ChallengerEvent) => `${e.city}|${e.start}`;
  const merged = new Map(loadChallengerEvents().map((e) => [key(e), e]));
  for (const e of fresh) merged.set(key(e), e);
  const all = [...merged.values()].sort((a, b) => a.start.localeCompare(b.start));
  writeFileSync(CALENDAR_PATH, JSON.stringify(all, null, 1) + "\n", "utf8");
  cached = all;
  return all.length;
}
