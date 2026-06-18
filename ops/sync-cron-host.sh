#!/usr/bin/env bash
#
# ops/sync-cron-host.sh — sync the repo's cron schedule + wrapper to the host.
#
# WHY THIS EXISTS. Two cron files live ONLY on the Hetzner host, NOT in the
# Docker image (the image carries the Next.js app + the /api/cron/* routes, but
# the schedule that HITS them is host-side):
#   - ops/cron/crontab.fxmily  → /etc/cron.d/fxmily-app      (the schedule)
#   - ops/cron/fxmily-cron     → /usr/local/bin/fxmily-cron  (the curl wrapper)
# `deploy.yml` does NOT touch them, so whenever a cron line / allowlist entry is
# added to the repo (e.g. the S6 weekly-report-overdue net), the host copy drifts
# until it is re-synced. This script makes that one idempotent command.
#
# RUN FROM YOUR machine (needs SSH ROOT access to the host) :
#   bash ops/sync-cron-host.sh <ssh-host>        # e.g. bash ops/sync-cron-host.sh hetzner-dieu
#   & 'C:\Program Files\Git\bin\bash.exe' D:\Fxmily\ops\sync-cron-host.sh <ssh-host>   # PowerShell
#
# <ssh-host> = an SSH-config alias (or user@ip) that resolves to ROOT on the
# Hetzner host. It is a REQUIRED ARG (never hardcoded — this repo is public).
#
# Idempotent : re-running it just re-installs the same files + re-verifies.
set -uo pipefail

HOST="${1:-}"
if [[ -z "$HOST" ]]; then
  echo "usage: bash ops/sync-cron-host.sh <ssh-host>   (e.g. hetzner-dieu)" >&2
  echo "  <ssh-host> = SSH alias / user@ip with ROOT access to the Hetzner host." >&2
  exit 2
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CRONTAB_SRC="$SCRIPT_DIR/cron/crontab.fxmily"
WRAPPER_SRC="$SCRIPT_DIR/cron/fxmily-cron"

for f in "$CRONTAB_SRC" "$WRAPPER_SRC"; do
  [[ -r "$f" ]] || {
    echo "[sync-cron] missing source file: $f" >&2
    exit 1
  }
done

echo "===================================================================="
echo "  STEP 1 — upload crontab + wrapper to '$HOST' (staged in /tmp)"
echo "===================================================================="
scp "$CRONTAB_SRC" "$HOST":/tmp/fxmily-app.cron &&
  scp "$WRAPPER_SRC" "$HOST":/tmp/fxmily-cron.sh ||
  {
    echo "[sync-cron] scp FAILED — check the SSH host + your key" >&2
    exit 1
  }

echo
echo "===================================================================="
echo "  STEP 2 — install with correct perms + reload cron, then verify"
echo "===================================================================="
# /etc/cron.d/* must be 0644 root:root ; the wrapper must be executable. `install`
# sets mode+owner atomically. cron.d is auto-read, but reload/restart is harmless.
ssh "$HOST" 'set -e
  install -m 0644 -o root -g root /tmp/fxmily-app.cron /etc/cron.d/fxmily-app
  install -m 0755 -o root -g root /tmp/fxmily-cron.sh  /usr/local/bin/fxmily-cron
  rm -f /tmp/fxmily-app.cron /tmp/fxmily-cron.sh
  ( systemctl reload cron 2>/dev/null || systemctl restart cron 2>/dev/null || service cron reload 2>/dev/null || true )
  echo "--- weekly-report-overdue cron line (must show: 40 11 * * * ... weekly-report-overdue-alert) ---"
  grep -n "weekly-report-overdue-alert" /etc/cron.d/fxmily-app || echo "MISSING CRON LINE"
  echo "--- wrapper allowlist hits for weekly-report-overdue-alert (must be >= 1) ---"
  grep -c "weekly-report-overdue-alert" /usr/local/bin/fxmily-cron || true
  echo "--- wrapper is executable ---"
  ( test -x /usr/local/bin/fxmily-cron && echo "ok: executable" || echo "ERROR: not executable" )'

echo
echo "===================================================================="
echo "  DONE — paste the STEP 2 output back to Claude for validation."
echo
echo "  The overdue weekly-report cron runs daily 11:40 UTC (13:40 Paris)."
echo "  '/api/cron/health' turns green once it has fired once. To check now,"
echo "  fire it by hand on the host :"
echo "    ssh $HOST '/usr/local/bin/fxmily-cron weekly-report-overdue-alert; echo rc=\$?'"
echo "===================================================================="
