#!/usr/bin/env bash
#
# V2.4 Phase A.2 — Onboarding interview batch local Claude Max orchestrator.
#
# Pattern carbone V1.7.2 `ops/scripts/weekly-batch-local.sh`. Runs on Eliot's
# local Windows machine (Git Bash) using his Claude Max subscription via
# `claude --print` headless CLI. Cost marginal Anthropic = 0€.
#
# WORKFLOW :
#   1. Eliot triggers via `/onboarding-batch` slash command (Claude Code) OR
#      runs this script directly with FXMILY_ADMIN_TOKEN exported.
#   2. Script pulls the envelope from prod (or local dev) via HTTPS POST
#      with X-Admin-Token authentication.
#   3. For each entry in the envelope (N completed interviews not yet
#      analyzed), the script :
#        - Writes the pre-rendered `userPrompt` to `prompt-$i.txt`
#        - Sleeps 60-120s RANDOM (anti-burst Anthropic detection)
#        - Runs `claude --print --max-turns 1 --max-budget-usd 5.00
#          --append-system-prompt "$SYSTEM_PROMPT" < prompt-$i.txt
#          > response-$i.json`
#        - Strips ```json fences defensively
#        - Validates JSON has summary/highlights/axes_prioritaires fields
#        - Appends to results.ndjson
#   4. Script aggregates results.ndjson → results.json via jq -s atomic
#      single write.
#   5. POSTs results.json to /persist endpoint with X-Admin-Token.
#   6. Prints summary { persisted, skipped, errors }.
#
# Ban-risk mitigation (9 rules carbone V1.7) :
#   1. Eliot's machine (his IP, his fingerprint, his Max account)
#   2. 60-120s RANDOM-jittered sleeps (floor 30s)
#   3. One `claude --print` per member = fresh context
#   4. Snapshots pseudonymized V1.5.2 (server-side, label `member-XXXXXXXX`)
#   5. System prompt + JSON schema travel WITH the envelope from repo
#   6. Only official `claude` binary — no third-party wrappers
#   7. Human-in-the-loop : manual trigger, no cron schedule
#   8. Server double-net validation (Zod strict + safety gate)
#   9. Audit log `onboarding.batch.*` records counts + ranAt (PII-free)
#
# Required env vars :
#   FXMILY_ADMIN_TOKEN   — 32+ chars admin token (matches /etc/fxmily/web.env
#                          ADMIN_BATCH_TOKEN on Hetzner)
#   FXMILY_BASE_URL      — defaults to https://app.fxmilyapp.com ;
#                          override for local dev (http://localhost:3000)
#
# Optional :
#   --dry-run            — pull envelope, build prompts, but DO NOT call
#                          claude --print + DO NOT POST persist. Smoke-test
#                          path Phase B+ readiness.
#   --max-members N      — cap N entries (for partial-cohort testing)
#   --skip-sleep         — for tests only ; bypass jittered sleeps
#

set -euo pipefail

# ============================================================================
# Configuration
# ============================================================================

readonly BASE_URL="${FXMILY_BASE_URL:-https://app.fxmilyapp.com}"
readonly ADMIN_TOKEN="${FXMILY_ADMIN_TOKEN:-}"
readonly WORK_DIR="${TMPDIR:-/tmp}/fxmily-onboarding-batch-$$"
readonly MAX_BUDGET_USD="${CLAUDE_MAX_BUDGET_USD:-5.00}"
# §8 — local Claude solicitations run on Opus 4.8 at "extra" effort by default.
readonly CLAUDE_MODEL="${FXMILY_CLAUDE_MODEL:-claude-opus-4-8}"
readonly CLAUDE_EFFORT="${FXMILY_CLAUDE_EFFORT:-xhigh}"

# CLI args
DRY_RUN=false
MAX_MEMBERS=0  # 0 = no cap
SKIP_SLEEP=false

while [[ $# -gt 0 ]]; do
  case "$1" in
    --dry-run) DRY_RUN=true; shift ;;
    --max-members) MAX_MEMBERS="$2"; shift 2 ;;
    --skip-sleep) SKIP_SLEEP=true; shift ;;
    --help|-h)
      cat <<EOF
