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

> **This paragraph used to say the requirement could not be checked. That was
> wrong, and it was wrong about a fact this repo could have measured at any
> time.** It read: "`claude auth status --json` reports whether _an_ account is
> logged in, never which one nor what else it does". Measured 2026-08-04: a
> subscription session returns `email`, `orgName` and `subscriptionType` — and
> `run-batch.sh` had **always** read `.email` and recorded it in `status.json`.
> The identity was captured all along; nothing ever compared it to anything.
>
> It is now checkable, and opt-in. Set `FXMILY_WORKER_EXPECTED_ACCOUNT_SHA256`
> in `worker.env` to the sha256 of the lower-cased address of the dedicated
> account:
>
> ```bash
> printf '%s' 'the-account@example.com' | tr '[:upper:]' '[:lower:]' | sha256sum | cut -d' ' -f1
> ```
>
> A mismatch skips the tick — benign, idempotent, nothing lost — and raises
> `claude_account:unexpected`, which the board escalates to red with the login
> command. Skipping beats running: a skipped tick is recovered by the next one,
> whereas quota spent on the wrong account is not. A session that carries no
> address at all (an environment-variable token returns neither `email` nor
> `subscriptionType`) raises `claude_account:unverifiable` rather than passing
> quietly.
>
> **What is still NOT checkable**: what else that account does. The guard proves
> the worker runs on the account you named; it cannot prove that account is idle
> elsewhere. Sharing it remains a call for Eliot to make and to state — and one
> the anti-ban mitigations survive, while the capacity argument above does not.

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

**This bar was cleared on 2026-08-07.** Run `31150625063`, on the real host:

```
onboarding    PASS/pull-only  (1s)     weekly   PASS/generated  (1113s, 7 generated)
verification  PASS/pull-only  (2s)     monthly  PASS/generated  (3158s, 18 generated)
seances       PASS/pull-only  (1s)     profile  PASS/generated  (1792s, 11 generated)
calendar      PASS/empty      (1s)
RESULT: 7/7 pass, 0/7 fail
```

Three `PASS/generated`, not one. Note the durations: the sweep took just over
**100 minutes of real generation**, which is why the next two paragraphs exist.

#### The verdict expires. Do not start a sweep you cannot come back to.

`verify-status` refuses a verdict older than `VERDICT_MAX_AGE_MIN` (default 720,
i.e. 12 hours) and tells you to start a fresh sweep. That refusal is correct — a
week-old `7/7` says nothing about the host today — but it means an unread verdict
is a **destroyed** one: the 100 minutes above have to be spent again. The verdict
proving J9 was read at **346 of those 720 minutes**, with under six hours to
spare, and only because someone went looking for it.

So: launch `mode=verify` when you can read `mode=verify-status` the same day.
Overnight is fine; a Friday evening is not.

#### The launcher taking 40 minutes is NOT a bug. Do not "fix" it.

`mode=verify` reliably burns the full `Run Command Timeout` before returning,
even though the sweep itself is correctly detached (`nohup setsid … &`, and the
sweep provably survives the session ending — that is the whole point of the
detach). Measured on 2026-08-06/07: the delay is the **host under load** while
seven pipelines call the model. On an idle host the same code path returns in
**under 30 seconds**. Two runs, same script, same host: 40 min during the sweep,
under 30 s afterwards.

A future reader will see "launcher hangs 40 min" and reach for the launcher. The
launcher is not the problem, and rewriting it would trade a working detach for a
new bug. If you want the wall-clock back, the lever is the sweep's serial design
and its 30-second floor per member — and that floor **is** the anti-ban guarantee,
so it does not move.

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
This paragraph used to end by saying Healthchecks.io was for "a channel that
survives the app being down". That was wrong, and wrong in a way worth keeping
written down: `cron-watch.yml` runs on GitHub's machines and _calls_ the app, so
the app being down is the one failure it detects best — the curl simply fails.

The real gap is the opposite one, and it is not hypothetical. On 2026-08-06 from
15:22 UTC, GitHub Actions had a major incident; every job died in `Set up job`
with `Failed to resolve action download info`. For those hours `cron-watch` did
not run at all, and a silent poller is indistinguishable from a healthy system.
That is the hole Healthchecks.io fills: it is a **dead-man** switch, so it alerts
when a ping STOPS arriving, whoever stopped sending it — including GitHub.

Both channels also depend on the same worker actually being alive, so neither
replaces reading the board. They fail independently, which is the whole point.

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

**The same blindness had a second door, and it was the more likely one to be
used.** A run stopped by the Claude usage cap exits 75, which `run-batch.sh`
remaps to 0 for cron — deliberately, so a normal pause is not reported as a
recurring failure. But that tick had already pulled its envelope before the
first `claude --print`, so it refreshed the heartbeat on its way to producing
nothing; the cooldown is 60 minutes and the tightest tolerance is 240, so the
age is renewed roughly hourly for as long as the cap lasts. `health.ts` claimed
the opposite ("if it lasts, the pull heartbeats go stale and red on age") and
that claim was false: a Monday-morning cap could have taken out a whole week
with this board fully green.

