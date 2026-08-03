# Runbook — Fxmily AI worker on the server (J9)

Everything the 7 `claude --print` pipelines need in production, on the always-on
host. If you only read one section, read **[Emergency](#emergency--the-three-gestures)**.

Companion files: [`README.md`](README.md) (the Windows worker this replaces),
[`../cron/README.md`](../cron/README.md) (the app-side crons), and
[`../../docs/decisions/ADR-007-ai-worker-on-the-app-host.md`](../../docs/decisions/ADR-007-ai-worker-on-the-app-host.md)
(why it is on THIS host and not a second VPS).

---

## Emergency — the three gestures

| Symptom                                                        | Gesture                                                                                              |
| -------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| "The server is generating something wrong / I want it to stop" | `FXMILY_WORKER_DRY_RUN=1` in `/etc/fxmily/cron.env` — next tick, nothing is persisted                |
| "The AI has gone completely mute"                              | `sudo -u fxmily -H claude auth login --claudeai` — the session expired                               |
| "Give me back the PC worker, now"                              | `sudo bash ~/worker/ops/worker/install-worker-vps.sh --uninstall` then re-enable the 7 Windows tasks |

None of the three loses member data: every `pull` is idempotent and re-picks the
members that were not processed.

---

## What runs, and when

Schedules are **Paris wall-clock** (the host is `Europe/Paris`, and Debian
`vixie-cron` reads `/etc/cron.d` hour fields in host-local time — no `CRON_TZ`).
They reproduce the Windows Task Scheduler times 1:1.

| Pipeline       | Schedule                     | What it produces                                                       |
| -------------- | ---------------------------- | ---------------------------------------------------------------------- |
| `onboarding`   | every 20 min (`:01/:21/:41`) | the member's `MemberProfile` after the interview                       |
| `verification` | every 5 min (`:03…:58`)      | the MT5 proof verdict, while the member is waiting                     |
| `seances`      | every 30 min, 08h–23h        | séances reconciliation + heartbeat (**does not generate** — see below) |
| `calendar`     | daily 05h10                  | the adaptive weekly calendar                                           |
| `weekly`       | Sunday 05h40                 | the weekly digest                                                      |
| `monthly`      | day 1, 06h10                 | the monthly debrief                                                    |
| `profile`      | day 2, 06h40                 | the monthly deep re-profiling                                          |
| _watchdog_     | every 30 min (`:07/:37`)     | checks the above, posts the `/admin/system` heartbeat                  |

**`seances` is honest about its limits.** `ReplaySession` stores transcript
_metadata_ only — _"content lives derived, never raw here"_. The raw transcript
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

| Flag            | Effect                                                               |
| --------------- | -------------------------------------------------------------------- |
| `--check`       | verify only, writes nothing                                          |
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

> **This is a requirement, not an observed state — and nothing here can check
> it.** `claude auth status --json` reports whether _an_ account is logged in,
> never which one nor what else it does; the board sees the consequence
> (`claude_quota:capped`, then heartbeats going stale) long after the fact, and
> reports it as a benign self-resolving pause. So a shared account does not fail
> loudly, it fails as _members waiting_, which is the exact silence this jalon
> exists to remove.
>
> Concretely: if the account used here is the same one that runs anything else on
> a schedule, the anti-ban mitigations still hold but the capacity argument above
> does not, and a busy day can starve the pipelines. That is a call for Eliot to
> make and to state explicitly — it has not been recorded anywhere, and this
> paragraph must not be read as evidence that it was.

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

# Live auth + a full 7-pipeline dry-run. Never persists. It goes THROUGH
# run-batch.sh, so each pipeline takes the machine-global lock while it runs —
# one `claude --print` at a time, as intended. But it takes that lock SEVEN
# times, not once: between two pipelines the lock is free, and a scheduled tick
# landing in that gap will take it and make the next pipeline exit benignly.
# That shows up as `FAIL/skipped` rather than a false pass. If it happens, just
# re-run; run it outside :01/:21/:41 and :25/:55 if you want a clean sweep.
# Expect it to run for a while: 7 pipelines × members × 60-120s jitter.
sudo -u fxmily -H bash ~/worker/ops/worker/verify-worker-vps.sh
```

`status.json` fields worth knowing:

| Field         | Meaning                                                              |
| ------------- | -------------------------------------------------------------------- |
| `ok`          | `true` for a clean run **and** for a benign quota cap                |
| `exitCode`    | `0` clean · `75` usage cap (benign) · anything else = a real failure |
| `quotaCapped` | the run hit a Claude usage limit and dropped a cooldown stamp        |
| `skipped`     | `no_claude_auth` \| `quota_cooldown` — a benign pre-flight skip      |
| `account`     | the account the run authenticated as                                 |

The same picture, without SSH: **`/admin/system`** → the _Worker_ board, plus
_Actions hôte_ which prints the literal command for whatever is broken.

---

## The switchover (PC → server)

The whole point of J9 is that the PC stops being a single point of failure. Do it
in four steps, and do not skip the observation window.

### 1 · Observation (the doublon)

The installer appends this to `/etc/fxmily/cron.env`, and `--check` fails if it
is absent:

```
FXMILY_WORKER_DRY_RUN=1
```

Every scheduled tick then runs `--dry-run`: the server pulls, persists
**nothing**, and the PC stays master. Note that three pipelines (`onboarding`,
`verification`, `seances`) stop right after the pull in dry-run and never call
the model — observation proves their tokens and endpoints, not their generation.
The other four generate for real.

Observation is also the **default**: if the line is missing entirely, the wrapper
still runs `--dry-run`. Going to production has to be something someone typed on
purpose, never something that happens because a config line was lost.

**Observe WITHOUT signing in, then sign in only to switch over.** This ordering is
not cosmetic, and it is the opposite of what feels natural.

While no account is signed in on the server, every tick is a clean benign skip
(`skipped: "no_claude_auth"`): the cron, the lock, the wrappers, the logs, the
watchdog and the heartbeat are all exercised, and the quota cost is **exactly
zero**. That is the window you want to let run long — it proves the plumbing,
which is the only thing observation can prove anyway.

The moment you sign in, the four generators start calling the model for real on
every tick **and throwing the answer away** (dry-run persists nothing) while the
PC produces the copy members actually receive. Every one of those calls is pure
waste, billed to the 5-hour and weekly caps of the very account the PC is using
to serve members. `calendar` alone is one full generation per member per day.

So do not "sign in, then observe for a week". Do:

1. let the un-authenticated observation run as long as you like (zero cost) ;
2. sign in ;
3. run the verification once — that single sweep IS the generation proof ;
4. switch over the same day.

Keeping both machines generating on one account for days risks a cap, and a cap
hits the PC too — that is, the members.

During this window the `/admin/system` worker board is written by **two**
watchdogs (the PC's and the server's). The `watchdogVersion` field says which:
`j9-1.0-obs` is the server, still in observation.

### 2 · Compare

```bash
sudo grep -c 'mode=observation' /var/log/fxmily/worker.log       # ticks
sudo grep 'FAIL' /var/log/fxmily/worker.log                      # anything red?
sudo -u fxmily bash ~/worker/ops/worker/verify-worker-vps.sh     # 7/7 ?
```

The bar to clear: **7/7 pass**, read with the verdict each pipeline is capable of
producing:

| Verdict          | Means                                          | Which pipelines                            |
| ---------------- | ---------------------------------------------- | ------------------------------------------ |
| `PASS/generated` | token + endpoint + **a real model call**       | `weekly`, `monthly`, `calendar`, `profile` |
| `PASS/pull-only` | token + endpoint, model call **not reachable** | `onboarding`, `verification`, `seances`    |
| `PASS/empty`     | token + endpoint, nothing to do this cycle     | any generator with an empty cohort         |

`onboarding`, `verification` and `seances` return **before** any model call in
`--dry-run`, by construction — so `PASS/pull-only` is the strongest honest verdict
they can give, and demanding `PASS/generated` from them would be waiting for
something that cannot happen. Their model path is proven at the first persisting
tick, not here.

So: 7/7, and at least one `PASS/generated` among the four generators that had work.

### 3 · Hand over

```bash
# server persists from the next tick
sudo sed -i 's/^FXMILY_WORKER_DRY_RUN=1/FXMILY_WORKER_DRY_RUN=0/' /etc/fxmily/cron.env

# disable the 7 Windows tasks (6 pipelines + the watchdog) — DISABLE, do not
# delete: they are the fallback.
#   PowerShell, on the PC:
#   Get-ScheduledTask -TaskName 'Fxmily-worker-*' | Disable-ScheduledTask

# tighten the alerting to an always-on host + fold the worker into /api/cron/health
#   add WORKER_HOST=server to /etc/fxmily/web.env, then:
sudo docker compose -f /opt/fxmily/docker-compose.prod.yml restart web

# THEN VERIFY — do not walk away here. `WORKER_HOST` is a Zod enum accepting
# exactly `pc` | `server`. A typo (`Server`, the French `serveur`, a trailing
# space) fails validation at boot and the container does NOT come back up: the
# very last gesture of the switchover is the one that can take the app down,
# at night, with nobody watching.
sleep 5
curl -fsS https://app.fxmilyapp.com/api/health   # expect 200 + {"status":"ok"}
```

If that curl does not answer, do not retry blindly:

```bash
sudo docker compose -f /opt/fxmily/docker-compose.prod.yml logs --tail=50 web
# An invalid WORKER_HOST prints a Zod error naming the variable. Fix the value
# in /etc/fxmily/web.env and restart again. Deleting the line is also a valid
# rollback: absent ⇒ default `pc` ⇒ previous alerting, app boots.
```

Keep the Windows tasks **disabled but registered** for one week. Re-arming them
is then one command instead of a re-install.

### 4 · Confirm the alerting is real

With `WORKER_HOST=server`, a dead pipeline reaches a human by itself: the worker
board joins `/api/cron/health`, which returns **503**, which makes the hourly
`cron-watch.yml` run **fail**.

What that failure looks like matters, because it is not an issue in your inbox:
`cron-watch.yml` used to auto-open GitHub Issues and stopped — Issues are
disabled on this repo, so the API call returned `410` and the workflow broke.
It now simply exits non-zero. The signal is therefore **a red run in the Actions
tab plus GitHub's own failed-workflow notification email**, and nothing else.
If you want a channel that survives the app being down entirely, that is what
the optional Healthchecks.io section below is for.

Prove it once, deliberately:

```bash
# 1. remove ONE pipeline from the schedule
sudo sed -i '/fxmily-worker onboarding/d' /etc/cron.d/fxmily-worker
# 2. wait for the NEXT watchdog tick (:07 or :37 — so 30 min at worst)
# 3. it reports task_missing:onboarding. That label is critical on the server
#    profile, so the board turns red on the label alone, and /api/cron/health
#    returns 503 → the next hourly cron-watch run goes red.
# 4. put it back
sudo bash ~/worker/ops/worker/install-worker-vps.sh
```

Two independent paths lead to that red, and it is worth knowing which is which:

- **by label** — the watchdog names the fault (`task_missing`, `cron_file_crlf`,
  `batch_failed`, …). Fast (≤ 30 min) and diagnostic: the board says _what_ broke.
- **by age** — the pipeline's own `<name>.batch.pulled` heartbeat goes stale past
  its tolerance (4h for `onboarding`). Slower, and it only says _something_ broke.

The label path exists because age alone is blind to the worst failure mode: a
batch that runs, pulls its envelope — refreshing the heartbeat, keeping it
green — and then generates nothing. Age can never see that. `batch_failed` can.

**One known limit, for the observation window only.** Both watchdogs — the PC's
and the server's — report into the same `worker.watchdog.heartbeat` slot, and
the board reads the most recent row. They tick at the same :07/:37, so during
the doublon window a real `claude_auth:logged_out` coming from the PC can be
overwritten by the server's `claude_auth:observation_pending`, which is only
amber. Two consequences worth knowing while you are in that window:

- do not rely on the board alone to notice the PC losing its Claude session —
  check it directly (`claude auth status` on the PC) before the handover ;
- `watchdogVersion` on the audit row tells you which machine wrote the last one
  (`j9-1.0-obs` = the server).

This resolves itself the moment the PC tasks are disabled: one watchdog, one
writer. It is a property of running two workers on purpose, not a defect to fix
before the switchover.

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

| When                    | What                                                                                                                                                                                                                                                                                              |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| after a token rotation  | `sudo bash ~/worker/ops/worker/install-worker-vps.sh --refresh-env`                                                                                                                                                                                                                               |
| after merging to `main` | wrappers converge on the deploy itself. The **checkout** (`~/worker`) does not: **Actions → “Worker host sync” → `converge`** (below). Manual equivalent: `sudo -u fxmily git -C ~/worker fetch origin main && sudo -u fxmily git -C ~/worker reset --hard FETCH_HEAD`, then re-run the installer |
| Claude CLI update       | `sudo -u fxmily -H npm install -g @anthropic-ai/claude-code`                                                                                                                                                                                                                                      |
| logs                    | rotated weekly, 8 kept (`/etc/logrotate.d/fxmily-worker`) — nothing to do                                                                                                                                                                                                                         |

### What a merge to `main` reaches, and what it does not

Two separate things live on this host, and only one of them travels with a
deploy:

| Thing                                                        | Reached by a merge to `main`?                                                |
| ------------------------------------------------------------ | ---------------------------------------------------------------------------- |
| the two wrappers (`fxmily-worker`, `fxmily-worker-watchdog`) | **yes** — `deploy.yml` stages them, `fxmily-sync-cron` installs them (below) |
| `~/worker` (the checkout the batch scripts run FROM)         | **no** — nothing pushes it; `converge`, or the manual `git reset`, moves it  |

**The wrappers.** `deploy.yml` scp's the ops scripts to `/home/fxmily/cron-sync`
and then runs the one command `fxmily` may run as root
(`sudo /usr/local/bin/fxmily-sync-cron`). That validator carries a
`MANAGED_SCRIPTS` table and installs every entry it finds staged. J9 shipped its
two wrappers in **neither** list, so a merged wrapper fix changed the repository
and nothing else — PRs #580 and #581 both patched
`fxmily-worker-watchdog` while the machine kept running the #579 copy. Two
filenames in `deploy.yml:169` and two rows in `fxmily-sync-cron:56` close that,
automatically, on every healthy deploy.

> **One-off, root, once:** `fxmily-sync-cron` is **root-pinned — it never
> installs itself**. The updated table only takes effect after a root operator
> installs the new validator once:
> `install -o root -g root -m 0755 /home/fxmily/cron-sync/fxmily-sync-cron /usr/local/bin/fxmily-sync-cron`.
> Until that is done, deploys keep converging the five older scripts and the two
> wrappers stay behind.
>
> **You will not have to remember this.** Keeping the pin has a cost — a change
> to the table does nothing until a human acts — and an unannounced cost is the
> exact silence this jalon exists to remove. So it is announced, twice, on every
> deploy: the deploy step compares the staged validator with the installed one
> and raises a GitHub warning, and the validator itself prints a `NOTE:` when a
> different copy of it is staged. The first works even while the OLD validator is
> the one installed, which is the case that matters today.
>
> The pin itself is **not** an oversight to be fixed later. This script decides
> which paths the deploy may write as root; if the deploy could replace it, a
> bounded grant would become an unbounded one. The gesture is the price of that
> boundary, and it is worth paying.
>
> How many paths the grant actually covers is a number that has already drifted
> twice, so read it from the script rather than from this sentence:
>
> ```bash
> { sed -n '/^MANAGED_SCRIPTS=(/,/^)/p' ops/cron/fxmily-sync-cron \
>     | grep -oE '(/usr/local/bin|/etc/cron\.d)/[a-z0-9-]+'
>   grep -E '^DST_(CRONTAB|RUNNER)=' ops/cron/fxmily-sync-cron | sed 's/.*="//;s/"//'
> } | sort -u
> ```
>
> Ten, on the day this was written.

**The checkout.** `~/worker` is what `/usr/local/bin/fxmily-worker` actually
executes. No deploy touches it. That is what the ops workflow
[`.github/workflows/worker-host-sync.yml`](../../.github/workflows/worker-host-sync.yml)
is for — the sibling of `sync-caddy-prod.yml`, and the only thing that can
_measure_ this host from CI:

| Mode       | Does                                                                                                                       |
| ---------- | -------------------------------------------------------------------------------------------------------------------------- |
| `inspect`  | measures the host: each installed wrapper **byte-for-byte against what the last deploy staged**, plus the checkout's state |
| `converge` | resets the checkout to `origin/main`, then installs the wrappers if it has the root reach to do so                         |
| `verify`   | runs `verify-worker-vps.sh` — the 7-pipeline dry-run. Never persists                                                       |

**Read the two drift messages as the two different problems they are.** Since the
wrappers travel with the deploy, `/usr/local/bin/fxmily-worker*` and `~/worker`
have different update paths, so `inspect` reports on them separately:

| Message          | Means                                                                              | Do                                                                         |
| ---------------- | ---------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| _Wrapper drift_  | the installed wrapper is not what the last deploy staged                           | re-install `fxmily-sync-cron` as root (it never installs itself), redeploy |
| _Stale checkout_ | `~/worker` is behind the installed wrappers — **the batch scripts run from there** | `converge`                                                                 |

That distinction is not cosmetic. Comparing only against the checkout — which is
what this section did before the wrappers joined the deploy — would report
_"the host is not running main"_ on a host that is **exactly** at main, the first
time a deploy lands a wrapper fix. A gate that says the opposite of the truth
stops being read.

Two things it deliberately does not do, each for a reason this repo already paid for:

- **It is not scheduled.** A red-by-default watcher stops being a signal:
  `Cron Watch` has been failing on the apex probe for days, so it can no longer
  announce a _new_ outage. One more permanently-red run would buy nothing.
  Run `inspect` after any PR that touches `ops/cron/fxmily-worker*`.
- **It does not install the wrappers on its own** unless the host actually grants
  it root. The `fxmily` sudoers entry is exactly one command with no arguments
  (`fxmily-sync-cron`, `deploy.yml:366-376`). When the grant is absent, `converge`
  leaves the checkout up to date, prints the one root command, and **fails** —
  rather than reporting a convergence that did not happen.

Its run logs are **public** (this repository is public), so it prints token
_lengths_ and never values, the `.loggedIn` boolean and never the account, and
never the `*.wrapper.log` transcripts, which contain member content.

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

Create the seven checks **by hand** in the Healthchecks.io dashboard, then paste
the ping URLs into `/etc/fxmily/cron.env`.
[`../scripts/healthchecks-setup.sh`](../scripts/healthchecks-setup.sh) does
**not** cover them: its table lists the twelve host crons and no AI pipeline.
Pointing you at it would have you run a script that provisions nothing you need
and report success — extend it, or do it by hand, but do not assume it ran.

---

## Known traps

- **CRLF is fatal and silent.** `crond` skips a `/etc/cron.d` line containing a
  `\r` without logging anything — that is the ~20h outage of 2026-05-11. The
  installer strips CR on write and both the installer and the watchdog count CR
  bytes on every pass.
- **`HOME` is not optional.** The global lock lives at `$HOME/.fxmily-worker.lock`.
  A cron job with an empty `HOME` would create a _second_ "global" lock and
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
