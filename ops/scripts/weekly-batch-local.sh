#!/usr/bin/env bash
#
# V1.7 weekly batch — local orchestrator (Eliot's Max-subscription path).
#
# Pulls snapshots from Hetzner, generates reports locally via `claude --print`
# (using Eliot's Claude Max subscription), pushes results back.
#
# Ban-risk mitigation rules :
#   - Runs FROM Eliot's machine (his IP, his fingerprint, his Max account)
#   - Spreads `claude --print` invocations across 60–120 s jittered sleeps
#   - One invocation per member = fresh context per generation (no context
#     bleed across members, no oversized single conversation)
#   - Snapshots are already pseudonymized (no PII reaches Anthropic)
#   - System prompt + JSON schema travel WITH the envelope (no on-device
#     tampering possible without committing to the repo)
#   - No third-party wrappers — only the official `claude` binary
#   - Audit row `weekly_report.batch.{pulled,persisted}` on Hetzner so DBA
#     queries can spot abuse / mismatch
#
# Usage :
#   bash ops/scripts/weekly-batch-local.sh                # previous full week (default)
#   bash ops/scripts/weekly-batch-local.sh --current-week
#   bash ops/scripts/weekly-batch-local.sh --dry-run      # pull + generate only, do not persist
#   bash ops/scripts/weekly-batch-local.sh --resume       # reuse /tmp/fxmily-batch/*.json (skip pull)
#
# Env :
#   FXMILY_SSH_HOST       default 'hetzner-dieu' (must resolve via ~/.ssh/config)
#   FXMILY_CLAUDE_MODEL   default empty (let Claude Code pick default Sonnet 4.6)
#   FXMILY_BATCH_DIR      default '/tmp/fxmily-batch' (workdir)
#   FXMILY_SLEEP_MIN_S    default 60
#   FXMILY_SLEEP_MAX_S    default 120
#   FXMILY_MAX_TURNS      default 1 (anti-bloat ; Claude reads prompt, writes JSON, done)
#
# Exit codes :
#   0 = batch completed (some entries may have errored ; check report)
#   1 = fatal error (SSH, pull, claude unavailable, etc.)
#   2 = persist step rejected the batch (0 reports written)

set -euo pipefail

SSH_HOST="${FXMILY_SSH_HOST:-hetzner-dieu}"
BATCH_DIR="${FXMILY_BATCH_DIR:-/tmp/fxmily-batch}"
SLEEP_MIN="${FXMILY_SLEEP_MIN_S:-60}"
SLEEP_MAX="${FXMILY_SLEEP_MAX_S:-120}"
MAX_TURNS="${FXMILY_MAX_TURNS:-1}"
MODEL_FLAG=""
if [ -n "${FXMILY_CLAUDE_MODEL:-}" ]; then
  MODEL_FLAG="--model ${FXMILY_CLAUDE_MODEL}"
fi

CURRENT_WEEK_FLAG=""
DRY_RUN=false
RESUME=false
for arg in "$@"; do
  case "$arg" in
    --current-week) CURRENT_WEEK_FLAG="--current-week" ;;
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
command -v ssh >/dev/null 2>&1 || {
  echo "ERROR: 'ssh' not found." >&2
  exit 1
}

mkdir -p "$BATCH_DIR"
ENVELOPE_FILE="$BATCH_DIR/envelope.json"
RESULTS_FILE="$BATCH_DIR/results.json"

# --- Phase 1 : pull snapshots from Hetzner ----------------------------------

if [ "$RESUME" = "false" ] || [ ! -s "$ENVELOPE_FILE" ]; then
  echo "[1/3] Pulling snapshots from $SSH_HOST..."
  ssh "$SSH_HOST" \
    "cd /opt/fxmily && docker compose exec -T web pnpm tsx scripts/weekly-batch-pull.ts $CURRENT_WEEK_FLAG" \
    >"$ENVELOPE_FILE"
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

