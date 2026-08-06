#!/usr/bin/env bash
# Bench for ONE block of verify-worker-vps.sh: the part that reads the worker
# config file. It extracts the real block from the shipped script and EXECUTES
# it — it does not re-implement it, and the mutation controls at the bottom
# prove that distinction rather than asserting it.
#
# History, because it is the whole justification for the shape of this file.
# The block used to `.` (source) the config. Three defects came out of that one
# choice, and each was reproduced before it was believed:
#
#   GRAMMAR   `run-batch.sh` — the only thing that reads this file in production
#             — does not source, it parses `KEY=VALUE` with a regex. Sourcing
#             evaluates. `TOKEN=Ab3\kQ9z…` therefore gave the pipelines 32 bytes
#             and this gate 31. The gate would 401 on all seven and blame the
#             pipelines for a token it had corrupted itself.
#   BLACKOUT  the script runs under `set -u`. A value with an unquoted `$` made
#             the source reference an unset parameter, which killed the shell
#             INSIDE the `.` — so the error handling below it never ran. Exit 1,
#             zero bytes of output, on a healthy host.
#   LEAK      bash quotes the offending line verbatim on stderr, and this
#             script's stderr reaches a PUBLIC Actions log. And `$(…)` in a
#             hand-edited config is code execution as the worker user.
#
# The fix was to stop sourcing. So the assertions below are about GRAMMAR PARITY
# with run-batch.sh and about the three failures above being structurally
# impossible, not about formatting an error message nicely.
#
# CRITICAL: the block is executed under `set -uo pipefail`, the same options
# verify-worker-vps.sh sets on line 52. An earlier version of this bench ran it
# under default options, which is exactly why it could not see the blackout.
set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TARGET="$HERE/verify-worker-vps.sh"
PRODUCER="$HERE/run-batch.sh"
PASS=0
FAIL=0
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

ok() { PASS=$((PASS + 1)); printf '  ok   %s\n' "$1"; }
no() { FAIL=$((FAIL + 1)); printf '  FAIL %s\n' "$1"; }
check() { if [[ "$2" == "$3" ]]; then ok "$1"; else no "$1 (expected [$3], got [$2])"; fi; }
has() { if grep -qF -- "$2" <<<"$1"; then ok "$3"; else no "$3 — not found"; fi; }
hasnt() { if grep -qF -- "$2" <<<"$1"; then no "$3 — LEAKED: found [$2]"; else ok "$3"; fi; }

require_anchor() {
  if grep -qF -- "$1" "$TARGET"; then
    ok "anchor: $2"
  else
    no "ANCHOR MOVED — this bench no longer covers the shipped code: $2"
  fi
}

echo "== the block must NOT evaluate the file =="
require_anchor 'while IFS= read -r line; do' 'it parses line by line'
require_anchor 'BASH_REMATCH[1]' 'it uses the regex capture, not the shell'
if grep -qE '^\s*\.\s+"\$ENV_TMP"|^\s*source\s' "$TARGET"; then
  no 'the script sources the config again — the whole class is back'
else
  ok 'no `source` / `.` of the config anywhere in the script'
fi
require_anchor 'VERIFY_LOG_REQUESTED="${FXMILY_VERIFY_LOG:-}"' 'the transcript destination is captured BEFORE the read'
require_anchor '(umask 077 && : >"$LOG")' 'the transcript file is created 0600'

# ── extract the real block ────────────────────────────────────────────────────
# Both boundary strings are asserted as anchors: an earlier version anchored
# only the interior, so a lost boundary silently extracted the WRONG lines and
# every behavioural assertion below went green against code that never ran.
START_ANCHOR='VERIFY_LOG_REQUESTED="${FXMILY_VERIFY_LOG:-}"'
END_ANCHOR='  echo "  note   : CR bytes stripped'
require_anchor "$START_ANCHOR" 'extraction START boundary'
require_anchor "$END_ANCHOR" 'extraction END boundary'
START="$(grep -n -F -- "$START_ANCHOR" "$TARGET" | head -1 | cut -d: -f1)"
LASTMSG="$(grep -n -F -- "$END_ANCHOR" "$TARGET" | head -1 | cut -d: -f1)"
if [[ -z "$START" || -z "$LASTMSG" ]]; then
  no "could not locate the block (start=$START end=$LASTMSG)"
  echo "$PASS passed, $FAIL failed"
  exit 1
fi
END="$(awk 'NR>'"$LASTMSG"' && /^fi$/ {print NR; exit}' "$TARGET")"
[[ -n "$END" ]] || END="$LASTMSG"
ok "block located at lines $START-$END"
sed -n "${START},${END}p" "$TARGET" >"$TMP/block.sh"

# Runs the real block under the real shell options, then prints what it loaded.
run_block() { # $1 = config fixture
  {
    printf 'set -uo pipefail\n'
    printf 'ENV_FILE=%q\n' "$1"
    cat "$TMP/block.sh"
    printf '\nprintf "LOADED len=%%s val=[%%s]\\n" "${#K}" "${K:-}"\n'
    printf 'printf "SIDEEFFECT=%%s\\n" "${SIDE:-none}"\n'
    printf 'echo "REACHED_END"\n'
  } >"$TMP/run.sh"
  ( cd "$TMP" && bash "$TMP/run.sh" ) 2>&1
}

