#!/usr/bin/env bash
#
# claude-batch-core.sh — shared core of the 4 local Claude batch orchestrators
# (weekly / monthly / calendar / onboarding). Session 1 (Fondations, plan-10)
# DoD#3 §28 : « service central réutilisable » — this file is the ONE place
# that knows :
#   - the Claude model default + allowlist (§8)
#   - the effort allowlist
#   - the exact `claude --print` invocation flags
#   - the response parsing (fence-strip + jq validation)
#   - the shared validations (token, URL, sleep range, pseudonym, userId)
#   - the NDJSON append + jittered-sleep + pull/persist HTTP plumbing
#
# Each orchestrator stays a thin carbon : endpoints, token env name, workdir,
# pseudonym regex (deliberate per-pipeline contracts), skip predicate, prompt
# header and envelope shape live in the per-script file.
#
# Ban-risk mitigation rules (9, unchanged — see weekly-batch-local.sh header
# for the full rationale) are PRESERVED here by construction :
#   - jittered sleeps with floor 30s (core_validate_sleep_range + core_jittered_sleep)
#   - one `claude --print` invocation per member, NO parallelisation
#   - official `claude` binary only (core_sanity_checks)
#   - `--bare` is FORBIDDEN (breaks OAuth Max keychain auth — weekly R4
#     empirical fix, 2026-05). Never add it back.
#   - human-in-the-loop : the orchestrators are run manually by Eliot
#
# Sourcing contract :
#   SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
#   source "$SCRIPT_DIR/lib/claude-batch-core.sh"
# The core only defines variables + functions — it performs NO side effects
# at source time beyond computing config defaults from env.

# --- Shared config defaults (env-overridable, validated below) ---------------

# §8 — local Claude solicitations run at "extra" effort by default. Both are
# env-overridable but default to the strongest persistable config.
CLAUDE_MODEL="${FXMILY_CLAUDE_MODEL:-claude-opus-4-8}"
CLAUDE_EFFORT="${FXMILY_CLAUDE_EFFORT:-xhigh}"

# ≥2 required: extended thinking uses a turn before the JSON, so
# `--max-turns 1` aborts with "Reached max turns (1)" (validated via the §26
# calendar batch real e2e, 2026-06-04). `--max-budget-usd` is the runaway
# circuit-breaker. NOT 1.
MAX_TURNS="${FXMILY_MAX_TURNS:-8}"

# §8 — financial circuit-breaker per `claude --print` call. On Max sub the
# marginal cost is theoretical ($0 actual), but if Anthropic ever switches the
# binary to billable API this caps damage per call.
MAX_BUDGET_USD="${FXMILY_MAX_BUDGET_USD:-5.00}"

SLEEP_MIN="${FXMILY_SLEEP_MIN_S:-60}"
SLEEP_MAX="${FXMILY_SLEEP_MAX_S:-120}"

# --- Validations --------------------------------------------------------------

# Allowlist of acceptable Claude model slugs for `claude --model` — THE single
# copy (was duplicated 4× across the orchestrators). Verified against
# `claude --help` full names like 'claude-opus-4-8'.
core_validate_model() {
  case "$CLAUDE_MODEL" in
    claude-opus-4-8|claude-opus-4-7|claude-sonnet-4-6|claude-haiku-4-5) ;;
    *)
      echo "ERROR: FXMILY_CLAUDE_MODEL=$CLAUDE_MODEL not in allowlist." >&2
      echo "  Allowed: claude-opus-4-8, claude-opus-4-7, claude-sonnet-4-6, claude-haiku-4-5" >&2
      exit 1
      ;;
  esac
}

# §8 — effort level for `claude --print` (low|medium|high|xhigh|max).
# Default 'xhigh' = deepest *persistable* reasoning ("en extra"). 'max' is NOT
# the default — prone to overthinking on a single-shot generation.
core_validate_effort() {
  case "$CLAUDE_EFFORT" in
    low|medium|high|xhigh|max) ;;
    *)
      echo "ERROR: FXMILY_CLAUDE_EFFORT=$CLAUDE_EFFORT invalid (low|medium|high|xhigh|max)." >&2
      exit 1
      ;;
  esac
}

# Refuse-by-default token check (mirrors the server-side 503).
# $1 = env var NAME (e.g. FXMILY_ADMIN_TOKEN), $2 = prod web.env key for the hint.
core_require_token() {
  local var_name="$1" prod_key="$2"
  if [ -z "${!var_name:-}" ]; then
    echo "ERROR: $var_name env not set." >&2
    echo "  Generate via 'openssl rand -hex 32' and provision on Hetzner :" >&2
    echo "    echo '$prod_key=<value>' >> /etc/fxmily/web.env" >&2
    echo "    cd /opt/fxmily && docker compose -f docker-compose.prod.yml restart web" >&2
    echo "  Then export $var_name=<same value> in your local shell." >&2
    exit 1
  fi
}

