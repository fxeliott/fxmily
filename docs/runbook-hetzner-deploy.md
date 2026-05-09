# Runbook — Production deploy (Hetzner CX22)

Wires Fxmily V1 from a Hetzner Cloud CX22 to a working
`https://app.fxmilyapp.com` (V1 — pivot du SPEC `app.fxmily.com` vers le
domaine déjà possédé `fxmilyapp.com`, décision Phase R 2026-05-09 pour
respecter strictement la contrainte zéro coût supplémentaire). Pair with
[`runbook-backup-restore.md`](runbook-backup-restore.md) and
[`docs/jalon-10-prep.md`](jalon-10-prep.md).

> **Pré-requis manuel Eliot (V1 — Phase R reality check 2026-05-09)** :
>
> 0. **Décision domaine** : V1 ship sur `fxmilyapp.com` (déjà possédé +
>    Cloudflare DNS configuré). Achat `fxmily.com` reporté V2 si l'image de
>    marque l'exige. Coût supplémentaire V1 : 0 €.
> 1. **Hetzner CX22 EXISTANT** : `hetzner-dieu` à `178.104.39.201` (hostname
>    `fxmilyapp.com`) — déjà payé pour n8n/Langfuse. Vérifier d'abord la
>    capacité résiduelle via `ssh hetzner-dieu 'free -h && df -h'`. Si
>    saturé, provisionner un nouveau CX22 (~5 €/mois, doc §1 ci-dessous).
>    Sinon `bootstrap-fxmily.sh --skip-hetzner FXMILY_HETZNER_IP=178.104.39.201`
>    réutilise l'IP existante.
> 2. Créer le projet Sentry (`sentry.io` → New Project → Next.js) +
>    générer un `SENTRY_AUTH_TOKEN` (Settings → Auth Tokens →
>    `project:write` + `project:releases`). 5000 events/mois free.
> 3. Resend Console → Domains → Add `fxmilyapp.com` (3 TXT records DNS à
>    coller dans Cloudflare → ~15 min TXT propagation → Verify). Free tier
>    3000 emails/mois **mais 100/jour cap** = vrai bottleneck Phase R.1.

## 1. Provisioning du serveur (×1, 30 min)

```bash
# Sur ta machine
ssh root@<IP-Hetzner>

# Sur le serveur fresh
adduser --disabled-password --gecos "" fxmily
usermod -aG sudo fxmily
mkdir -p /home/fxmily/.ssh
cp /root/.ssh/authorized_keys /home/fxmily/.ssh/
chown -R fxmily:fxmily /home/fxmily/.ssh
chmod 700 /home/fxmily/.ssh
chmod 600 /home/fxmily/.ssh/authorized_keys

# Désactive root SSH + password auth (déjà désactivés sur Hetzner Ubuntu
# 24.04 par défaut, mais on fixe).
sed -i 's/^#\?PermitRootLogin .*/PermitRootLogin no/' /etc/ssh/sshd_config
sed -i 's/^#\?PasswordAuthentication .*/PasswordAuthentication no/' /etc/ssh/sshd_config
systemctl restart ssh

# Pacquages système.
apt update && apt upgrade -y
apt install -y docker.io docker-compose-v2 ufw certbot awscli gnupg2 cron \
  ca-certificates curl

# Firewall.
ufw default deny incoming
ufw default allow outgoing
ufw allow OpenSSH
ufw allow 80/tcp
ufw allow 443/tcp
ufw allow 443/udp        # HTTP/3
ufw enable

# Docker non-root pour fxmily.
usermod -aG docker fxmily

# AWS CLI profile R2 (lance EN tant que fxmily) :
sudo -u fxmily -i aws configure --profile fxmily-backup
# Access Key ID     : <Cloudflare R2 token>
# Secret Access Key : <Cloudflare R2 secret>
# Region            : auto
# Output format     : json

# Quitte root, reviens en fxmily.
exit
ssh fxmily@<IP-Hetzner>
```

## 2. Installation Fxmily (×1, 15 min)

