#!/usr/bin/env bash
#
# Deterministic unit tests for the Volet B anti-ban / permanence hardening in
# claude-batch-core.sh :
#   - core_classify_failure   (rate-limit / usage-limit stderr classifier)
#   - core_note_failure/success + core_should_halt (consecutive-failure breaker
#     + immediate rate-limit halt latch)
#   - core_invoke_claude_print passthrough + hard `timeout` wrapper
#
# NO network, NO real `claude`, NO jq/curl needed — a mock `claude` on PATH
# drives the invocation path. Runs on Git Bash (Windows) and Linux.
#
#   bash ops/scripts/lib/claude-batch-core.test.sh
#
# Exit 0 iff every assertion passes.

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Neutralise operator env so the defaults-under-test are deterministic.
unset FXMILY_MAX_CONSECUTIVE_FAILURES FXMILY_CLAUDE_TIMEOUT_S 2>/dev/null || true

# shellcheck source=claude-batch-core.sh
source "$SCRIPT_DIR/claude-batch-core.sh"

PASS=0
FAIL=0
ok()   { echo "  ✓ $1"; PASS=$((PASS + 1)); }
fail() { echo "  ✗ FAIL: $1"; FAIL=$((FAIL + 1)); }
check_eq() { # label expected actual
  if [ "$2" = "$3" ]; then ok "$1"; else fail "$1 — expected '$2', got '$3'"; fi
}

TMP="$(mktemp -d 2>/dev/null || echo "${TMPDIR:-/tmp}/cbc-test-$$")"
mkdir -p "$TMP"
trap 'rm -rf "$TMP"' EXIT
ERRORS_LOG="$TMP/errors.log"
: >"$ERRORS_LOG"

# ---------------------------------------------------------------------------
echo "[1] core_classify_failure — rate-limit signature detection"
: >"$ERRORS_LOG"
check_eq "empty log → generic" "generic" "$(core_classify_failure)"
for sig in \
  "Error: rate limit exceeded" \
  "HTTP 429 Too Many Requests" \
  "usage limit reached for your plan" \
  "quota exceeded, retry later" \
  "the model is overloaded right now" \
  "rate_limit_error from API" \
  "resource_exhausted" \
  "please try again later" \
  "weekly usage cap hit" \
  "You've hit your session limit · resets 12:50am (Europe/Paris)" \
  "You’ve hit your session limit · resets 1:40pm (Europe/Paris)" \
  "You've reached your Fable 5 limit. Run /usage-credits to continue or switch models with /model."; do
  printf '%s\n' "$sig" >"$ERRORS_LOG"
  check_eq "signature '${sig:0:26}…' → rate_limited" "rate_limited" "$(core_classify_failure)"
done
for gen in \
  "ECONNREFUSED 127.0.0.1:443" \
  "connection reset by peer" \
  "some unexpected parser error" \
  "TypeError: undefined is not a function"; do
  printf '%s\n' "$gen" >"$ERRORS_LOG"
  check_eq "generic '${gen:0:26}…' → generic" "generic" "$(core_classify_failure)"
done
# A bare number that is not 429 must NOT trip the 429 rule.
printf '%s\n' "processed 4290 tokens ok" >"$ERRORS_LOG"
check_eq "'4290' (not 429) → generic" "generic" "$(core_classify_failure)"

# ---------------------------------------------------------------------------
echo "[2] consecutive-failure circuit breaker"
printf 'generic connection error\n' >"$ERRORS_LOG" # generic → no rate latch
FXMILY_MAX_CONSECUTIVE_FAILURES=3
core_reset_failure_state
if core_should_halt 2>/dev/null; then fail "fresh state must not halt"; else ok "fresh state does not halt"; fi
core_note_failure; core_note_failure
check_eq "counter after 2 failures" "2" "$CORE_CONSECUTIVE_FAILURES"
if core_should_halt 2>/dev/null; then fail "2<3 must not halt"; else ok "2 failures (<3) does not halt"; fi
core_note_failure
if core_should_halt 2>/dev/null; then ok "3>=3 halts"; else fail "3 failures must halt"; fi
# A success in the middle resets the run so blips don't accumulate.
core_reset_failure_state
core_note_failure; core_note_failure; core_note_success
check_eq "success resets counter to 0" "0" "$CORE_CONSECUTIVE_FAILURES"
core_note_failure; core_note_failure
if core_should_halt 2>/dev/null; then fail "2 after reset must not halt"; else ok "success-interspersed failures do not trip breaker"; fi

# ---------------------------------------------------------------------------
echo "[3] breaker disabled (FXMILY_MAX_CONSECUTIVE_FAILURES=0)"
FXMILY_MAX_CONSECUTIVE_FAILURES=0
printf 'generic error\n' >"$ERRORS_LOG"
core_reset_failure_state
for _ in 1 2 3 4 5 6; do core_note_failure; done
if core_should_halt 2>/dev/null; then fail "breaker=0 must never halt on generic"; else ok "breaker=0 disables the consecutive halt"; fi

