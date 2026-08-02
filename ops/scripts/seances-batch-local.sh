#!/usr/bin/env bash
#
# J9 scope 5 — séances pipeline, brought INTO the worker contract (7th batch).
#
# WHY THIS FILE EXISTS. The 2026-07-11 product review filed a P2: «`seances`
# hors contrat worker». The séances hub had server-side endpoints
# (`/api/admin/seances-batch/{pull,persist}`, deployed) but NO batch under
# `ops/worker/run-batch.sh` — so it was the only AI-adjacent pipeline with none
# of the guarantees the other six get: no global lock, no `worker.env`, no
# `status.json`, no quota cooldown, no `claude auth` pre-flight, no central log,
# no `/admin/system` heartbeat. This script closes that gap: from now on
# `seances` is a first-class member of the worker contract, ticked by
# `/etc/cron.d/fxmily-worker` like the other six.
#
# ─────────────────────────────────────────────────────────────────────────────
# HONEST SCOPE — read this before assuming a bug.
#
# This batch RECONCILES; it does not generate. That is not a shortcut, it is a
# consequence of a deliberate product invariant:
#
#     `ReplaySession` stores transcript METADATA only —
#     "content lives derived, never raw here" (prisma/schema.prisma).
#
# The raw Zoom transcript is NEVER persisted server-side. The editorial content
# (summary, A-Z takeaways, the 6 asset readings, the 6 Discord messages) is
# generated from that transcript under Règle n°1 (total fidelity, zero
# invention), which means the generating machine must HOLD the transcript and
# the .mp4. Both are deposited by a human, on the operator's machine. No amount
# of porting moves that leg to a server: there is nothing on the server to
# generate FROM.
#
# So the split is:
#   · media + AI leg  (mp4 → Vimeo → transcript → Règle n°1 content → persist)
#     stays operator-side, by product design;
#   · pull / reconcile / observability leg  → HERE, under the worker contract.
#
# What this batch therefore really buys: the séances pipeline stops being a
# blind spot. Every tick emits `seance.batch.pulled`, so `/admin/system` can
# finally tell "the séances pipeline is alive" from "nobody has looked at it in
# three weeks", and every anomaly (a held session whose replay never got
# published, a session stuck on a failed step) surfaces as a line in the worker
# log instead of being discovered by a member.
# ─────────────────────────────────────────────────────────────────────────────
#
# Usage :
#   bash ops/scripts/seances-batch-local.sh              # reconcile + report
#   bash ops/scripts/seances-batch-local.sh --dry-run    # identical, but never
#                                                        # writes back (this
#                                                        # batch has no write
#                                                        # path today — the flag
#                                                        # exists so the 7
#                                                        # pipelines share ONE
#                                                        # contract)
#
# Required env (loaded from ops/worker/worker.env by run-batch.sh) :
#   FXMILY_SEANCES_TOKEN — 32+ chars, mirrors prod SEANCES_ADMIN_BATCH_TOKEN
#   FXMILY_BASE_URL      — defaults to https://app.fxmilyapp.com
#
# Exit codes : 0 = pulled + reconciled fine (including "nothing to do").
#              1 = pull failed / envelope unusable.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib/claude-batch-core.sh
source "$SCRIPT_DIR/lib/claude-batch-core.sh"

readonly BASE_URL="${FXMILY_BASE_URL:-https://app.fxmilyapp.com}"
readonly ADMIN_TOKEN="${FXMILY_SEANCES_TOKEN:-}"
readonly WORK_DIR="${TMPDIR:-/tmp}/fxmily-seances-batch-$$"

DRY_RUN=false
while [[ $# -gt 0 ]]; do
  case "$1" in
    --dry-run)
      DRY_RUN=true
      shift
      ;;
    -h | --help)
      cat <<'USAGE'
Usage: seances-batch-local.sh [--dry-run]

Pulls the séances pipeline state, applies the admin go/no-go, and reports what
each declared session is waiting on. Never publishes: the media + AI leg is
operator-side by product design (the raw transcript is never stored server-side).
USAGE
      exit 0
      ;;
    *)
      echo "[ERROR] Unknown arg: $1" >&2
      exit 1
      ;;
  esac
done

# ============================================================================
# Pre-flight — the SAME gate as the other six pipelines
# ============================================================================
# `core_sanity_checks` requires the official `claude` binary even though this
# batch never invokes it. That is deliberate: a worker box where `claude`
# disappeared is broken for the other six, and the séances tick is the most
# frequent one during the day — it is the cheapest early warning we have.

