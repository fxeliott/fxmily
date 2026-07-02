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

Schedules are staggered (onboarding every 20 min; verification 04:10; calendar
Mon 05:10; weekly Sun 05:40; monthly day-1 06:10) so the five effectively never
collide. If one still does, the later tick skips cleanly and the next tick — or
the server-side overdue-alert net — picks the work up.

## Install

1. Provide the token (never committed):

   ```bash
   cp ops/worker/worker.env.example ops/worker/worker.env
   # edit worker.env → FXMILY_ADMIN_TOKEN=<32+ chars, matches prod ADMIN_BATCH_TOKEN>
   ```

2. Register the tasks (no admin rights needed):

   ```powershell
   powershell -ExecutionPolicy Bypass -File ops\worker\install-worker.ps1
   ```

   Tasks run as **you** with LogonType **S4U** ("whether logged on or not") so the
   worker keeps ticking on an always-on PC. `claude --print` uses your Claude Max
   OAuth under `~/.claude`. If S4U can't reach that auth in your setup, re-run with
   `-LogonType Interactive` (ticks only while you're logged on).

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
