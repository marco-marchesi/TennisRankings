<#
.SYNOPSIS
    Register the TennisRankings scheduled tasks. Idempotent.

.DESCRIPTION
    Registers via `schtasks /Create /XML`, NOT via Register-ScheduledTask and
    NOT via a bare `schtasks /Create`. Both alternatives were tried and both
    are wrong here:

      Register-ScheduledTask -LogonType S4U
          fails with "Access is denied" in a non-elevated shell.

      schtasks /Create /SC DAILY /ST 07:30
          registers, and then silently never runs. It applies Task
          Scheduler's DEFAULT settings, which on a laptop include
          DisallowStartIfOnBatteries=true and StartWhenAvailable=false. The
          07:30 trigger is refused with 0x800710E0 ("The operator or
          administrator has refused the request") and is never retried.
          Observed: registered 2026-09-04, four consecutive days with a
          Last Result of 0x800710E0 and not one line of output.

    The XML below fixes the three settings that matter for a workstation:

      DisallowStartIfOnBatteries / StopIfGoingOnBatteries = false
          run on battery, and do not abort mid-run when unplugged.
      StartWhenAvailable = true
          if the machine was asleep at 07:30, run as soon as it is awake
          rather than skipping the day.
      A second LogonTrigger with a 5-minute delay
          belt and braces for a machine that is off overnight.

    Note a manual `schtasks /Run` bypasses all of these conditions, so it
    proves the SCRIPT works but says nothing about whether the SCHEDULE
    works. Check `Last Result` after a real trigger instead - 0 means it ran.

.PARAMETER Unregister
    Remove the tasks instead of creating them.

.PARAMETER IncludeHourly
    Also register the in-week hourly refresh. Off by default: it is only
    useful during a tournament week and it costs TennisExplorer requests.

.EXAMPLE
    ./scripts/Register-Tasks.ps1
    ./scripts/Register-Tasks.ps1 -IncludeHourly
    ./scripts/Register-Tasks.ps1 -Unregister
#>
param(
    [switch]$Unregister,
    [switch]$IncludeHourly
)

$ErrorActionPreference = "Continue"
$Root = Split-Path $PSScriptRoot -Parent
Set-Location $Root

$user = "$env:USERDOMAIN\$env:USERNAME"

function New-TaskXml {
    param(
        [string]$Script,
        [string]$Description,
        [string]$TriggerXml
    )
    $cmd = "powershell.exe"
    $argstr = "-NoProfile -ExecutionPolicy Bypass -File `"$Root\scripts\$Script`""
    return @"
<?xml version="1.0" encoding="UTF-16"?>
<Task version="1.3" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">
  <RegistrationInfo>
    <Description>$Description</Description>
    <URI>\$($Script -replace '\.ps1$','')</URI>
  </RegistrationInfo>
  <Triggers>
$TriggerXml
  </Triggers>
  <Principals>
    <Principal id="Author">
      <UserId>$user</UserId>
      <LogonType>InteractiveToken</LogonType>
      <RunLevel>LeastPrivilege</RunLevel>
    </Principal>
  </Principals>
  <Settings>
    <MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy>
    <DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries>
    <StopIfGoingOnBatteries>false</StopIfGoingOnBatteries>
    <AllowHardTerminate>true</AllowHardTerminate>
    <StartWhenAvailable>true</StartWhenAvailable>
    <RunOnlyIfNetworkAvailable>false</RunOnlyIfNetworkAvailable>
    <IdleSettings>
      <StopOnIdleEnd>false</StopOnIdleEnd>
      <RestartOnIdle>false</RestartOnIdle>
    </IdleSettings>
    <AllowStartOnDemand>true</AllowStartOnDemand>
    <Enabled>true</Enabled>
    <Hidden>false</Hidden>
    <RunOnlyIfIdle>false</RunOnlyIfIdle>
    <WakeToRun>false</WakeToRun>
    <ExecutionTimeLimit>PT2H</ExecutionTimeLimit>
    <Priority>7</Priority>
    <RestartOnFailure>
      <Interval>PT15M</Interval>
      <Count>2</Count>
    </RestartOnFailure>
  </Settings>
  <Actions Context="Author">
    <Exec>
      <Command>$cmd</Command>
      <Arguments>$argstr</Arguments>
      <WorkingDirectory>$Root</WorkingDirectory>
    </Exec>
  </Actions>
</Task>
"@
}

# A daily calendar trigger plus a logon trigger, so a laptop that was off at
# the scheduled time still catches up the same day.
$dailyTrigger = @"
    <CalendarTrigger>
      <StartBoundary>2026-01-01T07:30:00</StartBoundary>
      <Enabled>true</Enabled>
      <ScheduleByDay><DaysInterval>1</DaysInterval></ScheduleByDay>
    </CalendarTrigger>
    <LogonTrigger>
      <Enabled>true</Enabled>
      <UserId>$user</UserId>
      <Delay>PT5M</Delay>
    </LogonTrigger>
"@

$weeklyTrigger = @"
    <CalendarTrigger>
      <StartBoundary>2026-01-05T04:15:00</StartBoundary>
      <Enabled>true</Enabled>
      <ScheduleByWeek>
        <DaysOfWeek><Monday /></DaysOfWeek>
        <WeeksInterval>1</WeeksInterval>
      </ScheduleByWeek>
    </CalendarTrigger>
"@

$hourlyTrigger = @"
    <CalendarTrigger>
      <StartBoundary>2026-01-01T06:10:00</StartBoundary>
      <Enabled>true</Enabled>
      <Repetition>
        <Interval>PT1H</Interval>
        <Duration>P1D</Duration>
        <StopAtDurationEnd>false</StopAtDurationEnd>
      </Repetition>
      <ScheduleByDay><DaysInterval>1</DaysInterval></ScheduleByDay>
    </CalendarTrigger>
"@

$tasks = @(
    @{
        Name    = "TennisRankings-CompareLive"
        Script  = "Compare-Live.ps1"
        Trigger = $dailyTrigger
        Why     = "Daily 07:30 (+ at logon): pull matches, recompute projections, diff vs live-tennis.eu"
        Always  = $true
    },
    @{
        Name    = "TennisRankings-Weekly"
        Script  = "Weekly-Update.ps1"
        Trigger = $weeklyTrigger
        Why     = "Monday 04:15: full pipeline (official rankings, expand, backfill, leaderboards, projections)"
        Always  = $true
    },
    @{
        Name    = "TennisRankings-Hourly"
        Script  = "Hourly-Update.ps1"
        Trigger = $hourlyTrigger
        Why     = "Hourly during tournament weeks: TennisExplorer matches + projections"
        Always  = $false
    }
)

$tmp = Join-Path $env:TEMP "tennisrankings-task.xml"

foreach ($t in $tasks) {
    if (-not $t.Always -and -not $IncludeHourly) {
        Write-Output "skip     $($t.Name)  (pass -IncludeHourly to register)"
        continue
    }

    if ($Unregister) {
        schtasks /Delete /TN $t.Name /F *> $null
        if ($LASTEXITCODE -eq 0) { Write-Output "removed  $($t.Name)" }
        else { Write-Output "absent   $($t.Name)" }
        continue
    }

    if (-not (Test-Path "$Root\scripts\$($t.Script)")) {
        Write-Output "MISSING  $($t.Name) -> scripts\$($t.Script) does not exist"
        continue
    }

    $xml = New-TaskXml -Script $t.Script -Description $t.Why -TriggerXml $t.Trigger
    # Task Scheduler requires UTF-16 for /XML input.
    [System.IO.File]::WriteAllText($tmp, $xml, [System.Text.Encoding]::Unicode)

    $out = schtasks /Create /TN $t.Name /XML $tmp /F 2>&1
    if ($LASTEXITCODE -eq 0) {
        Write-Output "created  $($t.Name)  -  $($t.Why)"
    } else {
        Write-Output "FAILED   $($t.Name): $out"
    }
}

Remove-Item $tmp -Force -ErrorAction SilentlyContinue

if (-not $Unregister) {
    Write-Output ""
    Write-Output "Verifying the settings that actually matter:"
    foreach ($t in $tasks) {
        if (-not $t.Always -and -not $IncludeHourly) { continue }
        $x = [xml](schtasks /Query /TN $t.Name /XML 2>&1 | Out-String)
        if ($null -eq $x.Task) { Write-Output "  $($t.Name): could not read back"; continue }
        $s = $x.Task.Settings
        Write-Output ("  {0}" -f $t.Name)
        Write-Output ("     onBattery={0}  stopOnBattery={1}  startWhenAvailable={2}" -f `
            (-not [bool]::Parse($s.DisallowStartIfOnBatteries)), $s.StopIfGoingOnBatteries, $s.StartWhenAvailable)
    }
    Write-Output ""
    Write-Output "A manual run bypasses these conditions. To confirm the SCHEDULE works,"
    Write-Output "check Last Result after a real trigger - 0 means it ran:"
    Write-Output "  schtasks /Query /TN TennisRankings-CompareLive /FO LIST /V | findstr /C:`"Last Result`""
    Write-Output ""
    Write-Output "Reports: logs\live-diff-<date>.log  and  logs\live-diff-trend.log"
}
