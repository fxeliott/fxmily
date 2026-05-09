#!/usr/bin/env bash
# Phase T (2026-05-09) — Génère AUTH_SECRET + CRON_SECRET + VAPID keys
# en local, en une commande, et les écrit dans tokens.local.env (mode 600).
#
# **NE JAMAIS lancer ce script depuis Claude** — les valeurs traversent
# stdout et finiront dans les logs Anthropic. Lance-le toi-même dans une
# PowerShell/Bash normale, puis copie/colle les valeurs si besoin.
#
# Usage :
#   bash ops/scripts/generate-local-secrets.sh [tokens.local.env]
#
# Si le fichier passé en argument existe déjà, on PROMPT avant d'overwrite
# (default : append en bas si les vars sont absentes, sinon skip).

set -euo pipefail

readonly SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
readonly REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
readonly TOKENS_FILE="${1:-$REPO_ROOT/tokens.local.env}"

usage() {
  cat <<EOF
usage: $(basename "$0") [tokens.local.env]

  Génère 5 secrets locaux et les pose dans le fichier tokens.local.env :
    - AUTH_SECRET       (openssl rand -base64 32)
    - CRON_SECRET       (openssl rand -hex 24)
    - VAPID_PUBLIC_KEY  + NEXT_PUBLIC_VAPID_PUBLIC_KEY (web-push)
    - VAPID_PRIVATE_KEY (web-push)

  ⚠️  ATTENTION : ne lance PAS ce script depuis Claude.
EOF
  exit 2
}

[[ "${1:-}" == "-h" || "${1:-}" == "--help" ]] && usage

command -v openssl >/dev/null || { echo "error: openssl required" >&2; exit 1; }
command -v pnpm >/dev/null || { echo "error: pnpm required" >&2; exit 1; }

# 1. Touch + chmod le fichier output
touch "$TOKENS_FILE"
chmod 600 "$TOKENS_FILE"

declare -A NEW_VARS

echo "→ Generating AUTH_SECRET (32 bytes base64)..."
NEW_VARS[AUTH_SECRET]="$(openssl rand -base64 32)"

echo "→ Generating CRON_SECRET (24 bytes hex)..."
NEW_VARS[CRON_SECRET]="$(openssl rand -hex 24)"

echo "→ Generating VAPID keys via pnpm web-push..."
# web-push CLI prints :
#   =======================================
#
#   Public Key:
#   <87 chars>
#
#   Private Key:
#   <43 chars>
#
#   =======================================
VAPID_OUT="$(cd "$REPO_ROOT" && pnpm --filter @fxmily/web exec web-push generate-vapid-keys 2>/dev/null || true)"
NEW_VARS[VAPID_PUBLIC_KEY]="$(echo "$VAPID_OUT" | awk '/Public Key:/{getline;getline;print}' | tr -d '[:space:]')"
NEW_VARS[VAPID_PRIVATE_KEY]="$(echo "$VAPID_OUT" | awk '/Private Key:/{getline;getline;print}' | tr -d '[:space:]')"
NEW_VARS[NEXT_PUBLIC_VAPID_PUBLIC_KEY]="${NEW_VARS[VAPID_PUBLIC_KEY]}"

if [[ -z "${NEW_VARS[VAPID_PUBLIC_KEY]}" || -z "${NEW_VARS[VAPID_PRIVATE_KEY]}" ]]; then
  echo "error: VAPID key generation failed (check pnpm + web-push install)" >&2
  exit 1
fi

# 2. Pose les vars dans le fichier (append si absent, skip si présent et non vide)
for key in AUTH_SECRET CRON_SECRET VAPID_PUBLIC_KEY VAPID_PRIVATE_KEY NEXT_PUBLIC_VAPID_PUBLIC_KEY; do
  if grep -qE "^${key}=." "$TOKENS_FILE" 2>/dev/null; then
    echo "  ${key}: already set in $TOKENS_FILE (skipping — delete the line manually if you want to rotate)"
  else
    # Remove blank-value placeholder line if present
    sed -i.bak "/^${key}=$/d" "$TOKENS_FILE" 2>/dev/null && rm -f "$TOKENS_FILE.bak"
    echo "${key}=${NEW_VARS[$key]}" >> "$TOKENS_FILE"
    echo "  ${key}: ✓ posé"
  fi
done

# 3. Ajoute VAPID_SUBJECT placeholder si absent
if ! grep -qE "^VAPID_SUBJECT=" "$TOKENS_FILE" 2>/dev/null; then
  echo "VAPID_SUBJECT=mailto:eliot@fxmilyapp.com" >> "$TOKENS_FILE"
  echo "  VAPID_SUBJECT: ✓ posé (mailto:eliot@fxmilyapp.com — adapte si besoin)"
fi

# 4. Affiche le résumé final (SANS valeurs en clair, juste les noms)
echo ""
echo "✅ Secrets posés dans $TOKENS_FILE"
echo "   chmod 600 confirmé."
echo ""
echo "   Variables maintenant définies (valeurs masquées) :"
grep -E "^(AUTH_SECRET|CRON_SECRET|VAPID_PUBLIC_KEY|VAPID_PRIVATE_KEY|NEXT_PUBLIC_VAPID_PUBLIC_KEY|VAPID_SUBJECT)=" "$TOKENS_FILE" \
  | sed -E 's/^([A-Z_]+)=.{0,8}.*/  ✓ \1=<…>/'
echo ""
echo "→ Étape suivante : ouvre $TOKENS_FILE et remplis les autres tokens"
echo "  (HCLOUD_TOKEN, CLOUDFLARE_API_TOKEN, RESEND_API_KEY, SENTRY_*) puis"
echo "  bash ops/scripts/test-tokens.sh $TOKENS_FILE"
