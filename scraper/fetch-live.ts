// Headless-browser fetcher for the validation pipeline. NOT used by the
// production scraper — that one uses politeFetch with the bot UA. This
// exists so devs can capture real, JS-rendered HTML locally to validate
// the parser against the actual current page structure.

import { chromium, type Browser, type Page } from "@playwright/test";
import { writeFileSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";

const DEBUG_DIR = resolve(import.meta.dirname, "__debug__");

interface SourceConfig {
  url: string;
  // Optional: page actions to take after initial load (e.g. click "Load More"
  // to expand a lazy-paginated list). Returns when the page has the desired
  // row count or no more rows can be loaded.
  expandRows?: (page: Page) => Promise<void>;
}

// Shared WTA load-more expander — both the rankings and race pages paginate
// at 50/page with the same `js-load-more` button.
const expandWtaRows = async (page: Page) => {
  const targetRows = 100;
  const maxAttempts = 8;
  let lastCount = await page.locator("tr.player-row").count();
  for (let i = 0; i < maxAttempts; i++) {
    if (lastCount >= targetRows) return;
    const button = page.locator("button.js-load-more").first();
    if (!(await button.isVisible().catch(() => false))) return;
    await button.click().catch(() => {});
    try {
      await page.waitForFunction(
        (n) => document.querySelectorAll("tr.player-row").length > n,
        lastCount,
        { timeout: 8_000 },
      );
    } catch {
      return;
    }
    lastCount = await page.locator("tr.player-row").count();
  }
};

const SOURCES: Record<string, SourceConfig> = {
  atp: {
    url: "https://www.atptour.com/en/rankings/singles",
    // ATP returns the full top-100 in initial HTML — no expansion needed.
  },
  wta: {
    url: "https://www.wtatennis.com/rankings/singles",
    expandRows: expandWtaRows,
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
    browser = await chromium.launch({ headless: true });
    const ctx = await browser.newContext({
      userAgent:
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      viewport: { width: 1280, height: 800 },
      locale: "en-US",
    });
    const page = await ctx.newPage();
    await page.goto(source.url, { waitUntil: "domcontentloaded", timeout: 45_000 });
    await page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => {});

    if (source.expandRows) {
      console.log(`[fetch-live] ${tour}: expanding paginated rows...`);
      await source.expandRows(page);
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
