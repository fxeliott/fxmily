#!/usr/bin/env bash
# J10 — Eliot prerequisite automation.
#
# Provisions a Hetzner Cloud CX22 the way the Fxmily prod stack expects.
# Uses `hcloud-cli` so the operator never has to click through the Cloud
# Console after the API token + SSH key are uploaded once.
#
# Usage:
#   1. Install `hcloud-cli` (Homebrew, scoop, or GitHub release):
#        brew install hcloud      # macOS
#        scoop install hcloud     # Windows
#        # OR: https://github.com/hetznercloud/cli/releases
#   2. Create a Hetzner project + API token (Read & Write).
#        Console: https://console.hetzner.cloud/projects/<id>/security/tokens
#   3. Upload your SSH public key to Hetzner ONCE:
#        hcloud ssh-key create --name eliot-laptop --public-key-from-file ~/.ssh/id_ed25519.pub
#   4. Export the token + run:
#        export HCLOUD_TOKEN="<your-write-token>"
#        bash ops/scripts/provision-hetzner.sh
#
# Idempotent: re-running the script re-uses the existing server / firewall
# if their names match. Safe to invoke during reprovisioning drills.
#
# Pricing snapshot (2026): CX22 = 4.81 €/month + 1 € public IPv4. The
# script asks for confirmation before the `server create` call.

set -euo pipefail

readonly SERVER_NAME="${FXMILY_SERVER_NAME:-fxmily-prod}"
readonly SERVER_TYPE="${FXMILY_SERVER_TYPE:-cx22}"
readonly SERVER_IMAGE="${FXMILY_SERVER_IMAGE:-ubuntu-24.04}"
readonly SERVER_LOCATION="${FXMILY_SERVER_LOCATION:-fsn1}"  # Falkenstein UE
readonly FIREWALL_NAME="${FXMILY_FIREWALL_NAME:-fxmily-prod-firewall}"
readonly SSH_KEY_NAME="${FXMILY_SSH_KEY_NAME:-eliot-laptop}"

if [[ -z "${HCLOUD_TOKEN:-}" ]]; then
  echo "Error: HCLOUD_TOKEN env var is required (Hetzner Cloud API token)." >&2
  echo "       https://console.hetzner.cloud → Project → Security → API Tokens" >&2
  exit 2
fi

if ! command -v hcloud >/dev/null 2>&1; then
  echo "Error: 'hcloud' CLI not found. Install via 'brew install hcloud' or" >&2
  echo "       https://github.com/hetznercloud/cli/releases" >&2
  exit 2
fi

# ---- 1. Verify SSH key uploaded ---------------------------------------------
if ! hcloud ssh-key list -o noheader -o columns=name | grep -qx "$SSH_KEY_NAME"; then
  echo "Error: SSH key '$SSH_KEY_NAME' not found on Hetzner." >&2
  echo "       Upload it once with:" >&2
  echo "         hcloud ssh-key create --name $SSH_KEY_NAME --public-key-from-file ~/.ssh/id_ed25519.pub" >&2
  exit 2
fi

# ---- 2. Firewall (idempotent) -----------------------------------------------
if ! hcloud firewall list -o noheader -o columns=name | grep -qx "$FIREWALL_NAME"; then
  echo "→ Creating firewall '$FIREWALL_NAME' …"
  hcloud firewall create --name "$FIREWALL_NAME" \
    --rules-file /dev/stdin <<'JSON'
[
  { "direction": "in", "protocol": "tcp", "port": "22",  "source_ips": ["0.0.0.0/0", "::/0"], "description": "SSH" },
  { "direction": "in", "protocol": "tcp", "port": "80",  "source_ips": ["0.0.0.0/0", "::/0"], "description": "HTTP (Caddy ACME)" },
  { "direction": "in", "protocol": "tcp", "port": "443", "source_ips": ["0.0.0.0/0", "::/0"], "description": "HTTPS" },
  { "direction": "in", "protocol": "udp", "port": "443", "source_ips": ["0.0.0.0/0", "::/0"], "description": "HTTP/3" }
]
JSON
else
  echo "✓ Firewall '$FIREWALL_NAME' already exists — skipping create."
fi

# ---- 3. Server (idempotent) -------------------------------------------------
if hcloud server list -o noheader -o columns=name | grep -qx "$SERVER_NAME"; then
  echo "✓ Server '$SERVER_NAME' already exists — skipping create."
  hcloud server describe "$SERVER_NAME" -o columns=name,status,ipv4,ipv6
else
  echo
  echo "About to create:"
  echo "  Name:     $SERVER_NAME"
  echo "  Type:     $SERVER_TYPE  (~5 €/mois)"
  echo "  Image:    $SERVER_IMAGE"
  echo "  Location: $SERVER_LOCATION"
  echo "  SSH key:  $SSH_KEY_NAME"
  echo "  Firewall: $FIREWALL_NAME"
  echo
  read -r -p "Proceed? [y/N] " confirm
  if [[ ! "$confirm" =~ ^[Yy]$ ]]; then
    echo "Aborted."
    exit 1
  fi

  echo "→ Creating server '$SERVER_NAME' …"
  hcloud server create \
    --name "$SERVER_NAME" \
    --type "$SERVER_TYPE" \
    --image "$SERVER_IMAGE" \
    --location "$SERVER_LOCATION" \
    --ssh-key "$SSH_KEY_NAME" \
    --firewall "$FIREWALL_NAME" \
    --label fxmily=prod
fi

# ---- 4. Print connection details --------------------------------------------
IP=$(hcloud server describe "$SERVER_NAME" -o format='{{.PublicNet.IPv4.IP}}')
echo
echo "✅ Server up. Connect with:"
echo "     ssh root@$IP"
echo
echo "Next steps:"
echo "  1. Copy ops/scripts/setup-host.sh to the host and run it as root."
echo "       scp ops/scripts/setup-host.sh root@$IP:/root/"
echo "       ssh root@$IP 'bash /root/setup-host.sh'"
echo "  2. Add the IP as a Cloudflare DNS A record for app.fxmilyapp.com (proxied=NO)."
echo "  3. Populate /etc/fxmily/web.env + /etc/fxmily/cron.env on the host."
echo "  4. cd /opt/fxmily && docker compose -f docker-compose.prod.yml pull && up -d"
echo
echo "Hetzner IP: $IP   (export this as HETZNER_HOST in GitHub secrets)"
