# Guide pas-à-pas — Mise en prod Fxmily V1 (Eliot)

> **Date** : 2026-05-09 — **post-Phase R reality check**.
> **Cible** : `https://app.fxmilyapp.com` sur ton Hetzner existant `hetzner-dieu` (178.104.39.201).
> **Coût supplémentaire V1** : **0 €** (Hetzner et `fxmilyapp.com` déjà payés).
> **Temps total estimé** : ~50 min de tes mains + ~10 min de propagation DNS + 30 min de smoke test.

Ce guide couvre **uniquement** ce que je (Claude) ne peux pas faire en autonomie : signups sur tes comptes externes, capacités physiques (iPhone), et choix de mots de passe / clés. Tout le reste est codé/scripté dans le repo.

> **Si à un moment tu bloques** : reviens à cette page, dis-moi exactement où tu bloques (capture d'écran, message d'erreur), je te guide en live.

---

## Sommaire

1. [Vérifier la capacité du serveur Hetzner existant](#1-vérifier-la-capacité-du-serveur-hetzner-existant) — 5 min
2. [Créer ton compte Sentry et récupérer DSN + Auth Token](#2-créer-ton-compte-sentry-et-récupérer-dsn--auth-token) — 8 min
3. [Créer ton compte Resend et l'API key](#3-créer-ton-compte-resend-et-lapi-key) — 5 min
4. [Créer un Cloudflare API Token pour `fxmilyapp.com`](#4-créer-un-cloudflare-api-token-pour-fxmilyappcom) — 3 min
5. [Générer les clés VAPID + secrets locaux](#5-générer-les-clés-vapid--secrets-locaux) — 2 min
6. [Remplir `tokens.local.env` et lancer le bootstrap](#6-remplir-tokenslocalenv-et-lancer-le-bootstrap) — 10 min
7. [Vérifier le domaine Resend (~10 min de propagation)](#7-vérifier-le-domaine-resend--10-min-de-propagation)
8. [Premier deploy + migrations DB](#8-premier-deploy--migrations-db) — 5 min (lancé via GH Actions)
9. [Smoke test depuis ton iPhone Safari 18.4+](#9-smoke-test-depuis-ton-iphone-safari-184) — 30 min
10. [Rotation du mot de passe admin](#10-rotation-du-mot-de-passe-admin) — 2 min
11. [(Optionnel) HSTS preload](#11-optionnel-hsts-preload) — 1 min
12. [Inviter le 1er membre cohorte](#12-inviter-le-1er-membre-cohorte) — 5 min

---

## 1. Vérifier la capacité du serveur Hetzner existant

> **Pourquoi** : Ton serveur `hetzner-dieu` (178.104.39.201) tourne déjà n8n + Langfuse + autres workloads. Avant de lui ajouter Fxmily, on vérifie qu'il a la capacité.

```bash
# Depuis ton ordi, en PowerShell
ssh hetzner-dieu 'free -h && df -h && docker ps --format "table {{.Names}}\t{{.Status}}"'
```

**Tu cherches** :

- **RAM disponible (`available`)** : ≥ 1.5 GB libres. Fxmily web container = ~512 MB, Postgres = ~256 MB, Caddy = ~64 MB → ~850 MB total. Si `available` < 1.5 GB → considère provisionner un **nouveau CX22** (~5 €/mois) plutôt que cohabiter.
- **Disque libre** : ≥ 5 GB sur `/`. R2 backups passent par stream (peu d'usage local), Postgres ~500 MB pour 1000 trades.
- **Docker containers** : noter ceux qui tournent pour ne pas casser la cohabitation Caddy (port 80/443).

**Si OK** → continuer. Le `bootstrap-fxmily.sh --skip-hetzner FXMILY_HETZNER_IP=178.104.39.201` réutilisera l'IP existante.

**Si saturé** → on bascule sur un nouveau CX22 :

```bash
# Le script le crée pour toi avec le HCLOUD_TOKEN dans tokens.local.env
bash ops/scripts/provision-hetzner.sh
```

> **Conflit Caddy** : si `hetzner-dieu` a déjà un Caddy qui sert n8n/Langfuse sur 80/443, il faut **éditer le Caddyfile existant** pour ajouter un bloc `app.fxmilyapp.com` au lieu d'en lancer un second. → tu m'envoies ton Caddyfile actuel, je te le modifie.

---

## 2. Créer ton compte Sentry et récupérer DSN + Auth Token

> **Plan free 2026** : 5 000 errors/mois, 50 replays, 5 M spans, 1 user, 1 GB attachments, retention 30 jours. **Pas de CB demandée.**

### Signup

1. Va sur **<https://sentry.io/signup/>**
2. Méthode recommandée : **GitHub OAuth** (1 clic, ton compte `fxeliott` existe déjà). Sinon email + password (clic le lien dans l'email de confirmation).
3. **Region (immuable après !)** : choisis **EU (Frankfurt)** pour RGPD.
4. Onboarding : **Organization name** = `Fxmily`. Le slug est auto-généré, force-le à `fxmily` (Settings → General Settings si pas correct).

### Création projet

5. Wizard "Choose your platforms" → coche **Next.js** → "Create Project".
6. **Project name** : `fxmily-web`. Team par défaut OK.
7. Sentry te montre l'écran "Install Sentry" avec une commande `npx @sentry/wizard@latest...` : **NE LANCE PAS**. Click **"Skip Onboarding"** ou "Take me to issues".

### DSN

8. Va à **Settings → Projects → fxmily-web → Client Keys (DSN)**.
9. URL directe : `https://fxmily.sentry.io/settings/projects/fxmily-web/keys/`.
10. Copie le DSN affiché. Format : `https://<hash>@o<orgid>.ingest.de.sentry.io/<projectid>` (`.de.` car EU region).

### Auth Token

11. Va à **Settings → Auth Tokens**. URL directe : `https://fxmily.sentry.io/settings/auth-tokens/`.
12. Click **"Create New Token"**. Name : `fxmily-web-ci`.
13. **Copie immédiatement** la valeur `sntrys_<...>` — Sentry ne la montre qu'une seule fois.

### Pose dans `tokens.local.env`

```env
SENTRY_DSN=https://<copy-from-dashboard>@o<orgid>.ingest.de.sentry.io/<projectid>
NEXT_PUBLIC_SENTRY_DSN=$SENTRY_DSN  # même valeur, copie/colle
SENTRY_ORG=fxmily
SENTRY_PROJECT=fxmily-web
SENTRY_AUTH_TOKEN=sntrys_<copy-from-dashboard>
```

### Pièges 2026

- **Quota partagé** errors + transactions sur free → désactive `tracesSampleRate` ou pose-le à `0.05` max (déjà câblé dans nos `sentry.*.config.ts`).
- **`@sentry/nextjs` v10** : `sendDefaultPii: false` par défaut désormais → l'IP user n'est plus inférée (RGPD friendly, OK pour Fxmily).

---

## 3. Créer ton compte Resend et l'API key

> **Plan free 2026** : 3 000 emails/mois **+ 100/jour cap** (le cap quotidien est le vrai bottleneck), 1 custom domain, retention logs 30 jours. **Pas de CB demandée.**

### Signup + API key

1. Va sur **<https://resend.com/signup>**. GitHub OAuth (recommandé) ou email/password.
2. Vérification email obligatoire.
3. Va à **<https://resend.com/api-keys>** → **"Create API Key"**.
4. Modal :
   - **Name** : `fxmily-web-prod`
   - **Permission** : **Sending access** (pas "Full access")
   - **Domain** : "All domains" (on restreint plus tard)
5. **Copie immédiatement** la clé `re_<...>`.

### Add domain `fxmilyapp.com`

6. Va à **<https://resend.com/domains>** → **"Add Domain"**.
7. Champ **Domain** : `fxmilyapp.com`. **Region** : **Frankfurt (eu-central-1)** (RGPD + latence FR).
8. Click **"Add"**.
9. L'écran suivant affiche un tableau **DNS Records** avec 3-4 lignes :

| Type      | Name                              | Value                                                       |
| --------- | --------------------------------- | ----------------------------------------------------------- |
| TXT SPF   | `send.fxmilyapp.com`              | `v=spf1 include:amazonses.com ~all`                         |
| TXT DKIM  | `resend._domainkey.fxmilyapp.com` | `p=<long-base64-unique-au-tenant>` ← copie ce qui s'affiche |
| MX        | `send.fxmilyapp.com`              | `feedback-smtp.eu-central-1.amazonses.com` (priority 10)    |
| TXT DMARC | `_dmarc.fxmilyapp.com`            | `v=DMARC1; p=none;`                                         |

> **Garde cette page ouverte** — on va coller ces records dans Cloudflare à l'étape suivante.

### Pose dans `tokens.local.env`

```env
RESEND_API_KEY=re_<copy-from-dashboard>
RESEND_FROM=Fxmily <noreply@fxmilyapp.com>
```

### Pièges 2026

- **100/jour cap dur** : le 101e mail du jour = HTTP 429. Reset à minuit UTC. Pour V1 30 membres c'est large (~5 emails/jour = bienvenue + reset password + digest weekly).
- **MX record obligatoire** même en send-only (feedback bounces SES).
- **DKIM key 2048-bit** dépasse 255 chars → Cloudflare gère le split automatiquement, mais ne mets PAS le proxy orange sur les records DNS de mail.

---

## 4. Créer un Cloudflare API Token pour `fxmilyapp.com`

> **Pourquoi** : Le script `bootstrap-fxmily.sh` va poser les records DNS automatiquement via l'API Cloudflare. Il a besoin d'un token scopé.

### Étapes

1. Va sur **<https://dash.cloudflare.com/profile/api-tokens>**
2. Click **"Create Token"**.
3. Scrolle en bas → section **Custom token** → **"Get started"** (PAS le template "Edit zone DNS" qui est trop large).
4. **Token name** : `fxmily-deploy`.
5. **Permissions** : ajoute 2 lignes (bouton + Add more) :
   - Ligne 1 : `Zone` / `Zone` / `Read`
   - Ligne 2 : `Zone` / `DNS` / `Edit`
6. **Zone Resources** : `Include` / `Specific zone` / `fxmilyapp.com`
7. **Client IP Address Filtering** : laisser vide.
8. **TTL** : **End Date** = aujourd'hui + 90 jours. (Mets un rappel calendrier J-7 pour rotation.)
9. **"Continue to summary"** → **"Create Token"**.
10. **Copie immédiatement** le token (~40 chars random).
11. Sentry te propose un curl test en bas → exécute-le pour valider, attendu 200.

### Récupère aussi ton Zone ID

12. Retourne au dashboard → click **fxmilyapp.com** dans la liste des zones.
13. Sidebar droite → section **API** → copie le **Zone ID** (32 chars hex).

### Pose dans `tokens.local.env`

```env
CLOUDFLARE_API_TOKEN=<copy-from-dashboard>
CLOUDFLARE_ZONE_NAME=fxmilyapp.com
CLOUDFLARE_ZONE_ID=<copy-from-zone-overview>
```

---

## 5. Générer les clés VAPID + secrets locaux

> **Pourquoi** : VAPID (Web Push) + AUTH_SECRET + CRON_SECRET sont des secrets locaux que **tu génères toi-même** (jamais via Claude — passent dans les logs Anthropic).

```bash
# Depuis le repo D:\Fxmily, dans une PowerShell normale (pas Claude)

# 1. VAPID keys (Web Push)
pnpm --filter @fxmily/web exec web-push generate-vapid-keys
# → copie les 2 lignes "Public Key" et "Private Key" qui s'affichent

# 2. AUTH_SECRET
openssl rand -base64 32

# 3. CRON_SECRET
openssl rand -hex 24
```

### Pose dans `tokens.local.env`

```env
# Auth
AUTH_SECRET=<output openssl rand -base64 32>
AUTH_URL=https://app.fxmilyapp.com

# Cron
CRON_SECRET=<output openssl rand -hex 24>

# VAPID
VAPID_PUBLIC_KEY=<output Public Key>
VAPID_PRIVATE_KEY=<output Private Key>
NEXT_PUBLIC_VAPID_PUBLIC_KEY=$VAPID_PUBLIC_KEY  # même valeur que VAPID_PUBLIC_KEY
VAPID_SUBJECT=mailto:eliot@fxmilyapp.com

# DB (sera rempli après bootstrap, ou si tu utilises Postgres existant)
DATABASE_URL=postgresql://fxmily:<random-pwd>@localhost:5432/fxmily?schema=public

# Admin destinataire des digests weekly
WEEKLY_REPORT_RECIPIENT=eliot@fxmilyapp.com  # ou eliot@fxmilyapp.com en V1 si tu préfères
```

> **Important** : `tokens.local.env` est **gitignored** (vérifié dans `.gitignore`). Mais sois prudent — `chmod 600 tokens.local.env` après création.

---

## 6. Remplir `tokens.local.env` et lancer le bootstrap

```bash
# Depuis D:\Fxmily
cp ops/scripts/tokens.local.env.example tokens.local.env
$EDITOR tokens.local.env
# → colle toutes les valeurs récupérées aux étapes 2-5
chmod 600 tokens.local.env

# GitHub CLI authentifié (déjà OK pour toi)
gh auth status

# Lance le bootstrap (skip-hetzner car réutilise hetzner-dieu existant)
FXMILY_HETZNER_IP=178.104.39.201 \
FXMILY_DOMAIN=fxmilyapp.com \
  bash ops/scripts/bootstrap-fxmily.sh tokens.local.env --skip-hetzner
```

Le script va :

1. **Resend** : ajouter le domain `fxmilyapp.com` côté Resend → récupérer les 3 DNS records DKIM/SPF/MX.
2. **Cloudflare DNS** : poser les 6 records (A `app` → 178.104.39.201, MX, 3 TXT, optionnel DMARC).
3. **GitHub secrets** : poser ~13 secrets via `gh secret set` pour la pipeline `deploy.yml`.

À la fin, le script t'affiche les URLs pour valider Resend.

---

## 7. Vérifier le domaine Resend (~10 min de propagation)

1. Attends **~15 min** (la propagation TXT Cloudflare est rapide, mais Resend re-check toutes les 5 min).
2. Va sur **<https://resend.com/domains>** → click sur `fxmilyapp.com`.
3. Click **"Verify DNS Records"**. Statut passe `pending` → `verified` (vert).
4. Si toujours `pending` après 30 min → debug :

```bash
dig TXT resend._domainkey.fxmilyapp.com
# Tu dois voir le record p=... que Resend t'a fourni
```

> Si le record est manquant, vérifie dans Cloudflare DNS qu'il a bien été créé (le bootstrap script aurait dû le poser).

---

## 8. Premier deploy + migrations DB

Une fois Resend verified + GitHub secrets posés, déclenche le premier deploy :

```bash
gh workflow run deploy.yml -R fxeliott/fxmily
gh run list -R fxeliott/fxmily --workflow=deploy.yml --limit=1
```

Le workflow va :

1. Build l'image Docker `ghcr.io/fxeliott/fxmily:latest`.
2. SSH dans `hetzner-dieu` → `docker compose pull` + `up -d`.
3. Lancer `prisma migrate deploy` dans un container one-shot.
4. Pruner les vieilles images.

Vérifie avec `gh run watch` (CTRL-C une fois "Deploy succeeded").

```bash
# Healthcheck
curl -fsS https://app.fxmilyapp.com/api/health
# Attendu : {"ok": true, "checks": {"db": "ok"}}

# Apple Touch Icon
curl -sI https://app.fxmilyapp.com/apple-icon | head -3
# Attendu : HTTP/2 200, content-type: image/png
```

---

## 9. Smoke test depuis ton iPhone Safari 18.4+

> **Pré-requis** : iPhone iOS 18.4+ avec Safari à jour.

1. Ouvre **Safari** (pas Chrome iOS — Web Push ne marche que sur Safari).
2. Va sur **`https://app.fxmilyapp.com`**.
3. **Add to Home Screen** : icône partage → "Sur l'écran d'accueil".
4. Ouvre l'app depuis l'icône (PAS depuis Safari — le Web Push exige PWA installée).
5. **Login** avec un compte admin (cf. étape 10 ci-dessous).
6. **Active les notifications** : `/account/notifications` → toggle "Activer".
7. Safari demande la permission → "Autoriser".
8. Force un push test : depuis ton ordi, tu peux déclencher un push admin via :

```bash
curl -X POST -H "X-Cron-Secret: $CRON_SECRET" \
  https://app.fxmilyapp.com/api/cron/dispatch-douglas
```

Tu dois voir la notif arriver sur ton iPhone.

> **Si pas de notif** : vérifie `Réglages → Notifications → Fxmily → Autoriser`. Si toujours rien, désinstalle l'app + ré-add to Home Screen + retry. iOS PWA push est connu pour être fragile (cf. SPEC §18.2).

---

## 10. Rotation du mot de passe admin

> **Pourquoi** : un mot de passe admin a été collé par accident dans Claude pendant J8 (incident sécu mai 2026). À rotater avant la 1ère invitation.

### Mode 1 : depuis l'app (recommandé)

1. Login `https://app.fxmilyapp.com/login` avec ton compte admin.
2. Va à `/account` → "Changer le mot de passe" (V2 — pas encore V1).

### Mode 2 : direct DB (V1)

```bash
# SSH sur hetzner-dieu
ssh hetzner-dieu

# Génère un nouveau hash argon2
docker compose -f /opt/fxmily/docker-compose.prod.yml exec -T web node -e "
const argon2 = require('@node-rs/argon2');
console.log(argon2.hashSync('TON-NOUVEAU-MDP-12-CHARS-MIN', { memoryCost: 19456, timeCost: 2, parallelism: 1, algorithm: 2 }));
"
# → copie le hash $argon2id$v=19$...

# Update DB (remplace eliot@... par ton vrai email admin)
docker compose -f /opt/fxmily/docker-compose.prod.yml exec -T postgres psql -U fxmily -c "
UPDATE users SET password_hash = '<copy-hash>' WHERE email = 'eliot@fxmilyapp.com';
"
```

---

## 11. (Optionnel) HSTS preload

Une fois `https://app.fxmilyapp.com` stable et tu es **sûr** de ne plus revenir en HTTP :

1. Va sur **<https://hstspreload.org/>**.
2. Entre `fxmilyapp.com` → "Check".
3. Si tous les pré-requis sont OK (HSTS header avec `max-age=63072000; includeSubDomains; preload` — déjà émis par Caddy), submit.

> **⚠️ Action irréversible** côté navigateur. Une fois preloadé, retour en HTTP = semaines d'attente. À faire seulement quand tout est définitivement stable.

---

## 12. Inviter le 1er membre cohorte

```bash
# Login admin sur https://app.fxmilyapp.com/login
# Va à /admin/invite
# Entre l'email du membre → "Envoyer"
```

Le membre reçoit un email avec un magic link 7-day TTL. Il clique, arrive sur `/onboarding/welcome`, choisit prénom/nom/password, accepte le RGPD → autologin.

---

## Aide en cas de blocage

Si une étape bloque, dis-moi exactement :

1. **Quelle étape** (numéro section)
2. **Quel message d'erreur** (capture ou copy-paste)
3. **Output de la commande** qui a échoué

Je te débloque en live. Toutes les sections du repo sont déjà code-prêtes ([PR #35](https://github.com/fxeliott/fxmily/pull/35) CI verte) — on est sur du runtime + provisioning, plus du code à écrire.

> **Liens utiles repo** :
>
> - Spec produit : [`SPEC.md`](../SPEC.md)
> - Runbook Hetzner détaillé : [`docs/runbook-hetzner-deploy.md`](runbook-hetzner-deploy.md)
> - Runbook backup/restore : [`docs/runbook-backup-restore.md`](runbook-backup-restore.md)
> - Smoke test 12-step : [`docs/runbook-prod-smoke-test.md`](runbook-prod-smoke-test.md)
> - Bug fix workflow : [`docs/runbook-bug-fix.md`](runbook-bug-fix.md)
