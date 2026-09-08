/**
 * live-tennis.eu reader.
 *
 * Extracted from `scraper/__tests__/source-truth.live.test.ts`, where it was
 * defined privately and could not be reused. It is an INDEPENDENT third party:
 * it publishes the official ATP/WTA rankings, the calendar-year races, and its
 * own continuously-updated live ranking. That makes it the natural oracle for
 * "is our stored top-200 actually right", because it did not come from the
 * same scrape path we are checking.
 *
 * Pages we read:
 *   /en/official-atp-ranking   /en/official-wta-ranking
 *   /en/atp-race               /en/wta-race
 *   /en/atp-live-ranking       /en/wta-live-ranking
 */
import { politeFetch, ScraperHaltedError } from "../http";

export type LtPageKind = "official" | "race" | "live";

export interface LiveTennisRow {
  rank: number;
  fullName: string;
  /** Slugified name, for comparison against `players.slug`. */
  slugCandidate: string;
  /**
   * Net rank change vs the previous published ranking. Positive = improved.
   * Null when LT renders "CH"/"NCH" (career high) instead of a number.
   */
  rankChange: number | null;
  /** Current points, or year-to-date points on a race page. */
  points: number | null;
  /** Projected total once the current tournament finishes (live page only). */
  nextPoints: number | null;
  /** Max possible if the player wins out (live page only). */
  maxPoints: number | null;
}

export function ltPath(tour: "atp" | "wta", kind: LtPageKind): string {
  if (kind === "official") return `/en/official-${tour}-ranking`;
  if (kind === "race") return `/en/${tour}-race`;
  return `/en/${tour}-live-ranking`;
}

function readInt(s: string | undefined): number | null {
  if (!s) return null;
  const n = Number(s.replace(/[,\s]/g, ""));
  return Number.isFinite(n) ? n : null;
}

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&nbsp;/g, " ")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)));
}

function extractCellTexts(rowHtml: string): string[] {
  const out: string[] = [];
  const cellRe = /<td[^>]*>([\s\S]*?)<\/td>/g;
  let m: RegExpExecArray | null;
  while ((m = cellRe.exec(rowHtml)) !== null) {
    const inner = m[1]!.replace(/<[^>]+>/g, "");
    out.push(decodeEntities(inner).replace(/\s+/g, " ").trim());
  }
  return out;
}

/**
 * Characters NFD does NOT decompose, because they are distinct letters rather
 * than a base plus a combining diacritic. Sources disagree on how to render
 * them: live-tennis.eu keeps the letter ("Elmer Moller" spelt with o-slash,
 * "Joel Schwarzler" with a-umlaut) while the official feeds transliterate
 * (Moller, Schwaerzler). Both forms are produced and compared.
 */
const LETTER_FOLD: Array<[RegExp, string, string]> = [
  [/ø/g, "o", "oe"],
  [/æ/g, "ae", "ae"],
  [/å/g, "a", "aa"],
  [/ä/g, "a", "ae"],
  [/ö/g, "o", "oe"],
  [/ü/g, "u", "ue"],
  [/ß/g, "ss", "ss"],
  [/đ|ð/g, "d", "d"],
  [/ł/g, "l", "l"],
  [/ı/g, "i", "i"],
];

