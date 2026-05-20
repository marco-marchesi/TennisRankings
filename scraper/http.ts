// Polite fetch wrapper. Identifies the bot, rate-limits per host, and
// honours an env kill-switch.

const lastHit = new Map<string, number>();
const MIN_INTERVAL_MS = 1000;

const userAgent =
  process.env.SCRAPER_USER_AGENT ??
  "TennisRankingsBot/0.1 (+https://tennisrankings.example/bot)";

export class ScraperHaltedError extends Error {
  constructor() {
    super("Scraper halted via SCRAPER_KILL_SWITCH");
    this.name = "ScraperHaltedError";
  }
}

export async function politeFetch(url: string, init: RequestInit = {}): Promise<Response> {
  if (process.env.SCRAPER_KILL_SWITCH === "true") throw new ScraperHaltedError();

  const host = new URL(url).host;
  const last = lastHit.get(host) ?? 0;
  const wait = Math.max(0, MIN_INTERVAL_MS - (Date.now() - last));
  if (wait > 0) await sleep(wait);

  const res = await fetch(url, {
    ...init,
    headers: {
      "User-Agent": userAgent,
      Accept: "text/html, application/json;q=0.9, */*;q=0.5",
      ...(init.headers ?? {}),
    },
  });

  lastHit.set(host, Date.now());

  if (!res.ok && res.status !== 304) {
    throw new Error(`Fetch failed: ${url} → ${res.status} ${res.statusText}`);
  }
  return res;
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
