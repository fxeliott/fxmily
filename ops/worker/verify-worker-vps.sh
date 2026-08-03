#!/usr/bin/env bash
#
# ops/worker/verify-worker-vps.sh — prove the 7 pipelines actually work on this
# host. J9 "Done quand" #1: «7/7 batches exécutés avec succès depuis le VPS en
# dry-run — preuve logs».
#
# WHY A SCRIPT AND NOT A CHECKLIST. "I ran them and it looked fine" is not a
# proof. This runs all seven in `--dry-run` against the REAL prod endpoints with
# the REAL tokens and prints a per-pipeline verdict.
#
# WHAT `--dry-run` ACTUALLY EXERCISES — and this is the part a checklist gets
# wrong. Three of the seven pipelines (onboarding, verification, seances) exit
# right after saving the envelope: "--dry-run set. Skipping claude --print +
# persist." So for those three, a dry-run proves the token, the endpoint and the
# envelope shape — and NOTHING about generation. Reporting them as `PASS/empty`
# alongside the four that really do call the model would be a false green about
# exactly the thing this jalon exists to verify. They get their own verdict:
#
#   PASS/pull-only   token + endpoint + envelope OK. The pipeline short-circuits
#                    before any model call by design, so generation is NOT
#                    covered by this run. Only a real (non-dry) run covers it.
#   PASS/generated   the pull returned work AND `claude --print` produced valid
#                    JSON for it (nothing persisted — that is what --dry-run is)
#   PASS/empty       the pull returned no work, so the batch stopped before the
#                    model call. A real pass: token, endpoint, envelope, guard.
#   FAIL/no-auth     the pull worked but every generation failed and the circuit
#                    breaker halted. On this host that means exactly one thing:
#                    no Claude account is signed in. Reported as a FAILURE on
#                    purpose — a green run that generated nothing would be the
#                    very lie this jalon exists to remove.
#
# `--dry-run` is passed to every pipeline, so this NEVER writes anything
# member-facing.
#
# IT TAKES THE WORKER LOCK. Each pipeline is launched through `run-batch.sh`,
# not directly, so it acquires the same MACHINE-GLOBAL lock the cron ticks use.
# Calling the batch scripts directly would have left this script running for
# hours while cron happily started a SECOND `claude --print` on the same
# account — defeating the one-at-a-time guarantee that is the entire anti-ban
# design, in the very script meant to prove that design works. A tick that
# arrives while this runs exits benignly ("lock held"), which is correct.
#
# Usage :
#   bash ops/worker/verify-worker-vps.sh            # honest timings
#   bash ops/worker/verify-worker-vps.sh --fast     # 30s sleeps + breaker at 1
#                                                    # (diagnosis only — NEVER a
#                                                    # substitute for the real
#                                                    # run when signed in)
#
# Exit code: 0 iff all 7 pipelines pass.

set -uo pipefail

FAST=false
[[ "${1:-}" == "--fast" ]] && FAST=true

WORKER_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$WORKER_DIR/../.." && pwd)"
export PATH="$HOME/.npm-global/bin:$HOME/bin:$PATH"

ENV_FILE="${FXMILY_WORKER_ENV:-$WORKER_DIR/worker.env}"
[[ -r "$ENV_FILE" ]] || {
  echo "worker.env not readable at $ENV_FILE" >&2
  exit 2
}
# Source through a CR-stripped copy, NOT directly.
#
# `run-batch.sh` strips the CR from every token it reads, because `worker.env` is
# hand-edited as often as it is generated and one of the two machines that read
# it is a WINDOWS box. This script — the switchover gate, the thing that decides
# whether "7/7" may be ticked — sourced the file raw. So a single CR would enter
# `FXMILY_ADMIN_TOKEN`, every pipeline would take a 401, and this gate would
# report FAIL on all seven while the real cron path worked perfectly: the exact
# inverse verdict, on the one script whose whole job is to be believed.
#
# Nothing else detects it either: the watchdog only asserts `${#val} -ge 32`, and
# 32 + CR = 33. The class was closed on one reader out of three.
# `set -e` is not in force here, so an unchecked mktemp would leave ENV_TMP empty:
# `tr` would then write to the CWD, `.` would source an empty path, every secret
# would be unset, and this gate would report FAIL on all seven pipelines with a
# perfectly healthy cron path. Same inverse-verdict failure the CR bug produced,
# which is the whole reason this block exists — so it is checked.
ENV_TMP="$(mktemp)" || { echo "  FAIL   : mktemp failed — cannot read $ENV_FILE safely" >&2; exit 1; }
[[ -n "$ENV_TMP" ]] || { echo "  FAIL   : mktemp returned an empty path" >&2; exit 1; }
trap 'rm -f "$ENV_TMP"' EXIT
tr -d '\r' <"$ENV_FILE" >"$ENV_TMP"
if ! cmp -s "$ENV_FILE" "$ENV_TMP"; then
  echo "  note   : CR bytes stripped from $(basename "$ENV_FILE") while reading it" >&2
