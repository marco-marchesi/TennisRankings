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
pnpm db:views                       # Apply drizzle/views/*.sql (db:push does NOT)
pnpm db:studio                      # Open Drizzle Studio
pnpm replay                         # score our rules vs official weekly rankings (archive, 2023..2026-06)
pnpm replay:check                   # exit 1 if any run scores below scraper/replay/baseline.json
```

**Live integration tests** (sample DB against Wikidata + TennisExplorer; off by default):

```powershell
$env:LIVE_TESTS = "1"; pnpm vitest run scraper/__tests__/source-truth.live.test.ts
```

**Scraper pipeline** — each step is independently re-runnable:

```bash
pnpm scraper:refresh            # official ATP+WTA rankings, ranks 1-500 (+ race); exits 1 on any failure
pnpm scraper:expand-rankings    # ranks 501-800 via TennisExplorer (carries rank Move); refuses to mix weeks; -- --date YYYY-MM-DD rebuilds a past week
pnpm scraper:challenger-calendar # ATP Challenger tiers -> scraper/config/challenger-calendar.json
pnpm scraper:challenger-history # past seasons' Challenger tiers from Wikipedia (-- --years 2022,2023)
pnpm scraper:backfill-history   # per-player ranking history from Tennis Abstract
pnpm scraper:backfill-matches   # deep match history from Tennis Abstract CSVs
pnpm scraper:daily-matches      # hourly TennisExplorer finished + planned matches
pnpm scraper:leaderboards       # MCP serve/return/rally/winners-errors
pnpm scraper:enrich-players     # Wikidata photos + Wikipedia bios
pnpm scraper:projections        # recompute live_projections from current state
pnpm scraper:merge-dupes        # report duplicate player rows (-- --apply merges; -- --pairs f.json merges evidence-backed pairs)
pnpm scraper:repair-te-matches  # re-attribute stored TE rows (dry run; -- --apply writes)
```

Wrappers in `scripts/`: `Weekly-Update.ps1` (full pipeline), `Hourly-Update.ps1` (TE matches + projections only), `Start-Dev.ps1`/`Stop-Dev.ps1` (Docker DB + dev server).

Scheduled runs log to `logs/`: `weekly-update-<date>.log`, `compare-live-<date>.log`, `live-diff-<date>.log`, `live-diff-trend.log`. Weekly-Update and Compare-Live share `scripts/Pipeline-Lock.ps1`, so a logon that fires both runs them in sequence, never concurrently. Bare `pnpm scraper:*` does not load `.env.local` — set `DATABASE_URL` first, or go through a wrapper.

## Architecture

### Replay harness — the ground truth for every rule

`scraper/replay/` rebuilds every player's total from the Sackmann archive's
match files and scores it against the **official** weekly ranking, 2023 to
2026-06 (`docs/superpowers/specs/2026-10-12-ranking-accounting-design.md`).
live-tennis.eu is not the target. Two modes: `full` (52-week ledger vs
official) and `delta` (official N + entering − leaving vs official N+1).

- An event whose tier we cannot place is reported as a gap
  (`challenger_tier`, `points_era:wta:itf_w15:2022`, …), never scored as a
  default tier.
- Every result is scored with **its own season's** table
  (`scraper/replay/points-eras.ts`, 2022-2026, sourced per table). The live
  `scraper/config/points-table.ts` is the 2026 season. A change to the live
  table must win on the 2026 weeks (`pnpm replay -- --from 2026-01-05`).
- Judge a rule change on the **clean** rates (`clean X% of N` in the trend
  line), not the overall ones: data gaps bias full mode and delta mode in
  opposite directions. A clean rate can fall when N grows (new, harder
  player-weeks join); say so in the ledger before `--force`.
- A rule or data change must keep `pnpm replay:check` green; update the
  baseline (`pnpm replay -- --update-baseline`) only when the score rises.
- Each run writes `logs/replay-<date>.md` (causes, per-week scores, worst
  residuals) and appends `logs/replay-trend.log`. The archive is cached in
  `data/archive/` (gitignored); `--refresh` re-downloads.

### Two halves, one repo

`src/` is the Next.js 15 web app. `scraper/` is a standalone TSX worker that reads/writes the same Postgres but ships separately. They share `src/db/schema.ts` and `src/lib/utils.ts` via the `@/` and `@scraper/` path aliases (configured in `vitest.config.ts` and `tsconfig.json`).

The web app is **entirely** read-only against the DB. Writes happen in two places: the scraper worker and the projections runner. (Auth, favorites and the newsletter were deleted — they were unreachable stubs.) The scraper and projections runner are entirely server-side TSX — no Next.js or React imports.

### Database — multi-source by design

The schema is in `src/db/schema.ts`. Drizzle uses `db:push` (no migrations folder), but ad-hoc SQL lives in `drizzle/views/` for things drizzle-kit can't infer cleanly (PK swaps, indexes with custom orderings).

**`db:push` alone leaves an unqueryable schema.** It creates neither the views nor the added columns in `drizzle/views/*.sql`. Always follow it with `pnpm db:views`, which applies those files in dependency order (columns before the views that select them) and fails loudly if a new `.sql` file isn't registered in `scraper/apply-views.ts`.

**`player_recent_matches` is multi-source.** PK is `(player_id, source, external_tourney_id, external_match_num)`. `source ∈ {tennis_abstract, tennis_explorer}`. The same logical match can land in the table twice — once per source. **Every reader** that consumes this table must dedupe with:

```sql
distinct on (player_id, played_on, lower(opponent_name)) ...
order by ... case source when 'tennis_explorer' then 0 else 1 end
```

The pattern appears in `src/lib/players.ts` (getRecentMatches, getSurfaceSplits), `scraper/projections/derive-live-state.ts`, and `scraper/projections/derive-dropping-points.ts`. If you add a fourth reader, replicate it — never just `select * from player_recent_matches`.

> **⚠️ This dedupe key does not actually dedupe. Do not trust it.**
>
> `scraper/sources/tennis-abstract.ts` sets `played_on` from `row.tourney_date`
> — the **tournament start date**, identical for every match at an event,
> because Sackmann's CSVs carry no per-match date. `scrape-daily-matches.ts`
> sets `played_on` to the **real match date**. So a Tennis Abstract row and a
> TennisExplorer row for the same logical match have different `played_on`
> values and **never collide**: both survive the `distinct on`, and anything
> that sums points double-counts.
>
> It also means every `played_on >= weekStart` filter is wrong for TA rows: a
> Slam's R128 through F all carry the same Monday date.
>
> The fix is a date-free `match_key`
> (`sha1(edition_key | round | playerLo | playerHi)`) on
> `player_recent_matches`, populated by both writers, with the contract
> becoming `distinct on (player_id, match_key)`. Until that lands, treat any
> per-match points arithmetic over this table as unreliable.

`player_upcoming_matches` is the planned-matches sibling. The daily-matches scraper **bulk-replaces** it on each run (delete + insert) — never upsert. Planned matches change too rapidly to merge.

### Data sources, by role

- **ATP/WTA HTML** (`scraper/sources/atp.ts`, `wta.ts`) — authoritative ranks **1-500** (ATP via `?rankRange=1-500`, WTA via load-more) + race rankings. Carries `points_move`, `drop_points`, `next_best_points` from the official site. Fetched with Playwright through `scraper/browser.ts`. Rows it writes carry `scrape_run_id`; that is how every reader tells official rows from TennisExplorer's.
- **TennisExplorer** (`scraper/sources/tennis-explorer.ts`, `tennis-explorer-rankings.ts`) — fresh-data overlay. Daily match lists, match details, top-800 rankings with the per-week "Move" column. Updates same-day after matches finish; ATP/WTA CSVs from Tennis Abstract lag by 1–3 weeks.
- **Tennis Abstract** (`scraper/sources/tennis-abstract.ts`, `ta-leaderboards.ts`) — deep history. Per-year match CSVs for backfill, player metadata (DOB/height/hand/wikidata_id), and the MCP leaderboards. TA's reports all default-sort by serve-impact regardless of category — `scraper/sources/ta-leaderboards.ts` re-ranks per category at parse time.

  > **⚠️ The upstream repos are gone (checked 2026-09-03).**
  > `JeffSackmann/tennis_atp` and `tennis_wta` return 404 from the GitHub API,
  > and the account is down to one public repo. Every URL this module used to
  > build now 404s — which is why `backfill-history` failed outright and
  > `backfill-matches` reported success while fetching nothing.
  >
  > We now read `Aneeshers/tennis-sackmann-archive`, an archival mirror laid
  > out as `atp/<file>` / `wta/<file>` rather than as two separate repos.
  > Override with `TA_BASE_URL` and `TA_LAYOUT`.
  >
  > **The archive is a one-time snapshot from 2026-06-25 and its 2026 match
  > data stops at Roland Garros (`tourney_date` 20260525).** The upstream it
  > mirrored is deleted, so nothing later will ever arrive from this source.
  > **June 2026 onward is TennisExplorer-only.** `TA_COVERAGE_ENDS` records
  > the cutoff.
  >
  > Upside: these CSVs *do* carry `draw_size` and `tourney_level`, so tier and
  > draw-variant resolution is exact up to May 2026 — unlike TE, which
  > supplies neither.
- **Wikidata / Wikipedia** (`scraper/sources/wikipedia.ts`, `scraper/enrich-players.ts`) — photos and bios. Wikipedia infobox photos are usually portrait — the player profile pins `object-position: top` so the face stays in frame.

### Headless browser and Cloudflare

Every Cloudflare-fronted page (atptour.com rankings, results and Challenger calendar; live-tennis.eu) goes through `scraper/browser.ts`. It launches the **installed Google Chrome** (`channel: "chrome"`) first: Playwright's bundled Chromium never clears atptour.com's managed challenge, which is how the ATP rankings for 2026-09-14 and 2026-09-28 were lost. `SCRAPER_BROWSER_CHANNEL=bundled` forces the bundled build. `gotoPastChallenge` throws `CloudflareChallengeError` rather than handing an interstitial to a parser.

`isChallengePage` must not match the bare `challenge-platform` path: every real atptour.com / live-tennis.eu page loads Cloudflare's passive beacon from `/cdn-cgi/challenge-platform/scripts/jsd/`.

### Player identity

Resolve players by the tour's own id, never by slug alone. `snapshot.ts` matches official ranking rows on `players.atp_id` (atptour.com's "s0ag") / `players.wta_id` (wtatennis.com's `data-player-id`) first, and the ranking page is the authority on those ids — it overwrites a conflicting stored id. Slug-only upserts created a second player every time the tour's spelling differed from ours. TennisExplorer's own player id lives in `players.te_slug`, learned only on proof (same week, rank and points as an official row).

### TennisExplorer rows

TE gives only `Surname I.`, a surname slug and no country. `scraper/te-player-resolver.ts` resolves within ONE tour and requires the initial to agree, returning null rather than guessing. `scraper/te-tournament-level.ts` stores a real tier: `X` (non-ranking: UTR, Laver Cup, Asian Games, BJK Cup), `ITF`, `CH50`-`CH175` (from the Challenger calendar), or the official WTA level of the same event that week. Never go back to deriving the level from the name alone — everything unknown became "A" (a 250).

### politeFetch and TLS fingerprints

`scraper/http.ts` enforces 1 req/sec/host throttle, a kill-switch (`SCRAPER_KILL_SWITCH=true`), and **falls back to spawning `curl --compressed`** on 403/429 or socket errors. Cloudflare (atptour.com) and TennisExplorer fingerprint Node's TLS handshake (JA3) and block it regardless of User-Agent. Curl's handshake passes. Don't try to add `undici` cipher tweaks — the curl path works and is opt-in only on failure.

### Projections runner

`scraper/projections/runner.ts` orchestrates two derivers:

- `derive-live-state.ts` — for each top-N player, finds their latest match in the lookback window (default 14 days) and infers `status ∈ {not_playing, in_progress, eliminated, won_tournament}`. Excludes tournaments that already have a Final on record (otherwise last month's Masters would re-award points).
- `derive-dropping-points.ts` — for each top-N player, the results that leave the ranking by the publish the live ranking projects to: next Monday, or — in the first week of a two-week event (Slam, 96-draw 1000) — the Monday after it ends (`drop-horizon.ts`). That is why Wuhan 2025 drops during Beijing 2026. WTA uses it outright; ATP adds only the part beyond next Monday to the published Dropping column.

Both feed `scraper/projections/calculator.ts` which produces `live_projections` rows.

The live total (`next_points`) is then set by the runner from three more pieces:

- `derive-week-events.ts` + `event-points.ts` — everything secured this week, **per event**: qualifier (Q3 slot / Slam bonus) and lucky-loser (lost Q round) points on top of the main draw, a WTA qualifier who loses her first match keeps only the qualifying points, ITF events priced by tier (prize money from the TennisExplorer tournament page). A draw for NEXT week (weekend qualifying) is not credited.
- **ATP best-of-N**: when a non-mandatory result drops and the player did not reach a main draw this week, the published Next Best takes the slot (`max(earned, nextBest) - drop`). Not in a Slam/1000 week.
- **WTA best-18** (`wta-best-n.ts`): each player's official per-event points from `api.wtatennis.com/tennis/players/{id}/matches` (`sources/wta-player-events.ts`, cached per week in `data/wta-player-events/`, ~10 min to fill for 300 players). Slams, combined 1000s and the Finals are mandatory and cannot be displaced; the number of slots (zero-pointers) is calibrated so the model reproduces the official total. This replaced the history-derived WTA dropping for every player with a `wta_id`.

Compare-Live projects the top `$Top + 100`, so a player who climbs into the compared top 200 this week has a projection. `compare-live.ts` pairs names the two sides spell differently through the official table (same rank, same points, same initials).

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