# ---------------------------------------------------------------------------
echo "[4] rate-limit → immediate halt, regardless of the breaker"
FXMILY_MAX_CONSECUTIVE_FAILURES=99
printf 'HTTP 429 rate limit exceeded\n' >"$ERRORS_LOG"
core_reset_failure_state
core_note_failure # a SINGLE failure, but rate-limited
check_eq "rate latch set" "1" "$CORE_RATE_LIMITED"
if core_should_halt 2>/dev/null; then ok "single rate-limited failure halts (breaker=99)"; else fail "rate-limit must halt immediately"; fi
core_note_success # a later success must NOT clear the run's rate latch
check_eq "success does NOT clear the rate latch" "1" "$CORE_RATE_LIMITED"
if core_should_halt 2>/dev/null; then ok "latch persists after note_success"; else fail "latch must persist until reset"; fi
core_reset_failure_state
check_eq "reset clears the rate latch" "0" "$CORE_RATE_LIMITED"

# ---------------------------------------------------------------------------
echo "[5] halt reason is surfaced on stderr (operator signal)"
FXMILY_MAX_CONSECUTIVE_FAILURES=1
printf 'generic\n' >"$ERRORS_LOG"
core_reset_failure_state; core_note_failure
msg="$(core_should_halt 2>&1 1>/dev/null)"
if printf '%s' "$msg" | grep -q "HALT"; then ok "breaker halt prints a reason"; else fail "no HALT reason on stderr"; fi

# ---------------------------------------------------------------------------
echo "[6] core_invoke_claude_print — passthrough + hard timeout (mock claude)"
MOCKBIN="$TMP/bin"
mkdir -p "$MOCKBIN"
cat >"$MOCKBIN/claude" <<'MOCK'
#!/usr/bin/env bash
# Mock claude: behavior selected by MOCK_CLAUDE_MODE. Ignores every flag,
# drains stdin so the caller's redirection never SIGPIPEs.
cat >/dev/null 2>&1 || true
case "${MOCK_CLAUDE_MODE:-ok}" in
  ok)   printf '%s\n' '{"summary":"ok","highlights":[],"axes_prioritaires":[]}' ;;
  hang) sleep 30 ;;
  rl)   echo "API Error: 429 rate limit exceeded" >&2; exit 1 ;;
  boom) echo "ECONNRESET socket hang up" >&2; exit 1 ;;
esac
MOCK
chmod +x "$MOCKBIN/claude"
export PATH="$MOCKBIN:$PATH"

SYSTEM_PROMPT_FILE="$TMP/sys.txt"; printf 'you are a JSON generator\n' >"$SYSTEM_PROMPT_FILE"
PROMPT_FILE="$TMP/prompt.txt"; printf 'analyse this\n' >"$PROMPT_FILE"
RESP="$TMP/resp.json"

# 6a — passthrough (timeout disabled): exit 0 + JSON written (no regression).
# MOCK_CLAUDE_MODE must be EXPORTED — the mock reads it from its environment.
FXMILY_CLAUDE_TIMEOUT_S=0
export MOCK_CLAUDE_MODE=ok
: >"$ERRORS_LOG"
core_invoke_claude_print "$PROMPT_FILE" "$RESP"; rc=$?
check_eq "ok mock → exit 0" "0" "$rc"
if grep -q '"summary"' "$RESP" 2>/dev/null; then ok "ok mock → JSON written to response file"; else fail "response file missing JSON"; fi

# 6b — rate-limit mock → non-zero, and the classifier sees it end-to-end.
export MOCK_CLAUDE_MODE=rl
: >"$ERRORS_LOG"
core_invoke_claude_print "$PROMPT_FILE" "$RESP"; rc=$?
if [ "$rc" -ne 0 ]; then ok "rl mock → non-zero exit ($rc)"; else fail "rl mock must exit non-zero"; fi
check_eq "rl stderr classified end-to-end" "rate_limited" "$(core_classify_failure)"

# 6c — hard timeout, only when coreutils `timeout` is available (else the
# documented graceful-degrade path applies and we skip the assertion).
if command -v timeout >/dev/null 2>&1; then
  FXMILY_CLAUDE_TIMEOUT_S=1
  export MOCK_CLAUDE_MODE=hang
  : >"$ERRORS_LOG"
  start=$SECONDS
  core_invoke_claude_print "$PROMPT_FILE" "$RESP"; rc=$?
  elapsed=$((SECONDS - start))
  if [ "$rc" -ne 0 ]; then ok "hang mock → timeout non-zero exit ($rc)"; else fail "hang mock must be killed by timeout"; fi
  if [ "$elapsed" -lt 25 ]; then ok "hang killed in ${elapsed}s (« the mock's 30s sleep)"; else fail "timeout did not fire (elapsed ${elapsed}s)"; fi