# Minimal URL sanity. No http:// in prod (token would travel plaintext).
# Localhost http allowed for local dev / docker-compose dev stack.
core_validate_app_url() {
  local url="$1"
  case "$url" in
    https://*) ;;
    http://localhost:*|http://127.0.0.1:*) ;;
    *)
      echo "ERROR: app URL '$url' must be HTTPS (or http://localhost:* for dev)." >&2
      exit 1
      ;;
  esac
}

# Sleep range validation + floor 30s. Without this, RANDOM % 0 div-by-zero or
# negative modulo on inverted ranges silently breaks mid-batch (V1.7 fix).
core_validate_sleep_range() {
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
}

# claude / jq / curl presence + official-binary check + version log. The
# version log is a diagnostic for breaking CLI changes (we've already had two —
# banned wrappers Apr 2026 + `--bare` OAuth incompat caught in R4).
core_sanity_checks() {
  command -v claude >/dev/null 2>&1 || {
    echo "ERROR: 'claude' CLI not found in PATH." >&2
    echo "  Install Claude Code from https://claude.com/code" >&2
    exit 1
  }
  # Official Anthropic binary only (ban-risk rule #6 — no third-party wrappers).
  if ! claude --version 2>&1 | grep -qi "claude"; then
    echo "ERROR: 'claude' binary does not look like the official Anthropic CLI." >&2
    exit 1
  fi
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
}

# Pseudonym validation BEFORE interpolating into any path (shell-injection
# prevention via the pseudonymizeMember output contract). The regex is a
# per-pipeline contract passed by the caller :
#   weekly     '^member-[A-Fa-f0-9]{6,8}$'  (legacy V1.5 6-char accommodated)
#   monthly    '^member-[A-F0-9]{8}$'       (J-M1 locked contract, T2-1)
#   calendar   '^member-[A-Fa-f0-9]{6,8}$'
core_validate_pseudonym() {
  local pseudo="$1" regex="$2"
  [[ "$pseudo" =~ $regex ]]
}

# userId validation (cuid-safe alnum + _-), identical across pipelines.
core_validate_user_id() {
  local user_id="$1"
  [[ "$user_id" =~ ^[A-Za-z0-9_-]{1,128}$ ]]
}

# --- Workdir ------------------------------------------------------------------

# Sets the shared artifact globals + truncates the errors log + scrubs
# artifacts >7 days (PII hygiene — past Claude errors must not accumulate
# indefinitely on Eliot's disk). $1 = batch workdir.
core_init_workdir() {
  local dir="$1"
  mkdir -p "$dir"
  ENVELOPE_FILE="$dir/envelope.json"
  RESULTS_NDJSON="$dir/results.ndjson" # Append-only NDJSON for atomic writes
  RESULTS_FILE="$dir/results.json"
  ERRORS_LOG="$dir/claude-errors.log"
  SYSTEM_PROMPT_FILE="$dir/system-prompt.txt"
  SCHEMA_FILE="$dir/output-schema.json"
  : >"$ERRORS_LOG"
  find "$dir" -type f -mtime +7 -delete 2>/dev/null || true
}

# --- HTTP plumbing --------------------------------------------------------------

# Pull the snapshot envelope from prod. $1 = pull URL, $2 = token value,
# $3 = output file. `--fail-with-body` exits non-zero on HTTP 4xx/5xx but
# still streams the body so the server's JSON error is visible.
core_pull_envelope() {
  local url="$1" token="$2" out="$3"
  if ! curl --fail-with-body --silent --show-error \
            --max-time 90 \
            -X POST \
            -H "X-Admin-Token: ${token}" \
            -H "Accept: application/json" \
            "$url" \
            >"$out"; then
    echo "ERROR: pull request failed. See $out for server response." >&2
    cat "$out" >&2 || true
    exit 1
  fi
  local bytes
  bytes=$(wc -c <"$out")
  if [ "$bytes" -lt 32 ]; then
    echo "ERROR: pull returned <32 bytes ($bytes). See $out" >&2
    exit 1
  fi
  echo "  ✓ Wrote envelope to $out ($bytes bytes)"
}

# Extract the system prompt + output JSON schema out of the envelope ONCE.
core_extract_prompt_and_schema() {
  jq -r '.systemPrompt' "$ENVELOPE_FILE" >"$SYSTEM_PROMPT_FILE"
  jq '.outputJsonSchema' "$ENVELOPE_FILE" >"$SCHEMA_FILE"
}

