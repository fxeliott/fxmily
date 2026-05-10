#!/usr/bin/env bash
# Phase M — master bootstrap orchestrator for Fxmily V1 prod.
#
# Chains the 5 automation scripts in the right order, with a single
# `tokens.local.env` input file. Reduces Eliot's hands-on time from
# ~30 min (clicking through Hetzner / Cloudflare / Resend dashboards)
# to ~10 min (just signups + token generation + run this script).
#
# Pre-reqs Eliot manuel (incompressible — ~10 min) :
#
# RECOMMANDATION V1 (post-Phase R reality check 2026-05-09) :
# Utiliser l'Hetzner CX22 existant `hetzner-dieu` (178.104.39.201) +
# domaine `fxmilyapp.com` (déjà possédé) → coût supplémentaire = 0 €.
# Skip Hetzner provisioning + skip Cloudflare DNS (déjà configuré pour
# d'autres workloads — il suffira d'ajouter un sous-domaine `app`).
#
#   FXMILY_HETZNER_IP=178.104.39.201 FXMILY_DOMAIN=fxmilyapp.com \
#     bash ops/scripts/bootstrap-fxmily.sh tokens.local.env --skip-hetzner
#
#   1. Cloudflare account (déjà existant pour fxmilyapp.com)
#      → Crée un API Token "Edit zone DNS" scope fxmilyapp.com → CLOUDFLARE_API_TOKEN
#
#   2. Hetzner Cloud (skip provisioning si réutilisation `hetzner-dieu`)
#      Si nouveau CX22 nécessaire (cohabitation insuffisante avec autres
#      workloads) :
#      ⚠️  Hetzner Console → Project → Settings → Billing → Set spending alert
#          at 20 €/mois (CX22 = ~5 €/mois, marge confortable).
#      → Crée un API Token "Read & Write" → HCLOUD_TOKEN
#      → Upload SSH pub key → vu par hcloud-cli
#
#   3. Sentry account (free tier 5000 errors/mois, pas de CB demandée)
#      → Crée un projet Next.js "fxmily-web"
#      → Note le DSN + génère un Auth Token "project:write project:releases"
#
#   4. Resend account (free tier 3000 emails/mois + 100/jour cap, pas de CB)
#      → Crée une API Key "domains:write emails:send"
#
# Usage :
#   1. Crée tokens.local.env :
#        cp ops/scripts/tokens.local.env.example tokens.local.env
#        $EDITOR tokens.local.env  # rempli les 4 tokens
#        chmod 600 tokens.local.env
#   2. gh auth login   # GitHub CLI authenticated
#   3. bash ops/scripts/bootstrap-fxmily.sh tokens.local.env
#   4. shred -u tokens.local.env  # cleanup
#
# Idempotent : chaque step est skippable / re-runnable individuellement
# via les flags --skip-X.

set -euo pipefail

readonly SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# V1 default = `fxmilyapp.com` (Eliot's existing domain, post-Phase R pivot
# 2026-05-09). To use `fxmilyapp.com` (V2 — requires purchase) override via
# FXMILY_DOMAIN=fxmilyapp.com env var.
readonly DOMAIN="${FXMILY_DOMAIN:-fxmilyapp.com}"
readonly APP_HOST="app.${DOMAIN}"

usage() {
  cat <<EOF
usage: $(basename "$0") <tokens.local.env> [--skip-hetzner] [--skip-resend] [--skip-cloudflare] [--skip-github]

  tokens.local.env must define :
    HCLOUD_TOKEN=…
    CLOUDFLARE_API_TOKEN=…
    RESEND_API_KEY=re_…
    SENTRY_AUTH_TOKEN=sntrys_…
    SENTRY_ORG=fxmily
    SENTRY_PROJECT=fxmily-web
    SENTRY_DSN=https://…@…/…

  Optional :
    FXMILY_HETZNER_IP=X.X.X.X      (skip provisioning, wire DNS directly)
    SKIP_BUDGET_CAP_CHECK=1        (DANGEROUS — bypasses the budget cap reminder)

EOF
  exit 2
}

ENV_FILE="${1:-}"
[[ -z "$ENV_FILE" || "$ENV_FILE" == "-h" || "$ENV_FILE" == "--help" ]] && usage
[[ ! -r "$ENV_FILE" ]] && { echo "error: '$ENV_FILE' not readable" >&2; exit 2; }
shift || true

SKIP_HETZNER=0
SKIP_RESEND=0
SKIP_CLOUDFLARE=0
SKIP_GITHUB=0
for arg in "$@"; do
  case "$arg" in
    --skip-hetzner)    SKIP_HETZNER=1 ;;
    --skip-resend)     SKIP_RESEND=1 ;;
    --skip-cloudflare) SKIP_CLOUDFLARE=1 ;;
    --skip-github)     SKIP_GITHUB=1 ;;
    *) echo "unknown flag : $arg" >&2; usage ;;
  esac
