#Requires -Version 5.1
<#
.SYNOPSIS
    Runs the full weekly scraper pipeline.

.DESCRIPTION
    Intended to be triggered Monday morning (after ATP/WTA publish ~02:00 UTC).
    Steps, in order:
        1. scraper:refresh           — latest official ATP/WTA + race rankings.
        2. scraper:backfill-history  — pulls ranking history for any new top-50 entrant.
        3. scraper:backfill-matches  — refreshes per-player recent matches.
        4. scraper:leaderboards      — Tennis Abstract MCP leaderboards.
        5. scraper:enrich-players    — Wikidata photos + Wikipedia infobox (slow; rate-limited).
        6. scraper:projections       — live projections off the freshly-refreshed snapshot.

    Each step is independent: a failure in one is logged but doesn't abort
    the later steps. The exit code is the count of failed steps.

.PARAMETER SkipEnrich
    Omits the Wikipedia/Wikidata enrichment step (saves ~2 minutes — useful
    for weekly runs where photos rarely change anyway).

.PARAMETER SkipBackfill
    Omits both backfill steps (history + matches). Useful for a "fast" run
    that only refreshes current rankings + leaderboards + projections.

.EXAMPLE
    .\scripts\Weekly-Update.ps1
    .\scripts\Weekly-Update.ps1 -SkipEnrich

.NOTES
    To schedule (run from an admin PowerShell, one-time):

        $action  = New-ScheduledTaskAction `
                     -Execute "pwsh" `
                     -Argument "-File C:\Users\MarcoMarchesi\.claude\Cowork\TennisRankings\scripts\Weekly-Update.ps1"
        $trigger = New-ScheduledTaskTrigger -Weekly -DaysOfWeek Monday -At 04:00am
        Register-ScheduledTask -TaskName "TennisRankings-Weekly" `
                     -Action $action -Trigger $trigger -Description "Weekly tennis-rankings refresh"

    Verify with: Get-ScheduledTask "TennisRankings-Weekly"
#>
param(
    [switch]$SkipEnrich,
    [switch]$SkipBackfill
)

$Root = Split-Path $PSScriptRoot -Parent
Set-Location $Root

# Load DATABASE_URL from .env.local if not already set
if (-not $env:DATABASE_URL) {
    $envFile = Join-Path $Root ".env.local"
    if (Test-Path $envFile) {
        $line = Select-String -Path $envFile -Pattern '^DATABASE_URL=' | Select-Object -First 1
        if ($line) { $env:DATABASE_URL = $line.Line -replace '^DATABASE_URL="?|"?$', '' }
    }
}

# Confirm DB is reachable before doing anything
$state = docker inspect --format "{{.State.Status}}" tennisrankings-db 2>$null
if ($state -ne "running") {
    Write-Host "Database container is not running. Start it with: .\scripts\Start-Dev.ps1" -ForegroundColor Red
    exit 1
}

$failures = 0
$timestamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
Write-Host "===========================================================" -ForegroundColor Cyan
Write-Host " Weekly update started at $timestamp" -ForegroundColor Cyan
Write-Host "===========================================================" -ForegroundColor Cyan

function Invoke-Step {
    param([string]$Label, [string]$Cmd)
    Write-Host ""
    Write-Host ">>> $Label" -ForegroundColor Cyan
    Invoke-Expression $Cmd
    if ($LASTEXITCODE -ne 0) {
        Write-Host "    FAILED with exit $LASTEXITCODE" -ForegroundColor Red
        $script:failures++
    } else {
        Write-Host "    OK" -ForegroundColor Green
    }
}

Invoke-Step "1/7 Refresh ATP+WTA+race rankings"  "pnpm scraper:refresh --no-backfill"
Invoke-Step "2/7 Expand to top-800 via Tennis Abstract" "pnpm scraper:expand-rankings"
if (-not $SkipBackfill) {
    Invoke-Step "3/7 Backfill historical rankings (Tennis Abstract)" "pnpm scraper:backfill-history"
    Invoke-Step "4/7 Backfill recent matches (Tennis Abstract)"      "pnpm scraper:backfill-matches"
} else {
    Write-Host ""; Write-Host ">>> 3-4/7 Backfill steps SKIPPED" -ForegroundColor Yellow
}
Invoke-Step "5/7 Refresh MCP leaderboards"     "pnpm scraper:leaderboards"
if (-not $SkipEnrich) {
    Invoke-Step "6/7 Wikidata + Wikipedia enrichment + photo download" "pnpm scraper:enrich-players"
} else {
    Write-Host ""; Write-Host ">>> 6/7 Enrichment SKIPPED" -ForegroundColor Yellow
}
Invoke-Step "7/7 Compute live projections"     "pnpm scraper:projections"

Write-Host ""
Write-Host "===========================================================" -ForegroundColor Cyan
if ($failures -eq 0) {
    Write-Host " All steps completed successfully." -ForegroundColor Green
} else {
    Write-Host " Completed with $failures failed step(s). See above." -ForegroundColor Red
}
Write-Host "===========================================================" -ForegroundColor Cyan

exit $failures