# Persist the assembled results to prod. $1 = persist URL, $2 = token value,
# $3 = results file, $4 = server-response output file. Returns curl's status —
# the caller decides the exit code (weekly/monthly/calendar exit 2, onboarding
# exits 1 — historical contracts preserved).
core_persist_results() {
  local url="$1" token="$2" results="$3" out="$4"
  curl --fail-with-body --silent --show-error \
       --max-time 120 \
       -X POST \
       -H "X-Admin-Token: ${token}" \
       -H "Content-Type: application/json" \
       -H "Accept: application/json" \
       --data-binary "@${results}" \
       "$url" \
       | tee "$out"
}

# --- Prompt build + Claude invocation + parsing --------------------------------

# Build the per-member prompt file. $1 = FR task header line, $2 = FR snapshot
# intro line, $3 = jq entry index, $4 = output prompt file. Uses `--argjson idx`
# + single quotes : on Windows Git Bash, MSYS auto-conversion mangles
# `[0]`-style interpolations into path-like strings — --argjson passes the
# index as a typed jq variable with no string-mangling (V1.7.2 R4 fix).
# DO NOT change to bash interpolation.
core_build_prompt_file() {
  local header="$1" snapshot_intro="$2" idx="$3" out="$4"
  {
    echo "$header"
    echo ""
    echo "$snapshot_intro"
    echo ""
    jq --argjson idx "$idx" '.entries[$idx].snapshot' "$ENVELOPE_FILE"
    echo ""
    echo "Réponds STRICTEMENT avec un JSON conforme à ce schéma (pas de markdown,"
    echo "pas de fence, pas de prose hors JSON) :"
    echo ""
    cat "$SCHEMA_FILE"
  } >"$out"
}

# THE single place that knows the `claude --print` flags. $1 = prompt file,
# $2 = response file. Appends stderr to $ERRORS_LOG. Returns claude's exit
# code (callers wrap in set +e / set -e as before).
#
# PURE-GENERATOR ISOLATION (real e2e validated 2026-06-04) — three flags make
# `claude --print` a deterministic JSON generator instead of an interactive
# coding agent :
#   --system-prompt (REPLACE, not --append) : the pipeline prompt becomes the
#     ENTIRE system prompt, dropping the default coding-agent framing.
#   --setting-sources "" : load NO user/project/local settings → the operator's
#     own ~/.claude/CLAUDE.md + hooks are NOT injected. WITHOUT this the model
#     returns conversational prose with the JSON buried, breaking the parse.
#   --max-turns N (≥2) : extended thinking uses a turn before the JSON.
# `--bare` is FORBIDDEN (breaks OAuth Max keychain auth — weekly R4 fix).
# `$(<file)` literal read so $variables / $() inside the system prompt are NOT
# shell-expanded (V1.7 H3 fix). DO NOT change to $(cat ...) interpolation.
core_invoke_claude_print() {
  local prompt_file="$1" response_file="$2"
  local system_prompt_content
  system_prompt_content=$(<"$SYSTEM_PROMPT_FILE")
  claude --print \
    --model "$CLAUDE_MODEL" \
    --effort "$CLAUDE_EFFORT" \
    --max-turns "$MAX_TURNS" \
    --max-budget-usd "$MAX_BUDGET_USD" \
    --setting-sources "" \
    --system-prompt "$system_prompt_content" \
    --output-format text \
    <"$prompt_file" \
    >"$response_file" 2>>"$ERRORS_LOG"
}

# Strip leading/trailing markdown fences + leading prose, then validate JSON.
# $1 = raw response file, $2 = parsed output file. Returns 0 iff valid JSON.
core_parse_response() {
  local response_file="$1" parsed_file="$2"
  sed -E '1{/^```(json)?[[:space:]]*$/d}; ${/^```[[:space:]]*$/d}' "$response_file" \
    | sed -n '/^{/,$p' >"$parsed_file" || true
  jq -e . "$parsed_file" >/dev/null 2>&1
}

# --- NDJSON append (atomic per-line — survives Ctrl-C) --------------------------

# $1 = userId, $2 = parsed output file.
core_append_success() {
  jq -nc --arg uid "$1" --slurpfile output "$2" \
     '{userId: $uid, output: $output[0]}' >>"$RESULTS_NDJSON"
}

# $1 = userId, $2 = error slug (claude_exit_N / invalid_json_response / ...).
core_append_error() {
  jq -nc --arg uid "$1" --arg err "$2" \
     '{userId: $uid, error: $err}' >>"$RESULTS_NDJSON"
}

# --- Jittered sleep (ban-risk mitigation — the heart of the batch) --------------

# Sleep SLEEP_MIN..SLEEP_MAX seconds. NEVER bypass between members.
core_jittered_sleep() {
  local dur=$((SLEEP_MIN + RANDOM % (SLEEP_MAX - SLEEP_MIN + 1)))
  echo "    ⏱  sleeping ${dur}s (jittered for ban-risk mitigation)"
  sleep "$dur"
}