fi
set -a
# shellcheck disable=SC1090
. "$ENV_TMP"
set +a
# Same bridge run-batch.sh applies: 4 of the 7 scripts read FXMILY_APP_URL.
export FXMILY_APP_URL="${FXMILY_APP_URL:-${FXMILY_BASE_URL:-https://app.fxmilyapp.com}}"

if [[ "$FAST" == true ]]; then
  # Floor is 30s (core_validate_sleep_range refuses lower — that floor IS the
  # anti-ban design and must never be bypassed, even in a diagnostic).
  export FXMILY_SLEEP_MIN_S=30 FXMILY_SLEEP_MAX_S=30
  export FXMILY_MAX_CONSECUTIVE_FAILURES=1
fi

ORDER=(onboarding verification seances calendar weekly monthly profile)

# The three that exit before any `claude --print` when `--dry-run` is set. Kept
# as data, not as a comment, so the verdict cannot drift away from the truth:
# if one of them ever grows a dry-run generation path, deleting it from this
# list is the single edit required.
declare -A PULL_ONLY=([onboarding]=1 [verification]=1 [seances]=1)

STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
LOG="${FXMILY_VERIFY_LOG:-/tmp/j9-verify-$STAMP.log}"
: >"$LOG"

CLAUDE_VERSION="$(claude --version 2>&1 | head -1)"
[[ -n "$CLAUDE_VERSION" ]] || CLAUDE_VERSION='MISSING'
AUTH_STATE="$(claude auth status --json 2>/dev/null | jq -r '.loggedIn // false' 2>/dev/null | head -1)"
[[ -n "$AUTH_STATE" ]] || AUTH_STATE='unknown'

echo "Fxmily worker — 7-pipeline dry-run verification"
# NO `hostname` here. This banner used to print it, and it is not harmless:
# `worker-host-sync.yml` runs this script in `verify` mode and pipes the output
# into a GitHub Actions log, which is PUBLIC because this repository is. The
# workflow's `redact()` only strips `http(s)://…`, so a bare host name goes
# straight through, and GitHub masks only an EXACT match of a secret's value —
# `secrets.HETZNER_HOST` holds the IPv4, not the short name, so nothing would
# redact it either. A `[ -z "$CI" ]` guard would NOT work: this script runs on
# the host over SSH, where the runner's environment does not exist.
# The line was also pointless where it was useful: an operator running this by
# hand is already logged into the machine it would name.
echo "  target : $FXMILY_APP_URL"
echo "  claude : $CLAUDE_VERSION"
echo "  auth   : $AUTH_STATE"
echo "  log    : $LOG"
echo

