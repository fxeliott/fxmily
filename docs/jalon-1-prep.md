# Préparation — Jalon 1 (Auth & invitation)

> **STATUT : LIVRÉ ✅** sur la branche `claude/thirsty-banzai-82b1f7` (2026-05-05).
> Voir la section [Close-out (2026-05-05)](#close-out-2026-05-05) en bas du document
> pour ce qui a été effectivement livré, les déviations contrôlées du SPEC, et
> le hand-off vers le Jalon 2.
>
> Ce qui suit est la checklist **préparatoire** rédigée avant le J1, conservée
> pour l'historique. Les sections "Décisions à prendre AVANT" / "Tâches
> techniques attendues" sont datées et peuvent diverger légèrement du livrable
> final — c'est normal.

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

Le commit J0 a été signé `Eliot Pena <eliot@fxmilyapp.com>` via `git -c` éphémère. Pour la suite, lance toi-même :

```bash
git config --global user.email "eliot@fxmilyapp.com"
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

---

## Close-out (2026-05-05)

### Critère "Done" du J1 (SPEC §15) — validé en live

Sur le dev server local (Next.js 16.2.4 Turbopack, Postgres 17 Docker,
fallback `console.log` pour Resend faute de clé pendant la session de dev) :

1. Admin seedé via `apps/web/scripts/seed-admin.ts` (idempotent, env-driven).
2. `POST /login` → 303 → `/dashboard` (argon2id verify ≈ 150 ms, JWT issu).
3. `POST /admin/invite` → 200 → invitation persistée + URL captée en console serveur (fallback dev).
4. `GET /onboarding/welcome?token=…` → form pré-rempli avec l'email de l'invitation.
5. `POST /onboarding/welcome` → 303 → user créé (`status=active`, `role=member`) + auto-login → `/dashboard`.
6. Token re-utilisé → page d'erreur "déjà utilisé". Token invalide → page d'erreur "n'existe pas". Token absent → page d'erreur "lien incomplet".

### Livrables effectifs

- **Schéma Prisma** : `User`, `Account`, `Session`, `VerificationToken`, `Invitation`, `AuditLog` + enums `UserRole`, `UserStatus` + indexes + migration `20260505152759_init` appliquée à la Postgres locale.
- **Auth.js v5** (`5.0.0-beta.31`) split `auth.config.ts` (edge-compat) / `auth.ts` (Node, Prisma + argon2id), strategy **JWT**.
- **Pages** : `/login`, `/admin/invite`, `/onboarding/welcome?token=…`, `/dashboard` — toutes via **Server Actions** + Zod partagé client/server (pas d'API REST custom hors `/api/auth/[...nextauth]`).
- **`proxy.ts`** (Next.js 16 a renommé `middleware.ts`) avec matcher resserré sur `api/auth` (le proxy gate désormais aussi `/api/admin/*`, `/api/journal/*` futurs).
- **CSP baseline** + headers de sécu durcis dans `next.config.ts`.
- **Email** React Email FR + Resend wrapper avec **fallback `console.log`** en dev quand `RESEND_API_KEY` absent.
- **Composants UI** réutilisables tokenizés DS : `Spinner`, `Alert`.
- **Script** `scripts/seed-admin.ts` (idempotent, env-driven).
- **Tests** Vitest unit (password, invitations, schemas, audit, email URL builder) + Playwright E2E skeleton (surface publique).

### Déviations contrôlées du SPEC

| Sujet SPEC                                | Décision J1                                         | Raison                                                                                                                                                                     |
| ----------------------------------------- | --------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| §7.1 "Sessions stockées en DB"            | **Strategy JWT**                                    | Auth.js v5 + Credentials + DB session = workaround complexe (cf. `nextauthjs/next-auth#12848`). JWT est officiellement recommandé, edge-compat. Table `Session` conservée. |
| §15 J1 "Magic link 'mot de passe oublié'" | **Différé J1.5**                                    | Email provider Auth.js mal compatible avec strategy=jwt + Credentials. À implémenter en flow custom (token + Resend).                                                      |
| §7.1 "photo de profil (upload R2)"        | **Différée**                                        | Onboarding fonctionne sans avatar. À activer quand keys Cloudflare disponibles.                                                                                            |
| §6.1 `id (uuid)`                          | `cuid()`                                            | Convention Auth.js + court + lexically sortable. Détail d'implémentation.                                                                                                  |
| §15 "API routes"                          | **Server Actions** (sauf `/api/auth/[...nextauth]`) | Idiomatique Next.js 16, validation Zod re-parse côté serveur. API REST custom à ajouter à la demande (script CLI, intégration externe).                                    |

### Audits parallèles : 4 subagents, findings appliqués

- **code-reviewer** : `DUMMY_ARGON2_HASH` invalide → fix runtime memoized ; race `createInvitation` → transaction atomique avec invalidation pending ; auto-login fail → redirect `/login?onboarding=success` ; types nettoyés ; code mort `randomTokenBytes` retiré.
- **security-auditor** : `Invitation.email` non-unique sur `usedAt IS NULL` → transaction qui invalide les pending avant create ; `proxy.ts` matcher trop large (`api`) → resserré à `api/auth` ; `AuditLog` metadata email PII en clair → retiré.
- **accessibility-reviewer** : Email footer #64748b → 2.61:1 fail AA → bumpé #94a3b8 (6:1) ; `<input readOnly>` au lieu `<span>+<p>` ; consent RGPD live region ; `<title>` email ; password hint persistent + `aria-describedby`.
- **ui-designer** : touch targets `py-3 + min-h-11` (≥ 44 px iOS) ; `<a href>` → `<Link>` ; focus-visible cohérent ; logo header sur `/admin/invite` + `/dashboard` ; H1 `text-3xl sm:text-4xl tracking-tight` ; spinner inline pendant `pending` ; encart succès riche ; tokens DS (`bg-card`, `text-danger`, `text-success`).

### Quality gates verts au close-out

- `pnpm format:check` ✅
- `pnpm --filter @fxmily/web lint` ✅ 0 erreur
- `pnpm --filter @fxmily/web type-check` ✅
- `pnpm --filter @fxmily/web test` ✅
- `pnpm --filter @fxmily/web build` ✅ (avec env placeholders prod-style)
- `prisma migrate dev --name init` ✅ DB sync
- `pnpm audit --prod` ✅ aucune vulnérabilité
- `prisma validate` ✅
- Smoke test E2E live ✅ (capturé dans la session, voir résumé Claude)

### Hors scope J1 — différé volontairement

- **J1.5** : magic link "forgot password" custom ; helper Playwright pour capture URL invitation depuis `console.log` fallback ; Playwright happy-path E2E complet.
- **J2 (journal de trading)** : modèles `Trade`, `TradeAnnotation`, upload screens R2 (presigned URL), wizard mobile-first, autocomplete paires.
- **J5+ (anticipé avant ouverture publique)** : rate limit `/api/auth/*` + lockout policy.
- **J10 (prod hardening)** : CSP nonces stricts dans `proxy.ts` ; Sentry intégré ; rate limiting généralisé ; RGPD endpoints (`/api/account/export`, `/api/account/delete`) ; cron purge invitations expirées ; HIBP compromised-password check ; cooldown invitations ; migration vers domaine Fxmily vérifié dans Resend ; migration `react-email@6` quand `resend/react-email#3414` (React 19.2 + Next 16 build errors) sera résolu.

### Hand-off vers J2

À préparer côté Eliot :

1. Compte **Cloudflare R2** + bucket `fxmily-media` + Access Key + Secret.
2. **Liste des paires de trading** prioritaires (forex majeurs, métaux, indices, crypto ?).
3. Décider : merger d'abord la PR J1 sur `main` (recommandé pour Dependabot et la base propre), ou stacker J2 sur la même branche.
4. `/clear` la session courante, puis : _"Implémente le Jalon 2 du SPEC.md à `D:\Fxmily\SPEC.md`. Journal de trading. Lis aussi `D:\Fxmily\apps\web\CLAUDE.md` (à jour J1) et `D:\Fxmily\CLAUDE.md` avant de commencer."_