done

# ---- Permission check on env file ------------------------------------------
PERMS=$(stat -c '%a' "$ENV_FILE" 2>/dev/null || stat -f '%A' "$ENV_FILE" 2>/dev/null || echo "?")
case "$PERMS" in
  600|400|?) ;;
  *)
    if [[ "${PERMS:1:1}" -ge 4 || "${PERMS:2:1}" -ge 4 ]]; then
      echo "error: '$ENV_FILE' too permissive (mode $PERMS). Run : chmod 600 '$ENV_FILE'" >&2
      exit 2
    fi
    ;;
esac

# ---- Source tokens (sub-shell scope) ---------------------------------------
# shellcheck disable=SC1090
source "$ENV_FILE"

# Required from the env file (those that aren't conditional).
: "${HCLOUD_TOKEN:?HCLOUD_TOKEN missing in $ENV_FILE}"
: "${CLOUDFLARE_API_TOKEN:?CLOUDFLARE_API_TOKEN missing in $ENV_FILE}"
: "${RESEND_API_KEY:?RESEND_API_KEY missing in $ENV_FILE}"
: "${SENTRY_AUTH_TOKEN:?SENTRY_AUTH_TOKEN missing in $ENV_FILE}"
: "${SENTRY_ORG:?SENTRY_ORG missing in $ENV_FILE}"
: "${SENTRY_PROJECT:?SENTRY_PROJECT missing in $ENV_FILE}"
: "${SENTRY_DSN:?SENTRY_DSN missing in $ENV_FILE}"

# ---- Budget cap reminder ---------------------------------------------------
if [[ "${SKIP_BUDGET_CAP_CHECK:-0}" != "1" ]]; then
  cat <<EOF

═══════════════════════════════════════════════════════════════
⚠️  BUDGET CAP CHECK (memory contraintes_financieres)

