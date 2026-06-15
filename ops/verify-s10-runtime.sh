#!/usr/bin/env bash
# S10 runtime verification (prod) — the REAL tests, not theory.
#   bash /d/Fxmily/ops/verify-s10-runtime.sh
set -uo pipefail
H=hetzner-dieu

echo "===================================================================="
echo "  1. UPLOADS PERSISTENCE — a file written via the container lands on"
echo "     the HOST named-volume disk (survives any container recreate)."
echo "===================================================================="
ssh "$H" 'docker exec fxmily-web sh -c "echo s10-persist-proof > /app/.uploads/_s10_test.txt" \
  && MP=$(docker volume inspect fxmily-uploads --format "{{.Mountpoint}}") \
  && echo "host volume mountpoint: $MP" \
  && echo "file content read straight off the HOST disk (proves it is NOT in the ephemeral container layer):" \
  && cat "$MP/_s10_test.txt" \
  && docker exec fxmily-web rm -f /app/.uploads/_s10_test.txt \
  && echo "test file cleaned"'

echo
echo "===================================================================="
echo "  2. CRON DAEMON — service active, crontab perms valid, wrapper"
echo "     allowlist accepts checkin-reminders."
echo "===================================================================="
ssh "$H" '(systemctl is-active cron 2>/dev/null && echo "cron service: active") || (systemctl is-active crond 2>/dev/null && echo "crond active") || echo "cron service NOT active?"; \
  echo "--- /etc/cron.d/fxmily-app perms (must be 0644 root, NOT world-writable) ---"; \
  ls -l /etc/cron.d/fxmily-app; \
  echo "--- wrapper allowlists checkin-reminders? (count, must be >=1) ---"; \
  grep -c "checkin-reminders" /usr/local/bin/fxmily-cron'

echo
echo "===================================================================="
echo "  3. AUTH post-dedup — the LIVE dedup-ed cron route still rejects"
echo "     unauthenticated requests (via the real Caddy->web path)."
echo "===================================================================="
ssh "$H" 'echo -n "POST /api/cron/health WITHOUT secret (expect 401): "; curl -s -o /dev/null -w "%{http_code}\n" -X POST https://app.fxmilyapp.com/api/cron/health; \
  echo -n "GET  /api/cron/health (expect 405): "; curl -s -o /dev/null -w "%{http_code}\n" https://app.fxmilyapp.com/api/cron/health; \
  echo -n "GET  /api/health public (expect 200): "; curl -s -o /dev/null -w "%{http_code}\n" https://app.fxmilyapp.com/api/health'

echo
echo "=== DONE ==="
