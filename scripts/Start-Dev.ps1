#Requires -Version 5.1
<#
.SYNOPSIS
    Starts the Docker containers and the Next.js dev server.
.DESCRIPTION
    1. Starts PostgreSQL + pgAdmin via docker-compose
    2. Waits for the DB to be healthy
    3. Runs Drizzle migrations (db:push)
    4. Starts the Next.js dev server
#>

$Root = Split-Path $PSScriptRoot -Parent
Set-Location $Root

Write-Host "Starting Docker containers..." -ForegroundColor Cyan
docker compose up -d

Write-Host "Waiting for database to be ready..." -ForegroundColor Cyan
$maxAttempts = 30
$attempt = 0
do {
    $attempt++
    $health = docker inspect --format "{{.State.Health.Status}}" tennisrankings-db 2>$null
    if ($health -eq "healthy") { break }
    if ($attempt -ge $maxAttempts) {
        Write-Host "Database did not become healthy in time. Check: docker logs tennisrankings-db" -ForegroundColor Red
        exit 1
    }
    Write-Host "  Attempt $attempt/$maxAttempts — status: $health" -ForegroundColor Gray
    Start-Sleep -Seconds 2
} while ($true)

Write-Host "Database is ready." -ForegroundColor Green

Write-Host "Running database migrations (drizzle db:push)..." -ForegroundColor Cyan
pnpm db:push
if ($LASTEXITCODE -ne 0) {
    Write-Host "Migration failed. Check the error above." -ForegroundColor Red
    exit 1
}

Write-Host ""
Write-Host "All done! Starting Next.js dev server..." -ForegroundColor Green
Write-Host "  App:     http://localhost:3000" -ForegroundColor White
Write-Host "  pgAdmin: http://localhost:5050  (admin@tennisrankings.local / admin)" -ForegroundColor White
Write-Host ""

pnpm dev