Tout vit sous `/opt/fxmily/`. Les secrets sous `/etc/fxmily/` (root-owned
mode 0600 ou fxmily:fxmily 0600 selon le fichier).

```bash
# /opt/fxmily — code & compose
sudo mkdir -p /opt/fxmily
sudo chown fxmily:fxmily /opt/fxmily
cd /opt/fxmily

# Copier (depuis ta machine) :
#   ops/docker/docker-compose.prod.yml → /opt/fxmily/docker-compose.prod.yml
#   ops/caddy/Caddyfile                → /etc/fxmily/Caddyfile
#   ops/cron/fxmily-cron               → /usr/local/bin/fxmily-cron (chmod 755)
#   ops/cron/fxmily-backup             → /usr/local/bin/fxmily-backup (chmod 755)
#   ops/cron/crontab.fxmily            → /etc/cron.d/fxmily-app (chmod 644)

# Sur le serveur :
sudo mkdir -p /etc/fxmily/backups /var/log/fxmily /var/log/fxmily/caddy
sudo chown -R fxmily:fxmily /etc/fxmily/backups /var/log/fxmily

# Secrets :
sudo install -m 600 -o root -g root /dev/stdin /etc/fxmily/postgres_password <<< "$(openssl rand -base64 32)"
sudo install -m 600 -o fxmily -g fxmily /dev/stdin /etc/fxmily/gpg.pass <<< "$(openssl rand -base64 32)"

# Env files :
#   /etc/fxmily/web.env  : copie .env.example puis remplit les valeurs prod
#                          (DATABASE_URL → postgres:5432 ; AUTH_URL HTTPS ;
#                           VAPID_* ; SENTRY_*  ; CRON_SECRET ; ...).
#   /etc/fxmily/cron.env : mêmes CRON_SECRET et APP_URL, plus R2_*.
sudo cp ops/cron/cron.env.example /etc/fxmily/cron.env
sudo $EDITOR /etc/fxmily/cron.env
sudo chmod 600 /etc/fxmily/{web.env,cron.env}
sudo chown fxmily:fxmily /etc/fxmily/{web.env,cron.env}
```

## 3. Pull + first deploy (×1, 5 min)

```bash
# 1. Login GHCR (le tag `latest` est public si le repo l'est ; sinon
# `echo $GHCR_TOKEN | docker login ghcr.io -u fxeliott --password-stdin`).
cd /opt/fxmily

# 2. Pull image + boot stack.
docker compose -f docker-compose.prod.yml pull
docker compose -f docker-compose.prod.yml up -d

# 3. Vérifie l'état.
docker compose -f docker-compose.prod.yml ps
docker compose -f docker-compose.prod.yml logs -f web   # CTRL-C une fois "Ready"

# 4. Migrations Prisma (la 1ère fois ; les déploiements suivants gèrent
# ça depuis le workflow GitHub Actions, cf. .github/workflows/deploy.yml).
docker compose -f docker-compose.prod.yml exec -T web \
  pnpm --filter @fxmily/web exec prisma migrate deploy
```

## 4. DNS Cloudflare (×1, 10 min)

Cloudflare Dashboard → fxmily.com → DNS :

| Type | Name               | Content                                               | Proxied |
| ---- | ------------------ | ----------------------------------------------------- | ------- |
| A    | app                | <IP-Hetzner>                                          | NO      |
| MX   | @                  | 10 mx1.resend.com / 20 mx2.resend.com                 | NO      |
| TXT  | @                  | `v=spf1 include:_spf.resend.com -all`                 | NO      |
| TXT  | resend.\_domainkey | (DKIM record fourni par Resend)                       | NO      |
| TXT  | \_dmarc            | `v=DMARC1; p=quarantine; rua=mailto:eliot@fxmily.com` | NO      |

**`Proxied: NO`** : Caddy gère HTTPS direct, pas de proxy Cloudflare
intermédiaire (évite le double-TLS et garde le HTTP/3 actif). Si tu
veux activer le proxy Cloudflare pour DDoS later, vérifie d'abord que
`Strict-Transport-Security` ne soit pas pinned avec `preload` sur un
domaine non-routable.

