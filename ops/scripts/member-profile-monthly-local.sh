#!/usr/bin/env bash
#
# J-E (expansion IA §21.5) monthly deep re-profiling — local orchestrator
# (Eliot's Max-subscription path, 7th local Claude pipeline). ADMIN-ONLY.
#
# Thin carbon over `ops/scripts/lib/claude-batch-core.sh` (sourced UNCHANGED —
# model/effort/flags/parsing/validations/ban-risk breaker live in the core, ONE
# copy for every orchestrator). Pulls civil-month re-profiling snapshots from
# prod via HTTP, re-derives the 4 deep dimensions locally via `claude --print`
# (Claude Max — NEVER the paid Anthropic API), pushes results back via HTTP.
#
# Deltas vs the monthly-debrief orchestrator (owned by THIS file) :
#   - Separate token `FXMILY_PROFILE_ADMIN_TOKEN` (rotation independent of every
#     other batch token — the re-profiled snapshots leave the host toward
#     Anthropic, a distinct compromise blast radius).
#   - Endpoints `/api/admin/member-profile-batch/{pull,persist}`.
#   - Pseudonym regex pinned to `member-[A-F0-9]{8}` (EXACTLY 8 UPPERCASE hex —
#     brand-new pipeline, no legacy 6-char pseudonyms; same contract as monthly).
#   - The pull already SKIPS members with no reflection this month (nothing to
#     re-profile), so there is no `hasActivity` field and no client-side skip.
#   - The per-member USER PROMPT is PRE-RENDERED server-side and rides in the
#     envelope (`entries[].userPrompt`) — the reference-vs-citable-source framing
#     + per-reflection untrusted wrapping travel verbatim to `claude --print`
#     (J-B lesson). So this file does NOT call `core_build_prompt_file` (which
#     would send the raw snapshot JSON); it assembles `userPrompt` + the schema.
#
# Ban-risk mitigation rules (9, unchanged — enforced by the core).
#
# Usage :
#   bash ops/scripts/member-profile-monthly-local.sh                 # just-ended month (default)
#   bash ops/scripts/member-profile-monthly-local.sh --current-month
#   bash ops/scripts/member-profile-monthly-local.sh --dry-run       # pull + generate only
#   bash ops/scripts/member-profile-monthly-local.sh --resume        # reuse workdir (skip pull)
#
# Required env :
#   FXMILY_PROFILE_ADMIN_TOKEN   32+ char token (sync with prod PROFILE_ADMIN_BATCH_TOKEN)
#
# Optional env (shared defaults live in the core) :
#   FXMILY_APP_URL / FXMILY_CLAUDE_MODEL / FXMILY_CLAUDE_EFFORT /
#   FXMILY_MAX_TURNS / FXMILY_MAX_BUDGET_USD / FXMILY_SLEEP_MIN_S / FXMILY_SLEEP_MAX_S
#   FXMILY_PROFILE_BATCH_DIR default '/tmp/fxmily-profile-batch'
#
# Exit codes :
#   0 = batch completed (some entries may have errored ; check report)
#   1 = fatal error (curl, claude unavailable, missing env, etc.)
#   2 = persist step rejected the batch (0 snapshots written)

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib/claude-batch-core.sh
source "$SCRIPT_DIR/lib/claude-batch-core.sh"

# --- Config (env-overridable with strict validation) ------------------------
APP_URL="${FXMILY_APP_URL:-https://app.fxmilyapp.com}"
BATCH_DIR="${FXMILY_PROFILE_BATCH_DIR:-/tmp/fxmily-profile-batch}"
PSEUDONYM_REGEX='^member-[A-F0-9]{8}$'

core_require_token FXMILY_PROFILE_ADMIN_TOKEN PROFILE_ADMIN_BATCH_TOKEN
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

# Assemble the per-member prompt file from the PRE-RENDERED envelope userPrompt
# + the output schema. `--argjson idx` keeps the index a typed jq variable (no
# MSYS path-mangling on Git Bash, mirror core_build_prompt_file). $1 = jq entry
# index, $2 = output prompt file.
build_profile_prompt_file() {
  local idx="$1" out="$2"
  {
    jq -r --argjson idx "$idx" '.entries[$idx].userPrompt' "$ENVELOPE_FILE"
    echo ""
    echo "Schéma JSON de sortie (rappel — réponds STRICTEMENT conforme, aucun autre texte) :"
    echo ""
    cat "$SCHEMA_FILE"
  } >"$out"
}

# --- Phase 1 : pull snapshots from prod via HTTP -----------------------------

if [ "$RESUME" = "false" ] || [ ! -s "$ENVELOPE_FILE" ]; then
  echo "[1/3] Pulling re-profiling snapshots from $APP_URL..."
  core_pull_envelope "${APP_URL}/api/admin/member-profile-batch/pull${CURRENT_MONTH_FLAG}" \
                     "$FXMILY_PROFILE_ADMIN_TOKEN" "$ENVELOPE_FILE"
else
  echo "[1/3] --resume : reusing existing $ENVELOPE_FILE"
fi

ENTRY_COUNT=$(jq '.entries | length' "$ENVELOPE_FILE")
MONTH_START=$(jq -r '.monthStart' "$ENVELOPE_FILE")
MONTH_END=$(jq -r '.monthEnd' "$ENVELOPE_FILE")

echo "  Month: $MONTH_START → $MONTH_END"
echo "  Members to re-profile: $ENTRY_COUNT (silent months already skipped at pull)"

# --- Phase 2 : generate snapshots locally via claude --print -----------------

echo "[2/3] Re-profiling locally via 'claude --print' ($SLEEP_MIN-${SLEEP_MAX}s jittered)..."

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

  PROMPT_FILE="$BATCH_DIR/prompt-$i.txt"
  RESPONSE_FILE="$BATCH_DIR/response-$i.json"
  PARSED_FILE="$BATCH_DIR/parsed-$i.json"

  build_profile_prompt_file "$idx" "$PROMPT_FILE"

  echo "  [$i/$ENTRY_COUNT] $PSEUDO → re-profiling..."

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
    echo "  Stopping the re-profiling loop early (see reason above)."
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
  echo "[3/3] No snapshots to persist (all errored). Exit 0."
  exit 0
fi

echo "[3/3] Persisting $generated re-profiling snapshots to $APP_URL..."
if ! core_persist_results "${APP_URL}/api/admin/member-profile-batch/persist" \
                          "$FXMILY_PROFILE_ADMIN_TOKEN" "$RESULTS_FILE" \
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
