# TennisEdge — Refined Build Plan (v2)

> Plan owner: Marco Marchesi · Last updated: 2026-05-20

## Context

The earlier blueprint (`f9e54986-tennissiteplan.md`, uploaded May 2026)
sketched an ambitious live-tennis.eu competitor. This document is the
*refined* plan that survived a gap-analysis pass: it drops scope a solo
dev can't realistically ship, hardens what survives against the actual
failure modes (scraper breakage, EU compliance, AI-slop SEO penalties,
performance regressions, cost overruns), and front-loads the work that
compounds (SEO surface area, design system, scraper reliability).

Constraints driving every decision below:

- **Solo developer, bootstrapped** — cost-conscious; quality non-negotiable.
- **Scrape ATP/WTA** as the data source (no licensed feed).
- **Rankings-first**; live scores deferred to a later phase.
- **Betting affiliates** included but late-phase and minimal.

Repository: `marco-marchesi/TennisRankings` — currently empty. Greenfield.
Working branch: `claude/improve-rankings-plan-U3zu2`.

---

## 1. Gap analysis of the original plan

Grouped by severity. Section references point at the original doc.

### Critical gaps

1. **No legal/risk treatment of scraping.** atptour.com ToS forbids it; IP
   bans and DMCA notices are realistic. Original §4 just says "scrape,
   migrate later." Need: ethical scraping rules (robots.txt, rate-limits,
   identified user-agent), a fallback source, and a kill-switch.
2. **"Real-time" promised, batched cron delivered.** §1 and §2 keep saying
   "real-time" / "live"; §4 specifies a 15–30 min cron. That is *not* live
   and will erode trust the moment users notice. Drop the language or
   build SSE/WebSocket for the subset that can be live. Rankings update
   weekly — be honest about cadence.
3. **Player photos = copyright minefield.** §3 puts thumbnails in the
   rankings table; §8 budgets Cloudflare Images. Cloudflare is a CDN, not
   a licence. Getty/AP enforce. Use Wikimedia Commons with attribution,
   fallback to generated SVG silhouettes.
4. **Cost estimate (§8: $75/mo) is unrealistic at 2M visits/mo.** Vercel
   bandwidth/function/image overage at that scale is $300–$800/mo. Stage
   the cost curve or move hot paths to Cloudflare Workers + R2.
5. **No GDPR / cookie consent.** Targeting EU traffic without a CMP is a
   €€ fine risk and breaks AdSense/affiliate compliance.
6. **No accessibility plan.** Sports tables are notoriously inaccessible;
   colour-only win/loss dots in §2 fail WCAG. Use shape+colour, ARIA on
   tables, focus management on the live ticker.
7. **No observability / error tracking.** A scraper-driven product without
   Sentry + uptime monitoring is flying blind. First silent scraper
   break in production = stale data = trust collapse.
8. **AI-generated weekly blog posts (§5) risk Google HCU penalty.**
   Post-2024 Helpful Content Update, auto-generated thin content actively
   hurts. Editorial review, bylines, and sources cited are now required.

### Significant gaps

9. **No testing strategy.** Vitest/Playwright unmentioned. Scrapers
    *especially* need contract tests against fixtures.
10. **No database migration tool** (Drizzle/Prisma) named.
11. **No type-safe API layer** end-to-end.
12. **i18n is shallow.** Hreflang named, but next-intl / translation
    workflow not. Day-1 multilingual (§5) is too ambitious for a solo
    dev; defer to phase 3.
13. **Search is missing from MVP.** Users *will* search players by name.
    Postgres trigram on `/api/search` is cheap.
14. **No E-E-A-T signals.** Author bios, "last updated" timestamps,
    sources-cited footers are now ranking factors.
15. **PWA-first vs native apps conflict (§1).** Solo dev can't ship
    native iOS+Android *and* a PWA. Pick PWA, drop native.
16. **Font pairing (§3) is incoherent.** Bebas Neue + Playfair Display
    clash. Pick one editorial voice — Inter + Instrument Serif (free).
17. **Cron platform mismatch.** Vercel Cron hobby tier 60s limit kills
    long scrapes. Run scrapers on a $5/mo Fly.io worker.
18. **"What if" simulator (§2) requires the ATP best-18/52-week
    algorithm** with mandatory-tournament substitution. Multi-week build.
19. **Doubles / juniors / wheelchair / Challenger** mentioned briefly but
    no separate data model. Different point structures.
20. **No dynamic OG images.** `@vercel/og` per-player/tournament is cheap
    and adds significant social CTR.
21. **No rate limiting / abuse protection** on the public API.
22. **Email auth/deliverability** (SPF/DKIM/DMARC) glossed over.
23. **Newsletter (retention loop) entirely absent.** Should be phase 1.

### Nice-to-have improvements