# Start a fresh results buffer (array)
echo "{\"weekStart\": \"$WEEK_START\", \"weekEnd\": \"$WEEK_END\", \"results\": []}" >"$RESULTS_FILE"

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

  if [ "$HAS_ACTIVITY" != "true" ]; then
    skipped_inactive=$((skipped_inactive + 1))
    echo "  [$i/$ENTRY_COUNT] $PSEUDO → SKIP (no activity this week)"
    continue
  fi

  # Build the per-member user prompt (data + schema)
  PROMPT_FILE="$BATCH_DIR/prompt-$PSEUDO.txt"
  RESPONSE_FILE="$BATCH_DIR/response-$PSEUDO.json"

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

  # Invoke claude --print headless. We pipe the user prompt on stdin.
  # `--max-turns 1` keeps it to a single shot (no agentic loop).
  # `--output-format text` returns just the assistant content (we'll parse the
  # JSON ourselves). The system prompt is injected via `--append-system-prompt`
  # so the local Mark Douglas posture is locked.
  set +e
  claude --print \
    $MODEL_FLAG \
    --max-turns "$MAX_TURNS" \
    --append-system-prompt "$(cat "$SYSTEM_PROMPT_FILE")" \
    --output-format text \
    <"$PROMPT_FILE" \
    >"$RESPONSE_FILE" 2>>"$BATCH_DIR/claude-errors.log"
  CLAUDE_EXIT=$?
  set -e

  if [ $CLAUDE_EXIT -ne 0 ] || [ ! -s "$RESPONSE_FILE" ]; then
    errored=$((errored + 1))
    echo "    ✗ claude exited $CLAUDE_EXIT, response file empty or missing — see $BATCH_DIR/claude-errors.log"
    jq --arg uid "$USER_ID" --arg err "claude_exit_$CLAUDE_EXIT" \
       '.results += [{userId: $uid, error: $err}]' \
       "$RESULTS_FILE" >"$RESULTS_FILE.tmp" && mv "$RESULTS_FILE.tmp" "$RESULTS_FILE"
  else
    # Try to extract a JSON object from the response (strip code fences if any)
    PARSED_FILE="$BATCH_DIR/parsed-$PSEUDO.json"
    # Strip leading/trailing markdown fences + whitespace
    sed -E '1{/^```(json)?[[:space:]]*$/d}; ${/^```[[:space:]]*$/d}' "$RESPONSE_FILE" \
      | sed -n '/^{/,$p' >"$PARSED_FILE" || true

    if jq -e . "$PARSED_FILE" >/dev/null 2>&1; then
      generated=$((generated + 1))
      echo "    ✓ generated, JSON valid"
      jq --arg uid "$USER_ID" --slurpfile output "$PARSED_FILE" \
         '.results += [{userId: $uid, output: $output[0]}]' \
         "$RESULTS_FILE" >"$RESULTS_FILE.tmp" && mv "$RESULTS_FILE.tmp" "$RESULTS_FILE"
    else
      errored=$((errored + 1))
      echo "    ✗ output is not valid JSON — saved to $RESPONSE_FILE"
      jq --arg uid "$USER_ID" --arg err "invalid_json_response" \
         '.results += [{userId: $uid, error: $err}]' \
         "$RESULTS_FILE" >"$RESULTS_FILE.tmp" && mv "$RESULTS_FILE.tmp" "$RESULTS_FILE"
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

# --- Phase 3 : persist to Hetzner -------------------------------------------

if [ "$DRY_RUN" = "true" ]; then
  echo "[3/3] --dry-run : skipping persist. Results saved at $RESULTS_FILE"
  exit 0
fi

if [ "$generated" -eq 0 ]; then
  echo "[3/3] No reports to persist (all errored or skipped). Exit 0."
  exit 0
fi

echo "[3/3] Persisting $generated reports to $SSH_HOST..."
ssh "$SSH_HOST" \
  "cd /opt/fxmily && docker compose exec -T web pnpm tsx scripts/weekly-batch-persist.ts" \
  <"$RESULTS_FILE" \
  | tee "$BATCH_DIR/persist-result.json"

echo ""
echo "Done. Batch artifacts retained at $BATCH_DIR"
echo "  envelope       : $ENVELOPE_FILE"
echo "  results        : $RESULTS_FILE"
echo "  persist result : $BATCH_DIR/persist-result.json"
echo "  claude errors  : $BATCH_DIR/claude-errors.log"
