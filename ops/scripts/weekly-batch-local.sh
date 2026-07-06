#!/usr/bin/env bash
#
# V1.7.2 weekly batch — local orchestrator (Eliot's Max-subscription path).
#
# Pulls snapshots from prod via HTTP, generates reports locally via
# `claude --print` (using Eliot's Claude Max subscription), pushes results
# back via HTTP. See `apps/web/CLAUDE.md` section "V1.7 LIVE prod" for the
# architecture rationale.
#
# Thin carbon over `ops/scripts/lib/claude-batch-core.sh` (Session 1 plan-10
# DoD#3 §28 — the model/effort/flags/parsing/validations live in the core,
# ONE copy for the 4 orchestrators). This file owns ONLY :
#   - endpoints (/api/admin/weekly-batch/{pull,persist}) + token env name
#   - the weekly workdir + `--current-week` flag
#   - the hasActivity skip predicate (weekly-only token saver)
#   - pseudonym regex `member-[A-Fa-f0-9]{6,8}` (legacy V1.5 6-char accommodated)
#   - the weekly prompt header + results envelope shape (weekStart/weekEnd)
#
# Ban-risk mitigation rules (unchanged from V1.7, enforced by the core) :
#   - Runs FROM Eliot's machine (his IP, his fingerprint, his Max account)
#   - Spreads `claude --print` invocations across 60–120 s jittered sleeps
#   - One invocation per member = fresh context per generation
#   - Snapshots are already pseudonymized (no PII reaches Anthropic)
#   - System prompt + JSON schema travel WITH the envelope
#   - No third-party wrappers — only the official `claude` binary
#   - Audit row `weekly_report.batch.{pulled,persisted}` recorded in prod DB
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
# Optional env (shared defaults live in the core) :
#   FXMILY_APP_URL        default 'https://app.fxmilyapp.com' (must be HTTPS in prod)
#   FXMILY_CLAUDE_MODEL / FXMILY_CLAUDE_EFFORT / FXMILY_MAX_TURNS /
#   FXMILY_MAX_BUDGET_USD / FXMILY_SLEEP_MIN_S / FXMILY_SLEEP_MAX_S
#   FXMILY_BATCH_DIR      default '/tmp/fxmily-batch' (workdir)
#
# Exit codes :
#   0 = batch completed (some entries may have errored ; check report)
#   1 = fatal error (curl, claude unavailable, missing env, etc.)
#   2 = persist step rejected the batch (0 reports written)

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib/claude-batch-core.sh
source "$SCRIPT_DIR/lib/claude-batch-core.sh"

# --- Config (env-overridable with strict validation) ------------------------
APP_URL="${FXMILY_APP_URL:-https://app.fxmilyapp.com}"
BATCH_DIR="${FXMILY_BATCH_DIR:-/tmp/fxmily-batch}"
PSEUDONYM_REGEX='^member-[A-Fa-f0-9]{6,8}$'

core_require_token FXMILY_ADMIN_TOKEN ADMIN_BATCH_TOKEN
core_validate_app_url "$APP_URL"
core_validate_model
core_validate_effort
core_validate_numeric_knobs
core_validate_sleep_range

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

core_sanity_checks
core_init_workdir "$BATCH_DIR"

# --- Phase 1 : pull snapshots from prod via HTTP -----------------------------

if [ "$RESUME" = "false" ] || [ ! -s "$ENVELOPE_FILE" ]; then
  echo "[1/3] Pulling snapshots from $APP_URL..."
  core_pull_envelope "${APP_URL}/api/admin/weekly-batch/pull${CURRENT_WEEK_FLAG}" \
                     "$FXMILY_ADMIN_TOKEN" "$ENVELOPE_FILE"
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

core_extract_prompt_and_schema
: >"$RESULTS_NDJSON"
core_reset_failure_state # Volet B — reset the rate-limit / consecutive-failure breaker

i=0
generated=0
errored=0
skipped_inactive=0

