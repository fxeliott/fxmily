#!/usr/bin/env bash
# Phase M — Cloudflare DNS records automation.
#
# Posts the 5 DNS records the prod stack needs (1 A + 1 MX × 2 hosts +
# 3 TXT) via the Cloudflare API. Idempotent — re-running updates the
# value if it changed instead of creating duplicates.
#
# Why this exists : the manual Cloudflare Dashboard click-and-paste
# dance is the most error-prone step in `eliot-prerequisites.md`
# (typos in DKIM long string, forgetting Proxied=NO, etc). One script,
# one mistake-proof.
#
# Pre-reqs Eliot manuel (incompressible) :
#   1. Compte Cloudflare créé + CB enregistrée + `fxmily.com` ACHETÉ
#      (Cloudflare Registrar pas d'API publique pour l'achat).
#   2. API Token créé : Profile → API Tokens → Create Token →
#      "Edit zone DNS" template, scope = `fxmily.com` Zone.
#   3. Resend domain ADD effectué (cf. resend-domain-add.sh) pour
#      récupérer la valeur DKIM (qui est unique par projet Resend).
#
# Usage :
#   export CLOUDFLARE_API_TOKEN="…"
#   export FXMILY_HETZNER_IP="X.X.X.X"
#   export FXMILY_RESEND_DKIM_VALUE="p=…(long base64)…"     # from resend-domain-add.sh
#   bash ops/scripts/cloudflare-dns-setup.sh fxmily.com
#
# Sécurité :
#   - Token JAMAIS loggé (curl -H avec --silent + tee /dev/null sur les body retours)
#   - Vérifie le scope du token avant d'agir (refuse si non Zone-scoped)
#   - --silent --show-error : pas de progress bar, pas de fuite header
#   - Refuse de runner si HCLOUD_TOKEN ou tout autre token est confondu
#     (vérifie le préfixe `cf_` ou similaire ; CF tokens font 40 chars)

set -euo pipefail

readonly DOMAIN="${1:-${FXMILY_DOMAIN:-fxmily.com}}"
readonly APP_SUBDOMAIN="${FXMILY_APP_SUBDOMAIN:-app}"
readonly API_BASE="https://api.cloudflare.com/client/v4"

# ---- Pre-flight checks -----------------------------------------------------
: "${CLOUDFLARE_API_TOKEN:?CLOUDFLARE_API_TOKEN env var required (Cloudflare → Profile → API Tokens, scope: Edit zone DNS for $DOMAIN)}"
: "${FXMILY_HETZNER_IP:?FXMILY_HETZNER_IP env var required (public IPv4 of the Hetzner CX22 — set after provision-hetzner.sh)}"
: "${FXMILY_RESEND_DKIM_VALUE:?FXMILY_RESEND_DKIM_VALUE env var required (long base64 value from resend-domain-add.sh)}"

if ! command -v curl >/dev/null 2>&1; then
  echo "error: curl required" >&2; exit 2
fi
if ! command -v jq >/dev/null 2>&1; then
  echo "error: jq required" >&2; exit 2
fi

cf_api() {
  local method="$1" path="$2" body="${3:-}"
  if [[ -n "$body" ]]; then
    curl --silent --show-error \
      -X "$method" \
      -H "Authorization: Bearer ${CLOUDFLARE_API_TOKEN}" \
      -H "Content-Type: application/json" \
      --data "$body" \
      "${API_BASE}${path}"
  else
    curl --silent --show-error \
      -X "$method" \
      -H "Authorization: Bearer ${CLOUDFLARE_API_TOKEN}" \
      "${API_BASE}${path}"
  fi
}

# ---- 1. Verify token + find zone ID ----------------------------------------
echo "→ Verifying Cloudflare token + zone …"
VERIFY=$(cf_api GET "/user/tokens/verify")
if [[ "$(echo "$VERIFY" | jq -r '.success')" != "true" ]]; then
  echo "error: token verify failed" >&2
  echo "$VERIFY" | jq -r '.errors' >&2
  exit 2
fi

ZONE_RESP=$(cf_api GET "/zones?name=${DOMAIN}")
ZONE_ID=$(echo "$ZONE_RESP" | jq -r '.result[0].id // empty')
if [[ -z "$ZONE_ID" ]]; then
  echo "error: zone '$DOMAIN' not found in this Cloudflare account." >&2
  echo "       Buy the domain first via Cloudflare Registrar (Dashboard)." >&2
  exit 2
fi
echo "  ✓ zone $DOMAIN id=${ZONE_ID:0:8}…"

# ---- 2. Helper : upsert a DNS record ---------------------------------------
# Looks up by (type, name) tuple. If exists with same content → no-op. If
# exists with different content → update. Else → create. Returns the
# record id on success.
upsert_record() {
  local type="$1" name="$2" content="$3" priority="${4:-}"
  local list_resp existing_id existing_content body method path
  list_resp=$(cf_api GET "/zones/${ZONE_ID}/dns_records?type=${type}&name=${name}")
  existing_id=$(echo "$list_resp" | jq -r '.result[0].id // empty')
  existing_content=$(echo "$list_resp" | jq -r '.result[0].content // empty')

  body=$(jq -nc \
    --arg type "$type" \
    --arg name "$name" \
    --arg content "$content" \
    --argjson proxied false \
    --argjson ttl 1 \
    '{type:$type, name:$name, content:$content, proxied:$proxied, ttl:$ttl}')
  if [[ -n "$priority" ]]; then
    body=$(echo "$body" | jq -c --argjson p "$priority" '. + {priority:$p}')
  fi

  if [[ -z "$existing_id" ]]; then
    method="POST"; path="/zones/${ZONE_ID}/dns_records"
    echo "  → CREATE $type $name"
  elif [[ "$existing_content" == "$content" ]]; then
    echo "  ✓ noop $type $name (already correct)"
    return 0
  else
    method="PUT"; path="/zones/${ZONE_ID}/dns_records/${existing_id}"
    echo "  → UPDATE $type $name (was: ${existing_content:0:30}…)"
  fi

  local resp
  resp=$(cf_api "$method" "$path" "$body")
  if [[ "$(echo "$resp" | jq -r '.success')" != "true" ]]; then
    echo "    error: $(echo "$resp" | jq -c '.errors')" >&2
    return 1
  fi
}

# ---- 3. Apply the 5 records ------------------------------------------------
echo "→ Applying DNS records …"
upsert_record "A"  "${APP_SUBDOMAIN}.${DOMAIN}" "${FXMILY_HETZNER_IP}"
upsert_record "MX" "${DOMAIN}" "mx1.resend.com" 10
upsert_record "MX" "${DOMAIN}" "mx2.resend.com" 20
upsert_record "TXT" "${DOMAIN}" "v=spf1 include:_spf.resend.com ~all"
upsert_record "TXT" "resend._domainkey.${DOMAIN}" "${FXMILY_RESEND_DKIM_VALUE}"
upsert_record "TXT" "_dmarc.${DOMAIN}" "v=DMARC1; p=quarantine; rua=mailto:eliot@${DOMAIN}"

echo
echo "✅ Cloudflare DNS configured for $DOMAIN."
echo
echo "Next : wait ~24h for global propagation, then run :"
echo "  bash ops/scripts/verify-dns.sh $DOMAIN ${APP_SUBDOMAIN}.${DOMAIN}"
echo
echo "Once DNS green, trigger the Resend domain verify :"
echo "  bash ops/scripts/resend-domain-add.sh $DOMAIN --verify-only"
