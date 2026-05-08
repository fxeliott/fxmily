# Jalon 10 — Prod hardening : RGPD + Sentry + Hetzner deploy + domaine + 1ère invitation prod

> Préparation rédigée 2026-05-08 (post-J8 polish), mise à jour 2026-05-08 (J9 livré). Démarrer dans une nouvelle session avec `/clear` (SPEC §18.4).
>
> **Mise à jour J9 livré** : commits `3d8a93c` (foundation+UI+dispatcher+smoke) + `6348ad7` (5-subagent hardening 6 BLOCKERs + 4 HIGH closed) sur branche `claude/j9-web-push-notifications`. Vitest 617/617 verts, smoke live ALL GREEN (mock client path). Migration `20260508180000_j9_push_subscription` appliquée. À ajouter au scope J10 :
>
> - Hetzner crontab `*/2 * * * *` UTC `dispatch-notifications` (cf. §6.4 ligne 269 déjà listé).
> - Cron `0 5 * * 0` UTC RGPD purge subscriptions inactives 90j (`lastSeenAt < now - 90d`) + audit row.
> - Endpoint URL allowlist FCM/APNs/Mozilla/Windows dans `pushSubscriptionInputSchema` (anti-SSRF amplifier).
> - Email fallback Resend après 3 attempts dispatch failed (SPEC §18.2 mitigation iOS push fragility).
> - Sentry capture sur `lib/push/dispatcher.ts:dispatchOne` catch + cron route.

## 1. Critère SPEC §15 J10 "Done quand" (verbatim)

> "L'app est en prod sur app.fxmily.com, Eliot peut s'inviter et tester end-to-end."

## 2. Scope J10 (SPEC §15 — 5 axes)

| Axe                      | Tasks                                                                                                                                                                                                                                                      |
| ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **RGPD**                 | Pages legal (privacy, terms, mentions), bandeau cookie info (light, no tracker), export data JSON, suppression compte (soft delete + cron purge 30j)                                                                                                       |
| **Sentry**               | Integration client + server, source maps upload, breadcrumbs `lib/scoring/scheduler.ts` + cron catches, env `SENTRY_DSN` + `SENTRY_AUTH_TOKEN`                                                                                                             |
| **Hetzner**              | Setup Cloud CX22 (~5€/mois), Docker Compose + Caddy + Let's Encrypt + cron jobs (5 routes : checkin-reminders, recompute-scores, dispatch-douglas, weekly-reports, dispatch-notifications J9), backups pg_dump + R2 cross-région, secret rotation playbook |
| **Domaine**              | Achat `fxmily.com` Cloudflare Registrar (~10€/an), DNS `app.fxmily.com` → Hetzner IP, Resend domain verify, email business `eliott@fxmily.com` ou `noreply@fxmily.com`                                                                                     |
| **1ère invitation prod** | Eliot s'invite lui-même, valide flow complet end-to-end (invitation → onboarding → trade → checkin → score → fiche Douglas → email digest → push notification)                                                                                             |

## 3. Décisions à trancher AVEC Eliot avant J10

- **Domaine final** : `fxmily.com` (préféré par SPEC) vs alternative ?
- **Email business** : `eliot@fxmily.com` vs `noreply@fxmily.com` vs `eliott.pena@fxmily.com` (homogénéité avec compte Resend actuel `eliott.pena@icloud.com`).
- **Cookie banner copy** : posture athlète (factuel "Cookie technique uniquement, aucun tracker") vs RGPD-conforming standard.
- **RGPD privacy policy** : rédaction custom by Eliot vs template iubenda/Privacy Policies adapté.
- **Sentry plan** : Free 5000 erreurs/mois (estimé suffisant à 30 membres) vs Team $26/mois si > 5000.
- **Backups frequency** : daily 02:30 UTC pg_dump (post score recompute) vs hourly snapshot R2 ?
- **Disaster recovery RTO/RPO** : objectif 24h (acceptable cohorte privée) vs 1h ?

## 4. RGPD — Implementation détaillée

### 4.1 Pages légales (3 routes Server Components)

- `/legal/privacy` (Politique de confidentialité)
- `/legal/terms` (CGU)
- `/legal/mentions` (Mentions légales)

Footer global wired dans `app/layout.tsx` ou per-page selon design DS-v2.

### 4.2 Cookie banner

Pas de tracker tiers V1 (SPEC §16). Banner = info technique uniquement :

```tsx
<CookieInfo>
  <p>
    Fxmily n'utilise que des cookies techniques nécessaires au login (Auth.js JWT). Aucun tracker,
    aucune analytics tierce, aucun pixel publicitaire.
  </p>
</CookieInfo>
```

