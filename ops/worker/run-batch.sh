#!/usr/bin/env bash
#
# ops/worker/run-batch.sh — Fxmily local AI worker (J2).
#
# WHY THIS EXISTS. The 5 Claude batch orchestrators
# (onboarding / weekly / monthly / calendar / verification) generate every AI
# artifact the app shows a member (onboarding MemberProfile, weekly/monthly
# digests, adaptive calendar, MT5 vision verification). Until J2 they were
# "human-in-the-loop : run manually by Eliot" (see
# ops/scripts/lib/claude-batch-core.sh:25). That manual step was the ROOT CAUSE
# of the "IA silence 24H après profil rempli" bug : finalizeInterview only flips
# the interview to `completed` (ZERO Claude call), and the ONLY thing that ever
# creates the MemberProfile is the local batch — so a member who finished their
# interview got NOTHING until Eliot happened to run the script by hand, while
# two screens promise the profile « dans les prochaines 24h ».
#
# This wrapper turns the manual step into an AUTOMATED, PERMANENT local worker
# driven by Windows Task Scheduler (see install-worker.ps1). It changes NOTHING
# about how a batch talks to Claude — it only SCHEDULES the existing scripts,
# serialises them, and records what happened. Every ban-risk mitigation
# (jittered sleeps ≥30s, one `claude --print` per member, no parallelisation,
# official binary, no `--bare`) stays enforced BY the underlying scripts +
# claude-batch-core.sh; this wrapper never touches those flags.
#
# BAN-RISK — no parallelisation. A GLOBAL lock (not per-batch) guarantees at
# most ONE batch — hence at most one `claude --print` — runs at any instant
# across all 5 pipelines, exactly as when Eliot ran them one at a time by hand.
# The install schedules are staggered so collisions are effectively impossible;
# if one still happens, the later tick SKIPS cleanly (benign) and the next tick
# (or the server-side overdue-alert net) picks the work up. Pull is idempotent
# (already-analysed rows are filtered server-side) so a skipped/retried tick is
# always safe.
#
# Usage :
#   run-batch.sh <onboarding|weekly|monthly|calendar|verification|profile> [-- <extra script args>]
#
# Env (loaded from ops/worker/worker.env if present; already-set vars win) :
#   FXMILY_ADMIN_TOKEN   — 32+ char admin batch token (matches prod ADMIN_BATCH_TOKEN)
#   FXMILY_BASE_URL      — target app URL (default https://app.fxmilyapp.com ;
#                          set http://localhost:3000 for a local dry run)
#   FXMILY_WORKER_ENV    — override path to the env file (default ./worker.env)
#   FXMILY_WORKER_LOG_DIR— override log dir (default ./logs)
#   plus every FXMILY_CLAUDE_* / FXMILY_SLEEP_* knob the core already honours.
#
# Exit codes : 0 = batch ran OK (or benign skip because another batch holds the
# lock) ; non-zero = the underlying batch failed (surfaced to Task Scheduler as
# the task's "Last Run Result" and written to <batch>.status.json).

set -uo pipefail  # NOT -e : we log + record status on failure, never abort silently.

# --- Resolve paths ------------------------------------------------------------
WORKER_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$WORKER_DIR/../.." && pwd)"
SCRIPTS_DIR="$REPO_ROOT/ops/scripts"

# --- Parse args ---------------------------------------------------------------
BATCH="${1:-}"
shift || true
# Anything after a literal `--` is forwarded verbatim to the batch script
# (e.g. `--dry-run`, `--max-members 1`, `--skip-sleep` for tests).
EXTRA_ARGS=()
if [[ "${1:-}" == "--" ]]; then
  shift
  EXTRA_ARGS=("$@")
fi

case "$BATCH" in
  onboarding|weekly|monthly|calendar|verification|profile) ;;
  ""|-h|--help)
    echo "Usage: $0 <onboarding|weekly|monthly|calendar|verification|profile> [-- <extra args>]" >&2
    [[ "$BATCH" == "-h" || "$BATCH" == "--help" ]] && exit 0
    exit 2
    ;;
  *)
    echo "[worker] ERROR: unknown batch '$BATCH' (expected onboarding|weekly|monthly|calendar|verification|profile)." >&2
    exit 2
    ;;
esac

# `profile` (J-E monthly deep re-profiling) is the one pipeline whose script
# does not follow the `<batch>-batch-local.sh` naming convention.
if [[ "$BATCH" == "profile" ]]; then
  BATCH_SCRIPT="$SCRIPTS_DIR/member-profile-monthly-local.sh"
else
  BATCH_SCRIPT="$SCRIPTS_DIR/${BATCH}-batch-local.sh"
fi
if [[ ! -f "$BATCH_SCRIPT" ]]; then
  echo "[worker] ERROR: batch script not found: $BATCH_SCRIPT" >&2
  exit 2
