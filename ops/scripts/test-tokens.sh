#!/usr/bin/env bash
# Phase T (2026-05-09) — Validate chaque token externe via API ping AVANT
# de lancer le bootstrap. Évite de découvrir un token mauvais après que
# 5 minutes de provisioning soient passées.
#
# Tests effectués (read-only, idempotent) :
#   1. CLOUDFLARE_API_TOKEN  → GET /user/tokens/verify + GET /zones?name=...
#   2. RESEND_API_KEY        → GET /domains
#   3. SENTRY_AUTH_TOKEN     → GET /api/0/projects/{org}/{proj}/
#   4. HCLOUD_TOKEN (opt)    → GET /servers (skip si --skip-hetzner)
#   5. GitHub auth           → gh auth status
#
# Usage :
#   bash ops/scripts/test-tokens.sh [tokens.local.env] [--skip-hetzner]

set -euo pipefail

readonly SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
readonly REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
readonly TOKENS_FILE="${1:-$REPO_ROOT/tokens.local.env}"

SKIP_HETZNER=0
for arg in "$@"; do
  [[ "$arg" == "--skip-hetzner" ]] && SKIP_HETZNER=1
done

[[ ! -r "$TOKENS_FILE" ]] && { echo "error: '$TOKENS_FILE' not readable" >&2; exit 2; }
# Subshell source pour ne pas polluer le shell parent
set -a; . "$TOKENS_FILE"; set +a

declare -i FAILED=0
declare -i PASSED=0

ok()   { echo "  ✓ $1"; PASSED+=1; }
fail() { echo "  ✗ $1" >&2; FAILED+=1; }
warn() { echo "  ! $1"; }

# --- 1. Cloudflare ---
echo ""
echo "→ Cloudflare API token"
if [[ -z "${CLOUDFLARE_API_TOKEN:-}" ]]; then
  fail "CLOUDFLARE_API_TOKEN absent"
else
  resp="$(curl -fsS -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" \
    https://api.cloudflare.com/client/v4/user/tokens/verify 2>&1 || echo '{"success":false}')"
  if echo "$resp" | grep -q '"status":"active"'; then
    ok "Token actif"
  else
    fail "Token invalide ou expiré → $resp"
  fi

  # Zone resolution
  if [[ -n "${CLOUDFLARE_ZONE_NAME:-}" ]]; then
    zone_resp="$(curl -fsS -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" \
      "https://api.cloudflare.com/client/v4/zones?name=${CLOUDFLARE_ZONE_NAME}" 2>&1 || echo '{}')"
    zone_id="$(echo "$zone_resp" | grep -oE '"id":"[a-f0-9]{32}"' | head -1 | sed 's/.*"\([a-f0-9]*\)"/\1/')"
    if [[ -n "$zone_id" ]]; then
      ok "Zone $CLOUDFLARE_ZONE_NAME résolue (id: ${zone_id:0:8}...)"
      if [[ -n "${CLOUDFLARE_ZONE_ID:-}" && "${CLOUDFLARE_ZONE_ID}" != "$zone_id" ]]; then
        fail "CLOUDFLARE_ZONE_ID dans tokens.local.env ne matche pas la zone résolue → corrige"
      fi
    else
      fail "Zone $CLOUDFLARE_ZONE_NAME non trouvée → vérifie le scope du token (Zone:Zone:Read sur la zone)"
    fi
  fi
fi

# --- 2. Resend ---
echo ""
echo "→ Resend API key"
if [[ -z "${RESEND_API_KEY:-}" ]]; then
  fail "RESEND_API_KEY absent"
elif [[ ! "${RESEND_API_KEY}" =~ ^re_[A-Za-z0-9_-]{15,}$ ]]; then
  fail "RESEND_API_KEY format invalide (attendu: re_xxx)"
else
  resp="$(curl -fsS -H "Authorization: Bearer $RESEND_API_KEY" \
    https://api.resend.com/domains 2>&1 || echo '{"name":"unauthorized"}')"
  if echo "$resp" | grep -q '"data"'; then
    ok "Token actif (Resend domains accessible)"
  else
    fail "Token invalide ou scopes insuffisants → $resp"
  fi
fi

