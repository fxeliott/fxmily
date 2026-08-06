#!/usr/bin/env bash
# Bench for the quota escalation in `fxmily-worker-watchdog` — the EMITTER.
#
# WHY THIS FILE WAS REWRITTEN ON 2026-08-06, which is the only thing about it
# worth remembering. Its first version claimed, in its own header, that it did
# "not re-implement the predicates" but "extracted them from the shipped
# watchdog and evaluated the real text". That was FALSE. It hand-copied the two
# predicates into two local functions and tested those. A fresh-context review
# proved it: deleting the freshness gate from the SHIPPED watchdog — the exact
# defect the file says it exists to catch — left the bench at 22 OK / exit 0,
# including the assertion "a 20-day-old cooldown is IGNORED", which the shipped
# code no longer did. Meanwhile renaming a constant made it red. Its detection
# profile was precisely inverted: blind to logic, loud on cosmetics.
#
# This is the same disease as the bug it was written to cover, one level up. The
# original finding was "every test exercised the CONSUMER, none the EMITTER".
# The cure was an emitter test that tested a copy of the emitter.
#
# So: this version LOCATES the two real blocks by anchored boundaries, SLICES
# them out of the shipped file, and EXECUTES that text inside a harness that
# supplies the surrounding variables and a fake `add_label`. No predicate is
# retyped here. The mutation controls at the bottom edit a COPY OF THE REAL FILE
# and re-run, so "this bench can go red on a logic change" is demonstrated
# rather than asserted.
set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TARGET="$HERE/fxmily-worker-watchdog"
PASS=0
FAIL=0
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

ok() { PASS=$((PASS + 1)); printf '  [OK]   %s\n' "$1"; }
bad() { FAIL=$((FAIL + 1)); printf '  [FAIL] %s\n' "$1"; }
expect() { if [[ "$2" == "$3" ]]; then ok "$1"; else bad "$1 : expected <$2> got <$3>"; fi; }

[[ -r "$TARGET" ]] || {
  echo "cannot read $TARGET" >&2
  exit 1
}

# ── slice the two real blocks ────────────────────────────────────────────────
# $1 = file to slice from, $2 = start anchor (literal), $3 = end regex for awk
slice() {
  local src="$1" start_anchor="$2" end_re="$3" s e
  s="$(grep -n -F -- "$start_anchor" "$src" | head -1 | cut -d: -f1)"
  [[ -n "$s" ]] || return 1
  e="$(awk 'NR>'"$s"' && /'"$end_re"'/ {print NR; exit}' "$src")"
  [[ -n "$e" ]] || return 1
  sed -n "${s},${e}p" "$src"
}

DETECT_ANCHOR='status_age_min=$(((NOW_EPOCH'
EPISODE_ANCHOR='QUOTA_EPISODE="$LOG_DIR/quota-episode.start"'

if slice "$TARGET" "$DETECT_ANCHOR" '^  fi$' >"$TMP/detect.sh"; then
  ok "sliced the detection block ($(wc -l <"$TMP/detect.sh" | tr -d ' ') lines of shipped text)"
else
  bad "ANCHOR MOVED — cannot slice the detection block; this bench covers nothing"
fi
if slice "$TARGET" "$EPISODE_ANCHOR" '^fi$' >"$TMP/episode.sh"; then
  ok "sliced the episode block ($(wc -l <"$TMP/episode.sh" | tr -d ' ') lines of shipped text)"
else
  bad "ANCHOR MOVED — cannot slice the episode block; this bench covers nothing"
fi
# A slice that lost its body would still "run" and emit nothing, so assert the
# decisive lines are inside what is about to be executed — not merely present
# somewhere in the file.
if grep -qF 'add_label ' "$TMP/detect.sh"; then
  ok "the detection slice contains its emit"
else
  bad "the detection slice lost its emit — it would pass by being empty"
fi
if grep -qF 'claude_quota:stalled' "$TMP/episode.sh"; then
  ok "the episode slice contains its emit"
else
  bad "the episode slice lost its emit — it would pass by being empty"
fi

# ── harnesses: run the shipped text, capture what it emits ───────────────────
run_detect() { # $1 status file, $2 capped, $3 skipped, $4 initial QUOTA_SEEN
  {
    printf 'set -uo pipefail\n'
    printf 'NOW_EPOCH=$(date +%%s)\n'
    printf 'QUOTA_FRESH_MIN="${FXMILY_WORKER_QUOTA_FRESH_MIN:-90}"\n'
    printf 'LABELS=""\n'
    printf 'add_label() { LABELS="$LABELS$1 "; }\n'
    printf 'status_file=%q\n' "$1"
    printf 'capped=%q\n' "$2"
    printf 'skipped=%q\n' "$3"
    printf 'QUOTA_SEEN=%q\n' "$4"
    cat "$TMP/detect.sh"
    printf '\nprintf "%%s|%%s" "$LABELS" "$QUOTA_SEEN"\n'
  } >"$TMP/rd.sh"
  bash "$TMP/rd.sh" 2>/dev/null
}

