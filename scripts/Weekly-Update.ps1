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

    Output goes to logs\weekly-update-<yyyy-MM-dd>.log as well as the
    console. Without it a scheduled run that exits 1 (as on 2026-10-12)
    leaves no trace of which step failed. Lines are appended as they arrive,
    so a run killed by sleep/shutdown still shows how far it got.

    Holds the pipeline lock (Pipeline-Lock.ps1) for the whole run, so a
    Compare-Live started by the same logon waits for this to finish.

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

if (-not (Test-Path "logs")) { New-Item -ItemType Directory "logs" | Out-Null }
$transcript = "logs\weekly-update-$(Get-Date -Format 'yyyy-MM-dd').log"
Get-ChildItem "logs" -Filter "weekly-update-*.log" -ErrorAction SilentlyContinue |
    Where-Object { $_.LastWriteTime -lt (Get-Date).AddDays(-90) } |
    Remove-Item -Force -ErrorAction SilentlyContinue

function Write-Log([string]$Message, [string]$Color = "Gray") {
    $line = "[{0}] {1}" -f (Get-Date -Format "HH:mm:ss"), $Message
    Write-Host $line -ForegroundColor $Color
    Add-Content -Path $transcript -Value $line -Encoding utf8
}

. (Join-Path $PSScriptRoot "Pipeline-Lock.ps1")
if (-not (Enter-PipelineLock -OnWait { param($m) Write-Log $m Yellow })) {
    Write-Log "FATAL: pipeline lock still held after 120 min - another run is stuck" Red
    exit 1
}

# Load DATABASE_URL from .env.local if not already set
if (-not $env:DATABASE_URL) {
    $envFile = Join-Path $Root ".env.local"
    if (Test-Path $envFile) {
        $line = Select-String -Path $envFile -Pattern '^DATABASE_URL=' | Select-Object -First 1
        if ($line) { $env:DATABASE_URL = $line.Line -replace '^DATABASE_URL="?|"?$', '' }
    }
}

# Confirm DB is reachable before doing anything. We only check the local
# Docker container when DATABASE_URL points at localhost — when it points
# at Neon (or any remote host), the local container is irrelevant.
if ($env:DATABASE_URL -match "@localhost|@127\.0\.0\.1") {
    $state = docker inspect --format "{{.State.Status}}" tennisrankings-db 2>$null
    if ($state -ne "running") {
        Write-Log "FATAL: database container is not running. Start it with: .\scripts\Start-Dev.ps1" Red
        exit 1
    }
    Write-Log "Target: local Docker container" DarkGray
} else {
    $maskedUrl = $env:DATABASE_URL -replace ':[^@]+@', ':****@'
    Write-Log "Target: $maskedUrl" DarkGray
}

$failures = 0
$failedSteps = @()
Write-Log "=== Weekly update starting (skipEnrich=$SkipEnrich skipBackfill=$SkipBackfill) ===" Cyan

function Invoke-Step {
    param([string]$Label, [string]$Cmd)
    Write-Log ">>> $Label" Cyan
    $started = Get-Date
    # Stream each line to console + transcript as it arrives, so a killed run
    # still records how far it got.
    & cmd /c "$Cmd 2>&1" | ForEach-Object {
        Write-Host "    $_"
        Add-Content -Path $transcript -Value "    $_" -Encoding utf8
    }
    $code = $LASTEXITCODE
    $secs = [int]((Get-Date) - $started).TotalSeconds
    if ($code -ne 0) {
        Write-Log "    FAILED (exit $code, ${secs}s)" Red
        $script:failures++
        $script:failedSteps += $Label
    } else {
        Write-Log "    OK (${secs}s)" Green
    }
}

Invoke-Step "1/7 Refresh ATP+WTA+race rankings"  "pnpm scraper:refresh --no-backfill"
Invoke-Step "2/7 Expand ranks 501-800 via TennisExplorer" "pnpm scraper:expand-rankings"
# Challenger tiers for TennisExplorer's Challenger rows (atptour.com calendar).
# A failure keeps the stored scraper/config/challenger-calendar.json.
Invoke-Step "2b/7 Refresh ATP Challenger calendar" "pnpm scraper:challenger-calendar"
if (-not $SkipBackfill) {
    Invoke-Step "3/7 Backfill historical rankings (Tennis Abstract)" "pnpm scraper:backfill-history"
    Invoke-Step "4/7 Backfill recent matches (Tennis Abstract)"      "pnpm scraper:backfill-matches"
} else {
    Write-Log ">>> 3-4/7 Backfill steps SKIPPED" Yellow
}
Invoke-Step "5/7 Refresh MCP leaderboards"     "pnpm scraper:leaderboards"
if (-not $SkipEnrich) {
    Invoke-Step "6/7 Wikidata + Wikipedia enrichment + photo download" "pnpm scraper:enrich-players"
} else {
    Write-Log ">>> 6/7 Enrichment SKIPPED" Yellow
}
Invoke-Step "7/7 Compute live projections"     "pnpm scraper:projections"

if ($failures -eq 0) {
    Write-Log "=== Weekly update finished: all steps OK ===" Green
} else {
    Write-Log "=== Weekly update finished: $failures failed step(s): $($failedSteps -join '; ') ===" Red
}
Exit-PipelineLock

exit $failures
