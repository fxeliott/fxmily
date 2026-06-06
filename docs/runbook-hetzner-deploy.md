# Runbook — Production deploy (Hetzner CX22)

Wires Fxmily V1 from a Hetzner Cloud CX22 to a working
`https://app.fxmilyapp.com` (V1 — pivot du SPEC `app.fxmilyapp.com` vers le
domaine déjà possédé `fxmilyapp.com`, décision Phase R 2026-05-09 pour
respecter strictement la contrainte zéro coût supplémentaire). Pair with
[`runbook-backup-restore.md`](runbook-backup-restore.md) and
[`docs/archive/jalon-10-prep.md`](archive/jalon-10-prep.md).

> **Pré-requis manuel Eliot (V1 — Phase R reality check 2026-05-09)** :
>
> 0. **Décision domaine** : V1 ship sur `fxmilyapp.com` (déjà possédé +
>    Cloudflare DNS configuré). Achat éventuel d'un domaine plus court
>    (`fxmily.com` si dispo) reporté V2 si l'image de marque l'exige. Coût
>    supplémentaire V1 : 0 €.
> 1. **Hetzner CX22 EXISTANT** : `fxmily-prod` à `203.0.113.10` (hostname
>    `fxmilyapp.com`) — déjà payé pour n8n/Langfuse. Vérifier d'abord la
>    capacité résiduelle via `ssh fxmily-prod 'free -h && df -h'`. Si
>    saturé, provisionner un nouveau CX22 (~5 €/mois, doc §1 ci-dessous).
>    Sinon `bootstrap-fxmily.sh --skip-hetzner FXMILY_HETZNER_IP=203.0.113.10`
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

Cf. [`docs/archive/jalon-10-prep.md`](archive/jalon-10-prep.md) §8 — checklist 12 steps
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

## 12. Rollback V1.6 migration (`20260512182512_v1_6_notification_is_transactional`)

> **Quand l'utiliser** : si l'email frequency cap (3 emails / 24h sur les
> notifs non-transactionnelles) introduit un faux positif qui block des
> notifs critiques (ex. : passe `weekly_report_ready` à transactional par
> erreur) ET qu'un revert pur du code applicatif ne suffit pas.
>
> En pratique, la colonne `is_transactional` est **safe** par construction
> (DEFAULT FALSE, ADD-only) — le rollback n'est utile que si on veut
> retirer complètement la colonne (rare, possible si Prisma drift bloque
> une future migration).

### 12.1 Pré-requis avant rollback

1. **Backup atomique de `notification_queue`** : la colonne est NOT NULL,
   donc supprimer ne perd PAS de données — Postgres remplit `FALSE` au
   re-create si on ré-applique. Mais le partial index est susceptible de
   contenir des entrées que des queries admin V1.6+ utilisent (`recent
non-transactional lookup`).

   ```bash
   docker compose -f /opt/fxmily/docker-compose.prod.yml exec -T postgres \
     pg_dump -U fxmily -d fxmily -t notification_queue --data-only --column-inserts \
     | gzip > /etc/fxmily/backups/pre-v1.6-rollback-$(date -u +%Y%m%dT%H%M%SZ).sql.gz
   ```

2. **Stop le web** (le dispatcher push lit `isTransactional` dans la
   freq-cap query) :

   ```bash
   docker compose -f /opt/fxmily/docker-compose.prod.yml stop web
   ```

3. **Vérifie l'état Prisma** :

   ```bash
   docker compose -f /opt/fxmily/docker-compose.prod.yml exec -T postgres \
     psql -U fxmily -d fxmily -c "SELECT migration_name, finished_at \
       FROM _prisma_migrations WHERE migration_name LIKE '%v1_6%' \
       ORDER BY started_at DESC;"
   ```

### 12.2 SQL rollback

Ordre **non négociable** (partial index réfère à la colonne) :

```sql
BEGIN;

-- 1. Drop the partial index FIRST (depends on the column).
DROP INDEX IF EXISTS "notification_queue_user_recent_non_transactional_idx";

-- 2. Drop the column (safe even with rows — NOT NULL DEFAULT FALSE has no
-- application-side referent post-V1.6 revert).
ALTER TABLE "notification_queue" DROP COLUMN IF EXISTS "is_transactional";

-- 3. Wipe the Prisma migrations row so the schema can be re-applied later.
DELETE FROM "_prisma_migrations"
  WHERE migration_name = '20260512182512_v1_6_notification_is_transactional';

COMMIT;
```

> ⚠️ Si le `BEGIN`/`COMMIT` échoue à mi-parcours, Postgres rollback
> automatique — l'état reste cohérent. Re-vérifie via `\d notification_queue`
> que la colonne est bien absente (rollback OK) ou présente (rollback annulé).

### 12.3 Re-déploiement de l'image V1.5.2

Le rollback DB doit s'accompagner d'un revert au tag image pré-V1.6 :

```bash
export FXMILY_IMAGE=ghcr.io/<owner>/fxmily:<v1-5-2-sha>
docker compose -f /opt/fxmily/docker-compose.prod.yml pull web
docker compose -f /opt/fxmily/docker-compose.prod.yml up -d --remove-orphans web
```

### 12.4 Vérification post-rollback

```bash
curl -fsS https://app.fxmilyapp.com/api/health   # 200 attendu
docker compose -f /opt/fxmily/docker-compose.prod.yml exec -T postgres \
  psql -U fxmily -d fxmily -c "\d notification_queue" | grep -c is_transactional
# Attendu : 0 (colonne absente)

# Audit log : consigne le rollback.
docker compose -f /opt/fxmily/docker-compose.prod.yml exec -T postgres \
  psql -U fxmily -d fxmily -c "INSERT INTO audit_logs (action, metadata, created_at) \
    VALUES ('ops.migration.rolled_back', \
      '{\"migration\":\"v1_6_notification_is_transactional\",\"by\":\"eliot\"}'::jsonb, \
      NOW());"
```

### 12.5 Re-application future

1. Re-deploy l'image V1.6+ (`feat/v1.6-polish` HEAD ou ulterieure).
2. `pnpm --filter @fxmily/web prisma:migrate deploy` — Prisma re-cale la row.
3. Les rows existantes prennent `is_transactional = FALSE` (DEFAULT). Pas
   de backfill nécessaire — les V1 NotificationType slugs (annotation,
   checkin, douglas, weekly) sont tous engagement nudges = `false` correct.

## 13. Rollback V1.8 REFLECT migration (`20260513150000_v1_8_reflect_models`)

> **Quand l'utiliser** : si les wizards `/review` ou `/reflect` provoquent
> un blocker post-deploy non-fixable côté code (ex. : data corruption sur
> `Trade.tags` array, race condition catastrophique sur
> `weekly_reviews` upsert) et qu'il faut revenir à l'état V1.7.2.
>
> ⚠️ **Risque data loss** : si des membres ont rempli des `weekly_reviews`
> ou `reflection_entries` post-V1.8 ship, le rollback **DROP les tables
> entièrement** — `pg_dump` atomique des 2 tables AVANT est OBLIGATOIRE.

### 13.1 Pré-requis avant rollback

1. **Backup atomique des 2 nouvelles tables + colonne `trades.tags`** :

   ```bash
   TS=$(date -u +%Y%m%dT%H%M%SZ)
   docker compose -f /opt/fxmily/docker-compose.prod.yml exec -T postgres \
     pg_dump -U fxmily -d fxmily \
     -t weekly_reviews -t reflection_entries \
     --data-only --column-inserts \
     | gzip > "/etc/fxmily/backups/pre-v1.8-rollback-reviews-${TS}.sql.gz"

   # Trade.tags : la colonne est sur trades, on dump la colonne uniquement
   # via COPY pour préserver les arrays.
   docker compose -f /opt/fxmily/docker-compose.prod.yml exec -T postgres \
     psql -U fxmily -d fxmily -c "\copy (SELECT id, tags FROM trades \
       WHERE array_length(tags, 1) > 0) TO STDOUT WITH CSV HEADER" \
     | gzip > "/etc/fxmily/backups/pre-v1.8-rollback-trade-tags-${TS}.csv.gz"
   ```

2. **Stop le web** :

   ```bash
   docker compose -f /opt/fxmily/docker-compose.prod.yml stop web
   ```

3. **Vérifie l'état Prisma** :

   ```bash
   docker compose -f /opt/fxmily/docker-compose.prod.yml exec -T postgres \
     psql -U fxmily -d fxmily -c "SELECT migration_name, finished_at \
       FROM _prisma_migrations WHERE migration_name LIKE '%v1_8%' \
       ORDER BY started_at DESC;"
   ```

4. **Confirme l'absence de FK cascade orpheline** : les 2 tables ont
   `ON DELETE CASCADE` sur `users.id` — un DROP TABLE clean retire aussi
   les FK. Pas d'orpheline.

### 13.2 SQL rollback

```sql
BEGIN;

-- 1. Drop ADD-only Trade.tags column (default empty array, no data loss
-- on the un-tagged rows).
ALTER TABLE "trades" DROP COLUMN IF EXISTS "tags";

-- 2. Drop the 2 new tables (CASCADE drops FK + indexes automatically).
DROP TABLE IF EXISTS "reflection_entries" CASCADE;
DROP TABLE IF EXISTS "weekly_reviews" CASCADE;

-- 3. Wipe the Prisma migrations row.
DELETE FROM "_prisma_migrations"
  WHERE migration_name = '20260513150000_v1_8_reflect_models';

COMMIT;
```

> ⚠️ **Audit logs orphelins** : les rows `weekly_review.*` et `reflection.*`
> dans `audit_logs` ne sont PAS purgées (logs immuables par design). Ces
> slugs deviennent "frozen historical" jusqu'à la prochaine re-application.

### 13.3 Re-déploiement de l'image V1.7.2

```bash
export FXMILY_IMAGE=ghcr.io/<owner>/fxmily:<v1-7-2-sha>
docker compose -f /opt/fxmily/docker-compose.prod.yml pull web
docker compose -f /opt/fxmily/docker-compose.prod.yml up -d --remove-orphans web
```

### 13.4 Vérification post-rollback

```bash
curl -fsS https://app.fxmilyapp.com/api/health   # 200 attendu

# Schema check : les 3 surfaces V1.8 sont absentes.
docker compose -f /opt/fxmily/docker-compose.prod.yml exec -T postgres \
  psql -U fxmily -d fxmily -c "\dt weekly_reviews"            # 0 rows
docker compose -f /opt/fxmily/docker-compose.prod.yml exec -T postgres \
  psql -U fxmily -d fxmily -c "\dt reflection_entries"        # 0 rows
docker compose -f /opt/fxmily/docker-compose.prod.yml exec -T postgres \
  psql -U fxmily -d fxmily -c "\d trades" | grep -c '^.*tags '
# Attendu : 0 (colonne tags absente)

# Audit log : consigne le rollback.
docker compose -f /opt/fxmily/docker-compose.prod.yml exec -T postgres \
  psql -U fxmily -d fxmily -c "INSERT INTO audit_logs (action, metadata, created_at) \
    VALUES ('ops.migration.rolled_back', \
      '{\"migration\":\"v1_8_reflect_models\",\"by\":\"eliot\",\"data_loss_reviews\":N,\"data_loss_reflections\":N,\"data_loss_trade_tags\":N}'::jsonb, \
      NOW());"
```