fi

# --- Load worker env (secrets travel here, never on the command line) ---------
# `set -a` so sourced assignments are exported to the batch child process.
# We source into a subshell-free context but only for vars NOT already set, so
# an explicit `FXMILY_BASE_URL=... run-batch.sh` (used by the local runtime
# proof) always wins over the file.
ENV_FILE="${FXMILY_WORKER_ENV:-$WORKER_DIR/worker.env}"
ENV_FILE_EXISTED=false
if [[ -f "$ENV_FILE" ]]; then
  ENV_FILE_EXISTED=true
  while IFS= read -r line; do
    # skip blanks + comments
    [[ -z "$line" || "$line" =~ ^[[:space:]]*# ]] && continue
    # only KEY=VALUE lines
    [[ "$line" =~ ^[[:space:]]*([A-Za-z_][A-Za-z0-9_]*)=(.*)$ ]] || continue
    key="${BASH_REMATCH[1]}"
    val="${BASH_REMATCH[2]}"
    # strip optional surrounding quotes
    val="${val%\"}"; val="${val#\"}"
    val="${val%\'}"; val="${val#\'}"
    # already-set env wins (explicit override for tests)
    if [[ -z "${!key:-}" ]]; then
      export "$key=$val"
    fi
  done < "$ENV_FILE"
fi

# --- Not-configured-yet guard -------------------------------------------------
# If there is NO worker.env at all AND no token was passed in the environment,
# the worker simply hasn't been set up yet. A scheduled tick must then be a
# BENIGN no-op (exit 0) — never a recurring failure that spams Task Scheduler
# history before the operator has provisioned worker.env. But if worker.env
# DOES exist yet the token is empty/short, that is a real misconfiguration: we
# fall through and let the batch fail LOUDLY (§7 — no hidden errors).
if [[ -z "${FXMILY_ADMIN_TOKEN:-}" && "$ENV_FILE_EXISTED" == "false" ]]; then
  echo "[worker] $BATCH — not configured yet (no $ENV_FILE, no FXMILY_ADMIN_TOKEN); skipping (benign)."
  echo "[worker] Provision ops/worker/worker.env (see worker.env.example) to activate the worker."
  exit 0
fi

# --- Global serialisation lock (ban-risk: one claude --print at a time) --------
LOCK_DIR="${TMPDIR:-/tmp}/fxmily-worker.lock"
if ! mkdir "$LOCK_DIR" 2>/dev/null; then
  holder="unknown"
  [[ -f "$LOCK_DIR/batch" ]] && holder="$(cat "$LOCK_DIR/batch" 2>/dev/null || echo unknown)"
  echo "[worker] $BATCH — another batch ($holder) holds the global lock; skipping this tick (benign)."
  exit 0
fi
echo "$BATCH" > "$LOCK_DIR/batch" 2>/dev/null || true
trap 'rm -rf "$LOCK_DIR" 2>/dev/null || true' EXIT

# --- Logging + status ---------------------------------------------------------
LOG_DIR="${FXMILY_WORKER_LOG_DIR:-$WORKER_DIR/logs}"
mkdir -p "$LOG_DIR"
LOG_FILE="$LOG_DIR/${BATCH}.log"
STATUS_FILE="$LOG_DIR/${BATCH}.status.json"

# Prune worker logs older than 14 days (PII hygiene + disk) — the batch scripts
# already scrub their own ephemeral artifacts; this only trims our own logs.
find "$LOG_DIR" -type f -name '*.log' -mtime +14 -delete 2>/dev/null || true

STARTED_AT="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
{
  echo ""
  echo "==================================================================="
  echo "[worker] batch=$BATCH started=$STARTED_AT base=${FXMILY_BASE_URL:-<default>}"
  echo "==================================================================="
} | tee -a "$LOG_FILE"

# --- Run the real batch (unchanged flags → all ban-risk mitigations intact) ---
set +e
bash "$BATCH_SCRIPT" "${EXTRA_ARGS[@]}" 2>&1 | tee -a "$LOG_FILE"
EXIT_CODE="${PIPESTATUS[0]}"
set -e 2>/dev/null || true

FINISHED_AT="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
OK=false
[[ "$EXIT_CODE" -eq 0 ]] && OK=true

# Machine-readable last-run status (consumed by status-worker.ps1 + J4 health).
cat > "$STATUS_FILE" <<EOF
{
  "batch": "$BATCH",
  "startedAt": "$STARTED_AT",
  "finishedAt": "$FINISHED_AT",
  "exitCode": $EXIT_CODE,
  "ok": $OK
}
EOF

{
  echo "[worker] batch=$BATCH finished=$FINISHED_AT exit=$EXIT_CODE ok=$OK"
  echo "==================================================================="
} | tee -a "$LOG_FILE"

exit "$EXIT_CODE"
