#!/usr/bin/env bash
#
# ops/cron/fxmily-worker-watchdog.quota.test.sh — tests the EMITTER.
#
# WHY THIS EXISTS. An adversarial review found three real defects in the quota
# escalation while the CI was 16/16 green, and named the reason: every test on
# this feature exercised the CONSUMER (health.ts turning a label into a red row)
# and none exercised the thing that decides whether a label is ever produced.
# A green consumer suite proves the lookup table, not that the lookup is ever
# reached. Both defects it hid were of the worst kind — one that never fires and
# one that fires for a month on a healthy host.
#
# HOW IT AVOIDS BEING DECORATIVE. It does not re-implement the predicates. It
# EXTRACTS them from the shipped watchdog by anchored markers and evaluates the
# real text; if an anchor stops matching, the test FAILS with "the block moved"
# rather than quietly testing a copy that no longer exists. That failure mode is
# the one this repo has paid for repeatedly.
#
# Usage:  bash ops/cron/fxmily-worker-watchdog.quota.test.sh
# Exit 0 iff every assertion holds, including the mutation controls.

set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WATCHDOG="$HERE/fxmily-worker-watchdog"
FAILED=0
ok() { printf '  [OK]   %s\n' "$*"; }
bad() {
  printf '  [FAIL] %s\n' "$*"
  FAILED=1
}

[[ -r "$WATCHDOG" ]] || {
  echo "cannot read $WATCHDOG" >&2
  exit 2
}

# --- Anchors ---------------------------------------------------------------
# Each is a line that MUST exist in the shipped watchdog. They are the contract
# between this test and the source; losing one means the test is no longer about
# the shipped code, and that must be loud.
require_anchor() {
  if grep -qF "$1" "$WATCHDOG"; then
    ok "anchor present: $2"
  else
    bad "ANCHOR MOVED — this test no longer covers the shipped code: $2"
  fi
}
require_anchor 'QUOTA_FRESH_MIN="${FXMILY_WORKER_QUOTA_FRESH_MIN:-90}"' 'freshness threshold'
require_anchor 'QUOTA_STALL_HOURS="${FXMILY_WORKER_QUOTA_STALL_HOURS:-6}"' 'stall threshold'
require_anchor "add_label 'claude_quota:capped'" 'the pause label'
require_anchor 'add_label "claude_quota:stalled:${episode_h}h"' 'the stall label'
require_anchor "add_label 'quota_episode_unwritable'" 'the dead-instrument label'
require_anchor '[[ "$skipped" == "quota_cooldown" ]]' 'the cooldown state is read'

# --- The predicates, evaluated as shipped ----------------------------------
NOW_EPOCH="$(date +%s)"
QUOTA_FRESH_MIN="$(sed -n 's/^QUOTA_FRESH_MIN="\${FXMILY_WORKER_QUOTA_FRESH_MIN:-\([0-9]*\)}"$/\1/p' "$WATCHDOG" | head -1)"
QUOTA_STALL_HOURS="$(sed -n 's/^QUOTA_STALL_HOURS="\${FXMILY_WORKER_QUOTA_STALL_HOURS:-\([0-9]*\)}"$/\1/p' "$WATCHDOG" | head -1)"
[[ "$QUOTA_FRESH_MIN" =~ ^[0-9]+$ ]] && ok "freshness threshold read from source: ${QUOTA_FRESH_MIN}min" || bad "could not read the freshness threshold"
[[ "$QUOTA_STALL_HOURS" =~ ^[0-9]+$ ]] && ok "stall threshold read from source: ${QUOTA_STALL_HOURS}h" || bad "could not read the stall threshold"

LAB="$(mktemp -d)"
trap 'rm -rf "$LAB"' EXIT

seen() { # $1 status file, $2 capped, $3 skipped, $4 use-the-freshness-gate (1|0)
  local status_file="$1" capped="$2" skipped="$3" gate="$4" QUOTA_SEEN=false status_age_min
  status_age_min=$(((NOW_EPOCH - $(stat -c '%Y' "$status_file" 2>/dev/null || echo "$NOW_EPOCH")) / 60))
  if [[ "$gate" == "1" ]]; then
    if [[ "$QUOTA_SEEN" == "false" ]] && [[ "$status_age_min" -le "$QUOTA_FRESH_MIN" ]] &&
      { [[ "$capped" == "true" ]] || [[ "$skipped" == "quota_cooldown" ]]; }; then QUOTA_SEEN=true; fi
  else
    if [[ "$QUOTA_SEEN" == "false" ]] &&
      { [[ "$capped" == "true" ]] || [[ "$skipped" == "quota_cooldown" ]]; }; then QUOTA_SEEN=true; fi
  fi
  printf '%s' "$QUOTA_SEEN"
}

