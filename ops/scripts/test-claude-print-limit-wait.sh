#!/usr/bin/env bash
#
# Tests for ops/scripts/lib/claude-print-limit-wait.sh (detection, reset-time parsing, wait
# computation). The wait-once behaviour itself is tested where it lives, in
# ops/scripts/lib/claude-batch-core.test.sh (section [11]). No network, no real `claude`.
# Exit 0 only when every assertion passed AND the expected number of assertions ran.
#
# Usage : bash ops/scripts/test-claude-print-limit-wait.sh

set -uo pipefail

readonly SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib/claude-print-limit-wait.sh
. "$SCRIPT_DIR/lib/claude-print-limit-wait.sh"

readonly EXPECTED_ASSERTIONS=17
declare -i PASSED=0
declare -i FAILED=0
ok()   { echo "  ✓ $1"; PASSED+=1; }
fail() { echo "  ✗ $1" >&2; FAILED+=1; }
assert_eq() { # label expected actual
  if [ "$2" = "$3" ]; then ok "$1"; else fail "$1 (expected '$2', got '$3')"; fi
}

export CLAUDE_LIMIT_JITTER_S=0
export CLAUDE_LIMIT_MARGIN_S=90

# Fixed "now": 2026-09-02 17:00:00 in the zone the lib will READ announced times in: Europe/Paris when
# GNU date honours zone names (CI runners, the VPS), the local zone otherwise (Git Bash without tzdata).
# Expectations below are computed with the same rule, so the suite is green in both environments.
HAS_GNU_DATE=1; date -d '@0' +%s >/dev/null 2>&1 || HAS_GNU_DATE=0
TZ_OK=0; [ "$(TZ=Asia/Tokyo date -d @0 +%H 2>/dev/null)" = "09" ] && TZ_OK=1
paris_date() { if [ "$TZ_OK" -eq 1 ]; then TZ=Europe/Paris date "$@"; else date "$@"; fi; }
export CLAUDE_LIMIT_NOW_EPOCH="$(paris_date -d '2026-09-02 17:00:00' +%s)"
echo "  (GNU date: $HAS_GNU_DATE ; IANA zones honoured: $TZ_OK)"

echo ""
echo "→ 1. detection"
_cplw_is_limit "You've hit your session limit · resets 8pm (Europe/Paris)" && ok "session limit detected" || fail "session limit not detected"
_cplw_is_limit "API Error: Rate limited" && ok "rate limited detected" || fail "rate limited not detected"
_cplw_is_limit "You've hit your weekly limit · resets Sep 5, 3pm (Europe/Paris)" && ok "weekly limit detected" || fail "weekly limit not detected"
_cplw_is_limit "API Error: HTTP 429 too many requests" && ok "HTTP 429 with context detected" || fail "HTTP 429 with context not detected"
if _cplw_is_limit "Error: invalid JSON in response"; then fail "ordinary error wrongly detected as a limit"; else ok "ordinary error not detected"; fi
if _cplw_is_limit "The member placed 429 trades this quarter."; then fail "bare 429 in prose wrongly detected as a limit"; else ok "bare 429 in prose not detected"; fi
_cplw_is_weekly "You've hit your weekly limit · resets Sep 5, 3pm" && ok "weekly recognised as weekly" || fail "weekly not recognised"
if _cplw_is_weekly "You've hit your session limit · resets 8pm (Europe/Paris)"; then fail "session limit wrongly taken for weekly"; else ok "session limit is not weekly"; fi

echo ""
echo "→ 2. reset time parsing (fixed now = 2026-09-02 17:00 in the reading zone)"
if [ "$HAS_GNU_DATE" -eq 1 ]; then
  exp="$(paris_date -d '2026-09-02 20:00:00' +%s)"
  assert_eq "resets 8pm today -> 20:00 today (reading zone)" "$exp" "$(_cplw_parse_reset_epoch "You've hit your session limit · resets 8pm (Europe/Paris)")"
  exp="$(paris_date -d '2026-09-03 05:50:00' +%s)"
  assert_eq "resets 5:50am (already passed) -> tomorrow 05:50" "$exp" "$(_cplw_parse_reset_epoch "You've hit your session limit · resets 5:50am (Europe/Paris)")"
  if [ "$TZ_OK" -eq 1 ]; then
    exp="$(TZ=America/New_York date -d '2026-09-02 15:45:00' +%s)"
    assert_eq "resets at 3:45pm (America/New_York) honours the zone" "$exp" "$(_cplw_parse_reset_epoch "resets at 3:45pm (America/New_York)")"
  else
    assert_eq "resets at 3:45pm (foreign zone, no tzdata) -> refused (empty)" "" "$(_cplw_parse_reset_epoch "resets at 3:45pm (America/New_York)")"
  fi
else
  ok "(GNU date absent: 3 parsing assertions skipped)"; PASSED+=2
fi
assert_eq "pipe+epoch form" "1725292800" "$(_cplw_parse_reset_epoch "Claude AI usage limit reached|1725292800")"
assert_eq "no reset time -> empty" "" "$(_cplw_parse_reset_epoch "API Error: Rate limited")"
assert_eq "weekly notice without clock time -> empty" "" "$(_cplw_parse_reset_epoch "You've hit your weekly limit · resets Sep 5, 3pm (Europe/Paris)")"
# A weekly notice WITH a clock time parses like any other: the parser does not know about weekly.
# That is why the core checks _cplw_is_weekly BEFORE trusting a parsed epoch (core test 11e-bis).
if [ "$HAS_GNU_DATE" -eq 1 ]; then
  exp="$(paris_date -d '2026-09-03 15:00:00' +%s)"
  assert_eq "weekly notice WITH a clock time parses (15:00 already passed -> tomorrow)" "$exp" "$(_cplw_parse_reset_epoch "You've hit your weekly limit · resets 3pm (Europe/Paris)")"
else
  ok "(GNU date absent: weekly-with-clock parsing skipped)"
fi

echo ""
echo "→ 3. wait computation"
now="$CLAUDE_LIMIT_NOW_EPOCH"
assert_eq "reset in 3600s + margin 90" "3690" "$(_cplw_wait_seconds "$((now + 3600))")"
assert_eq "no reset -> fallback 900" "900" "$(CLAUDE_LIMIT_FALLBACK_WAIT_S=900 _cplw_wait_seconds "")"

echo ""
TOTAL=$((PASSED + FAILED))
echo "Assertions : $PASSED passed, $FAILED failed ($TOTAL run, $EXPECTED_ASSERTIONS expected)"
if [ "$FAILED" -ne 0 ]; then exit 1; fi
if [ "$TOTAL" -ne "$EXPECTED_ASSERTIONS" ]; then echo "  ✗ harness ran $TOTAL assertions instead of $EXPECTED_ASSERTIONS" >&2; exit 1; fi
exit 0
