#Requires -Version 5.1
<#
.SYNOPSIS
    Pull the latest commits from GitHub on the current branch and refresh deps.

.DESCRIPTION
    Quick wrapper around `git pull --ff-only` plus a `pnpm install` so any
    new dependencies in package.json show up locally. Bails on a dirty
    working tree to avoid silent merge conflicts.

.PARAMETER NoInstall
    Skip the `pnpm install` step - useful when you only want commits, no
    package changes.

.EXAMPLE
    .\scripts\Pull-Latest.ps1
    .\scripts\Pull-Latest.ps1 -NoInstall
#>
param(
    [switch]$NoInstall
)

$Root = Split-Path $PSScriptRoot -Parent
Set-Location $Root

# Refuse to pull on a dirty tree of TRACKED files - a fast-forward could
# clobber local edits. Untracked files (?? prefix) are fine: a pull
# never touches files git doesn't know about.
$dirty = git status --porcelain | Where-Object { $_ -notmatch '^\?\?' }
if ($dirty) {
    Write-Host "Working tree has uncommitted changes to tracked files - commit or stash first:" -ForegroundColor Red
    Write-Host ($dirty -join "`n")
    exit 1
}

$branch = git rev-parse --abbrev-ref HEAD
Write-Host ">>> Fetching origin" -ForegroundColor Cyan
git fetch origin
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

Write-Host ">>> Pulling origin/$branch - fast-forward only" -ForegroundColor Cyan
git pull --ff-only
if ($LASTEXITCODE -ne 0) {
    Write-Host "Pull failed - likely diverged from origin. Inspect with: git log --oneline HEAD..origin/$branch" -ForegroundColor Red
    exit $LASTEXITCODE
}

if (-not $NoInstall) {
    Write-Host ">>> pnpm install" -ForegroundColor Cyan
    pnpm install
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
}

Write-Host ""
Write-Host "Up to date on $branch." -ForegroundColor Green
