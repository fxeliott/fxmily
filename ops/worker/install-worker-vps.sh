#!/usr/bin/env bash
#
# ops/worker/install-worker-vps.sh — install (or remove) the Fxmily AI worker on
# the server. J9: the Linux counterpart of `install-worker.ps1`.
#
# WHAT IT REPLACES. On Windows the 7 pipelines were Task Scheduler tasks
# registered by `install-worker.ps1` under Eliott's interactive session — which
# is exactly why the whole thing was a SPOF: PC off, or Eliott logged out, and
# every member's AI generation stopped. Here the same 7 pipelines become
# `/etc/cron.d/fxmily-worker` rows running as the unprivileged `fxmily` user on
# an always-on host.
#
# IDEMPOTENT. Safe to re-run: every step converges, nothing is duplicated, and
# an existing `worker.env` is only rewritten when `--refresh-env` is passed
# (otherwise a token rotation you did by hand is never silently clobbered).
#
# NON-DESTRUCTIVE BY DEFAULT. It never touches `/etc/cron.d/fxmily-app` (the 25
# app rows), never restarts a container, never writes outside the paths listed
# in `--help`.
#
# Usage (run as root — it writes /usr/local/bin + /etc/cron.d) :
#   sudo bash ops/worker/install-worker-vps.sh              # install / converge
#   sudo bash ops/worker/install-worker-vps.sh --refresh-env # + re-mirror tokens
#   sudo bash ops/worker/install-worker-vps.sh --check       # verify only, no write
#   sudo bash ops/worker/install-worker-vps.sh --uninstall    # full rollback
#
# After a fresh install ONE manual step remains, and it is deliberate:
#   sudo -u fxmily -H claude auth login --claudeai
# Signing in is the one thing a script must not do for you (§ RUNBOOK).

set -euo pipefail

WORKER_USER="${WORKER_USER:-fxmily}"
REPO_URL="${FXMILY_REPO_URL:-https://github.com/fxeliott/fxmily.git}"
WEB_ENV="${FXMILY_WEB_ENV:-/etc/fxmily/web.env}"
CRON_DEST=/etc/cron.d/fxmily-worker
BIN_WORKER=/usr/local/bin/fxmily-worker
BIN_WATCHDOG=/usr/local/bin/fxmily-worker-watchdog
LOGROTATE_DEST=/etc/logrotate.d/fxmily-worker

MODE=install
REFRESH_ENV=false
while [[ $# -gt 0 ]]; do
  case "$1" in
    --check) MODE=check ;;
    --uninstall) MODE=uninstall ;;
    --refresh-env) REFRESH_ENV=true ;;
    -h | --help)
      sed -n '2,29p' "$0"
      exit 0
      ;;
    *)
      echo "unknown arg: $1" >&2
      exit 2
      ;;
  esac
  shift
done

SRC_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_SRC="$(cd "$SRC_DIR/../.." && pwd)"
USER_HOME="$(getent passwd "$WORKER_USER" | cut -d: -f6)"
WORKER_REPO="${FXMILY_WORKER_REPO:-$USER_HOME/worker}"
WORKER_ENV="$WORKER_REPO/ops/worker/worker.env"

ok() { printf '  \033[32m[OK]\033[0m   %s\n' "$*"; }
warn() { printf '  \033[33m[WARN]\033[0m %s\n' "$*"; }
fail() {
  printf '  \033[31m[FAIL]\033[0m %s\n' "$*"
  FAILED=1
}
FAILED=0

[[ "$(id -u)" -eq 0 ]] || {
  echo "This script writes /usr/local/bin and /etc/cron.d — run it with sudo." >&2
  exit 2
}
[[ -n "$USER_HOME" ]] || {
  echo "user '$WORKER_USER' not found" >&2
  exit 2
}