PASS=0
FAIL=0
for b in "${ORDER[@]}"; do
  printf '  %-13s ' "$b"
  START=$(date +%s)
  {
    echo "################ $b ################"
  } >>"$LOG"
  bash "$REPO_ROOT/ops/worker/run-batch.sh" "$b" -- --dry-run >>"$LOG" 2>&1
  RC=$?
  ELAPSED=$(($(date +%s) - START))
  SECTION="$(awk -v n="################ $b ################" '$0==n{f=1;next} /^################/{f=0} f' "$LOG")"

  # Did the batch actually RUN, or did run-batch.sh skip it benignly?
  #
  # This is the hole that going through run-batch.sh (for the machine-global
  # lock, which is right) opened up: `run-batch.sh` exits **0** when no Claude
  # account is logged in, or while a quota cooldown is active — deliberately, so
  # cron does not treat an expected pause as a recurring failure. But this script
  # is the switchover gate. Reading only `$?`, it printed `PASS` for seven
  # pipelines on a host where nothing had run at all, and ADR-007's "7/7" could
  # be ticked on a completely mute machine.
  #
  # run-batch.sh already writes the truth to `<batch>.status.json` (`skipped`).
  # Trust it ONLY if this very run produced it — otherwise a leftover file from a
  # previous, healthy run would replay a success that did not happen now.
  STATUS_FILE="${FXMILY_WORKER_LOG_DIR:-$REPO_ROOT/ops/worker/logs}/${b}.status.json"
  SKIPPED=''
  CAPPED='false'
  if [[ ! -r "$STATUS_FILE" ]]; then
    SKIPPED='no-status'
  elif [[ -z "$(find "$STATUS_FILE" -newermt "@$((START - 1))" 2>/dev/null)" ]]; then
    SKIPPED='stale-status'
  else
    SKIPPED="$(jq -r '.skipped // ""' "$STATUS_FILE" 2>/dev/null || echo 'unreadable-status')"
    # A run that hit the Claude usage cap is a SUCCESS as far as cron is
    # concerned — `run-batch.sh` halts immediately, drops a cooldown stamp and
    # remaps exit 75 to 0 so the next ticks are benign no-ops. That remap is
    # correct for cron and wrong for THIS script: it is the switchover gate.
    #
    # A capped run writes no `skipped` key and returns 0, so it fell straight
    # through to the catch-all `PASS/empty` branch and printed "pull OK + JSON
    # valid, no work pending" — an assertion nothing had verified, about a run
    # that never reached the model. ADR-007's "7/7" could then be ticked on a
    # sweep where every generator was capped.
    CAPPED="$(jq -r '.quotaCapped // false' "$STATUS_FILE" 2>/dev/null || echo false)"
  fi

  if grep -q '⛔ HALT' <<<"$SECTION"; then
    ERRS="$(grep -c '✗ claude exited' <<<"$SECTION" || true)"
    printf 'FAIL/no-auth   (%ss, %s generation error(s), pull OK)\n' "$ELAPSED" "$ERRS"
    FAIL=$((FAIL + 1))
  elif [[ "$RC" -ne 0 ]]; then
    printf 'FAIL           (%ss, rc=%s)\n' "$ELAPSED" "$RC"
    FAIL=$((FAIL + 1))
  elif [[ -n "$SKIPPED" ]]; then
    # exit 0, but nothing ran. A gate that counts this as a pass is worse than
    # no gate: it certifies a mute host. `no_claude_auth` is the expected value
    # before the login — which is precisely the state this script must refuse.
    printf 'FAIL/skipped   (%ss, batch did not run: %s)\n' "$ELAPSED" "$SKIPPED"
    FAIL=$((FAIL + 1))
  elif [[ "$CAPPED" == "true" ]]; then
    # Not a defect — a quota window. But not a pass either: nothing was proven.
    printf 'FAIL/quota-capped (%ss, usage cap hit: generation NOT exercised — re-run after the window reopens)\n' "$ELAPSED"
    FAIL=$((FAIL + 1))
  elif [[ -n "${PULL_ONLY[$b]:-}" ]]; then
    printf 'PASS/pull-only (%ss, token + endpoint + envelope OK; generation NOT exercised in dry-run)\n' "$ELAPSED"
    PASS=$((PASS + 1))
  elif grep -qE 'Generated: [1-9]' <<<"$SECTION"; then
    N="$(grep -oE 'Generated: [0-9]+' <<<"$SECTION" | head -1 | grep -oE '[0-9]+')"
    printf 'PASS/generated (%ss, %s generated, JSON valid, nothing persisted)\n' "$ELAPSED" "$N"
    PASS=$((PASS + 1))
  else
    printf 'PASS/empty     (%ss, pull OK + JSON valid, no work pending)\n' "$ELAPSED"
    PASS=$((PASS + 1))
  fi
done

echo
echo "RESULT: $PASS/7 pass, $FAIL/7 fail"
if [[ "$FAIL" -gt 0 ]]; then
  echo
  echo "A FAIL/no-auth on this host means: no Claude account is signed in."
  # Hard-coded on purpose: run as root, `$USER` is `root`, and the printed
  # command would tell the operator to sign in as the wrong user.
  echo "  sudo -u fxmily -H claude auth login --claudeai"
  echo "Nothing was lost: pulls are idempotent, pending members are re-picked."
fi
[[ "$FAIL" -eq 0 ]]
