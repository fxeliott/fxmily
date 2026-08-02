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
      sed -n '2,32p' "$0"
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
echo "[1/7] Host prerequisites"
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
echo "[2/7] Claude Code CLI"
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
echo "[3/7] Dedicated worker checkout"
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
# CRLF is fatal to a cron-launched bash script (V1.6 bug #2 cost ~20h of silent
# downtime on this very host). `.gitattributes` pins LF, but PROVE it here
# rather than trust it — a checkout is the exact place where the promise breaks.
CR_TOTAL=0
for f in "$WORKER_REPO"/ops/worker/run-batch.sh "$WORKER_REPO"/ops/scripts/*.sh "$WORKER_REPO"/ops/scripts/lib/*.sh; do
  [[ -f "$f" ]] || continue
  CR_TOTAL=$((CR_TOTAL + $(tr -cd '\r' <"$f" | wc -c)))
  bash -n "$f" 2>/dev/null || fail "bash -n failed: $f"
done
[[ "$CR_TOTAL" -eq 0 ]] && ok "0 CR byte across every worker/batch script, bash -n clean" ||
  fail "$CR_TOTAL CR bytes found — cron would silently skip these scripts"

# =============================================================================
# 4. worker.env — tokens MIRRORED from the app's own env, never invented
# =============================================================================
echo "[4/7] worker.env"
if [[ -f "$WORKER_ENV" && "$REFRESH_ENV" == false ]]; then
  ok "worker.env present (pass --refresh-env to re-mirror from $WEB_ENV)"
elif [[ "$MODE" == check ]]; then
  fail "worker.env missing at $WORKER_ENV"
else
  [[ -r "$WEB_ENV" ]] || {
    echo "cannot read $WEB_ENV" >&2
    exit 2
  }
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
echo "[5/7] Wrappers"
if [[ "$MODE" != check ]]; then
  install -o root -g root -m 755 "$REPO_SRC/ops/cron/fxmily-worker" "$BIN_WORKER"
  install -o root -g root -m 755 "$REPO_SRC/ops/cron/fxmily-worker-watchdog" "$BIN_WATCHDOG"
fi
for b in "$BIN_WORKER" "$BIN_WATCHDOG"; do
  if [[ -x "$b" ]]; then
    bash -n "$b" && ok "$b (0$(stat -c '%a' "$b"), bash -n clean)"
  else fail "$b missing"; fi
done

# =============================================================================
# 6. Schedule
# =============================================================================
echo "[6/7] /etc/cron.d/fxmily-worker"
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
  [[ "$PERMS" == 644 ]] && ok "mode 0644" || fail "mode $PERMS (crond ignores group/other-writable files)"
  [[ "$CR" -eq 0 ]] && ok "0 CR byte" || fail "$CR CR bytes — crond would skip those lines SILENTLY"
  [[ "$ROWS" -eq 8 ]] && ok "8 schedule rows (7 pipelines + watchdog)" || fail "$ROWS rows, expected 8"
else
  fail "$CRON_DEST missing"
fi

# =============================================================================
# 7. Log rotation + final auth reminder
# =============================================================================
echo "[7/7] Log rotation"
if [[ "$MODE" != check ]]; then
  cat >"$LOGROTATE_DEST" <<EOF
/var/log/fxmily/worker.log {
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
