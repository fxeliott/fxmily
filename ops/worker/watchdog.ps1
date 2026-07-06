<#
.SYNOPSIS
  Fxmily worker watchdog (tour 12) - detect AND repair dead worker tasks,
  then report a counts-only heartbeat to the app.

.DESCRIPTION
  The 6 Fxmily-worker-* scheduled tasks are the only thing that generates the
  app's AI artifacts. Until tour 12 their failure modes (task unregistered by
  a Windows update, task disabled by hand, config file gone) were detected on
  /admin/system but repaired by a human. This watchdog closes the loop:

    1. CHECK    each pipeline task exists, is enabled, and is not stuck.
    2. REPAIR   what is safely repairable WITHOUT admin rights:
                  - disabled task  -> Enable-ScheduledTask (surgical)
                  - missing task   -> re-register the 6 via install-worker.ps1
                                      -SkipWatchdog -LogonType Interactive
                REPAIR IS SKIPPED while any pipeline task is Running (a
                re-register could kill an in-flight claude batch) and after
                3 consecutive repair attempts that did not restore health
                (a repair loop means the problem is elsewhere - stop and
                let the board show it).
    3. SIGNAL   what it must NOT touch: stale global lock (run-batch.sh owns
                reclaim), missing/short tokens in worker.env (secrets are the
                operator's), a status.json older than the task's last run by
                more than the batch time limit (hard-killed run).
    4. REPORT   POST /api/admin/worker-watchdog/heartbeat (X-Admin-Token).
                Counts only - NEVER a token value, NEVER a local username.
                The row it writes is monitored by WORKER_EXPECTATIONS, so a
                dead watchdog surfaces on the board like any dead cron.

  LogonType MUST stay Interactive on repair: S4U cannot read the Claude Max
  OAuth under ~/.claude (proved 2026-07-02), so an S4U "repair" would silently
  break every batch while looking green.

  Exit code: 0 whenever the heartbeat was delivered (errors travel IN the
  heartbeat); 1 only when the heartbeat itself could not be sent - that
  absence is exactly what the board's worker.watchdog.heartbeat entry flags.

.EXAMPLE
  powershell -NoProfile -ExecutionPolicy Bypass -File ops\worker\watchdog.ps1
#>
[CmdletBinding()]
param(
  [string]$BaseUrl = '',
  [switch]$SkipHeartbeat  # local diagnostics only
)

$ErrorActionPreference = 'Stop'
$WatchdogVersion = '1.0.0'
$TaskPath = '\Fxmily\'
$TaskPrefix = 'Fxmily-worker-'
$PipelineNames = @('onboarding', 'verification', 'calendar', 'weekly', 'monthly', 'profile')
$MaxRepairStreak = 3

$WorkerDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$LogDir = Join-Path $WorkerDir 'logs'
if (-not (Test-Path $LogDir)) { New-Item -ItemType Directory -Path $LogDir -Force | Out-Null }
$LogFile = Join-Path $LogDir 'watchdog.log'
$StateFile = Join-Path $LogDir 'watchdog.state.json'

function Write-Log([string]$Message) {
  $stamp = (Get-Date).ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ssZ')
  $line = "[$stamp] $Message"
  Write-Host $line
  Add-Content -Path $LogFile -Value $line -Encoding utf8
}

# Same 14-day retention as run-batch.sh logs.
try {
  Get-ChildItem -Path $LogDir -Filter '*.log' -File |
    Where-Object { $_.LastWriteTime -lt (Get-Date).AddDays(-14) } |
    Remove-Item -Force -ErrorAction Stop
} catch {}

# --- Load worker.env (tokens never logged, lengths only) -----------------------
$EnvFile = Join-Path $WorkerDir 'worker.env'
$EnvVars = @{}
if (Test-Path $EnvFile) {
  foreach ($line in Get-Content $EnvFile) {
    if ($line -match '^\s*#' -or $line -match '^\s*$') { continue }
    if ($line -match '^\s*([A-Za-z_][A-Za-z0-9_]*)=(.*)$') {
      $k = $Matches[1]
      $v = $Matches[2].Trim().Trim('"').Trim("'")
      $EnvVars[$k] = $v
    }
  }
}

if ($BaseUrl -eq '') {
  if ($EnvVars.ContainsKey('FXMILY_BASE_URL') -and $EnvVars['FXMILY_BASE_URL'] -ne '') {
    $BaseUrl = $EnvVars['FXMILY_BASE_URL']
  } else {
    $BaseUrl = 'https://app.fxmilyapp.com'
  }
}

# --- Collect findings -----------------------------------------------------------
$errorLabels = New-Object System.Collections.Generic.List[string]
$tasksOk = 0
$repaired = 0
$missingTasks = New-Object System.Collections.Generic.List[string]
$anyRunning = $false
# Logged-out and quota-cap are MACHINE-wide states (one account per box, one
# shared cooldown stamp), so each label is raised at most once across all
# pipelines instead of once per stale status.json.
$authLoggedOutSeen = $false
$quotaCappedSeen = $false

# 1) Config sanity - closes the "worker.env absent -> every tick exits 0
#    silently forever" hole (run-batch.sh treats no-env as a benign skip).
$TokenNames = @(
  'FXMILY_ADMIN_TOKEN',
  'FXMILY_MONTHLY_ADMIN_TOKEN',
  'FXMILY_CALENDAR_TOKEN',
  'FXMILY_VERIFICATION_ADMIN_BATCH_TOKEN',
  'FXMILY_PROFILE_ADMIN_TOKEN'
)
if (-not (Test-Path $EnvFile)) {
  $errorLabels.Add('config_missing:worker.env')
} else {
  foreach ($t in $TokenNames) {
    $len = 0
    if ($EnvVars.ContainsKey($t)) { $len = $EnvVars[$t].Length }
    if ($len -lt 32) { $errorLabels.Add("token_short:$t") }
  }
}

# 2) Task inventory. Sane last-run results: 0x0 (success), 0x41301 (running),
#    0x41303 (not yet run), 0x41325 (queued). Anything else is reported but
#    NOT auto-repaired: the scheduler already retries (RestartCount 2), and a
#    failing batch is a batch problem, not a task-registration problem.
$SaneResults = @(0, 0x41301, 0x41303, 0x41325)
foreach ($name in $PipelineNames) {
  $taskName = "$TaskPrefix$name"
  $task = $null
  try { $task = Get-ScheduledTask -TaskPath $TaskPath -TaskName $taskName -ErrorAction Stop } catch {}

  if ($null -eq $task) {
    $missingTasks.Add($name)
    $errorLabels.Add("task_missing:$name")
    continue
  }

  # LogonType must be Interactive: S4U cannot read the Claude OAuth (proven
  # 2026-07-02), so an S4U-registered task runs but every batch fails silently.
  # Surface it (SIGNAL only - the operator re-installs; a re-register here could
  # kill an in-flight batch and is already the repair path for MISSING tasks).
  $logonType = $null
  if ($null -ne $task.Principal) { $logonType = [string]$task.Principal.LogonType }
  if ($logonType -and $logonType -ne 'Interactive') {
    $errorLabels.Add("task_logon_type:$name`:$logonType")
  }

  if ($task.State -eq 'Running') { $anyRunning = $true }

  if ($task.State -eq 'Disabled') {
    # Surgical repair - no re-register, no batch interruption possible.
    try {
      Enable-ScheduledTask -TaskPath $TaskPath -TaskName $taskName -ErrorAction Stop | Out-Null
      $repaired += 1
      Write-Log "REPAIRED task $taskName was Disabled -> enabled."
    } catch {
      $errorLabels.Add("task_disabled:$name")
      Write-Log "ERROR could not enable $taskName : $($_.Exception.Message)"
      continue
    }
  }

  $info = $null
  try { $info = Get-ScheduledTaskInfo -TaskPath $TaskPath -TaskName $taskName -ErrorAction Stop } catch {}
  if ($null -ne $info -and $SaneResults -notcontains [int64]$info.LastTaskResult) {
    $hex = '0x{0:X}' -f [int64]$info.LastTaskResult
    $errorLabels.Add("task_last_result:${name}:$hex")
  }

  # 3) Hard-killed run detector: the task ran but the batch never wrote its
  #    status.json epilogue within the 2h ExecutionTimeLimit + 15 min margin.
  #    run-batch.sh's stale-lock reclaim self-heals on the NEXT tick; we only
  #    surface that it happened.
  $statusFile = Join-Path $LogDir "$name.status.json"
  if ($null -ne $info -and $null -ne $info.LastRunTime -and $info.LastRunTime -gt (Get-Date).AddYears(-10)) {
    $deadline = $info.LastRunTime.AddHours(2).AddMinutes(15)
    if ((Get-Date) -gt $deadline) {
      $statusFresh = $false
      if (Test-Path $statusFile) {
        $status = $null
        try { $status = Get-Content $statusFile -Raw | ConvertFrom-Json } catch {}
        if ($null -ne $status -and $status.finishedAt) {
          try {
            $finishedAt = [DateTime]::Parse($status.finishedAt).ToUniversalTime()
            if ($finishedAt -ge $info.LastRunTime.ToUniversalTime()) { $statusFresh = $true }
          } catch {}
        }
      }
      if (-not $statusFresh) { $errorLabels.Add("status_stale:$name") }
    }
  }

  # Multi-account signals from the batch's own status.json (run-batch.sh writes
  # authOk + exitCode). authOk:false = the pre-flight found NO Claude account
  # logged in (machine-wide -> label once). exitCode:75 = a benign usage/rate
  # cap; the worker is in cooldown and self-resolves next quota window.
  if (Test-Path $statusFile) {
    $st = $null
    try { $st = Get-Content $statusFile -Raw | ConvertFrom-Json } catch {}
    if ($null -ne $st) {
      if (($st.PSObject.Properties.Name -contains 'authOk') -and ($st.authOk -eq $false)) {
        if (-not $authLoggedOutSeen) {
          $errorLabels.Add('claude_auth:logged_out')
          $authLoggedOutSeen = $true
        }
      }
      if (($st.PSObject.Properties.Name -contains 'exitCode') -and ([int]$st.exitCode -eq 75)) {
        if (-not $quotaCappedSeen) {
          $errorLabels.Add('claude_quota:capped')
          $quotaCappedSeen = $true
        }
      }
    }
  }

  $tasksOk += 1
}

# 4) Stale global lock - SIGNAL ONLY. run-batch.sh owns reclaim (it checks the
#    holder PID liveness itself); a watchdog delete could race a live batch.
$LockDir = Join-Path $HOME '.fxmily-worker.lock'
if (Test-Path $LockDir) {
  $pidFile = Join-Path $LockDir 'pid'
  $holderAlive = $false
  if (Test-Path $pidFile) {
    $holderPid = (Get-Content $pidFile -ErrorAction SilentlyContinue | Select-Object -First 1)
    if ($holderPid -match '^[0-9]+$') {
      # MSYS bash writes its own view of the PID; Get-Process covers the
      # common case (same Windows PID for the bash.exe holder).
      try { if (Get-Process -Id ([int]$holderPid) -ErrorAction Stop) { $holderAlive = $true } } catch {}
    }
  }
  if (-not $holderAlive) {
    $ageMin = [int]((Get-Date) - (Get-Item $LockDir).LastWriteTime).TotalMinutes
    if ($ageMin -gt 360) { $errorLabels.Add('lock_stale') }
  }
}

# --- Heavy repair: missing tasks -> full re-register of the 6 pipelines --------
$state = @{ repairStreak = 0; lastRepairAt = '' }
if (Test-Path $StateFile) {
  try {
    $loaded = Get-Content $StateFile -Raw | ConvertFrom-Json
    if ($null -ne $loaded.repairStreak) { $state.repairStreak = [int]$loaded.repairStreak }
    if ($null -ne $loaded.lastRepairAt) { $state.lastRepairAt = [string]$loaded.lastRepairAt }
  } catch {}
}

if ($missingTasks.Count -gt 0) {
  if ($anyRunning) {
    Write-Log "SKIP repair - $($missingTasks.Count) task(s) missing but a pipeline is Running (re-register could kill it). Next tick will retry."
    $errorLabels.Add('repair_deferred:running')
  } elseif ($state.repairStreak -ge $MaxRepairStreak) {
    Write-Log "SKIP repair - $($state.repairStreak) consecutive repairs did not restore health; stopping the loop (operator needed)."
    $errorLabels.Add('repair_loop:capped')
  } else {
    $installer = Join-Path $WorkerDir 'install-worker.ps1'
    if (Test-Path $installer) {
      Write-Log "REPAIR re-registering pipelines (missing: $($missingTasks -join ', ')) via install-worker.ps1 -SkipWatchdog -LogonType Interactive."
      try {
        # Interactive is NON-NEGOTIABLE: S4U cannot read the Claude OAuth.
        & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $installer -SkipWatchdog -LogonType Interactive | Out-Null
        $repaired += $missingTasks.Count
        $state.repairStreak = [int]$state.repairStreak + 1
        $state.lastRepairAt = (Get-Date).ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ssZ')
        Write-Log "REPAIR done (streak $($state.repairStreak)/$MaxRepairStreak)."
      } catch {
        $errorLabels.Add('repair_failed:install')
        Write-Log "ERROR repair failed: $($_.Exception.Message)"
      }
    } else {
      $errorLabels.Add('repair_failed:no_installer')
      Write-Log 'ERROR install-worker.ps1 not found next to watchdog.ps1.'
    }
  }
} else {
  # All 6 registered -> whatever streak existed, health is restored.
  $state.repairStreak = 0
}

try {
  ($state | ConvertTo-Json -Compress) | Set-Content -Path $StateFile -Encoding utf8
} catch {}

# --- Heartbeat ------------------------------------------------------------------
$payload = @{
  tasksChecked     = $PipelineNames.Count
  tasksOk          = $tasksOk
  repaired         = $repaired
  errors           = $errorLabels.Count
  watchdogVersion  = $WatchdogVersion
}
if ($errorLabels.Count -gt 0) {
  # Bounded list (schema caps at 20) - labels are machine enums, PII-free.
  $payload['errorLabels'] = @($errorLabels | Select-Object -First 20)
}

Write-Log "SUMMARY checked=$($PipelineNames.Count) ok=$tasksOk repaired=$repaired errors=$($errorLabels.Count) $(if ($errorLabels.Count -gt 0) { '[' + ($errorLabels -join '; ') + ']' })"

if ($SkipHeartbeat) {
  Write-Log 'Heartbeat skipped (-SkipHeartbeat).'
  exit 0
}

$adminToken = ''
if ($EnvVars.ContainsKey('FXMILY_ADMIN_TOKEN')) { $adminToken = $EnvVars['FXMILY_ADMIN_TOKEN'] }
if ($adminToken.Length -lt 32) {
  Write-Log 'ERROR heartbeat impossible: FXMILY_ADMIN_TOKEN missing/short in worker.env.'
  exit 1
}

[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
$uri = "$($BaseUrl.TrimEnd('/'))/api/admin/worker-watchdog/heartbeat"
$body = $payload | ConvertTo-Json -Compress
$headers = @{ 'X-Admin-Token' = $adminToken; 'Content-Type' = 'application/json' }

$sent = $false
foreach ($attempt in 1, 2) {
  try {
    Invoke-RestMethod -Method Post -Uri $uri -Headers $headers -Body $body -TimeoutSec 30 | Out-Null
    $sent = $true
    Write-Log "Heartbeat delivered (attempt $attempt)."
    break
  } catch {
    $httpStatus = ''
    if ($_.Exception.Response -and $_.Exception.Response.StatusCode) {
      $httpStatus = [int]$_.Exception.Response.StatusCode
    }
    Write-Log "WARN heartbeat attempt $attempt failed (status=$httpStatus): $($_.Exception.Message)"
    # 401 = bad token: retrying burns the shared rate-limit for nothing.
    if ($httpStatus -eq 401) { break }
    if ($attempt -eq 1) { Start-Sleep -Seconds 10 }
  }
}

if ($sent) { exit 0 } else { exit 1 }
