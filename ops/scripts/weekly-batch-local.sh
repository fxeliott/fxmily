#!/usr/bin/env bash
#
# V1.7.2 weekly batch — local orchestrator (Eliot's Max-subscription path).
#
# Pulls snapshots from prod via HTTP, generates reports locally via
# `claude --print` (using Eliot's Claude Max subscription), pushes results
# back via HTTP. Replaces the V1.7 SSH+docker-exec orchestration which was
# non-functional in prod (the runtime container does not ship pnpm/tsx —
# Next.js standalone build excludes devDeps). See `apps/web/CLAUDE.md`
# section "V1.7 LIVE prod" for the architecture rationale.
#
# Ban-risk mitigation rules (unchanged from V1.7) :
#   - Runs FROM Eliot's machine (his IP, his fingerprint, his Max account)
#   - Spreads `claude --print` invocations across 60–120 s jittered sleeps
#   - One invocation per member = fresh context per generation (no context
#     bleed across members, no oversized single conversation)
#   - Snapshots are already pseudonymized (no PII reaches Anthropic)
#   - System prompt + JSON schema travel WITH the envelope (no on-device
#     tampering possible without committing to the repo)
#   - No third-party wrappers — only the official `claude` binary
#   - Audit row `weekly_report.batch.{pulled,persisted}` recorded in prod DB
#     so DBA queries can spot abuse / mismatch
#
# V1.7.2 changes vs V1.7 :
#   - Phase 1 pull  : curl POST /api/admin/weekly-batch/pull (was : ssh + docker exec)
#   - Phase 3 persist : curl POST /api/admin/weekly-batch/persist (was : ssh + docker exec)
#   - SSH dependency removed — only `curl`, `claude`, `jq` required
#   - Auth via X-Admin-Token header (separate from CRON_SECRET, rotation independent)
#
# Usage :
#   bash ops/scripts/weekly-batch-local.sh                # previous full week (default)
#   bash ops/scripts/weekly-batch-local.sh --current-week
#   bash ops/scripts/weekly-batch-local.sh --dry-run      # pull + generate only, do not persist
#   bash ops/scripts/weekly-batch-local.sh --resume       # reuse /tmp/fxmily-batch/*.json (skip pull)
#
# Required env :
#   FXMILY_ADMIN_TOKEN    32+ char admin batch token (sync with prod ADMIN_BATCH_TOKEN)
#
# Optional env :
#   FXMILY_APP_URL        default 'https://app.fxmilyapp.com' (must be HTTPS in prod)
#   FXMILY_CLAUDE_MODEL   default empty (let Claude Code pick default Sonnet 4.6)
#   FXMILY_BATCH_DIR      default '/tmp/fxmily-batch' (workdir)
#   FXMILY_SLEEP_MIN_S    default 60 (floor 30 — ban-risk mitigation)
#   FXMILY_SLEEP_MAX_S    default 120
#   FXMILY_MAX_TURNS      default 1 (anti-bloat ; Claude reads prompt, writes JSON, done)
#
# Exit codes :
#   0 = batch completed (some entries may have errored ; check report)
#   1 = fatal error (curl, claude unavailable, missing env, etc.)
#   2 = persist step rejected the batch (0 reports written)

set -euo pipefail

# --- Config (env-overridable with strict validation) ------------------------
APP_URL="${FXMILY_APP_URL:-https://app.fxmilyapp.com}"
BATCH_DIR="${FXMILY_BATCH_DIR:-/tmp/fxmily-batch}"
SLEEP_MIN="${FXMILY_SLEEP_MIN_S:-60}"
SLEEP_MAX="${FXMILY_SLEEP_MAX_S:-120}"
MAX_TURNS=1  # Hard-pinned to 1 (single-shot per member — anti-bloat, anti-quota-surprise)
MODEL_FLAG=""

