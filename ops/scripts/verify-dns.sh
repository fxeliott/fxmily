#!/usr/bin/env bash
# J10 — DNS + Resend domain verification helper.
#
# Usage: bash ops/scripts/verify-dns.sh fxmily.com app.fxmily.com
#
# Checks:
#   - app.fxmily.com → A record present (Hetzner IP)
#   - fxmily.com → MX records to mx1/mx2.resend.com
#   - SPF TXT v=spf1 include:_spf.resend.com
#   - DKIM TXT resend._domainkey.fxmily.com
#   - DMARC TXT _dmarc.fxmily.com
#   - HTTPS reachability of https://app.fxmily.com/api/health (if up)
#
# Returns 0 only if all checks pass. Use during the 24h propagation window
# to know when Resend can be "verified" in the console.

set -euo pipefail

readonly DOMAIN="${1:-fxmily.com}"
readonly APP="${2:-app.${DOMAIN}}"

pass=0
fail=0

ok() { echo "  ✓ $1"; pass=$((pass + 1)); }
ko() { echo "  ✗ $1" >&2; fail=$((fail + 1)); }

dig_short() { dig +short "$@" 2>/dev/null | tr -d '"'; }

# `dig` is the canonical DNS tool ; on Windows Eliot may need to install
# BIND tools or use WSL. Fallback to `nslookup` if missing — limited but
# enough for the visual sanity check.
if ! command -v dig >/dev/null 2>&1; then
  echo "Warning: 'dig' not installed. Falling back to a less precise check."
  alias dig_short='nslookup'
fi

echo "DNS verification for $DOMAIN"
echo "─────────────────────────────"

# A app.<domain>
A_VALUE=$(dig_short A "$APP")
if [[ -n "$A_VALUE" ]]; then
  ok "A $APP → $A_VALUE"
else
  ko "A $APP missing — set Cloudflare DNS A record (Proxied=NO)"
fi

# MX <domain>
MX_VALUES=$(dig_short MX "$DOMAIN")
if echo "$MX_VALUES" | grep -qi "mx1.resend.com\|mx2.resend.com"; then
  ok "MX $DOMAIN includes Resend mx hosts"
else
  ko "MX $DOMAIN missing Resend (expected 10 mx1.resend.com, 20 mx2.resend.com)"
fi

# SPF TXT
SPF_VALUE=$(dig_short TXT "$DOMAIN" | grep -i 'v=spf1' || true)
if echo "$SPF_VALUE" | grep -q "include:_spf.resend.com"; then
  ok "SPF $DOMAIN includes _spf.resend.com"
else
  ko "SPF $DOMAIN missing 'include:_spf.resend.com'"
fi

# DKIM (Resend uses 'resend' selector by default)
DKIM_VALUE=$(dig_short TXT "resend._domainkey.${DOMAIN}")
if echo "$DKIM_VALUE" | grep -q "p="; then
  ok "DKIM resend._domainkey.${DOMAIN} present"
else
  ko "DKIM resend._domainkey.${DOMAIN} missing — paste the value from Resend Console"
fi

# DMARC
DMARC_VALUE=$(dig_short TXT "_dmarc.${DOMAIN}")
if echo "$DMARC_VALUE" | grep -q "v=DMARC1"; then
  ok "DMARC _dmarc.${DOMAIN} present"
else
  ko "DMARC _dmarc.${DOMAIN} missing — recommended: v=DMARC1; p=quarantine; rua=mailto:eliot@${DOMAIN}"
fi

# HTTPS reachability of the app
if curl -fsS --max-time 5 -o /dev/null -w '%{http_code}\n' "https://${APP}/api/health" 2>/dev/null | grep -q '200'; then
  ok "HTTPS https://${APP}/api/health responds 200"
else
  echo "  ~ HTTPS https://${APP}/api/health not yet reachable (expected before deploy)"
fi

echo "─────────────────────────────"
echo "Pass: $pass  Fail: $fail"

if [[ "$fail" -gt 0 ]]; then
  exit 1
fi

echo "✅ All DNS checks pass — Resend domain verify can now be triggered in the console."
