<#
.SYNOPSIS
  Reproducible driver for the Fxmily k6 stress suite (LOCAL ONLY).

.DESCRIPTION
  Chains: (1) start the Fxmily server locally, (2) warm the routes, (3) sample
  the node RSS while each scenario runs, (4) run S1 / S3 / S4 (S2 only if the
  UPLOAD_* env vars are provided), (5) export the k6 summaries to .results/ and
  stop the server.

  LOCAL ONLY - never targets prod. The database must be the disposable verify
  container (port 55432); the seed refuses any other database.

  Two modes:
    -Mode dev  (DEFAULT): `next dev`. This is the ONLY path that boots locally on
                 http://localhost:<port>: the app fail-fasts at boot if
                 NODE_ENV=production AND AUTH_URL is not https (env.ts Zod refine).
                 `next start` forces NODE_ENV=production, so the refine would break
                 with a local http AUTH_URL. That is also why the repo e2e suite
                 runs against `next dev`. Consequence: p95 is INFLATED by the dev
                 overhead (compile-on-demand, no minification, HMR) -> document it
                 as an UPPER BOUND (a threshold that passes in dev passes in prod).
                 The warm-up below absorbs the Turbopack cold-compile.
    -Mode prod (advanced): `next build` + `next start`. Realistic but needs an https
                 AUTH_URL (local cert + reverse-proxy, or a tunnel) - not wired here.

.NOTES
  The secret values below are obvious local placeholders for a disposable server on
  a disposable database. They are the credentials of NOTHING real - hence their
  harmless presence in this committed file (public repo). Pass real sensitive
  secrets (if any) via the environment.

  ASCII-only + English comments on purpose: PowerShell 5.1 reads a BOM-less .ps1 as
  the system ANSI code page, which corrupts non-ASCII characters and breaks parsing.
  Keeping this file ASCII removes that whole class of failure permanently.
#>
[CmdletBinding()]
param(
  [ValidateSet('prod', 'dev')] [string]$Mode = 'dev',
  [int]$Port = 3000,
  [string]$DatabaseUrl = 'postgres://postgres:verify@localhost:55432/fxmily_j7',
  [switch]$SkipBuild
)

$ErrorActionPreference = 'Stop'
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$repo = (Resolve-Path (Join-Path $here '..\..')).Path
$web  = Join-Path $repo 'apps\web'
$resultsDir = Join-Path $here '.results'
New-Item -ItemType Directory -Force -Path $resultsDir | Out-Null

$base = "http://localhost:$Port"

# --- Local-only guard: the seed/tests must never hit a remote database. --------
if ($DatabaseUrl -notmatch ':55432/') {
  throw "REFUS: DatabaseUrl does not point at the verify container (:55432). Local only."
}

# --- Env: db + auth + every prod-gated token (disposable local placeholders). --
$fake = 'j7-local-only-not-a-secret-' + ('x' * 20)   # 47 chars, satisfies min length
$env:DATABASE_URL                     = $DatabaseUrl
$env:AUTH_SECRET                      = $fake
$env:AUTH_URL                         = $base
$env:AUTH_TRUST_HOST                  = 'true'   # Auth.js v5 off-Vercel: else the credentials callback throws "Invalid URL"
$env:CRON_SECRET                      = $fake
$env:ADMIN_BATCH_TOKEN                = $fake
$env:MONTHLY_ADMIN_BATCH_TOKEN        = $fake
$env:CALENDAR_ADMIN_BATCH_TOKEN       = $fake
$env:VERIFICATION_ADMIN_BATCH_TOKEN   = $fake
$env:SEANCES_ADMIN_BATCH_TOKEN        = $fake
$env:PROFILE_ADMIN_BATCH_TOKEN        = $fake
# For k6:
$env:BASE_URL                         = $base
if (-not $env:MEMBER_PASSWORD) { $env:MEMBER_PASSWORD = 'stress-cohort-verify-only' }

Write-Host "== J7 stress suite | mode=$Mode | base=$base ==" -ForegroundColor Cyan