# --- 3. Sentry ---
echo ""
echo "→ Sentry Auth Token + DSN"
if [[ -z "${SENTRY_AUTH_TOKEN:-}" ]]; then
  fail "SENTRY_AUTH_TOKEN absent"
elif [[ ! "${SENTRY_AUTH_TOKEN}" =~ ^sntrys_ ]]; then
  warn "SENTRY_AUTH_TOKEN n'a pas le préfixe sntrys_ — peut être un legacy User Token, OK"
fi
if [[ -z "${SENTRY_DSN:-}" ]]; then
  fail "SENTRY_DSN absent"
elif [[ ! "${SENTRY_DSN}" =~ ^https://[a-f0-9]+@o[0-9]+\.ingest\.(de|us)\.sentry\.io/ ]]; then
  fail "SENTRY_DSN format invalide (attendu: https://hash@oXXX.ingest.[de|us].sentry.io/N)"
else
  ok "DSN format OK"
fi
if [[ -n "${SENTRY_AUTH_TOKEN:-}" && -n "${SENTRY_ORG:-}" && -n "${SENTRY_PROJECT:-}" ]]; then
  resp="$(curl -fsS -H "Authorization: Bearer $SENTRY_AUTH_TOKEN" \
    "https://sentry.io/api/0/projects/${SENTRY_ORG}/${SENTRY_PROJECT}/" 2>&1 || echo '{"detail":"err"}')"
  if echo "$resp" | grep -q '"slug":"'; then
    ok "Auth Token + projet ${SENTRY_ORG}/${SENTRY_PROJECT} accessible"
  else
    fail "Auth Token / projet inaccessible → $resp"
  fi
fi

# --- 4. Hetzner ---
echo ""
echo "→ Hetzner Cloud token"
if [[ "$SKIP_HETZNER" == "1" ]]; then
  warn "Skipped (--skip-hetzner — tu réutilises le serveur existant via SSH)"
elif [[ -z "${HCLOUD_TOKEN:-}" ]]; then
  warn "HCLOUD_TOKEN absent — OK si tu réutilises hetzner-dieu (passe --skip-hetzner)"
else
  resp="$(curl -fsS -H "Authorization: Bearer $HCLOUD_TOKEN" \
    https://api.hetzner.cloud/v1/servers 2>&1 || echo '{"error":"err"}')"
  if echo "$resp" | grep -q '"servers":'; then
    n="$(echo "$resp" | grep -oE '"id":[0-9]+' | wc -l)"
    ok "Token actif ($n serveur(s) visible(s))"
  else
    fail "Token invalide → $resp"
  fi
fi

# --- 5. GitHub CLI ---
echo ""
echo "→ GitHub CLI auth"
if command -v gh >/dev/null && gh auth status >/dev/null 2>&1; then
  ok "gh CLI authentifié"
else
  fail "gh CLI non authentifié → lance 'gh auth login'"
fi

# --- 6. Local secrets sanity ---
echo ""
echo "→ Local secrets (générés via generate-local-secrets.sh)"
for v in AUTH_SECRET CRON_SECRET VAPID_PUBLIC_KEY VAPID_PRIVATE_KEY NEXT_PUBLIC_VAPID_PUBLIC_KEY; do
  if [[ -z "${!v:-}" ]]; then
    fail "$v absent"
  else
    ok "$v posé"
  fi
done

# Cross-check VAPID public = NEXT_PUBLIC
if [[ "${VAPID_PUBLIC_KEY:-x}" != "${NEXT_PUBLIC_VAPID_PUBLIC_KEY:-y}" ]]; then
  fail "VAPID_PUBLIC_KEY ≠ NEXT_PUBLIC_VAPID_PUBLIC_KEY (DOIVENT être identiques)"
fi

# --- Résumé ---
echo ""
echo "═══════════════════════════════════════════"
echo "  $PASSED passés  ·  $FAILED échoués"
echo "═══════════════════════════════════════════"
if [[ "$FAILED" -gt 0 ]]; then
  echo ""
  echo "❌ Corrige les échecs ci-dessus avant de lancer bootstrap-fxmily.sh"
  exit 1
fi
echo ""
echo "✅ Tous les tokens sont valides — tu peux lancer :"
echo "   FXMILY_HETZNER_IP=178.104.39.201 \\"
echo "     bash ops/scripts/bootstrap-fxmily.sh $TOKENS_FILE --skip-hetzner"
