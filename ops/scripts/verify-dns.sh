#!/usr/bin/env bash
# J10 — DNS + Resend domain verification helper.
#
# Usage: bash ops/scripts/verify-dns.sh fxmilyapp.com app.fxmilyapp.com
#
# Checks:
#   - app.fxmilyapp.com → A record present (Hetzner IP)
#   - fxmilyapp.com → MX records to mx1/mx2.resend.com
#   - SPF TXT v=spf1 include:_spf.resend.com
#   - DKIM TXT resend._domainkey.fxmilyapp.com
#   - DMARC TXT _dmarc.fxmilyapp.com
#   - HTTPS reachability of https://app.fxmilyapp.com/api/health (if up)
#
# Returns 0 only if all checks pass. Use during the 24h propagation window
# to know when Resend can be "verified" in the console.

set -euo pipefail

readonly DOMAIN="${1:-fxmilyapp.com}"
readonly APP="${2:-app.${DOMAIN}}"

pass=0
fail=0

ok() { echo "  ✓ $1"; pass=$((pass + 1)); }
ko() { echo "  ✗ $1" >&2; fail=$((fail + 1)); }

# `dig` is the canonical DNS tool ; on Windows Eliot may need to install
# BIND tools or use WSL. Fallback to `nslookup` if missing — limited but
# enough for the visual sanity check.
#
# J10 Phase L review H6 fix : we redefine `dig_short` as a function
# instead of using `alias` — bash aliases are NOT expanded inside
# non-interactive shells (this script is run as `bash verify-dns.sh ...`),
# so the alias path was silently dead code. The function form works
# regardless of how bash is invoked.
if command -v dig >/dev/null 2>&1; then
  dig_short() { dig +short "$@" 2>/dev/null | tr -d '"'; }
else
  echo "Warning: 'dig' not installed. Falling back to nslookup (less precise)."
  dig_short() { nslookup "$@" 2>/dev/null | tail -n +3 | tr -d '"'; }
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

# A <domain> and A www.<domain> — the two records that carry the apex redirect.
# They were UNCHECKED here until 2026-08-05, which is why a green run of this
# script proved nothing about the apex while it returned Cloudflare 522 for
# days. What matters is not the literal address (it changes with the host) but
# that all three names agree: apex and www must resolve to whatever `app` does,
# or Cloudflare dials a machine that does not serve this domain.
#
# NOTE: apex and www are Cloudflare-PROXIED, so a public `dig` returns
# Cloudflare edge IPs for them and `app` (DNS-only) returns the origin — the
# three will NOT match from outside. This check is therefore only meaningful
# from a resolver that sees the zone's own records, so it reports rather than
# fails when it sees a proxied answer.
for name in "$DOMAIN" "www.$DOMAIN"; do
  VALUE=$(dig_short A "$name")
  if [[ -z "$VALUE" ]]; then
    ko "A $name missing — the apex redirect to $APP cannot work without it"
  elif echo "$VALUE" | grep -qE '^(104\.(1[6-9]|2[0-7])\.|172\.6[4-9]\.|172\.7[01]\.|188\.114\.)'; then
    echo "  ~ A $name → $VALUE (Cloudflare edge: proxied. Check the ORIGIN value in the dashboard — it must equal $APP's address)"
  elif [[ "$VALUE" == "$A_VALUE" ]]; then
    ok "A $name → $VALUE (same origin as $APP)"
  else
    ko "A $name → $VALUE but $APP → $A_VALUE. They MUST match: a mismatch is exactly what produced the 522 outage of 2026-08."
  fi
done

# MX <domain>
# Mail is the REGISTRAR'S mailbox, not Resend. This block used to demand
# mx1/mx2.resend.com and failed on a perfectly healthy zone — and the fix it
# suggested (re-running cloudflare-dns-setup.sh) would have overwritten the
# real MX and stopped eliot@ receiving anything. A verifier that is red on a
# healthy system does not just fail to help: it points at a destructive action.
MX_VALUES=$(dig_short MX "$DOMAIN")
if [[ -n "$MX_VALUES" ]]; then
  ok "MX $DOMAIN present → $(echo "$MX_VALUES" | tr '\n' ' ')"
else
  ko "MX $DOMAIN missing — the mailbox at eliot@$DOMAIN stops receiving"
fi

# SPF TXT — on the SENDING subdomain, not the apex. Transactional mail leaves
# via Amazon SES from `send.$DOMAIN`; the apex has no SPF because nothing sends
# from it. DMARC still aligns, via DKIM below.
SPF_VALUE=$(dig_short TXT "send.$DOMAIN" | grep -i 'v=spf1' || true)
if echo "$SPF_VALUE" | grep -q "v=spf1"; then
  ok "SPF send.$DOMAIN present → $SPF_VALUE"
else
  ko "SPF send.$DOMAIN missing — transactional mail will fail SPF"
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