### 13.5 Re-application future

1. Re-deploy l'image V1.8+ HEAD.
2. `pnpm --filter @fxmily/web prisma:migrate deploy` — Prisma re-cale.
3. **Restore les 2 tables** depuis `pg_dump` step 13.1 :

   ```bash
   gunzip -c /etc/fxmily/backups/pre-v1.8-rollback-reviews-<TS>.sql.gz \
     | docker compose -f /opt/fxmily/docker-compose.prod.yml exec -T postgres \
         psql -U fxmily -d fxmily
   ```

4. **Restore `trades.tags`** depuis le CSV :

   ```bash
   # Restore via UPDATE row-by-row (CSV → temp table → UPDATE join).
   gunzip -c /etc/fxmily/backups/pre-v1.8-rollback-trade-tags-<TS>.csv.gz \
     | docker compose -f /opt/fxmily/docker-compose.prod.yml exec -T postgres \
         psql -U fxmily -d fxmily -c \
       "CREATE TEMP TABLE _restore_tags (id TEXT PRIMARY KEY, tags TEXT[]); \
        \\copy _restore_tags FROM STDIN WITH CSV HEADER; \
        UPDATE trades SET tags = _restore_tags.tags \
        FROM _restore_tags WHERE trades.id = _restore_tags.id;"
   ```

## 14. Rollback V2.0 TRACK migration (`20260514150000_v2_0_track_habit_logs`)

> **Quand l'utiliser** : si un blocker post-deploy nécessite de retirer
> complètement les habit logs (rare — V2.0 ship backend-only, frontend
> wizards pas encore wirés, donc en pratique 0 rows attendu sauf si un
> membre passe par API direct).
>
> ⚠️ Le `DROP TYPE HabitKind` est **non négociable AVANT DROP TABLE** —
> Postgres rejette le drop type si la table le référence (`cannot drop
type because column ... depends on it`).

### 14.1 Pré-requis avant rollback

1. **Backup atomique de `habit_logs`** :

   ```bash
   TS=$(date -u +%Y%m%dT%H%M%SZ)
   docker compose -f /opt/fxmily/docker-compose.prod.yml exec -T postgres \
     pg_dump -U fxmily -d fxmily -t habit_logs --data-only --column-inserts \
     | gzip > "/etc/fxmily/backups/pre-v2.0-rollback-habits-${TS}.sql.gz"
   ```

2. **Stop le web** :

   ```bash
   docker compose -f /opt/fxmily/docker-compose.prod.yml stop web
   ```

3. **Vérifie l'état Prisma** :

   ```bash
   docker compose -f /opt/fxmily/docker-compose.prod.yml exec -T postgres \
     psql -U fxmily -d fxmily -c "SELECT migration_name, finished_at \
       FROM _prisma_migrations WHERE migration_name LIKE '%v2_0%' \
       ORDER BY started_at DESC;"
   ```

### 14.2 SQL rollback

Ordre **non négociable** (DROP TABLE avant DROP TYPE) :

```sql
BEGIN;

-- 1. Drop the table FIRST (releases the type dependency).
DROP TABLE IF EXISTS "habit_logs" CASCADE;

-- 2. Drop the enum (no more dependents now).
DROP TYPE IF EXISTS "HabitKind";

-- 3. Wipe the Prisma migrations row.
DELETE FROM "_prisma_migrations"
  WHERE migration_name = '20260514150000_v2_0_track_habit_logs';

COMMIT;
```

### 14.3 Re-déploiement de l'image V1.9 (pré-V2.0)

```bash
export FXMILY_IMAGE=ghcr.io/<owner>/fxmily:<v1-9-sha>
docker compose -f /opt/fxmily/docker-compose.prod.yml pull web
docker compose -f /opt/fxmily/docker-compose.prod.yml up -d --remove-orphans web
```

### 14.4 Vérification post-rollback

```bash
curl -fsS https://app.fxmilyapp.com/api/health   # 200 attendu

docker compose -f /opt/fxmily/docker-compose.prod.yml exec -T postgres \
  psql -U fxmily -d fxmily -c "\dt habit_logs"   # 0 rows
docker compose -f /opt/fxmily/docker-compose.prod.yml exec -T postgres \
  psql -U fxmily -d fxmily -c "\dT HabitKind"    # 0 rows

# Audit log : consigne le rollback.
docker compose -f /opt/fxmily/docker-compose.prod.yml exec -T postgres \
  psql -U fxmily -d fxmily -c "INSERT INTO audit_logs (action, metadata, created_at) \
    VALUES ('ops.migration.rolled_back', \
      '{\"migration\":\"v2_0_track_habit_logs\",\"by\":\"eliot\",\"data_loss_habit_logs\":N}'::jsonb, \
      NOW());"
```

### 14.5 Re-application future

1. Re-deploy l'image V2.0+ HEAD.
2. `pnpm --filter @fxmily/web prisma:migrate deploy` — Prisma re-cale.
3. **Restore `habit_logs`** depuis `pg_dump` step 14.1 :

   ```bash
   gunzip -c /etc/fxmily/backups/pre-v2.0-rollback-habits-<TS>.sql.gz \
     | docker compose -f /opt/fxmily/docker-compose.prod.yml exec -T postgres \
         psql -U fxmily -d fxmily
   ```

## 15. Rollback V2.1 admin notes migration (`20260517150000_v2_1_admin_notes`)

> **Quand l'utiliser** : si la migration V2.1 (onglet "Notes admin" par
> membre, SPEC §7.7 — `admin_notes`) a été déployée en prod et qu'un blocker
> post-deploy nécessite de retirer complètement la table (rare — feature
> admin-only solo Eliot V1, faible volume ; le rollback existe pour la parité
> runbook). La table est **ADD-only** (aucun DROP/rename/backfill, 2 FK
> `ON DELETE CASCADE` côté `admin_notes` uniquement — aucune donnée `users`
> touchée). Brand-new + vide au moment de l'apply → rollback immédiat
> loss-free.

### 15.1 Pré-requis avant rollback

1. **Backup atomique de `admin_notes`** : si des notes ont déjà été écrites
   (RGPD : donnée admin-authored À PROPOS d'un membre), le `DROP TABLE` les
   détruit irréversiblement. `pg_dump` AVANT :

   ```bash
   docker compose -f /opt/fxmily/docker-compose.prod.yml exec -T postgres \
     pg_dump -U fxmily -d fxmily -t admin_notes --data-only --column-inserts \
     | gzip > /etc/fxmily/backups/pre-v2.1-rollback-admin-notes-$(date -u +%Y%m%dT%H%M%SZ).sql.gz
   ```

2. **Stop le web** (les Server Actions notes admin écrivent la table) :

   ```bash
   docker compose -f /opt/fxmily/docker-compose.prod.yml stop web
   ```

3. **Vérifie l'état Prisma** :

   ```bash
   docker compose -f /opt/fxmily/docker-compose.prod.yml exec -T postgres \
     psql -U fxmily -d fxmily -c "SELECT migration_name, finished_at \
       FROM _prisma_migrations WHERE migration_name LIKE '%v2_1_admin_notes%' \
       ORDER BY started_at DESC;"
   ```

4. **Confirme l'absence de FK cascade orpheline** : les 2 FK (`member_id`,
   `author_id`) sont `ON DELETE CASCADE` côté `admin_notes` — un `DROP TABLE`
   clean retire aussi les FK. Pas d'orpheline côté `users`.

### 15.2 SQL rollback

Transcrit verbatim du header de migration (`prior jalons §12/§13/§14
separate-PR pattern`). Pas d'enum, pas d'index-avant-colonne — `DROP TABLE`
retire ses propres index + FK :

```sql
BEGIN;

-- Drop the table (CASCADE not needed — indexes + FK belong to admin_notes).
DROP TABLE IF EXISTS "admin_notes";

-- Wipe the Prisma migrations row so the schema can be re-applied later.
DELETE FROM "_prisma_migrations"
  WHERE migration_name = '20260517150000_v2_1_admin_notes';

COMMIT;
```

> ⚠️ Si le `BEGIN`/`COMMIT` échoue à mi-parcours, Postgres rollback
> automatique — état cohérent (tout ou rien). Re-vérifie via
> `\dt admin_notes` que la table est bien absente.

### 15.3 Re-déploiement de l'image pré-V2.1

```bash
export FXMILY_IMAGE=ghcr.io/<owner>/fxmily:<pre-v2.1-admin-notes-sha>
docker compose -f /opt/fxmily/docker-compose.prod.yml pull web
docker compose -f /opt/fxmily/docker-compose.prod.yml up -d --remove-orphans web
```

### 15.4 Vérification post-rollback

```bash
curl -fsS https://app.fxmilyapp.com/api/health   # 200 attendu

docker compose -f /opt/fxmily/docker-compose.prod.yml exec -T postgres \
  psql -U fxmily -d fxmily -c "\dt admin_notes"   # 0 rows (table absente)

# Audit log : consigne le rollback.
docker compose -f /opt/fxmily/docker-compose.prod.yml exec -T postgres \
  psql -U fxmily -d fxmily -c "INSERT INTO audit_logs (action, metadata, created_at) \
    VALUES ('ops.migration.rolled_back', \
      '{\"migration\":\"v2_1_admin_notes\",\"by\":\"eliot\",\"data_loss_admin_notes\":N}'::jsonb, \
      NOW());"
```

### 15.5 Re-application future

1. Re-deploy l'image V2.1+ HEAD.
2. `pnpm --filter @fxmily/web prisma:migrate deploy` — Prisma re-cale la row.
3. **Restore `admin_notes`** depuis `pg_dump` step 15.1 si des notes avaient
   été écrites :

   ```bash
   gunzip -c /etc/fxmily/backups/pre-v2.1-rollback-admin-notes-<TS>.sql.gz \
     | docker compose -f /opt/fxmily/docker-compose.prod.yml exec -T postgres \
         psql -U fxmily -d fxmily
   ```

## 16. Rollback V1.2 training entities migration (`20260517160000_v1_2_training_entities`)

