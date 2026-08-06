#!/usr/bin/env bash
# Bench for ONE block of verify-worker-vps.sh: the part that reads worker.env.
#
# Why this file exists. That block runs inside a GitHub Actions job on a PUBLIC
# repository, and until 2026-08-06 it sourced the file with our own stderr
# attached. Measured in debian:bookworm on that date, both leaks are real:
#
#   $ printf 'K=one two three-sensitive\n' > f; . f
#   bash: two: command not found            <-- second word of the value
#   $ printf 'this is not valid shell (\n' > f; . f
#   f: line 1: `this is not valid shell ('  <-- the whole line, verbatim
#
# `worker.env` holds the admin token and is hand-edited. So the block must fail
# LOUDLY and say WHERE, while never repeating WHAT.
#
# Like the watchdog bench, this does not re-implement the block: it extracts it
# from the shipped script by anchored markers and runs the real text. If an
# anchor stops matching, the test fails rather than quietly testing a copy.
set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TARGET="$HERE/verify-worker-vps.sh"
PASS=0
FAIL=0
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

ok() {
  PASS=$((PASS + 1))
  printf '  ok   %s\n' "$1"
}
no() {
  FAIL=$((FAIL + 1))
  printf '  FAIL %s\n' "$1"
}
check() { if [[ "$2" == "$3" ]]; then ok "$1"; else no "$1 (expected [$3], got [$2])"; fi; }
has() { if grep -qF -- "$2" <<<"$1"; then ok "$3"; else no "$3 — not found in output"; fi; }
hasnt() { if grep -qF -- "$2" <<<"$1"; then no "$3 — LEAKED: found [$2]"; else ok "$3"; fi; }

require_anchor() {
  if grep -qF -- "$1" "$TARGET"; then
    ok "anchor present: $2"
  else
    no "ANCHOR MOVED — this test no longer covers the shipped code: $2"
  fi
}

echo "== anchors (if these move, the bench is testing nothing) =="
require_anchor '. "$ENV_TMP" 2>"$ENV_ERR"' 'stderr of the source is captured'
require_anchor 'ENV_RC=$?' 'the exit status is read'
require_anchor 'grep -oE '"'"'line [0-9]+'"'"' "$ENV_ERR"' 'only line numbers are extracted'
require_anchor 'the message is withheld on purpose' 'the withholding is explicit to the reader'
require_anchor 'trap '"'"'rm -f "$ENV_TMP" "$ENV_ERR"'"'"' EXIT' 'both temp files are cleaned up'

# Extract the block: from the mktemp of ENV_TMP down to the closing `fi` of the
# validity check. Everything above it in the real script is path setup we stub.
# The END anchor is the `fi` that closes the VALIDITY check, not the first `fi`
# below START — the CR check sits in between and closes first. Getting this
# wrong extracted 7 lines that never source anything, and every assertion below
# went red at once; that is the bench working, so the anchor is pinned tightly.
START="$(grep -n 'ENV_TMP="\$(mktemp)"' "$TARGET" | head -1 | cut -d: -f1)"
LASTMSG="$(grep -n 'Most common cause' "$TARGET" | head -1 | cut -d: -f1)"
END="$(awk 'NR>'"${LASTMSG:-0}"' && /^fi$/ {print NR; exit}' "$TARGET")"
if [[ -z "$START" || -z "$END" ]]; then
  no "could not locate the block (start=$START end=$END)"
  echo "$PASS passed, $FAIL failed"
  exit 1
fi
ok "block located at lines $START-$END"
sed -n "${START},${END}p" "$TARGET" >"$TMP/block.sh"

run_block() {
  # $1 = fixture path, $2 = optional sed mutation applied to the block
  local body="$TMP/block.sh"
  if [[ -n "${2:-}" ]]; then
    sed "$2" "$TMP/block.sh" >"$TMP/mutated.sh"
    body="$TMP/mutated.sh"
  fi
  {
    printf 'ENV_FILE=%q\n' "$1"
    cat "$body"
    printf '\necho "REACHED_END rc=$?"\n'
  } >"$TMP/run.sh"
  bash "$TMP/run.sh" 2>&1
}

echo
echo "== a valid file loads silently and reaches the end =="
printf 'FXMILY_ADMIN_TOKEN=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\nFXMILY_APP_URL=https://example.invalid\n' >"$TMP/good.cfg"
OUT="$(run_block "$TMP/good.cfg")"
has "$OUT" 'REACHED_END' 'valid file: execution continues'
hasnt "$OUT" 'FAIL' 'valid file: no false alarm'

echo
echo "== a malformed line fails, names the line, hides the content =="
printf 'FXMILY_ADMIN_TOKEN=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\nthis is not valid shell (\n' >"$TMP/broken.cfg"
OUT="$(run_block "$TMP/broken.cfg")"
has "$OUT" 'is not valid shell' 'malformed: it fails'
has "$OUT" 'offending line(s): 2' 'malformed: the line number is given'
hasnt "$OUT" 'this is not valid shell (' 'malformed: the line itself is NOT printed'
hasnt "$OUT" 'REACHED_END' 'malformed: it stops instead of carrying on half-loaded'

echo
echo "== an unquoted value with spaces leaks nothing =="
printf 'FXMILY_ADMIN_TOKEN=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\nK=one zzsensitivezz three\n' >"$TMP/unquoted.cfg"
OUT="$(run_block "$TMP/unquoted.cfg")"
has "$OUT" 'is not valid shell' 'unquoted: it fails'
hasnt "$OUT" 'zzsensitivezz' 'unquoted: the value word is NOT printed'
hasnt "$OUT" 'REACHED_END' 'unquoted: it stops'

echo
echo "== mutation control: without the capture, the bench MUST go red =="
# Removing `2>"$ENV_ERR"` is exactly the pre-2026-08-06 code. If the assertions
# above still pass against it, they are not testing anything.
OUT="$(run_block "$TMP/broken.cfg" 's|\. "\$ENV_TMP" 2>"\$ENV_ERR"|. "$ENV_TMP"|')"
if grep -qF 'this is not valid shell (' <<<"$OUT"; then
  ok 'mutation: the old code DOES leak the line verbatim (assertions are live)'
else
  no 'mutation: the old code did not leak — the leak assertions prove nothing'
fi
OUT="$(run_block "$TMP/unquoted.cfg" 's|\. "\$ENV_TMP" 2>"\$ENV_ERR"|. "$ENV_TMP"|')"
if grep -qF 'zzsensitivezz' <<<"$OUT"; then
  ok 'mutation: the old code DOES leak the value word'
else
  no 'mutation: the old code did not leak the value word'
fi

echo
echo "$PASS passed, $FAIL failed"
[[ "$FAIL" -eq 0 ]]
