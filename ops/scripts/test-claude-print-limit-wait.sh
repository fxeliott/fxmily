#!/usr/bin/env bash
#
# Tests for ops/scripts/lib/claude-print-limit-wait.sh — run with a FAKE claude, no network,
# no quota, no real sleep. Exit 0 only when every assertion passed AND the expected number of
# assertions ran (a harness that tests nothing must be red).
#
# Usage : bash ops/scripts/test-claude-print-limit-wait.sh

set -uo pipefail

readonly SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib/claude-print-limit-wait.sh
. "$SCRIPT_DIR/lib/claude-print-limit-wait.sh"

readonly EXPECTED_ASSERTIONS=37
declare -i PASSED=0
declare -i FAILED=0
ok()   { echo "  ✓ $1"; PASSED+=1; }
fail() { echo "  ✗ $1" >&2; FAILED+=1; }
assert_eq() { # label expected actual
  if [ "$2" = "$3" ]; then ok "$1"; else fail "$1 (expected '$2', got '$3')"; fi
}

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

# Fake claude: reads a plan file; each line is one of
#   "limit <message>"          -> message on stderr, exit 1
#   "fail <code> <message>"    -> message on stderr, exit <code>
#   "bodyfail <code> <text>"   -> text on STDOUT, stderr empty, exit <code>
#   "ok <json>"                -> json on stdout, exit 0
# Consumes one line per invocation and records the call count.
FAKE_BIN="$WORK/claude"
cat >"$FAKE_BIN" <<'EOF'
#!/usr/bin/env bash
plan="$CPLW_TEST_PLAN"
n=$(cat "$plan.count" 2>/dev/null || echo 0)
line="$(sed -n "$((n + 1))p" "$plan")"
echo $((n + 1)) >"$plan.count"
kind="${line%% *}"
rest="${line#* }"
case "$kind" in
  limit)    echo "$rest" >&2; exit 1 ;;
  fail)     code="${rest%% *}"; echo "${rest#* }" >&2; exit "$code" ;;
  bodyfail) code="${rest%% *}"; printf '%s' "${rest#* }"; exit "$code" ;;
  ok)       printf '%s' "$rest"; exit 0 ;;
  *)        echo "fake claude: plan exhausted" >&2; exit 99 ;;
esac
EOF
chmod +x "$FAKE_BIN"
export CLAUDE_BIN="$FAKE_BIN"

# Recording sleep: never sleeps, appends the requested seconds to a file.
SLEEP_LOG="$WORK/sleeps"
: >"$SLEEP_LOG"
fake_sleep() { echo "$1" >>"$SLEEP_LOG"; }
export -f fake_sleep 2>/dev/null || true
export CLAUDE_LIMIT_SLEEP_CMD=fake_sleep
export CLAUDE_LIMIT_JITTER_S=0
export CLAUDE_LIMIT_MARGIN_S=90

PROMPT="$WORK/prompt.txt"; echo "hello" >"$PROMPT"
RESP="$WORK/response.json"
ERRS="$WORK/errors.log"

run_plan() { # name -> sets CPLW_TEST_PLAN, resets counters and the batch budget
  export CPLW_TEST_PLAN="$WORK/plan-$1"
  rm -f "$CPLW_TEST_PLAN.count"; : >"$SLEEP_LOG"; : >"$ERRS"; : >"$RESP"
  CPLW_WAITED_TOTAL=0
  cat >"$CPLW_TEST_PLAN"
}
calls() { cat "$CPLW_TEST_PLAN.count" 2>/dev/null || echo 0; }
sleeps() { tr '\n' ' ' <"$SLEEP_LOG" | sed 's/ $//'; }

# Fixed "now": 2026-09-02 17:00:00 in the machine's LOCAL zone (the lib parses announced times in
# the local zone when GNU date has no tz database, which is the case under Git Bash).
export CLAUDE_LIMIT_NOW_EPOCH="$(date -d '2026-09-02 17:00:00' +%s)"
HAS_GNU_DATE=1; date -d '@0' +%s >/dev/null 2>&1 || HAS_GNU_DATE=0
TZ_OK=0; [ "$(TZ=Asia/Tokyo date -d @0 +%H 2>/dev/null)" = "09" ] && TZ_OK=1
echo "  (GNU date: $HAS_GNU_DATE ; IANA zones honoured: $TZ_OK)"

echo ""
echo "→ 1. detection"
_cplw_is_limit "You've hit your session limit · resets 8pm (Europe/Paris)" && ok "session limit detected" || fail "session limit not detected"
_cplw_is_limit "API Error: Rate limited" && ok "rate limited detected" || fail "rate limited not detected"
_cplw_is_limit "You've hit your weekly limit · resets Sep 5, 3pm (Europe/Paris)" && ok "weekly limit detected" || fail "weekly limit not detected"
_cplw_is_limit "API Error: HTTP 429 too many requests" && ok "HTTP 429 with context detected" || fail "HTTP 429 with context not detected"
if _cplw_is_limit "Error: invalid JSON in response"; then fail "ordinary error wrongly detected as a limit"; else ok "ordinary error not detected"; fi
if _cplw_is_limit "The member placed 429 trades this quarter."; then fail "bare 429 in prose wrongly detected as a limit"; else ok "bare 429 in prose not detected"; fi

