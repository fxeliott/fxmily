#!/usr/bin/env bash
#
# ops/sync-cron-host.sh — sync the repo's cron schedule + host scripts to the host.
#
# WHY THIS EXISTS. Several files live ONLY on the Hetzner host, NOT in the Docker
# image (the image carries the Next.js app + the /api/cron/* routes, but the
# schedule + the host-side helper scripts that HIT them / guard the host are
# host-side):
#   - ops/cron/crontab.fxmily      → /etc/cron.d/fxmily-app          (the schedule)
#   - ops/cron/fxmily-cron         → /usr/local/bin/fxmily-cron      (curl wrapper)
#   - ops/cron/fxmily-backup       → /usr/local/bin/fxmily-backup    (pg_dump→GPG→R2)
#   - ops/cron/fxmily-caddy-backup → /usr/local/bin/fxmily-caddy-backup (certs)
#   - ops/scripts/fxmily-autoheal  → /usr/local/bin/fxmily-autoheal  (§9-C watchdog)
# `deploy.yml` does NOT touch them, so whenever a cron line / allowlist entry / a
# host script is edited in the repo (e.g. the S6 weekly-report-overdue net, the
# off-site backup gate, the autoheal watchdog), the host copy drifts until it is
# re-synced. This script makes that one idempotent command — it pushes the
# schedule AND every host-side script the schedule references, so a repo edit to
# any of them can never silently fail to reach production.
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

# Every host-side script the crontab references → /usr/local/bin (mode 0755).
# `basename` of each path is also the install name. Edit a script in the repo,
# re-run this, and the host is back in sync — no per-script scp to remember.
BIN_SRCS=(
  "$SCRIPT_DIR/cron/fxmily-cron"
  "$SCRIPT_DIR/cron/fxmily-backup"
  "$SCRIPT_DIR/cron/fxmily-caddy-backup"
  "$SCRIPT_DIR/scripts/fxmily-autoheal"
)

for f in "$CRONTAB_SRC" "${BIN_SRCS[@]}"; do
  [[ -r "$f" ]] || {
    echo "[sync-cron] missing source file: $f" >&2
    exit 1
  }
done

echo "===================================================================="
echo "  STEP 1 — upload crontab + ${#BIN_SRCS[@]} host scripts to '$HOST' (staged in /tmp)"
echo "===================================================================="
scp "$CRONTAB_SRC" "$HOST":/tmp/fxmily-app.cron || {
  echo "[sync-cron] scp crontab FAILED — check the SSH host + your key" >&2
  exit 1
}
for src in "${BIN_SRCS[@]}"; do
  scp "$src" "$HOST":"/tmp/$(basename "$src")" || {
    echo "[sync-cron] scp $(basename "$src") FAILED — check the SSH host + your key" >&2
    exit 1
  }
done

echo
echo "===================================================================="
echo "  STEP 2 — install with correct perms + reload cron, then verify"
echo "===================================================================="
# /etc/cron.d/* must be 0644 root:root ; the host scripts must be executable.
# `install` sets mode+owner atomically. cron.d is auto-read, but reload is harmless.
ssh "$HOST" 'set -e
  install -m 0644 -o root -g root /tmp/fxmily-app.cron /etc/cron.d/fxmily-app
  for b in fxmily-cron fxmily-backup fxmily-caddy-backup fxmily-autoheal; do
    install -m 0755 -o root -g root "/tmp/$b" "/usr/local/bin/$b"
    rm -f "/tmp/$b"
  done
  rm -f /tmp/fxmily-app.cron
  ( systemctl reload cron 2>/dev/null || systemctl restart cron 2>/dev/null || service cron reload 2>/dev/null || true )
  echo "--- weekly-report-overdue cron line (must show: 40 11 * * * ... weekly-report-overdue-alert) ---"
  grep -n "weekly-report-overdue-alert" /etc/cron.d/fxmily-app || echo "MISSING CRON LINE"
  echo "--- autoheal cron line (must show: * * * * * root ... fxmily-autoheal) ---"
  grep -n "fxmily-autoheal" /etc/cron.d/fxmily-app || echo "MISSING AUTOHEAL CRON LINE"
  echo "--- wrapper allowlist hits for weekly-report-overdue-alert (must be >= 1) ---"
  grep -c "weekly-report-overdue-alert" /usr/local/bin/fxmily-cron || true
  echo "--- host scripts are executable ---"
  for b in fxmily-cron fxmily-backup fxmily-caddy-backup fxmily-autoheal; do
    ( test -x "/usr/local/bin/$b" && echo "ok: $b executable" || echo "ERROR: $b not executable" )
  done'

echo
echo "===================================================================="
echo "  DONE — paste the STEP 2 output back to Claude for validation."
echo
echo "  The overdue weekly-report cron runs daily 11:40 UTC (13:40 Paris)."
echo "  '/api/cron/health' turns green once it has fired once. To check now,"
echo "  fire it by hand on the host :"
echo "    ssh $HOST '/usr/local/bin/fxmily-cron weekly-report-overdue-alert; echo rc=\$?'"
echo "===================================================================="