> **Quand l'utiliser** : si la migration V1.2 "Mode Entraînement / Backtest"
> (SPEC §21 — tables `training_trades` + `training_annotations`) a été
> déployée et qu'un blocker post-deploy nécessite de retirer **tout le data
> layer du Mode Entraînement** et revenir à l'état pré-§21.
>
> ⚠️ **Rollback du data layer fondateur** : `training_entities` (#110, J-T1)
> est la fondation consommée par J-T2 (`/training` membre), J-T3 (corrections
> admin) et J-T4 (engagement). Le rollback de §16 EXIGE une image applicative
> pré-#110 (sinon le code J-T2/3/4 crash au runtime sur les tables absentes).
> Si §17 (`training_annotation_notification`, #112) a aussi été déployé,
> **roller §17 AVANT §16** (ordre inverse de l'apply ; voir Note
> transversale).
>
> ⚠️ **Risque data loss** : si des membres ont enregistré des backtests
> (`training_trades`) ou si l'admin a posté des corrections
> (`training_annotations`) post-V1.2 ship, le rollback **DROP les 2 tables
> entièrement** — `pg_dump` atomique des 2 tables AVANT est OBLIGATOIRE
> (RGPD : donnée membre-authored + corrections admin).
>
> **Invariant §21.5 préservé** : ces tables ne touchent AUCUN objet
> real-edge (zéro FK `trades`, enums `TrainingOutcome` /
> `TrainingAnnotationMediaType` distincts de `TradeOutcome` /
> `AnnotationMediaType`). Le rollback ne peut pas affecter le track-record /
> score / expectancy réels.

### 16.1 Pré-requis avant rollback

1. **Backup atomique des 2 tables** :

   ```bash
   TS=$(date -u +%Y%m%dT%H%M%SZ)
   docker compose -f /opt/fxmily/docker-compose.prod.yml exec -T postgres \
     pg_dump -U fxmily -d fxmily \
     -t training_trades -t training_annotations \
     --data-only --column-inserts \
     | gzip > "/etc/fxmily/backups/pre-v1.2-rollback-training-${TS}.sql.gz"
   ```

2. **Stop le web** :

   ```bash
   docker compose -f /opt/fxmily/docker-compose.prod.yml stop web
   ```

3. **Vérifie l'état Prisma** :

   ```bash
   docker compose -f /opt/fxmily/docker-compose.prod.yml exec -T postgres \
     psql -U fxmily -d fxmily -c "SELECT migration_name, finished_at \
       FROM _prisma_migrations WHERE migration_name LIKE '%v1_2_training_entities%' \
       ORDER BY started_at DESC;"
   ```

4. **Confirme l'absence de FK cascade orpheline** : les 3 FK
   (`training_trades.user_id`, `training_annotations.training_trade_id`,
   `training_annotations.admin_id`) sont toutes `ON DELETE CASCADE` côté
   training — un `DROP TABLE` clean retire aussi les FK. Pas d'orpheline côté
   `users`.

### 16.2 SQL rollback

Ordre **non négociable** transcrit verbatim du header de migration : table
enfant (`training_annotations`, FK → `training_trades`) AVANT
`training_trades`, PUIS les types enum (Postgres rejette un `DROP TYPE` tant
qu'une colonne le référence), PUIS la row `_prisma_migrations`, le tout dans
une transaction :

```sql
BEGIN;

-- 1. Drop the child table FIRST (FK -> training_trades).
DROP TABLE IF EXISTS "training_annotations";

-- 2. Drop the parent table.
DROP TABLE IF EXISTS "training_trades";

-- 3. Drop the enums now that no column references them.
DROP TYPE IF EXISTS "TrainingAnnotationMediaType";
DROP TYPE IF EXISTS "TrainingOutcome";

-- 4. Wipe the Prisma migrations row.
DELETE FROM "_prisma_migrations"
  WHERE migration_name = '20260517160000_v1_2_training_entities';

COMMIT;
```

> ⚠️ Si le `BEGIN`/`COMMIT` échoue à mi-parcours, Postgres rollback
> automatique — état cohérent. Re-vérifie via `\dt training_trades` +
> `\dT TrainingOutcome` que tables et types sont bien absents.

### 16.3 Re-déploiement de l'image pré-V1.2 (pré-#110)

```bash
export FXMILY_IMAGE=ghcr.io/<owner>/fxmily:<pre-v1.2-training-sha>
docker compose -f /opt/fxmily/docker-compose.prod.yml pull web
docker compose -f /opt/fxmily/docker-compose.prod.yml up -d --remove-orphans web
```

### 16.4 Vérification post-rollback

```bash
curl -fsS https://app.fxmilyapp.com/api/health   # 200 attendu

docker compose -f /opt/fxmily/docker-compose.prod.yml exec -T postgres \
  psql -U fxmily -d fxmily -c "\dt training_trades"        # 0 rows
docker compose -f /opt/fxmily/docker-compose.prod.yml exec -T postgres \
  psql -U fxmily -d fxmily -c "\dt training_annotations"   # 0 rows
docker compose -f /opt/fxmily/docker-compose.prod.yml exec -T postgres \
  psql -U fxmily -d fxmily -c "\dT TrainingOutcome"        # 0 rows

# Audit log : consigne le rollback.
docker compose -f /opt/fxmily/docker-compose.prod.yml exec -T postgres \
  psql -U fxmily -d fxmily -c "INSERT INTO audit_logs (action, metadata, created_at) \
    VALUES ('ops.migration.rolled_back', \
      '{\"migration\":\"v1_2_training_entities\",\"by\":\"eliot\",\"data_loss_training_trades\":N,\"data_loss_training_annotations\":N}'::jsonb, \
      NOW());"
```

### 16.5 Re-application future

1. Re-deploy l'image V1.2+ HEAD (chaîne J-T1 → J-T4).
2. `pnpm --filter @fxmily/web prisma:migrate deploy` — Prisma re-cale.
3. **Restore les 2 tables** depuis `pg_dump` step 16.1 :

   ```bash
   gunzip -c /etc/fxmily/backups/pre-v1.2-rollback-training-<TS>.sql.gz \
     | docker compose -f /opt/fxmily/docker-compose.prod.yml exec -T postgres \
         psql -U fxmily -d fxmily
   ```

## 17. Rollback V1.2 training annotation notification migration (`20260517170000_v1_2_training_annotation_notification`)

> **Quand l'utiliser** : si l'ajout de la valeur enum
> `training_annotation_received` à `NotificationType` (SPEC §21, J-T3 —
> notification membre quand l'admin corrige un backtest) doit être
> physiquement retiré (rare — la valeur est safe par construction ADD-only ;
> le rollback n'est utile que si un drift Prisma futur bloque une migration,
> ou pour un revert complet du Mode Entraînement avec §16).
>
> ⚠️ **NON-RÉVERSIBLE par un simple `BEGIN/COMMIT`** : PostgreSQL n'a **pas**
> d'`ALTER TYPE … DROP VALUE`. Le rollback est une **procédure manuelle de
> reconstruction du type** (exception au point 3 de la Note transversale). NE
> PAS automatiser dans un bloc naïf comme §15/§16.
>
> Si §16 (`training_entities`) est aussi rollé, **roller §17 EN PREMIER**
> (ordre inverse de l'apply : #112 avant #110).

### 17.1 Pré-requis — quiesce

Stop le web pour qu'aucune nouvelle row ne soit enqueue avec le nouveau
type :

```bash
docker compose -f /opt/fxmily/docker-compose.prod.yml stop web
```

Vérifie l'état Prisma :

```bash
docker compose -f /opt/fxmily/docker-compose.prod.yml exec -T postgres \
  psql -U fxmily -d fxmily -c "SELECT migration_name, finished_at \
    FROM _prisma_migrations \
    WHERE migration_name LIKE '%v1_2_training_annotation_notification%' \
    ORDER BY started_at DESC;"
```

### 17.2 Purge des rows utilisant la valeur

Seulement si le runtime J-T3 a shippé + tourné (sinon aucune row n'utilise
la valeur → sauter à 17.3). **Data-loss si rollé APRÈS dispatch J-T3** :
uniquement les rows `notification_queue` / `notification_preferences` de
`type = 'training_annotation_received'` (intents push transients +
préférences opt-out par membre pour CETTE catégorie ; aucun contenu
membre-authored, aucune donnée backtest, aucune donnée real-edge).
`pg_dump` ces 2 tables AVANT le DELETE si les rows doivent être préservées
pour un re-apply :

```bash
TS=$(date -u +%Y%m%dT%H%M%SZ)
docker compose -f /opt/fxmily/docker-compose.prod.yml exec -T postgres \
  pg_dump -U fxmily -d fxmily \
  -t notification_queue -t notification_preferences \
  --data-only --column-inserts \
  | gzip > "/etc/fxmily/backups/pre-v1.2-rollback-notif-enum-${TS}.sql.gz"
```

```sql
DELETE FROM "notification_queue"       WHERE "type" = 'training_annotation_received';
DELETE FROM "notification_preferences" WHERE "type" = 'training_annotation_received';
```

### 17.3 SQL rollback — reconstruction manuelle du type

Transcrit verbatim du header de migration. Une seule transaction, web
stoppé. **Step 17.2 doit être complété d'abord** — ce bloc échoue fast si
une row survivante référence encore la valeur :

```sql
BEGIN;
ALTER TYPE "NotificationType" RENAME TO "NotificationType_old";
CREATE TYPE "NotificationType" AS ENUM (
  'annotation_received',
  'checkin_morning_reminder',
  'checkin_evening_reminder',
  'douglas_card_delivered',
  'weekly_report_ready'
);
ALTER TABLE "notification_queue"
  ALTER COLUMN "type" TYPE "NotificationType"
  USING ("type"::text::"NotificationType");
ALTER TABLE "notification_preferences"
  ALTER COLUMN "type" TYPE "NotificationType"
  USING ("type"::text::"NotificationType");
DROP TYPE "NotificationType_old";
DELETE FROM "_prisma_migrations"
  WHERE migration_name = '20260517170000_v1_2_training_annotation_notification';
COMMIT;
```

> ⚠️ Si le `BEGIN`/`COMMIT` échoue à mi-parcours, Postgres rollback
> automatique — état cohérent. Re-vérifie que `training_annotation_received`
> n'est plus une valeur de `NotificationType` (requête 17.5).

### 17.4 Re-déploiement de l'image pré-J-T3

```bash
export FXMILY_IMAGE=ghcr.io/<owner>/fxmily:<pre-jt3-sha>
docker compose -f /opt/fxmily/docker-compose.prod.yml pull web
docker compose -f /opt/fxmily/docker-compose.prod.yml up -d --remove-orphans web
```

### 17.5 Vérification post-rollback

```bash
curl -fsS https://app.fxmilyapp.com/api/health   # 200 attendu

docker compose -f /opt/fxmily/docker-compose.prod.yml exec -T postgres \
  psql -U fxmily -d fxmily -c \
  "SELECT 1 FROM pg_enum e JOIN pg_type t ON e.enumtypid = t.oid \
   WHERE t.typname = 'NotificationType' AND e.enumlabel = 'training_annotation_received';"
# Attendu : 0 rows (valeur absente)

# Audit log : consigne le rollback.
docker compose -f /opt/fxmily/docker-compose.prod.yml exec -T postgres \
  psql -U fxmily -d fxmily -c "INSERT INTO audit_logs (action, metadata, created_at) \
    VALUES ('ops.migration.rolled_back', \
      '{\"migration\":\"v1_2_training_annotation_notification\",\"by\":\"eliot\",\"data_loss_notif_queue_rows\":N,\"data_loss_notif_pref_rows\":N}'::jsonb, \
      NOW());"
```

### 17.6 Re-application future

1. Re-deploy l'image J-T3+ HEAD.
2. `pnpm --filter @fxmily/web prisma:migrate deploy` — Prisma re-applique
   l'`ALTER TYPE … ADD VALUE` et re-cale la row.
3. **Restore** depuis `pg_dump` step 17.2 si des rows
   `training_annotation_received` avaient été préservées :

   ```bash
   gunzip -c /etc/fxmily/backups/pre-v1.2-rollback-notif-enum-<TS>.sql.gz \
     | docker compose -f /opt/fxmily/docker-compose.prod.yml exec -T postgres \
         psql -U fxmily -d fxmily
   ```

## 18. Rollback V1.3 training debrief migration (`20260518150000_v1_3_training_debrief`)

> **Quand l'utiliser** : si la migration V1.3 "Débrief Training dédié"
> (SPEC §23, jalon #1 de la séquence §21.6 — table `training_debriefs`,
> recap hebdo de pratique backtest reverse-journaling Steenbarger 4 champs)
> a été déployée en prod et qu'un blocker post-deploy nécessite de retirer
> complètement la table. La table est **ADD-only** (aucun DROP/rename/
> backfill/NOT-NULL-on-populated, 1 seule FK `user_id → users`
> `ON DELETE CASCADE` côté `training_debriefs` uniquement — aucune donnée
> `users` touchée). Brand-new + vide au moment de l'apply → rollback
> immédiat loss-free.
>
> ⚠️ **Risque data loss** : dès qu'un membre a soumis un débrief
> (`training_debriefs` — 4 champs free-text reverse-journaling
> membre-authored : `process_strength_one`, `process_strength_two`,
> `micro_adjustment`, `transversal_lesson`), le `DROP TABLE` les détruit
> irréversiblement. `pg_dump -t training_debriefs` atomique AVANT est
> OBLIGATOIRE (RGPD : donnée membre-authored réflexive).
>
> **Invariant §21.5 préservé** : `training_debriefs` ne touche AUCUN objet
> real-edge — zéro FK vers `trades` / `weekly_reviews` / `behavioral_scores`,
> la seule relation est `training_debriefs.user_id → users.id` (même forme
> que `training_trades`). Le rollback ne peut pas affecter le track-record /
> score / expectancy réels. Indépendant de §15/§16/§17 (aucune FK croisée).

### 18.1 Pré-requis avant rollback

1. **Backup atomique de `training_debriefs`** : si des débriefs ont déjà
   été écrits (RGPD : donnée membre-authored réflexive), le `DROP TABLE`
   les détruit irréversiblement. `pg_dump` AVANT :

   ```bash
   docker compose -f /opt/fxmily/docker-compose.prod.yml exec -T postgres \
     pg_dump -U fxmily -d fxmily -t training_debriefs --data-only --column-inserts \
     | gzip > /etc/fxmily/backups/pre-v1.3-rollback-training-debrief-$(date -u +%Y%m%dT%H%M%SZ).sql.gz
   ```

2. **Stop le web** (la Server Action débrief écrit la table) :

   ```bash
   docker compose -f /opt/fxmily/docker-compose.prod.yml stop web
   ```

3. **Vérifie l'état Prisma** :

   ```bash
   docker compose -f /opt/fxmily/docker-compose.prod.yml exec -T postgres \
     psql -U fxmily -d fxmily -c "SELECT migration_name, finished_at \
       FROM _prisma_migrations WHERE migration_name LIKE '%v1_3_training_debrief%' \
       ORDER BY started_at DESC;"
   ```

4. **Confirme l'absence de FK cascade orpheline** : l'unique FK
   (`user_id`) est `ON DELETE CASCADE` côté `training_debriefs` — un
   `DROP TABLE` clean retire aussi la FK + les 2 index (1 regular timeline
   - 1 unique idempotency). Pas d'orpheline côté `users`.

### 18.2 SQL rollback

Transcrit verbatim du header de migration (`prior jalons §11..§17
separate-PR pattern`). Pas d'enum, pas d'index-avant-colonne — `DROP
TABLE` retire ses propres index + la FK :

```sql
BEGIN;

-- Drop the table (CASCADE not needed — indexes + FK belong to training_debriefs).
DROP TABLE IF EXISTS "training_debriefs";

-- Wipe the Prisma migrations row so the schema can be re-applied later.
DELETE FROM "_prisma_migrations"
  WHERE migration_name = '20260518150000_v1_3_training_debrief';

COMMIT;
```

> ⚠️ Si le `BEGIN`/`COMMIT` échoue à mi-parcours, Postgres rollback
> automatique — état cohérent (tout ou rien). Re-vérifie via
> `\dt training_debriefs` que la table est bien absente.

### 18.3 Re-déploiement de l'image pré-V1.3

```bash
export FXMILY_IMAGE=ghcr.io/<owner>/fxmily:<pre-v1.3-training-debrief-sha>
docker compose -f /opt/fxmily/docker-compose.prod.yml pull web
docker compose -f /opt/fxmily/docker-compose.prod.yml up -d --remove-orphans web
```

### 18.4 Vérification post-rollback

```bash
curl -fsS https://app.fxmilyapp.com/api/health   # 200 attendu

docker compose -f /opt/fxmily/docker-compose.prod.yml exec -T postgres \
  psql -U fxmily -d fxmily -c "\dt training_debriefs"   # 0 rows (table absente)

# Audit log : consigne le rollback.
docker compose -f /opt/fxmily/docker-compose.prod.yml exec -T postgres \
  psql -U fxmily -d fxmily -c "INSERT INTO audit_logs (action, metadata, created_at) \
    VALUES ('ops.migration.rolled_back', \
      '{\"migration\":\"v1_3_training_debrief\",\"by\":\"eliot\",\"data_loss_training_debriefs\":N}'::jsonb, \
      NOW());"
```

### 18.5 Re-application future

1. Re-deploy l'image V1.3+ HEAD.
2. `pnpm --filter @fxmily/web prisma:migrate deploy` — Prisma re-cale la row.
3. **Restore `training_debriefs`** depuis `pg_dump` step 18.1 si des
   débriefs avaient été écrits :

   ```bash
   gunzip -c /etc/fxmily/backups/pre-v1.3-rollback-training-debrief-<TS>.sql.gz \
     | docker compose -f /opt/fxmily/docker-compose.prod.yml exec -T postgres \
         psql -U fxmily -d fxmily
   ```

## 19. Rollback V1.4 monthly debrief migration (`20260519150000_v1_4_monthly_debrief`)

> **Quand l'utiliser** : si la migration V1.4 "Débrief Mensuel IA dédié"
> (SPEC §25, jalon #2 de la séquence §21.6 — table `monthly_debriefs` +
> valeur enum `monthly_debrief_ready` sur `NotificationType`, synthèse IA
> mensuelle dual-section générée par batch local Claude Max) a été déployée
> en prod et qu'un blocker post-deploy nécessite de la retirer complètement.
> Purement ADD-only (1 valeur enum + 1 table neuve + 1 FK `user_id → users`
> `ON DELETE CASCADE` côté `monthly_debriefs` uniquement). Brand-new + vide
> au moment de l'apply → rollback immédiat loss-free.
>
> ⚠️ **NON-RÉVERSIBLE par un simple `BEGIN/COMMIT`** : comme §17, PostgreSQL
> n'a **pas** d'`ALTER TYPE … DROP VALUE`. La partie enum est une
> **procédure manuelle de reconstruction du type** (exception au point 3 de
> la Note transversale). NE PAS automatiser dans un bloc naïf comme
> §15/§16/§18.
>
> ⚠️ **Risque data loss** : dès qu'un membre a un débrief mensuel persisté
> (`monthly_debriefs` — texte IA member-facing réflexif : narratif de
> progression + 2 sections + risks/recos/patterns), le `DROP TABLE` les
> détruit irréversiblement. `pg_dump -t monthly_debriefs` atomique AVANT est
> OBLIGATOIRE (RGPD : texte IA member-facing).
>
> **Invariant §21.5 préservé** : `monthly_debriefs` ne touche AUCUN objet
> real-edge — zéro FK vers `trades` / `weekly_reports` / `training_trades` /
> `behavioral_scores`, la seule relation est
> `monthly_debriefs.user_id → users.id` (même forme que `training_debriefs`).
> Les ≤4 `weekly_reports` du mois civil sont lus en INPUT par l'agrégateur
> pur, jamais liés en FK — le rollback ne peut pas affecter le track-record /
> score / expectancy réels. Indépendant de §15/§16/§17/§18 (aucune FK
> croisée). Si §18 (`training_debriefs`) est aussi rollé, **roller §19 EN
> PREMIER** (ordre inverse de l'apply : ce PR après #132).

### 19.1 Pré-requis — quiesce

Stop le web pour qu'aucune nouvelle row ne soit enqueue avec le nouveau
type ni qu'un batch persiste un débrief pendant le DROP :

```bash
docker compose -f /opt/fxmily/docker-compose.prod.yml stop web
```

Vérifie l'état Prisma :

```bash
docker compose -f /opt/fxmily/docker-compose.prod.yml exec -T postgres \
  psql -U fxmily -d fxmily -c "SELECT migration_name, finished_at \
    FROM _prisma_migrations WHERE migration_name LIKE '%v1_4_monthly_debrief%' \
    ORDER BY started_at DESC;"
```

### 19.2 Backup `monthly_debriefs` + purge des rows utilisant l'enum

1. **Backup atomique de `monthly_debriefs`** : si des débriefs mensuels ont
   déjà été générés (RGPD : texte IA member-facing réflexif), le `DROP
TABLE` les détruit irréversiblement. `pg_dump` AVANT :

   ```bash
   TS=$(date -u +%Y%m%dT%H%M%SZ)
   docker compose -f /opt/fxmily/docker-compose.prod.yml exec -T postgres \
     pg_dump -U fxmily -d fxmily -t monthly_debriefs --data-only --column-inserts \
     | gzip > "/etc/fxmily/backups/pre-v1.4-rollback-monthly-debrief-${TS}.sql.gz"
   ```

2. **Purge des rows enum** — seulement si le runtime J-M3 a shippé + tourné
   (sinon aucune row n'utilise la valeur → sauter à 19.3). Data-loss limité
   aux rows `notification_queue` / `notification_preferences` de
   `type = 'monthly_debrief_ready'` (intents push transients + préférences
   opt-out par membre pour CETTE catégorie ; aucun contenu membre-authored,
   aucune donnée backtest, aucune donnée real-edge). `pg_dump` ces 2 tables
   AVANT le DELETE si elles doivent être préservées pour un re-apply :

   ```bash
   docker compose -f /opt/fxmily/docker-compose.prod.yml exec -T postgres \
     pg_dump -U fxmily -d fxmily \
     -t notification_queue -t notification_preferences \
     --data-only --column-inserts \
     | gzip > "/etc/fxmily/backups/pre-v1.4-rollback-notif-enum-${TS}.sql.gz"
   ```

   ```sql
   DELETE FROM "notification_queue"       WHERE "type" = 'monthly_debrief_ready';
   DELETE FROM "notification_preferences" WHERE "type" = 'monthly_debrief_ready';
   ```

### 19.3 SQL rollback — DROP TABLE + reconstruction manuelle du type

Transcrit verbatim du header de migration (`20260519150000_v1_4_monthly_
debrief/migration.sql` step 4). Une seule transaction, web stoppé. **Step
19.2.2 doit être complété d'abord** — le `CREATE TYPE` échoue fast si une
row survivante référence encore la valeur :

```sql
BEGIN;
DROP TABLE IF EXISTS "monthly_debriefs";
ALTER TYPE "NotificationType" RENAME TO "NotificationType_old";
CREATE TYPE "NotificationType" AS ENUM (
  'annotation_received',
  'training_annotation_received',
  'checkin_morning_reminder',
  'checkin_evening_reminder',
  'douglas_card_delivered',
  'weekly_report_ready'
);
ALTER TABLE "notification_queue"
  ALTER COLUMN "type" TYPE "NotificationType"
  USING ("type"::text::"NotificationType");
ALTER TABLE "notification_preferences"
  ALTER COLUMN "type" TYPE "NotificationType"
  USING ("type"::text::"NotificationType");
DROP TYPE "NotificationType_old";
DELETE FROM "_prisma_migrations"
  WHERE migration_name = '20260519150000_v1_4_monthly_debrief';
COMMIT;
```

> ⚠️ Si le `BEGIN`/`COMMIT` échoue à mi-parcours, Postgres rollback
> automatique — état cohérent (tout ou rien). Re-vérifie via
> `\dt monthly_debriefs` (table absente) + la requête enum de 19.5.

### 19.4 Re-déploiement de l'image pré-V1.4

```bash
export FXMILY_IMAGE=ghcr.io/<owner>/fxmily:<pre-v1.4-monthly-debrief-sha>
docker compose -f /opt/fxmily/docker-compose.prod.yml pull web
docker compose -f /opt/fxmily/docker-compose.prod.yml up -d --remove-orphans web
```

### 19.5 Vérification post-rollback

```bash
curl -fsS https://app.fxmilyapp.com/api/health   # 200 attendu

docker compose -f /opt/fxmily/docker-compose.prod.yml exec -T postgres \
  psql -U fxmily -d fxmily -c "\dt monthly_debriefs"   # 0 rows (table absente)

docker compose -f /opt/fxmily/docker-compose.prod.yml exec -T postgres \
  psql -U fxmily -d fxmily -c \
  "SELECT 1 FROM pg_enum e JOIN pg_type t ON e.enumtypid = t.oid \
   WHERE t.typname = 'NotificationType' AND e.enumlabel = 'monthly_debrief_ready';"
# Attendu : 0 rows (valeur absente)

# Audit log : consigne le rollback.
docker compose -f /opt/fxmily/docker-compose.prod.yml exec -T postgres \
  psql -U fxmily -d fxmily -c "INSERT INTO audit_logs (action, metadata, created_at) \
    VALUES ('ops.migration.rolled_back', \
      '{\"migration\":\"v1_4_monthly_debrief\",\"by\":\"eliot\",\"data_loss_monthly_debriefs\":N,\"data_loss_notif_queue_rows\":N,\"data_loss_notif_pref_rows\":N}'::jsonb, \
      NOW());"
```

### 19.6 Re-application future

1. Re-deploy l'image V1.4+ HEAD.
2. `pnpm --filter @fxmily/web prisma:migrate deploy` — Prisma re-applique
   l'`ALTER TYPE … ADD VALUE` + le `CREATE TABLE` et re-cale la row.
3. **Restore `monthly_debriefs`** depuis `pg_dump` step 19.2.1 si des
   débriefs avaient été générés :

   ```bash
   gunzip -c /etc/fxmily/backups/pre-v1.4-rollback-monthly-debrief-<TS>.sql.gz \
     | docker compose -f /opt/fxmily/docker-compose.prod.yml exec -T postgres \
         psql -U fxmily -d fxmily
   ```

4. **Restore** depuis `pg_dump` step 19.2.2 si des rows
   `monthly_debrief_ready` (queue / préférences) avaient été préservées.

## 20. Rollback V1.5 §27 mindset_check migration (`20260519170000_v1_5_mindset_check`)

> **Quand l'utiliser** : si la migration V1.5 "QCM athlète" (SPEC §27,
> jalon #3 de la séquence §21.6 — table `mindset_checks` + valeur enum
> `mindset_check_ready` sur `NotificationType`, auto-évaluation mindset
> hebdomadaire Likert 100 % déterministe zéro-IA) a été déployée en prod et
> qu'un blocker post-deploy nécessite de la retirer complètement. Purement
> ADD-only (1 valeur enum + 1 table neuve + 1 FK `user_id → users`
> `ON DELETE CASCADE` côté `mindset_checks` uniquement). Brand-new + vide au
> moment de l'apply → rollback immédiat loss-free.
>
> ⚠️ **NON-RÉVERSIBLE par un simple `BEGIN/COMMIT`** : comme §17/§19,
> PostgreSQL n'a **pas** d'`ALTER TYPE … DROP VALUE`. La partie enum est une
> **procédure manuelle de reconstruction du type** (exception au point 3 de
> la Note transversale). NE PAS automatiser dans un bloc naïf comme
> §15/§16/§18. C'est le **deuxième rollback enum-rebuild consécutif** après
> §19 (`monthly_debrief_ready`) — le type reconstruit ci-dessous repart donc
> du jeu **7 valeurs** post-§25 (incluant `monthly_debrief_ready`), pas du
> jeu 6 valeurs de §19.
>
> ⚠️ **Risque data loss** : dès qu'un membre a une auto-évaluation persistée
> (`mindset_checks` — `responses` Likert member-authored), le `DROP TABLE`
> les détruit irréversiblement. `pg_dump -t mindset_checks` atomique AVANT
> est OBLIGATOIRE (RGPD : auto-évaluation member-authored).
>
> **Invariant §21.5/§27.7 préservé** : `mindset_checks` ne touche AUCUN objet
> real-edge — zéro FK vers `trades` / `weekly_reports` / `training_trades` /
> `behavioral_scores`, la seule relation est
> `mindset_checks.user_id → users.id` (même forme que `training_debriefs` /
> `monthly_debriefs`). Le profil/tendance sont calculés purement au render
> (jamais stockés) — le rollback ne peut pas affecter le track-record /
> score / engagement / trigger. Indépendant de §15/§16/§17/§18/§19 (aucune
> FK croisée). Si §19 (`monthly_debriefs`) est aussi rollé, **roller §20 EN
> PREMIER** (ordre inverse de l'apply : ce PR après #135).

### 20.1 Pré-requis — quiesce

Stop le web pour qu'aucune nouvelle row ne soit enqueue avec le nouveau
type ni qu'un membre ne soumette une auto-évaluation pendant le DROP :

```bash
docker compose -f /opt/fxmily/docker-compose.prod.yml stop web
```

Vérifie l'état Prisma :

```bash
docker compose -f /opt/fxmily/docker-compose.prod.yml exec -T postgres \
  psql -U fxmily -d fxmily -c "SELECT migration_name, finished_at \
    FROM _prisma_migrations WHERE migration_name LIKE '%v1_5_mindset_check%' \
    ORDER BY started_at DESC;"
```

### 20.2 Backup `mindset_checks` + purge des rows utilisant l'enum

1. **Backup atomique de `mindset_checks`** : si des auto-évaluations ont
   déjà été soumises (RGPD : `responses` Likert member-authored), le `DROP
TABLE` les détruit irréversiblement. `pg_dump` AVANT :

   ```bash
   TS=$(date -u +%Y%m%dT%H%M%SZ)
   docker compose -f /opt/fxmily/docker-compose.prod.yml exec -T postgres \
     pg_dump -U fxmily -d fxmily -t mindset_checks --data-only --column-inserts \
     | gzip > "/etc/fxmily/backups/pre-v1.5-rollback-mindset-check-${TS}.sql.gz"
   ```

2. **Purge des rows enum** — seulement si le runtime qui enqueue
   `mindset_check_ready` (cron `mindset-check-reminders`) a shippé + tourné
   (sinon aucune row n'utilise la valeur → sauter à 20.3). Data-loss limité
   aux rows `notification_queue` / `notification_preferences` de
   `type = 'mindset_check_ready'` (intents push transients + préférences
   opt-out par membre pour CETTE catégorie ; aucun contenu membre-authored,
   aucune donnée backtest, aucune donnée real-edge). `pg_dump` ces 2 tables
   AVANT le DELETE si elles doivent être préservées pour un re-apply :

   ```bash
   docker compose -f /opt/fxmily/docker-compose.prod.yml exec -T postgres \
     pg_dump -U fxmily -d fxmily \
     -t notification_queue -t notification_preferences \
     --data-only --column-inserts \
     | gzip > "/etc/fxmily/backups/pre-v1.5-rollback-notif-enum-${TS}.sql.gz"
   ```

   ```sql
   DELETE FROM "notification_queue"       WHERE "type" = 'mindset_check_ready';
   DELETE FROM "notification_preferences" WHERE "type" = 'mindset_check_ready';
   ```

### 20.3 SQL rollback — DROP TABLE + reconstruction manuelle du type

Transcrit verbatim du header de migration (`20260519170000_v1_5_mindset_
check/migration.sql` step 4). Une seule transaction, web stoppé. **Step
20.2.2 doit être complété d'abord** — le `CREATE TYPE` échoue fast si une
row survivante référence encore la valeur :

```sql
BEGIN;
DROP TABLE IF EXISTS "mindset_checks";
ALTER TYPE "NotificationType" RENAME TO "NotificationType_old";
CREATE TYPE "NotificationType" AS ENUM (
  'annotation_received',
  'training_annotation_received',
  'checkin_morning_reminder',
  'checkin_evening_reminder',
  'douglas_card_delivered',
  'weekly_report_ready',
  'monthly_debrief_ready'
);
ALTER TABLE "notification_queue"
  ALTER COLUMN "type" TYPE "NotificationType"
  USING ("type"::text::"NotificationType");
ALTER TABLE "notification_preferences"
  ALTER COLUMN "type" TYPE "NotificationType"
  USING ("type"::text::"NotificationType");
DROP TYPE "NotificationType_old";
DELETE FROM "_prisma_migrations"
  WHERE migration_name = '20260519170000_v1_5_mindset_check';
COMMIT;
```

> ⚠️ Le `CREATE TYPE` repart du jeu **7 valeurs** post-§25 (incluant
> `monthly_debrief_ready`) — le re-cast des 2 colonnes est lossless pour
> toutes les rows non-`mindset_check_ready`. Si le `BEGIN`/`COMMIT` échoue à
> mi-parcours, Postgres rollback automatique — état cohérent (tout ou rien).
> Re-vérifie via `\dt mindset_checks` (table absente) + la requête enum de
> 20.5.

### 20.4 Re-déploiement de l'image pré-V1.5

```bash
export FXMILY_IMAGE=ghcr.io/<owner>/fxmily:<pre-v1.5-mindset-check-sha>
docker compose -f /opt/fxmily/docker-compose.prod.yml pull web
docker compose -f /opt/fxmily/docker-compose.prod.yml up -d --remove-orphans web
```

### 20.5 Vérification post-rollback

```bash
curl -fsS https://app.fxmilyapp.com/api/health   # 200 attendu

docker compose -f /opt/fxmily/docker-compose.prod.yml exec -T postgres \
  psql -U fxmily -d fxmily -c "\dt mindset_checks"   # 0 rows (table absente)

docker compose -f /opt/fxmily/docker-compose.prod.yml exec -T postgres \
  psql -U fxmily -d fxmily -c \
  "SELECT 1 FROM pg_enum e JOIN pg_type t ON e.enumtypid = t.oid \
   WHERE t.typname = 'NotificationType' AND e.enumlabel = 'mindset_check_ready';"
# Attendu : 0 rows (valeur absente)

# Audit log : consigne le rollback.
docker compose -f /opt/fxmily/docker-compose.prod.yml exec -T postgres \
  psql -U fxmily -d fxmily -c "INSERT INTO audit_logs (action, metadata, created_at) \
    VALUES ('ops.migration.rolled_back', \
      '{\"migration\":\"v1_5_mindset_check\",\"by\":\"eliot\",\"data_loss_mindset_checks\":N,\"data_loss_notif_queue_rows\":N,\"data_loss_notif_pref_rows\":N}'::jsonb, \
      NOW());"
```

### 20.6 Re-application future

1. Re-deploy l'image V1.5+ HEAD.
2. `pnpm --filter @fxmily/web prisma:migrate deploy` — Prisma re-applique
   l'`ALTER TYPE … ADD VALUE` + le `CREATE TABLE`.
3. **Restore `mindset_checks`** depuis `pg_dump` step 20.2.1 si des
   auto-évaluations avaient été soumises :

   ```bash
   gunzip -c /etc/fxmily/backups/pre-v1.5-rollback-mindset-check-<TS>.sql.gz \
     | docker compose -f /opt/fxmily/docker-compose.prod.yml exec -T postgres \
         psql -U fxmily -d fxmily
   ```

4. **Restore** depuis `pg_dump` step 20.2.2 si des rows
   `mindset_check_ready` (queue / préférences) avaient été préservées.

## 21. Rollback T5 track-record migration (`20260521172000_track_record_public_trades`)

> **Quand l'utiliser** : si la migration T5 "Admin CRUD Public Track Record"
> (PR #151, jalon final — `PublicTrade` + `PublicTradePartial` pour gérer la
> vitrine publique `@fxmily/track-record` Cloudflare Pages) a été déployée en
> prod et qu'un blocker post-deploy nécessite de la retirer complètement.
> Pure ADD-only (2 enums Postgres + 2 tables neuves + 3 index + 1 FK
> `public_trade_partials.publicTradeId → public_trades.id` `ON DELETE CASCADE`).
> Brand-new + isolé du graphe métier real-edge (zéro FK vers `trades` /
> `users` / `weekly_reports` / etc. — `public_trades` est admin-authored
> uniquement, pas member-authored).
>
> ✅ **Simple `BEGIN/COMMIT`-revertable** (PAS d'`ALTER TYPE … DROP VALUE`
> nécessaire — les 2 enums `PublicTradeSegment` + `PublicTradeStatus` sont
> brand-new et ne sont référencés QUE par les 2 tables qu'on supprime →
> `DROP TYPE` clean). Pattern carbone §16 (`v1_2_training_entities`).
>
> ⚠️ **Risque data loss** : `public_trades` contient les 139 trades importés
> depuis l'ODS de Fxmily 2025 (cf. `scripts/import-fxmily-trades.ts`) +
> toutes les éditions admin ultérieures via `/admin/track-record/*`. Pas de
> données member-authored (donc RGPD non-impacté), mais ré-importer l'ODS
>
> - reproduire les éditions admin = effort manuel non-trivial. `pg_dump
--data-only` atomique des 2 tables AVANT est OBLIGATOIRE.
>
> **Surface admin uniquement** : la sous-app `@fxmily/track-record` (vitrine
> Cloudflare Pages) est un static export — elle ne lit JAMAIS la DB Hetzner
> en runtime. Le rollback n'affecte donc pas `trackrecordfxmily.pages.dev`
> tant qu'aucun rebuild static n'est déclenché (cf. T6 deferred — wire
> webhook static rebuild).
>
> **Indépendant de §15-§20** : 0 FK croisée. Si plusieurs rollbacks sont
> nécessaires, l'ordre inverse de l'apply continue d'appliquer (§21 → §20 →
> §19 → … → §15).

### 21.1 Pré-requis — quiesce

Stop le web pour qu'aucune nouvelle mutation admin ne soit persistée pendant
le DROP :

```bash
docker compose -f /opt/fxmily/docker-compose.prod.yml stop web
```

Vérifie l'état Prisma :

```bash
docker compose -f /opt/fxmily/docker-compose.prod.yml exec -T postgres \
  psql -U fxmily -d fxmily -c "SELECT migration_name, finished_at \
    FROM _prisma_migrations WHERE migration_name LIKE '%track_record_public_trades%' \
    ORDER BY started_at DESC;"
```

### 21.2 Backup `public_trades` + `public_trade_partials`

```bash
TS=$(date -u +%Y%m%dT%H%M%SZ)
docker compose -f /opt/fxmily/docker-compose.prod.yml exec -T postgres \
  pg_dump -U fxmily -d fxmily \
  -t public_trades -t public_trade_partials \
  --data-only --column-inserts \
  | gzip > "/etc/fxmily/backups/pre-t5-rollback-public-trades-${TS}.sql.gz"
```

> Conservé 30j R2 (lifecycle `caddy/` carbone) + 7j local (`fxmily-backup`
> rotation). Le re-import 2025 via `tsx scripts/import-fxmily-trades.ts
--year 2025` reste possible mais perd les éditions admin manuelles
> post-import.

### 21.3 SQL rollback — DROP TABLES + DROP TYPES dans un seul BEGIN/COMMIT

Ordre obligatoire : table fille (`public_trade_partials`) AVANT table parent
(`public_trades`) AVANT les types enum (sinon `cannot drop type because
other objects depend on it`) :

```sql
BEGIN;
DROP TABLE IF EXISTS "public_trade_partials";
DROP TABLE IF EXISTS "public_trades";
DROP TYPE IF EXISTS "PublicTradeStatus";
DROP TYPE IF EXISTS "PublicTradeSegment";
DELETE FROM "_prisma_migrations"
  WHERE migration_name = '20260521172000_track_record_public_trades';
COMMIT;
```

> Postgres rollback automatique si une étape échoue (cohérence garantie).

### 21.4 Re-déploiement de l'image pré-T5

```bash
export FXMILY_IMAGE=ghcr.io/<owner>/fxmily:<pre-t5-sha>
docker compose -f /opt/fxmily/docker-compose.prod.yml pull web
docker compose -f /opt/fxmily/docker-compose.prod.yml up -d --remove-orphans web
```

### 21.5 Vérification post-rollback

```bash
curl -fsS https://app.fxmilyapp.com/api/health   # 200 attendu

docker compose -f /opt/fxmily/docker-compose.prod.yml exec -T postgres \
  psql -U fxmily -d fxmily -c "\dt public_trades public_trade_partials"
# Attendu : "Did not find any relations" (les 2 tables absentes)

docker compose -f /opt/fxmily/docker-compose.prod.yml exec -T postgres \
  psql -U fxmily -d fxmily -c \
  "SELECT typname FROM pg_type WHERE typname IN \
   ('PublicTradeSegment', 'PublicTradeStatus');"
# Attendu : 0 rows (types absents)

# Audit log : consigne le rollback honnête counters.
docker compose -f /opt/fxmily/docker-compose.prod.yml exec -T postgres \
  psql -U fxmily -d fxmily -c "INSERT INTO audit_logs (action, metadata, created_at) \
    VALUES ('ops.migration.rolled_back', \
      '{\"migration\":\"t5_track_record_public_trades\",\"by\":\"eliot\",\"data_loss_public_trades\":N,\"data_loss_public_trade_partials\":M}'::jsonb, \
      NOW());"
```

### 21.6 Re-application future

1. Re-deploy l'image T5+ HEAD.
2. `docker compose -f /opt/fxmily/docker-compose.prod.yml run --rm web \
pnpm --filter @fxmily/web prisma:migrate deploy` (rejoue la migration).
3. **Restore** depuis `pg_dump` step 21.2 si on veut préserver les 139
   trades ODS 2025 + éditions admin :

   ```bash
   gunzip -c /etc/fxmily/backups/pre-t5-rollback-public-trades-<TS>.sql.gz \
     | docker compose -f /opt/fxmily/docker-compose.prod.yml exec -T postgres \
         psql -U fxmily -d fxmily
   ```

4. **Alternative** : re-import propre via
   `pnpm --filter @fxmily/web exec tsx scripts/import-fxmily-trades.ts --year 2025`
   (re-crée les 139 trades depuis l'ODS source, perd les éditions admin).

## 22. Rollback V2.3 pre-trade circuit breaker migration (`20260526100000_v2_3_pre_trade_check`)

> **Quand l'utiliser** : si la migration V2.3 "Pre-trade circuit breaker"
> (PR #178 `602787c`, ADR-003 Gollwitzer if-then d=0.65 + Mark Douglas 4
> fears + Steenbarger boredom extension — anti-FOMO wizard 4 questions
> closed instrument) a été déployée en prod et qu'un blocker post-deploy
> nécessite de la retirer complètement.
> Pure ADD-only (2 enums Postgres + 1 table neuve + 1 index + 1 FK
> `pre_trade_checks.user_id → users.id` `ON DELETE CASCADE`).
> Brand-new + structurellement isolé du graphe métier real-edge :
> `linkedTradeId String?` est **intentionnellement SANS FK** vers `trades`
> (ADR-003 §Auto-link race-safe P2025 — un Trade supprimé laisse
> `linkedTradeId` dangling plutôt que nuller le check, scar I1
> documenté). Donc 0 FK croisée vers `trades` / `weekly_reports` / etc.
>
> ✅ **Simple `BEGIN/COMMIT`-revertable** (PAS d'`ALTER TYPE … DROP VALUE`
> nécessaire — les 2 enums `PreTradeReason` + `PreTradeEmotion` sont
> brand-new et ne sont référencés QUE par la seule table qu'on supprime →
> `DROP TYPE` clean). Pattern carbone §14 (`v2_0_track_habit_logs`) + §15
> (`v2_1_admin_notes`) + §21 (`track_record_public_trades`).
>
> ⚠️ **Risque data loss** : `pre_trade_checks` est **member-authored**
> (instrument closed 4 enums + 2 booleans, ~30s par check). À 30 membres
> × ~1 check/jour cible ADR-003 = ~30 rows/jour cumulés. Closed instrument
> ⇒ pas de PII texte libre (just enum values), mais c'est de la donnée
> réflexive du membre (RGPD member-authored). `pg_dump --data-only`
> atomique de la table AVANT est OBLIGATOIRE.
>
> **Surface impactée** : `/pre-trade/new` (host wizard) deviendra 500 ou
> compile-time error post-rollback car le Server Action
> `submitPreTradeCheckAction` (`app/pre-trade/actions.ts`) référence
> `db.preTradeCheck.create`. Le Card trigger `/dashboard` + Banner trigger
> `/journal/new` linkent toujours vers `/pre-trade/new` mais la cible
> sera 500. Mitigation : re-deploy l'image pré-V2.3 (sha < `602787c`)
> qui n'a pas les chemins V2.3 wired. Le wire `linkRecentCheckToTrade`
> dans `journal/actions.ts:createTradeAction`/`closeTradeAction` est en
> try/catch best-effort → un schema DB sans `pre_trade_checks` fera
> throw `P2021 (table does not exist)` mais ne cassera PAS le trade flow
> (catch silencieux, log Sentry warning).
>
> **Indépendant de §15-§21** : 0 FK croisée. Si plusieurs rollbacks sont
> nécessaires, l'ordre inverse de l'apply continue d'appliquer (§22 → §21
> → §20 → … → §15).

### 22.1 Pré-requis — quiesce

Stop le web pour qu'aucun nouveau PreTradeCheck ne soit créé pendant le
DROP, et qu'aucun trade ne tente un auto-link :

```bash
docker compose -f /opt/fxmily/docker-compose.prod.yml stop web
```

Vérifie l'état Prisma :

```bash
docker compose -f /opt/fxmily/docker-compose.prod.yml exec -T postgres \
  psql -U fxmily -d fxmily -c "SELECT migration_name, finished_at \
    FROM _prisma_migrations WHERE migration_name LIKE '%v2_3_pre_trade_check%' \
    ORDER BY started_at DESC;"
```

### 22.2 Backup `pre_trade_checks`

```bash
TS=$(date -u +%Y%m%dT%H%M%SZ)
docker compose -f /opt/fxmily/docker-compose.prod.yml exec -T postgres \
  pg_dump -U fxmily -d fxmily \
  -t pre_trade_checks \
  --data-only --column-inserts \
  | gzip > "/etc/fxmily/backups/pre-v2-3-rollback-pre-trade-checks-${TS}.sql.gz"
```

> Conservé 30j R2 (lifecycle `caddy/` carbone) + 7j local (`fxmily-backup`
> rotation). Les données réflexives membre (4 enums + 2 booleans par
> check) sont member-authored RGPD — le backup permet de restorer
> intégralement si la migration est ré-appliquée plus tard.

### 22.3 SQL rollback — DROP TABLE + DROP TYPES dans un seul BEGIN/COMMIT

Ordre obligatoire : table d'abord (sinon `cannot drop type because other
objects depend on it`) puis les 2 enums :

```sql
BEGIN;
DROP TABLE IF EXISTS "pre_trade_checks";
DROP TYPE IF EXISTS "PreTradeEmotion";
DROP TYPE IF EXISTS "PreTradeReason";
DELETE FROM "_prisma_migrations"
  WHERE migration_name = '20260526100000_v2_3_pre_trade_check';
COMMIT;
```

> Postgres rollback automatique si une étape échoue (cohérence garantie).
> Note : `audit_logs.action='pre_trade_check.created'` rows sont
> **conservées** (logs immuables par design, frozen historical). Le slug
> reste dans le union type `AuditAction` TypeScript du code re-déployé
> pré-V2.3 (si le code ne sait pas générer ce slug, les rows existantes
> restent valides — l'union est input-validation côté serveur, pas une
> contrainte DB).

### 22.4 Re-déploiement de l'image pré-V2.3

```bash
export FXMILY_IMAGE=ghcr.io/<owner>/fxmily:<pre-v2-3-sha>
# Le pré-V2.3 sha le plus récent = 6f993ea (PR #177 V1.12 P8 T5 SUPERSEDED).
# Si V2.3.1 polish hardening (PR #179 3404e29) doit aussi être rollé,
# pré-V2.3 = pré-V2.3.1 (3404e29 est sur top de 602787c).
docker compose -f /opt/fxmily/docker-compose.prod.yml pull web
docker compose -f /opt/fxmily/docker-compose.prod.yml up -d --remove-orphans web
```

### 22.5 Vérification post-rollback

```bash
curl -fsS https://app.fxmilyapp.com/api/health   # 200 attendu

docker compose -f /opt/fxmily/docker-compose.prod.yml exec -T postgres \
  psql -U fxmily -d fxmily -c "\dt pre_trade_checks"
# Attendu : "Did not find any relations" (table absente)

docker compose -f /opt/fxmily/docker-compose.prod.yml exec -T postgres \
  psql -U fxmily -d fxmily -c \
  "SELECT typname FROM pg_type WHERE typname IN \
   ('PreTradeReason', 'PreTradeEmotion');"
# Attendu : 0 rows (types absents)

curl -sI https://app.fxmilyapp.com/pre-trade/new
# Attendu : HTTP/2 404 (route absente sur pré-V2.3 image)

# Audit log : consigne le rollback honnête counters.
docker compose -f /opt/fxmily/docker-compose.prod.yml exec -T postgres \
  psql -U fxmily -d fxmily -c "INSERT INTO audit_logs (action, metadata, created_at) \
    VALUES ('ops.migration.rolled_back', \
      '{\"migration\":\"v2_3_pre_trade_check\",\"by\":\"eliot\",\"data_loss_pre_trade_checks\":N}'::jsonb, \
      NOW());"
```

### 22.6 Re-application future

1. Re-deploy l'image V2.3+ HEAD (sha >= `602787c` ou V2.3.1 `3404e29`).
2. `docker compose -f /opt/fxmily/docker-compose.prod.yml run --rm web \
pnpm --filter @fxmily/web prisma:migrate deploy` (rejoue la migration).
3. **Restore** depuis `pg_dump` step 22.2 si on veut préserver les rows
   PreTradeCheck capturées avant rollback :

   ```bash
   gunzip -c /etc/fxmily/backups/pre-v2-3-rollback-pre-trade-checks-<TS>.sql.gz \
     | docker compose -f /opt/fxmily/docker-compose.prod.yml exec -T postgres \
         psql -U fxmily -d fxmily
   ```

4. **Alternative** : laisser fresh (perd les checks réflexifs captured —
   acceptable car données enum-only sans PII, le membre re-fillera les
   wizards futurs).

## 23. Rollback V2.4 onboarding interview migration (`20260527170000_v2_4_onboarding_interview`)

> **Migration** shipped PR [#189](https://github.com/fxeliott/fxmily/pull/189) `6fb410f` 2026-05-27.
> **Objets DB** : 1 enum (`InterviewStatus` : `started`/`in_progress`/`completed`) + 3 tables (`onboarding_interviews` + `onboarding_interview_answers` + `member_profiles`) + 5 FK cascade User delete (RGPD §17) + 2 FK cascade Interview delete + 5 UNIQUE constraints + 4 indexes.
> **V2.4 Phase A.2 + B + C n'ont AJOUTÉ AUCUNE migration** (pur pipeline batch local + frontend wizard + admin tab) → §23 = unique rollback DB pour tout le cycle V2.4.
>
> **Indépendant de §15-§22** : 0 FK croisée vers les autres tables de migration. Seules FK = `users` cascade User delete. Si plusieurs rollbacks nécessaires, l'ordre inverse de l'apply continue (§23 → §22 → §21 → § …).

### 23.1 Pré-requis — quiesce

Stop le web pour qu'aucun nouveau interview answer ne soit créé pendant le
DROP, et qu'aucun batch local Claude pipeline ne tente un INSERT MemberProfile :

```bash
docker compose -f /opt/fxmily/docker-compose.prod.yml stop web
```

### 23.2 pg_dump SÉLECTIF des 3 tables AVANT rollback (data-loss critical)

Si des membres ont déjà rempli des interviews :

```bash
TS=$(date -u +%Y%m%dT%H%M%SZ)
docker compose -f /opt/fxmily/docker-compose.prod.yml exec -T postgres \
  pg_dump -U fxmily fxmily \
  --table=onboarding_interviews \
  --table=onboarding_interview_answers \
  --table=member_profiles \
  --column-inserts --no-owner --no-acl \
  | gzip > /etc/fxmily/backups/pre-v2-4-rollback-onboarding-${TS}.sql.gz
```

Compter les rows pré-rollback pour audit honnête :

```bash
docker compose -f /opt/fxmily/docker-compose.prod.yml exec -T postgres \
  psql -U fxmily -d fxmily -c '
    SELECT (SELECT COUNT(*) FROM onboarding_interviews) AS interviews,
           (SELECT COUNT(*) FROM onboarding_interview_answers) AS answers,
           (SELECT COUNT(*) FROM member_profiles) AS profiles;'
```

### 23.3 Procédure SQL (BEGIN/COMMIT atomic, ordre FK-correct)

```sql
BEGIN;

-- 1. Drop tables dans l'ordre inverse des FK :
--    member_profiles (FK userId + interviewId) → onboarding_interview_answers
--    (FK userId + interviewId) → onboarding_interviews (parent)
DROP TABLE IF EXISTS "member_profiles" CASCADE;
DROP TABLE IF EXISTS "onboarding_interview_answers" CASCADE;
DROP TABLE IF EXISTS "onboarding_interviews" CASCADE;

-- 2. Drop l'enum (V2.4 = unique consumer)
DROP TYPE IF EXISTS "InterviewStatus";

-- 3. Marquer la migration rolled-back dans _prisma_migrations (DELETE row
--    complète, pas UPDATE — sinon `prisma migrate status` rapporte un drift)
DELETE FROM "_prisma_migrations"
WHERE "migration_name" = '20260527170000_v2_4_onboarding_interview';

COMMIT;
```

### 23.4 Re-deploy image pré-V2.4

**Critical** : re-déployer une image qui ne référence PAS V2.4 (ni `service.ts` `OnboardingInterview` query, ni les `/onboarding/interview/*` routes, ni `/profile`, ni `/admin/members/[id]?tab=profile` Phase C). Reset HEAD au commit avant `6fb410f` = `4c18d9a` chore drift-resync EE→II.

```bash
docker compose -f /opt/fxmily/docker-compose.prod.yml pull web
docker compose -f /opt/fxmily/docker-compose.prod.yml up -d web
curl -fsS https://app.fxmilyapp.com/api/health
```

### 23.5 Audit

```sql
INSERT INTO audit_logs (action, metadata) VALUES (
  'ops.migration.rolled_back',
  '{"migration":"20260527170000_v2_4_onboarding_interview",
    "rows_lost_interviews":<I>,
    "rows_lost_answers":<A>,
    "rows_lost_profiles":<P>,
    "rolled_back_at":"<ISO>",
    "operator":"<eliot>"}'::jsonb
);
```

### 23.6 Re-application future

```bash
# 1. Re-deploy image V2.4 LIVE (post-#189) :
git checkout <ref-with-v2.4>
docker compose -f /opt/fxmily/docker-compose.prod.yml pull web
docker compose -f /opt/fxmily/docker-compose.prod.yml up -d web

# 2. Re-apply migration :
docker compose -f /opt/fxmily/docker-compose.prod.yml run --rm web \
  pnpm --filter @fxmily/web prisma:migrate deploy

# 3. Restore data sélectif (si interviews préservées via pg_dump 23.2) :
gunzip -c /etc/fxmily/backups/pre-v2-4-rollback-onboarding-<TS>.sql.gz \
  | docker compose -f /opt/fxmily/docker-compose.prod.yml exec -T postgres \
      psql -U fxmily -d fxmily

# 4. Vérifier integrité :
psql -c 'SELECT COUNT(*) FROM onboarding_interviews;'
psql -c 'SELECT * FROM member_profiles LIMIT 3;'
```

### 23.7 ⚠️ V2.4 Phase A.2 + B + C cascade fonctionnelle

Rollback §23 supprime les 3 tables = casse :

- **Phase A.2 batch local Claude pipeline** (`batch.ts` référence `onboarding_interview` + `member_profile`)
- **Phase B wizard** (`/onboarding/interview/{,new,complete}` + `/profile` retourneront 500)
- **Phase C admin tab** (`?tab=profile` render error sur lookup `getProfileForUser`)

C'est attendu — V2.4 est un cycle complet, le rollback DB d'une partie casse tout.

**Recommandation forte** : rollback V2.4 **uniquement** en cas de bug critique data-corrupting (e.g. crisis routing skip-persist défaillant qui exposerait du contenu sensible, ou amf_violation regex laxe). Pour bugs UI Phase B/C ou bug pipeline Phase A.2, préférer un **rollback code-only** (revert PR sur main + re-deploy) sans toucher au schéma DB.

## 24. Rollback §26 calendrier adaptatif migration (`20260603120000_calendar_questionnaire`)

> **Migration** shipped jalon J-C1 (data layer backend-first) 2026-06-03.
> **Objets DB** : 2 enums (`CalendarSlot` : `morning`/`afternoon`/`evening` ; `CalendarBlockCategory` : `live_trading`/`backtest`/`mark_douglas_review`/`checkin`/`rest`/`meeting`/`free`) + 2 tables (`weekly_schedule_questionnaires` + `adaptive_calendars`) + 2 FK cascade User delete (RGPD §17) + 2 UNIQUE `(user_id, week_start)` + 3 indexes.
> **ADD-only** : 0 changement sur table/colonne existante. Tables NEUVES → en J-C1 elles sont vides (aucun batch réel lancé) ; data-loss possible seulement si des membres ont déjà rempli des questionnaires (J-C3 mergé) ou si des calendriers ont été générés (J-C2 mergé).
>
> **Indépendant de §15-§23** : 0 FK croisée vers les autres tables de migration. Seules FK = `users` cascade User delete. `adaptive_calendars` n'a AUCUNE FK vers `weekly_schedule_questionnaires` (snapshot-at-generation découplé, ADR-005) → les 2 tables se droppent dans n'importe quel ordre.

### 24.1 Pré-requis — quiesce

Stop le web pour qu'aucun nouveau questionnaire ne soit upserté et qu'aucun
batch local Claude calendar ne tente un INSERT AdaptiveCalendar pendant le DROP :

```bash
docker compose -f /opt/fxmily/docker-compose.prod.yml stop web
```

### 24.2 pg_dump SÉLECTIF des 2 tables AVANT rollback (data-loss si peuplées)

Inutile en J-C1 (tables vides). Requis si J-C2/J-C3 mergés et des membres ont rempli/généré :

```bash
TS=$(date -u +%Y%m%dT%H%M%SZ)
docker compose -f /opt/fxmily/docker-compose.prod.yml exec -T postgres \
  pg_dump -U fxmily fxmily \
  --table=weekly_schedule_questionnaires \
  --table=adaptive_calendars \
  --column-inserts --no-owner --no-acl \
  | gzip > /etc/fxmily/backups/pre-calendar-rollback-${TS}.sql.gz
```

Compter les rows pré-rollback pour audit honnête :

```bash
docker compose -f /opt/fxmily/docker-compose.prod.yml exec -T postgres \
  psql -U fxmily -d fxmily -c '
    SELECT (SELECT COUNT(*) FROM weekly_schedule_questionnaires) AS questionnaires,
           (SELECT COUNT(*) FROM adaptive_calendars) AS calendars;'
```

### 24.3 Procédure SQL (BEGIN/COMMIT atomic, tables avant types)

```sql
BEGIN;

-- 1. Drop les 2 tables (pas de FK croisée entre elles — ordre libre).
DROP TABLE IF EXISTS "adaptive_calendars" CASCADE;
DROP TABLE IF EXISTS "weekly_schedule_questionnaires" CASCADE;

-- 2. Drop les 2 enums APRÈS les tables (Postgres refuse de drop un type
--    encore référencé par une colonne — ordre non négociable).
DROP TYPE IF EXISTS "CalendarBlockCategory";
DROP TYPE IF EXISTS "CalendarSlot";

-- 3. Marquer la migration rolled-back dans _prisma_migrations (DELETE row
--    complète, pas UPDATE — sinon `prisma migrate status` rapporte un drift).
DELETE FROM "_prisma_migrations"
WHERE "migration_name" = '20260603120000_calendar_questionnaire';

COMMIT;
```

### 24.4 Re-deploy image pré-§26

Re-déployer une image qui ne référence PAS le calendrier (ni `lib/calendar/service.ts`
`db.weeklyScheduleQuestionnaire` / `db.adaptiveCalendar`, ni — une fois mergées — les
routes `/calendrier` / `/api/admin/calendar-batch/*`). Reset HEAD au commit avant la
PR J-C1.

```bash
docker compose -f /opt/fxmily/docker-compose.prod.yml pull web
docker compose -f /opt/fxmily/docker-compose.prod.yml up -d web
curl -fsS https://app.fxmilyapp.com/api/health
```

### 24.5 Audit

```sql
INSERT INTO audit_logs (action, metadata) VALUES (
  'ops.migration.rolled_back',
  '{"migration":"20260603120000_calendar_questionnaire",
    "rows_lost_questionnaires":<Q>,
    "rows_lost_calendars":<C>,
    "rolled_back_at":"<ISO>",
    "operator":"<eliot>"}'::jsonb
);
```

### 24.6 Re-application future

```bash
# 1. Re-deploy image avec §26 LIVE :
git checkout <ref-with-calendar>
docker compose -f /opt/fxmily/docker-compose.prod.yml pull web
docker compose -f /opt/fxmily/docker-compose.prod.yml up -d web

# 2. Re-apply migration :
docker compose -f /opt/fxmily/docker-compose.prod.yml run --rm web \
  pnpm --filter @fxmily/web prisma:migrate deploy

# 3. Restore data sélectif (si questionnaires/calendriers préservés via 24.2) :
gunzip -c /etc/fxmily/backups/pre-calendar-rollback-<TS>.sql.gz \
  | docker compose -f /opt/fxmily/docker-compose.prod.yml exec -T postgres \
      psql -U fxmily -d fxmily

# 4. Vérifier intégrité :
psql -c 'SELECT COUNT(*) FROM weekly_schedule_questionnaires;'
psql -c 'SELECT COUNT(*) FROM adaptive_calendars;'
```

### 24.7 ⚠️ Recommandation

En J-C1, le calendrier est **data-layer only** (0 UI, 0 batch réel). Un rollback DB est
quasiment sans conséquence fonctionnelle (aucune route ne consomme encore ces tables).
Une fois J-C2→J-C4 mergés, préférer un **rollback code-only** (revert PR + re-deploy) pour
tout bug UI/pipeline ; ne droper le schéma qu'en cas de bug critique data-corrupting.

## Note transversale — pattern rollback Fxmily

Toutes les recipes §11-§23 suivent un même contrat :

1. **pg_dump atomique AVANT** (data-only + column-inserts pour idempotency).
2. **`docker compose stop web`** (fige les writes, évite la corruption
   pendant le DROP).
3. **SQL rollback dans une transaction `BEGIN`/`COMMIT`** (tout ou rien
   Postgres — pas d'état intermédiaire).
4. **`DELETE FROM _prisma_migrations`** pour que Prisma re-applique
   proprement à la prochaine `migrate deploy`.
5. **Re-deploy l'image pré-migration** (sinon le code applicatif crash sur
   les colonnes/tables absentes au runtime).
6. **Audit log row `ops.migration.rolled_back`** avec metadata `migration`
   - `by` + counters `data_loss_*` honnêtes.
7. **Re-application future** : re-deploy l'image post-migration +
   `prisma:migrate deploy` + restore data si pertinent.

> **Exceptions §17 + §19 + §20** — `20260517170000_v1_2_training_annotation_
notification` (§17), `20260519150000_v1_4_monthly_debrief` (§19) ET
> `20260519170000_v1_5_mindset_check` (§20) ne suivent PAS le point 3 :
> PostgreSQL n'a pas d'`ALTER TYPE … DROP VALUE`, donc le rollback de la
> partie enum est une **procédure manuelle de reconstruction du type**
> (RENAME → CREATE → `ALTER COLUMN` ×2 → DROP old), pas un simple
> `BEGIN/COMMIT`-revert. §19 ET §20 combinent en plus un `DROP TABLE`
> (`monthly_debriefs` / `mindset_checks`) dans la même transaction (enum +
> table) ; §20 est le 2ᵉ enum-rebuild consécutif → son `CREATE TYPE` repart
> du jeu 7 valeurs post-§25. Les points 1/2/4/6/7 s'appliquent quand même.
> Voir §17 / §19 / §20.
>
> **Ordre de rollback multi-migrations** — les **9 sections** de migration
> (#108 `v2_1_admin_notes` §15 + #110 `v1_2_training_entities` §16 + #112
> `v1_2_training_annotation_notification` §17 + #132 `v1_3_training_debrief`
> §18 + #135 `v1_4_monthly_debrief` §19 + #137 `v1_5_mindset_check` §20 +
> #151 `t5_track_record_public_trades` §21 + #178 `v2_3_pre_trade_check` §22
>
> - #189 `v2_4_onboarding_interview` §23) sont des objets **indépendants**
>   (un rollback partiel d'un seul est valide ; `mindset_checks` /
>   `monthly_debriefs` / `training_debriefs` / `public_trades` /
>   `pre_trade_checks` / `onboarding_interviews` n'ont aucune FK croisée —
>   seulement vers `users`, sauf `public_trades` qui est admin-authored et ne
>   référence aucun user, et `pre_trade_checks.linkedTradeId String?` qui
>   est intentionnellement SANS FK vers `trades`). Pour un rollback
>   **complet**, procéder en **ordre inverse de l'apply** (timestamp
>   décroissant) : §23 → §22 → §21 → §20 → §19 → §18 → §17 → §16 → §15,
>   pour garder `_prisma_migrations` cohérent.

Le pattern est testé annuellement via le DR test §`runbook-backup-restore.md`
"Test de DR (annuel, ~30 min)" — qui simule un restore complet sur une 2e
VM Hetzner CX22.
