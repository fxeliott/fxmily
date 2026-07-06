#!/usr/bin/env bash
#
# ops/worker/run-batch.sh — Fxmily local AI worker (J2).
#
# WHY THIS EXISTS. The 6 Claude batch orchestrators
# (onboarding / weekly / monthly / calendar / verification / profile) generate
# every AI artifact the app shows a member (onboarding MemberProfile,
# weekly/monthly digests, adaptive calendar, MT5 vision verification, J-E
# monthly deep re-profiling). Until J2 they were
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
# across all 6 pipelines, exactly as when Eliot ran them one at a time by hand.
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

# --- Log dir (needed early for benign-skip status writes) ---------------------
# The full logging section further down re-derives the same value; defining it
# here lets the pre-flight benign skips (quota cooldown, logged-out auth) record
# a machine-readable status.json + prune old logs without acquiring the lock or
# calling claude. Keep this in sync with the LOG_DIR assignment below.
LOG_DIR="${FXMILY_WORKER_LOG_DIR:-$WORKER_DIR/logs}"
mkdir -p "$LOG_DIR"
QUOTA_STAMP="$LOG_DIR/quota-halt.stamp"

# Write a minimal "skipped" status.json for a BENIGN pre-flight skip (no lock
# was taken, no claude call was made) and exit 0. $1 = skip reason slug,
# $2 = extra JSON fields (already comma-prefixed, may be empty). Task Scheduler
# sees a clean success; /admin/system reads the reason from status.json.
write_skip_status() {
  local reason="$1" extra="${2:-}"
  local now
  now="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  cat > "$LOG_DIR/${BATCH}.status.json" <<EOF
{
  "batch": "$BATCH",
  "startedAt": "$now",
  "finishedAt": "$now",
  "exitCode": 0,
  "ok": true,
  "skipped": "$reason"$extra
}
EOF
}

# --- Quota cooldown (benign) --------------------------------------------------
# A previous tick that hit a Claude usage/rate limit exited 75 and dropped a
# quota-halt.stamp (see finish()). Until the cooldown elapses, every tick skips
# WITHOUT touching claude, so the worker stops hammering a capped account and
# the cap self-resolves at the next quota window. FXMILY_QUOTA_COOLDOWN_MIN
# (default 60) is env-overridable; the stamp is a plain epoch-seconds file.
QUOTA_COOLDOWN_MIN="${FXMILY_QUOTA_COOLDOWN_MIN:-60}"
if [[ -f "$QUOTA_STAMP" ]]; then
  stamp_epoch="$(cat "$QUOTA_STAMP" 2>/dev/null | tr -dc '0-9')"
  now_epoch="$(date +%s)"
  if [[ -n "$stamp_epoch" ]]; then
    age_min=$(( (now_epoch - stamp_epoch) / 60 ))
    if [[ "$age_min" -lt "$QUOTA_COOLDOWN_MIN" ]]; then
      echo "[worker] $BATCH — quota cooldown active (${age_min}min/${QUOTA_COOLDOWN_MIN}min since last cap), skipping (benign)."
      write_skip_status "quota_cooldown" ",
  \"cooldownAgeMin\": $age_min,
  \"cooldownMin\": $QUOTA_COOLDOWN_MIN"
      exit 0
    fi
    # Cooldown elapsed — clear the stamp so this tick runs normally.
    echo "[worker] $BATCH — quota cooldown elapsed (${age_min}min ≥ ${QUOTA_COOLDOWN_MIN}min); resuming."
    rm -f "$QUOTA_STAMP" 2>/dev/null || true
  fi
fi

# --- Pre-flight: a Claude account must be logged in ---------------------------
# The whole worker follows whatever account is active in ~/.claude
# (.credentials.json, rewritten by each `claude login`). `claude auth status
# --json` reads it instantly with ZERO quota cost. If nobody is logged in,
# every `claude --print` would fail one member at a time and burn the cohort
# against a broken auth — so we skip the whole tick cleanly instead (benign;
# the members are re-picked idempotently once an account is logged back in).
ACCOUNT_EMAIL=""
AUTH_OK=false
AUTH_JSON="$(claude auth status --json 2>/dev/null || true)"
if [[ -n "$AUTH_JSON" ]]; then
  # jq is guaranteed present (every batch script requires it via
  # core_sanity_checks); parse robustly and treat any parse miss as logged-out.
  AUTH_LOGGED_IN="$(printf '%s' "$AUTH_JSON" | jq -r '.loggedIn // false' 2>/dev/null || echo false)"
  if [[ "$AUTH_LOGGED_IN" == "true" ]]; then
    AUTH_OK=true
    ACCOUNT_EMAIL="$(printf '%s' "$AUTH_JSON" | jq -r '.email // ""' 2>/dev/null || echo "")"
  fi