# V1.7.2 — required token. Refuse to run without it (refuse-by-default mirrors
# the server-side 503).
if [ -z "${FXMILY_ADMIN_TOKEN:-}" ]; then
  echo "ERROR: FXMILY_ADMIN_TOKEN env not set." >&2
  echo "  Generate via 'openssl rand -hex 32' and provision on Hetzner :" >&2
  echo "    echo 'ADMIN_BATCH_TOKEN=<value>' >> /etc/fxmily/web.env" >&2
  echo "    cd /opt/fxmily && docker compose -f docker-compose.prod.yml restart web" >&2
  echo "  Then export FXMILY_ADMIN_TOKEN=<same value> in your local shell." >&2
  exit 1
fi

# V1.7.2 — minimal URL sanity. We do NOT allow http:// in prod cadence
# (token would travel in plaintext over the wire). Localhost http allowed
# for local dev / docker-compose dev stack.
case "$APP_URL" in
  https://*) ;;
  http://localhost:*|http://127.0.0.1:*) ;;
  *)
    echo "ERROR: FXMILY_APP_URL=$APP_URL must be HTTPS (or http://localhost:* for dev)." >&2
    exit 1
    ;;
esac

if [ -n "${FXMILY_CLAUDE_MODEL:-}" ]; then
  # Allowlist of acceptable Claude models per `lib/weekly-report/pricing.ts`.
  case "$FXMILY_CLAUDE_MODEL" in
    claude-sonnet-4-6|claude-haiku-4-5|claude-opus-4-7) ;;
    *)
      echo "ERROR: FXMILY_CLAUDE_MODEL=$FXMILY_CLAUDE_MODEL not in allowlist." >&2
      echo "  Allowed: claude-sonnet-4-6, claude-haiku-4-5, claude-opus-4-7" >&2
      exit 1
      ;;
  esac
  MODEL_FLAG="--model ${FXMILY_CLAUDE_MODEL}"
fi

# V1.7 fix carry-over (code-reviewer Round 16 BLOQUANT 3 + security-auditor MED 12) :
# sleep range validation + floor 30s. Without this, RANDOM % 0 div-by-zero or
# negative modulo on inverted ranges silently breaks mid-batch.
if ! [[ "$SLEEP_MIN" =~ ^[0-9]+$ ]] || ! [[ "$SLEEP_MAX" =~ ^[0-9]+$ ]]; then
  echo "ERROR: FXMILY_SLEEP_MIN_S / MAX_S must be non-negative integers." >&2
  exit 1
fi
if [ "$SLEEP_MIN" -lt 30 ]; then
  echo "ERROR: FXMILY_SLEEP_MIN_S=$SLEEP_MIN must be ≥30 (ban-risk floor)." >&2
  echo "  The whole point of this batch is the jittered sleep — don't bypass it." >&2
  exit 1
fi
if [ "$SLEEP_MAX" -lt "$SLEEP_MIN" ]; then
  echo "ERROR: FXMILY_SLEEP_MAX_S=$SLEEP_MAX < SLEEP_MIN=$SLEEP_MIN — invalid range." >&2
  exit 1
fi

CURRENT_WEEK_FLAG=""
DRY_RUN=false
RESUME=false
for arg in "$@"; do
  case "$arg" in
    --current-week) CURRENT_WEEK_FLAG="?currentWeek=true" ;;
    --dry-run) DRY_RUN=true ;;
    --resume) RESUME=true ;;
    -h|--help)
      sed -n '/^# Usage :/,/^$/p' "$0" | sed 's/^# \{0,1\}//'
      exit 0
      ;;
    *) echo "Unknown arg: $arg" >&2; exit 1 ;;
  esac
done

# --- Sanity checks -----------------------------------------------------------

