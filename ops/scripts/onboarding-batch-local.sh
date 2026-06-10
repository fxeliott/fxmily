#!/usr/bin/env bash
#
# V2.4 Phase A.2 — Onboarding interview batch local Claude Max orchestrator.
#
# Thin carbon over `ops/scripts/lib/claude-batch-core.sh` (Session 1 plan-10
# DoD#3 §28 — model/effort/flags/parsing/validations live in the core, ONE
# copy for the 4 orchestrators). Runs on Eliot's local Windows machine
# (Git Bash) using his Claude Max subscription via `claude --print` headless
# CLI. Cost marginal Anthropic = 0€.
#
# Onboarding-specific deltas (owned by THIS file — deliberate divergences) :
#   - Ephemeral workdir `$$`-suffixed + `trap rm -rf` at EXIT (interview
#     answers are richer free-text than count-only snapshots → stricter PII
#     hygiene : no artifacts survive the run).
#   - `--dry-run` exits right after the pull (before any generation).
#   - `--max-members N` cap + `--skip-sleep` (partial-cohort testing).
#   - Jittered sleep BEFORE each call (except the first) instead of after.
#   - The `userPrompt` is pre-rendered SERVER-side and travels in the envelope
#     (no local prompt assembly from snapshot + schema).
#   - Per-field JSON validation (`.summary and .highlights and
#     .axes_prioritaires`) on top of the core parse.
#   - Results entries carry `{userId, interviewId, output, model}` (stored
#     verbatim server-side for traceability — `z.string().max(80)`, the
#     persist gate does NOT enforce a slug allowlist on this pipeline).
#   - Persist failure exits 1 (historical contract ; weekly/monthly/calendar
#     exit 2).
#   - No pseudonym-regex gate : the pseudonym is display-only here (files are
#     indexed by position, never by label).
#
# Unified CONSCIOUSLY with the core (previous divergences, resolved) :
#   - `--output-format text` is now passed (it is the `--print` default —
#     explicit everywhere, zero behavior change).
#   - `--max-turns` now follows FXMILY_MAX_TURNS (same default 8, was
#     hardcoded).
#   - Sleep range now follows FXMILY_SLEEP_MIN_S/MAX_S (same default 60-120,
#     was hardcoded).
#
# Ban-risk mitigation (9 rules carbone V1.7 — enforced by the core).
#
# Required env vars :
#   FXMILY_ADMIN_TOKEN   — 32+ chars admin token (matches /etc/fxmily/web.env
#                          ADMIN_BATCH_TOKEN on Hetzner)
#   FXMILY_BASE_URL      — defaults to https://app.fxmilyapp.com ;
#                          override for local dev (http://localhost:3000)
#
# Optional :
#   --dry-run            — pull envelope, but DO NOT call claude --print +
#                          DO NOT POST persist.
#   --max-members N      — cap N entries (for partial-cohort testing)
#   --skip-sleep         — for tests only ; bypass jittered sleeps
#

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib/claude-batch-core.sh
source "$SCRIPT_DIR/lib/claude-batch-core.sh"

# ============================================================================
# Configuration
# ============================================================================

readonly BASE_URL="${FXMILY_BASE_URL:-https://app.fxmilyapp.com}"
readonly ADMIN_TOKEN="${FXMILY_ADMIN_TOKEN:-}"
readonly WORK_DIR="${TMPDIR:-/tmp}/fxmily-onboarding-batch-$$"
# Legacy env name honored (pre-core contract) ; falls back to the core default.
MAX_BUDGET_USD="${CLAUDE_MAX_BUDGET_USD:-$MAX_BUDGET_USD}"

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
  CLAUDE_MAX_BUDGET_USD default = core default (see lib/claude-batch-core.sh)
  FXMILY_CLAUDE_MODEL / FXMILY_CLAUDE_EFFORT / FXMILY_MAX_TURNS /
  FXMILY_SLEEP_MIN_S / FXMILY_SLEEP_MAX_S — shared core defaults

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

