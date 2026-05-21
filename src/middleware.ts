import { NextRequest, NextResponse } from "next/server";

// Light-touch middleware:
//   - Geo-block betting/affiliate content from regions where it's illegal.
//
// Heavy lifting (auth, rate limiting at scale) goes to Cloudflare in front
// of Vercel — middleware here is the fallback.

const BETTING_BLOCKED_COUNTRIES = new Set([
  "US", // most US states require additional licensing
  "AU", // ACMA + state regs
]);

export function middleware(request: NextRequest) {
  const url = request.nextUrl;
  // Next.js 15 removed `NextRequest.geo` — read the Vercel-injected header
  // instead. Cloudflare equivalents are wired separately upstream.
  const country = request.headers.get("x-vercel-ip-country");

  if (url.pathname.startsWith("/odds") && country && BETTING_BLOCKED_COUNTRIES.has(country)) {
    return NextResponse.rewrite(new URL("/odds/unavailable", request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/odds/:path*"],
};