else
  echo "  ⚠ SKIP hard-timeout assertions — coreutils 'timeout' not on PATH (graceful-degrade path)"
fi

# ---------------------------------------------------------------------------
echo "[7] set -e safety (mirrors the real orchestrators' 'set -euo pipefail')"
(
  set -euo pipefail
  printf 'generic\n' >"$ERRORS_LOG"
  FXMILY_MAX_CONSECUTIVE_FAILURES=4
  core_reset_failure_state
  core_note_failure   # bare call under set -e (returns 0 by contract)
  core_note_success   # bare call under set -e
  if core_should_halt; then :; fi   # only ever called in a conditional
  core_note_failure
  echo "SETE_OK"
) >"$TMP/sete.out" 2>&1
if grep -q "SETE_OK" "$TMP/sete.out"; then
  ok "note_failure/note_success/should_halt are safe under set -e"
else
  fail "set -e aborted early: $(tr '\n' ' ' <"$TMP/sete.out")"
fi

# ---------------------------------------------------------------------------
echo "[8] round-2 P2 fix — classification is scoped to the CURRENT call's stderr"
# A prior member (even a successful one) left a benign keyword-bearing line in
# the append-only log; a later member fails with a pure network blip. The
# per-call mark must exclude the earlier keyword so it does NOT spuriously halt.
core_reset_failure_state
printf 'member3: model overloaded warning, recovered\n' >"$ERRORS_LOG" # earlier member, benign
CORE_ERRLOG_MARK=$(wc -c <"$ERRORS_LOG" | tr -dc '0-9')                # mark set before member5's call
printf 'ECONNRESET socket hang up\n' >>"$ERRORS_LOG"                   # member5: pure network failure
check_eq "earlier member's 'overloaded' does NOT bleed into member5" "generic" "$(core_classify_failure)"
# But a real rate-limit in the CURRENT member's own stderr is still detected.
printf 'HTTP 429 rate limit exceeded\n' >>"$ERRORS_LOG"
check_eq "current member's own rate-limit still detected past the mark" "rate_limited" "$(core_classify_failure)"
# Mark 0 (fresh run) classifies the whole file, as before.
core_reset_failure_state
printf 'usage limit reached\n' >"$ERRORS_LOG"
check_eq "mark 0 → whole-file classification (first call)" "rate_limited" "$(core_classify_failure)"

# ---------------------------------------------------------------------------
echo "[9] R18 cap-detection fix — cap notice on STDOUT only (empty stderr)"
# Root cause of the 2026-07-09 20:01→22:49 UTC loop : a capped `claude --print`
# exits 1 with an EMPTY stderr and prints the cap notice on stdout, so the
# stderr-only classifier said "generic" → no latch → no exit 75 → no cooldown
# → the 5-min tick hammered the capped account for 3 hours (~100 sessions).
core_reset_failure_state
: >"$ERRORS_LOG"
CAP_RESP="$TMP/cap-resp.txt"
printf "You've hit your session limit · resets 1:40pm (Europe/Paris)\n" >"$CAP_RESP"
CORE_LAST_RESPONSE_FILE="$CAP_RESP"
check_eq "cap in response file + empty stderr → rate_limited" "rate_limited" "$(core_classify_failure)"
core_note_failure
check_eq "response-file cap latches the run" "1" "$CORE_RATE_LIMITED"
check_eq "latched run exits 75 (cooldown signal)" "75" "$(core_run_exit_code)"
# Non-regression : a NORMAL JSON response + a pure network stderr stays generic.
core_reset_failure_state
printf '%s\n' '{"summary":"ok","confidence":0.9}' >"$CAP_RESP"
CORE_LAST_RESPONSE_FILE="$CAP_RESP"
printf 'ECONNRESET socket hang up\n' >"$ERRORS_LOG"
check_eq "normal JSON response + network stderr → generic" "generic" "$(core_classify_failure)"
# reset clears the pointer so a stale response can never bleed into a fresh run.
core_reset_failure_state
check_eq "reset clears CORE_LAST_RESPONSE_FILE" "" "${CORE_LAST_RESPONSE_FILE:-}"
# core_invoke_claude_print records the response file it wrote (wiring proof).
export MOCK_CLAUDE_MODE=ok
FXMILY_CLAUDE_TIMEOUT_S=0
core_invoke_claude_print "$PROMPT_FILE" "$RESP" >/dev/null 2>&1
check_eq "invoke records CORE_LAST_RESPONSE_FILE" "$RESP" "$CORE_LAST_RESPONSE_FILE"

# ---------------------------------------------------------------------------
echo ""
echo "===================================================="
echo "core anti-ban tests: $PASS passed, $FAIL failed"
if [ "$FAIL" -gt 0 ]; then
  echo "RESULT: RED"
  exit 1
fi
echo "RESULT: ALL GREEN"
