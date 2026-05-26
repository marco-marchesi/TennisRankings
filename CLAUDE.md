# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
pnpm dev                            # Next.js dev server (http://localhost:3000)
pnpm build                          # Production build
pnpm lint                           # ESLint (next/core-web-vitals)
pnpm typecheck                      # tsc --noEmit
pnpm test                           # Vitest unit/contract suite (skips LIVE_TESTS)
pnpm vitest run path/to/file.test   # Run one test file
pnpm vitest -t "name fragment"      # Run tests matching a description
pnpm test:e2e                       # Playwright smoke tests against dev server
pnpm db:push                        # Apply src/db/schema.ts to DATABASE_URL
pnpm db:studio                      # Open Drizzle Studio
```

**Live integration tests** (sample DB against Wikidata + TennisExplorer; off by default):

```powershell
$env:LIVE_TESTS = "1"; pnpm vitest run scraper/__tests__/source-truth.live.test.ts
```

**Scraper pipeline** — each step is independently re-runnable:

```bash
pnpm scraper:run                # top-100 ATP+WTA HTML refresh
pnpm scraper:expand-rankings    # top-800 via TennisExplorer (carries rank Move)
pnpm scraper:backfill-history   # per-player ranking history from Tennis Abstract
pnpm scraper:backfill-matches   # deep match history from Tennis Abstract CSVs
pnpm scraper:daily-matches      # hourly TennisExplorer finished + planned matches
pnpm scraper:leaderboards       # MCP serve/return/rally/winners-errors
pnpm scraper:enrich-players     # Wikidata photos + Wikipedia bios
pnpm scraper:projections        # recompute live_projections from current state
```

Wrappers in `scripts/`: `Weekly-Update.ps1` (full pipeline), `Hourly-Update.ps1` (TE matches + projections only), `Start-Dev.ps1`/`Stop-Dev.ps1` (Docker DB + dev server).

## Architecture

### Two halves, one repo

`src/` is the Next.js 15 web app. `scraper/` is a standalone TSX worker that reads/writes the same Postgres but ships separately. They share `src/db/schema.ts` and `src/lib/utils.ts` via the `@/` and `@scraper/` path aliases (configured in `vitest.config.ts` and `tsconfig.json`).

The web app is read-only against the DB. Writes happen in three places: the scraper worker, authenticated user actions (favorites, newsletter), and the projections runner. The scraper and projections runner are entirely server-side TSX — no Next.js or React imports.

### Database — multi-source by design

The schema is in `src/db/schema.ts`. Drizzle uses `db:push` (no migrations folder), but ad-hoc SQL lives in `drizzle/views/` for things drizzle-kit can't infer cleanly (PK swaps, indexes with custom orderings).

**`player_recent_matches` is multi-source.** PK is `(player_id, source, external_tourney_id, external_match_num)`. `source ∈ {tennis_abstract, tennis_explorer}`. The same logical match can land in the table twice — once per source. **Every reader** that consumes this table must dedupe with:

```sql
distinct on (player_id, played_on, lower(opponent_name)) ...
order by ... case source when 'tennis_explorer' then 0 else 1 end
```

The pattern appears in `src/lib/players.ts` (getRecentMatches, getSurfaceSplits), `scraper/projections/derive-live-state.ts`, and `scraper/projections/derive-dropping-points.ts`. If you add a fourth reader, replicate it — never just `select * from player_recent_matches`.

`player_upcoming_matches` is the planned-matches sibling. The daily-matches scraper **bulk-replaces** it on each run (delete + insert) — never upsert. Planned matches change too rapidly to merge.

### Data sources, by role

- **ATP/WTA HTML** (`scraper/sources/atp.ts`, `wta.ts`) — authoritative top-100 + race rankings. Carries `points_move`, `drop_points`, `next_best_points` from the official site. Fetched via Playwright (`scraper/fetch-live.ts`) when politeFetch is blocked.
- **TennisExplorer** (`scraper/sources/tennis-explorer.ts`, `tennis-explorer-rankings.ts`) — fresh-data overlay. Daily match lists, match details, top-800 rankings with the per-week "Move" column. Updates same-day after matches finish; ATP/WTA CSVs from Tennis Abstract lag by 1–3 weeks.
- **Tennis Abstract** (`scraper/sources/tennis-abstract.ts`, `ta-leaderboards.ts`) — deep history. Per-year match CSVs for backfill, player metadata (DOB/height/hand/wikidata_id), and the MCP leaderboards. TA's reports all default-sort by serve-impact regardless of category — `scraper/sources/ta-leaderboards.ts` re-ranks per category at parse time.
- **Wikidata / Wikipedia** (`scraper/sources/wikipedia.ts`, `scraper/enrich-players.ts`) — photos and bios. Wikipedia infobox photos are usually portrait — the player profile pins `object-position: top` so the face stays in frame.

### politeFetch and TLS fingerprints

`scraper/http.ts` enforces 1 req/sec/host throttle, a kill-switch (`SCRAPER_KILL_SWITCH=true`), and **falls back to spawning `curl --compressed`** on 403/429 or socket errors. Cloudflare (atptour.com) and TennisExplorer fingerprint Node's TLS handshake (JA3) and block it regardless of User-Agent. Curl's handshake passes. Don't try to add `undici` cipher tweaks — the curl path works and is opt-in only on failure.

### Projections runner

`scraper/projections/runner.ts` orchestrates two derivers:

- `derive-live-state.ts` — for each top-N player, finds their latest match in the lookback window (default 14 days) and infers `status ∈ {not_playing, in_progress, eliminated, won_tournament}`. Excludes tournaments that already have a Final on record (otherwise last month's Masters would re-award points).
- `derive-dropping-points.ts` — for each top-N player, finds matches from 52 weeks ago that are about to roll off the rolling-window points total.

Both feed `scraper/projections/calculator.ts` which produces `live_projections` rows.

Category inference (`scraper/projections/category-inference.ts`) maps a tournament's TA tier letter (`G/M/A/C/F/D/O`) + name into the internal `Category` enum. TE doesn't supply tier letters, so the function falls back to name-matching against `GRAND_SLAMS`, `MASTERS_1000_TOURNAMENTS`, `ATP_500_TOURNAMENTS`, etc. **Update those sets when adding new tournaments to the calendar** — otherwise new 500s/1000s get misclassified as 250s.

### DATABASE_URL routing

`src/db/index.ts` picks the driver by URL substring: `neon.tech` → `drizzle-orm/neon-http`, anything else → `node-postgres` with a pool. Both drivers expose the same `NodePgDatabase<typeof schema>` surface — downstream code is driver-agnostic.

`scripts/Weekly-Update.ps1` and `Hourly-Update.ps1` load `DATABASE_URL` from `.env.local` if not already set, and only check for the local Docker container when the URL contains `@localhost` or `@127.0.0.1`. Pointing at Neon just works.

### Tests

- `scraper/__tests__/atp.test.ts`, `wta.test.ts`, `validate.test.ts` — parser/zod contract tests against fixtures in `scraper/__fixtures__/`. These are what fail first when ATP/WTA redesign their HTML.
- `scraper/__tests__/source-truth.live.test.ts` — `LIVE_TESTS=1`-gated. Samples 10 ATP + 10 WTA across rank buckets, cross-checks DB against Wikidata (sport=Q847, DOB matches P569), and verifies TE coverage of `player_recent_matches` (≥60% recent) and `player_upcoming_matches` (≥50% planned). Asserts the live world matches our stored data.

### Path aliases

- `@/` → `src/`
- `@scraper/` → `scraper/` (scraper tests only; web code shouldn't import from `scraper/`)

### When in doubt

- A failing scraper that hangs or 403s: check `scraper/http.ts` curl fallback first.
- An `in_progress` projection that should be `not_playing`: a Final row missing from `player_recent_matches` causes the whole tournament to look unfinished — check `derive-live-state.ts`'s `finished_tournaments` CTE.
- A new ATP/WTA event miscategorized: add it to `scraper/projections/category-inference.ts`.
- A search result with wrong ranks: the Drizzle `sql<...>` nested-subquery template misbehaves for column references — write raw SQL via `db.execute(sql\`…\`)` instead (see `searchPlayers` in `src/lib/players.ts`).
