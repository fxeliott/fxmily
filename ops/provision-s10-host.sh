#!/usr/bin/env bash
# S10 host provisioning — applies the 2 host-only fixes that the Docker image
# does NOT carry (crontab schedule + uploads volume). Run from YOUR machine:
#   Git Bash :   bash /d/Fxmily/ops/provision-s10-host.sh
#   PowerShell:  & 'C:\Program Files\Git\bin\bash.exe' D:\Fxmily\ops\provision-s10-host.sh
# It SSHes to the host named by PROVISION_HOST (root) using your existing SSH
# config. Idempotent.
set -uo pipefail

HOST="${PROVISION_HOST:?Set PROVISION_HOST to your prod SSH alias before running (see private ops notes)}"
COMPOSE_LOCAL=/d/Fxmily/ops/docker/docker-compose.prod.yml

echo "===================================================================="
echo "  STEP A1 — copy the volume-enabled compose to the host"
echo "===================================================================="
scp "$COMPOSE_LOCAL" "$HOST":/opt/fxmily/docker-compose.prod.yml \
  && echo "[A1] scp OK" \
  || { echo "[A1] scp FAILED — aborting"; exit 1; }

echo
echo "===================================================================="
echo "  STEP A2 — recreate web WITH the fxmily-uploads volume, then verify"
echo "===================================================================="
ssh "$HOST" 'cd /opt/fxmily \
  && docker compose -f docker-compose.prod.yml up -d web \
  && sleep 5 \
  && echo "--- volume (must list fxmily-uploads) ---" \
  && (docker volume ls | grep fxmily-uploads || echo "MISSING VOLUME") \
  && echo "--- /app/.uploads ownership (must be fxmily fxmily) ---" \
  && docker exec fxmily-web ls -ld /app/.uploads \
  && echo "--- container health ---" \
  && docker inspect fxmily-web --format "health={{.State.Health.Status}}"'

echo
echo "===================================================================="
echo "  STEP B — widen the check-in reminder crontab window (CEST fix)"
echo "===================================================================="
ssh "$HOST" 'cp /etc/cron.d/fxmily-app /etc/cron.d/fxmily-app.bak-pre-s10cest \
  && sed -i "s#^0,15,30,45 7-8,20-21 #0,15,30,45 5-7,18-20 #" /etc/cron.d/fxmily-app \
  && echo "--- new checkin-reminders line (must show 5-7,18-20) ---" \
  && grep checkin-reminders /etc/cron.d/fxmily-app'

echo
echo "===================================================================="
echo "  DONE — paste the full output above back to Claude for validation."
echo "===================================================================="
