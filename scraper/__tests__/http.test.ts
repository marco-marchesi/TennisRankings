import { describe, it, expect, vi, afterEach } from "vitest";
import { politeFetch, ScraperHaltedError } from "../http";

const fakeOk = (body = "ok") =>
  new Response(body, { status: 200, headers: { "Content-Type": "text/html" } });

describe("politeFetch", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    delete process.env.SCRAPER_KILL_SWITCH;
  });

  it("identifies the bot with a User-Agent header", async () => {
    const spy = vi.spyOn(globalThis, "fetch").mockResolvedValue(fakeOk());
    await politeFetch("https://example.com/a");
    const init = spy.mock.calls[0]?.[1] as RequestInit;
    expect((init.headers as Record<string, string>)["User-Agent"]).toMatch(/TennisRankingsBot/);
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
