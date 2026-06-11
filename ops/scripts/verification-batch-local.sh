#!/usr/bin/env bash
#
# S3 §33.4 — MT5-proof VISION batch local orchestrator (5th pipeline).
#
# Thin carbon over `ops/scripts/lib/claude-batch-core.sh` (model/effort/flags/
# parsing/validations live in the core). Runs on Eliot's local Windows machine
# (Git Bash) using his Claude Max subscription via `claude --print` headless.
# Cost marginal Anthropic = 0€.
#
# Vision-specific deltas (owned by THIS file — deliberate divergences) :
#   - Per-entry the proof IMAGE is downloaded first (token-gated GET
#     /api/admin/verification-batch/proof-image?proofId=…) into the ephemeral
#     workdir, then `claude --print` reads it via `--allowedTools Read`
#     (CLAUDE_ALLOWED_TOOLS=Read → core appends the flag; the 4 text
#     pipelines stay byte-identical).
#   - The user prompt is built locally from the envelope's
#     `userPromptTemplate` (`__IMAGE_PATH__` → the downloaded file path —
#     the server cannot know the operator's temp dir).
#   - A model reply of `{"error":"not_mt5_history"}` is captured as a wire
#     error entry (the persist flips the proof to `failed`); any claude/parse
#     error stays `pending` server-side (retryable next run).
#   - Ephemeral workdir `$$` + `trap rm -rf` at EXIT (proof images are
#     member data → nothing survives the run on Eliot's disk).
#   - `--dry-run` exits right after the pull; `--max-proofs N` caps;
#     `--skip-sleep` for tests only.
#
# Required env vars :
#   FXMILY_VERIFICATION_ADMIN_BATCH_TOKEN — 32+ chars (matches Hetzner
#       /etc/fxmily/web.env VERIFICATION_ADMIN_BATCH_TOKEN)
#   FXMILY_BASE_URL — defaults to https://app.fxmilyapp.com
#

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib/claude-batch-core.sh
source "$SCRIPT_DIR/lib/claude-batch-core.sh"

# ============================================================================
# Configuration
# ============================================================================

readonly BASE_URL="${FXMILY_BASE_URL:-https://app.fxmilyapp.com}"
readonly ADMIN_TOKEN="${FXMILY_VERIFICATION_ADMIN_BATCH_TOKEN:-}"
readonly WORK_DIR="${TMPDIR:-/tmp}/fxmily-verification-batch-$$"

# Vision needs the Read tool — opt-in core flag (empty default elsewhere).
CLAUDE_ALLOWED_TOOLS="${FXMILY_CLAUDE_ALLOWED_TOOLS:-Read}"

DRY_RUN=false
MAX_PROOFS=0 # 0 = no cap
SKIP_SLEEP=false

while [[ $# -gt 0 ]]; do
  case "$1" in
    --dry-run) DRY_RUN=true; shift ;;
    --max-proofs)
      if ! [[ "${2:-}" =~ ^[0-9]+$ ]]; then
        echo "ERROR: --max-proofs expects a non-negative integer, got '${2:-}'." >&2
        exit 1
      fi
      MAX_PROOFS="$2"; shift 2 ;;
    --skip-sleep) SKIP_SLEEP=true; shift ;;
    --help|-h)
      cat <<EOF
Usage: $0 [--dry-run] [--max-proofs N] [--skip-sleep]

Environment variables :
  FXMILY_VERIFICATION_ADMIN_BATCH_TOKEN  32+ chars admin token (required)
  FXMILY_BASE_URL                        default https://app.fxmilyapp.com
  FXMILY_CLAUDE_MODEL / FXMILY_CLAUDE_EFFORT / FXMILY_MAX_TURNS /
  FXMILY_SLEEP_MIN_S / FXMILY_SLEEP_MAX_S — shared core defaults

Options :
  --dry-run       pull only, do not download images / call claude / persist
  --max-proofs N  cap processing to N proofs (testing)
  --skip-sleep    bypass jittered sleeps (tests only — ban risk!)
EOF
      exit 0
      ;;
    *) echo "[ERROR] Unknown arg: $1" >&2; exit 1 ;;
  esac
done

# ============================================================================
# Pre-flight checks
# ============================================================================

