#!/usr/bin/env bash
#
# ops/worker/verify-worker-vps.sh — prove the 7 pipelines actually work on this
# host. J9 "Done quand" #1: «7/7 batches exécutés avec succès depuis le VPS en
# dry-run — preuve logs».
#
# WHY A SCRIPT AND NOT A CHECKLIST. "I ran them and it looked fine" is not a
# proof. This runs all seven in `--dry-run` against the REAL prod endpoints with
# the REAL tokens, and prints a verdict per pipeline that distinguishes the
# three outcomes that actually matter:
#
#   PASS/generated   the pull returned work AND `claude --print` produced valid
#                    JSON for it (nothing persisted — that is what --dry-run is)
#   PASS/empty       the pull returned no work, so the batch short-circuited
#                    before any model call. This is a REAL pass: it proves the
#                    token, the endpoint, the envelope shape and the guard.
#   FAIL/no-auth     the pull worked but every generation failed and the
#                    circuit breaker halted. On this host that means exactly one
#                    thing: no Claude account is signed in. It is reported as a
#                    FAILURE on purpose — a green run that generated nothing
#                    would be the very lie this jalon exists to remove.
#
# `--dry-run` is passed to every pipeline, so this NEVER writes anything
# member-facing, and it is safe to run at any time, including while the PC
# worker is still master.
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
set -a
# shellcheck disable=SC1090
. "$ENV_FILE"
set +a
# Same bridge run-batch.sh applies: 4 of the 7 scripts read FXMILY_APP_URL.
export FXMILY_APP_URL="${FXMILY_APP_URL:-${FXMILY_BASE_URL:-https://app.fxmilyapp.com}}"

if [[ "$FAST" == true ]]; then
  # Floor is 30s (core_validate_sleep_range refuses lower — that floor IS the
  # anti-ban design and must never be bypassed, even in a diagnostic).
  export FXMILY_SLEEP_MIN_S=30 FXMILY_SLEEP_MAX_S=30
  export FXMILY_MAX_CONSECUTIVE_FAILURES=1
fi

declare -A SCRIPT=(
  [onboarding]="ops/scripts/onboarding-batch-local.sh"
  [verification]="ops/scripts/verification-batch-local.sh"
  [seances]="ops/scripts/seances-batch-local.sh"
  [calendar]="ops/scripts/calendar-batch-local.sh"
  [weekly]="ops/scripts/weekly-batch-local.sh"
  [monthly]="ops/scripts/monthly-batch-local.sh"
  [profile]="ops/scripts/member-profile-monthly-local.sh"
)
ORDER=(onboarding verification seances calendar weekly monthly profile)

STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
LOG="${FXMILY_VERIFY_LOG:-/tmp/j9-verify-$STAMP.log}"
: >"$LOG"

echo "Fxmily worker — 7-pipeline dry-run verification"
echo "  host   : $(hostname)"
echo "  target : $FXMILY_APP_URL"
echo "  claude : $(claude --version 2>&1 | head -1 || echo 'MISSING')"
echo "  auth   : $(claude auth status --json 2>/dev/null | jq -r '.loggedIn // false' 2>/dev/null || echo '?')"
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
  bash "$REPO_ROOT/${SCRIPT[$b]}" --dry-run >>"$LOG" 2>&1
  RC=$?
  ELAPSED=$(($(date +%s) - START))
  SECTION="$(awk -v n="################ $b ################" '$0==n{f=1;next} /^################/{f=0} f' "$LOG")"

  if grep -q '⛔ HALT' <<<"$SECTION"; then
    ERRS="$(grep -c '✗ claude exited' <<<"$SECTION" || true)"
    printf 'FAIL/no-auth   (%ss, %s generation error(s), pull OK)\n' "$ELAPSED" "$ERRS"
    FAIL=$((FAIL + 1))
  elif [[ "$RC" -ne 0 ]]; then
    printf 'FAIL           (%ss, rc=%s)\n' "$ELAPSED" "$RC"
    FAIL=$((FAIL + 1))
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
  echo "  sudo -u ${USER:-fxmily} -H claude auth login --claudeai"
  echo "Nothing was lost: pulls are idempotent, pending members are re-picked."
fi
[[ "$FAIL" -eq 0 ]]