# =============================================================================
# UNINSTALL — the rollback path (Done-quand #4). Removes ONLY what we installed.
# =============================================================================
if [[ "$MODE" == uninstall ]]; then
  echo "Fxmily AI worker — uninstall"
  rm -f "$CRON_DEST" && ok "removed $CRON_DEST (crond stops ticking the 7 pipelines)"
  rm -f "$BIN_WORKER" "$BIN_WATCHDOG" && ok "removed the wrappers"
  rm -f "$LOGROTATE_DEST" && ok "removed the logrotate rule"
  echo
  echo "KEPT ON PURPOSE (nothing member-facing is lost, re-install is instant):"
  echo "  · $WORKER_REPO            the dedicated checkout"
  echo "  · $WORKER_ENV   the mirrored tokens (mode 0600)"
  echo "  · $USER_HOME/.claude           the Claude session"
  echo "  · /var/log/fxmily/worker.log   the run history"
  echo
  echo "The PC fallback is re-armed from Windows: ops\\worker\\install-worker.ps1"
  exit 0
fi

echo "Fxmily AI worker — ${MODE} (user=$WORKER_USER, repo=$WORKER_REPO)"
echo

# =============================================================================
# 1. Host prerequisites
# =============================================================================
echo "[1/8] Host prerequisites"
for b in node npm git jq curl timeout; do
  if command -v "$b" >/dev/null 2>&1; then ok "$b $(command -v "$b")"; else fail "$b MISSING"; fi
done
NODE_MAJOR="$(node -v 2>/dev/null | sed 's/^v\([0-9]*\).*/\1/' || echo 0)"
[[ "$NODE_MAJOR" -ge 20 ]] && ok "node major $NODE_MAJOR (≥20)" || fail "node major $NODE_MAJOR (<20)"
TZ_NAME="$(timedatectl show -p Timezone --value 2>/dev/null || cat /etc/timezone 2>/dev/null || echo '?')"
if [[ "$TZ_NAME" == "Europe/Paris" ]]; then
  ok "host timezone $TZ_NAME (cron hour fields are Paris wall-clock — as J9 requires)"
else
  fail "host timezone is '$TZ_NAME', expected Europe/Paris — the schedules would drift"
fi

# =============================================================================
# 2. Claude Code CLI, installed in the worker user's own npm prefix
# =============================================================================
# Deliberately NOT a root-wide `npm i -g`: the CLI self-updates, and a
# root-owned install that an unprivileged cron job cannot update is a slow trap.
echo "[2/8] Claude Code CLI"
CLAUDE_BIN="$USER_HOME/.npm-global/bin/claude"
if [[ "$MODE" != check && ! -x "$CLAUDE_BIN" ]]; then
  sudo -u "$WORKER_USER" -H bash -lc 'mkdir -p ~/.npm-global && npm config set prefix ~/.npm-global && npm install -g @anthropic-ai/claude-code' >/dev/null
fi
if [[ -x "$CLAUDE_BIN" ]]; then
  ok "claude $(sudo -u "$WORKER_USER" -H "$CLAUDE_BIN" --version 2>&1 | head -1)"
  [[ "$MODE" != check ]] && sudo -u "$WORKER_USER" -H mkdir -p "$USER_HOME/bin" &&
    sudo -u "$WORKER_USER" -H ln -sfn "$CLAUDE_BIN" "$USER_HOME/bin/claude"
else
  fail "claude CLI not installed at $CLAUDE_BIN"
fi

# =============================================================================
# 3. Dedicated checkout (J9 contract: SEPARATE from anything else)
# =============================================================================
echo "[3/8] Dedicated worker checkout"
if [[ ! -d "$WORKER_REPO/.git" ]]; then
  if [[ "$MODE" == check ]]; then
    fail "no checkout at $WORKER_REPO"
  else
    sudo -u "$WORKER_USER" -H git clone --depth 1 --branch main "$REPO_URL" "$WORKER_REPO" >/dev/null 2>&1
    ok "cloned $REPO_URL → $WORKER_REPO"
  fi
