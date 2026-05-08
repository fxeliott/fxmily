# Runbook — Postgres backup & restore

Couvre le cycle complet : sauvegarde quotidienne, vérification, restore
catastrophique, test annuel de DR (disaster recovery).

## Backup automatique

Wrapper : [`/usr/local/bin/fxmily-backup`](../ops/cron/fxmily-backup) — déclenché
par [`/etc/cron.d/fxmily-app`](../ops/cron/crontab.fxmily) chaque jour à
**02:30 UTC**, juste après `recompute-scores` (02:00) pour que le snapshot
inclue les écritures de la nuit.

Pipeline : `pg_dump --no-owner --no-acl` → `gzip` → `gpg --symmetric AES256` →
`aws s3 cp` vers R2 (cluster US East — cross-région contre une panne UE
chez Hetzner) → rotation locale **7 jours** + rétention R2 **30 jours**
(lifecycle policy bucket).

### Vérifier qu'un backup a bien tourné

```bash
# Dernière ligne du log
tail -5 /var/log/fxmily/cron.log | grep fxmily-backup
# Attendu : `... [fxmily-backup] done`

# Liste R2 (cluster US east)
aws s3 ls s3://fxmily-backups/ \
  --endpoint-url $R2_ENDPOINT \
  --profile fxmily-backup \
  | sort -r | head -3
# Attendu : 3 derniers fichiers `fxmily-YYYYMMDD-HHMM.sql.gz.gpg`
```

### Restore manuel (catastrophique — perte du serveur)

> ⚠️ Ne fait JAMAIS de restore sur la base de prod en cours d'usage.
> Crée toujours une instance Postgres de recovery dédiée.

```bash
# 1. Récupère le dernier backup R2
aws s3 cp s3://fxmily-backups/fxmily-YYYYMMDD-HHMM.sql.gz.gpg . \
  --endpoint-url $R2_ENDPOINT \
  --profile fxmily-backup

# 2. Décrypte
gpg --decrypt --batch --passphrase-file /etc/fxmily/gpg.pass \
  fxmily-YYYYMMDD-HHMM.sql.gz.gpg > fxmily-restore.sql.gz

# 3. Boot une nouvelle instance Postgres (vide) puis :
gunzip -c fxmily-restore.sql.gz | docker compose -f docker-compose.prod.yml \
  exec -T postgres psql -U fxmily fxmily

# 4. Vérifie l'intégrité (4 tables critiques) :
docker compose -f docker-compose.prod.yml exec -T postgres \
  psql -U fxmily fxmily -c \
  "SELECT 'users' as t, count(*) FROM users
   UNION ALL SELECT 'trades', count(*) FROM trades
   UNION ALL SELECT 'daily_checkins', count(*) FROM daily_checkins
   UNION ALL SELECT 'audit_logs', count(*) FROM audit_logs;"
```

Le user `fxmily` doit déjà exister dans la nouvelle instance (option
`--no-owner --no-acl` dans `pg_dump` ⇒ pas de role grant dans le dump).

### Restore sélectif (un seul user RGPD demande sa data)

Le SQL dump est plain-text après décryptage — possibilité de `grep` sur
un user ID :

```bash
# Décrypte vers stdout (ne touche pas le disque)
gpg --decrypt --batch --passphrase-file /etc/fxmily/gpg.pass \
  fxmily-YYYYMMDD-HHMM.sql.gz.gpg | gunzip - \
  | grep "INSERT INTO trades.*'<userId>'" > restore-user.sql
```

Pour un export complet RGPD, l'app fournit déjà `/account/data` (article 20)
— préférer ce path utilisateur quand le compte est encore actif.

## Test de DR (annuel, ~30 min)

À faire 1× par an minimum, au calme.

1. Boot une 2e VM Hetzner CX22 vide (volet "Cloud → Create").
2. Suis [`runbook-hetzner-deploy.md`](runbook-hetzner-deploy.md) §1-2.
3. Au lieu d'installer la stack from scratch, télécharge le dernier R2
   backup et restore-le dans le `postgres` container.
4. Boot Caddy + web pointant vers ce Postgres restauré.
5. Lance `curl https://app.fxmily.invalid/api/health`.
6. Détruis la VM de test (Hetzner facture à la minute).

Documente le RTO mesuré (objectif : < 24h) dans
`docs/dr-test-YYYY.md` après chaque test.

## Rotation de la GPG passphrase

Faire seulement si on suspecte une compromission — la passphrase chiffre
les snapshots historiques, sa rotation rend les anciens illisibles si
on ne re-chiffre pas tout.

```bash
# 1. Génère la nouvelle
NEW=$(openssl rand -base64 32)

# 2. Décrypte chaque backup local + ré-encrypte avec la nouvelle
for f in /etc/fxmily/backups/*.gpg; do
  gpg --decrypt --batch --passphrase-file /etc/fxmily/gpg.pass "$f" \
    | gpg --cipher-algo AES256 --symmetric --batch --yes \
        --passphrase "$NEW" > "${f}.new"
  mv -f "${f}.new" "$f"
done

# 3. Ré-upload vers R2 (cf. fxmily-backup logic)
# 4. Mets à jour la passphrase
echo -n "$NEW" | sudo tee /etc/fxmily/gpg.pass
sudo chmod 600 /etc/fxmily/gpg.pass
```

Pour les snapshots R2 plus anciens : soit on accepte qu'ils deviennent
illisibles (perte d'historique > rotation), soit on télécharge / rechiffre
/ réupload l'ensemble (~30 minutes pour 30 backups × 50 MB chacun).

## R2 lifecycle (rétention 30 jours)

Configuré bucket-side une seule fois (Cloudflare R2 → bucket `fxmily-backups`
→ Lifecycle Rules → "Delete after 30 days"). Si tu changes de provider
plus tard, replique la même règle.
