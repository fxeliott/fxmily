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
#   - single active Claude account per machine : the orchestrators authenticate
#     with whatever account is currently logged in under ~/.claude
#     (.credentials.json). They no longer require a human to run them — the J2
#     worker (ops/worker/) schedules them — but they stay serialised, one
#     `claude --print` at a time, exactly as a human ran them by hand.
#
# Sourcing contract :
#   SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
#   source "$SCRIPT_DIR/lib/claude-batch-core.sh"
# The core only defines variables + functions — it performs NO side effects
# at source time beyond computing config defaults from env.

# --- Shared config defaults (env-overridable, validated below) ---------------

# §8 — local Claude solicitations are PINNED on Claude Opus 4.8
# (`claude-opus-4-8`) at "xhigh" effort by default (Eliott decision,
# 2026-06-11) : Fable 5 leaves the Max subscription's included models after
# 2026-06-22 (usage-credits only, $10/$50 MTok — anthropic.com/news/
# claude-fable-5-mythos-5), while Opus 4.8 stays included ($0 marginal).
# The durable $0 engine is therefore Opus 4.8. Both vars stay
# env-overridable (`claude-fable-5` remains allowlisted for manual runs
# while it is still included, until 2026-06-22 — never automatic).
CLAUDE_MODEL="${FXMILY_CLAUDE_MODEL:-claude-opus-4-8}"
CLAUDE_EFFORT="${FXMILY_CLAUDE_EFFORT:-xhigh}"

# ≥2 required: extended thinking uses a turn before the JSON, so
# `--max-turns 1` aborts with "Reached max turns (1)" (validated via the §26
# calendar batch real e2e, 2026-06-04). `--max-budget-usd` is the runaway
# circuit-breaker. NOT 1.
MAX_TURNS="${FXMILY_MAX_TURNS:-8}"

# §8 — financial circuit-breaker per `claude --print` call. On Max sub the
# marginal cost is theoretical ($0 actual), but if Anthropic ever switches the
# binary to billable API this caps damage per call. 15.00 was calibrated for
# Fable 5 rates ($10/$50 MTok, 2026-06-10) and is KEPT for the Opus 4.8
# default (re-pin 2026-06-11) : it still bounds a runaway loop while leaving
# ~9× margin for a typical xhigh run at Opus 4.8 repo rates ($15/$75 MTok).
MAX_BUDGET_USD="${FXMILY_MAX_BUDGET_USD:-15.00}"

SLEEP_MIN="${FXMILY_SLEEP_MIN_S:-60}"
SLEEP_MAX="${FXMILY_SLEEP_MAX_S:-120}"

# S3 §33.4 — opt-in tool allowlist for VISION pipelines. Empty (the default)
# keeps the historical pure-text invocation byte-identical for the 4 existing
# orchestrators. The verification pipeline sets it to "Read" so the model can
# read the downloaded proof image from the local disk. NEVER widen beyond
# read-only tools (pure-generator isolation: no Bash, no Write, no network).
CLAUDE_ALLOWED_TOOLS="${FXMILY_CLAUDE_ALLOWED_TOOLS:-}"

# --- Volet B : rate-limit / permanence hardening -----------------------------
# The 9 ban-risk rules above stop PARALLELISM and pace calls, but nothing stops
# TOTAL VOLUME against an already usage-limited OAuth Max account. Sustained
# rapid-fire against an exhausted quota is the exact pattern that escalates from
# a soft throttle to an account action, and a broken auth mid-cohort silently
# burns the rest of the run. These knobs turn both into a clean, idempotent
# HALT (safe re-run next quota window — unprocessed members are re-picked by the
# server-side pull filter). Halting is deliberately preferred over a
# back-off-and-continue : continuing keeps hammering a possibly-limited account,
# the opposite of the "zéro ban" goal ; stopping never does.

# Consecutive-failure circuit breaker. After this many BACK-TO-BACK failed
# members (claude non-zero exit / unparseable output / timeout), the per-member
# loop HALTS instead of burning the rest of the cohort against a broken
# auth/quota/network. A successful member resets the counter to 0. 0 disables
# the breaker (NOT recommended). Default 4 tolerates a couple of transient blips
# while stopping a systemic failure early.
FXMILY_MAX_CONSECUTIVE_FAILURES="${FXMILY_MAX_CONSECUTIVE_FAILURES:-4}"

