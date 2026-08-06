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
echo "== grammar parity with run-batch.sh: BOTH parsers run, outputs compared =="
# This section used to consist of one `grep` for one line of run-batch.sh. A
# review falsified it in the smallest possible way: delete run-batch's
# single-quote strip and the two readers genuinely diverge —
#     run-batch -> K1=<'single'>      verify -> K1=<single>
# — while the bench still reported "23 passed, 0 failed". A presence check on
# one of six transformation statements cannot establish parity between two
# parsers. So now BOTH are extracted from their own shipped file, BOTH are
# executed on the same input, and their outputs are diffed byte for byte.
parser_slice() { # $1 source file, $2 output file
  local s e
  s="$(grep -n -E '^[[:space:]]*while IFS= read -r line; do' "$1" | head -1 | cut -d: -f1)"
  e="$(grep -n -E '^[[:space:]]*done[[:space:]]*<[[:space:]]*"\$ENV_FILE"' "$1" | head -1 | cut -d: -f1)"
  [[ -n "$s" && -n "$e" ]] || return 1
  sed -n "${s},${e}p" "$1" >"$2"
}
run_parser() { # $1 parser slice, $2 fixture -> "K1=<v>" lines for K1..K5
  {
    printf 'set -uo pipefail\n'
    printf 'ENV_FILE=%q\n' "$2"
    printf 'ENV_CR_SEEN=false\n'
    cat "$1"
    printf '\nfor k in K1 K2 K3 K4 K5; do printf "%%s=<%%s>\\n" "$k" "${!k-UNSET}"; done\n'
  } >"$TMP/p.sh"
  bash "$TMP/p.sh" 2>/dev/null
}

if [[ -r "$PRODUCER" ]] && parser_slice "$PRODUCER" "$TMP/prod.parser"; then
  ok "extracted run-batch.sh's parser ($(wc -l <"$TMP/prod.parser" | tr -d ' ') lines of ITS shipped text)"
else
  no "ANCHOR MOVED — cannot extract run-batch.sh's parser; parity is untested"
fi
if parser_slice "$TARGET" "$TMP/gate.parser"; then
  ok "extracted the gate's parser ($(wc -l <"$TMP/gate.parser" | tr -d ' ') lines)"
else
  no "ANCHOR MOVED — cannot extract the gate's parser"
fi

# One fixture per grammar hazard. Values are distinctive so a mismatch is
# readable in the failure message.
printf "K1='single'\nK2=\"double\"\nK3=has space\nK4=back\\\\slash\nK5=a=b=c\n" >"$TMP/par1.cfg"
printf 'K1=trailing   \nK2=\n#K3=commented\n\n   \nK4=\tleading-tab\nK5="unclosed\n' >"$TMP/par2.cfg"
printf 'K1="crlf-quoted"\r\nK2=crlf-bare\r\nK3=%s\r\n' "$(printf 'x')" >"$TMP/par3.cfg"
printf 'K1=no-trailing-newline' >"$TMP/par4.cfg"

PARITY_CASES=("$TMP/par1.cfg" "$TMP/par2.cfg" "$TMP/par3.cfg" "$TMP/par4.cfg")
parity_check() { # echoes the number of diverging cases
  local diverged=0 c a b
  for c in "${PARITY_CASES[@]}"; do
    a="$(run_parser "$TMP/prod.parser" "$c")"
    b="$(run_parser "$TMP/gate.parser" "$c")"
    if [[ "$a" != "$b" ]]; then
      diverged=$((diverged + 1))
      DIVERGENCE="case $(basename "$c"): run-batch[$(tr '\n' ' ' <<<"$a")] vs gate[$(tr '\n' ' ' <<<"$b")]"
    fi
  done
  printf '%s' "$diverged"
}
DIVERGENCE=""
D="$(parity_check)"
if [[ "$D" == "0" ]]; then
  ok "the two parsers agree byte for byte on all ${#PARITY_CASES[@]} grammar-hazard fixtures"
else
  no "the two parsers DISAGREE on $D case(s) — $DIVERGENCE"
fi

# Mutation control on the OTHER file: if run-batch's grammar changes and the
# gate's copy does not, this section must go red. That is the whole point of it.
if parser_slice "$PRODUCER" "$TMP/prod.parser"; then
  sed "/val=\"\${val%\\\\'}\"/d" "$PRODUCER" >"$TMP/producer.mutated"
  if parser_slice "$TMP/producer.mutated" "$TMP/prod.parser"; then
    D="$(parity_check)"
    if [[ "$D" == "0" ]]; then
      no "mutation: run-batch's quote handling changed and parity STILL passed — the comparison is fake"
    else
      ok "mutation: changing run-batch's grammar makes parity FAIL (got $D divergence(s)) — the comparison is live"
    fi
  fi
  parser_slice "$PRODUCER" "$TMP/prod.parser" # restore
fi

printf 'K=Ab3\\kQ9zLm2pXr7tVn4wYs6dGh1jFc8e\n' >"$TMP/backslash.cfg"
OUT="$(run_block "$TMP/backslash.cfg")"
has "$OUT" 'len=32' 'backslash: 32 bytes through the gate'

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
