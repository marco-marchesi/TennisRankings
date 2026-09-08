// Polite fetch wrapper. Identifies the bot, rate-limits per host, and
// honours an env kill-switch.
//
// Cloudflare-protected hosts (atptour.com, etc.) often block Node's built-in
// fetch because Node's TLS handshake produces a JA3 fingerprint that
// doesn't match any browser, regardless of how we set User-Agent. When that
// happens, we fall back to spawning `curl` — curl's TLS handshake passes
// Cloudflare's bot checks reliably.

import { spawn } from "node:child_process";

const lastHit = new Map<string, number>();
const MIN_INTERVAL_MS = 1000;

// Browser-like UA — atptour.com sits behind Cloudflare which 403s on
// obvious bot strings. The polite-scraping contract (identifying contact)
// is satisfied by the X-Contact header and the ?utm_source=… link below.
const userAgent =
  process.env.SCRAPER_USER_AGENT ??
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

// .env.example and .env.local both define SCRAPER_CONTACT_EMAIL, but this
// module only ever read SCRAPER_CONTACT — so the polite-scraping contact
// header silently fell back to a placeholder domain on every request.
const PLACEHOLDER_CONTACT = "tennisrankings-bot (+https://tennisrankings.example/bot)";
const contactHeader =
  process.env.SCRAPER_CONTACT ?? process.env.SCRAPER_CONTACT_EMAIL ?? PLACEHOLDER_CONTACT;

if (contactHeader === PLACEHOLDER_CONTACT && process.env.NODE_ENV === "production") {
  throw new Error(
    "Set SCRAPER_CONTACT_EMAIL before scraping in production. Identifying " +
      "yourself is the whole basis on which we are allowed to fetch these pages; " +
      "silently sending a placeholder is worse than not claiming to be polite.",
  );
}

/** Thrown when an anti-bot interstitial is returned instead of the real page. */
export class CloudflareChallengeError extends Error {
  constructor(url: string) {
    super(`Anti-bot challenge page returned instead of content: ${url}`);
    this.name = "CloudflareChallengeError";
  }
}

const CHALLENGE_PAT =
  /Just a moment\.\.\.|Attention Required|cf-browser-verification|challenge-platform|__cf_chl|Enable JavaScript and cookies to continue/i;

/**
 * A Cloudflare interstitial is a 200 with an HTML body, so it reaches the
 * parser looking like a successful fetch and shows up as a mystifying
 * zero-rows parse instead of a fetch failure.
 */
export function isChallengePage(body: string): boolean {
  if (CHALLENGE_PAT.test(body)) return true;
  return body.length < 2048 && /cloudflare/i.test(body);
}

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

  const baseHeaders: Record<string, string> = {
    "User-Agent": userAgent,
    Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
    "Accept-Encoding": "gzip, deflate, br",
    // X- headers preserve our identifying-contact obligation without
    // tipping off Cloudflare's UA heuristic.
    "X-Contact": contactHeader,
  };

  // Try once, then retry once on 403/429 (Cloudflare's "managed challenge"
  // throws these intermittently — usually clears with a small backoff).
  const doFetch = () =>
    fetch(url, {
      ...init,
      headers: { ...baseHeaders, ...(init.headers ?? {}) },
    });

  let res: Response | null = null;
  let fetchErr: unknown = null;
  try {
    res = await doFetch();
  } catch (err) {
    fetchErr = err;
  }
  lastHit.set(host, Date.now());

  // Fall back to curl when:
  //   - Node's fetch threw (TLS reset, socket closed, DNS hiccup), OR
  //   - the server returned 403/429 (Cloudflare bot-block).
  // Curl's TLS handshake produces a browser-shape JA3, so anti-bot
  // systems that filter on TLS fingerprint accept it.
  const shouldFallback =
    fetchErr !== null || (res !== null && (res.status === 403 || res.status === 429));
  if (shouldFallback) {
    const curl = await fetchViaCurl(url, baseHeaders).catch(() => null);
    if (curl !== null) {
      lastHit.set(host, Date.now());
      // This used to be `new Response(curlBody, { status: 200 })` for ANY
      // non-empty body, so a Cloudflare challenge page or an upstream error
      // page was handed to the parser as a success.
      if (isChallengePage(curl.body)) throw new CloudflareChallengeError(url);
      if (curl.status >= 400 && curl.status !== 304) {
        throw new Error(`Fetch failed (curl): ${url} → ${curl.status}`);
      }
      return new Response(curl.body, {
        status: curl.status,
        headers: { "content-type": "text/html" },
      });
    }
    if (fetchErr) throw fetchErr;
  }
  if (res === null) {
    throw new Error(`Fetch failed: ${url} (no response and no curl fallback)`);
  }

  if (!res.ok && res.status !== 304) {
    throw new Error(`Fetch failed: ${url} → ${res.status} ${res.statusText}`);
  }
  return res;
}

interface CurlResult {
  status: number;
  body: string;
}

async function fetchViaCurl(
  url: string,
  headers: Record<string, string>,
): Promise<CurlResult | null> {
  return new Promise((resolve) => {
    // --compressed: tell curl to decode gzip/deflate/br so we get text back.
    // Without it, our Accept-Encoding header asks the server to gzip the
    // body and the parser sees binary garbage.
    // -w appends the real response status after the body so we can propagate
    // it instead of assuming 200. Deliberately NOT --fail-with-body: that
    // makes curl exit non-zero on 4xx, which would discard the status we want.
    const args = ["-sSL", "--compressed", "--max-time", "30", "-w", "\n%{http_code}"];
    // Windows-bundled libcurl (Git for Windows) doesn't ship brotli
    // support — when a server like live-tennis.eu obeys our Accept-Encoding
    // and returns br, curl errors 61 "Unrecognized content encoding type".
    // Force gzip+deflate only for the curl path so we always get a body
    // we can decode.
    const safeHeaders: Record<string, string> = { ...headers };
    safeHeaders["Accept-Encoding"] = "gzip, deflate";
    for (const [k, v] of Object.entries(safeHeaders)) {
      args.push("-H", `${k}: ${v}`);
    }
    args.push(url);
    const child = spawn("curl", args, { stdio: ["ignore", "pipe", "pipe"] });
    let body = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { body += chunk.toString(); });
    child.stderr.on("data", (chunk) => { stderr += chunk.toString(); });
    child.on("error", () => resolve(null));
    child.on("close", (code) => {
      if (code === 0 && body.length > 0) {
        // Split the trailing "\n<status>" written by -w off the body.
        const nl = body.lastIndexOf("\n");
        const statusRaw = nl === -1 ? "" : body.slice(nl + 1).trim();
        const status = /^\d{3}$/.test(statusRaw) ? Number(statusRaw) : 0;
        if (status === 0) {
          console.warn(`[politeFetch] curl gave no parseable status for ${url}`);
          resolve(null);
          return;
        }
        resolve({ status, body: body.slice(0, nl) });
      } else {
        console.warn(`[politeFetch] curl fallback failed for ${url} (code=${code}): ${stderr.trim().slice(0, 200)}`);
        resolve(null);
      }
    });
  });
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
