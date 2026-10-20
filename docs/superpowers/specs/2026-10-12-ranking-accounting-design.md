# Ranking as Accounting — Design

**Date:** 2026-10-12
**Status:** approved direction (user, 2026-10-12: "start, deliver the whole plan")

## Problem

Our live ranking is computed by stacking corrections on top of a weekly
snapshot, and its correctness is judged against live-tennis.eu, a third party
with its own model. Each fix has been inferred from a handful of players on
one day, and several were wrong in a way that only showed a week later (the
Beijing/Wuhan drop rule of 2026-10-12 is the latest). We cannot tell a rules
bug from a data gap from LT lag, so progress is slow and regressions are
silent.

## Principle

A ranking total is the sum of a player's **counted results**. The ATP and WTA
publish every player's exact total every Monday. That publication is our
ground truth — not live-tennis.eu. Every rule and every data source is judged
by whether it reproduces the official numbers, week after week.

## Non-negotiables (apply to every phase)

1. **No fitting to a third party.** No fudge factors, per-player overrides or
   rules tuned until live-tennis.eu agrees. LT is a secondary in-week check.
2. **A mismatch is a finding, not a number to adjust.** Every residual is
   attributed (data gap, unmodelled rule, unknown) and reported.
3. **Unknown is explicit.** An event whose tier we do not know is flagged as a
   data gap. It is never scored as a default tier.
4. **Every rule cites a source** (rulebook section, or replay evidence across
   many weeks — never one or two players).
5. **The replay score is a gate.** A change may not lower the stored baseline.
   Tests are never edited to fit current output; a test changes only with a
   cited reason.
6. **Offline tests.** Unit and contract tests never touch the network; data
   comes from fixtures or the local archive cache.

## Ground truth available

| Source | What | Span |
|---|---|---|
| Sackmann archive (`Aneeshers/tennis-sackmann-archive`) | Official weekly rankings with points, all ranks (WTA also `tours` = events counted) | 2010 → 2026-06-08 |
| Sackmann archive | Every match: tour (`*_matches_YYYY`), qualifying + Challenger / WTA 125 (`atp_matches_qual_chall`, `wta_matches_qual_itf`), ITF (`atp_matches_futures`, `wta_matches_qual_itf`), with stable per-edition `tourney_id`, `tourney_level`, `draw_size`, `round`, `winner_entry`/`loser_entry` | 2022 → 2026-05-25 |
| Our scraper (`rankings_snapshots` with `scrape_run_id`) | Official ranking ATP/WTA 1-500 | sporadic weeks from 2026-05-18 |
| atptour.com rankings-breakdown | The official ATP ledger itself, per player | live |

Player ids in the archive rankings equal the ids in its match files, so the
replay needs no name matching at all.

Known gaps up front: ATP Challenger rows carry level `C` with no tier;
the WTA ITF points table below the winner is not in `docs/ranking-rules.md`;
the points table in `scraper/config/points-table.ts` is 2026-only; United
Cup scoring is not modelled.

## Phases

Each phase ships working, measured software. Each later phase gets its own
detailed plan when it starts, written from the previous phase's replay
numbers rather than from guesses.

### Phase 1 — Replay harness (measurement first)

Build `scraper/replay/`: download-and-cache the archive, build editions and
per-player results from it, compute every player's total at every official
week with an explicit rules module, and score it against the official total.

Two modes:
- **full**: ledger total (52-week window, best-N) vs official total.
- **delta**: official(N) + results entering − results leaving vs official(N+1).
  Isolates week-to-week rules from long-history data gaps.

Output: a markdown report per run (score per week, residuals attributed to
causes), a trend log, a committed `baseline.json`, and `pnpm replay:check`
which fails when a score drops below baseline.

**Acceptance:** runs offline after one cache fill; replays 2023-01 → 2026-06
for both tours; every residual carries a cause; baseline committed; the
measured numbers recorded in this doc.

### Phase 1b — Counting slots (done 2026-10-13, variant PROVISIONAL)

The ledger fills the tours' slots (ATP: 4 Slams, 8 mandatory 1000s — Monte
Carlo excluded — then 7 others, 6 from 2026; WTA: 4 Slams, best 6 of 7
combined 1000s, best 1 of 3 non-combined, then 7 others; Finals on top). Only
main-draw results take a slot. Points the rules digest leaves open are
explicit variants (`pnpm replay -- --rules <variant>`), chosen by replay.

**The judge is the clean subset** — player-weeks with no data gap (unknown
tier, unsourced era, incomplete draw). The overall rates are biased by the
gaps in opposite directions: full mode rewards counting more results (they
pad totals where gap events score 0), delta mode rewards counting fewer (it
"abstains" where the official total moves on results we score 0). A first
pass judged on overall delta and wrongly rejected refill; the independent
review caught it.

