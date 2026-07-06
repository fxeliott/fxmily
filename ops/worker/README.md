# Fxmily local AI worker (J2)

Automates the five Claude batch orchestrators so member-facing AI is generated
**without a human in the loop** — the fix for the _« IA silence 24H après profil
rempli »_ bug.

## The bug this fixes

`finalizeInterview` only flips the onboarding interview to `completed` — it makes
**zero** Claude calls (`src/lib/onboarding-interview/service.ts:360` _"ZERO
Claude API call here"_). The **only** thing that ever creates the member's
`MemberProfile` is the local batch, which until J2 was _"human-in-the-loop : run
manually by Eliot"_ (`ops/scripts/lib/claude-batch-core.sh:25`). So a member who
finished their interview got **nothing** until the script was run by hand — while
`/profile` and the interview-complete screen both promise the profile _« dans les
prochaines 24h »_. The only automatic net (`/api/cron/onboarding-profile-overdue-alert`)
_"never drives Claude — count + email only"_ (`overdue.ts:123`).

This worker makes the generation itself automatic and permanent.

## How it works

Windows Task Scheduler runs `run-batch.sh <pipeline>` on a schedule. The wrapper
**does not change how a batch talks to Claude** — it only schedules the existing
`ops/scripts/<pipeline>-batch-local.sh`, serialises them, logs, and records the
last-run status.

```
Task Scheduler ──► run-batch.sh onboarding ──► ops/scripts/onboarding-batch-local.sh
   (every 20m)         (global lock,               (pull → claude --print ×N,
                        env, logging)               jittered 60-120s → persist)
```

### Ban-risk safety is preserved by construction

Every mitigation lives in the batch scripts + `claude-batch-core.sh` and is left
untouched:

- jittered sleeps **≥30s** between members, one `claude --print` per member;
- **no parallelisation** — `run-batch.sh` holds a **global** lock, so at most one
  batch (hence one `claude --print`) runs at any instant across all five
  pipelines, exactly as when they were run by hand one after another;
- official `claude` binary only, `--bare` forbidden, per-call budget cap;
- pull is **idempotent** (already-analysed rows are filtered server-side), so a
  skipped or retried tick is always safe.

Schedules are staggered (onboarding every 20 min; verification every 5 min —
tour 15, shortened from 20 min so an uploaded MT5 proof is analysed while the
member is still waiting; calendar Mon 05:10; weekly Sun 05:40; monthly day-1
06:10) so the pipelines effectively never collide. If two interval ticks still
realign, the global lock + `MultipleInstances IgnoreNew` make the later tick
skip cleanly, and the next tick — or the server-side overdue-alert net — picks
the work up.

## Claude auth & multi-comptes

The worker holds **no** Claude credentials of its own. Auth lives in a single
file, `~/.claude/.credentials.json`, and each `claude login` **overwrites** it —
so there is exactly **one active Claude account per machine** at any moment.
Every `claude --print` (one child process per member) reads that file at
startup, which means:

- **The worker automatically follows the active account.** Switch accounts with
  `claude login` in any terminal and the very next batch tick uses the new one —
  no worker restart, no config change. Switching **during** a batch is safe too:
  the member currently in flight finishes on the old account, the next member
  picks up the new one (`status.json` records an `accountEnd` different from
  `account` as the switch signal — a local-only field, never sent anywhere).
- **LogonType Interactive is mandatory** (see Install). S4U cannot read that
  OAuth file (proven 2026-07-02): an S4U task looks green while every batch fails
  silently. `install-worker.ps1` defaults to Interactive and warns on S4U;
  `watchdog.ps1` raises `task_logon_type:<name>` if it ever finds a non-Interactive
  worker task.
- **Logged out or capped → graceful skip, automatic resume.** Before touching
  `claude`, each tick runs `claude auth status --json` (instant, zero quota). If
  nobody is logged in, the tick skips cleanly (`status.json` → `skipped:"no_claude_auth"`,
  `authOk:false`) and does **not** burn the cohort against a broken auth — it
  resumes on its own once you log back in (pull is idempotent, so unprocessed
  members are re-picked). If a run hits a Claude usage/rate limit, the pipeline
  stops early, persists whatever it already generated, and exits 75; `run-batch.sh`
  drops a `logs/quota-halt.stamp` and every tick then skips
  (`skipped:"quota_cooldown"`) for `FXMILY_QUOTA_COOLDOWN_MIN` minutes (default
  60, env-overridable) before resuming automatically at the next quota window. A
  cap is **benign**: `run-batch.sh` reports success (0) to Task Scheduler so a
  bare cap never raises a scheduler alert, while `status.json` still carries
  `exitCode:75` + `quotaCapped:true` and the watchdog surfaces `claude_quota:capped`
  on `/admin/system`.

**PII note:** the active account email is written **only** to local logs and
`status.json` (both under `ops/worker/logs/`, git-ignored, pruned after 14 days).
It is **never** included in the watchdog heartbeat, whose contract is counts-only
(no token, no username).

## Install

1. Provide the token (never committed):

   ```bash
   cp ops/worker/worker.env.example ops/worker/worker.env
   # edit worker.env → FXMILY_ADMIN_TOKEN=<32+ chars, matches prod ADMIN_BATCH_TOKEN>
   ```

2. Register the tasks (no admin rights needed):

   ```powershell
   powershell -ExecutionPolicy Bypass -File ops\worker\install-worker.ps1 -LogonType Interactive
   ```

   Tasks run as **you** with LogonType **Interactive** (the default). `claude
--print` reads the account currently logged in under `~/.claude`
   (`.credentials.json`). **Interactive is mandatory**: S4U was proven incapable
   of reading the Claude OAuth on 2026-07-02 — an S4U task registers and looks
   green, but every batch fails silently. Leave the PC logged in (screen may be
   locked) and the worker keeps ticking. `-LogonType S4U` is still accepted but
   emits a loud warning; don't use it for these batches.

## Self-healing watchdog (tour 12)

`install-worker.ps1` also registers a 7th task, `Fxmily-worker-watchdog`
(every 30 min, offset :07/:37). It runs `watchdog.ps1`, which:

- re-enables a disabled pipeline task and re-registers missing ones via
  `install-worker.ps1 -SkipWatchdog -LogonType Interactive` (Interactive is
  non-negotiable on repair: S4U cannot read the Claude OAuth). Repair is
  skipped while a batch is running and capped at 3 consecutive attempts;
- verifies `worker.env` holds the 5 tokens (32+ chars) — closes the hole
  where a missing env file made every tick a silent benign skip forever;
- signals (never deletes) a stale global lock and a hard-killed run whose
  `status.json` never got written;
- POSTs a counts-only heartbeat to `/api/admin/worker-watchdog/heartbeat`
  (X-Admin-Token = `FXMILY_ADMIN_TOKEN`). That row is monitored on
  `/admin/system` — a dead watchdog surfaces there like any dead cron.

Logs: `ops/worker/logs/watchdog.log`; repair state:
`ops/worker/logs/watchdog.state.json`.

## Operate

```powershell
powershell -File ops\worker\status-worker.ps1      # state + last result per pipeline
powershell -File ops\worker\uninstall-worker.ps1   # remove every worker task
```

Logs: `ops/worker/logs/<pipeline>.log` (rotated, >14 days pruned).
Machine-readable last run: `ops/worker/logs/<pipeline>.status.json`.

## Manual / test run

```bash
# dry run against local dev (pull only, no claude, no persist):
FXMILY_BASE_URL=http://localhost:3000 FXMILY_ADMIN_TOKEN=<local> \
  bash ops/worker/run-batch.sh onboarding -- --dry-run

# one real member against local dev, no sleeps:
FXMILY_BASE_URL=http://localhost:3000 FXMILY_ADMIN_TOKEN=<local> \
  bash ops/worker/run-batch.sh onboarding -- --max-members 1 --skip-sleep
```

Explicit env vars override `worker.env`, so the same wrapper drives both the
scheduled prod runs and a local proof.