echo
echo "== a value containing an unquoted \$ must not blackout the gate =="
# The regression that mattered most: this used to exit 1 with zero bytes.
printf 'K=Ab3$kQ9zLm2pXr7tVn4wYs6dGh1jFc8e\n' >"$TMP/dollar.cfg"
OUT="$(run_block "$TMP/dollar.cfg")"
has "$OUT" 'REACHED_END' 'dollar: the gate survives instead of dying mute'
has "$OUT" 'len=32' 'dollar: the value is read literally, all 32 bytes'
hasnt "$OUT" 'unbound variable' 'dollar: set -u is never tripped'

echo
echo "== grammar parity with run-batch.sh, the only production reader =="
# A backslash is an escape to the shell and a byte to the parser. Under the old
# source-based reader the gate loaded 31 bytes where the pipelines loaded 32,
# then blamed the pipelines for the 401 it had caused.
printf 'K=Ab3\\kQ9zLm2pXr7tVn4wYs6dGh1jFc8e\n' >"$TMP/backslash.cfg"
OUT="$(run_block "$TMP/backslash.cfg")"
has "$OUT" 'len=32' 'backslash: 32 bytes, same as the parser in run-batch.sh'
if [[ -r "$PRODUCER" ]] && grep -qF 'val="${val%$'"'"'\r'"'"'}"' "$PRODUCER"; then
  ok 'run-batch.sh still strips CR before quotes (the order this copies)'
else
  no 'run-batch.sh parser changed — this copy must be re-synced with it'
fi

echo
echo "== an apostrophe in a value is data, not a syntax error =="
printf "K=Eliot's box\n" >"$TMP/apos.cfg"
OUT="$(run_block "$TMP/apos.cfg")"
has "$OUT" 'REACHED_END' 'apostrophe: accepted, as run-batch.sh accepts it'
has "$OUT" "val=[Eliot's box]" 'apostrophe: value intact'

echo
echo "== command substitution in the file must NOT execute =="
printf 'K=harmless\nSIDE=$(echo PWNED)\n' >"$TMP/rce.cfg"
OUT="$(run_block "$TMP/rce.cfg")"
hasnt "$OUT" 'SIDEEFFECT=PWNED' 'rce: $(...) is NOT evaluated'
has "$OUT" 'REACHED_END' 'rce: and the gate carries on'

echo
echo "== CRLF and quotes are stripped, in that order =="
printf 'K="quoted-value"\r\n' >"$TMP/crlf.cfg"
OUT="$(run_block "$TMP/crlf.cfg")"
has "$OUT" 'val=[quoted-value]' 'crlf: CR stripped before the closing quote'
has "$OUT" 'CR bytes stripped' 'crlf: and the operator is told'

echo
echo "== nothing is written to stderr on a healthy read =="
printf 'K=plain\n' >"$TMP/clean.cfg"
ERRF="$TMP/err.txt"
{
  printf 'set -uo pipefail\n'
  printf 'ENV_FILE=%q\n' "$TMP/clean.cfg"
  cat "$TMP/block.sh"
} >"$TMP/quiet.sh"
bash "$TMP/quiet.sh" >/dev/null 2>"$ERRF"
check "clean read produces zero bytes of stderr" "$(wc -c <"$ERRF" | tr -d ' ')" "0"

echo
echo "== mutation controls: the OLD reader must fail every check above =="
# Not a mutation of this bench's own copy — a stand-in for the code that shipped
# before, run under the same options, so the assertions are shown to be live.
cat >"$TMP/old.sh" <<'OLD'
set -uo pipefail
set -a
. "$ENV_FILE"
set +a
printf "LOADED len=%s val=[%s]\n" "${#K}" "${K:-}"
printf "SIDEEFFECT=%s\n" "${SIDE:-none}"
echo "REACHED_END"
OLD
OUT="$( ( export ENV_FILE="$TMP/dollar.cfg"; bash "$TMP/old.sh" ) 2>&1 )"
if grep -qF 'REACHED_END' <<<"$OUT"; then
  no 'mutation: the old reader survived the $ case — the blackout test proves nothing'
else
  ok 'mutation: the old reader DOES die on the $ case (blackout was real)'
fi
OUT="$( ( export ENV_FILE="$TMP/rce.cfg"; bash "$TMP/old.sh" ) 2>&1 )"
if grep -qF 'SIDEEFFECT=PWNED' <<<"$OUT"; then
  ok 'mutation: the old reader DOES execute $(...) (the RCE was real)'
else
  no 'mutation: the old reader did not execute $(...) — the rce test proves nothing'
fi
OUT="$( ( export ENV_FILE="$TMP/backslash.cfg"; bash "$TMP/old.sh" ) 2>&1 )"
if grep -qF 'len=32' <<<"$OUT"; then
  no 'mutation: the old reader also gave 32 — the parity test proves nothing'
else
  ok 'mutation: the old reader gave a DIFFERENT length (grammar mismatch was real)'
fi

echo
echo "$PASS passed, $FAIL failed"
[[ "$FAIL" -eq 0 ]]
