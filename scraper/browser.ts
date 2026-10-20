// One place to launch the headless browser every Cloudflare-fronted source
// (atptour.com rankings + results, live-tennis.eu) goes through.
//
// WHY SYSTEM CHROME FIRST
//
// Playwright's bundled Chromium is fingerprinted by Cloudflare's managed
// challenge on atptour.com: the "Just a moment..." interstitial never clears,
// however long we wait (verified 2026-09-29: 60 s, twelve polls, no change).
// That is what silently lost the ATP rankings for the weeks of 2026-09-14 and
// 2026-09-28 — the page parsed to 0 rows, the zod floor rejected it, and
// refresh.ts returned without recording anything.
//
// The locally installed Google Chrome (`channel: "chrome"`), also headless,
// passes on the first request. So we try it first and fall back to the
// bundled build only when Chrome is not installed (CI, a fresh machine).
//
// WHY WE DETECT THE CHALLENGE HERE
//
// A challenge page is an HTTP 200 with an HTML body, so to every caller it
// looked like a successful fetch that happened to contain no data. The
// resulting errors ("parsed 0 matches from 237327 bytes ... or the markup
// changed") pointed at the parser, not at the fetch. `gotoPastChallenge`
// waits a bounded time for the interstitial to clear and otherwise throws
// CloudflareChallengeError, so the failure names its real cause.

import type { Browser, BrowserContext, Page } from "@playwright/test";
import { CloudflareChallengeError, isChallengePage } from "./http";

const DEFAULT_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

export async function launchBrowser(): Promise<Browser> {
  const { chromium } = await import("@playwright/test");
  const channel = process.env.SCRAPER_BROWSER_CHANNEL ?? "chrome";
  if (channel !== "bundled") {
    try {
      return await chromium.launch({ headless: true, channel });
    } catch (err) {
      console.warn(
        `[browser] channel "${channel}" unavailable (${err instanceof Error ? err.message.split("\n")[0] : err}); ` +
          `falling back to bundled Chromium, which Cloudflare often blocks`,
      );
    }
  }
  return chromium.launch({ headless: true });
}

export async function newScraperContext(
  browser: Browser,
  opts: { width?: number; height?: number } = {},
): Promise<BrowserContext> {
  return browser.newContext({
    userAgent: DEFAULT_UA,
    viewport: { width: opts.width ?? 1280, height: opts.height ?? 900 },
    locale: "en-US",
  });
}

/**
 * Navigate and wait until the anti-bot interstitial (if any) has cleared.
 * Throws CloudflareChallengeError when it has not cleared within `maxWaitMs`.
 */
export async function gotoPastChallenge(
  page: Page,
  url: string,
  opts: { timeoutMs?: number; maxWaitMs?: number } = {},
): Promise<void> {
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: opts.timeoutMs ?? 60_000 });
  const deadline = Date.now() + (opts.maxWaitMs ?? 30_000);
  for (;;) {
    const html = await page.content().catch(() => "");
    if (html && !isChallengePage(html)) return;
    if (Date.now() > deadline) throw new CloudflareChallengeError(url);
    await page.waitForTimeout(2_000);
  }
}

/** Launch, open one page, run `fn`, always close. */
export async function withPage<T>(
  fn: (page: Page) => Promise<T>,
  opts: { width?: number; height?: number } = {},
): Promise<T> {
  const browser = await launchBrowser();
  try {
    const ctx = await newScraperContext(browser, opts);
    const page = await ctx.newPage();
    return await fn(page);
  } finally {
    await browser.close();
  }
}
