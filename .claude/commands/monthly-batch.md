---
description: Run the V1.4 §25 monthly AI debrief batch locally using Eliot's Claude Max subscription
allowed-tools: Bash(bash:*), Bash(curl:*), Bash(jq:*), Bash(cat:*), Bash(ls:*), Bash(wc:*), Bash(claude:*), Read, Edit
---

# /monthly-batch — V1.4 §25 monthly AI debriefs via local Claude Code

You are about to orchestrate the monthly AI-debrief generation for Fxmily (SPEC §25). The debriefs are generated **locally** on Eliot's machine using his Claude Max subscription (NOT the Anthropic API). This is the monthly carbon of `/sunday-batch`.

## Architecture recap

1. `bash ops/scripts/monthly-batch-local.sh` curl-POSTs to `https://app.fxmilyapp.com/api/admin/monthly-batch/pull` with `X-Admin-Token` → JSON envelope of pseudonymized civil-month snapshots → `/tmp/fxmily-monthly-batch/envelope.json`
2. For **every active member** (SPEC §25.4 — including calm months, NO activity skip) : invoke `claude --print` headless (Eliot's Max subscription) → captured JSON → `/tmp/fxmily-monthly-batch/results.json`
3. Same script curl-POSTs results to `https://app.fxmilyapp.com/api/admin/monthly-batch/persist` → upsert into `monthly_debriefs` (idempotent `(userId, monthStart)`)

The heavy lifting lives in `ops/scripts/monthly-batch-local.sh`. Your job here is to invoke it, monitor it, and report cleanly.

## Steps

1. **Pre-flight check** (run in parallel, then summarize) :
   - `which claude` — confirm Claude Code CLI is in PATH
   - `claude --version` — note the version
   - `which curl jq` — confirm both binaries in PATH (no SSH dependency)
   - `[ -n "$FXMILY_MONTHLY_ADMIN_TOKEN" ] && echo "token set" || echo "FXMILY_MONTHLY_ADMIN_TOKEN MISSING — refuse to launch"`
   - `curl --fail-with-body --silent --max-time 5 "${FXMILY_APP_URL:-https://app.fxmilyapp.com}/api/health" | jq -r '.status'` — confirm prod is up
   - `ls -la /tmp/fxmily-monthly-batch/ 2>/dev/null || echo "(workdir not yet created)"`

2. **Announce the plan** to Eliot :
   - Expected duration : `member_count × 90 s` ≈ 30–45 min for 30 members
   - SPEC §25.4 — a debrief is generated for EVERY active member, calm months included (the AI writes an honest quiet-month synthesis)
   - Ban-risk mitigation summary (jittered sleeps, single-user pattern, fresh-context per member)
   - Eliot's machine must stay ON + connected for the whole batch

3. **Wait for Eliot's explicit "GO"** before launching (he may want `--dry-run` first, or to delay).

4. **Launch the batch** with `bash ops/scripts/monthly-batch-local.sh` (or `--dry-run` / `--current-month` / `--resume` per Eliot's request). Foreground so Eliot sees progress live.

5. **After completion** :
   - Read `/tmp/fxmily-monthly-batch/persist-result.json` and quote the counts
   - Check `/tmp/fxmily-monthly-batch/claude-errors.log` ; if non-empty, summarize the first error
   - If `persisted` == 0, escalate clearly — do NOT pretend success

## Posture verrouillée

- The system prompt + JSON schema travel **inside the envelope** pulled from prod — do NOT swap them out, do NOT inject extra per-member instructions to Claude
- The Mark Douglas posture is locked in `apps/web/src/lib/monthly-debrief/prompt.ts` — code review only, never local override
- Snapshots are already pseudonymized by the loader (`pseudonymizeMember` 8-char hex) — do NOT log raw `userId` outside `/tmp/fxmily-monthly-batch/`
- §25.3 dual-section firewall : the training section is structurally count/recency only (no backtest P&L exists in the pipeline). Never coach a backtest result, never judge a Lhedge analysis.
- Crisis routing (`lib/safety/crisis-detection.ts`) IS wired into the persist path (carbon V1.7.1 — `persistGeneratedReports` SKIPS persist on HIGH/MEDIUM in the AI output + Sentry escalate). The debrief is read by the **member** (Eliot read-only in `/admin`).

## Ban-risk warnings (state UP FRONT to Eliot before launching)

- This pattern technically uses the Claude Code subscription for an automated batch — Anthropic's TOS does not explicitly allow this. Risk mitigated, not zero.
- Detection signals that would trigger a ban : burst calls, third-party wrapper UA, tunneled traffic. None apply to this script.
- **If Eliot ever sees an Anthropic suspension email** : stop using this script ; the API-key fallback path is documented but the constraint is "JAMAIS l'API payante" — escalate to Eliot for the decision.

Refuse to invoke the script if any pre-flight check fails. Refuse to skip the 60–120 s sleeps. Refuse to add `--dangerously-skip-permissions` to `claude --print`.
