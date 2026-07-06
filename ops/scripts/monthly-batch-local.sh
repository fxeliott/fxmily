#!/usr/bin/env bash
#
# V1.4 §25 monthly debrief — local orchestrator (Eliot's Max-subscription path).
#
# Thin carbon over `ops/scripts/lib/claude-batch-core.sh` (Session 1 plan-10
# DoD#3 §28 — model/effort/flags/parsing/validations live in the core, ONE
# copy for the 4 orchestrators). Pulls civil-month snapshots from prod via
# HTTP, generates debriefs locally via `claude --print` (Claude Max — NEVER
# the paid Anthropic API), pushes results back via HTTP. See SPEC §25.
#
# §25 deltas vs the weekly orchestrator (owned by THIS file) :
#   - SPEC §25.4 — a debrief is generated for EVERY active member, including
#     "mois calme" (NO `hasActivity` skip — the monthly cadence is 4× rarer
#     and the recul value matters even for a calm month).
#   - Separate token `FXMILY_MONTHLY_ADMIN_TOKEN` (rotation independent of
#     the weekly `FXMILY_ADMIN_TOKEN`, SPEC §25.2).
#   - Pseudonym regex pinned to the locked J-M1 contract `member-[A-F0-9]{8}`
#     (EXACTLY 8 UPPERCASE hex — the monthly pipeline is brand-new, no legacy
#     6-char pseudonyms exist unlike the weekly `{6,8}`. Tightened code-review
#     T2-1 ; deliberate divergence, do NOT unify).
#
# Ban-risk mitigation rules (9, unchanged — enforced by the core).
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
# Optional env (shared defaults live in the core) :
#   FXMILY_APP_URL / FXMILY_CLAUDE_MODEL / FXMILY_CLAUDE_EFFORT /
#   FXMILY_MAX_TURNS / FXMILY_MAX_BUDGET_USD / FXMILY_SLEEP_MIN_S / FXMILY_SLEEP_MAX_S
#   FXMILY_MONTHLY_BATCH_DIR default '/tmp/fxmily-monthly-batch'
#
# Exit codes :
#   0 = batch completed (some entries may have errored ; check report)
#   1 = fatal error (curl, claude unavailable, missing env, etc.)
#   2 = persist step rejected the batch (0 debriefs written)

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib/claude-batch-core.sh
source "$SCRIPT_DIR/lib/claude-batch-core.sh"

# --- Config (env-overridable with strict validation) ------------------------
APP_URL="${FXMILY_APP_URL:-https://app.fxmilyapp.com}"
BATCH_DIR="${FXMILY_MONTHLY_BATCH_DIR:-/tmp/fxmily-monthly-batch}"
PSEUDONYM_REGEX='^member-[A-F0-9]{8}$'

core_require_token FXMILY_MONTHLY_ADMIN_TOKEN MONTHLY_ADMIN_BATCH_TOKEN
core_validate_app_url "$APP_URL"
core_validate_model
core_validate_effort
core_validate_numeric_knobs
core_validate_sleep_range

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

core_sanity_checks
core_init_workdir "$BATCH_DIR"

# --- Phase 1 : pull snapshots from prod via HTTP -----------------------------

if [ "$RESUME" = "false" ] || [ ! -s "$ENVELOPE_FILE" ]; then
  echo "[1/3] Pulling monthly snapshots from $APP_URL..."
  core_pull_envelope "${APP_URL}/api/admin/monthly-batch/pull${CURRENT_MONTH_FLAG}" \
                     "$FXMILY_MONTHLY_ADMIN_TOKEN" "$ENVELOPE_FILE"
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

core_extract_prompt_and_schema
: >"$RESULTS_NDJSON"
core_reset_failure_state # Volet B — reset the rate-limit / consecutive-failure breaker

i=0
generated=0
errored=0

ENTRY_INDICES=$(jq '.entries | keys[]' "$ENVELOPE_FILE")
for idx in $ENTRY_INDICES; do
  i=$((i + 1))
  USER_ID=$(jq -r --argjson idx "$idx" '.entries[$idx].userId' "$ENVELOPE_FILE")
  PSEUDO=$(jq -r --argjson idx "$idx" '.entries[$idx].pseudonymLabel' "$ENVELOPE_FILE")

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

  # SPEC §25.4 — NO hasActivity skip. Every active member gets a debrief
  # (the AI produces an honest "mois calme" from the snapshot).

  PROMPT_FILE="$BATCH_DIR/prompt-$i.txt"
  RESPONSE_FILE="$BATCH_DIR/response-$i.json"
  PARSED_FILE="$BATCH_DIR/parsed-$i.json"

  core_build_prompt_file \
    "Tu dois produire le débrief mensuel d'un membre Fxmily." \
    "Voici le snapshot pseudonymisé du mois civil :" \
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
    echo "  Stopping the monthly loop early (see reason above)."
    break
  fi

  # Sleep with jitter between requests (don't sleep after the last one).
  if [ "$i" -lt "$ENTRY_COUNT" ]; then
    core_jittered_sleep
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
if ! core_persist_results "${APP_URL}/api/admin/monthly-batch/persist" \
                          "$FXMILY_MONTHLY_ADMIN_TOKEN" "$RESULTS_FILE" \
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
