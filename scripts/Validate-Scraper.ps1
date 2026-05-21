#Requires -Version 5.1
<#
.SYNOPSIS
    Runs the local scraper quality gate.
.DESCRIPTION
    Fetches live ATP/WTA rankings via Playwright (or reuses cached HTML),
    runs the production parser + Zod validation + anomaly checks, prints
    a readiness report. Exit code 0 = READY, 1 = NOT READY.

    The first run downloads Chromium (~150MB) — subsequent runs are fast.

.PARAMETER Fresh
    Force a fresh live fetch instead of reusing cached HTML in scraper/__debug__.
.PARAMETER Tour
    Limit to one tour: 'atp' or 'wta'. Default: both.

.EXAMPLE
    .\scripts\Validate-Scraper.ps1
    .\scripts\Validate-Scraper.ps1 -Fresh
    .\scripts\Validate-Scraper.ps1 -Fresh -Tour atp
#>
param(
    [switch]$Fresh,
    [ValidateSet("atp", "wta", "")]
    [string]$Tour = ""
)

$Root = Split-Path $PSScriptRoot -Parent
Set-Location $Root

# Load DATABASE_URL from .env.local if needed (the validator itself
# doesn't hit the DB, but tsx loads .env eagerly for some setups)
if (-not $env:DATABASE_URL) {
    $envFile = Join-Path $Root ".env.local"
    if (Test-Path $envFile) {
        $line = Select-String -Path $envFile -Pattern '^DATABASE_URL=' | Select-Object -First 1
        if ($line) { $env:DATABASE_URL = $line.Line -replace '^DATABASE_URL="?|"?$', '' }
    }
}

# Make sure Chromium is installed for Playwright
Write-Host "Ensuring Playwright Chromium is installed..." -ForegroundColor Cyan
pnpm exec playwright install chromium | Out-Null

# Build argument list
$scriptArgs = @()
if ($Fresh) { $scriptArgs += "--fresh" }
if ($Tour)  { $scriptArgs += $Tour }

# Run validator directly via tsx so the args pass through cleanly
if ($scriptArgs.Count -gt 0) {
    pnpm exec tsx scraper/validate-report.ts @scriptArgs
} else {
    pnpm exec tsx scraper/validate-report.ts
}

exit $LASTEXITCODE
