#!/usr/bin/env bash
# Phase M — Resend domain registration automation.
#
# Adds `fxmilyapp.com` to the Resend account, fetches the DKIM value
# (unique per Resend project), and exposes it for `cloudflare-dns-setup.sh`
# to plant in DNS. Then with `--verify-only`, polls Resend until the
# domain status flips to `verified` (after DNS propagation).
#
# Pre-reqs Eliot manuel (incompressible) :
#   1. Compte Resend créé (free tier 3000 emails/mois suffit V1).
#   2. API Key créée : Resend Dashboard → API Keys → Create →
#      `domains:write + emails:send` permissions.
#
# Usage :
#   export RESEND_API_KEY="re_…"
#   bash ops/scripts/resend-domain-add.sh fxmilyapp.com
#       → ajoute le domaine, dump le DKIM dans /tmp/fxmily-resend-dkim.value
#   bash ops/scripts/resend-domain-add.sh fxmilyapp.com --verify-only
#       → poll status jusqu'à `verified`
#
# Sécurité :
#   - API key dans header Authorization, jamais loggé
#   - DKIM value écrit dans un fichier 0600 owner courant
#   - Refuse de runner sans le token

set -euo pipefail

readonly DOMAIN="${1:-${FXMILY_DOMAIN:-fxmilyapp.com}}"
readonly MODE="${2:-add}"
readonly API_BASE="https://api.resend.com"
readonly DKIM_OUT="${RESEND_DKIM_OUT:-/tmp/fxmily-resend-dkim.value}"

: "${RESEND_API_KEY:?RESEND_API_KEY env var required (Resend Dashboard → API Keys)}"

if ! command -v curl >/dev/null 2>&1; then
  echo "error: curl required" >&2; exit 2
fi
if ! command -v jq >/dev/null 2>&1; then
  echo "error: jq required" >&2; exit 2
fi

resend_api() {
  local method="$1" path="$2" body="${3:-}"
  local args=(
    --silent --show-error
    -X "$method"
    -H "Authorization: Bearer ${RESEND_API_KEY}"
    -H "Content-Type: application/json"
  )
  if [[ -n "$body" ]]; then
    args+=(--data "$body")
  fi
  curl "${args[@]}" "${API_BASE}${path}"
}

# ---- Find existing domain (idempotency) -----------------------------------
find_domain_id() {
  resend_api GET "/domains" \
    | jq -r --arg d "$DOMAIN" '.data[]? | select(.name == $d) | .id' \
    | head -n1
}

case "$MODE" in
  add | "")
    DOMAIN_ID=$(find_domain_id)
    if [[ -z "$DOMAIN_ID" ]]; then
      echo "→ Adding $DOMAIN to Resend …"
      ADD_RESP=$(resend_api POST "/domains" "$(jq -nc --arg name "$DOMAIN" --arg region "eu-west-1" '{name:$name,region:$region}')")
      DOMAIN_ID=$(echo "$ADD_RESP" | jq -r '.id // empty')
      if [[ -z "$DOMAIN_ID" ]]; then
        echo "error: Resend add failed :" >&2
        echo "$ADD_RESP" | jq . >&2
        exit 1
      fi
      echo "  ✓ created domain id=${DOMAIN_ID:0:8}…"
    else
      echo "  ✓ domain $DOMAIN already added (id=${DOMAIN_ID:0:8}…)"
    fi

    # ---- Fetch DKIM record ----
    DETAIL=$(resend_api GET "/domains/${DOMAIN_ID}")
    DKIM_VALUE=$(echo "$DETAIL" | jq -r '.records[]? | select(.type=="TXT" and (.name|startswith("resend._domainkey"))) | .value' | head -n1)
    if [[ -z "$DKIM_VALUE" ]]; then
      echo "error: could not extract DKIM value from Resend response" >&2
      echo "$DETAIL" | jq . >&2
      exit 1
    fi

    install -m 600 /dev/stdin "$DKIM_OUT" <<< "$DKIM_VALUE"
    echo "  ✓ DKIM value saved to $DKIM_OUT (mode 0600)"
    echo
    echo "Next :"
    echo "  export FXMILY_RESEND_DKIM_VALUE=\"\$(cat $DKIM_OUT)\""
    echo "  bash ops/scripts/cloudflare-dns-setup.sh $DOMAIN"
    echo "  # …wait 24h for DNS propagation…"
    echo "  bash ops/scripts/resend-domain-add.sh $DOMAIN --verify-only"
    ;;

  --verify-only)
    DOMAIN_ID=$(find_domain_id)
    if [[ -z "$DOMAIN_ID" ]]; then
      echo "error: domain $DOMAIN not registered with Resend yet (run without --verify-only first)" >&2
      exit 1
    fi
    echo "→ Triggering Resend verify …"
    resend_api POST "/domains/${DOMAIN_ID}/verify" >/dev/null
    sleep 5
    STATUS=$(resend_api GET "/domains/${DOMAIN_ID}" | jq -r '.status // "unknown"')
    case "$STATUS" in
      verified)
        echo "  ✅ Resend status : verified — emails from @${DOMAIN} will deliver."
        ;;
      pending | not_started)
        echo "  ⏳ Resend status : $STATUS"
        echo "    DNS propagation may still be in progress. Re-run in ~10 min."
        echo "    Or check : bash ops/scripts/verify-dns.sh $DOMAIN app.${DOMAIN}"
        exit 1
        ;;
      *)
        echo "  ⚠️  Resend status : $STATUS — investigate the dashboard."
        exit 1
        ;;
    esac
    ;;

  *)
    echo "usage: $(basename "$0") <domain> [--verify-only]" >&2
    exit 2
    ;;
esac