24. Edge-cached HTML + on-demand ISR — perfect for weekly cadence.
25. Dynamic structured data per page type.
26. Open-source the scraper + public sitemap as link-magnet.
27. Colour-blind palette QA; never colour-only.
28. Tournament draws as data — harder than rankings; defer.
29. Performance budgets in CI (Lighthouse CI on PRs).
30. Drop "free public API" from year-1 scope — ship an embeddable widget
    instead. Same backlink value, far less maintenance.

---

## 2. Refined recommendation — what to build

### 2.1 Positioning

Original: "beat live-tennis.eu on everything." Solo dev can't.

Refined: **"The smartest tennis rankings site."** Deepest ranking
intelligence — projections, points-expiry, head-to-heads, surface splits,
simulators. Sidesteps live-score licensing. SEO content becomes a
byproduct of the data, not a content treadmill.

### 2.2 Tech stack

| Layer | Choice | Why |
|---|---|---|
| Frontend | Next.js 15 App Router | SSR + ISR, latest stable |
| Styling | Tailwind v4 + shadcn/ui | Fast, consistent |
| DB | Neon Postgres free tier | Branches; cheaper than Supabase if not using their auth |
| ORM | Drizzle | Type-safe, lightweight |
| Cache | Cloudflare in front of Vercel | Free, edge HTML |
| Scraper | Fly.io Machines ($0–5/mo) | No 60s timeout |
| Hosting | Vercel Hobby → Cloudflare Pages if costs spike | |
| Auth | Auth.js + Resend magic links | Cheap, portable |
| Images | next/image + Wikimedia Commons | Licence-safe |
| Email | Resend | SPF/DKIM in setup checklist |
| Analytics | Plausible self-hosted on Fly | Free |
| Errors | Sentry free tier | |
| Search | Postgres pg_trgm | No external service |
| Tests | Vitest + Playwright + Lighthouse CI | |
| Consent | Klaro! | GDPR |

### 2.3 Data architecture

```
Primary scraper (Fly worker, Mon 06:00 UTC + ad-hoc)
  ├─ Source A: atptour.com rankings JSON endpoints
  ├─ Source B: wta.com rankings
  ├─ Source C: Wikipedia + Wikidata (bios, photos, history)
  └─ Source D: tennisabstract.com (CC-licensed historicals)
        ↓
  Validation (zod; snapshot-diff sanity cap; reject if >X% delta)
        ↓
  Neon Postgres (canonical, versioned snapshots)
        ↓
  On-demand ISR revalidate hook → Cloudflare-cached HTML (24h s-maxage)
```

Principles missing from the original plan:

- Fixture-based scraper tests — site redesigns can't ship broken data.
- Snapshot diffing — hold publish + alert if delta is implausible.
- Robots.txt respect, 1 req/s/host cap, identified user-agent, contact
  email. Aggressive cache to minimise origin hits.
- Kill-switch env flag for emergency takedown response.

### 2.4 Page surface (day-1 SEO compounding asset)

- `/`
- `/rankings/atp`, `/rankings/wta`, `/race/atp`, `/race/wta`
- `/rankings/projection`
- `/players/[slug]` (1,500+ pages; Person schema; OG image)
- `/players/[slug]/h2h/[other]`, `/players/[slug]/history`
- `/tournaments/[slug]`, `/tournaments/[slug]/[year]` (SportsEvent)
- `/explainers/[slug]` × ~8 evergreen articles (hand-written, bylined)
- `/sitemap.xml` (chunked, <50k URLs per file)
- `/robots.txt`

Dynamic OG images via `@vercel/og` on `/players/*` and `/tournaments/*`.

### 2.5 Design system (premium, free)

- Type: Inter (UI) + Instrument Serif (editorial). Free, modern.
- Palette: original navy/electric-green/danger-red retained; add ▲ ▼
  icons so it isn't colour-only.
- Light *and* dark with `prefers-color-scheme`. EU users skew light; do
  not force dark.
- TanStack Table virtualised; ARIA roles; keyboard-navigable; sticky
  header.
- Skeletons, not spinners.
- Framer Motion only on rank-change indicators; respect
  `prefers-reduced-motion`.

### 2.6 Roadmap (solo-dev realistic)

**Phase 0 — Foundations (Weeks 1–2)**
Repo + Next.js 15 + Tailwind v4 + shadcn + Drizzle + Neon · CI
(typecheck, lint, Vitest, Playwright smoke, Lighthouse CI) · Sentry,
Plausible, Klaro CMP · Deploy on Vercel; Cloudflare in front.

**Phase 1 — MVP (Weeks 3–10)**
Scraper on Fly (ATP + WTA) with fixture tests · Drizzle migrations · Key
pages: `/`, `/rankings/{atp,wta}`, `/players/[slug]`,
`/tournaments/[slug]` · Search (pg_trgm) · Structured data · Sitemap +
robots · Dynamic OG · AdSense application · Newsletter signup · 8
hand-written explainers.

**Phase 2 — The wedge (Weeks 11–22)**
Ranking projection page · Points-expiry tracker · Head-to-head pages
(programmatic) · Ranking history charts · Form widget (CB-safe) · Surface
split heatmap · User accounts + favourite players · Email alerts.