Delta mode is `official(W0) + ledger(W1) − ledger(W0)` with one rank for both
ledgers; charging every entering and leaving result in full made all
variants score the same.

| variant (exact, clean subset) | ATP delta (n=981) | ATP full (n=973) | WTA delta (n=2801) | WTA full (n=2811) |
|---|---|---|---|---|
| flat (Phase 1) | 70.9% | 10.5% | 75.8% | 9.2% |
| slots | 72.4% | 13.8% | 74.9% | 6.0% |
| slots+overflow | 72.4% | 13.8% | 76.8% | 12.1% |
| slots+refill | 72.0% | 11.0% | 75.9% | 7.0% |
| slots+refill+overflow | 72.0% | 11.0% | 78.7% | 12.3% |
| **slots+overflow+refill>50** (default) | **72.6%** | **14.4%** | **78.7%** | **12.9%** |
| slots+overflow+refill>100 | 72.5% | 14.1% | 77.9% | 12.2% |
| slots+overflow+refill>200 | 72.2% | 14.2% | 77.1% | 12.2% |

- **refill>50:** an unused Slam/1000 slot is refilled from the others only for
  a player ranked below 50 — "mandatory if accepted" (docs :21), acceptance
  follows ranking. The WTA margin is meaningful (~53 player-weeks); the ATP
  margins are a handful of player-weeks. Re-run after Phase 2 grows the
  clean subset; the cutoff (50) is a sampled value, not a rulebook constant.
- **overflow:** a 1000 result beyond its slot may count among the others.
- The baseline gate now also guards the clean exact rate.
- Not modelled: WTA best-16 before 2024 (all 2023 results carry
  `points_era`, so they never enter the clean subset).

### Phase 2a — Data gaps (done 2026-10-13)

Plan `docs/superpowers/plans/2026-10-13-phase2a-data-gaps.md`; every ruling
with its numbers in `.superpowers/sdd/2026-10-13-phase2a-data-gaps/progress.md`.

- **Season tables** (`scraper/replay/points-eras.ts`): each result is scored
  with the table of its own season, 2022-2026, transcribed from Wikipedia's
  season pages (ATP/WTA tour, Challenger, WTA 125, ITF men/women). A
  tier/season no source covers is a `points_era:<tour>:<tier>:<season>` gap.
- **Challenger tiers 2022-2025** from Wikipedia's "<Y> ATP Challenger Tour"
  (`pnpm scraper:challenger-history`); 2022 had its own tiers (80/90/110).
- **United Cup** scored per match (`united-cup.ts`), 2024-2026.
- **Rules found by replay** (each beat the alternative across thousands of
  player-weeks): ITF results (W15 + the next tier up, M15, M25) enter and
  leave a week later than tour events; a WTA qualifier who loses her first
  main-draw match keeps only the qualifying points; WTA counted best 16
  before 2024 (sourced).
- **Live table fixed** (`points-table.ts`): Challenger first round 0 plus
  qualifying values (the docs' "R32" column was the qualifier column), M15/M25
  R16 1, WTA non-combined 1000 / 125 qualifying, WTA 500 56-draw row. Each
  confirmed on the 2026 weeks.
- **The ATP changed its qualifying values for 2026**: the docs' 2026 table and
  Wikipedia's 2024/25 table each fit their own season and lose on the other.
- **Counting variant re-judged** on the grown clean subset: refill for every
  player beats the rank-50 cutoff on both tours; default now
  `slots+refill+overflow`. ATP "flat" scores marginally higher but flips by
  season, so the written slot rule stands.

| (clean subset, exact) | ATP delta | ATP full | WTA delta | WTA full |
|---|---|---|---|---|
| Phase 1b | 72.6% of 981 | 14.4% of 973 | 78.7% of 2,801 | 12.9% of 2,811 |
| Phase 2a | **89.3% of 66,734** | **44.2% of 67,243** | **77.5% of 69,061** | **32.0% of 69,870** |

Overall (all player-weeks): ATP delta 47.9% → 89.0% (≤10 96.0%), ATP full
0.8% → 42.4% (≤10 75.2%); WTA delta 60.5% → 75.3% (≤10 91.2%), WTA full
1.2% → 27.2% (≤10 63.2%).

Review (opus) verified every transcription; fixed: WTA Paris 2024 Olympics
scored 0, United Cup wins over unranked opponents now a gap, 2024+ ITF "+H"
back to a gap (evidence too thin), live WTA qualifying labels (two-round
draws were stored Q2/Q3; now Q1/Q2 like TennisExplorer).

Open: stored WTA qualifying rows keep the old Q2/Q3 labels until
re-ingested; the WTA trails (2026 weeks ~69% clean delta; misses cluster on ITF
results entering/leaving and on steps where no known result moved — likely
matches missing from the archive); 2023 United Cup and WTA Finals format;
2022 ITF W15; CH50 48-draw R48 vs R32 unverified.

### Phase 2 — Canonical event and match model

Introduce `edition_key` (tour + official event id + season) and a date-free
`match_key` (edition + round + both player ids). Every writer
(`atp-results`, `wta-results`, TennisExplorer, archive backfill) maps into
them; `player_recent_matches` gains both columns, populated for all stored
rows; every reader dedupes on `(player_id, match_key)`. Tiers are stored per
edition (Challenger history fetched, not defaulted). Retire the
`distinct on (player, played_on, opponent)` contract in CLAUDE.md.

**Acceptance:** zero logical matches stored twice; every reader on the new
key; replay score not lower than Phase 1 baseline.

### Phase 3 — Per-player ledger with Monday reconciliation

A persisted ledger (`player_points_breakdown`, already in the schema and
empty) holding each counted result, its points and its drop date, built by
the same engine the replay uses. Every Monday after `scraper:refresh`, the
ledger total is reconciled against the official total for every player in
our top 800; residuals are written to a reconciliation report with causes.

**Acceptance:** reconciliation runs in Weekly-Update; reported exact-match
rate at or above the replay's for the same tour; every non-exact player has
an attributed cause.

### Phase 4 — ATP breakdown ingestion

Scrape atptour.com's per-player rankings-breakdown (system Chrome via
`scraper/browser.ts`) into the ledger as authoritative ATP rows, replacing
reconstruction for ATP. Replay keeps validating the reconstruction so the
WTA side, which has no breakdown source, benefits from rules learned on ATP.

