#!/usr/bin/env bash
#
# §26 calendar batch — local orchestrator (Eliot's Max-subscription path, J-C2).
#
# Pulls weekly-schedule snapshots from prod via HTTP, generates an adaptive
# calendar locally per member via `claude --print` (Eliot's Claude Max
# subscription, $0 marginal), pushes results back via HTTP. EXACT carbon of
# `ops/scripts/weekly-batch-local.sh` / `monthly-batch-local.sh`, swapped to
# the calendar endpoints + the separate calendar token.
#
# Ban-risk mitigation rules (9, unchanged from weekly/monthly) :
#   - Runs FROM Eliot's machine (his IP, his fingerprint, his Max account)
#   - Spreads `claude --print` invocations across 60–120 s jittered sleeps
#   - One invocation per member = fresh context per generation (single-shot,
#     bounded by --max-turns + --max-budget-usd)
#   - Snapshots are already pseudonymized (no PII reaches Anthropic)
#   - System prompt + JSON schema travel WITH the envelope (no on-device tamper)
#   - No third-party wrappers — only the official `claude` binary
#   - Human-in-the-loop : Eliot triggers manually, can vary day/time
#   - Members WITHOUT a questionnaire this week are skipped (0 token) — the
#     loader already filters them, this is the defensive second net
#   - Audit row `calendar.batch.{pulled,persisted}` recorded in prod DB
#
# Usage :
#   bash ops/scripts/calendar-batch-local.sh            # current Paris week (default)
#   bash ops/scripts/calendar-batch-local.sh --dry-run  # pull + generate only, do not persist
#   bash ops/scripts/calendar-batch-local.sh --resume   # reuse /tmp/fxmily-calendar-batch/*.json (skip pull)
#
# Required env :
#   FXMILY_CALENDAR_TOKEN   32+ char admin token (sync with prod CALENDAR_ADMIN_BATCH_TOKEN)
#
# Optional env :
#   FXMILY_APP_URL          default 'https://app.fxmilyapp.com' (must be HTTPS in prod)
#   FXMILY_CLAUDE_MODEL     default 'claude-opus-4-8' (§8 — Opus 4.8 for calendar generation)
#   FXMILY_CLAUDE_EFFORT    default 'xhigh' (§8 ; low|medium|high|xhigh|max)
#   FXMILY_CALENDAR_BATCH_DIR  default '/tmp/fxmily-calendar-batch' (workdir)
#   FXMILY_SLEEP_MIN_S      default 60 (floor 30 — ban-risk mitigation)
#   FXMILY_SLEEP_MAX_S      default 120
#   FXMILY_MAX_TURNS        default 8 (≥2 ; Opus 4.8 thinking uses a turn before the JSON)
#
# Exit codes :
#   0 = batch completed (some entries may have errored ; check report)
#   1 = fatal error (curl, claude unavailable, missing env, etc.)
#   2 = persist step rejected the batch (0 calendars written)

set -euo pipefail

# --- Config (env-overridable with strict validation) ------------------------
APP_URL="${FXMILY_APP_URL:-https://app.fxmilyapp.com}"
BATCH_DIR="${FXMILY_CALENDAR_BATCH_DIR:-/tmp/fxmily-calendar-batch}"
SLEEP_MIN="${FXMILY_SLEEP_MIN_S:-60}"
SLEEP_MAX="${FXMILY_SLEEP_MAX_S:-120}"
# Opus 4.8 at high/xhigh effort emits an extended-thinking pass that consumes a
# turn BEFORE the JSON answer, so `--max-turns 1` aborts with "Reached max turns
# (1)" (confirmed by real end-to-end generation, 2026-06-04). 8 = ample headroom
# for think+answer while staying bounded; `--max-budget-usd` below is the real
# runaway circuit-breaker. NOT 1.
MAX_TURNS="${FXMILY_MAX_TURNS:-8}"
# §8 — local Claude solicitations run on Opus 4.8 at "extra" effort by default.
CLAUDE_MODEL="${FXMILY_CLAUDE_MODEL:-claude-opus-4-8}"
CLAUDE_EFFORT="${FXMILY_CLAUDE_EFFORT:-xhigh}"
MODEL_FLAG=""
EFFORT_FLAG=""

