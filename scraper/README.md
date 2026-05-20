# Scraper

Standalone TypeScript worker, deployed to Fly.io. Runs every Monday 06:00 UTC
and on-demand.

## Ethical scraping rules

These are non-negotiable. Violating any of them costs us the project.

1. **Identify the bot.** Set `User-Agent: TennisRankingsBot/<version>
   (+https://tennisrankings.example/bot)` with a contact email.
2. **Honour robots.txt.** Re-check on every run; abort if disallowed.
3. **Rate limit.** At most 1 request per second per host. Sleep between
   pages.
4. **Cache aggressively.** Don't re-fetch what we already have. Use
   conditional GETs (`If-None-Match`).
5. **Off-peak.** Run on Monday early-UTC, when official sites are quiet.
6. **Snapshot before publishing.** Validate against the previous snapshot;
   if the delta exceeds `SCRAPER_MAX_DELTA_PCT`, hold publish and alert.
7. **Kill-switch.** `SCRAPER_KILL_SWITCH=true` halts everything within one
   loop iteration. Used to comply with a takedown notice without code
   deploys.

## Layout

```
scraper/
  index.ts                 # entrypoint: orchestrates sources → validate → snapshot
  seed.ts                  # load fixtures into the DB for local dev / CI
  sources/
    atp.ts
    wta.ts
    wikipedia.ts
    tennisabstract.ts      # historical CSVs, CC-licensed
  validate.ts              # Zod schemas + snapshot diff sanity-check
  snapshot.ts              # write to Neon, transactional
  http.ts                  # rate-limited fetch with cache + UA
  __fixtures__/            # frozen real-world payloads for contract tests
  __tests__/
```

## Why a separate worker?

- Vercel Cron on Hobby has a 60-second function limit. Our scrape needs
  longer for the full top-2000 + photo backfill.
- Keeps Next.js bundle slim — no scraper deps in the web image.
- Lets us scale the worker independently (one Fly Machine, ~$5/mo).
- Reduces blast radius: a buggy scrape doesn't take down the website.

## Tests

`pnpm test scraper/` runs contract tests against fixture HTML/JSON
recorded under `__fixtures__/`. If atptour.com redesigns and our parsing
breaks, these tests fail in CI before anything is published.

To refresh a fixture (when an upstream HTML change is intentional):

```bash
pnpm tsx scraper/sources/atp.ts --record-fixture
```

Commit the diff with a clear "upstream HTML change in <section>" message.