run_episode() { # $1 QUOTA_SEEN, $2 log dir
  {
    printf 'set -uo pipefail\n'
    printf 'LABELS=""\n'
    printf 'add_label() { LABELS="$LABELS$1 "; }\n'
    printf 'QUOTA_SEEN=%q\n' "$1"
    printf 'LOG_DIR=%q\n' "$2"
    cat "$TMP/episode.sh"
    printf '\nprintf "%%s" "$LABELS"\n'
  } >"$TMP/re.sh"
  bash "$TMP/re.sh" 2>/dev/null
}

FRESH="$TMP/fresh.json"
FOSSIL="$TMP/fossil.json"
: >"$FRESH"
: >"$FOSSIL" && touch -d "20 days ago" "$FOSSIL"

echo
echo "— the pause is seen on BOTH states, not just the rare one —"
expect "the tick that HITS the cap" "claude_quota:capped |true" "$(run_detect "$FRESH" true '' false)"
expect "a tick in COOLDOWN (40 of every 60 minutes)" "claude_quota:capped |true" "$(run_detect "$FRESH" false quota_cooldown false)"
expect "a healthy tick emits nothing" "|false" "$(run_detect "$FRESH" false '' false)"
expect "an unrelated skip reason emits nothing" "|false" "$(run_detect "$FRESH" false account_unexpected false)"
expect "already seen: no duplicate label" "|true" "$(run_detect "$FRESH" true '' true)"

echo
echo "— a quota state older than the cooldown is a fossil, not a state —"
expect "20-day-old cooldown (a monthly pipeline) is IGNORED" "|false" "$(run_detect "$FOSSIL" false quota_cooldown false)"

echo
echo "— the episode measures duration, and says so when it cannot —"
LD="$TMP/logs"
mkdir -p "$LD"
rm -f "$LD/quota-episode.start"
expect "first tick of a pause: not yet stalled" "" "$(run_episode true "$LD")"
if [[ -f "$LD/quota-episode.start" ]]; then
  ok "first tick CREATED the episode marker"
else
  bad "the episode marker was not created"
fi

date -d '7 hours ago' +%s >"$LD/quota-episode.start"
expect "a 7h pause escalates with its duration" "claude_quota:stalled:7h " "$(run_episode true "$LD")"

date -d '1 hour ago' +%s >"$LD/quota-episode.start"
expect "a 1h pause does NOT escalate" "" "$(run_episode true "$LD")"

: >"$LD/quota-episode.start"
expect "a zero-byte marker says the instrument is broken" "quota_episode_unwritable " "$(run_episode true "$LD")"
if [[ ! -f "$LD/quota-episode.start" ]]; then
  ok "the debris is cleared so the next tick can recover"
else
  bad "the zero-byte marker survived — the escalation stays off forever"
fi

date -d '7 hours ago' +%s >"$LD/quota-episode.start"
expect "quota gone: no label" "" "$(run_episode false "$LD")"
if [[ ! -f "$LD/quota-episode.start" ]]; then
  ok "quota gone: the episode is closed"
else
  bad "the episode marker outlived the pause"
fi

# ── mutation controls, applied to a COPY OF THE SHIPPED FILE ─────────────────
# This is exactly what the previous version got wrong: it mutated its own copy
# of the logic, which proves nothing about the watchdog. These edit the real
# text, re-slice from the mutated copy, and re-run.
echo
echo "— mutation controls: break the SHIPPED file, the bench must go red —"
mutate() { # $1 sed expression -> echoes the verdict under the mutation
  local mutated="$TMP/mutated" fixture="$2"
  sed "$1" "$TARGET" >"$mutated"
  slice "$mutated" "$DETECT_ANCHOR" '^  fi$' >"$TMP/detect.sh" || {
    printf 'SLICE_FAILED'
    return
  }
  run_detect "$fixture" false quota_cooldown false
}
OUT="$(mutate '/\[\[ "\$status_age_min" -le "\$QUOTA_FRESH_MIN" \]\] &&/d' "$FOSSIL")"
if [[ "$OUT" == "|false" ]]; then
  bad "deleting the freshness gate did NOT change the verdict — the fossil test is a tautology"
else
  ok "deleting the freshness gate makes the fossil count (got <$OUT>) — the gate is really tested"
fi
OUT="$(mutate "s/add_label 'claude_quota:capped'/add_label 'something_else'/" "$FRESH")"
if [[ "$OUT" == "claude_quota:capped |true" ]]; then
  bad "renaming the emitted label did NOT change the verdict — the label is not really read"
else
  ok "renaming the emitted label changes the verdict (got <$OUT>)"
fi
# Restore the real slice so nothing below could run against a mutated copy.
slice "$TARGET" "$DETECT_ANCHOR" '^  fi$' >"$TMP/detect.sh"
expect "restored: the real file still behaves correctly" "claude_quota:capped |true" "$(run_detect "$FRESH" true '' false)"

echo
if [[ "$FAIL" -eq 0 ]]; then
  echo "WATCHDOG QUOTA EMITTER: PASSED ($PASS checks)"
else
  echo "WATCHDOG QUOTA EMITTER: FAILED ($FAIL of $((PASS + FAIL)))"
fi
exit "$FAIL"
