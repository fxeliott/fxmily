# Runbook — Fxmily AI worker on the server (J9)

Everything the 7 `claude --print` pipelines need in production, on the always-on
host. If you only read one section, read **[Emergency](#emergency--the-three-gestures)**.

Companion files: [`README.md`](README.md) (the Windows worker this replaces),
[`../cron/README.md`](../cron/README.md) (the app-side crons), and
[`../../docs/decisions/ADR-007-ai-worker-on-the-app-host.md`](../../docs/decisions/ADR-007-ai-worker-on-the-app-host.md)
(why it is on THIS host and not a second VPS).

---

## Emergency — the three gestures

| Symptom                                                     | Gesture                                                           |
| ----------------------------------------------------------- | ----------------------------------------------------------------- |
| "The server is generating something wrong / I want it to stop" | `FXMILY_WORKER_DRY_RUN=1` in `/etc/fxmily/cron.env` — next tick, nothing is persisted |
| "The AI has gone completely mute"                            | `sudo -u fxmily -H claude auth login --claudeai` — the session expired |
| "Give me back the PC worker, now"                            | `sudo bash ~/worker/ops/worker/install-worker-vps.sh --uninstall` then re-enable the 7 Windows tasks |

None of the three loses member data: every `pull` is idempotent and re-picks the
members that were not processed.

---

## What runs, and when

Schedules are **Paris wall-clock** (the host is `Europe/Paris`, and Debian
`vixie-cron` reads `/etc/cron.d` hour fields in host-local time — no `CRON_TZ`).
They reproduce the Windows Task Scheduler times 1:1.

| Pipeline       | Schedule                     | What it produces                                     |
| -------------- | ---------------------------- | ---------------------------------------------------- |
| `onboarding`   | every 20 min (`:01/:21/:41`) | the member's `MemberProfile` after the interview      |
| `verification` | every 5 min (`:03…:58`)      | the MT5 proof verdict, while the member is waiting    |
| `seances`      | every 30 min, 08h–23h        | séances reconciliation + heartbeat (**does not generate** — see below) |
| `calendar`     | daily 05h10                  | the adaptive weekly calendar                          |
| `weekly`       | Sunday 05h40                 | the weekly digest                                     |
| `monthly`      | day 1, 06h10                 | the monthly debrief                                   |
| `profile`      | day 2, 06h40                 | the monthly deep re-profiling                         |
| _watchdog_     | every 30 min (`:07/:37`)     | checks the above, posts the `/admin/system` heartbeat |

**`seances` is honest about its limits.** `ReplaySession` stores transcript
*metadata* only — _"content lives derived, never raw here"_. The raw transcript
is never persisted server-side, so the machine that generates the séance content
must be the one holding it: the operator's. This batch therefore pulls,
reconciles the go/no-go, and names every session still waiting on a human
deposit. That is what brings séances **into** the worker contract (lock, logs,
status, heartbeat, monitoring) without pretending it can do a leg it cannot.

---

## Install / re-install

```bash
sudo bash ~/worker/ops/worker/install-worker-vps.sh
```

Idempotent, converges everything, and **proves** what it installed (0 CR bytes,
`bash -n`, mode 0644, 8 schedule rows). Variants:

| Flag            | Effect                                                              |
| --------------- | ------------------------------------------------------------------- |
| `--check`       | verify only, writes nothing                                         |
| `--refresh-env` | re-mirror the 6 tokens from `/etc/fxmily/web.env` (after a rotation) |
| `--uninstall`   | full rollback (see [Rollback](#rollback-to-the-pc))                  |

It never touches `/etc/cron.d/fxmily-app` (the 25 app rows), never restarts a
container, and never writes outside `/usr/local/bin/fxmily-worker*`,
`/etc/cron.d/fxmily-worker`, `/etc/logrotate.d/fxmily-worker` and the worker
checkout.

---

## The Claude session — the one thing a script must not do for you

The 7 pipelines authenticate as whatever account is signed in under
`/home/fxmily/.claude`. Signing in is a credential gesture: it stays manual, on
purpose.

```bash
sudo -u fxmily -H claude auth login --claudeai
```

`--claudeai` selects the **subscription** flow (not Console/API billing). On a
headless box the CLI prints a URL: open it in any browser, sign in with the
account **dedicated to the worker**, and paste the code back. This is the
official first-party flow — never extract a token with a third-party tool
(grey-zone ToS, and it is exactly the kind of thing that gets an account
actioned).

Verify:

```bash
sudo -u fxmily -H claude auth status --json      # → {"loggedIn": true, ...}
```

### Which account, and why it must be dedicated

The pipelines share a 5-hour and a weekly cap with **everything else that
account does**. If the worker runs on the same account as an interactive Claude
Code session, a long session can exhaust the window and the batches go into
cooldown — members wait, and nothing in the app explains why. Use an account
that does nothing else.

### Re-login when the session expires

There is no silent failure mode here, by design:

1. `run-batch.sh` runs `claude auth status --json` **before** every batch. Logged
   out ⇒ the tick is a clean, benign skip (`skipped: "no_claude_auth"` in
   `status.json`), never a cascade of failed generations.
2. The watchdog reports `claude_auth:logged_out`, which `/admin/system`
   escalates to **red** with the exact command to run.
3. Nothing is lost: the members that were not processed are re-picked on the
   next tick.

So the procedure is simply: see the red card → run the login command above →
the next tick generates. No catch-up, no manual replay.

---

## Reading the state

```bash
# Is a pipeline healthy? (machine-readable, one file per pipeline)
sudo -u fxmily cat ~/worker/ops/worker/logs/weekly.status.json

# What happened, in order
sudo tail -50 /var/log/fxmily/worker.log

# Live auth + a full 7-pipeline dry-run (safe at any time — never persists)
sudo -u fxmily bash ~/worker/ops/worker/verify-worker-vps.sh
```

`status.json` fields worth knowing:

| Field         | Meaning                                                             |
| ------------- | ------------------------------------------------------------------- |
| `ok`          | `true` for a clean run **and** for a benign quota cap                |
| `exitCode`    | `0` clean · `75` usage cap (benign) · anything else = a real failure |
| `quotaCapped` | the run hit a Claude usage limit and dropped a cooldown stamp        |
| `skipped`     | `no_claude_auth` \| `quota_cooldown` — a benign pre-flight skip      |
| `account`     | the account the run authenticated as                                |

The same picture, without SSH: **`/admin/system`** → the _Worker_ board, plus
_Actions hôte_ which prints the literal command for whatever is broken.

---

## The switchover (PC → server)

The whole point of J9 is that the PC stops being a single point of failure. Do it
in four steps, and do not skip the observation window.

### 1 · Observation (the doublon)

`/etc/fxmily/cron.env` ships with:

```
FXMILY_WORKER_DRY_RUN=1
```

Every scheduled tick then runs `--dry-run`: the server pulls and generates for
real, and persists **nothing**. The PC stays master. Let it run at least one
full weekly cycle so `weekly`, and ideally `monthly`/`profile`, have actually
fired.

During this window the `/admin/system` worker board is written by **two**
watchdogs (the PC's and the server's). The `watchdogVersion` field says which:
`j9-1.0-obs` is the server, still in observation.

### 2 · Compare

```bash
sudo grep -c 'mode=observation' /var/log/fxmily/worker.log       # ticks
sudo grep 'FAIL' /var/log/fxmily/worker.log                      # anything red?
sudo -u fxmily bash ~/worker/ops/worker/verify-worker-vps.sh     # 7/7 ?
```

The bar to clear: **7/7 pass** with at least the pipelines that had work showing
`PASS/generated`. A `PASS/empty` only proves the token and the endpoint — it does
not prove the model call.

### 3 · Hand over

```bash
# server persists from the next tick
sudo sed -i 's/^FXMILY_WORKER_DRY_RUN=1/FXMILY_WORKER_DRY_RUN=0/' /etc/fxmily/cron.env

# disable the 8 Windows tasks — DISABLE, do not delete (this is the fallback)
#   PowerShell, on the PC:
#   Get-ScheduledTask -TaskName 'Fxmily-worker-*' | Disable-ScheduledTask

# tighten the alerting to an always-on host + fold the worker into /api/cron/health
#   add WORKER_HOST=server to /etc/fxmily/web.env, then:
sudo docker compose -f /opt/fxmily/docker-compose.prod.yml restart web
```

Keep the Windows tasks **disabled but registered** for one week. Re-arming them
is then one command instead of a re-install.

### 4 · Confirm the alerting is real

With `WORKER_HOST=server`, a dead pipeline reaches a human by itself: the worker
board joins `/api/cron/health`, which returns **503**, which makes the hourly
`cron-watch.yml` open a GitHub issue. Prove it once, deliberately:

```bash
# 1. remove ONE pipeline from the schedule
sudo sed -i '/fxmily-worker onboarding/d' /etc/cron.d/fxmily-worker
# 2. wait past its tolerance (onboarding: 20 min × 6 = 2h on the server profile)
# 3. the watchdog reports task_missing:onboarding, /api/cron/health turns 503,
#    cron-watch.yml opens an issue
# 4. put it back
sudo bash ~/worker/ops/worker/install-worker-vps.sh
```

---

## Rollback to the PC

```bash
# 1. server stops persisting IMMEDIATELY (next tick)
sudo sed -i 's/^FXMILY_WORKER_DRY_RUN=0/FXMILY_WORKER_DRY_RUN=1/' /etc/fxmily/cron.env

# 2. PC takes over again (PowerShell, on the PC)
#    Get-ScheduledTask -TaskName 'Fxmily-worker-*' | Enable-ScheduledTask
#    …or, if they were removed:  pwsh -File ops\worker\install-worker.ps1

# 3. relax the alerting back to a machine that sleeps
#    WORKER_HOST=pc in /etc/fxmily/web.env, then restart web

# 4. (optional) remove the server worker entirely
sudo bash ~/worker/ops/worker/install-worker-vps.sh --uninstall
```

Step 1 alone is enough to stop the server. Steps 2–4 are the full return to the
previous state. The uninstall deliberately **keeps** the checkout, `worker.env`,
`~/.claude` and the logs, so re-installing is instant and no history is lost.

---

## Routine maintenance

| When                     | What                                                                       |
| ------------------------ | -------------------------------------------------------------------------- |
| after a token rotation   | `sudo bash ~/worker/ops/worker/install-worker-vps.sh --refresh-env`         |
| after merging to `main`  | `sudo -u fxmily git -C ~/worker fetch --depth 1 origin main && sudo -u fxmily git -C ~/worker reset --hard FETCH_HEAD` then re-run the installer |
| Claude CLI update        | `sudo -u fxmily -H npm install -g @anthropic-ai/claude-code`                |
| logs                     | rotated weekly, 8 kept (`/etc/logrotate.d/fxmily-worker`) — nothing to do   |

**Keep the checkout in step with the deployed app.** The batch scripts speak to
`/api/admin/*` endpoints whose contract lives in the same commit. A checkout that
lags behind a deployed schema change is exactly how a batch starts failing Zod
validation server-side with a message nobody expects.

---

## Optional: external dead-man switch (Healthchecks.io)

The primary alert path (`/api/cron/health` → `cron-watch.yml` → GitHub issue)
needs no third-party account and is already proven in production. Healthchecks.io
is the **second** path, useful because it fires even if the app itself is down.

It is wired and inert: `/etc/fxmily/cron.env` declares one blank URL per
pipeline, and a blank URL makes the wrapper skip the ping entirely.

```
HEALTHCHECK_PING_URL_WORKER_ONBOARDING=https://hc-ping.com/<uuid>
HEALTHCHECK_PING_URL_WORKER_VERIFICATION=…
```

One check per pipeline, deliberately — with seven pipelines behind a single
check, one healthy tick keeps the check green while six are dead, which is worse
than no check at all. `/start` before the run, the bare URL on success, `/fail`
on a real failure. A benign skip pings success on purpose: the check answers
_"is this pipeline still being ticked"_, not _"did it have work to do"_.

Provision the checks with [`../scripts/healthchecks-setup.sh`](../scripts/healthchecks-setup.sh).

---

## Known traps

- **CRLF is fatal and silent.** `crond` skips a `/etc/cron.d` line containing a
  `\r` without logging anything — that is the ~20h outage of 2026-05-11. The
  installer strips CR on write and both the installer and the watchdog count CR
  bytes on every pass.
- **`HOME` is not optional.** The global lock lives at `$HOME/.fxmily-worker.lock`.
  A cron job with an empty `HOME` would create a *second* "global" lock and
  silently break the one-`claude`-at-a-time guarantee. The wrapper sets it.
- **`nice` is not the isolation.** The worker shares the box with `fxmily-web`
  and Postgres. `nice`/`ionice` make it polite, they do not cap it. If a batch
  ever starves the app, the answer is the `FXMILY_WORKER_TIMEOUT` ceiling and
  fewer members per run — not removing the politeness.
- **Never bypass the jittered sleep.** `--skip-sleep` and
  `FXMILY_SLEEP_MIN_S` below 30 exist for tests. The sleep IS the anti-ban
  design; the core refuses a floor under 30s and that refusal is a feature.
- **Two masters is a real risk.** If the PC tasks are re-enabled while the
  server persists, two machines generate the same work on two accounts. Nothing
  corrupts (pulls filter, persists are idempotent) but it burns two quotas for
  one result. Only one master at a time.