echo ""
echo "→ 2. reset time parsing (fixed now = 2026-09-02 17:00 local)"
if [ "$HAS_GNU_DATE" -eq 1 ]; then
  exp="$(date -d '2026-09-02 20:00:00' +%s)"
  assert_eq "resets 8pm today -> 20:00 today (local)" "$exp" "$(_cplw_parse_reset_epoch "You've hit your session limit · resets 8pm (Europe/Paris)")"
  exp="$(date -d '2026-09-03 05:50:00' +%s)"
  assert_eq "resets 5:50am (already passed) -> tomorrow 05:50" "$exp" "$(_cplw_parse_reset_epoch "You've hit your session limit · resets 5:50am (Europe/Paris)")"
  if [ "$TZ_OK" -eq 1 ]; then
    exp="$(TZ=America/New_York date -d '2026-09-02 15:45:00' +%s)"
    assert_eq "resets at 3:45pm (America/New_York) honours the zone" "$exp" "$(_cplw_parse_reset_epoch "resets at 3:45pm (America/New_York)")"
  else
    assert_eq "resets at 3:45pm (foreign zone, no tzdata) -> refused (empty)" "" "$(_cplw_parse_reset_epoch "resets at 3:45pm (America/New_York)")"
  fi
else
  ok "(GNU date absent: 3 parsing assertions skipped, fallback path covers them)"; PASSED+=2
fi
assert_eq "pipe+epoch form" "1725292800" "$(_cplw_parse_reset_epoch "Claude AI usage limit reached|1725292800")"
assert_eq "no reset time -> empty" "" "$(_cplw_parse_reset_epoch "API Error: Rate limited")"

echo ""
echo "→ 3. wait computation"
now="$CLAUDE_LIMIT_NOW_EPOCH"
assert_eq "reset in 3600s + margin 90" "3690" "$(_cplw_wait_seconds "$((now + 3600))")"
assert_eq "no reset -> fallback 900" "900" "$(CLAUDE_LIMIT_FALLBACK_WAIT_S=900 _cplw_wait_seconds "")"

echo ""
echo "→ 4. limit then success: waits until the reset and retries"
run_plan A <<EOF
limit You've hit your session limit · resets 8pm (Europe/Paris)
ok {"ok":true}
EOF
claude_print_with_limit_wait "$PROMPT" "$RESP" "$ERRS" -- --max-turns 1 --output-format text
rc=$?
assert_eq "returns 0 after retry" "0" "$rc"
assert_eq "fake claude called twice" "2" "$(calls)"
assert_eq "response is the successful output" '{"ok":true}' "$(cat "$RESP")"
if [ "$HAS_GNU_DATE" -eq 1 ]; then
  assert_eq "slept until 20:00 + 90s (3h + 90s)" "10890" "$(sleeps)"
else
  assert_eq "slept the fallback (no GNU date)" "900" "$(sleeps)"
fi

echo ""
echo "→ 5. ordinary failure: no retry, code propagated"
run_plan B <<EOF
fail 7 Error: something else went wrong
ok {"never":"reached"}
EOF
claude_print_with_limit_wait "$PROMPT" "$RESP" "$ERRS" -- --max-turns 1
rc=$?
assert_eq "exit code propagated" "7" "$rc"
assert_eq "called once only" "1" "$(calls)"

echo ""
echo "→ 6. limit with no parseable reset time: ONE fallback wait, then give up with 75"
run_plan C <<EOF
limit API Error: Rate limited
limit API Error: Rate limited
ok {"too":"late"}
EOF
CLAUDE_LIMIT_FALLBACK_WAIT_S=10 claude_print_with_limit_wait "$PROMPT" "$RESP" "$ERRS" -- --max-turns 1
rc=$?
assert_eq "gives up with exit 75" "75" "$rc"
assert_eq "2 attempts = 1 + one fallback retry" "2" "$(calls)"
assert_eq "slept exactly one fallback of 10s" "10" "$(sleeps)"

echo ""
echo "→ 7. a wait beyond the budget gives up at once"
run_plan D <<EOF
limit You've hit your session limit · resets 8pm (Europe/Paris)
ok {"never":"reached"}
EOF
CLAUDE_LIMIT_MAX_WAIT_S=60 claude_print_with_limit_wait "$PROMPT" "$RESP" "$ERRS" -- --max-turns 1
rc=$?
assert_eq "gives up with exit 75 (budget)" "75" "$rc"
assert_eq "gives up without sleeping" "" "$(sleeps)"
assert_eq "called once only (budget)" "1" "$(calls)"