command -v claude >/dev/null 2>&1 || {
  echo "ERROR: 'claude' CLI not found in PATH." >&2
  echo "  Install Claude Code from https://claude.com/code" >&2
  exit 1
}
command -v jq >/dev/null 2>&1 || {
  echo "ERROR: 'jq' not found in PATH (needed to parse the snapshot envelope)." >&2
  echo "  Install via 'choco install jq' (Windows) or 'apt install jq' (Linux)." >&2
  exit 1
}
command -v curl >/dev/null 2>&1 || {
  echo "ERROR: 'curl' not found." >&2
  exit 1
}

mkdir -p "$BATCH_DIR"
ENVELOPE_FILE="$BATCH_DIR/envelope.json"
RESULTS_NDJSON="$BATCH_DIR/results.ndjson"  # Append-only NDJSON for atomic writes
RESULTS_FILE="$BATCH_DIR/results.json"
ERRORS_LOG="$BATCH_DIR/claude-errors.log"

# V1.7 fix carry-over (security-auditor Round 16 HIGH 5) : truncate the errors
# log at each run + scrub older artifacts (>7 days). Without this, PII from
# past Claude errors accumulates indefinitely on Eliot's disk.
: >"$ERRORS_LOG"
find "$BATCH_DIR" -type f -mtime +7 -delete 2>/dev/null || true

# --- Phase 1 : pull snapshots from prod via HTTP -----------------------------

if [ "$RESUME" = "false" ] || [ ! -s "$ENVELOPE_FILE" ]; then
  echo "[1/3] Pulling snapshots from $APP_URL..."
  PULL_URL="${APP_URL}/api/admin/weekly-batch/pull${CURRENT_WEEK_FLAG}"
  # `--fail-with-body` makes curl exit non-zero on HTTP 4xx/5xx but still
  # streams the body so we can show the JSON error from the server.
  if ! curl --fail-with-body --silent --show-error \
            --max-time 90 \
            -X POST \
            -H "X-Admin-Token: ${FXMILY_ADMIN_TOKEN}" \
            -H "Accept: application/json" \
            "$PULL_URL" \
            >"$ENVELOPE_FILE"; then
    echo "ERROR: pull request failed. See $ENVELOPE_FILE for server response." >&2
    cat "$ENVELOPE_FILE" >&2 || true
    exit 1
  fi
  bytes=$(wc -c <"$ENVELOPE_FILE")
  if [ "$bytes" -lt 32 ]; then
    echo "ERROR: pull returned <32 bytes ($bytes). See $ENVELOPE_FILE" >&2
    exit 1
  fi
  echo "  ✓ Wrote envelope to $ENVELOPE_FILE ($bytes bytes)"
else
  echo "[1/3] --resume : reusing existing $ENVELOPE_FILE"
fi

ENTRY_COUNT=$(jq '.entries | length' "$ENVELOPE_FILE")
ACTIVE_COUNT=$(jq '[.entries[] | select(.hasActivity == true)] | length' "$ENVELOPE_FILE")
WEEK_START=$(jq -r '.weekStart' "$ENVELOPE_FILE")
WEEK_END=$(jq -r '.weekEnd' "$ENVELOPE_FILE")

echo "  Week: $WEEK_START → $WEEK_END"
echo "  Members: $ENTRY_COUNT total, $ACTIVE_COUNT active (only active are sent to Claude)"

# --- Phase 2 : generate reports locally via claude --print ------------------

echo "[2/3] Generating reports locally via 'claude --print' ($SLEEP_MIN-${SLEEP_MAX}s jittered)..."

# Pull the system prompt + JSON schema out of the envelope ONCE
SYSTEM_PROMPT_FILE="$BATCH_DIR/system-prompt.txt"
SCHEMA_FILE="$BATCH_DIR/output-schema.json"
jq -r '.systemPrompt' "$ENVELOPE_FILE" >"$SYSTEM_PROMPT_FILE"
jq '.outputJsonSchema' "$ENVELOPE_FILE" >"$SCHEMA_FILE"