# --- Teardown helper: reliably kill the dev server tree ------------------------
# next dev runs node.exe from Program Files (NOT under $web), so a filter on the
# node exe path misses it. Match the worktree root in the command line instead,
# and tree-kill the launcher. An orphaned next dev keeps the inherited stdout
# handle open and hangs the parent process - so this must be thorough.
function Stop-DevServer {
  param($Launcher, [int]$OnPort)
  if ($Launcher -and -not $Launcher.HasExited) {
    & taskkill /PID $Launcher.Id /T /F *> $null
  }
  try {
    $conns = Get-NetTCPConnection -LocalPort $OnPort -State Listen -ErrorAction SilentlyContinue
    foreach ($c in $conns) { & taskkill /PID $c.OwningProcess /T /F *> $null }
  } catch { }
  Get-CimInstance Win32_Process -Filter "Name='node.exe'" -ErrorAction SilentlyContinue |
    Where-Object { $_.CommandLine -and $_.CommandLine -match [regex]::Escape($repo) } |
    ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
}

# --- 1. Build (prod mode) -----------------------------------------------------
if ($Mode -eq 'prod' -and -not $SkipBuild) {
  Write-Host "-- build (next build)..." -ForegroundColor Yellow
  Push-Location $web
  try { & pnpm --filter '@fxmily/web' build *> (Join-Path $resultsDir 'build.log') }
  finally { Pop-Location }
  if ($LASTEXITCODE -ne 0) { throw "build failed - see .results/build.log" }
}

# --- 2. Start server ----------------------------------------------------------
# pnpm on Windows is a .CMD shim: Start-Process cannot launch it directly with
# redirection ("not a valid Win32 application"), so wrap it via cmd.exe.
if ($Mode -eq 'prod') { $serverArgs = @('exec', 'next', 'start', '-p', "$Port") }
else                  { $serverArgs = @('exec', 'next', 'dev',   '-p', "$Port") }
$cmdLine = @('/c', 'pnpm', '--filter', '@fxmily/web') + $serverArgs
Write-Host "-- start server ($Mode)..." -ForegroundColor Yellow
$srvLog = Join-Path $resultsDir 'server.log'
$srv = Start-Process -FilePath $env:ComSpec -ArgumentList $cmdLine -PassThru -NoNewWindow `
                     -RedirectStandardOutput $srvLog -RedirectStandardError (Join-Path $resultsDir 'server.err.log')

# --- 3. Readiness wait (max 180s; dev cold-compile can be slow) ----------------
# Probe /api/health (200 unauthenticated when the DB is up; the app's real
# liveness endpoint). Do NOT probe /api/auth/csrf here: it is an app ROUTE that
# may 404 (routing/root-confusion) even when the server is fully booted, which
# would falsely read as "server never started" and burn the whole 180s window.
$ready = $false
foreach ($i in 1..180) {
  Start-Sleep -Seconds 1
  try {
    $r = Invoke-WebRequest "$base/api/health" -UseBasicParsing -TimeoutSec 3
    if ($r.StatusCode -eq 200) { $ready = $true; break }
  } catch { }
}
if (-not $ready) {
  Write-Host "!! server not ready after 180s - see .results/server.err.log" -ForegroundColor Red
  Stop-DevServer -Launcher $srv -OnPort $Port
  throw "server did not start ($Mode)"
}
Write-Host "-- server ready (health 200)." -ForegroundColor Green

# Diagnostic: the k6 login() flow depends ENTIRELY on /api/auth/csrf returning
# 200. If the server is live (health 200) but csrf is not 200, that isolates the
# blocker as a ROUTING problem (not a boot problem) - the single most useful
# signal for the next diagnosis. Surface it loudly; the scenarios themselves will
# then fail their auth checks honestly rather than silently producing false data.
try {
  $csrf = Invoke-WebRequest "$base/api/auth/csrf" -UseBasicParsing -TimeoutSec 5
  if ($csrf.StatusCode -eq 200) {
    Write-Host "-- /api/auth/csrf 200 (k6 login viable)." -ForegroundColor Green
  } else {
    Write-Host "!! /api/auth/csrf returned $($csrf.StatusCode) while health is 200 - k6 login WILL fail (routing issue, not boot)." -ForegroundColor Red
  }
} catch {
  Write-Host "!! /api/auth/csrf unreachable while health is 200 - k6 login WILL fail (routing issue, not boot)." -ForegroundColor Red
}

# --- 4. Warm-up (compile Next before measuring) --------------------------------
Write-Host "-- warm-up..." -ForegroundColor Yellow
foreach ($route in '/dashboard', '/checkin', '/classement', '/api/auth/csrf') {
  1..3 | ForEach-Object { try { Invoke-WebRequest "$base$route" -UseBasicParsing -TimeoutSec 30 | Out-Null } catch { } }
}

# --- Scenario runner (self-contained: no automatic-$args, real RSS sampling) ---
function Run-Scenario {
  param([string]$Name, [string]$File, [string[]]$ExtraEnv = @())
  $summary = Join-Path $resultsDir "$Name.json"
  $scenLog = Join-Path $resultsDir "$Name.log"
  Write-Host "-- run $Name ($File)..." -ForegroundColor Yellow
  # NOTE: use $k6Args, NOT $args - $args is an automatic variable and would be
  # empty here, calling k6 with no arguments (which just prints its help text).
  $k6Args = @('run', (Join-Path $here $File), '--summary-export', $summary) + $ExtraEnv
  # Sample node RSS in a background job that EMITS each sample (an infinite loop
  # whose trailing value would be unreachable, so Stop-Job would return nothing).
  $rssJob = Start-Job {
    while ($true) {
      (Get-Process node -ErrorAction SilentlyContinue | Measure-Object WorkingSet64 -Sum).Sum
      Start-Sleep -Milliseconds 500
    }
  }
  & k6 @k6Args *> $scenLog
  Stop-Job $rssJob -ErrorAction SilentlyContinue
  $samples = Receive-Job $rssJob -ErrorAction SilentlyContinue
  Remove-Job $rssJob -Force -ErrorAction SilentlyContinue
  $peak = ($samples | Measure-Object -Maximum).Maximum
  $rssMo = if ($peak) { [math]::Round($peak / 1MB) } else { 0 }
  Write-Host ("   {0} : RSS max node ~{1} Mo (summary -> .results/{0}.json)" -f $Name, $rssMo)
  Add-Content (Join-Path $resultsDir 'rss.txt') ("$Name`t$rssMo Mo")
}

