<#
.SYNOPSIS
    Daily accuracy check: refresh in-week data, then diff our numbers against
    live-tennis.eu and write the differences to a log file.

.DESCRIPTION
    Three steps, in this order for a reason:

      1. atp-results     ATP results from atptour.com (the official source)
      2. daily-matches   TennisExplorer, as a FALLBACK for events atptour
                         does not cover (Challengers, ITF)
      3. projections      recompute live points from those matches
      4. compare-live     diff against live-tennis.eu and write the report

    Step 1 is preferred over step 2 wherever both have a match: atptour.com
    gives real per-match dates, an explicit winner and stable ATP player ids,
    where TennisExplorer needs one request per match and supplies none of
    those. The dedupe ordering in the derivers ranks atp_site first.

    Step 2 is expected to FAIL while a proxy blocks tennisexplorer.com. That
    is why it comes second and why its failure does not stop the run.

    Skipping step 1 makes the report meaningless. live-tennis.eu updates as
    each match finishes; we only know what the last scrape stored. On
    2026-09-04 that produced a textbook false positive: we held only Zverev's
    1R win, so we credited him a reached-R64 (50) and showed 7,740, while LT
    had his R64 win too and showed 7,790. Identical rule, one match of lag.

    Step 1 is cheap now that scrape-daily-matches skips the per-match detail
    fetch for matches already stored, so a short lookback costs seconds.

.PARAMETER LookbackDays
    Days of finished matches to (re-)pull. Default 3 - enough to catch a
    match that finished late in the previous UTC day, plus any TennisExplorer
    corrections to a result already recorded.

.PARAMETER SkipRefresh
    Compare against whatever is already stored. Useful when investigating a
    specific report, or when the scraper is busy with a backfill.

.PARAMETER Top
    How deep to compare. Default 200.

.NOTES
    Register (from the repo root):
      ./scripts/Register-Tasks.ps1

    Or by hand:
      $a = New-ScheduledTaskAction -Execute "powershell.exe" `
             -Argument "-NoProfile -ExecutionPolicy Bypass -File `"$PWD\scripts\Compare-Live.ps1`"" `
             -WorkingDirectory $PWD
      $t = New-ScheduledTaskTrigger -Daily -At 07:30
      Register-ScheduledTask -TaskName "TennisRankings-CompareLive" -Action $a -Trigger $t

    Output:
      logs\live-diff-<yyyy-MM-dd>.log   full report for that day
      logs\live-diff-trend.log          one line per run, for grepping progress
      logs\compare-live-<yyyy-MM-dd>.log  transcript of this wrapper
#>
param(
    [int]$LookbackDays = 3,
    [switch]$SkipRefresh,
    [int]$Top = 200
)

$ErrorActionPreference = "Continue"
$Root = Split-Path $PSScriptRoot -Parent
Set-Location $Root

if (-not (Test-Path "logs")) { New-Item -ItemType Directory "logs" | Out-Null }
$today = Get-Date -Format "yyyy-MM-dd"
$transcript = "logs\compare-live-$today.log"

# Prune transcripts older than 30 days so this does not grow without bound.
Get-ChildItem "logs" -Filter "compare-live-*.log" -ErrorAction SilentlyContinue |
    Where-Object { $_.LastWriteTime -lt (Get-Date).AddDays(-30) } |
    Remove-Item -Force -ErrorAction SilentlyContinue
Get-ChildItem "logs" -Filter "live-diff-2*.log" -ErrorAction SilentlyContinue |
    Where-Object { $_.LastWriteTime -lt (Get-Date).AddDays(-30) } |
    Remove-Item -Force -ErrorAction SilentlyContinue

function Write-Log([string]$Message) {
    $line = "[{0}] {1}" -f (Get-Date -Format "HH:mm:ss"), $Message
    Write-Output $line
    Add-Content -Path $transcript -Value $line -Encoding utf8
}

Write-Log "=== Compare-Live starting (lookback=$LookbackDays top=$Top skipRefresh=$SkipRefresh) ==="

# DATABASE_URL: prefer the environment, else read .env.local. tsx does not
# load .env.local by itself (Next.js does, the scraper does not).
if (-not $env:DATABASE_URL) {
    if (Test-Path ".env.local") {
        $line = Select-String -Path ".env.local" -Pattern '^DATABASE_URL=' | Select-Object -First 1
        if ($line) {
            $env:DATABASE_URL = ($line.Line -replace '^DATABASE_URL=', '').Trim('"').Trim("'")
        }
    }
}
if (-not $env:DATABASE_URL) {
    Write-Log "FATAL: DATABASE_URL not set and not found in .env.local"
    exit 2
}

# Only require the local Docker container when the URL actually points at it.
if ($env:DATABASE_URL -match '@(localhost|127\.0\.0\.1)') {
    $running = docker ps --filter "name=tennisrankings-db" --format "{{.Names}}" 2>$null
    if (-not $running) {
        Write-Log "FATAL: DATABASE_URL is local but the tennisrankings-db container is not running"
        exit 2
    }
}

$failures = 0
$optionalFailures = 0

function Invoke-Step {
    # -Optional marks a step whose failure must NOT fail the run. The
    # TennisExplorer fallback is the case: it is blocked by the network, so
    # counting it would mark every single day as failed and train us to
    # ignore the exit code entirely. An optional failure is logged loudly and
    # shows up in the report's staleness banner instead.
    param([string]$Label, [string]$Command, [switch]$Optional)
    Write-Log ">>> $Label"
    $output = & cmd /c "$Command 2>&1"
    $code = $LASTEXITCODE
    foreach ($l in $output) { Add-Content -Path $transcript -Value "    $l" -Encoding utf8 }
    if ($code -ne 0) {
        if ($Optional) {
            Write-Log "    FAILED (exit $code) - optional step, run continues"
            $script:optionalFailures++
        } else {
            Write-Log "    FAILED (exit $code)"
            $script:failures++
        }
    } else {
        Write-Log "    OK"
    }
    return $code
}

if (-not $SkipRefresh) {
    # Official source first. One page per in-progress tournament.
    Invoke-Step "1/4 ATP results from atptour.com" `
        "pnpm scraper:atp-results" | Out-Null

    # TennisExplorer fallback: covers Challengers and ITF events that the ATP
    # results pages do not. Currently blocked by the network, so a failure
    # here is expected and must not stop the run.
    # --lookahead 1 keeps player_upcoming_matches populated for today without
    # spending requests on a week of provisional schedules.
    Invoke-Step "2/4 TennisExplorer fallback (last $LookbackDays days)" `
        "pnpm scraper:daily-matches -- --lookback $LookbackDays --lookahead 1" -Optional | Out-Null

    Invoke-Step "3/4 recompute projections (top $Top)" `
        "pnpm scraper:projections -- --top $Top" | Out-Null
} else {
    Write-Log ">>> 1-3/4 refresh SKIPPED (--SkipRefresh)"
}

$compareExit = Invoke-Step "4/4 compare against live-tennis.eu" `
    "pnpm scraper:compare-live -- --top $Top"

Write-Log "=== Compare-Live finished: $failures failed step(s), $optionalFailures optional step(s) skipped/failed ==="
Write-Log "report: logs\live-diff-$today.log"

# Surface a duplicate-rank defect (compare-live exits 1 for that) distinctly
# from a step that simply failed to run.
if ($compareExit -eq 1) {
    Write-Log "NOTE: compare-live reported duplicated ranks - see the report."
}

exit $failures
