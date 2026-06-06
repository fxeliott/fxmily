#!/usr/bin/env bash
#
# V1.4 §25 monthly debrief — local orchestrator (Eliot's Max-subscription path).
#
# EXACT carbon of `ops/scripts/weekly-batch-local.sh` adapted to the monthly
# cadence. Pulls civil-month snapshots from prod via HTTP, generates debriefs
# locally via `claude --print` (Eliot's Claude Max subscription — NEVER the
# paid Anthropic API), pushes results back via HTTP. See `apps/web/CLAUDE.md`
# "V1.7 LIVE prod" + SPEC §25 for the architecture rationale.
#
# Ban-risk mitigation rules (unchanged from V1.7) :
#   - Runs FROM Eliot's machine (his IP, his fingerprint, his Max account)
#   - Spreads `claude --print` invocations across 60–120 s jittered sleeps
#   - One invocation per member = fresh context per generation
#   - Snapshots are already pseudonymized by the LOADER (no PII to Anthropic)
#   - System prompt + JSON schema travel WITH the envelope (no on-device
#     tampering possible without committing to the repo)
#   - No third-party wrappers — only the official `claude` binary
#   - Audit row `monthly_debrief.batch.{pulled,persisted}` recorded in prod DB
#
# §25 delta vs the weekly script :
#   - SPEC §25.4 — a debrief is generated for EVERY active member, including
#     "mois calme" (the AI writes an honest quiet-month synthesis). There is
#     NO `hasActivity` skip (the weekly script skips inactive members to save
#     tokens ; the monthly cadence is 4× rarer and the recul value matters
#     even for a calm month).
#   - Separate token `FXMILY_MONTHLY_ADMIN_TOKEN` (rotation independent of
#     the weekly `FXMILY_ADMIN_TOKEN`, SPEC §25.2).
#
# Usage :
#   bash ops/scripts/monthly-batch-local.sh                 # just-ended month (default)
#   bash ops/scripts/monthly-batch-local.sh --current-month
#   bash ops/scripts/monthly-batch-local.sh --dry-run       # pull + generate only
#   bash ops/scripts/monthly-batch-local.sh --resume        # reuse workdir (skip pull)
#
# Required env :
#   FXMILY_MONTHLY_ADMIN_TOKEN   32+ char token (sync with prod MONTHLY_ADMIN_BATCH_TOKEN)
#
# Optional env :
#   FXMILY_APP_URL          default 'https://app.fxmilyapp.com' (HTTPS in prod)
#   FXMILY_CLAUDE_MODEL     default 'claude-opus-4-8' (§8 — Opus 4.8 for member analyses)
#   FXMILY_CLAUDE_EFFORT    default 'xhigh' (§8 "en extra" ; low|medium|high|xhigh|max)
#   FXMILY_MONTHLY_BATCH_DIR default '/tmp/fxmily-monthly-batch'
#   FXMILY_SLEEP_MIN_S      default 60 (floor 30 — ban-risk mitigation)
#   FXMILY_SLEEP_MAX_S      default 120
#
# Exit codes :
#   0 = batch completed (some entries may have errored ; check report)
#   1 = fatal error (curl, claude unavailable, missing env, etc.)
#   2 = persist step rejected the batch (0 debriefs written)

set -euo pipefail

# --- Config (env-overridable with strict validation) ------------------------
APP_URL="${FXMILY_APP_URL:-https://app.fxmilyapp.com}"
BATCH_DIR="${FXMILY_MONTHLY_BATCH_DIR:-/tmp/fxmily-monthly-batch}"
SLEEP_MIN="${FXMILY_SLEEP_MIN_S:-60}"
SLEEP_MAX="${FXMILY_SLEEP_MAX_S:-120}"
# ≥2 required: Opus 4.8 thinking uses a turn before the JSON, so `--max-turns 1`
# aborts with "Reached max turns (1)" (validated via the §26 calendar batch real
# e2e, 2026-06-04). `--max-budget-usd` below is the runaway circuit-breaker. NOT 1.
MAX_TURNS="${FXMILY_MAX_TURNS:-8}"
# §8 — local Claude solicitations run on Opus 4.8 at "extra" effort by default.
CLAUDE_MODEL="${FXMILY_CLAUDE_MODEL:-claude-opus-4-8}"
CLAUDE_EFFORT="${FXMILY_CLAUDE_EFFORT:-xhigh}"
MODEL_FLAG=""
EFFORT_FLAG=""

