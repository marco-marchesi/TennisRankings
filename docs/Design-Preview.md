# Design preview

A static HTML mock of the 10 most important screens lives at
[`docs/preview.html`](./preview.html). Open it directly in a browser
(no build step, no JS frameworks) or via GitHub Pages once
`/docs` is published.

## Screens covered

| # | Screen | Route | Highlights |
|---|---|---|---|
| 01 | **Homepage** | `/` | Hero + dual ATP/WTA Top 10 with rank deltas |
| 02 | **Rankings** | `/rankings/{atp,wta}` | Full table, breadcrumbs, JSON-LD, ARIA caption |
| 03 | **Projection** | `/rankings/projection` | The wedge feature: Now → Projected with green/red Δ |
| 04 | **Player profile** | `/players/[slug]` | Avatar, form widget (CB-safe), surface heatmap, ranking history chart |
| 05 | **Head-to-head** | `/players/[slug]/h2h/[opponent]` | Total / by surface / match list |
| 06 | **Tournament** | `/tournaments/[slug]` | Category, prize money, past winners (SportsEvent LD) |
| 07 | **Search dialog** | overlay | `/` shortcut, pg_trgm-backed, AbortController |
| 08 | **Cookie consent** | global | GDPR gate; analytics + ads blocked until accept |
| 09 | **Mobile** | global | Sticky brand-only header, collapsed columns, 44px tap targets |
| 10 | **A11y + SEO + perf budgets** | CI | Lighthouse ≥ 95 across all categories |

## Design tokens (from `src/styles/globals.css`)

| Token | Value |
|---|---|
| Font (UI) | Inter (variable) |
| Font (editorial) | Instrument Serif |
| Up | `#00e87a` (electric green) |
| Down | `#ff3b5c` (danger red) |
| Hold | `#9ca3af` (neutral) |
| Background (dark) | `oklch(0.16 0.02 250)` |
| Background (light) | `oklch(0.99 0.005 250)` |

Numbers always use `font-variant-numeric: tabular-nums`. Colour is
never the only signal — every delta carries a shape (`▲ ▼ –`) AND a
screen-reader-only verbal description.

## Why a static HTML preview?

Because the live app needs Neon Postgres, Resend keys, and a Fly worker
to run — none of which a reviewer has. The static preview lets anyone
look at the design without spinning up infrastructure. The mock data on
each screen matches `src/lib/mock-data.ts`, so the live app will look
identical once the scraper has filled the DB.

## How to open it locally

```bash
# from repo root
xdg-open docs/preview.html      # Linux
open docs/preview.html           # macOS
start docs/preview.html          # Windows
```

Or push to GitHub Pages by enabling Pages on `/docs` from the repo
settings. The URL will be:

```
https://marco-marchesi.github.io/TennisRankings/preview.html
```

## How to mirror in the GitHub wiki

GitHub wiki pages are stored in a separate git repo at
`https://github.com/marco-marchesi/TennisRankings.wiki.git`. To mirror
this preview:

```bash
git clone https://github.com/marco-marchesi/TennisRankings.wiki.git
cd TennisRankings.wiki
# wiki pages must be .md (or .textile) — full HTML inside a fenced
# block won't render, so the pattern is to link to the raw file
cat > Design-Preview.md <<'EOF'
# Design preview

[Open the static preview](https://marco-marchesi.github.io/TennisRankings/preview.html)
or browse the raw file:
[`docs/preview.html`](https://github.com/marco-marchesi/TennisRankings/blob/main/docs/preview.html).
EOF
git add Design-Preview.md && git commit -m "Add design preview page" && git push
```

The MCP GitHub server doesn't expose wiki write APIs, so the bootstrap
above has to be run once by hand. After that, every refresh of
`docs/preview.html` flows through automatically — no wiki edits needed.