Worse, the label was not even continuously present. `claude_quota:capped` is
written by the tick that HITS the cap; every tick for the following hour writes
`skipped: quota_cooldown` instead — and nothing read that field, so for roughly
40 minutes out of every 60 the board carried no quota label at all.

Both are closed:

- the watchdog raises `claude_quota:capped` on **either** state, so the pause is
  visible continuously (amber, informational — it usually does clear by itself) ;
- it also keeps an **episode file** (`logs/quota-episode.start`), created the
  first tick a quota state is seen and deleted the first tick none is. Past
  `FXMILY_WORKER_QUOTA_STALL_HOURS` (default **6**, chosen above a full 5-hour
  subscription window) it raises `claude_quota:stalled:<n>h`, which IS critical:
  the board goes red, `/api/cron/health` returns 503, and the hourly cron-watch
  run fails. Six hours of continuous capping means the account is being drained
  faster than it refills, and no amount of waiting fixes that.

**Two limits of that escalation, stated so nobody has to discover them at 2am.**

_It only counts a FRESH quota state._ A status file older than
`FXMILY_WORKER_QUOTA_FRESH_MIN` (default 90 minutes, above the 60-minute
cooldown) is ignored for this purpose. Without that gate a `quota_cooldown`
written by `monthly` on the 1st would still be the newest thing that file says
on the 28th, and the episode would be held open for a MONTH on a healthy host —
red board, 503, hourly alarm. A genuinely current cap is re-witnessed within
minutes by `verification`, `onboarding` or `seances`, so nothing real is lost.

_It measures CONTINUOUS capping, not cumulative._ One tick with no quota state
deletes the file. An account drained in bursts — capped, cooldown, one clean
tick because that pipeline's cohort happened to be empty, capped again — never
reaches six continuous hours and is never reported as stalled, however little it
actually generates. That misses a real outage; it does not invent one. Closing
it properly needs a cumulative measure over a rolling window, which needs a
count of what was PRODUCED, which lives in `claude-batch-core.sh`.

To exercise it without waiting six hours, backdate the episode file and wait for
the next watchdog tick:

```bash
# as fxmily, on the host — the file holds a plain epoch second
date -d '7 hours ago' +%s | sudo -u fxmily tee ~/worker/ops/worker/logs/quota-episode.start
# the next :07/:37 tick raises claude_quota:stalled:7h IF a quota state is still
# seen. Remove the file to end the drill; a healthy tick removes it anyway.
```

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

### The drill — because a documented rollback is not a tested one

Step 4 had never been run. The only machine it could be run on is the one now
serving every member's generation, so it is exercised on a faithful copy instead:

```bash
bash ops/worker/rollback-drill.sh      # needs Docker; the container is thrown away
```

install → re-install → `--check` → `--uninstall` → `--uninstall` again → `--check`
must now REFUSE → re-install. Thirty assertions, including a **canary**: 25 rows
seeded into `/etc/cron.d/fxmily-app` and compared by sha256 at every step, since
"never touches the app cron" is the installer's central promise and was until now
only a sentence. The last step deliberately BREAKS the canary to prove the
comparison can go red — four green comparisons are worth exactly as much as that
one red.

It states its own substitutions (the `claude` CLI, the six tokens, the app rows)
and its own limits: it does not prove the rollback on the real host, and
`--uninstall` does **not** revert the `FXMILY_WORKER_DRY_RUN` line it appended to
`/etc/fxmily/cron.env` — harmless once the wrappers are gone, but "uninstalled"
and "pristine" are not the same state.

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
filenames in the scp `source:` list in `deploy.yml` and two rows in `fxmily-sync-cron:56` close that,
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
> three times, so read it from the script rather than from this sentence. Note the
> `sed 's/#.*//'` — without it this command counts paths that appear only inside
> comments, which is exactly how the previous version of this block reported one
> path too many:
>
> ```bash
> { sed -n '/^MANAGED_SCRIPTS=(/,/^)/p' ops/cron/fxmily-sync-cron | sed 's/#.*//' \
>     | grep -oE '(/usr/local/bin|/etc/cron\.d)/[a-z0-9-]+'
>   grep -E '^DST_(CRONTAB|RUNNER)=' ops/cron/fxmily-sync-cron | sed 's/.*="//;s/"//'
> } | sort -u
> ```
>
> Nine, on the day this was written. `/etc/cron.d/fxmily-worker` is discussed in a
> comment inside that block but is **not** written by this validator — the worker
> crontab is installed by `install-worker-vps.sh`, outside the deploy grant.

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
  (`fxmily-sync-cron`; the grant is described in the comment above the
  `sudo /usr/local/bin/fxmily-sync-cron` call in `deploy.yml`). When the grant is absent, `converge`
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