Avant de continuer, confirme que tu as configuré :

  ☐ Hetzner Cloud → Project → Settings → Billing → Spending alert ≤ 20 €/mois
  ☐ Cloudflare → Account → Billing → Budget alert ≤ 30 €/mois
  ☐ Sentry → Settings → Spend Caps → ON (free tier 5000 events/mo hard cap)
  ☐ Resend → free tier (3000 emails/mo hard cap, pas d'overage automatique)

Coût attendu V1 : ~5-15 €/mois (cf. SPEC §16). Aucun dépassement
silencieux ne doit être possible — l'incident Gemini avril 2026
(95 € abusés via key leak) ne se reproduira pas avec ces caps.

═══════════════════════════════════════════════════════════════
EOF
  read -r -p "Tous les budget caps configurés ? (yes/no) " confirm
  if [[ ! "$confirm" =~ ^[Yy](es)?$ ]]; then
    echo "Aborted. Configure les budget caps puis relance."
    exit 1
  fi
fi

# ---- Step 1 : Hetzner provisioning -----------------------------------------
if [[ "$SKIP_HETZNER" == "0" ]]; then
  if [[ -z "${FXMILY_HETZNER_IP:-}" ]]; then
    echo
    echo "═══ Step 1/5 : Hetzner CX22 provisioning ═══"
    HCLOUD_TOKEN="$HCLOUD_TOKEN" bash "${SCRIPT_DIR}/provision-hetzner.sh"
    # The provision-hetzner.sh script prints the IP; we capture it via the
    # final hcloud query so the caller doesn't have to manually export.
    export FXMILY_HETZNER_IP
    FXMILY_HETZNER_IP=$(hcloud server describe "${FXMILY_SERVER_NAME:-fxmily-prod}" -o format='{{.PublicNet.IPv4.IP}}')
    echo "  ✓ Hetzner IP : $FXMILY_HETZNER_IP"
  else
    echo "  ✓ Hetzner IP pré-set : $FXMILY_HETZNER_IP (skip provisioning)"
  fi
else
  echo "  ⊘ skipped Hetzner step (--skip-hetzner)"
  : "${FXMILY_HETZNER_IP:?FXMILY_HETZNER_IP must be set when --skip-hetzner is used}"
fi

# ---- Step 2 : Resend domain add + DKIM fetch -------------------------------
if [[ "$SKIP_RESEND" == "0" ]]; then
  echo
  echo "═══ Step 2/5 : Resend domain add ═══"
  RESEND_API_KEY="$RESEND_API_KEY" bash "${SCRIPT_DIR}/resend-domain-add.sh" "$DOMAIN"
  export FXMILY_RESEND_DKIM_VALUE
  FXMILY_RESEND_DKIM_VALUE="$(cat /tmp/fxmily-resend-dkim.value)"
else
  echo "  ⊘ skipped Resend step (--skip-resend)"
  : "${FXMILY_RESEND_DKIM_VALUE:?FXMILY_RESEND_DKIM_VALUE must be set when --skip-resend is used}"
fi

# ---- Step 3 : Cloudflare DNS records ---------------------------------------
if [[ "$SKIP_CLOUDFLARE" == "0" ]]; then
  echo
  echo "═══ Step 3/5 : Cloudflare DNS records ═══"
  CLOUDFLARE_API_TOKEN="$CLOUDFLARE_API_TOKEN" \
  FXMILY_HETZNER_IP="$FXMILY_HETZNER_IP" \
  FXMILY_RESEND_DKIM_VALUE="$FXMILY_RESEND_DKIM_VALUE" \
    bash "${SCRIPT_DIR}/cloudflare-dns-setup.sh" "$DOMAIN"
else
  echo "  ⊘ skipped Cloudflare step (--skip-cloudflare)"
fi

# ---- Step 4 : GitHub secrets ----------------------------------------------
if [[ "$SKIP_GITHUB" == "0" ]]; then
  echo
  echo "═══ Step 4/5 : GitHub secrets ═══"
  # Generate the cron secret if not already provided.
  : "${CRON_SECRET:=$(openssl rand -hex 24)}"
  # V1.5.2 fix : SSH key path is now configurable via HETZNER_SSH_KEY_FILE env.
  # Default ~/.ssh/id_ed25519 ; Eliot's machine uses ~/.ssh/id_rsa_hetzner.
  # `pose-github-secrets.sh` will detect the `_FILE` suffix and use
  # `gh secret set --body-file` to avoid multi-line corruption.
  HETZNER_SSH_KEY_FILE="${HETZNER_SSH_KEY_FILE:-$HOME/.ssh/id_ed25519}"
  HETZNER_SSH_KEY_FILE_EXPANDED="${HETZNER_SSH_KEY_FILE/#\~/$HOME}"
  if [[ ! -r "$HETZNER_SSH_KEY_FILE_EXPANDED" ]]; then
    echo "error: SSH private key not readable at '$HETZNER_SSH_KEY_FILE_EXPANDED'" >&2
    echo "  Override via : HETZNER_SSH_KEY_FILE=~/.ssh/id_rsa_hetzner bash $0" >&2
    echo "  Or generate one : ssh-keygen -t ed25519 -f ~/.ssh/id_ed25519 -N ''" >&2
    exit 2
  fi
  # Stage the values into a transient env file with strict perms.
  TMPSEC="$(mktemp)"
  trap 'shred -u "$TMPSEC" 2>/dev/null || rm -f "$TMPSEC"' EXIT
  chmod 600 "$TMPSEC"
  cat > "$TMPSEC" <<EOF
HETZNER_HOST="$FXMILY_HETZNER_IP"
HETZNER_SSH_KEY_FILE="$HETZNER_SSH_KEY_FILE_EXPANDED"
SENTRY_AUTH_TOKEN="$SENTRY_AUTH_TOKEN"
SENTRY_ORG="$SENTRY_ORG"
SENTRY_PROJECT="$SENTRY_PROJECT"
APP_URL="https://${APP_HOST}"
CRON_SECRET="$CRON_SECRET"
EOF
  bash "${SCRIPT_DIR}/pose-github-secrets.sh" "$TMPSEC"
  echo "  ✓ Repository CRON_SECRET=$CRON_SECRET"
  echo "    ⚠️  Note this value — you need to set the SAME in /etc/fxmily/web.env on the host."
else
  echo "  ⊘ skipped GitHub step (--skip-github)"
fi

# ---- Step 5 : Wait for DNS propagation + verify Resend ---------------------
echo
echo "═══ Step 5/5 : DNS propagation + Resend verify ═══"
echo "DNS records posted. Cloudflare typically propagates within minutes,"
echo "but Resend's verifier sometimes waits up to 24h."
echo
echo "Run when ready :"
echo "  bash ops/scripts/verify-dns.sh $DOMAIN $APP_HOST"
echo "  RESEND_API_KEY=$RESEND_API_KEY bash ops/scripts/resend-domain-add.sh $DOMAIN --verify-only"
echo

# ---- Summary ---------------------------------------------------------------
cat <<EOF

═══════════════════════════════════════════════════════════════
✅ Bootstrap complete.

Next manual steps (~5 min) :
  1. SSH into the host and run :
       scp ops/scripts/setup-host.sh root@$FXMILY_HETZNER_IP:/root/
       ssh root@$FXMILY_HETZNER_IP 'bash /root/setup-host.sh'
  2. Wait DNS propagation, verify Resend (cf. above).
  3. Trigger first deploy :
       gh workflow run deploy.yml -R fxeliott/fxmily
  4. Smoke prod :
       APP_URL=https://$APP_HOST CRON_SECRET=$CRON_SECRET bash ops/scripts/post-deploy-smoke.sh
  5. Manual UI smoke (4 steps — Chrome desktop + iPhone Safari) :
       cf. docs/runbook-prod-smoke-test.md §9-12.

Cleanup :
  shred -u $ENV_FILE
═══════════════════════════════════════════════════════════════
EOF