Usage: $0 [--dry-run] [--max-members N] [--skip-sleep]

Environment variables :
  FXMILY_ADMIN_TOKEN    32+ chars admin token (required)
  FXMILY_BASE_URL       default https://app.fxmilyapp.com
  CLAUDE_MAX_BUDGET_USD default 5.00
  FXMILY_CLAUDE_MODEL   default claude-opus-4-8 (§8 — Opus 4.8 for profile analysis)
  FXMILY_CLAUDE_EFFORT  default xhigh (§8 "en extra" ; low|medium|high|xhigh|max)

Options :
  --dry-run             pull only, do not call claude or persist
  --max-members N       cap processing to N entries (testing)
  --skip-sleep          bypass jittered sleeps (tests only — ban risk!)
EOF
      exit 0
      ;;
    *) echo "[ERROR] Unknown arg: $1" >&2; exit 1 ;;
  esac
done

# ============================================================================
# Pre-flight checks
# ============================================================================

if [[ -z "$ADMIN_TOKEN" ]]; then
  echo "[FATAL] FXMILY_ADMIN_TOKEN not set. Export it from /etc/fxmily/web.env." >&2
  exit 1
fi

if [[ ${#ADMIN_TOKEN} -lt 32 ]]; then
  echo "[FATAL] FXMILY_ADMIN_TOKEN must be at least 32 chars." >&2
  exit 1
fi

for cmd in curl jq claude; do
  if ! command -v "$cmd" >/dev/null 2>&1; then
    echo "[FATAL] Required command not found: $cmd" >&2
    exit 1
  fi
done

# Verify claude is the official Anthropic binary (not a third-party wrapper)
if ! claude --version 2>&1 | grep -qi "claude"; then
  echo "[FATAL] 'claude' binary does not look like official Anthropic CLI." >&2
  exit 1
fi

# §8 — model + effort allowlist (verified `claude --help` CLI 2.1.154 : full
# names like 'claude-opus-4-8' ; --effort low|medium|high|xhigh|max).
case "$CLAUDE_MODEL" in
  claude-opus-4-8|claude-opus-4-7|claude-sonnet-4-6|claude-haiku-4-5) ;;
  *) echo "[FATAL] FXMILY_CLAUDE_MODEL=$CLAUDE_MODEL not in allowlist (claude-opus-4-8, claude-opus-4-7, claude-sonnet-4-6, claude-haiku-4-5)." >&2; exit 1 ;;
esac
case "$CLAUDE_EFFORT" in
  low|medium|high|xhigh|max) ;;
  *) echo "[FATAL] FXMILY_CLAUDE_EFFORT=$CLAUDE_EFFORT invalid (low|medium|high|xhigh|max)." >&2; exit 1 ;;
esac

mkdir -p "$WORK_DIR"
trap 'rm -rf "$WORK_DIR"' EXIT

echo "[onboarding-batch] Work dir: $WORK_DIR"
echo "[onboarding-batch] Base URL: $BASE_URL"
echo "[onboarding-batch] Model: $CLAUDE_MODEL — effort: $CLAUDE_EFFORT (§8 full performance)"
echo "[onboarding-batch] Dry-run: $DRY_RUN"
echo "[onboarding-batch] Max members: ${MAX_MEMBERS:-(none)}"
echo "[onboarding-batch] Started: $(date -u +%Y-%m-%dT%H:%M:%SZ)"

# ============================================================================
# Step 1 — Pull envelope
# ============================================================================

echo ""
echo "[onboarding-batch] [1/4] Pulling envelope from $BASE_URL/api/admin/onboarding-batch/pull"