# --- 5. Scenarios. A single warm server serves the 3 reads; S4 brings its own
#        batch load. Restarting the server between each would be ideal - a single
#        warm server is a documented deviation. -------------------------------
Run-Scenario -Name 's1' -File 's1-checkin-burst.js'
Run-Scenario -Name 's3' -File 's3-leaderboard-read.js'
Run-Scenario -Name 's4' -File 's4-api-under-batch.js' -ExtraEnv @('-e', "CRON_SECRET=$($env:CRON_SECRET)")

if ($env:UPLOAD_EMAIL -and $env:UPLOAD_PASSWORD -and $env:UPLOAD_ACCOUNT_ID) {
  Run-Scenario -Name 's2' -File 's2-uploads.js' -ExtraEnv @(
    '-e', "UPLOAD_EMAIL=$($env:UPLOAD_EMAIL)",
    '-e', "UPLOAD_PASSWORD=$($env:UPLOAD_PASSWORD)",
    '-e', "UPLOAD_ACCOUNT_ID=$($env:UPLOAD_ACCOUNT_ID)")
} else {
  Write-Host "-- S2 skipped (UPLOAD_EMAIL/PASSWORD/ACCOUNT_ID absent - see README S2)." -ForegroundColor DarkYellow
}

# --- 6. Teardown --------------------------------------------------------------
Write-Host "-- teardown server..." -ForegroundColor Yellow
Stop-DevServer -Launcher $srv -OnPort $Port

Write-Host "== done. Summaries in $resultsDir ==" -ForegroundColor Cyan
