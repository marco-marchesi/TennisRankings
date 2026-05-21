# Deploying on Vercel Hobby + Neon Free

Zero-cost production deployment. Takes ~30 minutes end to end.

---

## Prerequisites

- GitHub account (repo already pushed)
- [Vercel account](https://vercel.com/signup) — use "Hobby" (free)
- [Neon account](https://neon.tech) — free tier is enough for launch

---

## 1. Create the Neon database

1. Log in to Neon → **New project** → give it a name (e.g. `tennisrankings`), pick the closest region.
2. Neon creates a `main` branch and a default database automatically.
3. Go to **Connection Details** → select **Pooled connection** → copy the connection string.
   It looks like: `postgres://user:password@ep-xxx.us-east-1.aws.neon.tech/neondb?sslmode=require`
4. Keep this tab open — you'll need the URL in step 3.

---

## 2. Deploy to Vercel

1. Go to [vercel.com/new](https://vercel.com/new) → **Import Git Repository** → select this repo.
2. Framework preset: **Next.js** (auto-detected).
3. Do **not** hit Deploy yet — add env vars first (step 3).

---

## 3. Set environment variables

In the Vercel project → **Settings → Environment Variables**, add all of these:

| Variable | Value |
|---|---|
| `DATABASE_URL` | The pooled Neon connection string from step 1 |
| `NEXT_PUBLIC_SITE_URL` | `https://your-vercel-domain.vercel.app` (update after deploy) |
| `AUTH_SECRET` | Run `openssl rand -base64 32` locally and paste the output |
| `AUTH_TRUST_HOST` | `true` |
| `REVALIDATE_SECRET` | Any long random string |
| `RESEND_API_KEY` | Get from [resend.com](https://resend.com) — free tier covers 3,000 emails/month |
| `EMAIL_FROM` | e.g. `alerts@yourdomain.com` (must be a verified Resend sender) |
| `NEXT_PUBLIC_BETTING_ENABLED` | `false` |
| `NEXT_PUBLIC_PREMIUM_ENABLED` | `false` |

Optional — add later:

| Variable | Value |
|---|---|
| `SENTRY_DSN` | From Sentry project settings |
| `NEXT_PUBLIC_SENTRY_DSN` | Same value |
| `NEXT_PUBLIC_PLAUSIBLE_DOMAIN` | Your domain, if using Plausible analytics |

---

## 4. Run the database migrations

The schema is managed with Drizzle. Run this **once** from your local machine, pointing at the Neon database:

```bash
# Put the Neon DATABASE_URL in your .env.local, then:
pnpm db:push
```

This creates all tables, indexes, enums, and views in Neon.

---

## 5. Deploy

Back in Vercel → click **Deploy**. The build takes ~2 minutes.

After it finishes, Vercel gives you a `.vercel.app` URL. Update `NEXT_PUBLIC_SITE_URL` to match it.

---

## 6. Seed initial data

Run the scraper once locally against the live Neon DB to populate the first ranking snapshot:

```bash
# .env.local must point to Neon DATABASE_URL
pnpm scraper:run
```

Then optionally backfill historical data:

```bash
pnpm scraper:backfill-history
pnpm scraper:backfill-matches
pnpm scraper:enrich-players
```

These can take a while — run them in order and let each finish.

---

## 7. Set up the weekly scraper cron (GitHub Actions)

Vercel Hobby does not support cron jobs. Use GitHub Actions instead — it's free.

Create `.github/workflows/scraper.yml`:

```yaml
name: Weekly scraper

on:
  schedule:
    - cron: "0 8 * * 1"   # every Monday at 08:00 UTC (after ATP/WTA publish)
  workflow_dispatch:        # allows manual trigger

jobs:
  scrape:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
        with:
          version: 9
      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: pnpm
      - run: pnpm install --frozen-lockfile
      - run: pnpm scraper:run
        env:
          DATABASE_URL: ${{ secrets.DATABASE_URL }}
          REVALIDATE_SECRET: ${{ secrets.REVALIDATE_SECRET }}
          NEXT_PUBLIC_SITE_URL: ${{ secrets.NEXT_PUBLIC_SITE_URL }}
```

Add `DATABASE_URL`, `REVALIDATE_SECRET`, and `NEXT_PUBLIC_SITE_URL` to **GitHub repo → Settings → Secrets and variables → Actions**.

---

## Free tier limits to watch

| Service | Free limit | When you'll hit it |
|---|---|---|
| Neon storage | 0.5 GB | ~Year 2 (after full match backfill) |
| Neon compute | 190 hours/month | Unlikely — DB only wakes on queries |
| Vercel bandwidth | 100 GB/month | ~100k–500k pageviews/month |
| Vercel builds | 6,000 min/month | Very unlikely |
| GitHub Actions | 2,000 min/month | Weekly scraper uses ~2 min/run = 8 min/month |

When Neon storage approaches 0.5 GB, upgrade to Neon Launch ($19/month). Everything else stays free for a long time.

---

## Custom domain (optional)

Vercel Hobby supports custom domains. Go to **Project → Settings → Domains** → add your domain → follow the DNS instructions. SSL is automatic.
