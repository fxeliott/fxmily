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

## Note transversale — pattern rollback Fxmily

Toutes les recipes §11-§14 suivent un même contrat :

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

Le pattern est testé annuellement via le DR test §`runbook-backup-restore.md`
"Test de DR (annuel, ~30 min)" — qui simule un restore complet sur une 2e
VM Hetzner CX22.