fi
if [[ "$AUTH_OK" != "true" ]]; then
  echo "[worker] $BATCH — SKIP: no Claude account logged in (run: claude login). Skipping (benign)."
  write_skip_status "no_claude_auth" ",
  \"authOk\": false"
  exit 0
fi
export ACCOUNT_EMAIL

# --- Global serialisation lock (ban-risk: one claude --print at a time) --------
# MACHINE-GLOBAL and TMPDIR-independent : $HOME is the same for every context
# that can start this worker (Task Scheduler, interactive Git Bash, tests),
# whereas ${TMPDIR:-/tmp} can differ per context and would silently produce
# TWO "global" locks. Also checkout-independent (a worktree copy of this
# script still serialises against the main repo's worker).
LOCK_DIR="${FXMILY_WORKER_LOCK_DIR:-${HOME:-/tmp}/.fxmily-worker.lock}"

# Stale-lock recovery — a hard kill (reboot, Task Scheduler stop, kill -9)
# leaves the lock dir behind and would starve EVERY future tick forever.
# Liveness check: the holder wrote its PID; if that PID is gone, the lock is
# stale and we reclaim it. Fallback for a lock with no readable PID (partial
# write): reclaim after 6h (longest legitimate batch ≈ 2h at 30 members).
lock_is_stale() {
  local pid
  pid="$(cat "$LOCK_DIR/pid" 2>/dev/null || true)"
  if [[ "$pid" =~ ^[0-9]+$ ]]; then
    kill -0 "$pid" 2>/dev/null && return 1  # holder alive → not stale
    return 0                                 # holder dead → stale
  fi
  # No PID file — stale only if the dir is old enough (find -mmin on the dir).
  [[ -n "$(find "$LOCK_DIR" -maxdepth 0 -mmin +360 2>/dev/null)" ]]
}

acquire_lock() {
  mkdir "$LOCK_DIR" 2>/dev/null || return 1
  echo "$$" > "$LOCK_DIR/pid" 2>/dev/null || true
  echo "$BATCH" > "$LOCK_DIR/batch" 2>/dev/null || true
  return 0
}

if ! acquire_lock; then
  if lock_is_stale; then
    echo "[worker] $BATCH — stale lock detected (holder dead); reclaiming."
    rm -rf "$LOCK_DIR" 2>/dev/null || true
    if ! acquire_lock; then
      echo "[worker] $BATCH — lock re-acquired by another tick during recovery; skipping (benign)."
      exit 0
    fi
  else
    holder="unknown"
    [[ -f "$LOCK_DIR/batch" ]] && holder="$(cat "$LOCK_DIR/batch" 2>/dev/null || echo unknown)"
    echo "[worker] $BATCH — another batch ($holder) holds the global lock; skipping this tick (benign)."
    exit 0
  fi
fi

