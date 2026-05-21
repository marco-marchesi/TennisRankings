#Requires -Version 5.1
<#
.SYNOPSIS
    Stops the Docker containers.
.PARAMETER RemoveVolumes
    If specified, also removes the persistent database volume (destructive!).
#>
param(
    [switch]$RemoveVolumes
)

$Root = Split-Path $PSScriptRoot -Parent
Set-Location $Root

if ($RemoveVolumes) {
    Write-Host "Stopping containers and removing volumes (all data will be lost)..." -ForegroundColor Yellow
    docker compose down -v
} else {
    Write-Host "Stopping containers (data is preserved)..." -ForegroundColor Cyan
    docker compose down
}

Write-Host "Done." -ForegroundColor Green