**Acceptance:** ATP ledger reconciles exactly for ≥ 99% of the top 500.

### Phase 5 — Live engine on the ledger

Live points = ledger − results dropping by the projected publish + in-week
results, using the replay engine's rules. Replace `derive-live-points`,
`derive-dropping-points` and `drop-horizon` logic with ledger queries.
Compare-Live keeps running as a secondary check; its report states whether a
difference is ours (rule/data) or LT's (lag/model).

**Acceptance:** projections derive from the ledger; the old derivers are
deleted; Compare-Live by-player numbers no worse than before the switch.

## Measured baseline

Phase 1, 2026-10-13. Window 2023-01-02 .. 2026-06-08, top 500, per player-week.

After the independent review fixes (2026-10-13T07:35):

```
atp-full=0.7%(<=10 5.3%)  atp-delta=47.3%(<=10 77.8%)  wta-full=0.8%(<=10 4.0%)  wta-delta=57.6%(<=10 82.2%)
```

Top residual causes (player-weeks; a player-week can carry several):

| run | causes |
|---|---|
| ATP full | points_era (2022-24) 86,001 · challenger_tier 66,813 · best_n 5,982 · united_cup 3,416 · incomplete_edition 3,354 |
| ATP delta | points_era (2022-24) 22,986 · challenger_tier 21,769 · unexplained 5,337 · best_n 695 |
| WTA full | itf_w* (every W tier, 36-51k each) · points_era (2022-24) · best_n |
| WTA delta | points_era (2022-24) 15,845 · unexplained 7,008 · itf_w* |

`points_era`: results from before the 2025 season are scored with the
2025/26 tables and flagged — the WTA reworked its 500/250 values in 2024, and
the non-combined 1000s paid 900 before 2025. The review also corrected
non-Slam qualifying (the table's Q3 slot is the qualifying winner's value)
and the 96-draw Masters qualifying table to 25/16/8 (docs :64-66), which the
live projections use too. `unexplained` fell from 17,320 / 18,416 to
5,337 / 7,008 once delta mode attributed best-N displacement.

(First run, before review: atp-delta 45.4%, wta-delta 56.8%.)

Hand-verified (Sinner, Sabalenka 2024-2026): every counted result maps to
the right event, round and week. Findings from those traces, all now fixed
or queued:

- Archive levels are inconsistent (2023 Tour Finals tagged `A`): Finals are
  recognised by name. Fixed.
- ATP Finals leave a week early (rules doc :11, confirmed 2024-11-11). Fixed.
- A final on a Monday counts in that Monday's ranking (Cincinnati 2025), and
  1000s are two-week only with a 96+ draw (Canada 2023 was 56). Fixed.
- **ATP counting structure** (`best_n`): the official total never moves when a
  small 250 result leaves — 4 Slams + 8 mandatory 1000s + best 7 *others*,
  not "best 19 by points". Queued (Phase 1b).
- **WTA non-combined 1000s count best 1 of 3** (Sabalenka +65/+120 = her
  Doha and Dubai beside her Wuhan title). Queued (Phase 1b).
- Data gaps: ATP Challenger tiers before 2026, WTA ITF points tables, United
  Cup scoring. Queued (Phase 2 data work).

Full mode near 0% is expected at this stage: a single missing Challenger
tier or ITF table anywhere in 52 weeks makes a player inexact. Delta mode
isolates week-to-week rules and is the better progress signal until the
data gaps close.