# --- Guaranteed epilogue (status.json + footer + lock release) ----------------
# One idempotent finish() wired on EXIT *and* TERM/INT. Before the 2026-07-02
# hardening a failed run could leave NO status.json and NO footer —
# indistinguishable from "still running" for status-worker.ps1 / J4 health.
# HONEST LIMIT (proved empirically 2026-07-02): under MSYS/Git Bash a TERM
# delivered to a background bash is a Windows hard-kill (TerminateProcess) —
# no trap runs, nothing flushes. Same for Task Scheduler "Stop the task".
# For THOSE deaths the recovery net is the stale-lock reclaim above (dead
# holder PID → next tick reclaims and reruns; pull is idempotent).
EXIT_CODE=125  # provisional — overwritten after the batch runs; 125 = killed mid-run
FINISHED=false
finish() {
  [[ "$FINISHED" == "true" ]] && return 0
  FINISHED=true
  local code="${1:-$EXIT_CODE}"
  # A rate/usage-limit halt bubbles up from the pipeline as exit 75 (EX_TEMPFAIL,
  # set by core_run_exit_code). Drop a cooldown stamp so subsequent ticks skip
  # WITHOUT calling claude until FXMILY_QUOTA_COOLDOWN_MIN elapses — the worker
  # stops hammering a capped account. This is BENIGN, not a batch failure, so
  # run-batch itself exits 0 (see the tail) : no Task Scheduler alert for a cap.
  local quota_capped=false
  if [[ "$code" -eq 75 ]]; then
    quota_capped=true
    date +%s > "${QUOTA_STAMP}" 2>/dev/null || true
  fi
  # Capture the account at the END of the run too: a value different from
  # ACCOUNT_EMAIL means the operator switched Claude accounts mid-batch (safe —
  # the next member simply runs on the new account), which the status.json
  # records as a signal. Best-effort + local-only (email never leaves the box).
  local account_end="$ACCOUNT_EMAIL"
  local end_json
  end_json="$(claude auth status --json 2>/dev/null || true)"
  if [[ -n "$end_json" ]]; then
    account_end="$(printf '%s' "$end_json" | jq -r '.email // ""' 2>/dev/null || echo "$ACCOUNT_EMAIL")"
    [[ -z "$account_end" ]] && account_end="$ACCOUNT_EMAIL"
  fi
  # Only write status/footer if the logging section below already ran.
  if [[ -n "${STATUS_FILE:-}" ]]; then
    local finished_at ok switched_json=""
    finished_at="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
    ok=false
    # 0 = clean; 75 = benign quota cap (not a failure). Both are "ok".
    { [[ "$code" -eq 0 ]] || [[ "$code" -eq 75 ]]; } && ok=true
    if [[ -n "$account_end" && "$account_end" != "$ACCOUNT_EMAIL" ]]; then
      switched_json=",
  \"accountEnd\": \"$account_end\""
    fi
    cat > "$STATUS_FILE" <<EOF
{
  "batch": "$BATCH",
  "startedAt": "${STARTED_AT:-}",
  "finishedAt": "$finished_at",
  "exitCode": $code,
  "ok": $ok,
  "quotaCapped": $quota_capped,
  "authOk": true,
  "account": "${ACCOUNT_EMAIL:-}"$switched_json
}
EOF
    {
      echo "[worker] batch=$BATCH finished=$finished_at exit=$code ok=$ok quotaCapped=$quota_capped"
      echo "==================================================================="
    } | tee -a "$LOG_FILE"
  fi
  rm -rf "$LOCK_DIR" 2>/dev/null || true
}
trap 'finish' EXIT
trap 'finish 143; exit 143' TERM
trap 'finish 130; exit 130' INT

# --- Logging + status ---------------------------------------------------------
# LOG_DIR + its mkdir already ran up in the pre-flight section (the benign skips
# need it before the lock); reuse it here so the value can never drift.
LOG_FILE="$LOG_DIR/${BATCH}.log"
STATUS_FILE="$LOG_DIR/${BATCH}.status.json"

# Prune worker logs older than 14 days (PII hygiene + disk) — the batch scripts
# already scrub their own ephemeral artifacts; this only trims our own logs.
find "$LOG_DIR" -type f -name '*.log' -mtime +14 -delete 2>/dev/null || true

STARTED_AT="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
{
  echo ""
  echo "==================================================================="
  echo "[worker] batch=$BATCH started=$STARTED_AT base=${FXMILY_BASE_URL:-<default>} account=${ACCOUNT_EMAIL:-<none>}"
  echo "==================================================================="
} | tee -a "$LOG_FILE"

# --- Run the real batch (unchanged flags → all ban-risk mitigations intact) ---
set +e
bash "$BATCH_SCRIPT" "${EXTRA_ARGS[@]}" 2>&1 | tee -a "$LOG_FILE"
EXIT_CODE="${PIPESTATUS[0]}"
set -e 2>/dev/null || true

# Machine-readable status.json + human footer + lock release all live in
# finish() (trap EXIT) so they are ALSO written when the run is killed.
#
# Exit-code remap for Task Scheduler: a rate/usage cap (75) is BENIGN — the
# stamp is written in finish() and the next tick cools down — so run-batch
# reports SUCCESS (0) to the scheduler to avoid a spurious "Last Run Result"
# alert. The cap is not lost: status.json carries exitCode:75 + quotaCapped,
# which /admin/system and watchdog.ps1 read. A genuine batch failure keeps its
# non-zero code so the scheduler + board still flag it.
if [[ "$EXIT_CODE" -eq 75 ]]; then
  exit 0
fi
exit "$EXIT_CODE"
