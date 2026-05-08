#!/usr/bin/env bash
# J10 — automated subset of `docs/runbook-prod-smoke-test.md` checklist.
#
# Runs the 8 of the 12 steps that don't require a real iPhone or browser
# interaction. The other 4 (steps 1, 4-9 visual UI) still need Eliot in
# Chrome desktop + iPhone Safari.
#
# Usage:
#   export APP_URL=https://app.fxmily.com
#   export CRON_SECRET=<from /etc/fxmily/web.env>
#   bash ops/scripts/post-deploy-smoke.sh

set -euo pipefail

: "${APP_URL:?APP_URL env var required (e.g. https://app.fxmily.com)}"
: "${CRON_SECRET:?CRON_SECRET env var required}"

pass=0
fail=0
ok() { echo "  ✓ $1"; pass=$((pass + 1)); }
ko() { echo "  ✗ $1" >&2; fail=$((fail + 1)); }

echo "Smoke prod for $APP_URL"
echo "─────────────────────────"

# Step 1 — health endpoint
if curl -fsS --max-time 10 "$APP_URL/api/health" | grep -q '"ok"\s*:\s*true'; then
  ok "GET /api/health → 200 + ok:true"
else
  ko "GET /api/health failed"
fi

# Step 2 — public legal pages render (200 + key string)
for slug in privacy terms mentions; do
  if curl -fsS --max-time 10 "$APP_URL/legal/$slug" | grep -q "Fxmily"; then
    ok "GET /legal/$slug → 200, content present"
  else
    ko "GET /legal/$slug failed"
  fi
done

# Step 3 — login page render
if curl -fsS --max-time 10 "$APP_URL/login" | grep -q "Connexion\|Email\|login"; then
  ok "GET /login → 200, form rendered"
else
  ko "GET /login failed"
fi

# Step 4 — cron auth boundary (503 without secret env, 401 with bad secret, 405 on GET)
HTTP=$(curl -s -o /dev/null -w '%{http_code}' "$APP_URL/api/cron/recompute-scores")
if [[ "$HTTP" == "405" ]]; then
  ok "GET /api/cron/recompute-scores → 405 (POST-only)"
else
  ko "GET /api/cron/recompute-scores → $HTTP (expected 405)"
fi

HTTP=$(curl -s -o /dev/null -w '%{http_code}' -X POST -H "X-Cron-Secret: bad" \
  "$APP_URL/api/cron/recompute-scores")
if [[ "$HTTP" == "401" ]]; then
  ok "POST /api/cron/recompute-scores bad-secret → 401"
else
  ko "POST /api/cron/recompute-scores bad-secret → $HTTP (expected 401)"
fi

# Step 5 — recompute-scores cron (real)
RESP=$(curl -fsS --max-time 60 -X POST -H "X-Cron-Secret: $CRON_SECRET" \
  "$APP_URL/api/cron/recompute-scores")
if echo "$RESP" | grep -q '"ok"\s*:\s*true'; then
  ok "POST /api/cron/recompute-scores → ok"
else
  ko "POST /api/cron/recompute-scores failed: $RESP"
fi

# Step 6 — purge-deleted (no users to materialise/purge expected)
RESP=$(curl -fsS --max-time 30 -X POST -H "X-Cron-Secret: $CRON_SECRET" \
  "$APP_URL/api/cron/purge-deleted")
if echo "$RESP" | grep -q '"ok"\s*:\s*true'; then
  ok "POST /api/cron/purge-deleted → ok (counts: $(echo "$RESP" | jq -c '.materialise.scanned, .purge.scanned' | paste -sd,))"
else
  ko "POST /api/cron/purge-deleted failed: $RESP"
fi

# Step 7 — purge-push-subscriptions
RESP=$(curl -fsS --max-time 30 -X POST -H "X-Cron-Secret: $CRON_SECRET" \
  "$APP_URL/api/cron/purge-push-subscriptions")
if echo "$RESP" | grep -q '"ok"\s*:\s*true'; then
  ok "POST /api/cron/purge-push-subscriptions → ok"
else
  ko "POST /api/cron/purge-push-subscriptions failed: $RESP"
fi

# Step 8 — security headers
HEADERS=$(curl -fsSI --max-time 10 "$APP_URL/")
echo "$HEADERS" | grep -qi 'strict-transport-security' && ok "HSTS header present" || ko "HSTS header missing"
echo "$HEADERS" | grep -qi 'x-frame-options' && ok "X-Frame-Options present" || ko "X-Frame-Options missing"
echo "$HEADERS" | grep -qi 'x-content-type-options' && ok "X-Content-Type-Options present" || ko "X-Content-Type-Options missing"
echo "$HEADERS" | grep -qi 'content-security-policy' && ok "CSP present" || ko "CSP missing"

echo "─────────────────────────"
echo "Pass: $pass  Fail: $fail"

if [[ "$fail" -gt 0 ]]; then
  echo
  echo "❌ Smoke incomplete. Fix the failed checks before manual UI smoke."
  exit 1
fi

cat <<EOF

✅ Automated smoke green. Remaining MANUAL checks (cf. docs/runbook-prod-smoke-test.md):

  Step  9  — iPhone Safari Add-to-Home-Screen + push
  Step 10  — Weekly digest manual (curl + Resend inbox check)
  Step 11  — /account/data download + integrity check
  Step 12  — Sentry dashboard receives test error

Once those 4 are validated, SPEC §15 J10 "Done quand" is satisfied.
EOF