# Required token. Refuse to run without it (refuse-by-default mirrors the
# server-side 503).
if [ -z "${FXMILY_CALENDAR_TOKEN:-}" ]; then
  echo "ERROR: FXMILY_CALENDAR_TOKEN env not set." >&2
  echo "  Generate via 'openssl rand -hex 32' and provision on Hetzner :" >&2
  echo "    echo 'CALENDAR_ADMIN_BATCH_TOKEN=<value>' >> /etc/fxmily/web.env" >&2
  echo "    cd /opt/fxmily && docker compose -f docker-compose.prod.yml restart web" >&2
  echo "  Then export FXMILY_CALENDAR_TOKEN=<same value> in your local shell." >&2
  exit 1
fi

# Minimal URL sanity. No http:// in prod (token would travel plaintext).
# Localhost http allowed for local dev / docker-compose dev stack.
case "$APP_URL" in
  https://*) ;;
  http://localhost:*|http://127.0.0.1:*) ;;
  *)
    echo "ERROR: FXMILY_APP_URL=$APP_URL must be HTTPS (or http://localhost:* for dev)." >&2
    exit 1
    ;;
esac

# Allowlist of acceptable Claude model slugs for `claude --model`. Opus 4.8 is
# the §8 default; older slugs kept for back-compat / cost-tiering.
case "$CLAUDE_MODEL" in
  claude-opus-4-8|claude-opus-4-7|claude-sonnet-4-6|claude-haiku-4-5) ;;
  *)
    echo "ERROR: FXMILY_CLAUDE_MODEL=$CLAUDE_MODEL not in allowlist." >&2
    echo "  Allowed: claude-opus-4-8, claude-opus-4-7, claude-sonnet-4-6, claude-haiku-4-5" >&2
    exit 1
    ;;
esac
MODEL_FLAG="--model ${CLAUDE_MODEL}"

# §8 — effort level for `claude --print` (low|medium|high|xhigh|max).
case "$CLAUDE_EFFORT" in
  low|medium|high|xhigh|max) ;;
  *)
    echo "ERROR: FXMILY_CLAUDE_EFFORT=$CLAUDE_EFFORT invalid (low|medium|high|xhigh|max)." >&2
    exit 1
    ;;
esac
EFFORT_FLAG="--effort ${CLAUDE_EFFORT}"

# Sleep range validation + floor 30s (div-by-zero / inverted range guard).
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
RESULTS_NDJSON="$BATCH_DIR/results.ndjson"  # Append-only NDJSON for atomic writes
RESULTS_FILE="$BATCH_DIR/results.json"
ERRORS_LOG="$BATCH_DIR/claude-errors.log"

# Truncate the errors log at each run + scrub artifacts >7 days (PII hygiene).
: >"$ERRORS_LOG"
find "$BATCH_DIR" -type f -mtime +7 -delete 2>/dev/null || true

# --- Phase 1 : pull snapshots from prod via HTTP -----------------------------

if [ "$RESUME" = "false" ] || [ ! -s "$ENVELOPE_FILE" ]; then
  echo "[1/3] Pulling snapshots from $APP_URL..."
  PULL_URL="${APP_URL}/api/admin/calendar-batch/pull"
  if ! curl --fail-with-body --silent --show-error \
            --max-time 90 \
            -X POST \
            -H "X-Admin-Token: ${FXMILY_CALENDAR_TOKEN}" \
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
WEEK_START=$(jq -r '.weekStart' "$ENVELOPE_FILE")

echo "  Week: $WEEK_START (Europe/Paris)"
echo "  Members with a questionnaire this week: $ENTRY_COUNT"

# --- Phase 2 : generate calendars locally via claude --print -----------------

echo "[2/3] Generating calendars locally via 'claude --print' ($SLEEP_MIN-${SLEEP_MAX}s jittered)..."

