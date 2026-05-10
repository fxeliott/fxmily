# Runbook — Production deploy (Hetzner CX22)

Wires Fxmily V1 from a Hetzner Cloud CX22 to a working
`https://app.fxmilyapp.com` (V1 — pivot du SPEC `app.fxmilyapp.com` vers le
domaine déjà possédé `fxmilyapp.com`, décision Phase R 2026-05-09 pour
respecter strictement la contrainte zéro coût supplémentaire). Pair with
[`runbook-backup-restore.md`](runbook-backup-restore.md) and
[`docs/jalon-10-prep.md`](jalon-10-prep.md).

> **Pré-requis manuel Eliot (V1 — Phase R reality check 2026-05-09)** :
>
> 0. **Décision domaine** : V1 ship sur `fxmilyapp.com` (déjà possédé +
>    Cloudflare DNS configuré). Achat éventuel d'un domaine plus court
>    (`fxmily.com` si dispo) reporté V2 si l'image de marque l'exige. Coût
>    supplémentaire V1 : 0 €.
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

Cloudflare Dashboard → fxmilyapp.com → DNS :

| Type | Name               | Content                                                  | Proxied |
| ---- | ------------------ | -------------------------------------------------------- | ------- |
| A    | app                | <IP-Hetzner>                                             | NO      |
| MX   | @                  | 10 mx1.resend.com / 20 mx2.resend.com                    | NO      |
| TXT  | @                  | `v=spf1 include:_spf.resend.com -all`                    | NO      |
| TXT  | resend.\_domainkey | (DKIM record fourni par Resend)                          | NO      |
| TXT  | \_dmarc            | `v=DMARC1; p=quarantine; rua=mailto:eliot@fxmilyapp.com` | NO      |

**`Proxied: NO`** : Caddy gère HTTPS direct, pas de proxy Cloudflare
intermédiaire (évite le double-TLS et garde le HTTP/3 actif). Si tu
veux activer le proxy Cloudflare pour DDoS later, vérifie d'abord que
`Strict-Transport-Security` ne soit pas pinned avec `preload` sur un
domaine non-routable.

Resend Console → Domains → `fxmilyapp.com` → "Verify" (peut prendre 24h
de propagation DNS). Une fois OK, l'app peut envoyer des emails depuis
`noreply@fxmilyapp.com`.

## 5. Caddy + HTTPS (×1, automatique)

Au premier hit `https://app.fxmilyapp.com`, Caddy provisionne le cert
Let's Encrypt automatiquement (challenge HTTP-01). Vérifie :

```bash
docker compose -f docker-compose.prod.yml logs caddy | grep -i "certificate"
# Attendu : "obtained certificate" + chain présente
curl -sI https://app.fxmilyapp.com | head -5
# Attendu : HTTP/2 200 + Strict-Transport-Security présent
```

## 6. HSTS preload (Eliot, manuel ×1)

Une fois que `https://app.fxmilyapp.com` répond et que tu es SÛR de ne pas
revenir en HTTP, soumets la liste preload : <https://hstspreload.org/>.
Pré-requis : header `Strict-Transport-Security: max-age=63072000;
includeSubDomains; preload`. Le Caddyfile l'émet déjà.

> ⚠️ **Action irréversible côté navigateur**. Une fois preloadé,
> rétro-revenir à HTTP demande des semaines d'attente. À faire seulement
> quand l'app est définitivement en prod et stable.

## 7. Vérification end-to-end (×1, 30 min)

```bash
# Healthcheck app
curl -fsS https://app.fxmilyapp.com/api/health
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

## 11. Rollback V1.5 migration (`20260509180000_v1_5_trade_quality_riskpct`)

> **Quand l'utiliser** : si la migration V1.5 a été déployée en prod et qu'un
> blocker post-deploy nécessite de revenir à l'état J10 (ex. : drift de
> calibration scoring incompatible, IDF prod, ou besoin de recharger un
> backup pré-V1.5 sans les nouvelles colonnes). Pour un revert local en
> dev, préférer `prisma migrate reset` (autorisé en dev uniquement, deny en
> prod par les permissions Claude).

### 11.1 Pré-requis avant tout rollback

1. **Backup atomique de `trades`** : si des rows ont déjà capturé
   `trade_quality` ou `risk_pct` (V1.5/V1.5.1 wizard adoption), le rollback
   **détruit** ces données — `DROP COLUMN` est irréversible côté Postgres.
   Lance un `pg_dump` de la table avant :

   ```bash
   docker compose -f /opt/fxmily/docker-compose.prod.yml exec -T postgres \
     pg_dump -U fxmily -d fxmily -t trades --data-only --column-inserts \
     | gzip > /etc/fxmily/backups/pre-v1.5-rollback-$(date -u +%Y%m%dT%H%M%SZ).sql.gz
   ```

2. **Stop le web** pour figer les writes pendant le rollback (les routes
   `/journal/new` + `closeTradeAction` écrivent les nouvelles colonnes) :

   ```bash
   docker compose -f /opt/fxmily/docker-compose.prod.yml stop web
   ```

3. **Vérifie l'état migrations Prisma** :

   ```bash
   docker compose -f /opt/fxmily/docker-compose.prod.yml exec -T postgres \
     psql -U fxmily -d fxmily -c "SELECT migration_name, finished_at \
       FROM _prisma_migrations \
       WHERE migration_name LIKE '%v1_5%' ORDER BY started_at DESC;"
   ```

### 11.2 SQL rollback (Postgres 17 type-cascade ordering)

L'ordre est **non négociable** : on ne peut pas `DROP TYPE` tant qu'une
colonne référence l'enum. Postgres 17 retournerait `cannot drop type
"TradeQuality" because other objects depend on it`.

```sql
-- Connect as fxmily inside the postgres container :
--   docker compose -f /opt/fxmily/docker-compose.prod.yml exec -T postgres \
--     psql -U fxmily -d fxmily