# Hard wall-clock timeout (seconds) around ONE `claude --print`. xhigh extended
# thinking is slow, so this is generous — it only catches a truly hung process
# (keychain prompt, network stall) that would otherwise block the whole serial
# batch forever. Requires coreutils `timeout` on PATH ; degrades to an unbounded
# call (with a one-time warning) when absent. 0 disables the wrapper entirely.
FXMILY_CLAUDE_TIMEOUT_S="${FXMILY_CLAUDE_TIMEOUT_S:-900}"

# --- Runtime state (module globals, reset per run by core_reset_failure_state) -
CORE_CONSECUTIVE_FAILURES=0
CORE_RATE_LIMITED=0
CORE_TIMEOUT_WARNED=0
# Byte offset in $ERRORS_LOG captured just before each `claude --print` call, so
# core_classify_failure inspects ONLY the current member's stderr (the log is
# append-only across the whole run — without this, a keyword from an earlier,
# even successful, member would be misattributed to a later failure and trip a
# spurious rate-limit halt). 0 = classify the whole file (first call / tests).
CORE_ERRLOG_MARK=0
# Path of the CURRENT call's captured stdout (set by core_invoke_claude_print).
# Subscription-cap notices land on STDOUT with an empty stderr (R18 fix), so
# core_classify_failure scans this file too. "" = no call yet this run.
CORE_LAST_RESPONSE_FILE=""

# --- Validations --------------------------------------------------------------

# Allowlist of acceptable Claude model slugs for `claude --model` — THE single
# copy (was duplicated 4× across the orchestrators). Verified against
# `claude --help` full names like 'claude-fable-5' / 'claude-opus-4-8'.
core_validate_model() {
  case "$CLAUDE_MODEL" in
    claude-fable-5|claude-opus-4-8|claude-opus-4-7|claude-sonnet-4-6|claude-haiku-4-5) ;;
    *)
      echo "ERROR: FXMILY_CLAUDE_MODEL=$CLAUDE_MODEL not in allowlist." >&2
      echo "  Allowed: claude-fable-5, claude-opus-4-8, claude-opus-4-7, claude-sonnet-4-6, claude-haiku-4-5" >&2
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