core_require_token FXMILY_VERIFICATION_ADMIN_BATCH_TOKEN VERIFICATION_ADMIN_BATCH_TOKEN
if [[ ${#ADMIN_TOKEN} -lt 32 ]]; then
  echo "[FATAL] FXMILY_VERIFICATION_ADMIN_BATCH_TOKEN must be at least 32 chars." >&2
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
ENVELOPE_FILE="$WORK_DIR/envelope.json"
RESULTS_NDJSON="$WORK_DIR/results.ndjson"
RESULTS_FILE="$WORK_DIR/results.json"
ERRORS_LOG="$WORK_DIR/claude-errors.log"
SYSTEM_PROMPT_FILE="$WORK_DIR/system-prompt.txt"
: >"$ERRORS_LOG"

echo "[verification-batch] Work dir: $WORK_DIR"
echo "[verification-batch] Base URL: $BASE_URL"
echo "[verification-batch] Dry-run: $DRY_RUN"
echo "[verification-batch] Allowed tools: $CLAUDE_ALLOWED_TOOLS"
echo "[verification-batch] Started: $(date -u +%Y-%m-%dT%H:%M:%SZ)"

# ============================================================================
# Step 1 — Pull envelope (metadata only — images download per entry)
# ============================================================================

echo ""
echo "[verification-batch] [1/4] Pulling envelope from $BASE_URL/api/admin/verification-batch/pull"

core_pull_envelope "$BASE_URL/api/admin/verification-batch/pull" \
                   "$ADMIN_TOKEN" "$ENVELOPE_FILE"

ENTRIES_COUNT=$(jq '.entries | length' "$ENVELOPE_FILE")
RAN_AT=$(jq -r '.ranAt' "$ENVELOPE_FILE")
USER_PROMPT_TEMPLATE=$(jq -r '.userPromptTemplate' "$ENVELOPE_FILE")

echo "[verification-batch] Pulled $ENTRIES_COUNT pending proof(s) (ranAt=$RAN_AT)"

if [[ "$ENTRIES_COUNT" == "0" ]]; then
  echo "[verification-batch] Nothing to analyse. Exiting cleanly."
  exit 0
fi

if [[ "$MAX_PROOFS" -gt 0 && "$ENTRIES_COUNT" -gt "$MAX_PROOFS" ]]; then
  echo "[verification-batch] Capping to first $MAX_PROOFS proofs (--max-proofs)"
  jq --argjson n "$MAX_PROOFS" '.entries |= .[:$n]' "$ENVELOPE_FILE" > "$WORK_DIR/envelope-capped.json"
  ENVELOPE_FILE="$WORK_DIR/envelope-capped.json"
  ENTRIES_COUNT="$MAX_PROOFS"
fi

jq -r '.systemPrompt' "$ENVELOPE_FILE" > "$SYSTEM_PROMPT_FILE"

if "$DRY_RUN"; then
  echo "[verification-batch] --dry-run set. Skipping downloads + claude + persist."
  exit 0
fi

# ============================================================================
# Step 2 — Per-proof loop : download image → claude --print (vision) → parse
# ============================================================================

echo ""
echo "[verification-batch] [2/4] Analysing $ENTRIES_COUNT proof(s) ($SLEEP_MIN-${SLEEP_MAX}s jittered)"

: > "$RESULTS_NDJSON"

for i in $(seq 0 $((ENTRIES_COUNT - 1))); do
  PROOF_ID=$(jq -r --argjson idx "$i" '.entries[$idx].proofId' "$ENVELOPE_FILE")
  USER_ID=$(jq -r --argjson idx "$i" '.entries[$idx].userId' "$ENVELOPE_FILE")
  PSEUDONYM=$(jq -r --argjson idx "$i" '.entries[$idx].pseudonymLabel' "$ENVELOPE_FILE")
  FILE_EXT=$(jq -r --argjson idx "$i" '.entries[$idx].fileExt' "$ENVELOPE_FILE")

  if ! core_validate_user_id "$USER_ID"; then
    echo "[verification-batch] SKIP malformed userId for proof $PROOF_ID" >&2
    continue
  fi
  # The Read tool detects images by EXTENSION — the temp file MUST carry the
  # real one (runtime finding 2026-06-11: a `.img` suffix made the model see
  # garbage → "not_mt5_history" on perfectly valid screenshots).
  case "$FILE_EXT" in
    jpg|png|webp) ;;
    *) FILE_EXT="png" ;;
  esac

  IMAGE_FILE="$WORK_DIR/proof-$i.$FILE_EXT"
  PROMPT_FILE="$WORK_DIR/prompt-$i.txt"
  RESPONSE_FILE="$WORK_DIR/response-$i.json"
  PARSED_FILE="$WORK_DIR/parsed-$i.json"

  echo ""
  echo "[verification-batch] [$((i + 1))/$ENTRIES_COUNT] $PSEUDONYM (proof=$PROOF_ID)"

  # Download the proof image (token-gated GET, bounded one-image memory).
  if ! curl --fail --silent --show-error --max-time 60 \
            -H "X-Admin-Token: ${ADMIN_TOKEN}" \
            "$BASE_URL/api/admin/verification-batch/proof-image?proofId=${PROOF_ID}" \
            -o "$IMAGE_FILE"; then
    echo "[verification-batch] image download failed for $PROOF_ID" >&2
    jq -nc --arg pid "$PROOF_ID" --arg uid "$USER_ID" \
      '{proofId: $pid, userId: $uid, error: "image_download_failed"}' >> "$RESULTS_NDJSON"
    continue
  fi

  # Build the per-proof prompt from the server template (the image path is
  # local-only knowledge). Windows Git Bash: hand claude a Windows-style path
  # (the CLI runs as a Windows binary; /tmp/... is MSYS-only).
  IMAGE_PATH_FOR_CLAUDE="$IMAGE_FILE"
  if command -v cygpath >/dev/null 2>&1; then
    IMAGE_PATH_FOR_CLAUDE="$(cygpath -w "$IMAGE_FILE")"
  fi
  printf '%s\n' "${USER_PROMPT_TEMPLATE//__IMAGE_PATH__/$IMAGE_PATH_FOR_CLAUDE}" > "$PROMPT_FILE"

  if [[ "$i" -gt 0 && "$SKIP_SLEEP" != "true" ]]; then
    core_jittered_sleep
  fi

  echo "[verification-batch] Invoking claude --print (vision)..."
  set +e
  core_invoke_claude_print "$PROMPT_FILE" "$RESPONSE_FILE"
  CLAUDE_EXIT=$?
  set -e

  # The image is member data — scrub it as soon as the call returns.
  rm -f "$IMAGE_FILE"

  if [[ "$CLAUDE_EXIT" -ne 0 ]]; then
    echo "[verification-batch] claude --print exit $CLAUDE_EXIT"
    tail -5 "$ERRORS_LOG" >&2 || true
    jq -nc --arg pid "$PROOF_ID" --arg uid "$USER_ID" --argjson exit "$CLAUDE_EXIT" \
      '{proofId: $pid, userId: $uid, error: ("claude_exit_" + ($exit | tostring))}' >> "$RESULTS_NDJSON"
    continue
  fi

  if ! core_parse_response "$RESPONSE_FILE" "$PARSED_FILE"; then
    echo "[verification-batch] Invalid JSON response from claude"
    jq -nc --arg pid "$PROOF_ID" --arg uid "$USER_ID" \
      '{proofId: $pid, userId: $uid, error: "invalid_json_response"}' >> "$RESULTS_NDJSON"
    continue
  fi

  # Model-declared "not an MT5 history" → wire error (persist flips to failed).
  if jq -e '.error == "not_mt5_history"' "$PARSED_FILE" >/dev/null 2>&1; then
    echo "[verification-batch] Model verdict: not an MT5 history"
    jq -nc --arg pid "$PROOF_ID" --arg uid "$USER_ID" \
      '{proofId: $pid, userId: $uid, error: "not_mt5_history"}' >> "$RESULTS_NDJSON"
    continue
  fi

  # Per-field presence check + deterministic projection onto the expected
  # top-level keys (model-proof: a volunteered extra key would fail the
  # server-side Zod .strict() — mirror of the onboarding S2 runtime fix).
  if ! jq -e '.account and .positions and (.confidence != null)' "$PARSED_FILE" >/dev/null 2>&1; then
    echo "[verification-batch] Response misses required keys"
    jq -nc --arg pid "$PROOF_ID" --arg uid "$USER_ID" \
      '{proofId: $pid, userId: $uid, error: "invalid_json_response"}' >> "$RESULTS_NDJSON"
    continue
  fi

  jq -nc \
    --arg pid "$PROOF_ID" \
    --arg uid "$USER_ID" \
    --slurpfile output "$PARSED_FILE" \
    --arg model "$CLAUDE_MODEL" \
    '{proofId: $pid, userId: $uid, output: ($output[0] | {account, positions, confidence}), model: $model}' \
    >> "$RESULTS_NDJSON"

  echo "[verification-batch] Captured extraction for $PSEUDONYM"
done

# ============================================================================
# Step 3 — Aggregate results
# ============================================================================

echo ""
echo "[verification-batch] [3/4] Aggregating results"

jq -s '{results: .}' "$RESULTS_NDJSON" > "$RESULTS_FILE"
echo "[verification-batch] Payload: $(wc -c < "$RESULTS_FILE") bytes / $(jq '.results | length' "$RESULTS_FILE") entries"

# ============================================================================
# Step 4 — POST persist
# ============================================================================

echo ""
echo "[verification-batch] [4/4] POSTing $BASE_URL/api/admin/verification-batch/persist"

PERSIST_RESP_FILE="$WORK_DIR/persist-resp.json"
if ! core_persist_results "$BASE_URL/api/admin/verification-batch/persist" \
                          "$ADMIN_TOKEN" "$RESULTS_FILE" "$PERSIST_RESP_FILE" >/dev/null; then
  echo "[FATAL] Persist failed." >&2
  cat "$PERSIST_RESP_FILE" >&2 || true
  exit 1
fi

echo ""
echo "[verification-batch] ============================================"
echo "[verification-batch] Summary:"
jq '.' "$PERSIST_RESP_FILE"
echo "[verification-batch] ============================================"
echo "[verification-batch] Finished: $(date -u +%Y-%m-%dT%H:%M:%SZ)"