ENTRY_INDICES=$(jq '.entries | keys[]' "$ENVELOPE_FILE")
for idx in $ENTRY_INDICES; do
  i=$((i + 1))
  USER_ID=$(jq -r --argjson idx "$idx" '.entries[$idx].userId' "$ENVELOPE_FILE")
  PSEUDO=$(jq -r --argjson idx "$idx" '.entries[$idx].pseudonymLabel' "$ENVELOPE_FILE")
  HAS_ACTIVITY=$(jq -r --argjson idx "$idx" '.entries[$idx].hasActivity' "$ENVELOPE_FILE")

  if ! core_validate_pseudonym "$PSEUDO" "$PSEUDONYM_REGEX"; then
    errored=$((errored + 1))
    echo "  [$i/$ENTRY_COUNT] SKIP (invalid pseudonymLabel format — possible compromise) : '${PSEUDO:0:32}'"
    core_append_error "$USER_ID" "invalid_pseudonym_format"
    continue
  fi
  if ! core_validate_user_id "$USER_ID"; then
    errored=$((errored + 1))
    echo "  [$i/$ENTRY_COUNT] SKIP (invalid userId format) : '${USER_ID:0:32}'"
    continue
  fi

  if [ "$HAS_ACTIVITY" != "true" ]; then
    skipped_inactive=$((skipped_inactive + 1))
    echo "  [$i/$ENTRY_COUNT] $PSEUDO → SKIP (no activity this week)"
    continue
  fi

  # Index-based filenames to avoid pseudonymLabel collision (V1.7 fix).
  PROMPT_FILE="$BATCH_DIR/prompt-$i.txt"
  RESPONSE_FILE="$BATCH_DIR/response-$i.json"
  PARSED_FILE="$BATCH_DIR/parsed-$i.json"

  core_build_prompt_file \
    "Tu dois analyser la semaine de trading d'un membre Fxmily." \
    "Voici le snapshot pseudonymisé :" \
    "$idx" "$PROMPT_FILE"

  echo "  [$i/$ENTRY_COUNT] $PSEUDO → generating..."

  set +e
  core_invoke_claude_print "$PROMPT_FILE" "$RESPONSE_FILE"
  CLAUDE_EXIT=$?
  set -e

  if [ $CLAUDE_EXIT -ne 0 ] || [ ! -s "$RESPONSE_FILE" ]; then
    errored=$((errored + 1))
    echo "    ✗ claude exited $CLAUDE_EXIT, response file empty or missing — see $ERRORS_LOG"
    core_append_error "$USER_ID" "claude_exit_$CLAUDE_EXIT"
    core_note_failure
  else
    if core_parse_response "$RESPONSE_FILE" "$PARSED_FILE"; then
      generated=$((generated + 1))
      echo "    ✓ generated, JSON valid"
      core_append_success "$USER_ID" "$PARSED_FILE"
      core_note_success
    else
      errored=$((errored + 1))
      echo "    ✗ output is not valid JSON — saved to $RESPONSE_FILE"
      core_append_error "$USER_ID" "invalid_json_response"
      core_note_failure
    fi
  fi

  # Volet B — stop early on a rate limit / consecutive-failure breaker rather
  # than hammering a limited account (idempotent: unprocessed members re-pull).
  if core_should_halt; then
    echo "  Stopping the weekly loop early (see reason above)."
    break
  fi

  # Sleep with jitter between requests (don't sleep after the last one)
  if [ "$i" -lt "$ENTRY_COUNT" ]; then
    core_jittered_sleep
  fi
done

echo "  Generated: $generated, errored: $errored, skipped inactive: $skipped_inactive"

# Assemble final results.json from the append-only NDJSON (single atomic write —
# Ctrl-C mid-loop preserves all completed generations in the NDJSON).
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
if ! core_persist_results "${APP_URL}/api/admin/weekly-batch/persist" \
                          "$FXMILY_ADMIN_TOKEN" "$RESULTS_FILE" \
                          "$BATCH_DIR/persist-result.json"; then
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

# Volet B — surface a rate/usage-limit halt to the worker as exit 75 (benign
# cooldown) even though the partial persist above succeeded. 0 otherwise.
exit "$(core_run_exit_code)"
