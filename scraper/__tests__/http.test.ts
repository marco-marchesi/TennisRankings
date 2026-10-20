import { describe, it, expect, vi, afterEach } from "vitest";
import { politeFetch, ScraperHaltedError, isChallengePage } from "../http";

const fakeOk = (body = "ok") =>
  new Response(body, { status: 200, headers: { "Content-Type": "text/html" } });

describe("politeFetch", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    delete process.env.SCRAPER_KILL_SWITCH;
  });

  // The User-Agent is deliberately browser-shaped: atptour.com sits behind
  // Cloudflare, which 403s obvious bot strings. Identification is carried by
  // the X-Contact header instead, so that is what this asserts. (The previous
  // assertion expected /TennisRankingsBot/ in the UA and had been failing ever
  // since the UA was changed for the curl-fallback work.)
  it("identifies itself with a contact header", async () => {
    const spy = vi.spyOn(globalThis, "fetch").mockResolvedValue(fakeOk());
    await politeFetch("https://example.com/a");
    const init = spy.mock.calls[0]?.[1] as RequestInit;
    const headers = init.headers as Record<string, string>;
    expect(headers["X-Contact"]).toBeTruthy();
    expect(headers["User-Agent"]).toBeTruthy();
  });

  it("throws ScraperHaltedError when SCRAPER_KILL_SWITCH=true", async () => {
    process.env.SCRAPER_KILL_SWITCH = "true";
    await expect(politeFetch("https://example.com")).rejects.toThrow(ScraperHaltedError);
  });

  it("throws on non-2xx responses (excluding 304)", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("nope", { status: 500, statusText: "Internal" }),
    );
    await expect(politeFetch("https://example.com/err")).rejects.toThrow(/500/);
  });

  it("does not throw on 304 Not Modified (cache hit)", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 304 }));
    const res = await politeFetch("https://example.com/cached");
    expect(res.status).toBe(304);
  });

  it("rate-limits to ≥1s between requests to the same host", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(fakeOk());
    const start = Date.now();
    await politeFetch("https://throttle.test/a");
    await politeFetch("https://throttle.test/b");
    const elapsed = Date.now() - start;
    expect(elapsed).toBeGreaterThanOrEqual(900);
  });

  it("does not rate-limit across different hosts", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(fakeOk());
    const start = Date.now();
    await politeFetch("https://a.test/x");
    await politeFetch("https://b.test/x");
    const elapsed = Date.now() - start;
    expect(elapsed).toBeLessThan(900);
  });
});

/**
 * The curl fallback used to wrap ANY non-empty body in `new Response(body,
 * { status: 200 })`. A Cloudflare interstitial is a 200 with an HTML body, so
 * it reached the parser as a successful fetch and surfaced as a baffling
 * zero-rows parse rather than a fetch failure.
 */
describe("isChallengePage", () => {
  it("detects the standard Cloudflare interstitial", () => {
    expect(
      isChallengePage("<html><head><title>Just a moment...</title></head></html>"),
    ).toBe(true);
  });

  it("detects the challenge-platform script tag", () => {
    expect(
      isChallengePage(
        `<html><body><script src="/cdn-cgi/challenge-platform/h/b/orchestrate/jsch/v1"></script></body></html>`,
      ),
    ).toBe(true);
  });

  it("detects the cf_chl marker and the JS-required copy", () => {
    expect(isChallengePage("<div id=__cf_chl_tk></div>")).toBe(true);
    expect(isChallengePage("Enable JavaScript and cookies to continue")).toBe(true);
  });

  it("detects a short cloudflare-branded error body", () => {
    expect(isChallengePage("<html><body>Error 1020 · Cloudflare</body></html>")).toBe(true);
  });

  it("does not flag a real ranking page that merely mentions Cloudflare", () => {
    const realPage =
      `<html><body><table class="desktop-table">` +
      "<tr><td class=rank>1</td><td class=player>Jannik Sinner</td></tr>".repeat(200) +
      `</table><!-- cdn: cloudflare --></body></html>`;
    expect(realPage.length).toBeGreaterThan(2048);
    expect(isChallengePage(realPage)).toBe(false);
  });

  // Every real atptour.com and live-tennis.eu page carries Cloudflare's
  // passive bot-detection beacon, which also lives under
  // /cdn-cgi/challenge-platform/. Matching the bare path therefore flagged
  // EVERY genuine page as a challenge, so the curl fallback threw on good
  // content. Snippet verbatim from atptour.com/en/rankings/singles, 2026-09-21.
  it("does not flag a real page that carries the passive jsd beacon", () => {
    const beacon =
      `<script>(function(){function c(){var b=a.contentDocument||a.contentWindow.document;` +
      `if(b){var d=b.createElement('script');d.innerHTML="window.__CF$cv$params={r:'a3e91a8d8b46d0b3',` +
      `t:'MTc4OTk5NDA2Mg=='};var a=document.createElement('script');` +
      `a.src='/cdn-cgi/challenge-platform/scripts/jsd/main.js';` +
      `document.getElementsByTagName('head')[0].appendChild(a);";}}})();</script>`;
    const realPage =
      `<html><head><title>ATP Rankings | PIF ATP Rankings (Singles)</title></head><body>` +
      "<tr><td class=rank>1</td><td class=player>Jannik Sinner</td></tr>".repeat(200) +
      beacon +
      `</body></html>`;
    expect(isChallengePage(realPage)).toBe(false);
  });

  it("detects the interstitial's cf_chl_opt bootstrap", () => {
    expect(isChallengePage(`<script>window._cf_chl_opt={cvId:'3'}</script>`)).toBe(true);
  });

  it("does not flag ordinary short content", () => {
    expect(isChallengePage("<html><body><p>No results.</p></body></html>")).toBe(false);
  });
});