echo ""
echo "→ 8. the budget spans the whole batch (two calls share CPLW_WAITED_TOTAL)"
run_plan E1 <<EOF
limit API Error: Rate limited
ok {"first":"member"}
EOF
CLAUDE_LIMIT_FALLBACK_WAIT_S=900 CLAUDE_LIMIT_MAX_WAIT_S=1500 claude_print_with_limit_wait "$PROMPT" "$RESP" "$ERRS" -- --max-turns 1
rc=$?
assert_eq "first member: waited the fallback and succeeded" "0" "$rc"
assert_eq "running total after the first member" "900" "$CPLW_WAITED_TOTAL"
export CPLW_TEST_PLAN="$WORK/plan-E2"; rm -f "$CPLW_TEST_PLAN.count"; : >"$SLEEP_LOG"; : >"$RESP"
cat >"$CPLW_TEST_PLAN" <<EOF
limit API Error: Rate limited
ok {"second":"member"}
EOF
CLAUDE_LIMIT_FALLBACK_WAIT_S=900 CLAUDE_LIMIT_MAX_WAIT_S=1500 claude_print_with_limit_wait "$PROMPT" "$RESP" "$ERRS" -- --max-turns 1
rc=$?
assert_eq "second member: 900 + 900 > 1500 -> gives up with 75" "75" "$rc"
assert_eq "second member: no sleep at all" "" "$(sleeps)"

echo ""
echo "→ 9. weekly limit: never waits"
run_plan F <<EOF
limit You've hit your weekly limit · resets Sep 5, 3pm (Europe/Paris)
ok {"never":"reached"}
EOF
claude_print_with_limit_wait "$PROMPT" "$RESP" "$ERRS" -- --max-turns 1
rc=$?
assert_eq "weekly: exit 75" "75" "$rc"
assert_eq "weekly: called once" "1" "$(calls)"
assert_eq "weekly: no sleep" "" "$(sleeps)"

echo ""
echo "→ 10. errexit: a failing attempt never aborts the function; the caller's option is restored"
# 10a. Under the caller's `set -e`, the FIRST claude attempt fails (limit). Without the internal
#      `set +e` the function would die on that line and never retry ; with it, it retries and
#      returns 0, so the errexit caller survives.
run_plan G1 <<EOF
limit You've hit your session limit · resets 8pm (Europe/Paris)
ok {"retried":true}
EOF
out="$( set -e; claude_print_with_limit_wait "$PROMPT" "$RESP" "$ERRS" -- --max-turns 1 2>/dev/null; rc=$?; case $- in *e*) e=on;; *) e=off;; esac; echo "alive rc=$rc errexit=$e" )"
assert_eq "errexit caller: internal failure retried, function returned 0, errexit restored" "alive rc=0 errexit=on" "$out"
# 10b. The documented call pattern of the batch scripts (set +e ; call ; rc=$? ; set -e) keeps an
#      errexit caller alive on a NON-ZERO return -- bash acts on the function's status at the call
#      site, no function can shield its caller from that.
run_plan G2 <<EOF
fail 7 Error: model failure
EOF
out="$( set -e; set +e; claude_print_with_limit_wait "$PROMPT" "$RESP" "$ERRS" -- --max-turns 1 2>/dev/null; rc=$?; set -e; echo "alive rc=$rc" )"
assert_eq "documented call pattern: caller alive with claude's code" "alive rc=7" "$out"
out="$( set +e; claude_print_with_limit_wait "$PROMPT" "$RESP" "$ERRS" -- --max-turns 1 >/dev/null 2>&1; case $- in *e*) e=on;; *) e=off;; esac; echo "errexit=$e" )"
assert_eq "errexit left off when it was off" "errexit=off" "$out"

echo ""
echo "→ 11. a bare 429 in the response body is not a limit (no retry)"
run_plan H <<EOF
bodyfail 1 The member placed 429 trades this quarter and the report failed.
ok {"never":"reached"}
EOF
claude_print_with_limit_wait "$PROMPT" "$RESP" "$ERRS" -- --max-turns 1
rc=$?
assert_eq "body 429: exit 1 propagated" "1" "$rc"
assert_eq "body 429: called once" "1" "$(calls)"

echo ""
TOTAL=$((PASSED + FAILED))
echo "Assertions : $PASSED passed, $FAILED failed ($TOTAL run, $EXPECTED_ASSERTIONS expected)"
if [ "$FAILED" -ne 0 ]; then exit 1; fi
if [ "$TOTAL" -ne "$EXPECTED_ASSERTIONS" ]; then echo "  ✗ harness ran $TOTAL assertions instead of $EXPECTED_ASSERTIONS" >&2; exit 1; fi
exit 0