Resend Console → Domains → `fxmily.com` → "Verify" (peut prendre 24h
de propagation DNS). Une fois OK, l'app peut envoyer des emails depuis
`noreply@fxmily.com`.

## 5. Caddy + HTTPS (×1, automatique)

Au premier hit `https://app.fxmily.com`, Caddy provisionne le cert
Let's Encrypt automatiquement (challenge HTTP-01). Vérifie :

```bash
docker compose -f docker-compose.prod.yml logs caddy | grep -i "certificate"
# Attendu : "obtained certificate" + chain présente
curl -sI https://app.fxmily.com | head -5
# Attendu : HTTP/2 200 + Strict-Transport-Security présent
```

## 6. HSTS preload (Eliot, manuel ×1)

Une fois que `https://app.fxmily.com` répond et que tu es SÛR de ne pas
revenir en HTTP, soumets la liste preload : <https://hstspreload.org/>.
Pré-requis : header `Strict-Transport-Security: max-age=63072000;
includeSubDomains; preload`. Le Caddyfile l'émet déjà.

> ⚠️ **Action irréversible côté navigateur**. Une fois preloadé,
> rétro-revenir à HTTP demande des semaines d'attente. À faire seulement
> quand l'app est définitivement en prod et stable.

## 7. Vérification end-to-end (×1, 30 min)

```bash
# Healthcheck app
curl -fsS https://app.fxmily.com/api/health
# {"ok": true, ...}

# Cron manuel (fxmily user)
sudo -u fxmily /usr/local/bin/fxmily-cron recompute-scores
# Audit row attendue : cron.recompute_scores.scan dans audit_logs

# Cron systemd loaded
sudo systemctl status cron
sudo grep -E 'fxmily-cron' /var/log/fxmily/cron.log | tail -5

# Backup manuel (test)
sudo -u fxmily /usr/local/bin/fxmily-backup
ls -la /etc/fxmily/backups/
aws s3 ls s3://fxmily-backups/ --endpoint-url $R2_ENDPOINT --profile fxmily-backup | tail -3
```

## 8. Premier membre (Eliot s'invite — Phase F du J10)

Cf. [`docs/jalon-10-prep.md`](jalon-10-prep.md) §8 — checklist 12 steps
end-to-end. À ne lancer qu'**après** étapes 1-7 ci-dessus + Resend domain
verify accompli.

## 9. Rotation des secrets (mensuel, 5 min)

Les valeurs sensibles (mot de passe Postgres, CRON_SECRET, AUTH_SECRET,
GPG passphrase, VAPID, SENTRY_AUTH_TOKEN) doivent tourner périodiquement.

```bash
# 1. CRON_SECRET — atomic rotation
NEW=$(openssl rand -hex 24)
sudo sed -i "s|^CRON_SECRET=.*|CRON_SECRET=$NEW|" /etc/fxmily/web.env /etc/fxmily/cron.env
sudo docker compose -f /opt/fxmily/docker-compose.prod.yml restart web
# pas besoin de toucher cron — le wrapper relit cron.env à chaque appel

# 2. POSTGRES password — pas trivial, demande un downtime court
#    (cf. Postgres docs `ALTER USER fxmily WITH PASSWORD ...` + restart web)
```

## 10. Failure modes & remediation

| Symptôme                   | Cause probable                                     | Remediation                             |
| -------------------------- | -------------------------------------------------- | --------------------------------------- |
| `502` chez Caddy           | `web` healthcheck KO                               | `docker compose logs web` + Sentry      |
| `503 cron_disabled`        | `CRON_SECRET` absent dans `web.env`                | redéploie + restart                     |
| `401` cron répété          | `CRON_SECRET` désync entre `web.env` et `cron.env` | re-sync atomique                        |
| Backup `FAIL R2 upload`    | Token R2 expiré                                    | `aws configure --profile fxmily-backup` |
| Cert renouvellement échoue | Port 80 fermé temporairement                       | `ufw status` + reload Caddy             |

Cf. aussi `docs/runbook-cron-recompute-scores.md` et
`docs/runbook-backup-restore.md` pour les playbooks dédiés.