The primary alert path is `/api/cron/health` → `cron-watch.yml` → **a red run in
the Actions tab and GitHub's failed-workflow e-mail**. It needs no third-party
account. It does NOT open a GitHub issue: Issues are disabled on this repo, the
API call returned 410, and that path was removed — this paragraph used to claim
otherwise, which is exactly the kind of doc that retires a question instead of
answering it (see §4 above, which has said the truth since).

That path has one structural limit: **every hop runs inside the app.** If the
app is down, `/api/cron/health` does not answer "red", it does not answer at
all — and while `cron-watch` does go red on a non-200, an app that is down takes
the diagnosis with it. Healthchecks.io is the second path precisely because
nothing in it depends on the app being alive.

It is wired and inert: `/etc/fxmily/cron.env` declares one blank URL per
pipeline, and a blank URL makes the wrapper skip the ping entirely. Nothing
reports that they are blank, so "the external channel exists" and "the external
channel is armed" have looked identical from the outside. `worker-host-sync.yml`
in `inspect` mode now counts them and says which of the two you are in.

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

### Arming it, end to end

Creating the account is a credential gesture, so it stays manual. Everything
after it is copy-paste. Free tier: 20 checks, 7 needed.

1. Sign up at <https://healthchecks.io> and open the default project.
2. Create **seven** checks. For each one, set the name and the schedule below —
   the _grace_ is what stops a normal long run from paging you. Take the period
   from `/etc/cron.d/fxmily-worker`; it is the source of truth, this table is a
   copy.

   | Check name                   | Period  | Grace   |
   | ---------------------------- | ------- | ------- |
   | `fxmily-worker-onboarding`   | 20 min  | 4 h     |
   | `fxmily-worker-verification` | 5 min   | 4 h     |
   | `fxmily-worker-seances`      | 30 min  | **9 h** |
   | `fxmily-worker-calendar`     | 1 day   | 2 d     |
   | `fxmily-worker-weekly`       | 1 week  | 2 w     |
   | `fxmily-worker-monthly`      | 30 days | 60 d    |
   | `fxmily-worker-profile`      | 30 days | 60 d    |

   The graces are the SAME budgets `health.ts` gives each pipeline on the board,
   with **one deliberate exception**. Tighter would page you every time `weekly`
   holds the machine-global lock; that is not a hypothetical, it is the 2h lock
   this worker legitimately takes.

   ⚠️ **`seances` is the exception, and getting it wrong pages you every night.**
   Its cron is `*/30 8-23`, so it is idle from 23h30 to 08h00 **by design** — a
   30-minute period with a 4-hour grace goes down at ~03h30 and stays down until
   08h00, every single night, on the one channel that is supposed to survive the
   app being down. A grace of 9 hours covers the idle window. The board solves
   the same problem differently (it classifies `seances` on MISSED TICKS inside
   its window rather than on raw age, `health.ts`), which is why the two numbers
   legitimately differ here and only here.

3. Copy each check's ping URL and append the seven lines to `/etc/fxmily/cron.env`
   on the host, as root:

   ```bash
   sudo tee -a /etc/fxmily/cron.env >/dev/null <<'EOF'
   HEALTHCHECK_PING_URL_WORKER_ONBOARDING=https://hc-ping.com/xxxxxxxx
   HEALTHCHECK_PING_URL_WORKER_VERIFICATION=https://hc-ping.com/xxxxxxxx
   HEALTHCHECK_PING_URL_WORKER_SEANCES=https://hc-ping.com/xxxxxxxx
   HEALTHCHECK_PING_URL_WORKER_CALENDAR=https://hc-ping.com/xxxxxxxx
   HEALTHCHECK_PING_URL_WORKER_WEEKLY=https://hc-ping.com/xxxxxxxx
   HEALTHCHECK_PING_URL_WORKER_MONTHLY=https://hc-ping.com/xxxxxxxx
   HEALTHCHECK_PING_URL_WORKER_PROFILE=https://hc-ping.com/xxxxxxxx
   EOF
   ```

   No restart is needed: `/etc/fxmily/cron.env` is sourced by every tick.

4. **Prove it, do not assume it.** `verification` ticks every 5 minutes, so you
   get an answer fast: within 5 minutes its check goes from "new" to "up" in the
   dashboard. If it does not, the URL is wrong or the line has a CR — the wrapper
   swallows a bad ping on purpose (an alerting channel must never take the worker
   down with it), so the dashboard is the only place the truth shows.

5. Then run `worker-host-sync.yml` in `inspect` mode. It reports **`7/7 external
ping URLs configured`**. Anything less names how many are missing — and it
   never prints a URL, because a populated ping URL is a capability token and
   these run logs are public.

**A ping URL is a credential.** Anyone holding it can mark the check up, i.e.
silence the alarm. It belongs in `/etc/fxmily/cron.env` (root-owned) and nowhere
else — never in the repo, never in a workflow log, never in a message.

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
