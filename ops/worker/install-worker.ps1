<#
.SYNOPSIS
  Fxmily local AI worker (J2) — register the automated, permanent Windows
  Scheduled Tasks that drive the 6 Claude batch orchestrators.

.DESCRIPTION
  Turns the former "human-in-the-loop, run manually by Eliot" batches into a
  permanent local worker. One task per pipeline, all invoking
  ops/worker/run-batch.sh via Git Bash. The wrapper holds a GLOBAL lock so at
  most one `claude --print` ever runs at a time (ban-risk: no parallelisation),
  exactly as when the scripts were run by hand one after another.

  Schedules are STAGGERED so the six never collide:
    onboarding    every 20 min   (time-sensitive — this is what kills the
                                   "IA silence 24H après profil rempli" bug)
    verification  daily   04:10
    calendar      Mon     05:10
    weekly        Sun     05:40
    monthly       day 1   06:10
    profile       day 2   06:40   (J-E monthly deep re-profiling; day 2 so the
                                   digest of the just-ended month lands first)

  Tasks run as the CURRENT user with LogonType S4U ("run whether the user is
  logged on or not", no stored password) so the worker keeps ticking on an
  always-on PC even when the screen is locked. `claude --print` authenticates
  with the user's Claude Max OAuth under ~/.claude, which S4U can read.
  If your environment refuses S4U for `claude` auth, re-run with
  `-LogonType Interactive` (the worker then only ticks while you are logged on).

  Idempotent: existing Fxmily worker tasks are replaced (-Force).

.PARAMETER OnboardingIntervalMinutes
  Poll cadence for the onboarding pipeline (default 20).

.PARAMETER LogonType
  S4U (default) or Interactive.

.PARAMETER WhatIf
  Show what would be registered without changing anything.

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File ops\worker\install-worker.ps1

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File ops\worker\install-worker.ps1 -LogonType Interactive -OnboardingIntervalMinutes 15
#>
[CmdletBinding(SupportsShouldProcess = $true)]
param(
  [ValidateRange(5, 240)]
  [int]$OnboardingIntervalMinutes = 20,

  [ValidateSet('S4U', 'Interactive')]
  [string]$LogonType = 'S4U',

  [string]$BashPath = 'C:\Program Files\Git\bin\bash.exe'
)

$ErrorActionPreference = 'Stop'
$TaskFolder = '\Fxmily\'
$TaskPrefix = 'Fxmily-worker-'

# --- Resolve the worker script + translate to a bash (MSYS) path --------------
$WorkerDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$RunBatch = Join-Path $WorkerDir 'run-batch.sh'
if (-not (Test-Path $RunBatch)) { throw "run-batch.sh not found at $RunBatch" }
if (-not (Test-Path $BashPath)) { throw "Git Bash not found at $BashPath (pass -BashPath)." }

# D:\Fxmily\ops\worker\run-batch.sh -> /d/Fxmily/ops/worker/run-batch.sh
function ConvertTo-BashPath([string]$WinPath) {
  $p = $WinPath -replace '\\', '/'
  if ($p -match '^([A-Za-z]):/(.*)$') { return "/$($Matches[1].ToLower())/$($Matches[2])" }
  return $p
}
$RunBatchBash = ConvertTo-BashPath $RunBatch

# --- The 6 pipelines + their triggers -----------------------------------------
# Trigger objects are built per-task below (New-ScheduledTaskTrigger).
$Pipelines = @(
  @{ Name = 'onboarding'; Kind = 'interval' },
  @{ Name = 'verification'; Kind = 'daily'; At = '04:10' },
  @{ Name = 'calendar'; Kind = 'weekly'; At = '05:10'; Day = 'Monday' },
  @{ Name = 'weekly'; Kind = 'weekly'; At = '05:40'; Day = 'Sunday' },
  @{ Name = 'monthly'; Kind = 'monthly'; At = '06:10'; DayOfMonth = 1 },
  @{ Name = 'profile'; Kind = 'monthly'; At = '06:40'; DayOfMonth = 2 }
)

# --- Shared settings (permanence + self-healing seed for J4) -------------------
$Settings = New-ScheduledTaskSettingsSet `
  -StartWhenAvailable `
  -DontStopOnIdleEnd `
  -AllowStartIfOnBatteries `
  -DontStopIfGoingOnBatteries `
  -MultipleInstances IgnoreNew `
  -RestartCount 2 `
  -RestartInterval (New-TimeSpan -Minutes 5) `
  -ExecutionTimeLimit (New-TimeSpan -Hours 2)

# --- Principal (current user) --------------------------------------------------
$UserId = "$env:USERDOMAIN\$env:USERNAME"
if ($LogonType -eq 'S4U') {
  $Principal = New-ScheduledTaskPrincipal -UserId $UserId -LogonType S4U -RunLevel Limited
}
else {
  $Principal = New-ScheduledTaskPrincipal -UserId $UserId -LogonType Interactive -RunLevel Limited
}

Write-Host "Fxmily local AI worker — installing $($Pipelines.Count) tasks under $TaskFolder" -ForegroundColor Cyan
Write-Host "  bash      : $BashPath"
Write-Host "  script    : $RunBatchBash"
Write-Host "  principal : $UserId (LogonType=$LogonType)"
Write-Host "  onboarding: every $OnboardingIntervalMinutes min"
Write-Host ""

foreach ($p in $Pipelines) {
  $name = $p.Name
  $taskName = "$TaskPrefix$name"

  # bash -lc "'<script>' <batch>"  — login shell so PATH has claude/jq/curl/node.
  $bashCmd = "'$RunBatchBash' $name"
  $arguments = "-lc `"$bashCmd`""
  $Action = New-ScheduledTaskAction -Execute $BashPath -Argument $arguments -WorkingDirectory $WorkerDir

  switch ($p.Kind) {
    'interval' {
      $Trigger = New-ScheduledTaskTrigger -Once -At (Get-Date).Date.AddMinutes(1) `
        -RepetitionInterval (New-TimeSpan -Minutes $OnboardingIntervalMinutes)
    }
    'daily' { $Trigger = New-ScheduledTaskTrigger -Daily -At $p.At }
    'weekly' { $Trigger = New-ScheduledTaskTrigger -Weekly -DaysOfWeek $p.Day -At $p.At }
    'monthly' {
      # New-ScheduledTaskTrigger has no native monthly; build via CIM class.
      $Trigger = New-ScheduledTaskTrigger -Daily -At $p.At  # placeholder, replaced below
    }
  }

  $desc = "Fxmily local AI worker — $name batch (J2 auto-generation; ban-risk global lock in run-batch.sh)."

  if ($PSCmdlet.ShouldProcess($taskName, "Register scheduled task ($($p.Kind))")) {
    Register-ScheduledTask -TaskName $taskName -TaskPath $TaskFolder `
      -Action $Action -Trigger $Trigger -Settings $Settings -Principal $Principal `
      -Description $desc -Force | Out-Null

    if ($p.Kind -eq 'monthly') {
      # Monthly-on-day-1 is not expressible via New-ScheduledTaskTrigger, the
      # MSFT_TaskMonthlyTrigger CIM class rejects property assignment on a
      # -ClientOnly instance ("MonthsOfYear" not settable), and schtasks /TR
      # quoting is not reliably reachable from PS 5.1 (inner quotes are not
      # re-escaped on native calls) — all three proven 2026-07-02 on Win11.
      # Robust path: register with the daily placeholder above, then rewrite
      # the trigger XML to ScheduleByMonth and re-register from XML (cmdlets
      # own all the quoting; works non-elevated for an Interactive task).
      $xml = Export-ScheduledTask -TaskName $taskName -TaskPath $TaskFolder
      $months = '<Months>' + (('January', 'February', 'March', 'April', 'May', 'June',
          'July', 'August', 'September', 'October', 'November', 'December' |
            ForEach-Object { "<$_ />" }) -join '') + '</Months>'
      $byMonth = "<ScheduleByMonth><DaysOfMonth><Day>$($p.DayOfMonth)</Day></DaysOfMonth>$months</ScheduleByMonth>"
      # (?s) — the exported XML is pretty-printed across lines; without
      # singleline mode the lazy .*? never crosses them and nothing replaces.
      $xml = $xml -replace '(?s)<ScheduleByDay>.*?</ScheduleByDay>', $byMonth
      if ($xml -notmatch 'ScheduleByMonth') {
        throw "monthly trigger rewrite failed for $taskName (ScheduleByDay not found in exported XML)."
      }
      Unregister-ScheduledTask -TaskName $taskName -TaskPath $TaskFolder -Confirm:$false
      Register-ScheduledTask -TaskName $taskName -TaskPath $TaskFolder -Xml $xml | Out-Null
    }

    Write-Host ("  [OK] {0,-14} {1}" -f $name, $taskName) -ForegroundColor Green
  }
}

Write-Host ""
Write-Host "Done. Verify with:  ops\worker\status-worker.ps1" -ForegroundColor Cyan
Write-Host "Remove with:        ops\worker\uninstall-worker.ps1" -ForegroundColor DarkGray
Write-Host ""
Write-Host "PREREQUISITE: ops\worker\worker.env must hold the FIVE pipeline tokens" -ForegroundColor Yellow
Write-Host "(FXMILY_ADMIN_TOKEN, FXMILY_MONTHLY_ADMIN_TOKEN, FXMILY_CALENDAR_TOKEN," -ForegroundColor Yellow
Write-Host "FXMILY_VERIFICATION_ADMIN_BATCH_TOKEN, FXMILY_PROFILE_ADMIN_TOKEN)" -ForegroundColor Yellow
Write-Host "+ optional FXMILY_BASE_URL." -ForegroundColor Yellow
Write-Host "Copy worker.env.example and fill it in before the first tick." -ForegroundColor Yellow
