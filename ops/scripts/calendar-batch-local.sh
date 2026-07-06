#!/usr/bin/env bash
#
# §26 calendar batch — local orchestrator (Eliot's Max-subscription path, J-C2).
#
# Thin carbon over `ops/scripts/lib/claude-batch-core.sh` (Session 1 plan-10
# DoD#3 §28 — model/effort/flags/parsing/validations live in the core, ONE
# copy for the 4 orchestrators). Pulls weekly-schedule snapshots from prod via
# HTTP, generates an adaptive calendar locally per member via `claude --print`
# (Claude Max, $0 marginal), pushes results back via HTTP.
#
# Calendar-specific deltas (owned by THIS file) :
#   - Separate token `FXMILY_CALENDAR_TOKEN` (prod CALENDAR_ADMIN_BATCH_TOKEN)
#   - Members WITHOUT a questionnaire this week are skipped (0 token) — the
#     loader already filters them, this is the defensive second net
#   - Results envelope = { weekStart, results } — NO weekEnd column
#
# Ban-risk mitigation rules (9, unchanged — enforced by the core). The
# PURE-GENERATOR ISOLATION rationale of the three `claude --print` flags
# (real e2e validated 2026-06-04) is documented on `core_invoke_claude_print`.
#
# Usage :
#   bash ops/scripts/calendar-batch-local.sh            # current Paris week (default)
#   bash ops/scripts/calendar-batch-local.sh --dry-run  # pull + generate only, do not persist
#   bash ops/scripts/calendar-batch-local.sh --resume   # reuse /tmp/fxmily-calendar-batch/*.json (skip pull)
#
# Required env :
#   FXMILY_CALENDAR_TOKEN   32+ char admin token (sync with prod CALENDAR_ADMIN_BATCH_TOKEN)
#
# Optional env (shared defaults live in the core) :
#   FXMILY_APP_URL / FXMILY_CLAUDE_MODEL / FXMILY_CLAUDE_EFFORT /
#   FXMILY_MAX_TURNS / FXMILY_MAX_BUDGET_USD / FXMILY_SLEEP_MIN_S / FXMILY_SLEEP_MAX_S
#   FXMILY_CALENDAR_BATCH_DIR  default '/tmp/fxmily-calendar-batch' (workdir)
#
# Exit codes :
#   0 = batch completed (some entries may have errored ; check report)
#   1 = fatal error (curl, claude unavailable, missing env, etc.)
#   2 = persist step rejected the batch (0 calendars written)

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib/claude-batch-core.sh
source "$SCRIPT_DIR/lib/claude-batch-core.sh"

# --- Config (env-overridable with strict validation) ------------------------
APP_URL="${FXMILY_APP_URL:-https://app.fxmilyapp.com}"
BATCH_DIR="${FXMILY_CALENDAR_BATCH_DIR:-/tmp/fxmily-calendar-batch}"
PSEUDONYM_REGEX='^member-[A-Fa-f0-9]{6,8}$'

core_require_token FXMILY_CALENDAR_TOKEN CALENDAR_ADMIN_BATCH_TOKEN
core_validate_app_url "$APP_URL"
core_validate_model
core_validate_effort
core_validate_numeric_knobs
core_validate_sleep_range

DRY_RUN=false
RESUME=false
for arg in "$@"; do
  case "$arg" in
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
  core_pull_envelope "${APP_URL}/api/admin/calendar-batch/pull" \
                     "$FXMILY_CALENDAR_TOKEN" "$ENVELOPE_FILE"
else
  echo "[1/3] --resume : reusing existing $ENVELOPE_FILE"
fi

ENTRY_COUNT=$(jq '.entries | length' "$ENVELOPE_FILE")
WEEK_START=$(jq -r '.weekStart' "$ENVELOPE_FILE")
# Finding B — the instant the snapshots were frozen (pull `ranAt`). Echoed back
# in the persist payload so the server stamps each calendar's `generatedAt` with
# it (the freshness clock) instead of the persist instant, closing the
# pull→re-submit→persist lost-update race. Empty string if an older envelope
# lacks it → the server falls back to its persist instant (back-compat).
RAN_AT=$(jq -r '.ranAt // empty' "$ENVELOPE_FILE")