# V1.7 fix carry-over (code-reviewer Round 16 BLOQUANT 4) : append-only NDJSON
# instead of rewriting the whole results.json on every member. Atomic per-line
# append = survives Ctrl-C and corruption-on-rename. Assembled into final JSON
# at the end of the loop via `jq -s`.
: >"$RESULTS_NDJSON"

i=0
generated=0
errored=0
skipped_inactive=0

ENTRY_INDICES=$(jq '.entries | keys[]' "$ENVELOPE_FILE")
for idx in $ENTRY_INDICES; do
  i=$((i + 1))
  USER_ID=$(jq -r ".entries[$idx].userId" "$ENVELOPE_FILE")
  PSEUDO=$(jq -r ".entries[$idx].pseudonymLabel" "$ENVELOPE_FILE")
  HAS_ACTIVITY=$(jq -r ".entries[$idx].hasActivity" "$ENVELOPE_FILE")

  # V1.7 fix carry-over (security-auditor Round 16 BLOCKER 1 CVSS 8.1) :
  # validate the pseudonymLabel as `member-[A-F0-9]{6,8}` before interpolating
  # it into any path. Shell injection prevention via `pseudonymizeMember`
  # output contract. Same defense for userId (cuid-safe alnum + _-).
  if ! [[ "$PSEUDO" =~ ^member-[A-Fa-f0-9]{6,8}$ ]]; then
    errored=$((errored + 1))
    echo "  [$i/$ENTRY_COUNT] SKIP (invalid pseudonymLabel format — possible compromise) : '${PSEUDO:0:32}'"
    echo "{\"userId\":\"$USER_ID\",\"error\":\"invalid_pseudonym_format\"}" >>"$RESULTS_NDJSON"
    continue
  fi
  if ! [[ "$USER_ID" =~ ^[A-Za-z0-9_-]{1,128}$ ]]; then
    errored=$((errored + 1))
    echo "  [$i/$ENTRY_COUNT] SKIP (invalid userId format) : '${USER_ID:0:32}'"
    continue
  fi

  if [ "$HAS_ACTIVITY" != "true" ]; then
    skipped_inactive=$((skipped_inactive + 1))
    echo "  [$i/$ENTRY_COUNT] $PSEUDO → SKIP (no activity this week)"
    continue
  fi

  # V1.7 fix carry-over (code-reviewer Round 16 LOW) : use index-based
  # filenames to avoid pseudonymLabel collision (32-bit hex = 77k members
  # before birthday).
  PROMPT_FILE="$BATCH_DIR/prompt-$i.txt"
  RESPONSE_FILE="$BATCH_DIR/response-$i.json"
  PARSED_FILE="$BATCH_DIR/parsed-$i.json"

  {
    echo "Tu dois analyser la semaine de trading d'un membre Fxmily."
    echo ""
    echo "Voici le snapshot pseudonymisé :"
    echo ""
    jq ".entries[$idx].snapshot" "$ENVELOPE_FILE"
    echo ""
    echo "Réponds STRICTEMENT avec un JSON conforme à ce schéma (pas de markdown,"
    echo "pas de fence, pas de prose hors JSON) :"
    echo ""
    cat "$SCHEMA_FILE"
  } >"$PROMPT_FILE"

  echo "  [$i/$ENTRY_COUNT] $PSEUDO → generating..."

  # V1.7 fix carry-over (code-reviewer Round 16 HIGH H3) : printf '%s' instead
  # of $(cat) to prevent shell expansion of $variables and `$()` inside the
  # system prompt. The file content is treated as a literal argument.
  set +e
  SYSTEM_PROMPT_CONTENT=$(<"$SYSTEM_PROMPT_FILE")
  claude --print \
    $MODEL_FLAG \
    --max-turns "$MAX_TURNS" \
    --append-system-prompt "$SYSTEM_PROMPT_CONTENT" \
    --output-format text \
    <"$PROMPT_FILE" \
    >"$RESPONSE_FILE" 2>>"$ERRORS_LOG"
  CLAUDE_EXIT=$?
  set -e

  if [ $CLAUDE_EXIT -ne 0 ] || [ ! -s "$RESPONSE_FILE" ]; then
    errored=$((errored + 1))
    echo "    ✗ claude exited $CLAUDE_EXIT, response file empty or missing — see $ERRORS_LOG"
    jq -nc --arg uid "$USER_ID" --arg err "claude_exit_$CLAUDE_EXIT" \
       '{userId: $uid, error: $err}' >>"$RESULTS_NDJSON"
  else
    # Strip leading/trailing markdown fences + whitespace
    sed -E '1{/^```(json)?[[:space:]]*$/d}; ${/^```[[:space:]]*$/d}' "$RESPONSE_FILE" \
      | sed -n '/^{/,$p' >"$PARSED_FILE" || true

    if jq -e . "$PARSED_FILE" >/dev/null 2>&1; then
      generated=$((generated + 1))
      echo "    ✓ generated, JSON valid"
      jq -nc --arg uid "$USER_ID" --slurpfile output "$PARSED_FILE" \
         '{userId: $uid, output: $output[0]}' >>"$RESULTS_NDJSON"
    else
      errored=$((errored + 1))
      echo "    ✗ output is not valid JSON — saved to $RESPONSE_FILE"
      jq -nc --arg uid "$USER_ID" --arg err "invalid_json_response" \
         '{userId: $uid, error: $err}' >>"$RESULTS_NDJSON"
    fi
  fi

  # Sleep with jitter between requests (don't sleep after the last one)
  if [ "$i" -lt "$ENTRY_COUNT" ]; then
    SLEEP_DUR=$((SLEEP_MIN + RANDOM % (SLEEP_MAX - SLEEP_MIN + 1)))
    echo "    ⏱  sleeping ${SLEEP_DUR}s (jittered for ban-risk mitigation)"
    sleep "$SLEEP_DUR"
  fi
