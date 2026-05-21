#Requires -Version 5.1
<#
.SYNOPSIS
    Runs the live-projection pipeline for currently-running tournaments.
.DESCRIPTION
    For each tournament listed in scraper/projections/index.ts, loads the
    per-player draw state, computes the +/-, Next, Max projections, and
    upserts them into the live_projections table. Safe to run repeatedly.

    Suggested schedule during tournament weeks: every 4 hours via Windows
    Task Scheduler. Outside tournament weeks, no need to run at all.

.PARAMETER Tournament
    Optional. Restrict to one tournament slug (e.g. "roland-garros-2026").

.EXAMPLE
    .\scripts\Update-Projections.ps1
    .\scripts\Update-Projections.ps1 -Tournament roland-garros-2026

.NOTES
    To set up the recurring schedule (one-off, from an admin PowerShell):
        $action  = New-ScheduledTaskAction -Execute "pwsh" `
                     -Argument "-File C:\Users\MarcoMarchesi\.claude\Cowork\TennisRankings\scripts\Update-Projections.ps1"
        $trigger = New-ScheduledTaskTrigger -Daily -At 6:00am `
                     -RepetitionInterval (New-TimeSpan -Hours 4) `
                     -RepetitionDuration (New-TimeSpan -Hours 24)
        Register-ScheduledTask -TaskName "TennisRankings-Projections" `
                     -Action $action -Trigger $trigger
#>
param(
    [string]$Tournament = ""
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

# Verify DB container is running before we try to write
$state = docker inspect --format "{{.State.Status}}" tennisrankings-db 2>$null
if ($state -ne "running") {
    Write-Host "Database container is not running. Start it with: .\scripts\Start-Dev.ps1" -ForegroundColor Red
    exit 1
}

Write-Host "Running projection pipeline..." -ForegroundColor Cyan
if ($Tournament) {
    pnpm exec tsx scraper/projections/index.ts $Tournament
} else {
    pnpm exec tsx scraper/projections/index.ts
}

exit $LASTEXITCODE