# Required token. Refuse to run without it (mirrors the server-side 503).
if [ -z "${FXMILY_MONTHLY_ADMIN_TOKEN:-}" ]; then
  echo "ERROR: FXMILY_MONTHLY_ADMIN_TOKEN env not set." >&2
  echo "  Generate via 'openssl rand -hex 32' and provision on Hetzner :" >&2
  echo "    echo 'MONTHLY_ADMIN_BATCH_TOKEN=<value>' >> /etc/fxmily/web.env" >&2
  echo "    cd /opt/fxmily && docker compose -f docker-compose.prod.yml restart web" >&2
  echo "  Then export FXMILY_MONTHLY_ADMIN_TOKEN=<same value> in your local shell." >&2
  exit 1
fi

# Minimal URL sanity. No http:// in prod (token would travel plaintext).
case "$APP_URL" in
  https://*) ;;
  http://localhost:*|http://127.0.0.1:*) ;;
  *)
    echo "ERROR: FXMILY_APP_URL=$APP_URL must be HTTPS (or http://localhost:* for dev)." >&2
    exit 1
    ;;
esac

# §8 — Opus 4.8 default allowlist (verified `claude --help` CLI 2.1.154).
case "$CLAUDE_MODEL" in
  claude-opus-4-8|claude-opus-4-7|claude-sonnet-4-6|claude-haiku-4-5) ;;
  *)
    echo "ERROR: FXMILY_CLAUDE_MODEL=$CLAUDE_MODEL not in allowlist." >&2
    echo "  Allowed: claude-opus-4-8, claude-opus-4-7, claude-sonnet-4-6, claude-haiku-4-5" >&2
    exit 1
    ;;
esac
MODEL_FLAG="--model ${CLAUDE_MODEL}"

# §8 — effort level (low|medium|high|xhigh|max). Default xhigh = "en extra".
case "$CLAUDE_EFFORT" in
  low|medium|high|xhigh|max) ;;
  *)
    echo "ERROR: FXMILY_CLAUDE_EFFORT=$CLAUDE_EFFORT invalid (low|medium|high|xhigh|max)." >&2
    exit 1
    ;;
esac
EFFORT_FLAG="--effort ${CLAUDE_EFFORT}"

# Sleep range validation + floor 30s (ban-risk mitigation, carbon weekly).
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

CURRENT_MONTH_FLAG=""
DRY_RUN=false
RESUME=false
for arg in "$@"; do
  case "$arg" in
    --current-month) CURRENT_MONTH_FLAG="?currentMonth=true" ;;
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
echo "Claude CLI: $(claude --version 2>&1 | head -1)"
echo "Model: $CLAUDE_MODEL — effort: $CLAUDE_EFFORT (§8 full performance)"
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
RESULTS_NDJSON="$BATCH_DIR/results.ndjson"
RESULTS_FILE="$BATCH_DIR/results.json"
ERRORS_LOG="$BATCH_DIR/claude-errors.log"

# Truncate the errors log + scrub artifacts >7 days (PII hygiene, carbon weekly).
: >"$ERRORS_LOG"
find "$BATCH_DIR" -type f -mtime +7 -delete 2>/dev/null || true

# --- Phase 1 : pull snapshots from prod via HTTP -----------------------------

if [ "$RESUME" = "false" ] || [ ! -s "$ENVELOPE_FILE" ]; then
  echo "[1/3] Pulling monthly snapshots from $APP_URL..."
  PULL_URL="${APP_URL}/api/admin/monthly-batch/pull${CURRENT_MONTH_FLAG}"
  if ! curl --fail-with-body --silent --show-error \
            --max-time 90 \
            -X POST \
            -H "X-Admin-Token: ${FXMILY_MONTHLY_ADMIN_TOKEN}" \
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
MONTH_START=$(jq -r '.monthStart' "$ENVELOPE_FILE")
MONTH_END=$(jq -r '.monthEnd' "$ENVELOPE_FILE")

echo "  Month: $MONTH_START → $MONTH_END"
echo "  Members: $ENTRY_COUNT total, $ACTIVE_COUNT with activity"
echo "  (SPEC §25.4 — a debrief is generated for ALL active members, calm months included)"

# --- Phase 2 : generate debriefs locally via claude --print -----------------

echo "[2/3] Generating debriefs locally via 'claude --print' ($SLEEP_MIN-${SLEEP_MAX}s jittered)..."

SYSTEM_PROMPT_FILE="$BATCH_DIR/system-prompt.txt"
SCHEMA_FILE="$BATCH_DIR/output-schema.json"
jq -r '.systemPrompt' "$ENVELOPE_FILE" >"$SYSTEM_PROMPT_FILE"
jq '.outputJsonSchema' "$ENVELOPE_FILE" >"$SCHEMA_FILE"

# Append-only NDJSON — survives Ctrl-C ; assembled into JSON at the end.
: >"$RESULTS_NDJSON"

