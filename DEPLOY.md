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

## 7. Keeping the data fresh

**Nothing is scheduled today.** This section previously told you to create
`.github/workflows/scraper.yml`, but that workflow was deliberately removed in
`36bd677` in favour of running the pipeline locally via Windows Task Scheduler
— and those scheduled tasks were never actually registered. The registration
commands exist only as `.NOTES` comment blocks in the `scripts/*.ps1` headers,
so `Get-ScheduledTask -TaskName "TennisRankings*"` returns nothing.

Until a scheduler is set up, the site is only as fresh as the last manual run:

```powershell
./scripts/Weekly-Update.ps1     # full pipeline
./scripts/Hourly-Update.ps1     # TennisExplorer matches + projections
```

Both load `DATABASE_URL` from `.env.local` and only require the local Docker
container when that URL points at localhost — pointing at Neon just works.

**Why not GitHub Actions?** The production fetch path (`refresh.ts` →
`fetch-live.ts`) drives Playwright/Chromium, because Cloudflare fingerprints
Node's TLS handshake and blocks it regardless of User-Agent. That is workable
in Actions with the Playwright action, but slower and more fragile than running
it locally.

The planned fix is `scripts/Register-Tasks.ps1` — idempotent registration of
the weekly and hourly jobs with `-MultipleInstances IgnoreNew` (so hourly runs
never stack), `-StartWhenAvailable` and an `-AtStartup` trigger (so a machine
that was off on Monday catches up rather than silently skipping a week), plus
`Start-Transcript` logging to `logs/` and a watchdog that asserts freshness.

### After any schema change

```powershell
pnpm db:push
pnpm db:views    # REQUIRED — db:push creates no views or added columns
```

---

## Free tier limits to watch

| Service | Free limit | When you'll hit it |
|---|---|---|
| Neon storage | 0.5 GB | ~Year 2 (after full match backfill) |
| Neon compute | 190 hours/month | Unlikely — DB only wakes on queries |
| Vercel bandwidth | 100 GB/month | ~100k–500k pageviews/month |
| Vercel builds | 6,000 min/month | Very unlikely |

When Neon storage approaches 0.5 GB, upgrade to Neon Launch ($19/month). Everything else stays free for a long time.

---

## Custom domain (optional)

Vercel Hobby supports custom domains. Go to **Project → Settings → Domains** → add your domain → follow the DNS instructions. SSL is automatic.
