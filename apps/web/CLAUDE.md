# `@fxmily/web` — instructions Claude Code (scoped)

> Ce fichier hérite des conventions du projet : voir `D:\Fxmily\CLAUDE.md` à la racine.
> Ici on documente uniquement les spécificités du package `apps/web`.

## Contexte

Application **Next.js 16** (App Router, Turbopack) qui sert l'app Fxmily — front + API + service worker (PWA, Jalon 9).

État au 2026-05-09 : **J0 → J10 livrés** (Phases A → P). Branche `claude/j10-prod-deploy` HEAD `0588d12`, 18 commits granulaires, [PR #35](https://github.com/fxeliott/fxmily/pull/35) ouverte avec CI verte. **Smoke prod end-to-end** bloqué par 7 pré-requis externes Eliot — voir §J10 plus bas + `docs/runbook-prod-smoke-test.md`.

## Aliases d'import

- `@/*` → `./src/*` (configuré dans `tsconfig.json` + `components.json`)
- Server-only : `@/lib/db`, `@/lib/env`, `@/generated/prisma/*`, `@/auth` (root), `@/lib/auth/*`, `@/lib/email/*` ne doivent **JAMAIS** être importés depuis un fichier marqué `'use client'`.
- Génère le client Prisma dans `apps/web/src/generated/prisma` (gitignored, exclu de tsconfig + ESLint).

## Boot

`apps/web/src/instrumentation.ts` déclenche l'import de `@/lib/env` au démarrage du runtime Node.js. Toute variable d'environnement requise (DATABASE_URL, AUTH_SECRET, AUTH_URL) y est validée par Zod et le serveur fail-fast si invalide.

→ **Ne pas déplacer `instrumentation.ts`** ailleurs sans comprendre cet effet.

## Auth.js v5 (J1)

### Configuration split (edge-friendly)

- `src/auth.config.ts` — slice **edge-compat** : `authorized()` callback (used by `proxy.ts`), `jwt`/`session` callbacks, `pages`, `session.strategy = 'jwt'`. **Aucun import de Prisma ni d'argon2** ici.
- `src/auth.ts` — slice **Node** : `PrismaAdapter`, `Credentials` provider avec `verifyPassword` (argon2id). Exporte `{ auth, handlers, signIn, signOut }`.
- `src/types/next-auth.d.ts` — augmentation des types `Session.user` / `User` / `JWT` pour exposer `role` + `status` + `id`.

### Stratégie de session

- **JWT** (déviation contrôlée du SPEC §7.1 qui décrit "sessions DB"). Raison : Auth.js v5 + Credentials + database session strategy nécessite un workaround (création manuelle de session dans le callback `jwt`, cf. discussion GitHub `nextauthjs/next-auth#12848`). Le JWT-only est officiellement recommandé par Auth.js et reste edge-compat. La table `Session` est conservée dans le schéma Prisma (utilisée si on rebascule plus tard ou pour Email provider).
- `maxAge` 30 jours, `updateAge` 1 jour.

### `proxy.ts` (renommé depuis `middleware.ts` en Next.js 16)

- Le fichier **doit s'appeler `proxy.ts`** (Next.js 16) et exporter le wrapper `auth(authConfig)` en default.
- Pour ne pas alourdir le bundle proxy, on importe `authConfig` depuis `auth.config.ts` (PAS `auth.ts`).
- Matcher : exclut `api`, `_next/static`, `_next/image`, `favicon.ico`, `logo.png`, `*.svg`.

### Public routes (whitelistées dans `authConfig.authorized`)

`/`, `/login`, `/forgot-password`, `/onboarding/*`, `/reset-password*`, `/api/auth/*`, `/legal/*`, `/_next/*`, `/favicon`.

**Note J2** : `/api/uploads` ET `/api/uploads/[...key]` sont matchés par le proxy (pas dans la whitelist) — donc auth required par défaut. Les route handlers re-vérifient `auth()` (defense in depth) avant de toucher le storage. Le GET vérifie en plus l'ownership : la `userId` segment de la storage key DOIT matcher la session, sauf admin.

### Mot de passe (argon2id)

- `src/lib/auth/password.ts` — wrapper `@node-rs/argon2` (paramètres OWASP 2024 : 19 MiB, t=2, p=1).
- `Algorithm.Argon2id` est un `const enum` non-importable en `isolatedModules` → on hardcode `algorithm: 2`.

### Tokens d'invitation

- `src/lib/auth/invitations.ts` — génération `nanoid` 32 chars URL-safe (~192 bits d'entropie), stockage SHA-256 hash uniquement (`Invitation.tokenHash`).
- TTL par défaut 7 jours (SPEC §7.1).
- `findInvitationByToken` retourne un discriminated union `{ ok: true, invitation } | { ok: false, reason: 'unknown'|'expired'|'already_used' }`.

### Onboarding atomique

- `src/lib/auth/onboarding.ts` — transaction Prisma qui re-vérifie le state de l'invitation, crée le User en `status='active' role='member'`, marque l'invitation comme `usedAt = NOW()`, en best-effort log audit.
- Auto-login après création (Server Action `completeOnboardingAction` appelle `signIn('credentials', { redirectTo: '/dashboard' })`).

### "Mot de passe oublié" — IMPLÉMENTÉ (2026-06-30)

Implémentation custom (PAS le Magic-link Auth.js, qui fonctionne mal avec strategy=jwt + Credentials). Flow self-service complet, calqué sur le pattern token d'invitation :

- **Schéma** : `model PasswordResetToken` (`token_hash` unique SHA-256, `expires_at`, `used_at`, FK `onDelete: Cascade`), migration `20260630090000_add_password_reset_tokens`.
- **Service** `src/lib/auth/password-reset.ts` : `nanoid` 32 chars (~192 bits), stockage hash uniquement, TTL 30 min, consume atomique single-use (`updateMany where usedAt:null, expiresAt:{gt}`), bump `tokenVersion` (révoque tous les JWT), borné à ≤1 row/user (`deleteMany` avant `create` → pas de cron de purge). Seul un user `status='active'` est réinitialisé.
- **Routes** : `/forgot-password` (form email → réponse NEUTRE identique que le compte existe ou non, anti-énumération ; rate-limit email 3/15min + IP 5/min consommé AVANT le lookup) et `/reset-password?token=` (valide le token au load, form nouveau mot de passe → redirect `/login?reset=success`).
- **Email** : template Resend `src/lib/email/templates/password-reset.tsx` + `sendPasswordResetEmail` (rollback du token si l'envoi échoue, réponse toujours neutre).
- **RGPD** : `passwordResetTokens` classé en `EXCLUDED_USER_RELATIONS` (secret auth, non-portable), comme `verificationToken`.
- Le lien "Mot de passe oublié ?" de `/login` pointe désormais vers `/forgot-password` (remplace l'ancien `mailto:`).

## Server Actions (pattern J1)

Tous les forms passent par des **Server Actions** (`use server`) plutôt que des API routes. Choix pour J1 :

- Plus idiomatique en Next.js 16 (couplage form ↔ logique serveur).
- Validation Zod à l'entrée (parsing `FormData`), retour d'un `ActionState` avec `fieldErrors` lisibles côté client via `useActionState`.
- Pour l'auth, attention à **re-throw** les `digest: 'NEXT_REDIRECT…'` jetés par `signIn()` — sinon Next ne peut pas naviguer.

Si une intégration externe ou un script CLI demande une API REST, ajouter une route `app/api/...` ad-hoc à ce moment-là, pas à l'avance.

## Email (Resend + React Email)

- `src/lib/email/client.ts` — wrapper `Resend`. Si `RESEND_API_KEY` absent en dev → log structuré avec l'URL en clair (le critère "Done" J1 reste testable localement même sans clé). En prod, throw `EmailDeliveryError`.
- `src/lib/email/templates/*.tsx` — templates React Email FR. **Important** : passer le composant comme `Component({ props })` (appel de fonction) à `react: ...`, pas comme JSX (cf. doc Resend).
- `src/lib/email/send.ts` — helpers haut-niveau (`sendInvitationEmail`).
- `RESEND_FROM` par défaut = `Fxmily <onboarding@resend.dev>` (utilisable sans domaine vérifié, avec rate limit Resend free tier).

## Audit log

- `src/lib/auth/audit.ts` — `logAudit(...)` best-effort, jamais bloquant.
- IPs hashées SHA-256 avec sel `AUTH_SECRET`. Aucun PII en clair.
- Actions wired :
  - **J1** : `invitation.created/consumed`, `onboarding.completed`. **PHASE 1 fixes** (post-J4): `auth.login.success` (event `signIn`), `auth.login.failure` inline dans `authorize()` avec metadata `reason: 'unknown_or_no_password' | 'inactive' | 'bad_password'` (jamais l'email en clair — anti-énumération), `auth.logout` (event `signOut`).
  - **J2** : `trade.created`, `trade.closed`, `trade.deleted`, `trade.screenshot.uploaded` (metadata = `{ kind, key, mime, size, adapter }`, pas le contenu).
  - **J3** : `admin.members.listed`, `admin.member.viewed` (metadata `{ memberId, tab }`), `admin.trade.viewed` (metadata `{ memberId, tradeId, isClosed, annotationsCount }` — J4 ajoute le compteur).
  - **J4** : `admin.annotation.created` (metadata `{ annotationId, tradeId, memberId, hasMedia, mediaType }`), `admin.annotation.deleted` (metadata `{ annotationId, tradeId, memberId }`), `admin.annotation.media.uploaded` (metadata `{ kind, key, mime, size, adapter, tradeId }`), `member.annotations.viewed` (metadata `{ tradeId, markedCount }` — émis seulement si `markedCount > 0` pour ne pas spammer le log à chaque ouverture de trade), `notification.enqueued` (metadata `{ notificationId, type, tradeId, annotationId }`).
  - **J5** : `checkin.morning.submitted` (metadata `{ checkinId, date, moodScore, sleepQuality }`), `checkin.evening.submitted` (metadata `{ checkinId, date, moodScore, stressScore, planRespected }`), `checkin.reminder.scan` (metadata `{ scannedUsers, enqueuedMorning, enqueuedEvening, skipped, ranAt }` — 1 row par run cron, pas par user). Le helper `enqueueCheckinReminder` ne loggue PAS d'audit (idempotent + bulk run, on track le scan global plutôt).
  - **J6** : `cron.recompute_scores.scan` (metadata `{ computed, skipped, errors, ranAt }` — 1 row par run cron, pas par user, heartbeat). `score.computed` réservé pour les recomputes on-demand triggered par Server Actions (à câbler J6.5 si besoin).

## Headers de sécurité

Wired dans `next.config.ts` `headers()` (réponse à toute route via `source: '/:path*'`) :

- `Content-Security-Policy` — baseline J1 (default-src 'self', script-src 'self' 'unsafe-inline' [+ 'unsafe-eval' en dev], style-src 'self' 'unsafe-inline', frame-ancestors 'none', form-action 'self', base-uri 'self', upgrade-insecure-requests prod-only). **TODO V2** : remplacer `'unsafe-inline'` par nonces générés dans `proxy.ts` (reclassé V2 post-J10 audit Phase O — refactor non-trivial du proxy edge runtime).
- `X-Content-Type-Options: nosniff`
- `X-Frame-Options: DENY`
- `Referrer-Policy: strict-origin-when-cross-origin`
- `Permissions-Policy: camera=(), microphone=(), geolocation=(), interest-cohort=()`
- `Cross-Origin-Opener-Policy: same-origin`
- `Strict-Transport-Security: max-age=63072000; includeSubDomains; preload` (prod uniquement)

## Theme (Tailwind 4) — DS-v3 (accent bleu, light + dark)

> **Contrat SSOT des tokens = [`src/app/_design/TOKENS.md`](src/app/_design/TOKENS.md)** (inventaire complet light/dark, règles d'usage, Tailwind 4). Lis-le avant tout travail visuel. La SSOT runtime reste `src/app/globals.css`.

Variables CSS dans `src/app/globals.css` : tokens privés (`:root` sombre + `.light` clair) ré-exportés en `--color-*`/`--radius-*`/etc. via `@theme inline` (seuls les tokens `@theme` génèrent des classes Tailwind).

- **Surfaces** : `--bg`, `--bg-1`, `--bg-2`, `--bg-3` (fond app → carte → élévation ; montent au blanc en clair).
- **Texte** : `--t-1`..`--t-4` (primaire → muté ; tous WCAG AA-validés, light + dark).
- **Accent bleu** : `--acc` (#3b82f6 dark / #2563eb light), `--acc-hi` (hover), `--acc-dim` (halo), `--acc-fg` (texte sur accent) ; **`--acc-2`** indigo + **`--cy`** cyan/teal (datavis `--dv-1/2/3`).
- **États** : `--ok` (succès/gain), `--bad` (erreur/perte/danger ; alias `--color-danger`/`--color-destructive`), `--warn`.
- **Typo** : `--font-display` (Geist), `--font-sans` (Inter), `--font-mono` (JetBrains Mono).
- **Rayons / ombres / eases** : `--radius-*`, `--shadow-*` (Mercury multi-couches), `--ease-*` — cf. TOKENS.md §5.
- `@layer base` resets + `@media (prefers-reduced-motion: reduce)` actif.

> Note historique : palette SPEC §8.1 (bleu) → DS-v2 lime/deep-space (Sprint #1, 2026-05-06) → **DS-v3 bleu + light/dark** (S9→S20, emails+UI migrés lime→bleu). Les sections changelog V2.x ci-dessous mentionnant « DS-v2 lime » sont **historiques** (état au moment de la session), pas l'état courant.

## Conventions composants

- shadcn/ui CLI v4 — `pnpm dlx shadcn@latest add <component>` (pas encore de composant généré au J1, on a codé les forms en Tailwind direct pour éviter le bloat avant d'avoir besoin de plus de surface).
- Components dans `src/components/ui/` (générés par shadcn) et `src/components/` (custom).
- `cn()` helper dans `src/lib/utils.ts` (clsx + tailwind-merge).
- Variants : `class-variance-authority` (`cva`).
- Icônes : `lucide-react` (1.x).

## Forms (J1+)

- **Server Actions** par défaut + `useActionState` côté client (form submit natif, progressive enhancement).
- **Zod schemas partagés** dans `src/lib/schemas/*` — un seul schéma pour validation client + serveur (re-parse côté Server Action via `safeParse(formData)`).
- React Hook Form + `@hookform/resolvers/zod` disponible (deps installées) pour les forms riches qui ont besoin de validation incrémentale ou de `watch()`. Pas utilisé pour les forms d'auth simples du J1.

## Database (Prisma 7)

- Schéma : `prisma/schema.prisma` (datasource sans `url`, c'est dans `prisma.config.ts`).
- Client généré : `src/generated/prisma/client` (import via `@/generated/prisma/client`).
- Singleton avec adapter-pg : `src/lib/db.ts`.
- Migrations : `pnpm --filter @fxmily/web prisma:migrate` (besoin du `.env` worktree avec `DATABASE_URL`).
- Migration `init` (J1) : `prisma/migrations/20260505152759_init/` — User/Account/Session/VerificationToken/Invitation/AuditLog + enums UserRole, UserStatus + indexes.
- Migration `j2_trade` (J2) : `prisma/migrations/20260505160000_j2_trade/` — Trade table + 4 enums (TradeDirection, TradeSession, TradeOutcome, RealizedRSource) + composite indexes user-scoped.
- Migration `j4_trade_annotation` (J4) : `prisma/migrations/20260506100000_j4_trade_annotation/` — TradeAnnotation + NotificationQueue + 3 enums (AnnotationMediaType, NotificationType, NotificationStatus).
- Migration `j5_daily_checkin` (J5) : `prisma/migrations/20260506200000_j5_daily_checkin/` — `daily_checkins` table + enum `CheckinSlot` + 2 nouvelles values pour `NotificationType` (`checkin_morning_reminder`, `checkin_evening_reminder`). Note : `ALTER TYPE ADD VALUE IF NOT EXISTS` cohabite avec d'autres DDL dans la même transaction tant qu'on n'utilise pas la nouvelle valeur (ce qui est le cas ici).
- Migration `j5_notification_dedup` (J5 audit fix) : `prisma/migrations/20260507100000_j5_notification_dedup/` — unique partial index `notification_queue_pending_checkin_dedup` sur `(user_id, type, payload->>'date')` WHERE status=pending AND type IN (checkin\_\*\_reminder). Garantie d'idempotency Postgres-level pour `enqueueCheckinReminder` sous concurrence cron.
- **Naming convention DB** : tables et colonnes en `snake_case` via `@map`, modèles Prisma en PascalCase / camelCase. C'est la convention Auth.js officielle.
- **Decimal** : `Prisma.Decimal` exporté via `@/generated/prisma/client`. Au write, on passe `new Prisma.Decimal(numericValue)` (Prisma 7 accepte aussi un number, mais on est explicite). Au read, `.toNumber()` ou `.toString()` selon le cas. Pour passer aux client components, **toujours sérialiser en string** (`SerializedTrade` dans `lib/trades/service.ts`).

## Tests

- **Vitest** (`pnpm --filter @fxmily/web test`) — unit tests purs (pas de DB) :
  - **J1** : `src/lib/auth/{password,invitations,audit}.test.ts`, `src/lib/schemas/auth.test.ts`, `src/lib/email/send.test.ts`
  - **J2** : `src/lib/trading/{pairs,emotions,sessions,calculations}.test.ts`, `src/lib/schemas/trade.test.ts`, `src/lib/storage/keys.test.ts`
  - **J5** : `src/lib/checkin/{streak,timezone}.test.ts`, `src/lib/schemas/checkin.test.ts`
  - **J5 audit fixes** : `src/lib/notifications/enqueue.test.ts` (6 tests TDD pour la race-safe enqueue P2002), `src/lib/checkin/reminders.test.ts` (8 tests TDD pour le scan cron : early-return out-of-window, bulk lookup, slot-already-filled skip, userIds option, audit canonical row).
  - **TIER 3 hardening** : `src/lib/text/safe.test.ts` (19 tests TDD pour `safeFreeText` + `containsBidiOrZeroWidth` + `graphemeCount` — Unicode NFC + bidi/zero-width strip + emoji-family grapheme counting).
  - **J6 analytics** : `src/lib/analytics/{wilson,correlations,expectancy,streaks,equity-curve,drawdown}.test.ts` (94 tests TDD — Wilson vs scipy à 1e-12, Newcombe 1998 golden values, Welford-stable variance, Van Tharp expectancy + profit factor cap).
  - **J6 scoring** : `src/lib/scoring/{discipline,emotional-stability,consistency,engagement}.test.ts` (47 tests TDD — 4 dimensions avec sample-size guards + renormalization).
  - **458 tests verts au close-out J6** (vs 317 fin J5, +141).
- **Vitest setup** : `src/test/setup.ts` charge `@testing-library/jest-dom/vitest`. `vitest.config.ts` stub `DATABASE_URL`/`AUTH_SECRET`/`AUTH_URL` pour permettre les imports transitifs sans crash Zod.
- **Playwright** (`pnpm --filter @fxmily/web test:e2e`) :
  - `tests/e2e/auth-invitation.spec.ts` (J1) — surface publique auth.
  - `tests/e2e/journal.spec.ts` (J2) — auth gates `/journal/*` + 401 sur `/api/uploads*` non-auth.
  - `tests/e2e/admin-annotation.spec.ts` (J4) — auth gates admin annotation routes + uploads.
  - `tests/e2e/checkin.spec.ts` (J5) — auth gates `/checkin/*` + 401/503 sur cron sans secret + 405 sur GET cron.
  - `tests/e2e/recompute-scores.spec.ts` (J6) — cron `/api/cron/recompute-scores` 401/503/405 public surface.
  - Le full happy-path member (login → create → close → list / login → checkin → streak++) attend le helper de seed Postgres (cross-jalon).
- Postgres réel attendu (testcontainers ou compose dédié `docker-compose.test.yml` à wirer plus tard).
- **Base jetable pour reproduire un bug : `bash ops/scripts/db-tmp.sh create <slug>`**, jamais à la main. Elle s'appellera `fxmily_tmp_<slug>` et `drop --all --yes` les efface toutes d'un geste — la base de dev `fxmily` ne peut pas être ciblée. `doctor` signale celles créées hors convention. Sans ça elles s'accumulent : 15 bases orphelines / 155 Mo au 2026-08-04.
- Mock storage : pas besoin — `LocalStorageAdapter` écrit dans `<UPLOADS_DIR>` qu'on peut router vers un répertoire temporaire dans les tests E2E.
- Mock Resend : pour J1+ le fallback `console.log` du wrapper suffit.

## Pièges Next 16

- `typedRoutes` est au top-level de `next.config.ts`, plus dans `experimental`.
- **`middleware.ts` → `proxy.ts`** + export named `proxy` (et pas `middleware`).
- `runtime = 'nodejs'` requis sur les API routes qui touchent Prisma (sinon Edge runtime, incompatible avec adapter-pg).
- `dynamic = 'force-dynamic'` pour les routes qui dépendent de `cookies()`, `headers()`, ou env runtime.
- Build collecte les pages : si une page importe transitivement `@/lib/env` et que `AUTH_URL` n'est pas en HTTPS, le build crash en mode prod (la refine Zod). Pour `next build` local hors prod réel, utiliser un placeholder `AUTH_URL=https://build.fxmily.invalid`.
- Cache Components (J2+ probable) : nouvelle API avec directive `'use cache'`, à étudier quand pertinent.

## Pièges Auth.js v5 + Next 16

- `signIn()` côté serveur **throw** un `redirect()` interne (digest commence par `NEXT_REDIRECT`). Tout `try/catch` autour de `signIn()` doit re-throw cette erreur sinon la navigation est perdue.
- L'export `handlers` d'Auth.js v5 est un objet `{ GET, POST }` — pas des fonctions exportées séparément. Pour un App Router route handler : `export const { GET, POST } = handlers`.
- Le `@auth/prisma-adapter` exporte un type légèrement périmé pour `PrismaClient` ; on cast `db as any` au moment du wiring (le contrat runtime est correct).
- `Credentials` provider + `session.strategy = 'database'` ne crée PAS de session DB par défaut (bug bien connu). On reste sur `strategy: 'jwt'` au J1.

## Workflow J1 — démarrer en local

```bash
# 1. Postgres (depuis la racine du repo, pas le worktree)
docker compose -f D:/Fxmily/docker-compose.dev.yml up -d

# 2. .env worktree (à créer manuellement par Eliot — pattern .env* est en deny rule Claude)
# Contenu minimal : NODE_ENV=development, DATABASE_URL=postgresql://fxmily:fxmily_dev@localhost:5432/fxmily?schema=public,
#                   AUTH_SECRET=$(openssl rand -base64 48), AUTH_URL=http://localhost:3000
# (RESEND_API_KEY optionnel : sans, le lien d'invitation est loggué dans la console serveur)

# 3. Migrate + generate
pnpm --filter @fxmily/web prisma:generate
pnpm --filter @fxmily/web prisma:migrate

# 4. Seed un admin (J1.5 ajoutera scripts/seed-admin.ts ; pour l'instant via prisma studio)
pnpm --filter @fxmily/web prisma:studio

# 5. Lancer dev
pnpm dev   # http://localhost:3000

# 6. Suite qualité
pnpm format:check && pnpm lint && pnpm type-check && pnpm --filter @fxmily/web test && pnpm build
```

## Où est passé le reste

Ce fichier pesait 394 301 octets (~104k tokens) et se rechargeait en entier à chaque
session touchant `apps/web/`. Il a été scindé le 2026-08-04. **Rien n’a été supprimé.**

- **Décisions verrouillées** (landmines anti-régression, toujours opposables) :
  `.claude/rules/decisions-*.md`. Elles portent un frontmatter `paths:` et se chargent
  automatiquement quand tu touches les fichiers concernés — tu n’as rien à faire.
- **Historique des jalons** (portée, fichiers touchés, quality gates, refs de PR) :
  `docs/web/jalons-history.md`. Documentation, à lire à la demande.
- **Inventaire des routes** : `docs/web/routes.md`.

Les liens ci-dessus sont volontairement écrits entre backticks et **non** en `@import` :
un import serait chargé au lancement et annulerait tout le gain.
