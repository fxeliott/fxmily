#!/usr/bin/env bash
# J10 — runs ON the Hetzner host (root) right after `provision-hetzner.sh`.
#
# Carbon-copy of `docs/runbook-hetzner-deploy.md` §1+§2 turned into a script
# so Eliot can copy/paste a single command:
#
#   scp ops/scripts/setup-host.sh root@<IP>:/root/
#   ssh root@<IP> 'bash /root/setup-host.sh'
#
# After this finishes, log out as root, log back in as `fxmily`, and run
# `setup-host-second-stage.sh` (or the manual `aws configure` + secrets
# planted instructions in the runbook).

set -euo pipefail

if [[ "$EUID" -ne 0 ]]; then
  echo "Error: setup-host.sh must run as root. Use 'sudo bash setup-host.sh' or ssh as root." >&2
  exit 2
fi

# ---- 1. Create unprivileged fxmily user ------------------------------------
if ! id -u fxmily >/dev/null 2>&1; then
  adduser --disabled-password --gecos "" fxmily
  usermod -aG sudo fxmily
  mkdir -p /home/fxmily/.ssh
  cp /root/.ssh/authorized_keys /home/fxmily/.ssh/
  chown -R fxmily:fxmily /home/fxmily/.ssh
  chmod 700 /home/fxmily/.ssh
  chmod 600 /home/fxmily/.ssh/authorized_keys
  echo "✓ user 'fxmily' created"
else
  echo "✓ user 'fxmily' already exists"
fi

# ---- 2. Harden SSH ----------------------------------------------------------
sed -i 's/^#\?PermitRootLogin .*/PermitRootLogin no/' /etc/ssh/sshd_config
sed -i 's/^#\?PasswordAuthentication .*/PasswordAuthentication no/' /etc/ssh/sshd_config
systemctl restart ssh
echo "✓ SSH hardened (no root login, no password auth)"

# ---- 3. System packages -----------------------------------------------------
apt-get update -y
apt-get upgrade -y
apt-get install -y \
  docker.io docker-compose-v2 \
  ufw certbot awscli gnupg2 cron \
  ca-certificates curl jq

# ---- 4. UFW firewall (host-side, in addition to Hetzner Cloud firewall) ----
ufw --force default deny incoming
ufw --force default allow outgoing
ufw allow OpenSSH
ufw allow 80/tcp
ufw allow 443/tcp
ufw allow 443/udp
ufw --force enable
echo "✓ UFW firewall enabled"

# ---- 5. Docker non-root pour fxmily ----------------------------------------
usermod -aG docker fxmily

# ---- 6. App + secrets directories ------------------------------------------
mkdir -p /opt/fxmily
# V1.5.2 round 5 : `/opt/fxmily/prisma` est mounté ro par `deploy.yml` migrate
# container. Sans ce mkdir, Docker crée le dir comme root et le scp suivant
# (appleboy/scp-action) échoue (write denied pour user `fxmily`).
mkdir -p /opt/fxmily/prisma
chown -R fxmily:fxmily /opt/fxmily

mkdir -p /etc/fxmily/backups
mkdir -p /var/log/fxmily/caddy
chown -R fxmily:fxmily /etc/fxmily/backups /var/log/fxmily

# Generate strong secrets if absent (idempotent — never overwrites).
if [[ ! -f /etc/fxmily/postgres_password ]]; then
  install -m 600 -o root -g root /dev/stdin /etc/fxmily/postgres_password \
    <<< "$(openssl rand -base64 32)"
  echo "✓ /etc/fxmily/postgres_password generated"
fi
if [[ ! -f /etc/fxmily/gpg.pass ]]; then
  install -m 600 -o fxmily -g fxmily /dev/stdin /etc/fxmily/gpg.pass \
    <<< "$(openssl rand -base64 32)"
  echo "✓ /etc/fxmily/gpg.pass generated"
fi

# ---- 7. Done — instructions for the operator -------------------------------
cat <<EOF

═══════════════════════════════════════════════════════════════════════
✅ Host setup complete.

NEXT STEPS (manual, log in as 'fxmily' user):

1. Copy the production stack files:
     scp ops/docker/docker-compose.prod.yml fxmily@<IP>:/opt/fxmily/
     scp ops/caddy/Caddyfile               fxmily@<IP>:/etc/fxmily/
     scp ops/cron/fxmily-cron              fxmily@<IP>:/usr/local/bin/   # chmod 755 sudo
     scp ops/cron/fxmily-backup            fxmily@<IP>:/usr/local/bin/   # chmod 755 sudo
     scp ops/cron/crontab.fxmily           fxmily@<IP>:/etc/cron.d/fxmily-app  # chmod 644 sudo
     scp ops/cron/cron.env.example         fxmily@<IP>:/etc/fxmily/cron.env

2. Configure the AWS CLI for R2 backups (sudo -u fxmily -i):
     aws configure --profile fxmily-backup
       (Access Key ID + Secret from Cloudflare R2 → Manage R2 API Tokens)
       (Region: auto, Output: json)

3. Populate /etc/fxmily/web.env (chmod 600 fxmily:fxmily) — see
   docs/env-template.md for the full var list (DATABASE_URL pointing at
   postgres:5432, AUTH_URL=https://app.fxmilyapp.com, AUTH_SECRET, CRON_SECRET,
   VAPID_*, SENTRY_*, RESEND_API_KEY/FROM, R2_*, ANTHROPIC_API_KEY optional).

4. Edit /etc/fxmily/cron.env (chmod 600) — must keep CRON_SECRET in sync
   with web.env. Append R2_ENDPOINT + R2_BUCKET.

5. First boot:
     cd /opt/fxmily
     docker compose -f docker-compose.prod.yml pull
     docker compose -f docker-compose.prod.yml up -d

6. DNS (Cloudflare): set A app → \$(curl -s ifconfig.me) (Proxied=NO).

7. Verify: bash ops/scripts/verify-dns.sh fxmilyapp.com app.fxmilyapp.com

═══════════════════════════════════════════════════════════════════════
EOF