# Numeric knobs validation. MAX_TURNS = positive integer ≥2 (thinking burns a
# turn). MAX_BUDGET_USD = dot-decimal (a French-locale '15,00' would make every
# `claude` call fail as claude_exit_N — catch it upfront instead).
core_validate_numeric_knobs() {
  if ! [[ "$MAX_TURNS" =~ ^[0-9]+$ ]] || [ "$MAX_TURNS" -lt 2 ]; then
    echo "ERROR: FXMILY_MAX_TURNS=$MAX_TURNS must be an integer ≥2 (thinking uses a turn)." >&2
    exit 1
  fi
  if ! [[ "$MAX_BUDGET_USD" =~ ^[0-9]+(\.[0-9]+)?$ ]]; then
    echo "ERROR: FXMILY_MAX_BUDGET_USD=$MAX_BUDGET_USD must be a dot-decimal number (e.g. 15.00)." >&2
    exit 1
  fi
  # Volet B knobs : non-negative integers (0 = disabled). A French-locale or
  # typo'd value would otherwise silently break the arithmetic guards mid-batch.
  if ! [[ "$FXMILY_MAX_CONSECUTIVE_FAILURES" =~ ^[0-9]+$ ]]; then
    echo "ERROR: FXMILY_MAX_CONSECUTIVE_FAILURES=$FXMILY_MAX_CONSECUTIVE_FAILURES must be a non-negative integer (0 disables the breaker)." >&2
    exit 1
  fi
  if ! [[ "$FXMILY_CLAUDE_TIMEOUT_S" =~ ^[0-9]+$ ]]; then
    echo "ERROR: FXMILY_CLAUDE_TIMEOUT_S=$FXMILY_CLAUDE_TIMEOUT_S must be a non-negative integer seconds (0 disables the timeout)." >&2
    exit 1
  fi
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
  # Fable 5 pre-flight : the model requires Claude Code CLI ≥ 2.1.170 (older
  # CLIs do not resolve the slug → exit 1 mid-batch after the jittered sleep).
  if [ "$CLAUDE_MODEL" = "claude-fable-5" ]; then
    local cli_version
    cli_version=$(claude --version 2>&1 | head -1 | grep -oE '[0-9]+\.[0-9]+\.[0-9]+' | head -1)
    if [ -z "$cli_version" ]; then
      echo "ERROR: cannot parse 'claude --version' output for the Fable 5 pre-flight." >&2
      exit 1
    fi
    local min="2.1.170"
    if [ "$(printf '%s\n%s\n' "$min" "$cli_version" | sort -V | head -1)" != "$min" ]; then
      echo "ERROR: claude CLI $cli_version < $min — Claude Fable 5 requires CLI ≥ $min." >&2
      echo "  Update via 'npm i -g @anthropic-ai/claude-code@latest' then restart the shell." >&2
      exit 1
    fi
  fi
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
  # Volet B — mark the current size of the shared stderr log BEFORE the call so
  # core_classify_failure classifies only THIS call's stderr (round-2 P2 fix:
  # avoid a keyword bleeding from an earlier member's stderr into this one).
  CORE_ERRLOG_MARK=0
  if [ -n "${ERRORS_LOG:-}" ] && [ -f "${ERRORS_LOG:-}" ]; then
    CORE_ERRLOG_MARK=$(wc -c <"$ERRORS_LOG" 2>/dev/null | tr -dc '0-9')
    [ -n "$CORE_ERRLOG_MARK" ] || CORE_ERRLOG_MARK=0
  fi
  # R18 cap-detection fix — remember THIS call's response file so
  # core_classify_failure can scan it too : a capped `claude --print` exits 1
  # with an EMPTY stderr and prints the cap notice on STDOUT (proved on the
  # 2026-07-09 20:01→22:49 UTC cap loop : claude-errors.log stayed 0 bytes
  # while ~100 worker transcripts carried « You've hit your session limit »
  # as assistant text). One response file per member → per-call by
  # construction, no cross-member bleed.
  CORE_LAST_RESPONSE_FILE="$response_file"
  # S3 — vision opt-in: `--allowedTools` is appended ONLY when the caller set
  # CLAUDE_ALLOWED_TOOLS (e.g. "Read" for the verification pipeline). The
  # empty default keeps the 4 text pipelines byte-identical (no flag at all).
  local extra_args=()
  if [ -n "$CLAUDE_ALLOWED_TOOLS" ]; then
    extra_args+=(--allowedTools "$CLAUDE_ALLOWED_TOOLS")
  fi
  # Volet B — optional hard timeout: coreutils `timeout` wraps the call so a
  # hung `claude --print` (keychain prompt, network stall) cannot block the
  # whole serial batch forever. `--kill-after=30s` escalates to SIGKILL if the
  # process ignores SIGTERM. A timeout surfaces as a NORMAL non-zero exit
  # (124 term / 137 kill) → the caller records it and it counts toward the
  # consecutive-failure breaker, exactly like any other claude failure. When
  # `timeout` is unavailable the call runs unbounded (one-time warning) — no
  # regression versus the historical invocation. The empty-array expansion
  # `"${timeout_cmd[@]}"` is the same set-u-safe idiom already used for
  # extra_args below.
  local timeout_cmd=()
  if [ "$FXMILY_CLAUDE_TIMEOUT_S" -gt 0 ]; then
    if command -v timeout >/dev/null 2>&1; then
      timeout_cmd=(timeout --kill-after=30s "${FXMILY_CLAUDE_TIMEOUT_S}s")
    elif [ "$CORE_TIMEOUT_WARNED" -eq 0 ]; then
      echo "WARN: coreutils 'timeout' not on PATH — claude --print runs unbounded (set FXMILY_CLAUDE_TIMEOUT_S=0 to silence)." >&2
      CORE_TIMEOUT_WARNED=1
    fi
  fi
  "${timeout_cmd[@]}" claude --print \
    --model "$CLAUDE_MODEL" \
    --effort "$CLAUDE_EFFORT" \
    --max-turns "$MAX_TURNS" \
    --max-budget-usd "$MAX_BUDGET_USD" \
    --setting-sources "" \
    --system-prompt "$system_prompt_content" \
    --output-format text \
    "${extra_args[@]}" \
    <"$prompt_file" \
    >"$response_file" 2>>"$ERRORS_LOG"
}