**Phase 3 — Compounding (Months 6–12)**
"What if" simulator (proper best-18/52-week algorithm) · ELO-based match
predictions (no LLM hallucination) · Multilingual (EN → ES → FR) ·
Betting odds widgets (minimal, geo-blocked, disclosed) · Premium tier
(ad-free + extra alerts + CSV exports).

**Deferred (year 2+):** Native apps · Public B2B API · Live scores.

### 2.7 Realistic cost ladder

| Stage | Monthly cost | Trigger to escalate |
|---|---|---|
| Phase 0–1 (pre-traffic) | ~$5 (Fly, domain) | — |
| Phase 2 (5–50k visits) | ~$30 (Vercel Pro, Neon paid) | Function quota |
| Phase 3 (50–500k) | ~$120 | Bandwidth spikes |
| Scale (1M+) | $300–800 — migrate to Cloudflare Pages + Workers | Sustained 3 months |

### 2.8 Legal / compliance / ethics

- Robots-compliant scraper, identified user-agent, contact email.
- Daily cache to minimise origin hits; respect Crawl-Delay.
- Kill-switch env flag for takedown response.
- GDPR: Klaro CMP, no analytics before consent, data-export endpoint,
  privacy policy + DPA-ready records.
- AdSense/affiliate disclosure on every monetised page.
- Betting: geo-block US states, 18+ gate, responsible-gambling links —
  even in minimal mode.
- Player photos: Wikimedia Commons URLs with attribution, fallback SVG.

### 2.9 SEO refinements

Keep: SSR, Core Web Vitals targets, JSON-LD, hreflang, programmatic
profile/tournament pages, evergreen explainers, weekly ranking posts.

Change:
- Hand-write the explainers and weekly recaps for the first 6 months;
  AI assist under human review only after that.
- Author bylines + bio + sources-cited footer on every editorial page.
- Server-rendered "Last updated" timestamps.
- No public API as link-bait in year 1 — ship embeddable rankings widget
  (iframe + JS) instead.

---

## 3. Critical files

Spine of the codebase; everything else hangs off these.

- `package.json` — Next.js 15, Tailwind 4, Drizzle, Auth.js, Resend,
  shadcn, TanStack Table, Recharts, Zod, Vitest, Playwright, Sentry
- `next.config.ts` — image domains (Wikimedia), headers, i18n placeholder
- `drizzle/schema.ts` — `players`, `rankings_snapshots`, `tournaments`,
  `matches`, `users`, `user_followed_players`, `scrape_runs`
- `src/app/layout.tsx` — Klaro CMP, theme provider, Sentry init
- `src/app/(public)/rankings/[tour]/page.tsx`
- `src/app/(public)/players/[slug]/page.tsx` (+ `opengraph-image.tsx`)
- `src/app/(public)/players/[slug]/h2h/[opponent]/page.tsx`
- `src/app/(public)/tournaments/[slug]/page.tsx`
- `src/app/api/revalidate/route.ts` — on-demand ISR hook
- `src/app/api/search/route.ts` — pg_trgm search
- `src/app/sitemap.ts`, `src/app/robots.ts`
- `src/lib/schema-org.ts`, `src/lib/seo.ts`
- `src/components/{rankings-table,projection-table,form-widget}.tsx`
- `scraper/sources/{atp,wta,wikipedia}.ts`, `scraper/validate.ts`,
  `scraper/__fixtures__/`
- `.github/workflows/ci.yml`
- `LICENSE`, `SECURITY.md`, `privacy.md`, `cookies.md`

---

## 4. Verification

After Phase 0–1 implementation lands:

1. Scraper integrity — `pnpm scraper:run --dry` parses live ATP+WTA into
   the Zod schema; contract tests against fixtures pass.
2. DB round-trip — `pnpm db:push` to Neon dev branch; trigger scraper;
   `rankings_snapshots` matches atptour.com top 10.
3. Page rendering — `/rankings/atp`, `/players/jannik-sinner`,
   `/tournaments/roland-garros` all SSR with data in the HTML (curl test).
4. Structured data — Google Rich Results Test: zero errors on every page
   type.
5. SEO basics — sitemap.xml lists every player + tournament; robots.txt
   allows crawl; canonicals present.
6. Performance — Lighthouse CI passes budget: LCP < 1.5s mobile, CLS = 0,
   INP < 100ms, perf ≥ 95.
7. Accessibility — axe-core via Playwright on top 5 page types, zero
   serious violations; keyboard-only walkthrough; screen-reader spot-check
   on the rankings table.
8. GDPR — analytics + ads do not load pre-consent (DevTools network).
9. Errors — test throw captured in Sentry.
10. Production smoke — Playwright smoke suite (home, rankings, one
    player, search) green on every PR's Vercel preview.

Ten green = foundation is solid enough for Phase 2 without rework.
