# TennisRankings

ATP and WTA rankings with in-week projections, points-expiry tracking,
head-to-heads and surface splits. Built and run at solo-dev scale.

**Current focus: making the numbers exactly right.** The goal is that our
computed ranking equals the ATP/WTA published points, and our projected
ranking equals live-tennis.eu's live ranking — both verified by a permanent
reconciliation harness rather than by eyeballing. See
[`docs/ranking-rules.md`](./docs/ranking-rules.md) for the 2026 rulebook
digest that serves as the spec.

`PLAN.md` is the original 2026-05 build plan and is largely historical now.

---

## Quickstart

```bash
pnpm install
cp .env.example .env.local              # fill DATABASE_URL etc.
pnpm db:push                            # apply Drizzle schema
pnpm db:views                           # apply drizzle/views/*.sql — REQUIRED,
                                        # db:push creates none of it
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
| `pnpm db:views` | Apply `drizzle/views/*.sql` (views, added columns, PK swaps) |
| `pnpm db:studio` | Drizzle Studio |
| `pnpm scraper:run` | One-off scraper (writes to DB) |
| `pnpm scraper:run --dry` | Scraper, no writes (debug) |
| `pnpm scraper:seed` | Load fixtures into DB (for dev/CI) |

---

## Architecture

```
Local scraper run (scripts/*.ps1, manual today)
  ├─ scraper/sources/{atp,wta}.ts        official rankings + race
  ├─ scraper/sources/tennis-explorer*.ts fresh matches, top-800
  ├─ scraper/sources/tennis-abstract.ts  deep history (Sackmann CSVs)
  └─ scraper/sources/wikipedia.ts        photos + bios
        ↓
  scraper/validate.ts    (zod + snapshot-diff sanity)
        ↓
  Neon Postgres          (canonical, versioned snapshots)
        ↓
  Next.js ISR (revalidate = 3600)
```

Read paths use Drizzle queries server-side. **All** write paths are the
scraper worker and the projections runner — the web app never writes.

> Earlier revisions of this file described a Fly.io worker on a Monday
> 06:00 UTC cron. No Fly config has ever existed here, and the GitHub Actions
> scraper workflow was removed in `36bd677`. **Nothing is scheduled right
> now** — data is only as fresh as the last manual `.ps1` run. Registering the
> Windows Task Scheduler jobs is a planned step.

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
      leaderboards/[tour]/
    explainers/[slug]/
    api/             # search, revalidate, player-photo
    error.tsx        # honest failure state (no fabricated fallback data)
    layout.tsx, page.tsx, sitemap.ts, robots.ts
  components/        # rankings-table, rank-delta, history chart, …
  lib/               # data access, seo, schema-org
  db/                # drizzle client + schema
  styles/

scraper/             # standalone worker, run locally via scripts/*.ps1
  sources/           # atp, wta, tennis-explorer, tennis-abstract, wikipedia
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