Stocker dismiss state dans `localStorage` `fxmily.cookie.dismissed=1`. Pas besoin de consent management standard puisque pas de tracker.

### 4.3 Export données — endpoint `/api/account/export`

```ts
// Server Action ou API route
export async function exportMyData(userId: string): Promise<Blob> {
  const data = {
    user: await db.user.findUnique({ where: { id: userId } }),
    trades: await db.trade.findMany({ where: { userId } }),
    annotations: await db.tradeAnnotation.findMany({ where: { trade: { userId } } }),
    checkins: await db.dailyCheckin.findMany({ where: { userId } }),
    scores: await db.behavioralScore.findMany({ where: { userId } }),
    deliveries: await db.markDouglasDelivery.findMany({ where: { userId } }),
    favorites: await db.markDouglasFavorite.findMany({ where: { userId } }),
    weeklyReports: await db.weeklyReport.findMany({ where: { userId } }),
    pushSubscriptions: await db.pushSubscription.findMany({ where: { userId } }),
    auditLogs: await db.auditLog.findMany({ where: { userId } }),
  };
  return new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
}
```

UI : `/account/data` page avec bouton "Télécharger mes données (JSON)". Audit `account.data.exported` row.

### 4.4 Suppression compte — soft-delete + cron purge

```sql
-- Soft delete : status = 'deleted' + scrub PII partiel immédiat
UPDATE users
SET status = 'deleted',
    email = CONCAT('deleted-', id, '@fxmily.local'),
    first_name = NULL,
    last_name = NULL,
    image = NULL,
    push_subscription = NULL,
    deleted_at = NOW()
WHERE id = $userId;

-- Cron purge 30j : DELETE complet (cascade prend toute la data user-scoped)
DELETE FROM users
WHERE status = 'deleted'
  AND deleted_at < NOW() - INTERVAL '30 days';
```

Cron `0 3 * * *` UTC `/api/cron/purge-deleted`. Pattern carbone J5/J6/J7/J8.

UI : `/account/delete` page avec confirmation double + countdown 24h (anti-impulsivité).

### 4.5 Audit RGPD

Actions à ajouter `lib/auth/audit.ts` :

- `account.data.exported`
- `account.deletion.requested`
- `account.deletion.purged` (cron)
- `cron.purge_deleted.scan`

## 5. Sentry — Integration

### 5.1 Setup Next.js 16

```bash
pnpm --filter @fxmily/web add @sentry/nextjs
pnpm --filter @fxmily/web exec npx @sentry/wizard@latest -i nextjs
```

Wizard génère :

- `sentry.client.config.ts`
- `sentry.server.config.ts`
- `sentry.edge.config.ts`
- `next.config.ts` wrapping via `withSentryConfig`

### 5.2 Env additions

```ts
SENTRY_DSN: z.string().url().optional(),
SENTRY_AUTH_TOKEN: z.string().optional(),
NEXT_PUBLIC_SENTRY_DSN: z.string().url().optional(),
```

### 5.3 Breadcrumbs ciblés

- `lib/scoring/scheduler.ts` — capture exception sur `recomputeAndPersist` failed
- `lib/cards/scheduler.ts` — capture sur dispatch failed
- `lib/weekly-report/service.ts` — capture sur generate failed (cron context)
- `lib/push/dispatcher.ts` (J9) — capture sur push failed > 3 attempts
- All `/api/cron/*/route.ts` catch blocks

### 5.4 Source maps upload

CI workflow `.github/workflows/ci.yml` ajoute step :

```yaml
- name: Upload Sentry source maps
  if: github.ref == 'refs/heads/main'
  run: pnpm --filter @fxmily/web exec sentry-cli sourcemaps upload .next
  env:
    SENTRY_AUTH_TOKEN: ${{ secrets.SENTRY_AUTH_TOKEN }}
```

## 6. Hetzner Cloud — Deploy

### 6.1 Provisioning (1× setup)

```bash
# Hetzner Cloud Console
# 1. Create CX22 (Falkenstein UE, Ubuntu 24.04 LTS)
# 2. Add SSH key (Eliot's public key from ~/.ssh/id_ed25519.pub)
# 3. Network : ipv4 + ipv6, public

# Sur le serveur fresh
ssh fxmily@<IP>
sudo apt update && sudo apt upgrade -y
sudo apt install -y docker.io docker-compose-v2 ufw certbot
sudo ufw allow OpenSSH
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw enable
sudo usermod -aG docker fxmily
```

### 6.2 docker-compose.prod.yml

