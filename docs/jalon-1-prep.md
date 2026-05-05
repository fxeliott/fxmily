# Préparation — Jalon 1 (Auth & invitation)

> À lire avant la prochaine session Claude Code dédiée au Jalon 1.
> SPEC §15 jalon 1 : 5-7 jours estimés.

## Critère "Done" du J1 (SPEC §15)

> Eliot peut inviter un faux email, recevoir le mail, créer le compte et logger.

## Statut Docker (héritage J0)

WSL2 installé ✅ (commande `wsl --install --no-distribution` réussie le 2026-05-05).
**Docker Desktop : install non finalisée** — UAC refusé 2 fois lors des tentatives automatiques. À régler manuellement avant J1 :

1. Double-clique `Docker Desktop Installer.exe` dans Téléchargements (ou re-télécharge sur https://www.docker.com/products/docker-desktop/).
2. Accepte UAC. Choix d'install : "Use WSL 2 instead of Hyper-V" (par défaut, garde-le).
3. Une fois installé, lance Docker Desktop. Attends qu'il dise "Engine running".
4. Vérifie côté terminal : `docker --version` et `docker info`.
5. Lance le compose : `docker compose -f docker-compose.dev.yml up -d`.
6. Vérifie : `docker ps` doit montrer `fxmily-postgres-dev` healthy.

## Décisions à prendre AVANT la session

### 1. Identité Git (en suspens depuis le J0)

Le commit J0 a été signé `Eliot Pena <eliott.pena@icloud.com>` via `git -c` éphémère. Pour la suite, lance toi-même :

```bash
git config --global user.email "eliott.pena@icloud.com"
git config --global user.name "Eliot Pena"
```

(ou local au repo en omettant `--global`).

### 2. Comptes externes à créer

| Service                         | Pourquoi                         | Quand                      |
| ------------------------------- | -------------------------------- | -------------------------- |
| **Resend** (resend.com)         | envoi email d'invitation         | début J1                   |
| **Cloudflare** (cloudflare.com) | R2 storage (photos profil, etc.) | début J1                   |
| **GitHub** (repo privé)         | hébergement code + CI            | dès maintenant si pas fait |

À avoir en main avant J1 :

- Clé API Resend (free tier 3000 mails/mois)
- Compte Cloudflare → bucket R2 `fxmily-media` créé + Access Key + Secret
- Domaine vérifié pour Resend (sinon utiliser le domaine onboarding `onboarding@resend.dev` au début)

### 3. Domaine `fxmily.com`

SPEC §18.1 dit "à confirmer disponible". À acheter idéalement avant le J10 (Cloudflare Registrar ~10€/an). Pour le J1, l'app tourne sur `localhost:3000`, sans domaine requis.

### 4. Liste paires de trading

SPEC §18.1 question ouverte. Pour le J2 (journal de trade), il faudra fournir la liste exacte des paires autorisées dans l'autocomplete. Préparer une liste type :

- Forex majeurs (EURUSD, GBPUSD, USDJPY, USDCHF, AUDUSD, USDCAD, NZDUSD)
- Métaux (XAUUSD, XAGUSD)
- Indices (US30, NAS100, SPX500, GER40)
- Crypto majeures (BTCUSD, ETHUSD) ?

Décision Eliot à valider.

### 5. Logo officiel

Le J0 contient un placeholder SVG approximatif. **Mets ton fichier original** dans `D:\Fxmily\apps\web\public\logo.svg` (préféré) ou `.png`. Le placeholder est suffisant pour le dev mais la vue d'invitation enverra l'image, donc à régler au plus tard pendant le J1.

## Avant de lancer la session J1

```bash
# Vérification rapide que l'environnement est sain
cd D:/Fxmily
pnpm install --frozen-lockfile
pnpm --filter @fxmily/web prisma:generate

# Variables d'env (manuel, cf. docs/env-template.md)
# 1. Crée apps/web/.env.example (copie depuis docs/env-template.md)
# 2. cp apps/web/.env.example apps/web/.env
# 3. Édite apps/web/.env :
#    - AUTH_SECRET = $(openssl rand -base64 32)
#    - RESEND_API_KEY = re_... (depuis dashboard Resend)
#    - RESEND_FROM = no-reply@fxmily.com (ou onboarding@resend.dev temporairement)

# Démarrer Postgres
docker compose -f docker-compose.dev.yml up -d
docker ps  # vérifier que fxmily-postgres-dev tourne et est healthy

# Tester la connexion
pnpm --filter @fxmily/web prisma:migrate dev --name init  # va créer la DB
```

## Tâches techniques attendues du J1

Cf. SPEC §15 jalon 1 + §7.1 :

1. **Schéma Prisma** : `User` (id, email, firstName, lastName, avatarUrl, role, status, invitedAt, joinedAt, lastSeenAt, timezone, pushSubscription, consentRgpdAt) + `Session` (Auth.js) + `Account` (Auth.js) + `VerificationToken` + `Invitation` (id, email, tokenHash, expiresAt, usedAt, invitedByAdminId).
2. **Auth.js v5** : config `auth.ts` + `auth.config.ts`, adapter Prisma, providers Credentials (email + password) + Email magic link, sessions DB, cookies httpOnly + SameSite=Lax + Secure.
3. **Pages** :
   - `/login` (form email + password, lien "mot de passe oublié" → magic link)
   - `/onboarding/welcome?token=...` (form prénom + nom + photo + accept CGU + password)
   - `/admin/invite` (form admin pour envoyer une invitation)
4. **API routes** :
   - `POST /api/auth/...` (Auth.js handler)
   - `POST /api/admin/invitations` (créer une invitation, génère token, envoie email Resend)
   - `POST /api/onboarding/complete` (valide token, crée user actif)
5. **Email template** : React Email (`@react-email/components`), template d'invitation bilingue ? non, FR uniquement (SPEC §13).
6. **Upload photo profil** : presigned URL R2, format JPEG/PNG, max 2 Mo, stocker la R2 key dans `User.avatarUrl`.
7. **Middleware** : `/middleware.ts` qui redirige `/admin/*` si `role !== 'admin'`, et `/(authenticated)/*` si pas connecté.
8. **Tests** :
   - Unit : services d'invitation (génération token, hash), validation Zod
   - Intégration : POST /api/admin/invitations (mock Resend), POST /api/onboarding/complete
   - E2E : Playwright complet — admin invite → mail intercepté → click link → onboarding → login OK

## Améliorations différées du J0 (à intégrer en cours de J1)

Issues mineures non bloquantes laissées de côté en J0 mais à régler en J1 :

- `tsconfig.base.json` : envisager `verbatimModuleSyntax: true` pour clarifier `import type` (TS 5.7 idiomatic).
- `lint-staged.config.mjs` : remplacer `process.cwd()` par `import.meta.dirname` pour robustesse depuis subdir.
- `eslint.config.mjs` : supprimer le `globalIgnores` qui ré-déclare les défauts si plus utile (le bloc actuel garde juste `src/generated/**` qui est nécessaire).
- `apps/web/CLAUDE.md` : créer un fichier scoped pour le package web (en plus du root `CLAUDE.md` projet déjà créé).
- **Tests setup** : le SPEC liste Vitest + RTL + Playwright pour J1. Lancer `pnpm --filter @fxmily/web add -D vitest @testing-library/react @testing-library/jest-dom jsdom @vitejs/plugin-react playwright` au début de J1.
- **`apps/web/.env.example`** : à créer manuellement par Eliot (cf. `docs/env-template.md`) ou Claude si Eliot ajoute une allow-rule à `~/.claude/settings.json`.

## Recommandations pour la session J1

1. **`/clear` la session J0** avant de commencer (SPEC §18.4).
2. **Premier message** : _"Implémente le Jalon 1 du SPEC.md à `D:\Fxmily\SPEC.md`. Auth & invitation. Lis aussi `D:\Fxmily\docs\jalon-1-prep.md` et `D:\Fxmily\CLAUDE.md` avant de commencer."_
3. Estime ~5-7 jours de travail total ; en session Claude Code, ~2-3 sessions de 30k tokens chacune.
4. Vérifier après chaque commit : `pnpm format:check && pnpm lint && pnpm type-check && pnpm build`.
5. Tester E2E manuellement le flow d'invitation avant de clore le jalon.