else
  ok "checkout present ($(sudo -u "$WORKER_USER" -H git -C "$WORKER_REPO" log --oneline -1))"
fi
# The checkout must actually CONTAIN the seven batch scripts. It is cloned from
# `main`, and `seances-batch-local.sh` only exists once J9 is merged — so an
# installer run before the merge would happily install a crontab whose `seances`
# line fails every 30 minutes from 08h to 23h. Name the expected files, and
# refuse rather than install a schedule the checkout cannot honour.
EXPECTED_BATCH_SCRIPTS=(
  onboarding-batch-local.sh
  verification-batch-local.sh
  seances-batch-local.sh
  calendar-batch-local.sh
  weekly-batch-local.sh
  monthly-batch-local.sh
  member-profile-monthly-local.sh
)
MISSING_SCRIPTS=()
for s in "${EXPECTED_BATCH_SCRIPTS[@]}"; do
  [[ -f "$WORKER_REPO/ops/scripts/$s" ]] || MISSING_SCRIPTS+=("$s")
done
if [[ "${#MISSING_SCRIPTS[@]}" -gt 0 ]]; then
  fail "checkout is missing ${#MISSING_SCRIPTS[@]} batch script(s): ${MISSING_SCRIPTS[*]} — is $WORKER_REPO on the right branch?"
else
  ok "7/7 batch scripts present in the checkout"
fi