# Strip markdown fences + surrounding prose, then validate JSON.
# $1 = raw response file, $2 = parsed output file. Returns 0 iff valid JSON.
#
# Hardened 2026-06-11 (S2 runtime proof on the re-pinned Opus 4.8 default) :
# Opus 4.8 can bury the fenced JSON under conversational prose DESPITE the
# strict system prompt ("Voici le profil… ```json {…} ```"), where the old
# parser only stripped a fence on the FIRST/LAST line → invalid_json_response
# → 0 profile persisted for a completed interview. New strategy : drop ALL
# fence lines wherever they appear, then keep the block from the first line
# starting with '{' to the LAST line starting with '}' (trailing prose after
# the closing fence is dropped too). Single-line/minified JSON keeps the old
# "to end of file" behavior. `jq -e` stays the only validity authority.
core_parse_response() {
  local response_file="$1" parsed_file="$2"
  sed -E '/^```([a-zA-Z]+)?[[:space:]]*$/d' "$response_file" \
    | awk '/^\{/ { if (!s) s = NR } /^\}/ { e = NR } { l[NR] = $0 }
           END { if (s) { if (!e || e < s) e = NR; for (i = s; i <= e; i++) print l[i] } }' \
    >"$parsed_file" || true
  # Validity = valid JSON AND a SINGLE document. Without the `-s length==1`
  # guard, a multi-document response ({"draft"} then {real}) passes `jq -e .`
  # on the LAST document while `--slurpfile`'s `$output[0]` ships the FIRST —
  # the local gate would validate one object and submit another (review
  # finding 2026-06-11 ; the server Zod stays the final authority either way).
  jq -e . "$parsed_file" >/dev/null 2>&1 && jq -e -s 'length == 1' "$parsed_file" >/dev/null 2>&1
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

# --- Volet B : failure classification + circuit breaker ------------------------
#
# All five per-member loops share the same failure taxonomy :
#   - claude non-zero exit / empty output / timeout  → core_note_failure
#   - unparseable or wrong-shape JSON                → core_note_failure
#   - a successful, valid generation (incl. a legit  → core_note_success
#     model verdict like verification's not_mt5_history)
#   - PRE-CALL skips (bad pseudonym/userId, inactive → neither: no claude call
#     member, image download failure)                  was made
# After recording, the loop asks core_should_halt and `break`s when true, so a
# systemic auth/quota/network failure stops the run early (idempotent re-run)
# instead of hammering a limited account for the rest of the cohort.

# Reset the per-run failure state. Call ONCE right before the per-member loop.
core_reset_failure_state() {
  CORE_CONSECUTIVE_FAILURES=0
  CORE_RATE_LIMITED=0
  CORE_ERRLOG_MARK=0
  CORE_LAST_RESPONSE_FILE=""
}

# Classify the LAST claude failure by scanning the tail of $ERRORS_LOG for a
# usage/rate-limit signature. Echoes "rate_limited" or "generic", returns 0.
# DEFENSIVE by design : the exact `claude --print` stderr wording is NOT a
# stable contract, so we match a BROAD set of well-known limit signatures
# (case-insensitive). A false positive only costs a safe early halt + an
# idempotent re-run ; a false negative still trips the consecutive-failure
# breaker. Both failure modes are safe — the classifier never keeps the loop
# running when in doubt.
core_classify_failure() {
  local tail_txt=""
  if [ -n "${ERRORS_LOG:-}" ] && [ -f "${ERRORS_LOG:-}" ]; then
    # Only the bytes appended since the current call's pre-invocation mark
    # (CORE_ERRLOG_MARK), then capped at 4000 — so an earlier member's stderr
    # keyword can never poison this classification. Mark 0 = whole file (first
    # call / direct-call tests).
    tail_txt=$(tail -c +"$(( ${CORE_ERRLOG_MARK:-0} + 1 ))" "$ERRORS_LOG" 2>/dev/null | tail -c 4000 || true)
  fi
  # R18 cap-detection fix — ALSO scan the current call's captured stdout
  # (CORE_LAST_RESPONSE_FILE, set by core_invoke_claude_print) : subscription
  # caps arrive as assistant text on STDOUT with an empty stderr, so a
  # stderr-only classifier can never see them (root cause of the 2026-07-09
  # 3-hour cap-hammering loop : every tick halted "generic", exit 0, no
  # cooldown). The response file is per-member, so no cross-member bleed.
  if [ -n "${CORE_LAST_RESPONSE_FILE:-}" ] && [ -f "${CORE_LAST_RESPONSE_FILE:-}" ]; then
    tail_txt="$tail_txt
$(tail -c 4000 "$CORE_LAST_RESPONSE_FILE" 2>/dev/null || true)"
  fi
  # `session[ _-]?limit` + `(hit|reached) your` cover the real Max-plan cap
  # wordings (« You've hit your session limit · resets… », « You've reached
  # your Fable 5 limit… ») — deliberately WITHOUT matching the apostrophe
  # (typographic ' is multi-byte; `.?` under a C locale matches one BYTE and
  # would silently fail). Broad-match is the documented contract here : this
  # only runs on an already-failed call, and a false positive costs a safe
  # halt + idempotent re-run.
  if printf '%s' "$tail_txt" | grep -qiE \
       'rate[ _-]?limit|usage[ _-]?limit|session[ _-]?limit|(hit|reached) your|too many requests|(^|[^0-9])429([^0-9]|$)|quota|resource[ _-]?exhausted|overloaded|limit reached|usage cap|try again later'; then
    echo "rate_limited"
  else
    echo "generic"
  fi
}

# Record a failed member : increment the consecutive-failure counter and, when
# the failure classifies as a rate/usage limit, LATCH CORE_RATE_LIMITED (once
# set it stays set for the run). Always returns 0 (safe under `set -e`).
core_note_failure() {
  CORE_CONSECUTIVE_FAILURES=$((CORE_CONSECUTIVE_FAILURES + 1))
  local kind
  kind=$(core_classify_failure)
  if [ "$kind" = "rate_limited" ]; then
    CORE_RATE_LIMITED=1
  fi
  return 0
}

# Record a successful member — resets the consecutive-failure counter so an
# isolated blip between two successes never accumulates toward the breaker.
core_note_success() {
  CORE_CONSECUTIVE_FAILURES=0
  return 0
}

# Should the batch HALT now? True (0) when a rate/usage limit was detected
# (stop immediately — never hammer a limited account) OR the consecutive-failure
# breaker tripped. False (1) otherwise. Prints the reason to stderr on halt.
core_should_halt() {
  if [ "$CORE_RATE_LIMITED" -eq 1 ]; then
    echo "  ⛔ HALT: a usage/rate limit was detected in claude stderr — stopping the run to avoid hammering a limited account. Re-run in the next quota window (idempotent: unprocessed members are re-picked)." >&2
    return 0
  fi
  if [ "$FXMILY_MAX_CONSECUTIVE_FAILURES" -gt 0 ] \
     && [ "$CORE_CONSECUTIVE_FAILURES" -ge "$FXMILY_MAX_CONSECUTIVE_FAILURES" ]; then
    echo "  ⛔ HALT: $CORE_CONSECUTIVE_FAILURES consecutive failures (breaker=$FXMILY_MAX_CONSECUTIVE_FAILURES) — stopping to avoid a silent mass-failure cohort. Fix the cause (auth/quota/network) and re-run (idempotent)." >&2
    return 0
  fi
  return 1
}

# Exit code a pipeline should terminate with AFTER it has finished persisting
# whatever it managed to generate. Echoes 75 (EX_TEMPFAIL) when the run latched
# CORE_RATE_LIMITED — a BENIGN "come back next quota window" signal that
# run-batch.sh turns into an inter-tick cooldown so the worker stops hammering a
# capped account — otherwise 0. Called at the very end of each pipeline (past the
# partial persist) so a rate-limit halt never discards work already done and
# never masks a persist failure (those keep their own non-zero exit). A run that
# tripped only the consecutive-failure breaker (generic, not a usage limit)
# stays 0 here : it already surfaces via the per-member error slugs + logs and
# does not warrant a machine-wide cooldown.
core_run_exit_code() {
  if [ "${CORE_RATE_LIMITED:-0}" -eq 1 ]; then
    echo 75
  else
    echo 0
  fi
}
