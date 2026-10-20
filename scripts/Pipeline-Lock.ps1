<#
.SYNOPSIS
    One-pipeline-at-a-time lock, dot-sourced by Weekly-Update and Compare-Live.

.DESCRIPTION
    Both tasks have a logon trigger, so a laptop that was off at 04:15 on a
    Monday starts them within minutes of each other. On 2026-10-05 and
    2026-10-12 they ran concurrently: two processes hitting atptour.com (the
    1 req/sec throttle is per process), both recomputing projections, and the
    comparison diffing a ranking that was being rewritten under it.

    The lock is a file opened with FileShare.None. The OS drops it when the
    process exits for any reason - including being killed by sleep or
    shutdown, which is how the 10-06 and 10-07 runs died - so a stale lock
    can never block the next run.
#>

$script:PipelineLockHandle = $null

function Enter-PipelineLock {
    param(
        [string]$Path = (Join-Path (Split-Path $PSScriptRoot -Parent) "logs\pipeline.lock"),
        [int]$TimeoutMinutes = 120,
        [scriptblock]$OnWait = { param($m) Write-Host $m }
    )
    $deadline = (Get-Date).AddMinutes($TimeoutMinutes)
    $announced = $false
    while ($true) {
        try {
            $script:PipelineLockHandle = [System.IO.File]::Open(
                $Path, [System.IO.FileMode]::OpenOrCreate,
                [System.IO.FileAccess]::ReadWrite, [System.IO.FileShare]::None)
            return $true
        } catch [System.IO.IOException] {
            if ((Get-Date) -ge $deadline) { return $false }
            if (-not $announced) {
                & $OnWait "another pipeline run holds $Path - waiting up to $TimeoutMinutes min"
                $announced = $true
            }
            Start-Sleep -Seconds 30
        }
    }
}

function Exit-PipelineLock {
    if ($script:PipelineLockHandle) {
        $script:PipelineLockHandle.Dispose()
        $script:PipelineLockHandle = $null
    }
}