core_require_token FXMILY_ADMIN_TOKEN ADMIN_BATCH_TOKEN
if [[ ${#ADMIN_TOKEN} -lt 32 ]]; then
  echo "[FATAL] FXMILY_ADMIN_TOKEN must be at least 32 chars." >&2
  exit 1
fi
core_validate_app_url "$BASE_URL"
core_validate_model
core_validate_effort
core_validate_numeric_knobs
core_validate_sleep_range
core_sanity_checks

mkdir -p "$WORK_DIR"
trap 'rm -rf "$WORK_DIR"' EXIT
# Core artifact globals point inside the ephemeral workdir (ERRORS_LOG is
# the single shared stderr sink used by core_invoke_claude_print).
ENVELOPE_FILE="$WORK_DIR/envelope.json"
RESULTS_NDJSON="$WORK_DIR/results.ndjson"
RESULTS_FILE="$WORK_DIR/results.json"
ERRORS_LOG="$WORK_DIR/claude-errors.log"
SYSTEM_PROMPT_FILE="$WORK_DIR/system-prompt.txt"
: >"$ERRORS_LOG"

echo "[onboarding-batch] Work dir: $WORK_DIR"
echo "[onboarding-batch] Base URL: $BASE_URL"
echo "[onboarding-batch] Dry-run: $DRY_RUN"
echo "[onboarding-batch] Max members: ${MAX_MEMBERS:-(none)}"
echo "[onboarding-batch] Started: $(date -u +%Y-%m-%dT%H:%M:%SZ)"

# ============================================================================
# Step 1 — Pull envelope
# ============================================================================

echo ""
echo "[onboarding-batch] [1/4] Pulling envelope from $BASE_URL/api/admin/onboarding-batch/pull"

core_pull_envelope "$BASE_URL/api/admin/onboarding-batch/pull" \
                   "$ADMIN_TOKEN" "$ENVELOPE_FILE"

ENTRIES_COUNT=$(jq '.entries | length' "$ENVELOPE_FILE")
INSTRUMENT_VERSION=$(jq -r '.instrumentVersion' "$ENVELOPE_FILE")
RAN_AT=$(jq -r '.ranAt' "$ENVELOPE_FILE")

echo "[onboarding-batch] Pulled $ENTRIES_COUNT entries (instrument v$INSTRUMENT_VERSION, ranAt=$RAN_AT)"

if [[ "$ENTRIES_COUNT" == "0" ]]; then
  echo "[onboarding-batch] Nothing to process. Exiting cleanly."
  exit 0
fi

# Apply --max-members cap if set
if [[ "$MAX_MEMBERS" -gt 0 && "$ENTRIES_COUNT" -gt "$MAX_MEMBERS" ]]; then
  echo "[onboarding-batch] Capping to first $MAX_MEMBERS entries (--max-members)"
  jq --argjson n "$MAX_MEMBERS" '.entries |= .[:$n]' "$ENVELOPE_FILE" > "$WORK_DIR/envelope-capped.json"
  ENVELOPE_FILE="$WORK_DIR/envelope-capped.json"
  ENTRIES_COUNT="$MAX_MEMBERS"
fi

# Extract system prompt to a file (large string, passed literally by the core)
jq -r '.systemPrompt' "$ENVELOPE_FILE" > "$SYSTEM_PROMPT_FILE"

if "$DRY_RUN"; then
  echo "[onboarding-batch] --dry-run set. Skipping claude --print + persist. Envelope saved at $WORK_DIR/envelope.json"
  exit 0
fi

# ============================================================================
# Step 2 — Per-entry claude --print loop (jittered sleeps)
# ============================================================================

echo ""
echo "[onboarding-batch] [2/4] Running claude --print × $ENTRIES_COUNT ($SLEEP_MIN-${SLEEP_MAX}s jittered)"

: > "$RESULTS_NDJSON" # truncate

for i in $(seq 0 $((ENTRIES_COUNT - 1))); do
  # --argjson idx (MSYS Git Bash Windows defense — see core_build_prompt_file).
  USER_ID=$(jq -r --argjson idx "$i" '.entries[$idx].userId' "$ENVELOPE_FILE")
  INTERVIEW_ID=$(jq -r --argjson idx "$i" '.entries[$idx].interviewId' "$ENVELOPE_FILE")
  PSEUDONYM=$(jq -r --argjson idx "$i" '.entries[$idx].pseudonymLabel' "$ENVELOPE_FILE")

  PROMPT_FILE="$WORK_DIR/prompt-$i.txt"
  RESPONSE_FILE="$WORK_DIR/response-$i.json"
  PARSED_FILE="$WORK_DIR/parsed-$i.json"

  # Write pre-rendered user prompt (server-side built — onboarding delta)
  jq -r --argjson idx "$i" '.entries[$idx].userPrompt' "$ENVELOPE_FILE" > "$PROMPT_FILE"

  echo ""
  echo "[onboarding-batch] [$((i + 1))/$ENTRIES_COUNT] $PSEUDONYM (interview=$INTERVIEW_ID)"

  # Jittered sleep BEFORE the call (except for first call — onboarding delta)
  if [[ "$i" -gt 0 && "$SKIP_SLEEP" != "true" ]]; then
    core_jittered_sleep
  fi

  # Run claude --print headless (flags + pure-generator isolation → core)
  echo "[onboarding-batch] Invoking claude --print..."
  set +e
  core_invoke_claude_print "$PROMPT_FILE" "$RESPONSE_FILE"
  CLAUDE_EXIT=$?
  set -e

  if [[ "$CLAUDE_EXIT" -ne 0 ]]; then
    echo "[onboarding-batch] claude --print exit $CLAUDE_EXIT"
    tail -5 "$ERRORS_LOG" >&2 || true
    jq -n --arg uid "$USER_ID" --arg iid "$INTERVIEW_ID" --argjson exit "$CLAUDE_EXIT" \
      '{userId: $uid, interviewId: $iid, error: ("claude_exit_" + ($exit | tostring))}' \
      >> "$RESULTS_NDJSON"
    continue
  fi

  # Core parse (fence-strip + JSON validity) + onboarding per-field validation
  if ! core_parse_response "$RESPONSE_FILE" "$PARSED_FILE" \
     || ! jq -e '.summary and .highlights and .axes_prioritaires' "$PARSED_FILE" >/dev/null 2>&1; then
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
    --slurpfile output "$PARSED_FILE" \
    --arg model "$CLAUDE_MODEL" \
    '{userId: $uid, interviewId: $iid, output: $output[0], model: $model}' \
    >> "$RESULTS_NDJSON"

  echo "[onboarding-batch] Captured response for $PSEUDONYM"
done

# ============================================================================
# Step 3 — Aggregate results
# ============================================================================

echo ""
echo "[onboarding-batch] [3/4] Aggregating results into single payload"

jq -s '{results: .}' "$RESULTS_NDJSON" > "$RESULTS_FILE"

PAYLOAD_BYTES=$(wc -c < "$RESULTS_FILE")
echo "[onboarding-batch] Payload: $PAYLOAD_BYTES bytes / $(jq '.results | length' "$RESULTS_FILE") entries"

# ============================================================================
# Step 4 — POST persist
# ============================================================================

echo ""
echo "[onboarding-batch] [4/4] POSTing $BASE_URL/api/admin/onboarding-batch/persist"

PERSIST_RESP_FILE="$WORK_DIR/persist-resp.json"
if ! core_persist_results "$BASE_URL/api/admin/onboarding-batch/persist" \
                          "$ADMIN_TOKEN" "$RESULTS_FILE" "$PERSIST_RESP_FILE" >/dev/null; then
  echo "[FATAL] Persist failed." >&2
  cat "$PERSIST_RESP_FILE" >&2 || true
  exit 1
fi

echo ""
echo "[onboarding-batch] ============================================"
echo "[onboarding-batch] Summary:"
jq '.' "$PERSIST_RESP_FILE"
echo "[onboarding-batch] ============================================"
echo "[onboarding-batch] Finished: $(date -u +%Y-%m-%dT%H:%M:%SZ)"
