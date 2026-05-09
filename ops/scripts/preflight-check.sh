#!/usr/bin/env bash
# Phase T (2026-05-09) — Vérifie la capacité de hetzner-dieu (server existant)
# avant de cohabiter avec Fxmily. SSH read-only, ne modifie rien.
#
# Usage :
#   bash ops/scripts/preflight-check.sh [user@host]
#
# Default : 'fxmily@hetzner-dieu' (lit ~/.ssh/config alias).

set -euo pipefail

readonly TARGET="${1:-fxmily@hetzner-dieu}"

echo "→ SSH preflight check on $TARGET"
echo ""

# Probe SSH
if ! ssh -o BatchMode=yes -o ConnectTimeout=5 "$TARGET" 'echo ok' &>/dev/null; then
  echo "✗ SSH connection failed (BatchMode). Vérifie :"
  echo "   1. ~/.ssh/config définit l'alias '$TARGET'"
  echo "   2. ~/.ssh/id_rsa_hetzner (ou la clé spécifiée) est readable"
  echo "   3. La clé pub correspondante est dans authorized_keys du serveur"
  exit 1
fi
echo "  ✓ SSH OK"

# Capacité
echo ""
echo "→ Memory / Disk / Containers"
ssh "$TARGET" 'cat <<__EOT__
$(free -h | head -2)

$(df -h / 2>/dev/null | head -2)

$(docker ps --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}" 2>/dev/null || echo "(docker non accessible — pas de containers ou daemon down)")
__EOT__
'

# Verdict automatique
echo ""
echo "→ Verdict"
ram_avail_mb="$(ssh "$TARGET" "free -m | awk '/^Mem:/ {print \$7}'" 2>/dev/null || echo 0)"
disk_avail_gb="$(ssh "$TARGET" "df --output=avail / | tail -1 | awk '{print int(\$1/1024/1024)}'" 2>/dev/null || echo 0)"

THRESHOLD_RAM_MB=1500
THRESHOLD_DISK_GB=5

echo "  RAM available : ${ram_avail_mb} MB (threshold ≥ ${THRESHOLD_RAM_MB} MB)"
echo "  Disk free     : ${disk_avail_gb} GB (threshold ≥ ${THRESHOLD_DISK_GB} GB)"

VERDICT_OK=1
if [[ "$ram_avail_mb" -lt "$THRESHOLD_RAM_MB" ]]; then
  echo "  ⚠️  RAM insuffisante pour cohabiter Fxmily web + Postgres + Caddy"
  VERDICT_OK=0
fi
if [[ "$disk_avail_gb" -lt "$THRESHOLD_DISK_GB" ]]; then
  echo "  ⚠️  Disque insuffisant"
  VERDICT_OK=0
fi

echo ""
if [[ "$VERDICT_OK" == "1" ]]; then
  echo "✅ COHABITATION OK — réutilise hetzner-dieu pour Fxmily."
  echo "   Lance : bash ops/scripts/bootstrap-fxmily.sh tokens.local.env --skip-hetzner"
  echo "   avec FXMILY_HETZNER_IP=178.104.39.201 dans tokens.local.env."
else
  echo "❌ COHABITATION RISQUÉE — provisionne un nouveau CX22 (~5€/mois) :"
  echo "   bash ops/scripts/provision-hetzner.sh"
  echo ""
  echo "   OU libère de la RAM/disque sur hetzner-dieu d'abord."
fi

# Caddy cohabitation
echo ""
echo "→ Caddy port 80/443 cohabitation"
caddy_running="$(ssh "$TARGET" 'docker ps --filter ancestor=caddy --format "{{.Names}}"' 2>/dev/null || true)"
if [[ -n "$caddy_running" ]]; then
  echo "  ⚠️  Un Caddy tourne déjà ($caddy_running) sur 80/443"
  echo "      → Tu DOIS éditer son Caddyfile pour ajouter un bloc"
  echo "        'app.fxmilyapp.com' AU LIEU de lancer un second Caddy."
  echo "      → Envoie-moi son Caddyfile (\`cat\`), je te le merge."
else
  echo "  ✓ Aucun Caddy détecté — Fxmily Caddy peut bind 80/443 librement."
fi