# Pull the system prompt + JSON schema out of the envelope ONCE.
SYSTEM_PROMPT_FILE="$BATCH_DIR/system-prompt.txt"
SCHEMA_FILE="$BATCH_DIR/output-schema.json"
jq -r '.systemPrompt' "$ENVELOPE_FILE" >"$SYSTEM_PROMPT_FILE"
jq '.outputJsonSchema' "$ENVELOPE_FILE" >"$SCHEMA_FILE"

# Append-only NDJSON instead of rewriting results.json each member. Atomic
# per-line append = survives Ctrl-C. Assembled into final JSON via `jq -s`.
: >"$RESULTS_NDJSON"

i=0
generated=0
errored=0
skipped_no_questionnaire=0

ENTRY_INDICES=$(jq '.entries | keys[]' "$ENVELOPE_FILE")
for idx in $ENTRY_INDICES; do
  i=$((i + 1))
  # --argjson + single quotes (Windows Git Bash MSYS-safe, no string-mangling).
  USER_ID=$(jq -r --argjson idx "$idx" '.entries[$idx].userId' "$ENVELOPE_FILE")
  PSEUDO=$(jq -r --argjson idx "$idx" '.entries[$idx].pseudonymLabel' "$ENVELOPE_FILE")
  HAS_QUESTIONNAIRE=$(jq -r --argjson idx "$idx" '.entries[$idx].hasQuestionnaire' "$ENVELOPE_FILE")

  # Validate the pseudonymLabel as `member-[A-F0-9]{6,8}` before interpolating
  # it into any path (shell-injection prevention via the pseudonym contract).
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

  {
    echo "Tu dois construire le calendrier hebdomadaire personnel d'un membre Fxmily."
    echo ""
    echo "Voici le snapshot pseudonymisé (compteurs d'activité + disponibilité déclarée) :"
    echo ""
    jq --argjson idx "$idx" '.entries[$idx].snapshot' "$ENVELOPE_FILE"
    echo ""
    echo "Réponds STRICTEMENT avec un JSON conforme à ce schéma (pas de markdown,"
    echo "pas de fence, pas de prose hors JSON) :"
    echo ""
    cat "$SCHEMA_FILE"
  } >"$PROMPT_FILE"

  echo "  [$i/$ENTRY_COUNT] $PSEUDO → generating..."

  # printf-style literal arg via $(<file) so $variables / $() inside the system
  # prompt are NOT shell-expanded. The file content is a literal argument.
  set +e
  SYSTEM_PROMPT_CONTENT=$(<"$SYSTEM_PROMPT_FILE")
  # PURE-GENERATOR ISOLATION (real e2e validated 2026-06-04) — three flags make
  # `claude --print` a deterministic JSON generator instead of an interactive
  # coding agent:
  #   --system-prompt (REPLACE, not --append) : the calendar prompt becomes the
  #     ENTIRE system prompt, dropping the default coding-agent framing.
  #   --setting-sources "" : load NO user/project/local settings → the operator's
  #     own ~/.claude/CLAUDE.md + hooks (self-checklist, tracker, …) are NOT
  #     injected. WITHOUT this the model returns conversational prose ("tracker
  #     cleared… self-checklist…") with the JSON buried, breaking the parse.
  #   --max-turns 8 (see MAX_TURNS) : Opus 4.8 thinking uses a turn before the JSON.
  # `--bare` is NOT used (breaks OAuth Max keychain auth — weekly R4).
  # `--max-budget-usd 5.00` = financial circuit-breaker if the binary ever
  # silently switches to billable API.
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
    # Strip leading/trailing markdown fences + whitespace.
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

echo "  Generated: $generated, errored: $errored, skipped (no questionnaire): $skipped_no_questionnaire"

# Assemble final results.json from the append-only NDJSON (single atomic write).
# Calendar persist request = { weekStart, results } — NO weekEnd column.
jq -s --arg ws "$WEEK_START" \
   '{weekStart: $ws, results: .}' \
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
PERSIST_URL="${APP_URL}/api/admin/calendar-batch/persist"
if ! curl --fail-with-body --silent --show-error \
          --max-time 60 \
          -X POST \
          -H "X-Admin-Token: ${FXMILY_CALENDAR_TOKEN}" \
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
