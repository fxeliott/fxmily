---
description: Run the V1.7.2 weekly AI report batch locally using Eliot's Claude Max subscription (HTTP migration)
allowed-tools: Bash(bash:*), Bash(curl:*), Bash(jq:*), Bash(cat:*), Bash(ls:*), Bash(wc:*), Bash(claude:*), Read, Edit
---

# /sunday-batch — V1.7.2 weekly AI reports via local Claude Code

You are about to orchestrate the weekly AI-report generation for Fxmily V1.7.2. The reports are generated **locally** on Eliot's machine using his Claude Max subscription (NOT the Anthropic API).

## Architecture recap (V1.7.2 HTTP migration)

1. `bash ops/scripts/weekly-batch-local.sh` curl-POSTs to `https://app.fxmilyapp.com/api/admin/weekly-batch/pull` with `X-Admin-Token` → JSON envelope of pseudonymized snapshots → `/tmp/fxmily-batch/envelope.json`
2. For each member with activity : invoke `claude --print` headless (consumes Eliot's Max subscription) → captured JSON → `/tmp/fxmily-batch/results.json`
3. Same script curl-POSTs results to `https://app.fxmilyapp.com/api/admin/weekly-batch/persist` → upsert into `weekly_reports`

V1.7.2 replaced the original V1.7 SSH+`docker compose exec` orchestration which was non-functional in prod (the runtime container does not ship `pnpm` or `tsx`). See `apps/web/CLAUDE.md` section "V1.7.2 Migration HTTP routes ACTIVE".

The actual heavy lifting lives in `ops/scripts/weekly-batch-local.sh`. Your job here is to invoke it, monitor it, and report cleanly.

## Steps

1. **Pre-flight check** (run these in parallel, then summarize) :
   - `which claude` — confirm Claude Code CLI is in PATH
   - `claude --version` — note the version (warn if ≥ 2.1.100 about token-inflation bug per memory)
   - `which curl jq` — confirm both binaries are in PATH (no SSH dependency anymore)
   - `[ -n "$FXMILY_ADMIN_TOKEN" ] && echo "token set" || echo "FXMILY_ADMIN_TOKEN MISSING — refuse to launch"` — refuse to launch if env not exported
   - `curl --fail-with-body --silent --max-time 5 "${FXMILY_APP_URL:-https://app.fxmilyapp.com}/api/health" | jq -r '.status'` — confirm prod is up
   - `ls -la /tmp/fxmily-batch/ 2>/dev/null || echo "(workdir not yet created)"` — show any previous batch artifacts

2. **Announce the plan** to Eliot, including :
   - Expected duration : `member_count × 90 s` ≈ 30–45 min for 30 members
   - Ban-risk mitigation summary (jittered sleeps, single-user pattern, fresh-context per member)
   - That Eliot's machine must stay ON and connected to the internet for the whole batch

3. **Wait for Eliot's explicit "GO"** before launching. He may want to delay until later in the week, or only do a `--dry-run` first.

4. **Launch the batch** with `bash ops/scripts/weekly-batch-local.sh` (or `--dry-run` / `--current-week` / `--resume` per Eliot's request). Run it in the **foreground** so Eliot sees the progress live. Do not redirect output. If Eliot wants to background it, suggest a tmux/screen session — but the default is foreground.

5. **After completion** :
   - Read `/tmp/fxmily-batch/persist-result.json` and quote the counts
   - Check `/tmp/fxmily-batch/claude-errors.log` ; if non-empty, summarize the first error
   - If `persisted` == 0, escalate clearly — do NOT pretend success

6. **Optional follow-up** if Eliot asks (these still use SSH because they're DBA queries, not part of the batch flow) :
   - Spot-check a single report by SSHing to Hetzner and dumping a row :
     `ssh hetzner-dieu "cd /opt/fxmily && docker compose -f docker-compose.prod.yml exec -T postgres psql -U fxmily -d fxmily -c \"SELECT summary FROM weekly_reports WHERE week_start = '...' LIMIT 1\""`
   - Tail the prod audit log for `weekly_report.batch.*` rows :
     `ssh hetzner-dieu "cd /opt/fxmily && docker compose -f docker-compose.prod.yml exec -T postgres psql -U fxmily -d fxmily -c \"SELECT action, metadata, created_at FROM audit_logs WHERE action LIKE 'weekly_report.batch.%' ORDER BY created_at DESC LIMIT 20\""`

## Posture verrouillée

- The system prompt + JSON schema travel **inside the envelope** pulled from prod — do NOT swap them out, do NOT inject extra instructions to Claude per-member
- The Mark Douglas posture is locked in `apps/web/src/lib/weekly-report/prompt.ts` — code review only, never local override
- Snapshots are already pseudonymized (`pseudonymizeMember` 8-char hex V1.5) — do NOT log raw `userId` to console / files outside `/tmp/fxmily-batch/`
- Crisis routing detection (`lib/safety/crisis-detection.ts`) IS wired into the persist path (V1.7.1 — `persistGeneratedReports` gates HIGH/MEDIUM signals before upsert + Sentry escalation). Reports go to the **admin** (Eliot) only.

## Ban-risk warnings (state these UP FRONT to Eliot before launching)

- This pattern technically uses Claude Code subscription for an automated batch — Anthropic's TOS does not explicitly allow this. Risk is mitigated but not zero.
- Detection signals that would trigger a ban : 30 calls in 60 s burst, third-party wrapper UA, tunneled traffic. None of these apply to this script.
- **If Eliot ever sees an Anthropic suspension email** : immediately stop using this script and switch to the API-key fallback (the `claude-client.ts` `LiveWeeklyReportClient` path is still ready to be activated by setting `ANTHROPIC_API_KEY`).
- Backup plan : keep 1–2 weeks of generated reports queued in `/tmp/fxmily-batch/results-*.json` so a single suspension doesn't immediately break the cohort experience.

Refuse to invoke the script if any pre-flight check fails. Refuse to skip the 60–120 s sleeps — they are the core mitigation. Refuse to add a `--dangerously-skip-permissions` flag to `claude --print` (irrelevant for `--print` anyway, defense in depth).