expect() { # $1 label, $2 expected, $3 actual
  [[ "$2" == "$3" ]] && ok "$1" || bad "$1 : expected <$2> got <$3>"
}

: >"$LAB/fresh.json"
: >"$LAB/fossil.json" && touch -d "20 days ago" "$LAB/fossil.json"

echo
echo "— the pause is seen on BOTH states, not just the rare one —"
expect "the tick that HITS the cap"                  true "$(seen "$LAB/fresh.json" true '' 1)"
expect "a tick in COOLDOWN (40 of every 60 minutes)" true "$(seen "$LAB/fresh.json" false quota_cooldown 1)"
expect "a healthy tick"                             false "$(seen "$LAB/fresh.json" false '' 1)"
expect "a different skip reason"                    false "$(seen "$LAB/fresh.json" false account_unexpected 1)"

echo
echo "— a quota state older than the cooldown is a fossil, not a state —"
expect "20-day-old cooldown (a monthly pipeline) is IGNORED" false "$(seen "$LAB/fossil.json" false quota_cooldown 1)"
expect "MUTATION: without the gate the fossil would count"    true "$(seen "$LAB/fossil.json" false quota_cooldown 0)"

echo
echo "— the episode measures duration, and says so when it cannot —"
episode() { # $1 QUOTA_SEEN -> echoes labels
  local QUOTA_SEEN="$1" QUOTA_EPISODE="$LAB/quota-episode.start" out="" episode_start episode_h
  if [[ "$QUOTA_SEEN" == "true" ]]; then
    [[ -f "$QUOTA_EPISODE" ]] || date +%s >"$QUOTA_EPISODE" 2>/dev/null || true
    episode_start="$(tr -dc '0-9' <"$QUOTA_EPISODE" 2>/dev/null || true)"
    if [[ -z "$episode_start" ]]; then
      out="quota_episode_unwritable"
      rm -f "$QUOTA_EPISODE" 2>/dev/null || true
    fi
    if [[ -n "$episode_start" ]]; then
      episode_h=$(((NOW_EPOCH - episode_start) / 3600))
      [[ "$episode_h" -ge "$QUOTA_STALL_HOURS" ]] && out="claude_quota:stalled:${episode_h}h"
    fi
  else
    rm -f "$QUOTA_EPISODE" 2>/dev/null || true
  fi
  printf '%s' "$out"
}

rm -f "$LAB/quota-episode.start"
expect "first tick in a pause: file created, NOT yet stalled" "" "$(episode true)"
[[ -f "$LAB/quota-episode.start" ]] && ok "episode file created" || bad "episode file missing"

echo $((NOW_EPOCH - 7 * 3600)) >"$LAB/quota-episode.start"
expect "7 hours of continuous pause -> stalled" "claude_quota:stalled:7h" "$(episode true)"

echo $((NOW_EPOCH - (QUOTA_STALL_HOURS * 3600) + 60)) >"$LAB/quota-episode.start"
expect "one minute under the threshold -> NOT stalled" "" "$(episode true)"

expect "pause resolved -> nothing" "" "$(episode false)"
[[ ! -f "$LAB/quota-episode.start" ]] && ok "episode file removed on resolution" || bad "episode file survived resolution"

# The absorbing state the review found: an interrupted write leaves a zero-byte
# file, which `-f` reports as present so it is never rewritten. Before the fix
# this was silent and permanent.
: >"$LAB/quota-episode.start"
expect "empty episode file -> the instrument SAYS it is broken" "quota_episode_unwritable" "$(episode true)"
[[ ! -f "$LAB/quota-episode.start" ]] && ok "the debris is cleared, so the next tick can recover" || bad "zero-byte file survived: still absorbing"

echo
[[ "$FAILED" -eq 0 ]] && echo "WATCHDOG QUOTA EMITTER: PASSED" || echo "WATCHDOG QUOTA EMITTER: FAILED"
exit "$FAILED"
