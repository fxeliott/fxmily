#!/usr/bin/env bash
# Phase U (2026-05-09) — Master orchestrator pour la mise en prod V1.
#
# Enchaîne les 5 scripts ops dans le bon ordre + valide à chaque étape.
# Failsafe : si une étape échoue, le script s'arrête et indique précisément
# quoi faire pour reprendre (idempotent — relance au même endroit).
#
# Usage :
#   bash ops/scripts/prod-launch.sh [--skip-preflight] [--skip-verify-tokens]
#
# Pré-requis :
#   - tokens.local.env existe et contient les tokens externes
#   - GitHub CLI authentifié (`gh auth status`)
#   - SSH config : alias `hetzner-dieu` résoluble (cf. preflight-check.sh)
#
# Cycle complet (~15 min wall-clock dont ~10 min de polling DNS) :
#   1. preflight-check.sh        → SSH capacité hetzner-dieu
#   2. generate-local-secrets.sh → AUTH + CRON + VAPID dans tokens.local.env
#   3. test-tokens.sh            → valide les 6 tokens externes
#   4. bootstrap-fxmily.sh       → Resend domain + Cloudflare DNS + GH secrets
#   5. polling Resend verify     → attend que fxmilyapp.com soit verified
#   6. gh workflow run deploy    → déclenche le 1er deploy GH Actions
#   7. polling deploy status     → attend "succeeded"
#   8. curl /api/health          → confirme l'app live sur app.fxmilyapp.com

set -euo pipefail

readonly SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
readonly REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
readonly TOKENS_FILE="${TOKENS_FILE:-$REPO_ROOT/tokens.local.env}"
readonly DOMAIN="${FXMILY_DOMAIN:-fxmilyapp.com}"
readonly APP_HOST="app.${DOMAIN}"
readonly HETZNER_IP="${FXMILY_HETZNER_IP:-178.104.39.201}"

SKIP_PREFLIGHT=0
SKIP_VERIFY_TOKENS=0
for arg in "$@"; do
  case "$arg" in
    --skip-preflight)      SKIP_PREFLIGHT=1 ;;
    --skip-verify-tokens)  SKIP_VERIFY_TOKENS=1 ;;
    -h|--help)
      sed -n '/^# Phase U/,/^$/p' "$0" | sed 's/^# *//'
      exit 0
      ;;
  esac
done

# Pretty step
declare -i STEP=0
step() {
  STEP+=1
  echo ""
  echo "═══════════════════════════════════════════════════════════════"
  echo "  STEP $STEP — $1"
  echo "═══════════════════════════════════════════════════════════════"
}

# Wait for external state with timeout + retry
wait_for() {
  local desc="$1" cmd="$2" timeout="${3:-1800}" interval="${4:-30}"
  local elapsed=0
  echo "→ Polling : $desc (timeout ${timeout}s, interval ${interval}s)..."
  while ((elapsed < timeout)); do
    if eval "$cmd" >/dev/null 2>&1; then
      echo "  ✓ $desc"
      return 0
    fi
    printf '  · still waiting (%ds elapsed)\n' "$elapsed"
    sleep "$interval"
    elapsed=$((elapsed + interval))
  done
  echo "  ✗ Timeout après ${timeout}s — abandonne." >&2
  return 1
}

# ─────────────── STEP 1 — Preflight ───────────────
if ((SKIP_PREFLIGHT == 0)); then
  step "Preflight check sur hetzner-dieu"
  if ! bash "$SCRIPT_DIR/preflight-check.sh" "fxmily@hetzner-dieu"; then
    cat <<EOF >&2

❌ Preflight a flag des problèmes. Options :
  A) Libère de la RAM/disque sur hetzner-dieu et relance avec
     --skip-preflight (à tes risques).
  B) Provisionne un nouveau CX22 (~5€/mois) :
       bash ops/scripts/provision-hetzner.sh

EOF
    exit 1
  fi
fi

# ─────────────── STEP 2 — Generate local secrets ───────────────
step "Génère AUTH_SECRET + CRON_SECRET + VAPID keys (idempotent)"
if [[ ! -r "$TOKENS_FILE" ]]; then
  echo "  → tokens.local.env absent : copy de tokens.local.env.example"
  cp "$REPO_ROOT/ops/scripts/tokens.local.env.example" "$TOKENS_FILE"
  chmod 600 "$TOKENS_FILE"
  cat <<EOF

⚠️  Le fichier $TOKENS_FILE vient d'être créé.
    Ouvre-le et remplis :
      - HCLOUD_TOKEN (optionnel si tu skip Hetzner)
      - CLOUDFLARE_API_TOKEN
      - CLOUDFLARE_ZONE_ID
      - RESEND_API_KEY
      - SENTRY_DSN, NEXT_PUBLIC_SENTRY_DSN, SENTRY_AUTH_TOKEN

    Suis le guide HTML : docs/eliot-guide-prod-launch.html

    Puis relance : bash $0
EOF
  exit 1