core_require_token FXMILY_SEANCES_TOKEN SEANCES_ADMIN_BATCH_TOKEN
if [[ ${#ADMIN_TOKEN} -lt 32 ]]; then
  echo "[FATAL] FXMILY_SEANCES_TOKEN must be at least 32 chars." >&2
  exit 1
fi
core_validate_app_url "$BASE_URL"
core_sanity_checks

mkdir -p "$WORK_DIR"
trap 'rm -rf "$WORK_DIR"' EXIT
ENVELOPE_FILE="$WORK_DIR/envelope.json"

echo "[seances-batch] Base URL: $BASE_URL"
echo "[seances-batch] Dry-run: $DRY_RUN"
echo "[seances-batch] Started: $(date -u +%Y-%m-%dT%H:%M:%SZ)"

# ============================================================================
# Step 1 — Pull the declared go/no-go + sync state (PII-free, 0 FK to User)
# ============================================================================

echo ""
echo "[seances-batch] [1/2] Pulling $BASE_URL/api/admin/seances-batch/pull"
core_pull_envelope "$BASE_URL/api/admin/seances-batch/pull" "$ADMIN_TOKEN" "$ENVELOPE_FILE"

if ! jq -e '.sessions | type == "array"' "$ENVELOPE_FILE" >/dev/null 2>&1; then
  echo "[FATAL] envelope has no .sessions array — contract drift?" >&2
  exit 1
fi

RAN_AT=$(jq -r '.ranAt // "?"' "$ENVELOPE_FILE")
TOTAL=$(jq '.sessions | length' "$ENVELOPE_FILE")
echo "[seances-batch] ✓ envelope pulled, JSON valid — $TOTAL declared session(s) (ranAt=$RAN_AT)"

if [[ "$TOTAL" == "0" ]]; then
  echo "[seances-batch] No declared session in the rolling admin window. Nothing to do."
  exit 0
fi

# ============================================================================
# Step 2 — Reconcile: classify every declared session by what it waits on
# ============================================================================
# Authority split (pipeline-service.ts): the ADMIN owns existence + status;
# the PIPELINE owns checkpoints + media + content. We therefore only ever READ
# `status` here, and we never treat a `cancelled` slot as work: a cancelled
# séance must never reappear as a replay (the server refuses it anyway — this
# is the client-side half of the same rule).

echo ""
echo "[seances-batch] [2/2] Reconciling"

CANCELLED=$(jq '[.sessions[] | select(.status == "cancelled")] | length' "$ENVELOPE_FILE")
SCHEDULED=$(jq '[.sessions[] | select(.status == "scheduled")] | length' "$ENVELOPE_FILE")
HELD=$(jq '[.sessions[] | select(.status == "done")] | length' "$ENVELOPE_FILE")

# A held session is COMPLETE when the replay is published and the content is
# generated and not flagged. Anything else is waiting on a human deposit.
COMPLETE=$(jq '[.sessions[]
  | select(.status == "done")
  | select(.checkpoints.vimeo == true and .checkpoints.ai == true and .contentNeedsReview == false)
] | length' "$ENVELOPE_FILE")

AWAITING_MEDIA=$(jq '[.sessions[]
  | select(.status == "done")
  | select(.checkpoints.vimeo == false or .checkpoints.transcript == false)
] | length' "$ENVELOPE_FILE")

AWAITING_AI=$(jq '[.sessions[]
  | select(.status == "done")
  | select(.checkpoints.transcript == true)
  | select(.checkpoints.ai == false or .contentNeedsReview == true)
] | length' "$ENVELOPE_FILE")

echo "[seances-batch]   declared=$TOTAL  held=$HELD  scheduled=$SCHEDULED  cancelled=$CANCELLED"
echo "[seances-batch]   held complete=$COMPLETE  awaiting media=$AWAITING_MEDIA  awaiting AI=$AWAITING_AI"

# Name the sessions that are NOT complete, so the log is directly actionable
# ("jamais d'échec silencieux" — the pipeline's own rule).
jq -r '.sessions[]
  | select(.status == "done")
  | select(.checkpoints.vimeo == false
           or .checkpoints.ai == false
           or .contentNeedsReview == true)
  | "[seances-batch]   ⏳ \(.date) \(.slot) — mp4=\(.checkpoints.mp4) vimeo=\(.checkpoints.vimeo) transcript=\(.checkpoints.transcript) ai=\(.checkpoints.ai) needsReview=\(.contentNeedsReview) syncedAt=\(.syncedAt // "never")"' \
  "$ENVELOPE_FILE"

if [[ "$AWAITING_MEDIA" -gt 0 || "$AWAITING_AI" -gt 0 ]]; then
  echo "[seances-batch]   → these wait on an operator deposit (transcript + .mp4)."
  echo "[seances-batch]     The raw transcript is never stored server-side, so this"
  echo "[seances-batch]     leg cannot run here. See the header of this file."
fi

if [[ "$DRY_RUN" == "true" ]]; then
  echo "[seances-batch] --dry-run: no write-back (this batch has no write path today)."
fi

echo "[seances-batch] ✓ reconciled, JSON valid — done $(date -u +%Y-%m-%dT%H:%M:%SZ)"
exit 0