done

echo "  Generated: $generated, errored: $errored, skipped inactive: $skipped_inactive"

# V1.7 fix carry-over (code-reviewer Round 16 BLOQUANT 4) : assemble final
# results.json from the append-only NDJSON. Single atomic write at the end —
# Ctrl-C mid-loop preserves all completed generations in the NDJSON.
jq -s --arg ws "$WEEK_START" --arg we "$WEEK_END" \
   '{weekStart: $ws, weekEnd: $we, results: .}' \
   "$RESULTS_NDJSON" >"$RESULTS_FILE"

# --- Phase 3 : persist to prod via HTTP -------------------------------------

if [ "$DRY_RUN" = "true" ]; then
  echo "[3/3] --dry-run : skipping persist. Results saved at $RESULTS_FILE"
  exit 0
fi

if [ "$generated" -eq 0 ]; then
  echo "[3/3] No reports to persist (all errored or skipped). Exit 0."
  exit 0
fi

echo "[3/3] Persisting $generated reports to $APP_URL..."
PERSIST_URL="${APP_URL}/api/admin/weekly-batch/persist"
if ! curl --fail-with-body --silent --show-error \
          --max-time 60 \
          -X POST \
          -H "X-Admin-Token: ${FXMILY_ADMIN_TOKEN}" \
          -H "Content-Type: application/json" \
          -H "Accept: application/json" \
          --data-binary "@${RESULTS_FILE}" \
          "$PERSIST_URL" \
          | tee "$BATCH_DIR/persist-result.json"; then
  echo "" >&2
  echo "ERROR: persist request failed. See $BATCH_DIR/persist-result.json for server response." >&2
  exit 2
fi

echo ""
echo "Done. Batch artifacts retained at $BATCH_DIR"
echo "  envelope       : $ENVELOPE_FILE"
echo "  results        : $RESULTS_FILE"
echo "  persist result : $BATCH_DIR/persist-result.json"
echo "  claude errors  : $BATCH_DIR/claude-errors.log"
