#Requires -Version 5.1
<#
.SYNOPSIS
    Hourly TennisExplorer pull: scrape today's finished matches + refresh
    live projections off the fresher data.

.DESCRIPTION
    Scope is intentionally narrow versus Weekly-Update.ps1. This is meant
    to fire every hour from Task Scheduler, so it does the bare minimum:

        1. scraper:daily-matches   — TennisExplorer match results for the
                                     last 2 days (today + yesterday).
        2. scraper:projections     — recompute live projections so the
                                     "in_progress" status flips as soon
                                     as a player's match lands.

    Tennis Abstract's CSVs lag tournaments by 1-3 weeks, so this hourly
    job is how the player profile widgets, surface splits, and live
    projections stay current. The weekly job (Weekly-Update.ps1) still
    owns deeper history + enrichment.

    A failure in step 1 (e.g. TennisExplorer is down) is logged but
    doesn't block step 2 — yesterday's TE rows are still useful.

.PARAMETER LookbackDays
    Override how many days back the daily-matches scraper walks. Default
    2 (today + yesterday). Pass a higher value for a manual catch-up run.

.EXAMPLE
    .\scripts\Hourly-Update.ps1
    .\scripts\Hourly-Update.ps1 -LookbackDays 7

.NOTES
    To schedule (run from an admin PowerShell, one-time):

        $action  = New-ScheduledTaskAction `
                     -Execute "pwsh" `
                     -Argument "-File C:\Users\MarcoMarchesi\.claude\Cowork\TennisRankings\scripts\Hourly-Update.ps1"
        $trigger = New-ScheduledTaskTrigger -Once -At (Get-Date).Date.AddHours(6) `
                     -RepetitionInterval (New-TimeSpan -Hours 1) `
                     -RepetitionDuration ([TimeSpan]::MaxValue)
        Register-ScheduledTask -TaskName "TennisRankings-Hourly" `
                     -Action $action -Trigger $trigger `
                     -Description "Hourly TennisExplorer pull + projection refresh"

    Verify with: Get-ScheduledTask "TennisRankings-Hourly"
#>
param(
    [int]$LookbackDays = 2
)

$Root = Split-Path $PSScriptRoot -Parent
Set-Location $Root

if (-not $env:DATABASE_URL) {
    $envFile = Join-Path $Root ".env.local"
    if (Test-Path $envFile) {
        $line = Select-String -Path $envFile -Pattern '^DATABASE_URL=' | Select-Object -First 1
        if ($line) { $env:DATABASE_URL = $line.Line -replace '^DATABASE_URL="?|"?$', '' }
    }
}

$state = docker inspect --format "{{.State.Status}}" tennisrankings-db 2>$null
if ($state -ne "running") {
    Write-Host "Database container is not running. Skipping hourly update." -ForegroundColor Yellow
    exit 0
}

$failures = 0
$timestamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
Write-Host ">>> Hourly update $timestamp (lookback=${LookbackDays}d)" -ForegroundColor Cyan

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

Invoke-Step "1/2 TennisExplorer daily matches"  "pnpm scraper:daily-matches -- --lookback $LookbackDays --lookahead 4"
Invoke-Step "2/2 Recompute live projections"    "pnpm scraper:projections"

if ($failures -eq 0) {
    Write-Host ""
    Write-Host "Hourly update OK." -ForegroundColor Green
} else {
    Write-Host ""
    Write-Host "Hourly update finished with $failures failed step(s)." -ForegroundColor Red
}

exit $failures