```yaml
services:
  postgres:
    image: postgres:17-alpine
    restart: unless-stopped
    environment:
      POSTGRES_USER: fxmily
      POSTGRES_DB: fxmily
      POSTGRES_PASSWORD_FILE: /run/secrets/postgres_password
    volumes:
      - postgres_data:/var/lib/postgresql/data
      - /etc/fxmily/backups:/backups
    secrets:
      - postgres_password
    healthcheck:
      test: ['CMD-SHELL', 'pg_isready -U fxmily']
      interval: 10s

  web:
    image: ghcr.io/fxeliott/fxmily:latest
    restart: unless-stopped
    env_file: /etc/fxmily/web.env
    depends_on:
      postgres:
        condition: service_healthy
    expose:
      - '3000'

  caddy:
    image: caddy:2-alpine
    restart: unless-stopped
    ports:
      - '80:80'
      - '443:443'
    volumes:
      - ./Caddyfile:/etc/caddy/Caddyfile
      - caddy_data:/data
      - caddy_config:/config
    depends_on:
      - web

volumes:
  postgres_data:
  caddy_data:
  caddy_config:

secrets:
  postgres_password:
    file: /etc/fxmily/postgres_password
```

### 6.3 Caddyfile

```
app.fxmily.com {
    reverse_proxy web:3000
    header {
        Strict-Transport-Security "max-age=63072000"
        X-Frame-Options DENY
        X-Content-Type-Options nosniff
        Referrer-Policy strict-origin-when-cross-origin
    }
    encode gzip zstd
    log {
        output file /var/log/caddy/fxmily.log {
            roll_size 100mb
            roll_keep 7
        }
    }
}
```

### 6.4 Cron jobs Hetzner — `/etc/cron.d/fxmily`

```cron
# /etc/cron.d/fxmily — Fxmily cron jobs (V1)
# All routes use POST + X-Cron-Secret SHA-256 timingSafeEqual.
SHELL=/bin/bash
PATH=/usr/local/bin:/usr/bin:/bin

# Check-in reminders — every 15 min between 7-9 AM UTC + 8-10 PM UTC
0,15,30,45 7-8,20-21 * * *  fxmily  /usr/local/bin/fxmily-cron checkin-reminders

# Behavioral scores — nightly 02:00 UTC
0 2 * * *                   fxmily  /usr/local/bin/fxmily-cron recompute-scores

# Mark Douglas dispatch — every 6h
0 0,6,12,18 * * *           fxmily  /usr/local/bin/fxmily-cron dispatch-douglas

# Weekly AI report — Sunday 21:00 UTC (J8)
0 21 * * 0                  fxmily  /usr/local/bin/fxmily-cron weekly-reports

# Push notifications dispatcher — every 2 min (J9)
*/2 * * * *                 fxmily  /usr/local/bin/fxmily-cron dispatch-notifications

# RGPD purge soft-deleted users 30j — daily 03:00 UTC (J10)
0 3 * * *                   fxmily  /usr/local/bin/fxmily-cron purge-deleted

# Postgres backup — daily 02:30 UTC (after score recompute)
30 2 * * *                  fxmily  /usr/local/bin/fxmily-backup
```

Wrapper script `/usr/local/bin/fxmily-cron` (carbone J6 runbook) :

```bash
#!/usr/bin/env bash
set -euo pipefail
ROUTE="$1"
source /etc/fxmily/cron.env  # CRON_SECRET, APP_URL
exec curl -fsS --max-time 600 -X POST \
  -H "X-Cron-Secret: $CRON_SECRET" \
  "$APP_URL/api/cron/$ROUTE" >> /var/log/fxmily/cron.log 2>&1
```

### 6.5 Backups pg_dump + R2 cross-région

Wrapper script `/usr/local/bin/fxmily-backup` :

```bash
#!/usr/bin/env bash
set -euo pipefail
TS=$(date -u +%Y%m%d-%H%M)
BACKUP_DIR=/etc/fxmily/backups
DUMP_FILE="$BACKUP_DIR/fxmily-$TS.sql.gz"

# Dump from container
docker compose -f /opt/fxmily/docker-compose.prod.yml exec -T postgres \
  pg_dump -U fxmily fxmily | gzip > "$DUMP_FILE"

# Encrypt + upload to R2 (US east — cross-region from EU Hetzner)
gpg --cipher-algo AES256 --symmetric --batch --yes \
  --passphrase-file /etc/fxmily/gpg.pass "$DUMP_FILE"

aws s3 cp "$DUMP_FILE.gpg" "s3://fxmily-backups/$TS.sql.gz.gpg" \
  --endpoint-url "$R2_ENDPOINT" --no-progress

# Local retention 7 days
find "$BACKUP_DIR" -name 'fxmily-*.sql.gz' -mtime +7 -delete
find "$BACKUP_DIR" -name 'fxmily-*.sql.gz.gpg' -mtime +7 -delete

# R2 retention 30 days (lifecycle policy R2 side)
```

