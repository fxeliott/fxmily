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
    verification  every 5 min    (Tour 15 — verification screens are analysed
                                   "sur le moment"; a pull with nothing pending
                                   short-circuits in verification-batch-local.sh
                                   and never calls claude, so a 5-min tick
                                   costs zero when the queue is empty. Shortened
                                   from 20 min so an uploaded MT5 proof is
                                   analysed while the member is still waiting.)
    calendar      Mon     05:10
    weekly        Sun     05:40
    monthly       day 1   06:10
    profile       day 2   06:40   (J-E monthly deep re-profiling; day 2 so the
                                   digest of the just-ended month lands first)

  Tasks run as the CURRENT user with LogonType Interactive (DEFAULT): the worker
  ticks while you are logged on (an always-on PC left logged in keeps ticking).
  `claude --print` authenticates with the account currently logged in under
  ~/.claude (.credentials.json). Interactive is MANDATORY for that OAuth to be
  readable: S4U was PROVEN incapable of reading the Claude OAuth on 2026-07-02
  (an S4U task looks green but every batch fails silently — see watchdog.ps1).
  `-LogonType S4U` remains selectable but emits a loud warning; do not use it
  for these batches.

  Idempotent: existing Fxmily worker tasks are replaced (-Force).

.PARAMETER OnboardingIntervalMinutes
  Poll cadence for the onboarding pipeline (default 20).

.PARAMETER LogonType
  Interactive (default) or S4U. Interactive is required for `claude` to read
  the Claude OAuth (S4U proven incapable 2026-07-02); S4U triggers a warning.

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
  [string]$LogonType = 'Interactive',

  [string]$BashPath = 'C:\Program Files\Git\bin\bash.exe',

  # Tour 12 — set by watchdog.ps1 when it repairs the 6 pipelines: the watchdog
  # must never re-register ITSELF while it is the running process.
  [switch]$SkipWatchdog
)

$ErrorActionPreference = 'Stop'
$TaskFolder = '\Fxmily\'
$TaskPrefix = 'Fxmily-worker-'

# S4U was PROVEN incapable of reading the Claude OAuth on 2026-07-02: an S4U
# task registers and looks green, but `claude --print` cannot reach the auth
# under ~/.claude, so every batch fails silently. Interactive is the default and
# the only supported mode; warn loudly if S4U is requested explicitly.
if ($LogonType -eq 'S4U') {
  Write-Warning 'S4U proven incapable of reading the Claude OAuth (2026-07-02): the tasks will register and look green, but every batch will fail silently. Use -LogonType Interactive (the default). Continuing with S4U as requested.'
}

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
# Tour 13 — `verification` moved from `daily 04:10` to a short interval so
# uploaded MT5 proofs are analysed "sur le moment", not once a night. The empty
# pull short-circuits (verification-batch-local.sh exits before any claude call
# when nothing is pending), so an idle tick costs zero.
# Tour 15 — interval shortened 20 -> 5 min so a proof is analysed while the
# member is still on /verification waiting (the dominant latency was this
# interval, not the ~2 s empty tick). MultipleInstances IgnoreNew + the global
# file lock in run-batch.sh still guarantee at most one `claude --print` at a
# time, so a shorter interval never parallelises.
$Pipelines = @(
  @{ Name = 'onboarding'; Kind = 'interval' },
  @{ Name = 'verification'; Kind = 'interval'; IntervalMinutes = 5 },
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
Write-Host "  onboarding  : every $OnboardingIntervalMinutes min"
Write-Host "  verification: every 5 min (Tour 15 — analyse sur le moment)"
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
      # Per-pipeline cadence (verification carries its own IntervalMinutes),
      # falling back to the onboarding cadence. Onboarding starts at :01,
      # verification at :11 — a start offset so the two interval tasks don't
      # both fire on the very first tick. With verification at 5 min they still
      # realign periodically; the run-batch.sh global lock + MultipleInstances
      # IgnoreNew are what actually serialise them (the later tick skips clean),
      # so a short interval never parallelises a `claude --print`.
      $intervalMin = if ($p.ContainsKey('IntervalMinutes')) { [int]$p.IntervalMinutes } else { $OnboardingIntervalMinutes }
      $startOffset = if ($p.Name -eq 'onboarding') { 1 } else { 11 }
      $Trigger = New-ScheduledTaskTrigger -Once -At (Get-Date).Date.AddMinutes($startOffset) `
        -RepetitionInterval (New-TimeSpan -Minutes $intervalMin)
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

# --- Tour 12 — the watchdog task (self-healing layer) --------------------------
# Every 30 min, offset :07/:37 so it never collides with the :00/:20/:40
# onboarding ticks. 10-min time limit: the watchdog only inspects + repairs
# task registrations, it never runs a batch. It repairs via THIS script with
# -SkipWatchdog, so the watchdog task itself is only (re)registered here.
if (-not $SkipWatchdog) {
  $watchdogScript = Join-Path $WorkerDir 'watchdog.ps1'
  if (Test-Path $watchdogScript) {
    $wdName = "${TaskPrefix}watchdog"
    $wdAction = New-ScheduledTaskAction -Execute 'powershell.exe' `
      -Argument "-NoProfile -ExecutionPolicy Bypass -File `"$watchdogScript`"" `
      -WorkingDirectory $WorkerDir
    $wdTrigger = New-ScheduledTaskTrigger -Once -At (Get-Date).Date.AddMinutes(7) `
      -RepetitionInterval (New-TimeSpan -Minutes 30)
    $wdSettings = New-ScheduledTaskSettingsSet `
      -StartWhenAvailable `
      -DontStopOnIdleEnd `
      -AllowStartIfOnBatteries `
      -DontStopIfGoingOnBatteries `
      -MultipleInstances IgnoreNew `
      -ExecutionTimeLimit (New-TimeSpan -Minutes 10)
    if ($PSCmdlet.ShouldProcess($wdName, 'Register scheduled task (watchdog, every 30 min)')) {
      Register-ScheduledTask -TaskName $wdName -TaskPath $TaskFolder `
        -Action $wdAction -Trigger $wdTrigger -Settings $wdSettings -Principal $Principal `
        -Description 'Fxmily worker watchdog (tour 12) - detects and repairs dead worker tasks, reports heartbeat to /admin/system.' `
        -Force | Out-Null
      Write-Host ("  [OK] {0,-14} {1}" -f 'watchdog', $wdName) -ForegroundColor Green
    }
  }
  else {
    Write-Host "  [WARN] watchdog.ps1 not found - watchdog task not registered." -ForegroundColor Yellow
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
