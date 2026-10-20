// Headless-browser fetcher for the validation pipeline. NOT used by the
// production scraper — that one uses politeFetch with the bot UA. This
// exists so devs can capture real, JS-rendered HTML locally to validate
// the parser against the actual current page structure.

import type { Browser, Page } from "@playwright/test";
import { gotoPastChallenge, launchBrowser, newScraperContext } from "./browser";
import { writeFileSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";

const DEBUG_DIR = resolve(import.meta.dirname, "__debug__");

interface SourceConfig {
  url: string;
  // Optional: page actions to take after initial load (e.g. click "Load More"
  // to expand a lazy-paginated list). Returns when the page has the desired
  // row count or no more rows can be loaded.
  /** Returns the row count reached, so the caller can log/assert it. */
  expandRows?: (page: Page) => Promise<number>;
}

// Shared WTA load-more expander — both the rankings and race pages paginate
// at 50 rows per page behind the same `js-load-more` button.
//
// Why this does not use locator.click():
//
// The button renders around y=8020 on a 900px-tall viewport, and the page
// keeps reflowing while lazy images resolve. Playwright's click performs
// actionability checks — including waiting for the element to be positionally
// STABLE — and on this page it never settles, so the click times out. The
// original code wrote `await button.click().catch(() => {})`, swallowing that
// timeout, then fell out of the loop and returned 50 rows. Both WTA sources
// therefore parsed exactly 50 entries, the zod floor of 100 rejected the
// snapshot, and no WTA rankings had been written since 2026-05.
//
// `el.click()` inside evaluate() invokes the site's own handler directly with
// no hit-testing and no stability requirement, which is what we actually want:
// we are not simulating a user, we are asking the page for more rows.
const expandWtaRows = async (page: Page, targetRows = 200) => {
  // Each click yields ~50 rows; allow a couple of spare attempts.
  const maxAttempts = Math.ceil(targetRows / 50) + 3;
  let lastCount = await page.locator("tr.player-row").count();

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    if (lastCount >= targetRows) break;

    const button = page.locator("button.js-load-more").first();
    if ((await button.count()) === 0) {
      console.warn(`[fetch-live] no js-load-more button; stopping at ${lastCount} rows`);
      break;
    }
    if (!(await button.isVisible().catch(() => false))) {
      console.warn(`[fetch-live] js-load-more not visible; stopping at ${lastCount} rows`);
      break;
    }

    // Bring the button into view so any lazy content below it resolves, then
    // fire the handler directly.
    await button.evaluate((el) => {
      el.scrollIntoView({ block: "center" });
      (el as HTMLElement).click();
    });

    try {
      await page.waitForFunction(
        (n) => document.querySelectorAll("tr.player-row").length > n,
        lastCount,
        { timeout: 15_000 },
      );
    } catch {
      console.warn(
        `[fetch-live] row count stuck at ${lastCount} after attempt ${attempt}; ` +
          `the list is probably exhausted`,
      );
      break;
    }

    const next = await page.locator("tr.player-row").count();
    console.log(`[fetch-live] expanded ${lastCount} → ${next} rows`);
    lastCount = next;
  }

  // Surfaced so the caller can log it and so a regression is visible in the
  // pipeline output rather than only in a rejected snapshot.
  return lastCount;
};

const SOURCES: Record<string, SourceConfig> = {
  atp: {
    // rankRange pulls the OFFICIAL list well past the default top 100, with
    // the same Dropping / Next Best columns. Ranks 101+ used to come from
    // TennisExplorer instead, which was a week stale on some rows (Hugo
    // Dellien 122 pts where ATP published 460) and carried no dropping at
    // all — so every ATP player ranked 101-200 was projected to drop nothing.
    url: "https://www.atptour.com/en/rankings/singles?rankRange=1-500",
  },
  wta: {
    url: "https://www.wtatennis.com/rankings/singles",
    // 500, matching the ATP depth, so TennisExplorer only ever fills ranks
    // beyond the official list (see expand-rankings.ts).
    expandRows: (page) => expandWtaRows(page, 500),
  },
  // ATP Race to the Finals — calendar-year points (resets every January).
  // Same HTML structure as the regular rankings page.
  "atp-race": {
    url: "https://www.atptour.com/en/rankings/singles-race-to-turin",
  },
  // WTA Race tracks year-to-date points toward the WTA Finals. The path
  // changed in 2024; if this 404s again, the canonical destination can be
  // found by clicking "Race" tab on https://www.wtatennis.com/rankings/singles
  "wta-race": {
    url: "https://www.wtatennis.com/rankings/race-singles",
    expandRows: expandWtaRows,
  },
};

export type Tour = keyof typeof SOURCES;

export async function fetchLive(tour: Tour): Promise<{ html: string; savedTo: string }> {
  mkdirSync(DEBUG_DIR, { recursive: true });
  const source = SOURCES[tour];
  if (!source) throw new Error(`Unknown tour: ${tour}`);

  console.log(`[fetch-live] launching Chromium for ${tour} → ${source.url}`);

  let browser: Browser | undefined;
  try {
    browser = await launchBrowser();
    const ctx = await newScraperContext(browser, { width: 1280, height: 800 });
    const page = await ctx.newPage();
    // Throws CloudflareChallengeError rather than handing the interstitial to
    // the parser, where it used to become a silent 0-row parse.
    await gotoPastChallenge(page, source.url, { timeoutMs: 45_000 });
    await page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => {});

    if (source.expandRows) {
      console.log(`[fetch-live] ${tour}: expanding paginated rows...`);
      const rows = await source.expandRows(page);
      console.log(`[fetch-live] ${tour}: ${rows} player rows after expansion`);
    }

    const html = await page.content();
    const fileName = `${tour}-${new Date().toISOString().slice(0, 10)}.html`;
    const savedTo = resolve(DEBUG_DIR, fileName);
    writeFileSync(savedTo, html, "utf-8");
    console.log(`[fetch-live] ${tour}: ${(html.length / 1024).toFixed(1)} KB → ${fileName}`);
    return { html, savedTo };
  } finally {
    await browser?.close();
  }
}