### 6.6 Deploy workflow GitHub Actions

```yaml
# .github/workflows/deploy.yml
name: Deploy
on:
  push:
    branches: [main]
jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v6
      - name: Build + push Docker image
        run: |
          docker build -t ghcr.io/fxeliott/fxmily:${{ github.sha }} -f apps/web/Dockerfile .
          docker push ghcr.io/fxeliott/fxmily:${{ github.sha }}
          docker tag ghcr.io/fxeliott/fxmily:${{ github.sha }} ghcr.io/fxeliott/fxmily:latest
          docker push ghcr.io/fxeliott/fxmily:latest
      - name: SSH deploy to Hetzner
        uses: appleboy/ssh-action@v1
        with:
          host: ${{ secrets.HETZNER_HOST }}
          username: fxmily
          key: ${{ secrets.HETZNER_SSH_KEY }}
          script: |
            cd /opt/fxmily
            docker compose pull
            docker compose up -d
            docker compose exec -T web pnpm --filter @fxmily/web prisma:migrate:deploy
            docker image prune -f
```

## 7. Domaine fxmily.com

### 7.1 Achat (Eliot, ~10€/an)

1. Cloudflare Registrar (https://dash.cloudflare.com/?to=/:account/registrar)
2. Search `fxmily.com` (vérifier disponibilité avant J10).
3. Acheter — auto-renew ON.

### 7.2 DNS Cloudflare

| Type | Name               | Content                                               | Proxied                     |
| ---- | ------------------ | ----------------------------------------------------- | --------------------------- |
| A    | app                | <Hetzner IP>                                          | NO (HTTPS direct via Caddy) |
| MX   | @                  | route via Resend (10 mx1.resend.com, 20 mx2)          | NO                          |
| TXT  | @                  | `v=spf1 include:_spf.resend.com -all`                 | NO                          |
| TXT  | resend.\_domainkey | `<DKIM record from Resend>`                           | NO                          |
| TXT  | \_dmarc            | `v=DMARC1; p=quarantine; rua=mailto:eliot@fxmily.com` | NO                          |

### 7.3 Resend domain verify

1. Resend Console → Domains → Add `fxmily.com`
2. Copier les 3 TXT records (SPF, DKIM, DMARC) → ajouter dans Cloudflare DNS
3. Resend Console → Verify (peut prendre 24h propagation)
4. Update env Hetzner : `RESEND_FROM=Fxmily <noreply@fxmily.com>`

### 7.4 Update env worktree + prod

```dotenv
AUTH_URL=https://app.fxmily.com
RESEND_FROM=Fxmily <noreply@fxmily.com>
WEEKLY_REPORT_RECIPIENT=eliot@fxmily.com  # ou eliott.pena@fxmily.com
VAPID_SUBJECT=mailto:eliot@fxmily.com  # cohérent avec domain verify
```

## 8. Checklist 1ère invitation prod (Eliot)

1. Login `app.fxmily.com/login` avec mdp admin (rotaté post-J8 polish).
2. `/admin/invite` → email `eliott.pena@icloud.com` (compte personnel test).
3. Recevoir email Resend dans inbox iCloud → cliquer le lien.
4. Onboarding `/onboarding/welcome?token=...` → choisir mdp test ≥14 chars.
5. Redirect `/dashboard` → vérifier UI rendu correct.
6. Test J2 : `/journal/new` → wizard 6 étapes → trade créé.
7. Test J5 : `/checkin/morning` → wizard → DB row.
8. Test J6 : retour `/dashboard` → score widget render (peut être insufficient_data sans 30j data).
9. Test J7 : `/library` → fiches affichées.
10. Test J9 : iPhone Eliot install Fxmily Home Screen + activer notifs → recevoir 1 push.
11. Test J8 : declencher `/api/cron/weekly-reports?dryRun=false` manuellement → recevoir email digest dans inbox iCloud.
12. Test J10 RGPD : `/account/data` → download JSON → vérifier intégrité.

## 9. Risques & mitigations J10

| Risque                                 | Mitigation                                                                      |
| -------------------------------------- | ------------------------------------------------------------------------------- |
| Hetzner panne / data loss              | pg_dump quotidien + R2 cross-région cross-encrypted GPG                         |
| Domain `fxmily.com` indisponible       | Alternative : `fxmily.app`, `fxmily.fr`, `app.fxmily.io` (à choisir avec Eliot) |
| Resend domain verify échoue >24h       | Fallback `onboarding@resend.dev` (déjà utilisé V1 dev) jusqu'à fix DNS          |
| Sentry quota épuisé                    | Plan Team $26/mois si >5000 erreurs/mois — alerter Eliot avant upgrade          |
| iOS push notifications cassent en prod | Fallback email Resend (J9 implémenté)                                           |
| Hetzner cron drift                     | Audit `cron.*.scan` rows : si gap >2h, flag dans `/admin/cron-status` (J10.5)   |

## 10. Pickup prompt J10 (à coller post-`/clear`)

```
Implémente le Jalon 10 du SPEC à `D:\Fxmily\SPEC.md` — Prod hardening
(RGPD + Sentry + Hetzner deploy + domaine + 1ère invitation prod).

Lis dans cet ordre :
1. SPEC §15 J10 + §16 (RGPD) + §17 (déploiement)
2. apps/web/CLAUDE.md sections J0→J9 close-out
3. docs/jalon-10-prep.md — briefing complet 10 sections
4. docs/runbook-cron-recompute-scores.md (carbone Hetzner cron)
5. memory MEMORY.md + fxmily_project.md

Done quand SPEC §15 J10 : l'app est en prod sur app.fxmily.com, Eliot
peut s'inviter et tester end-to-end (J0→J9 happy-path validé real-device).

Stack J10 :
- Hetzner Cloud CX22 (Falkenstein UE) Ubuntu 24.04 LTS
- Docker Compose + Caddy + Let's Encrypt + cron systemd
- Cloudflare Registrar fxmily.com + DNS + Resend domain verify
- @sentry/nextjs (client + server + edge)
- pg_dump quotidien + R2 cross-région (US east) cross-encrypted GPG

Phase A : RGPD pages legal + cookie banner + export JSON + soft-delete +
  cron purge 30j + 4 nouveaux AuditAction.
Phase B : Sentry integration (wizard + breadcrumbs lib/scoring + lib/cards
  + lib/weekly-report + lib/push + cron catches) + source maps CI upload.
Phase C : Docker production image + docker-compose.prod.yml + Caddyfile +
  /etc/fxmily/cron.env + wrapper /usr/local/bin/fxmily-cron + backup wrapper
  fxmily-backup avec pg_dump + R2 GPG.
Phase D : Cloudflare Registrar achat fxmily.com + DNS A/MX/SPF/DKIM/DMARC +
  Resend domain verify + update env worktree + prod.
Phase E : GitHub Actions deploy workflow + Hetzner SSH push + smoke prod.
Phase F : Eliot 1ère invitation end-to-end checklist 12 steps + bug-fix
  any blocker found.
Phase G : Audit-driven hardening 4-5 subagents + smoke prod live + final.

Pattern hybride atomic : back + ops + commits + push branche
`claude/j10-prod-deploy` dans cette session.

Mantra long activé : pleine puissance, autonomie totale, perfection
absolue, control PC OK, anti-hallucination, smoke prod live obligatoire.

Pré-requis Eliot AVANT smoke prod :
1. Hetzner CX22 provisioning + SSH key
2. Cloudflare Registrar + fxmily.com (vérifier dispo + acheter ~10€/an)
3. Resend domain verify (3 TXT records DNS Cloudflare → Resend Console)
4. Sentry compte + DSN
5. iPhone physique pour J9 push real-device test
6. Mdp admin rotaté post-J8 polish
```

## 11. Non-scope J10 (différé V2 / Capacitor)

- Capacitor wrapping App Store/Play Store (V2, 99€/an Apple Developer + 25€ Google).
- Multi-region deployment (V2 scale).
- Read replicas Postgres (V2 si >1000 membres).
- WAF Cloudflare (V2 si traffic public).
- Stripe billing (V2 si formation payante in-app).

## 12. Sources

- [Hetzner Cloud documentation](https://docs.hetzner.com/cloud/)
- [Caddy Server documentation](https://caddyserver.com/docs/)
- [Sentry Next.js guide](https://docs.sentry.io/platforms/javascript/guides/nextjs/)
- [Cloudflare Registrar pricing](https://www.cloudflare.com/products/registrar/)
- [Resend custom domain setup](https://resend.com/docs/dashboard/domains/introduction)
- [Postgres pg_dump backup best practices](https://www.postgresql.org/docs/current/backup-dump.html)
- [Let's Encrypt rate limits](https://letsencrypt.org/docs/rate-limits/)

---

**Fin du briefing J10** — préparé 2026-05-08 post-J8 polish. À valider en début de session J10 (stack peut évoluer Sentry/Hetzner/Cloudflare).