PULL_RESP_FILE="$WORK_DIR/envelope.json"
PULL_HTTP_CODE=$(curl -sS -w "%{http_code}" -o "$PULL_RESP_FILE" \
  -X POST \
  -H "X-Admin-Token: $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  --max-time 60 \
  "$BASE_URL/api/admin/onboarding-batch/pull" \
  || echo "000")

if [[ "$PULL_HTTP_CODE" != "200" ]]; then
  echo "[FATAL] Pull failed with HTTP $PULL_HTTP_CODE" >&2
  cat "$PULL_RESP_FILE" >&2
  exit 1
fi

ENTRIES_COUNT=$(jq '.entries | length' "$PULL_RESP_FILE")
INSTRUMENT_VERSION=$(jq -r '.instrumentVersion' "$PULL_RESP_FILE")
RAN_AT=$(jq -r '.ranAt' "$PULL_RESP_FILE")

echo "[onboarding-batch] Pulled $ENTRIES_COUNT entries (instrument v$INSTRUMENT_VERSION, ranAt=$RAN_AT)"

if [[ "$ENTRIES_COUNT" == "0" ]]; then
  echo "[onboarding-batch] Nothing to process. Exiting cleanly."
  exit 0
fi

# Apply --max-members cap if set
if [[ "$MAX_MEMBERS" -gt 0 && "$ENTRIES_COUNT" -gt "$MAX_MEMBERS" ]]; then
  echo "[onboarding-batch] Capping to first $MAX_MEMBERS entries (--max-members)"
  jq --argjson n "$MAX_MEMBERS" '.entries |= .[:$n]' "$PULL_RESP_FILE" > "$WORK_DIR/envelope-capped.json"
  PULL_RESP_FILE="$WORK_DIR/envelope-capped.json"
  ENTRIES_COUNT="$MAX_MEMBERS"
fi

# Extract system prompt to a file (large string, easier to pass via flag)
jq -r '.systemPrompt' "$PULL_RESP_FILE" > "$WORK_DIR/system-prompt.txt"

if "$DRY_RUN"; then
  echo "[onboarding-batch] --dry-run set. Skipping claude --print + persist. Envelope saved at $WORK_DIR/envelope.json"
  exit 0
fi

# ============================================================================
# Step 2 — Per-entry claude --print loop (60-120s jittered sleeps)
# ============================================================================

echo ""
echo "[onboarding-batch] [2/4] Running claude --print × $ENTRIES_COUNT (60-120s jittered)"

RESULTS_NDJSON="$WORK_DIR/results.ndjson"
: > "$RESULTS_NDJSON" # truncate

for i in $(seq 0 $((ENTRIES_COUNT - 1))); do
  ENTRY=$(jq -c ".entries[$i]" "$PULL_RESP_FILE")
  USER_ID=$(echo "$ENTRY" | jq -r '.userId')
  INTERVIEW_ID=$(echo "$ENTRY" | jq -r '.interviewId')
  PSEUDONYM=$(echo "$ENTRY" | jq -r '.pseudonymLabel')

  PROMPT_FILE="$WORK_DIR/prompt-$i.txt"
  RESPONSE_FILE="$WORK_DIR/response-$i.json"

  # Write pre-rendered user prompt (server-side built)
  echo "$ENTRY" | jq -r '.userPrompt' > "$PROMPT_FILE"

  echo ""
  echo "[onboarding-batch] [$((i + 1))/$ENTRIES_COUNT] $PSEUDONYM (interview=$INTERVIEW_ID)"

  # Jittered sleep BEFORE the call (except for first call)
  if [[ "$i" -gt 0 && "$SKIP_SLEEP" != "true" ]]; then
    SLEEP_SECONDS=$((60 + RANDOM % 61)) # 60-120s
    echo "[onboarding-batch] Sleeping ${SLEEP_SECONDS}s anti-burst..."
    sleep "$SLEEP_SECONDS"
  fi

  # Run claude --print headless
  echo "[onboarding-batch] Invoking claude --print..."
  CLAUDE_EXIT=0
  # Pure-generator isolation (see §26 calendar batch, real e2e validated
  # 2026-06-04): --setting-sources "" drops the operator's CLAUDE.md + hooks
  # (else conversational prose, not JSON); --system-prompt REPLACES the agent
  # framing; --max-turns 8 (NOT 1 — Opus 4.8 thinking uses a turn before JSON,
  # `--max-turns 1` aborts "Reached max turns"). --max-budget-usd caps runaway.
  claude --print \
    --model "$CLAUDE_MODEL" \
    --effort "$CLAUDE_EFFORT" \
    --max-turns 8 \
    --max-budget-usd "$MAX_BUDGET_USD" \
    --setting-sources "" \
    --system-prompt "$(cat "$WORK_DIR/system-prompt.txt")" \
    < "$PROMPT_FILE" \
    > "$RESPONSE_FILE" 2> "$WORK_DIR/response-$i.err" || CLAUDE_EXIT=$?

  if [[ "$CLAUDE_EXIT" -ne 0 ]]; then
    echo "[onboarding-batch] claude --print exit $CLAUDE_EXIT"
    cat "$WORK_DIR/response-$i.err" >&2
    jq -n --arg uid "$USER_ID" --arg iid "$INTERVIEW_ID" --argjson exit "$CLAUDE_EXIT" \
      '{userId: $uid, interviewId: $iid, error: ("claude_exit_" + ($exit | tostring))}' \
      >> "$RESULTS_NDJSON"
    continue
  fi

  # Strip ```json fences defensively
  RESPONSE_CONTENT=$(sed -E 's/^```(json)?$//; s/^```$//' "$RESPONSE_FILE" | grep -v '^[[:space:]]*$' | tr -d '\r')

  # Validate JSON
  if ! echo "$RESPONSE_CONTENT" | jq -e '.summary and .highlights and .axes_prioritaires' >/dev/null 2>&1; then
    echo "[onboarding-batch] Invalid JSON response from claude"
    jq -n --arg uid "$USER_ID" --arg iid "$INTERVIEW_ID" \
      '{userId: $uid, interviewId: $iid, error: "invalid_json_response"}' \
      >> "$RESULTS_NDJSON"
    continue
  fi

  # Build the success entry { userId, interviewId, output, model }
  jq -n \
    --arg uid "$USER_ID" \
    --arg iid "$INTERVIEW_ID" \
    --argjson output "$RESPONSE_CONTENT" \
    --arg model "$CLAUDE_MODEL" \
    '{userId: $uid, interviewId: $iid, output: $output, model: $model}' \
    >> "$RESULTS_NDJSON"

  echo "[onboarding-batch] Captured response for $PSEUDONYM"
done

# ============================================================================
# Step 3 — Aggregate results
# ============================================================================

echo ""
echo "[onboarding-batch] [3/4] Aggregating results into single payload"

RESULTS_JSON="$WORK_DIR/results.json"
jq -s '{results: .}' "$RESULTS_NDJSON" > "$RESULTS_JSON"

PAYLOAD_BYTES=$(wc -c < "$RESULTS_JSON")
echo "[onboarding-batch] Payload: $PAYLOAD_BYTES bytes / $(jq '.results | length' "$RESULTS_JSON") entries"

# ============================================================================
# Step 4 — POST persist
# ============================================================================

echo ""
echo "[onboarding-batch] [4/4] POSTing $BASE_URL/api/admin/onboarding-batch/persist"

PERSIST_RESP_FILE="$WORK_DIR/persist-resp.json"
PERSIST_HTTP_CODE=$(curl -sS -w "%{http_code}" -o "$PERSIST_RESP_FILE" \
  -X POST \
  -H "X-Admin-Token: $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  --data-binary "@$RESULTS_JSON" \
  --max-time 120 \
  "$BASE_URL/api/admin/onboarding-batch/persist" \
  || echo "000")

if [[ "$PERSIST_HTTP_CODE" != "200" ]]; then
  echo "[FATAL] Persist failed with HTTP $PERSIST_HTTP_CODE" >&2
  cat "$PERSIST_RESP_FILE" >&2
  exit 1
fi

echo ""
echo "[onboarding-batch] ============================================"
echo "[onboarding-batch] Summary:"
jq '.' "$PERSIST_RESP_FILE"
echo "[onboarding-batch] ============================================"
echo "[onboarding-batch] Finished: $(date -u +%Y-%m-%dT%H:%M:%SZ)"