i=0
generated=0
errored=0

ENTRY_INDICES=$(jq '.entries | keys[]' "$ENVELOPE_FILE")
for idx in $ENTRY_INDICES; do
  i=$((i + 1))
  # --argjson + single quotes (Windows Git Bash MSYS path-mangling defense).
  USER_ID=$(jq -r --argjson idx "$idx" '.entries[$idx].userId' "$ENVELOPE_FILE")
  PSEUDO=$(jq -r --argjson idx "$idx" '.entries[$idx].pseudonymLabel' "$ENVELOPE_FILE")

  # Validate the pseudonymLabel before interpolating into any path (shell
  # injection prevention via the pseudonymizeMember output contract).
  # Pinned to the locked J-M1 contract: `pseudonymLabelSchema`
  # (lib/schemas/monthly-debrief.ts) + `pseudonymizeMember` emit EXACTLY
  # 8 UPPERCASE hex. The monthly pipeline is brand-new — no legacy 6-char
  # pseudonyms exist (unlike the weekly script's `{6,8}` which accommodates
  # historical V1.5 reports). Tightened deliberately (code-review T2-1).
  if ! [[ "$PSEUDO" =~ ^member-[A-F0-9]{8}$ ]]; then
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

  # SPEC §25.4 — NO hasActivity skip. Every active member gets a debrief
  # (the AI produces an honest "mois calme" from the snapshot).

  PROMPT_FILE="$BATCH_DIR/prompt-$i.txt"
  RESPONSE_FILE="$BATCH_DIR/response-$i.json"
  PARSED_FILE="$BATCH_DIR/parsed-$i.json"

  {
    echo "Tu dois produire le débrief mensuel d'un membre Fxmily."
    echo ""
    echo "Voici le snapshot pseudonymisé du mois civil :"
    echo ""
    jq --argjson idx "$idx" '.entries[$idx].snapshot' "$ENVELOPE_FILE"
    echo ""
    echo "Réponds STRICTEMENT avec un JSON conforme à ce schéma (pas de markdown,"
    echo "pas de fence, pas de prose hors JSON) :"
    echo ""
    cat "$SCHEMA_FILE"
  } >"$PROMPT_FILE"

  echo "  [$i/$ENTRY_COUNT] $PSEUDO → generating..."

  set +e
  SYSTEM_PROMPT_CONTENT=$(<"$SYSTEM_PROMPT_FILE")
  # `--bare` deliberately NOT used (Eliot uses OAuth Max keychain — --bare
  # forces ANTHROPIC_API_KEY only, breaks auth). `--max-turns 1` + single
  # invocation per member keeps ban-risk rule #3 (fresh context) satisfied.
  # `--max-budget-usd 5.00` financial circuit-breaker (theoretical $0 on Max
  # sub, caps damage if Anthropic ever silently switches to billable API).
  claude --print \
    $MODEL_FLAG \
    $EFFORT_FLAG \
    --max-turns "$MAX_TURNS" \
    --max-budget-usd 5.00 \
    --setting-sources "" \
    --system-prompt "$SYSTEM_PROMPT_CONTENT" \
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

  # Sleep with jitter between requests (don't sleep after the last one).
  if [ "$i" -lt "$ENTRY_COUNT" ]; then
    SLEEP_DUR=$((SLEEP_MIN + RANDOM % (SLEEP_MAX - SLEEP_MIN + 1)))
    echo "    ⏱  sleeping ${SLEEP_DUR}s (jittered for ban-risk mitigation)"
    sleep "$SLEEP_DUR"
  fi
done

echo "  Generated: $generated, errored: $errored"

# Assemble final results.json from the append-only NDJSON (single atomic write).
jq -s --arg ms "$MONTH_START" --arg me "$MONTH_END" \
   '{monthStart: $ms, monthEnd: $me, results: .}' \
   "$RESULTS_NDJSON" >"$RESULTS_FILE"

# --- Phase 3 : persist to prod via HTTP -------------------------------------

if [ "$DRY_RUN" = "true" ]; then
  echo "[3/3] --dry-run : skipping persist. Results saved at $RESULTS_FILE"
  exit 0
fi

if [ "$generated" -eq 0 ]; then
  echo "[3/3] No debriefs to persist (all errored). Exit 0."
  exit 0
fi

echo "[3/3] Persisting $generated debriefs to $APP_URL..."
PERSIST_URL="${APP_URL}/api/admin/monthly-batch/persist"
if ! curl --fail-with-body --silent --show-error \
          --max-time 60 \
          -X POST \
          -H "X-Admin-Token: ${FXMILY_MONTHLY_ADMIN_TOKEN}" \
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