BEGIN;

-- Step 1 — drop the partial index BEFORE the column it covers.
DROP INDEX IF EXISTS "trades_user_id_trade_quality_idx";

-- Step 2 — drop the columns. CASCADE not needed (no FK referencing them).
ALTER TABLE "trades" DROP COLUMN IF EXISTS "trade_quality";
ALTER TABLE "trades" DROP COLUMN IF EXISTS "risk_pct";

-- Step 3 — drop the enum type now that nothing references it.
DROP TYPE IF EXISTS "TradeQuality";

-- Step 4 — mark the migration as rolled back so `prisma migrate deploy`
-- does NOT try to re-apply it on the next deploy.
DELETE FROM "_prisma_migrations"
  WHERE migration_name = '20260509180000_v1_5_trade_quality_riskpct';

COMMIT;
```

> ⚠️ **Si le `BEGIN` / `COMMIT` block échoue à mi-parcours** : Postgres
> rollback automatique de la transaction — l'état reste cohérent (tout ou
> rien). Re-vérifie `\d trades` pour confirmer que `trade_quality` +
> `risk_pct` sont bien absents (rollback réussi) ou bien présents (rollback
> annulé).

### 11.3 Re-déploiement de l'image J10 (sans V1.5 code)

Le rollback DB doit s'accompagner d'un revert au tag image `j10-prod-deploy`
(sinon le code V1.5 attendra les colonnes au runtime et crashera) :

```bash
# Pull l'image J10 (tag explicite — `latest` pourrait pointer V1.5).
docker pull ghcr.io/fxeliott/fxmily:j10-prod-deploy
docker tag ghcr.io/fxeliott/fxmily:j10-prod-deploy ghcr.io/fxeliott/fxmily:latest

# Restart the stack.
docker compose -f /opt/fxmily/docker-compose.prod.yml up -d web
docker compose -f /opt/fxmily/docker-compose.prod.yml logs -f web   # CTRL-C une fois "Ready"
```

### 11.4 Vérification post-rollback

```bash
# Healthcheck app
curl -fsS https://app.fxmilyapp.com/api/health
# {"ok": true, ...}

# Schema check : `trade_quality` + `risk_pct` must be absent.
docker compose -f /opt/fxmily/docker-compose.prod.yml exec -T postgres \
  psql -U fxmily -d fxmily -c "\d trades" | grep -E 'trade_quality|risk_pct'
# Expected : no output (both columns dropped).

# Smoke test : create a trade via le wizard — le form ne doit PAS crash sur
# les steps V1.5 (riskPct field + tradeQuality selector). L'image J10 ne
# render plus ces UI bits.

# Audit log : consigne le rollback.
docker compose -f /opt/fxmily/docker-compose.prod.yml exec -T postgres \
  psql -U fxmily -d fxmily -c "INSERT INTO audit_logs (action, metadata, created_at) \
    VALUES ('ops.migration.rolled_back', '{\"migration\":\"v1_5_trade_quality_riskpct\",\"by\":\"eliot\"}'::jsonb, NOW());"
```

### 11.5 Re-application future de V1.5

Si le rollback était une mesure temporaire, ré-appliquer V1.5 implique :

1. Re-deploy l'image V1.5 (`feat/v1.5-trading-calibration` HEAD).
2. `pnpm --filter @fxmily/web prisma:migrate deploy` (la migration est
   ré-introduite — Prisma re-cale la row dans `_prisma_migrations` après
   l'avoir trouvée absente).
3. Re-restore les rows `trades` depuis le `pg_dump` step 11.1 si on veut
   restaurer les valeurs `tradeQuality` / `riskPct` capturées avant le
   rollback. **Attention** : le restore doit utiliser `--data-only` et
   filtrer les colonnes V1.5 uniquement, pas réécraser le state J10+
   accumulé entre-temps.

### 11.6 Rollback du `pseudonymLabel` (V1.5.2 widening — purement code)

La V1.5.2 widening 24-bit → 32-bit est **sans changement de schéma DB** —
le `pseudonymLabel` est calculé à la volée et ne touche aucune colonne.
Rollback = simple revert de l'image V1.5.2 vers V1.5 (les rapports
historiques V1.5 conservent leurs labels 6-char, les rapports V1.5.2+
conservent leurs labels 8-char ; les deux formats coexistent sans
intervention DB nécessaire). Cf. `apps/web/src/lib/weekly-report/builder.ts`
JSDoc `pseudonymizeMember` pour la note "Migration data" complète.