# CRLF is fatal to a cron-launched bash script (V1.6 bug #2 cost ~20h of silent
# downtime on this very host). `.gitattributes` pins LF, but PROVE it here
# rather than trust it — a checkout is the exact place where the promise breaks.
#
# COUNT what was inspected. Without `nullglob`, an unexpanded glob (missing or
# empty directory) leaves the pattern as a literal, `continue` skips it, and the
# loop ends having read NOTHING — then happily prints "0 CR byte across every
# worker/batch script". A gate that turns green on an empty set is worse than no
# gate: it is a false proof, and it is exactly the kind of green that let the
# 2026-05-11 outage through.
CR_TOTAL=0
SCANNED=0
for f in "$WORKER_REPO"/ops/worker/run-batch.sh "$WORKER_REPO"/ops/scripts/*.sh "$WORKER_REPO"/ops/scripts/lib/*.sh; do
  [[ -f "$f" ]] || continue
  SCANNED=$((SCANNED + 1))
  CR_TOTAL=$((CR_TOTAL + $(tr -cd '\r' <"$f" | wc -c)))
  bash -n "$f" 2>/dev/null || fail "bash -n failed: $f"
done
MIN_SCANNED=$((${#EXPECTED_BATCH_SCRIPTS[@]} + 1)) # 7 batch scripts + run-batch.sh
if [[ "$SCANNED" -lt "$MIN_SCANNED" ]]; then
  fail "only $SCANNED script(s) inspected, expected ≥ $MIN_SCANNED — the CR/syntax check proved nothing"
elif [[ "$CR_TOTAL" -eq 0 ]]; then
  ok "$SCANNED scripts inspected: 0 CR byte, bash -n clean"
else
  fail "$CR_TOTAL CR bytes found across $SCANNED scripts — cron would silently skip them"
fi

# =============================================================================
# 4. worker.env — tokens MIRRORED from the app's own env, never invented
# =============================================================================
echo "[4/8] worker.env"
if [[ -f "$WORKER_ENV" && "$REFRESH_ENV" == false ]]; then
  ok "worker.env present (pass --refresh-env to re-mirror from $WEB_ENV)"
elif [[ "$MODE" == check ]]; then
  fail "worker.env missing at $WORKER_ENV"
else
  [[ -r "$WEB_ENV" ]] || {
    echo "cannot read $WEB_ENV" >&2
    exit 2
  }
  # Validate the SOURCE before destroying the destination. The mirror below is
  # a `>` truncate followed by six `sed -n …p`: a key absent from web.env simply
  # produces no line, so the token would be silently dropped from worker.env and
  # the failure only surfaces after the old value is already gone. Check first,
  # and keep a backup anyway — a hand-placed value is not reproducible.
  SRC_MISSING=()
  for k in ADMIN_BATCH_TOKEN MONTHLY_ADMIN_BATCH_TOKEN CALENDAR_ADMIN_BATCH_TOKEN \
    VERIFICATION_ADMIN_BATCH_TOKEN PROFILE_ADMIN_BATCH_TOKEN SEANCES_ADMIN_BATCH_TOKEN; do
    grep -qE "^$k=.+" "$WEB_ENV" || SRC_MISSING+=("$k")
  done
  if [[ "${#SRC_MISSING[@]}" -gt 0 ]]; then
    echo "refusing to rewrite $WORKER_ENV: $WEB_ENV has no ${SRC_MISSING[*]}" >&2
    echo "(the existing worker.env was left untouched)" >&2
    exit 2
  fi
  # Carry the account guard across the rewrite. It is the ONE key here that is
  # NOT mirrored from web.env: it is placed by hand, deliberately, and the block
  # below is a `>` truncate. Without this, the documented rotation command
  # (`--refresh-env`) silently DISARMS the guard — the file comes back valid,
  # every batch runs, and the board reports the account as verified because
  # "no expected digest configured" is the guard's own opt-out. A maintenance
  # gesture that removes a security control without saying so is the failure
  # mode this whole guard exists to prevent, one square over.
  PRESERVED_ACCOUNT_GUARD=""
  if [[ -f "$WORKER_ENV" ]]; then
    PRESERVED_ACCOUNT_GUARD="$(
      sed -n 's/^\(FXMILY_WORKER_EXPECTED_ACCOUNT_SHA256=.*\)$/\1/p' "$WORKER_ENV" | head -1
    )"
  fi
  [[ -f "$WORKER_ENV" ]] &&
    cp -a "$WORKER_ENV" "$WORKER_ENV.bak-$(date -u +%Y%m%dT%H%M%SZ)"
  install -o "$WORKER_USER" -g "$WORKER_USER" -m 600 /dev/null "$WORKER_ENV"
  {
    echo "# ops/worker/worker.env — generated by install-worker-vps.sh on $(date -u +%Y-%m-%dT%H:%M:%SZ)."
    echo "# MIRRORED from $WEB_ENV. Gitignored. Re-run with --refresh-env after a rotation."
    echo
    sed -n 's/^ADMIN_BATCH_TOKEN=/FXMILY_ADMIN_TOKEN=/p' "$WEB_ENV"
    sed -n 's/^MONTHLY_ADMIN_BATCH_TOKEN=/FXMILY_MONTHLY_ADMIN_TOKEN=/p' "$WEB_ENV"
    sed -n 's/^CALENDAR_ADMIN_BATCH_TOKEN=/FXMILY_CALENDAR_TOKEN=/p' "$WEB_ENV"
    sed -n 's/^VERIFICATION_ADMIN_BATCH_TOKEN=/FXMILY_VERIFICATION_ADMIN_BATCH_TOKEN=/p' "$WEB_ENV"
    sed -n 's/^PROFILE_ADMIN_BATCH_TOKEN=/FXMILY_PROFILE_ADMIN_TOKEN=/p' "$WEB_ENV"
    sed -n 's/^SEANCES_ADMIN_BATCH_TOKEN=/FXMILY_SEANCES_TOKEN=/p' "$WEB_ENV"
    echo
    echo "FXMILY_BASE_URL=${FXMILY_BASE_URL:-https://app.fxmilyapp.com}"
    if [[ -n "$PRESERVED_ACCOUNT_GUARD" ]]; then
      echo
      echo "# Carried over from the previous worker.env — NOT mirrored from web.env."
      echo "$PRESERVED_ACCOUNT_GUARD"
    fi
  } >"$WORKER_ENV"
  chmod 600 "$WORKER_ENV"
  chown "$WORKER_USER:$WORKER_USER" "$WORKER_ENV"
  ok "worker.env written (mode 0600, values never printed)"
fi
if [[ -r "$WORKER_ENV" ]]; then
  MISSING=0
  for k in FXMILY_ADMIN_TOKEN FXMILY_MONTHLY_ADMIN_TOKEN FXMILY_CALENDAR_TOKEN \
    FXMILY_VERIFICATION_ADMIN_BATCH_TOKEN FXMILY_PROFILE_ADMIN_TOKEN FXMILY_SEANCES_TOKEN; do
    LEN="$(awk -F= -v k="$k" '$1==k {print length($2)}' "$WORKER_ENV" | head -1)"
    [[ -n "$LEN" && "$LEN" -ge 32 ]] || {
      fail "$k missing or <32 chars"
      MISSING=1
    }
  done
  [[ "$MISSING" -eq 0 ]] && ok "6/6 pipeline tokens present, ≥32 chars (lengths only, never values)"
fi

# =============================================================================
# 5. Wrappers
# =============================================================================
echo "[5/8] Wrappers"
if [[ "$MODE" != check ]]; then
  install -o root -g root -m 755 "$REPO_SRC/ops/cron/fxmily-worker" "$BIN_WORKER"
  install -o root -g root -m 755 "$REPO_SRC/ops/cron/fxmily-worker-watchdog" "$BIN_WATCHDOG"
fi
for b in "$BIN_WORKER" "$BIN_WATCHDOG"; do
  if [[ -x "$b" ]]; then
    # `bash -n … && ok` alone SWALLOWED the failure: a syntactically broken
    # wrapper printed nothing and left FAILED=0, so `--check` reported "all
    # checks passed" on a host whose cron entry point could not even parse.
    # The CR/syntax loop above already does this correctly (`|| fail`, line ~193)
    # — this branch was the odd one out.
    if bash -n "$b" 2>/dev/null; then
      ok "$b (0$(stat -c '%a' "$b"), bash -n clean)"
    else
      fail "bash -n failed: $b (the wrapper cron calls does not parse)"
    fi
  else fail "$b missing"; fi
done

# =============================================================================
# 6. Schedule
# =============================================================================
echo "[6/8] /etc/cron.d/fxmily-worker"
if [[ "$MODE" != check ]]; then
  # Strip CR defensively even though the source is LF-pinned: this file is the
  # one whose CRLF corruption is SILENT (crond skips the line, logs nothing).
  tr -d '\r' <"$REPO_SRC/ops/cron/crontab.fxmily-worker" >"$CRON_DEST.tmp"
  install -o root -g root -m 644 "$CRON_DEST.tmp" "$CRON_DEST"
  rm -f "$CRON_DEST.tmp"
fi
if [[ -f "$CRON_DEST" ]]; then
  PERMS="$(stat -c '%a' "$CRON_DEST")"
  CR="$(tr -cd '\r' <"$CRON_DEST" | wc -c)"
  ROWS="$(grep -cE '^[0-9*]' "$CRON_DEST" || true)"
  # Test the property the message names — group/other WRITE — not one exact mode.
  # `== 644` failed on 0600, which is stricter and which crond accepts, while the
  # error text talked about writability. Same masking the watchdog now applies to
  # this file, so the two agree on what "wrong" means.
  if [[ ! "$PERMS" =~ ^[0-7]+$ ]]; then
    fail "mode unreadable ('$PERMS')"
  elif (( 8#$PERMS & 0022 )); then
    fail "mode $PERMS is group/other-writable — crond ignores the file entirely"
  else
    ok "mode $PERMS (not group/other-writable)"
  fi
  [[ "$CR" -eq 0 ]] && ok "0 CR byte" || fail "$CR CR bytes — crond would skip those lines SILENTLY"
  [[ "$ROWS" -eq 8 ]] && ok "8 schedule rows (7 pipelines + watchdog)" || fail "$ROWS rows, expected 8"
else
  fail "$CRON_DEST missing"
fi

# =============================================================================
# 7. Log rotation + final auth reminder
# =============================================================================
echo "[7/8] Log rotation"
if [[ "$MODE" != check ]]; then
  # Both the one-line-per-tick timeline AND the per-batch transcripts the
  # wrapper writes next to it — an unrotated transcript is how a disk fills up.
  cat >"$LOGROTATE_DEST" <<EOF
/var/log/fxmily/worker.log /var/log/fxmily/*.wrapper.log {
  weekly
  rotate 8
  compress
  delaycompress
  missingok
  notifempty
  copytruncate
  su $WORKER_USER $WORKER_USER
}
EOF
  chmod 644 "$LOGROTATE_DEST"
fi
[[ -f "$LOGROTATE_DEST" ]] && ok "$LOGROTATE_DEST (weekly, 8 kept)" || fail "logrotate rule missing"

# =============================================================================
# 8. Observation window — armed EXPLICITLY, never assumed
# =============================================================================
# The switchover is only "controlled" if the first tick after installation does
# NOT write to production. That depends on one line in /etc/fxmily/cron.env — a
# file this installer does not own (it is provisioned once by setup-host.sh and
# then hand-edited), so on a fresh host, a restore, or a rebuilt VM the line is
# simply not there. The wrapper defaults to observation for exactly that reason,
# but a default is not a proof: write the line, and SAY which mode the next tick
# will run in. An operator who has to infer whether the server is live is an
# operator who will eventually infer wrong.
echo "[8/8] Observation window"
CRON_ENV=/etc/fxmily/cron.env
if [[ ! -f "$CRON_ENV" ]]; then
  fail "$CRON_ENV missing — run ops/scripts/setup-host.sh first"
elif grep -qE '^FXMILY_WORKER_DRY_RUN=' "$CRON_ENV"; then
  CURRENT="$(grep -E '^FXMILY_WORKER_DRY_RUN=' "$CRON_ENV" | tail -1 | cut -d= -f2 | tr -d '"'"'"' \r')"
  if [[ "$CURRENT" == "1" ]]; then
    ok "FXMILY_WORKER_DRY_RUN=1 → next tick runs in OBSERVATION (nothing persisted)"
  else
    warn "FXMILY_WORKER_DRY_RUN=$CURRENT → next tick runs in PRODUCTION."
    warn "Make sure the Windows tasks are disabled, or you now have TWO masters."
  fi
elif [[ "$MODE" == check ]]; then
  fail "$CRON_ENV declares no FXMILY_WORKER_DRY_RUN (the observation window is not armed)"
else
  {
    echo
    echo "# J9 — AI worker. 1 = observation (every tick runs --dry-run, nothing"
    echo "# persisted, the PC stays master). Set to 0 to hand over. See"
    echo "# ops/worker/RUNBOOK.md before flipping it."
    echo "FXMILY_WORKER_DRY_RUN=1"
  } >>"$CRON_ENV"
  ok "armed the observation window (FXMILY_WORKER_DRY_RUN=1 appended to $CRON_ENV)"
fi

echo
echo "=== Claude session (the ONE manual step) ==="
AUTH_JSON="$(sudo -u "$WORKER_USER" -H "$CLAUDE_BIN" auth status --json 2>/dev/null || echo '{}')"
if [[ "$(printf '%s' "$AUTH_JSON" | jq -r '.loggedIn // false')" == "true" ]]; then
  ok "a Claude account is signed in — the 7 pipelines will generate"
else
  warn "no Claude account signed in → every tick is a clean, benign SKIP (no failure,"
  warn "no member data lost: pulls are idempotent and re-pick pending members)."
  echo "      Sign in with:  sudo -u $WORKER_USER -H claude auth login --claudeai"
fi

echo
if [[ "$FAILED" -eq 0 ]]; then
  echo "RESULT: all checks passed."
else
  echo "RESULT: at least one check FAILED (see above)."
  exit 1
fi