echo "  Week: $WEEK_START (Europe/Paris)"
echo "  Members with a questionnaire this week: $ENTRY_COUNT"

# --- Phase 2 : generate calendars locally via claude --print -----------------

echo "[2/3] Generating calendars locally via 'claude --print' ($SLEEP_MIN-${SLEEP_MAX}s jittered)..."

core_extract_prompt_and_schema
: >"$RESULTS_NDJSON"
core_reset_failure_state # Volet B — reset the rate-limit / consecutive-failure breaker

i=0
generated=0
errored=0
skipped_no_questionnaire=0

ENTRY_INDICES=$(jq '.entries | keys[]' "$ENVELOPE_FILE")
for idx in $ENTRY_INDICES; do
  i=$((i + 1))
  USER_ID=$(jq -r --argjson idx "$idx" '.entries[$idx].userId' "$ENVELOPE_FILE")
  PSEUDO=$(jq -r --argjson idx "$idx" '.entries[$idx].pseudonymLabel' "$ENVELOPE_FILE")
  HAS_QUESTIONNAIRE=$(jq -r --argjson idx "$idx" '.entries[$idx].hasQuestionnaire' "$ENVELOPE_FILE")

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

  # Defensive second net — the loader already filters to members WITH a
  # questionnaire, but skip + spend 0 token if a `false` ever slips through.
  if [ "$HAS_QUESTIONNAIRE" != "true" ]; then
    skipped_no_questionnaire=$((skipped_no_questionnaire + 1))
    echo "  [$i/$ENTRY_COUNT] $PSEUDO → SKIP (no questionnaire this week)"
    continue
  fi

  PROMPT_FILE="$BATCH_DIR/prompt-$i.txt"
  RESPONSE_FILE="$BATCH_DIR/response-$i.json"
  PARSED_FILE="$BATCH_DIR/parsed-$i.json"

  core_build_prompt_file \
    "Tu dois construire le calendrier hebdomadaire personnel d'un membre Fxmily." \
    "Voici le snapshot pseudonymisé (compteurs d'activité + disponibilité déclarée) :" \
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
    echo "  Stopping the calendar loop early (see reason above)."
    break
  fi

  # Sleep with jitter between requests (don't sleep after the last one).
  if [ "$i" -lt "$ENTRY_COUNT" ]; then
    core_jittered_sleep
  fi
done

echo "  Generated: $generated, errored: $errored, skipped (no questionnaire): $skipped_no_questionnaire"

# Assemble final results.json from the append-only NDJSON (single atomic write).
# Calendar persist request = { weekStart, snapshotTakenAt?, results } — NO weekEnd.
# `snapshotTakenAt` is added ONLY when `RAN_AT` is non-empty: the route schema
# validates it as an ISO datetime, so an empty string would 400 — omit the key
# entirely (it is `.optional()`) to keep the back-compat fallback path clean.
jq -s --arg ws "$WEEK_START" --arg sta "$RAN_AT" \
   '{weekStart: $ws, results: .} + (if $sta == "" then {} else {snapshotTakenAt: $sta} end)' \
   "$RESULTS_NDJSON" >"$RESULTS_FILE"

# --- Phase 3 : persist to prod via HTTP -------------------------------------

if [ "$DRY_RUN" = "true" ]; then
  echo "[3/3] --dry-run : skipping persist. Results saved at $RESULTS_FILE"
  exit 0
fi

if [ "$generated" -eq 0 ]; then
  echo "[3/3] No calendars to persist (all errored or skipped). Exit 0."
  exit 0
fi

echo "[3/3] Persisting $generated calendars to $APP_URL..."
if ! core_persist_results "${APP_URL}/api/admin/calendar-batch/persist" \
                          "$FXMILY_CALENDAR_TOKEN" "$RESULTS_FILE" \
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