fi
bash "$SCRIPT_DIR/generate-local-secrets.sh" "$TOKENS_FILE"

# ─────────────── STEP 3 — Test tokens ───────────────
if ((SKIP_VERIFY_TOKENS == 0)); then
  step "Validate tokens externes via API ping"
  if ! bash "$SCRIPT_DIR/test-tokens.sh" "$TOKENS_FILE" --skip-hetzner; then
    cat <<EOF >&2

❌ Au moins 1 token externe est invalide. Voir l'output ci-dessus.
    Fix les tokens dans $TOKENS_FILE puis relance :
      bash $0

EOF
    exit 1
  fi
fi

# ─────────────── STEP 4 — Bootstrap (Resend + Cloudflare + GH secrets) ───────────────
step "Bootstrap : Resend domain + Cloudflare DNS + GitHub secrets"
FXMILY_HETZNER_IP="$HETZNER_IP" \
FXMILY_DOMAIN="$DOMAIN" \
  bash "$SCRIPT_DIR/bootstrap-fxmily.sh" "$TOKENS_FILE" --skip-hetzner

# ─────────────── STEP 5 — Polling Resend verify ───────────────
step "Polling Resend domain verify (~10-15 min DNS propagation)"
# shellcheck source=/dev/null
set -a; . "$TOKENS_FILE"; set +a
RESEND_DOMAINS_JSON="$(curl -fsS -H "Authorization: Bearer $RESEND_API_KEY" \
  https://api.resend.com/domains 2>&1 || true)"
DOMAIN_ID="$(echo "$RESEND_DOMAINS_JSON" | grep -oE '"id":"[a-f0-9-]{36}"' | head -1 | sed 's/.*"\([a-f0-9-]*\)"/\1/')"
if [[ -z "$DOMAIN_ID" ]]; then
  echo "  ⚠️  Domain ID introuvable côté Resend — il n'a peut-être pas été ajouté correctement."
  echo "      Lance manuellement : curl -H 'Authorization: Bearer \$RESEND_API_KEY' https://api.resend.com/domains"
  exit 1
fi

wait_for "Resend $DOMAIN status=verified" \
  "curl -fsS -H 'Authorization: Bearer $RESEND_API_KEY' https://api.resend.com/domains/$DOMAIN_ID | grep -q '\"status\":\"verified\"'" \
  1800 30 || {
    echo ""
    echo "Si le timeout dépasse 30 min :"
    echo "  1. Verify les records DNS dans Cloudflare (étape 4 du bootstrap)"
    echo "  2. dig CNAME resend._domainkey.$DOMAIN"
    echo "  3. Re-trigger côté Resend : curl -X POST -H 'Authorization: Bearer \$RESEND_API_KEY' https://api.resend.com/domains/$DOMAIN_ID/verify"
    exit 1
  }

# ─────────────── STEP 6 — Trigger first deploy ───────────────
step "Déclenche le 1er deploy GitHub Actions"
gh workflow run deploy.yml -R fxeliott/fxmily

echo "  ⏳ Workflow déclenché. Attente du build (~5-10 min)..."
sleep 10

# Récupère le run ID le plus récent
RUN_ID="$(gh run list -R fxeliott/fxmily --workflow=deploy.yml --limit=1 --json databaseId --jq '.[0].databaseId')"
[[ -z "$RUN_ID" ]] && { echo "✗ Pas de run ID trouvé." >&2; exit 1; }
echo "  → Run ID : $RUN_ID"

if gh run watch "$RUN_ID" -R fxeliott/fxmily --exit-status; then
  echo "  ✓ Deploy succeeded"
else
  echo "  ✗ Deploy failed — voir : gh run view $RUN_ID --log-failed -R fxeliott/fxmily"
  exit 1
fi

# ─────────────── STEP 7 — Healthcheck final ───────────────
step "Healthcheck https://$APP_HOST/api/health"
wait_for "App répond 200 sur /api/health" \
  "curl -fsS https://$APP_HOST/api/health | grep -q '\"ok\":true'" \
  300 10

# ─────────────── Done ───────────────
echo ""
echo "════════════════════════════════════════════════════════════════"
echo "  ✅ Fxmily V1 LIVE sur https://$APP_HOST"
echo "════════════════════════════════════════════════════════════════"
echo ""
echo "Next steps (Eliot, manuels) :"
echo "  → Smoke iPhone (voir guide §9) : Add to Home Screen + push real-device"
echo "  → Rotate admin password : echo -n 'NouveauMdp' | bash $SCRIPT_DIR/rotate-admin-password.sh fxmily@hetzner-dieu eliot@$DOMAIN"
echo "  → 1ère invitation cohort : login admin + /admin/invite"
echo "  → (Opt) HSTS preload : https://hstspreload.org/?domain=$DOMAIN"
echo ""
echo "  Observer en live :"
echo "  - https://$APP_HOST/admin/system   (cohort + cron heartbeats)"
echo "  - Sentry dashboard                 (errors / replays)"
echo "  - Resend dashboard                 (delivery rate)"
