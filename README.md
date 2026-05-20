# TennisRankings

**The smartest tennis rankings site.** A live-tennis.eu competitor built
for solo-dev scale: rankings, projections, points-expiry, head-to-heads,
surface splits, simulators. SEO content is a byproduct of the data, not a
content treadmill.

See [`PLAN.md`](./PLAN.md) for the full architecture, gap analysis, and
roadmap.

---

## Quickstart

```bash
pnpm install
cp .env.example .env.local              # fill DATABASE_URL etc.
pnpm db:push                            # apply Drizzle schema to Neon
pnpm scraper:seed                       # load fixtures into local DB
pnpm dev                                # → http://localhost:3000
```

### Useful scripts

| Command | What it does |
|---|---|
| `pnpm dev` | Next.js dev server |
| `pnpm build` | Production build |
| `pnpm lint` | ESLint (Next config) |
| `pnpm typecheck` | `tsc --noEmit` |
| `pnpm test` | Vitest (unit + scraper contract tests) |
| `pnpm test:e2e` | Playwright smoke suite |
| `pnpm db:push` | Push Drizzle schema |
| `pnpm db:studio` | Drizzle Studio |
| `pnpm scraper:run` | One-off scraper (writes to DB) |
| `pnpm scraper:run --dry` | Scraper, no writes (debug) |
| `pnpm scraper:seed` | Load fixtures into DB (for dev/CI) |

---

## Architecture

```
Fly worker (cron, Mon 06:00 UTC + ad-hoc)
  ├─ scraper/sources/atp.ts
  ├─ scraper/sources/wta.ts
  └─ scraper/sources/wikipedia.ts
        ↓
  scraper/validate.ts   (zod + snapshot-diff sanity)
        ↓
  Neon Postgres         (canonical, versioned snapshots)
        ↓
  /api/revalidate       (on-demand ISR per route tag)
        ↓
  Cloudflare-cached Next.js HTML (24h s-maxage)
```

Read paths use Drizzle queries server-side. Write paths are limited to
the scraper worker and authenticated user actions (favourite player,
newsletter).

---

## Stack

- **Next.js 15** App Router (SSR + ISR)
- **Tailwind v4** + **shadcn/ui** + Inter / Instrument Serif
- **Drizzle ORM** on **Neon Postgres**
- **Auth.js** + **Resend** magic links
- **TanStack Table** (virtualised), **Recharts**
- **Zod**, **Vitest**, **Playwright**, **Lighthouse CI**, **axe-core**
- **Sentry** (errors), **Plausible** (analytics), **Klaro** (CMP)

---

## Repository layout

```
src/
  app/
    (public)/        # marketing + content pages, all SSR/ISR
      rankings/[tour]/
      race/[tour]/
      players/[slug]/{,h2h/[opponent]/,history/}
      tournaments/[slug]/{,[year]/}
    explainers/[slug]/
    api/             # search, revalidate, newsletter, alerts, predictions
    layout.tsx, page.tsx, sitemap.ts, robots.ts
  components/        # rankings-table, projection-table, form-widget, …
  lib/               # data access, seo, schema-org, simulator, predictions
  db/                # drizzle client + schema
  styles/

scraper/             # standalone worker (deployed to Fly)
  sources/           # atp.ts, wta.ts, wikipedia.ts
  __fixtures__/      # recorded HTML/JSON for contract tests
  __tests__/

content/             # hand-written explainers (Markdown)
.github/workflows/   # CI: typecheck, lint, vitest, playwright, lighthouse
```

---

## Status

| Phase | Status |
|---|---|
| 0 — Foundations | ✅ Scaffolded |
| 1 — MVP (scraper, key pages, SEO surface) | ✅ Scaffolded |
| 2 — Wedge (projection, h2h, charts, accounts) | ✅ Scaffolded |
| 3 — Compounding (simulator, predictions, i18n, premium) | 🟨 Scaffolded (stubs for ML training, payments, translations) |
| Deferred — native apps, public API, live scores | ⬜ Not started |

Stubs are deliberate — they hold the architecture in place so each piece
can be filled in without rework. Each stub is annotated with a short
`TODO:` explaining the gap.

---

## Contributing & licence

Source code: MIT. Editorial content under `content/`: CC BY-NC 4.0.
See [`LICENSE`](./LICENSE).

Security reports: see [`SECURITY.md`](./SECURITY.md).
