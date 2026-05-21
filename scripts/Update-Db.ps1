#Requires -Version 5.1
<#
.SYNOPSIS
    Applies the latest Drizzle schema changes to the local database.
.DESCRIPTION
    Runs `pnpm db:push` which introspects src/db/schema.ts and pushes
    any new tables, columns, or indexes to the running Docker Postgres.
    Safe to run multiple times.
#>

$Root = Split-Path $PSScriptRoot -Parent
Set-Location $Root

# Verify DB container is running
$state = docker inspect --format "{{.State.Status}}" tennisrankings-db 2>$null
if ($state -ne "running") {
    Write-Host "Database container is not running. Start it first with: .\scripts\Start-Dev.ps1" -ForegroundColor Red
    exit 1
}

Write-Host "Pushing schema changes to database..." -ForegroundColor Cyan
# Load DATABASE_URL from .env.local if not already set
if (-not $env:DATABASE_URL) {
    $envFile = Join-Path $Root ".env.local"
    if (Test-Path $envFile) {
        $line = Select-String -Path $envFile -Pattern '^DATABASE_URL=' | Select-Object -First 1
        if ($line) { $env:DATABASE_URL = $line.Line -replace '^DATABASE_URL="?|"?$', '' }
    }
}
pnpm drizzle-kit push --force

if ($LASTEXITCODE -eq 0) {
    Write-Host "Schema up to date." -ForegroundColor Green
} else {
    Write-Host "db:push failed. Check the error above." -ForegroundColor Red
    exit 1
}