function fold(name: string, variant: 0 | 1): string {
  let out = name.toLowerCase();
  for (const [re, short, long] of LETTER_FOLD) {
    out = out.replace(re, variant === 0 ? short : long);
  }
  return out
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    // Apostrophes JOIN rather than separate: "O'Connell" is one token, so
    // treating the apostrophe as a delimiter produced {o, connell} against
    // {oconnell} and failed to match.
    .replace(/['’`]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/**
 * Order-insensitive, accent-insensitive slug. Comparison only, never storage.
 *
 * `sortTokens` exists because name ORDER is exactly what goes wrong across
 * sources: TennisExplorer renders "Cerundolo Juan Manuel" while the official
 * feed says "Juan Manuel Cerundolo". Sorting the tokens makes those equal.
 */
export function comparisonSlug(name: string, sortTokens = false): string {
  const tokens = fold(name, 0).split(/\s+/).filter(Boolean);
  return (sortTokens ? tokens.slice().sort() : tokens).join("-");
}

function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  const prev = new Array<number>(b.length + 1);
  const cur = new Array<number>(b.length + 1);
  for (let j = 0; j <= b.length; j++) prev[j] = j;
  for (let i = 1; i <= a.length; i++) {
    cur[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      cur[j] = Math.min(prev[j]! + 1, cur[j - 1]! + 1, prev[j - 1]! + cost);
    }
    for (let j = 0; j <= b.length; j++) prev[j] = cur[j]!;
  }
  return prev[b.length]!;
}

/**
 * Do two renderings name the same player?
 *
 * Deliberately tolerant, because every real mismatch found while comparing
 * our snapshot against live-tennis.eu was a spelling difference rather than a
 * wrong person:
 *
 *   token order      "Cerundolo Juan Manuel"  vs "Juan Manuel Cerundolo"
 *   extra given name "Tomas Barrios Vera"     vs "Tomas Barrios Vera Marcelo"
 *   token splitting  "Soonwoo Kwon"           vs "Soon Woo Kwon"
 *   apostrophes      "O'Connell"              vs "Oconnell"
 *   letter folding   "Moller" (o-slash)       vs "Moller"
 *   transliteration  "Liudmila Samsonova"     vs "Ludmilla Samsonova"
 *
 * It stays strict enough to separate different people: the fuzzy branch needs
 * the same first letter and a small edit distance relative to length.
 */
export function namesMatch(
  a: string,
  b: string,
  opts: { fuzzy?: boolean } = {},
): boolean {
  // fuzzy defaults ON for measurement, and must be turned OFF for anything
  // that MUTATES data.
  //
  // The edit-distance branch paired "Ekaterina Maklakova" with "Ekaterina
  // Makarova" — two different players, two characters apart. Counting a row
  // as correct on that basis is a small measurement error; merging their
  // records, or attaching a ranking row to the wrong person, is data loss.
  // So callers that write pass { fuzzy: false } and get only the branches
  // that are provably the same person: identical token sets in a different
  // order, and identical tokens split differently.
  const fuzzy = opts.fuzzy ?? true;
  for (const variant of [0, 1] as const) {
    const ta = fold(a, variant).split(/\s+/).filter(Boolean);
    const tb = fold(b, variant).split(/\s+/).filter(Boolean);
    if (ta.length === 0 || tb.length === 0) continue;

    // 1. Same tokens in any order.
    const sa = ta.slice().sort().join("-");
    const sb = tb.slice().sort().join("-");
    if (sa === sb) return true;

    // 2. Token splitting differences. Compared BOTH sorted and in original
    //    order, because sorting first can separate names that only differ in
    //    where the spaces fall: "Yeon Woo Ku" sorts to ku|woo|yeon while
    //    "Yeonwoo Ku" sorts to ku|yeonwoo, but in original order both join to
    //    "yeonwooku".
    const ja = ta.slice().sort().join("");
    const jb = tb.slice().sort().join("");
    if (ja === jb) return true;
    if (ta.join("") === tb.join("")) return true;

    // 3. One name carries extra given names. Require at least two shared
    //    tokens so a shared surname alone is never enough. Still only a
    //    strong hint, not proof — "Maria Gonzalez" and "Maria Gonzalez
    //    Daniele" may be two people — so this is measurement-only as well.
    if (fuzzy) {
      const setA = new Set(ta);
      const setB = new Set(tb);
      const shared = [...setA].filter((t) => setB.has(t));
      if (shared.length >= 2 && (shared.length === setA.size || shared.length === setB.size)) {
        return true;
      }
    }

    // 4. Transliteration. Measurement only — see the note above.
    //
    // Requires an EXACTLY shared token (in practice the surname) plus an edit
    // distance of at most 2. The earlier rule allowed distance 3 scaled by
    // name length, which paired "Arthur Fery" with "Arthur Fils" and
    // "Arthur Gea" with "Arthur Fery" — three real players, cross-matched.
    // That is worse than failing to match: it attributes one player's points
    // to another and manufactures enormous phantom discrepancies (+1737).
    //
    // Still catches the genuine transliterations, which differ in spelling
    // but share a token exactly:
    //   "Liudmila Samsonova"    / "Ludmilla Samsonova"    (samsonova)
    //   "Yuliia Starodubtseva"  / "Yulia Starodubtseva"   (starodubtseva)
    if (fuzzy) {
      // The SURNAME must match exactly; only given names may vary.
      //
      // This branch reaches only names already in "Given ... Surname" order
      // (rotations are handled by branches 1-3), so the surname is the last
      // token. Which token differs is the whole question:
      //   "Liudmila Samsonova"  / "Ludmilla Samsonova"  — same surname,
      //       spelling variant of the given name          → same player
      //   "Ekaterina Maklakova" / "Ekaterina Makarova"  — same given name,
      //       DIFFERENT surname 2 edits apart              → two players
      //
      // Anchoring on "longest token" failed here, because "ekaterina" and
      // "maklakova" are both 9 characters and the tie-break picked the given
      // name for both sides.
      const lastA = ta[ta.length - 1]!;
      const lastB = tb[tb.length - 1]!;
      if (lastA === lastB && levenshtein(ja, jb) <= 2) return true;
    }
  }
  return false;
}

export function parseLiveTennisHtml(html: string): LiveTennisRow[] {
  // One chunk per `<tr class="XXX …">` data row — the 3-letter country code
  // class is what distinguishes data rows from the page chrome.
  const rowRe = /<tr class="[A-Z]{3}[^"]*">([\s\S]*?)<\/tr>/g;
  const out: LiveTennisRow[] = [];
  let rowMatch: RegExpExecArray | null;
  while ((rowMatch = rowRe.exec(html)) !== null) {
    const rowHtml = rowMatch[1]!;

    // Class attributes are QUOTED as of 2026-09 (`class="rk"`). They were
    // unquoted when this parser was written (`class=rk`), so every regex
    // matched nothing and the whole page yielded zero rows. Accept both.
    const rank = readInt(rowHtml.match(/class="?rk"?[^>]*>(\d+)</)?.[1]);
    const rawName = rowHtml.match(/class="?pn"?[^>]*>([^<]+)</)?.[1];
    if (rank === null || !rawName) continue;
    const fullName = decodeEntities(rawName.trim());

    // Rank change, where present. Rendered as a nested span/div carrying an
    // up/down class.
    let rankChange: number | null = null;
    const upMatch = rowHtml.match(/class="?(?:ich|up)"?[^>]*>(\d+)</);
    const downMatch = rowHtml.match(/class="?(?:dch|down)"?[^>]*>(\d+)</);
    if (upMatch) rankChange = Number(upMatch[1]);
    else if (downMatch) rankChange = -Number(downMatch[1]);

    // Points are located STRUCTURALLY rather than by cell index: find the
    // country cell (a bare 3-letter code) and take the first pure-integer
    // cell after it. Index-based lookup broke as soon as LT added or removed
    // a column, and it differed between the official, race and live layouts.
    const cells = extractCellTexts(rowHtml);
    const countryIdx = cells.findIndex((c) => /^[A-Z]{3}$/.test(c));
    const searchFrom = countryIdx >= 0 ? countryIdx + 1 : 0;
    const numericAfter: Array<{ idx: number; val: number }> = [];
    for (let i = searchFrom; i < cells.length; i++) {
      if (/^\d+$/.test(cells[i]!)) numericAfter.push({ idx: i, val: Number(cells[i]!) });
    }
    const points = numericAfter.length > 0 ? numericAfter[0]!.val : null;
    // Any further numeric cells are the projection columns, when shown.
    const rest = numericAfter.slice(1).map((n) => n.val);
    const nextPoints = rest.length >= 1 ? rest[0]! : null;
    const maxPoints = rest.length >= 2 ? rest[1]! : null;

    out.push({
      rank,
      fullName,
      slugCandidate: comparisonSlug(fullName),
      rankChange,
      points,
      nextPoints,
      maxPoints,
    });
  }
  return out;
}

/**
 * Headless-browser fetch. As of 2026-09 live-tennis.eu serves a Cloudflare
 * interstitial even to curl, so the politeFetch path below cannot reach it.
 * A real browser solves the challenge.
 *
 * Kept separate and used only as a fallback, because launching Chromium is
 * far heavier than an HTTP GET.
 */
async function fetchViaBrowser(path: string): Promise<string> {
  const { chromium } = await import("@playwright/test");
  const browser = await chromium.launch({ headless: true });
  try {
    const ctx = await browser.newContext({
      userAgent:
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
        "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      viewport: { width: 1280, height: 900 },
      locale: "en-US",
    });
    const page = await ctx.newPage();
    await page.goto(`https://live-tennis.eu${path}`, {
      waitUntil: "domcontentloaded",
      timeout: 60_000,
    });
    // The table is server-rendered; waiting for a data row also gives the
    // Cloudflare check time to clear.
    await page.waitForSelector("td.rk", { timeout: 45_000 }).catch(() => {});
    return await page.content();
  } finally {
    await browser.close();
  }
}

/**
 * live-tennis.eu sits behind Cloudflare and rejects a plain Node fetch on TLS
 * fingerprint regardless of User-Agent. We try politeFetch (whose curl
 * fallback used to be enough) and fall back to a real browser when a
 * challenge page comes back.
 */
export async function fetchLiveTennis(path: string): Promise<LiveTennisRow[]> {
  let html: string;
  try {
    const res = await politeFetch(`https://live-tennis.eu${path}`);
    html = await res.text();
    if (parseLiveTennisHtml(html).length === 0) {
      html = await fetchViaBrowser(path);
    }
  } catch (err) {
    if (err instanceof ScraperHaltedError) throw err;
    html = await fetchViaBrowser(path);
  }

  const rows = parseLiveTennisHtml(html);
  if (rows.length === 0) {
    throw new Error(
      `live-tennis.eu${path}: parsed 0 rows from ${html.length} bytes — ` +
        `the page layout has probably changed, or the anti-bot check was not ` +
        `cleared even by a real browser`,
    );
  }
  return rows;
}
