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

## Routes connues (à compléter par jalon)

| Route                                  | Méthode  | Fichier                                                | Statut                                                                        |
| -------------------------------------- | -------- | ------------------------------------------------------ | ----------------------------------------------------------------------------- |
| `/`                                    | GET      | `src/app/page.tsx`                                     | J0 — splash placeholder                                                       |
| `/api/health`                          | GET      | `src/app/api/health/route.ts`                          | J0 — env + DB ping                                                            |
| `/api/auth/[...nextauth]`              | GET/POST | `src/app/api/auth/[...nextauth]/route.ts`              | J1 — Auth.js v5 handlers (Node)                                               |
| `/login`                               | GET/POST | `src/app/login/{page,login-form,actions}.tsx`          | J1 — Credentials login                                                        |
| `/onboarding/welcome?token=…`          | GET/POST | `src/app/onboarding/welcome/*`                         | J1 — invitation consume + autologin                                           |
| `/admin/invite`                        | GET/POST | `src/app/admin/invite/*`                               | J1 — admin-only invite form                                                   |
| `/dashboard`                           | GET      | `src/app/dashboard/page.tsx`                           | J1 — landing post-login (links to journal)                                    |
| `/journal`                             | GET      | `src/app/journal/page.tsx`                             | J2 — list, status filter (all/open/closed)                                    |
| `/journal/new`                         | GET      | `src/app/journal/new/page.tsx`                         | J2 — wizard mobile-first 6 étapes                                             |
| `/journal/[id]`                        | GET      | `src/app/journal/[id]/page.tsx`                        | J2 — détail + delete + close CTA                                              |
| `/journal/[id]/close`                  | GET/POST | `src/app/journal/[id]/close/page.tsx`                  | J2 — formulaire de clôture                                                    |
| `/api/uploads`                         | POST     | `src/app/api/uploads/route.ts`                         | J2 — multipart, magic-byte, audit                                             |
| `/api/uploads/[...key]`                | GET      | `src/app/api/uploads/[...key]/route.ts`                | J2 — stream local FS (dev), R2 redirect (prod)                                |
| `/admin/members`                       | GET      | `src/app/admin/members/page.tsx`                       | J3 — admin-only members list                                                  |
| `/admin/members/[id]`                  | GET      | `src/app/admin/members/[id]/page.tsx`                  | J3 — overview + trades tab (?tab=trades)                                      |
| `/admin/members/[id]/trades/[tradeId]` | GET      | `src/app/admin/members/[id]/trades/[tradeId]/page.tsx` | J3 — admin-scoped trade detail; J4 — annotate + delete actions                |
| `/checkin`                             | GET      | `src/app/checkin/page.tsx`                             | J5 — landing : streak + status matin/soir                                     |
| `/checkin/morning`                     | GET      | `src/app/checkin/morning/page.tsx`                     | J5 — wizard 5 étapes (sleep → routine → body → mind → intention)              |
| `/checkin/evening`                     | GET      | `src/app/checkin/evening/page.tsx`                     | J5 — wizard 5 étapes (discipline → hydratation → stress → mental → réflexion) |
| `/api/cron/checkin-reminders`          | POST     | `src/app/api/cron/checkin-reminders/route.ts`          | J5 — scan reminders (X-Cron-Secret gate)                                      |
| `/api/cron/recompute-scores`           | POST     | `src/app/api/cron/recompute-scores/route.ts`           | J6 — nightly recompute behavioral scores (X-Cron-Secret gate, `0 2 * * *`)    |

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

### Magic link "mot de passe oublié" — DIFFÉRÉ à J1.5

Le SPEC §15 J1 mentionne "Magic link 'mot de passe oublié'". Volontairement reporté pour ne pas mêler au flow Credentials :

- L'Email provider d'Auth.js v5 fonctionne mal avec strategy=jwt + Credentials.
- L'implémentation custom (`PasswordResetToken` + email Resend) est straightforward mais ajoute une migration et plusieurs routes : à faire en sous-jalon J1.5 si Eliot en a besoin avant J2.

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

## Theme (Tailwind 4) — DS-v2 (palette pivot Sprint #1, lime + Geist + Mercury shadows)

Variables CSS dans `src/app/globals.css`. Mode sombre uniquement V1.

- **Deep-space backgrounds** : `--bg`, `--bg-2`, `--bg-3` (du plus sombre au moins).
- **Text tokens tone-aware** : `--t-1`, `--t-2`, `--t-3`, `--t-4` (du plus contrasté au plus muté ; tous WCAG AA-validés).
- **Lime accent** : `--acc`, `--acc-hi` (hover), `--acc-dim` / `--acc-dim-2` (halos), `--acc-fg` (foreground sur fond lime).
- **Sémantique** : `--bad`, `--bad-dim`, `--cy` (info), `--cy-dim`.
- **Borders** : `--b-default`, `--b-strong`, `--b-acc`, `--b-danger`.
- **Typo** : `Geist` (sans + mono), tailles `t-h1`, `t-h2`, `t-body`, `t-cap`.
- **Mercury shadows** : `--sh-btn-pri`, `--sh-btn-pri-hover`, `--sh-tooltip`, `--sh-toast`.
- **Curves** : `--e-smooth` (220ms ease-out), `--e-spring`.
- `@layer base` pour les resets globaux + `@media (prefers-reduced-motion: reduce)` actif.

> Note historique : la palette SPEC §8.1 (bleu `#2563eb`/`#0a0e1a`) a été remplacée par DS-v2 lime/deep-space pendant le Sprint #1 (handoff Claude Design 2026-05-06). Validée visuellement par Eliot. Voir SPEC §20.1 pivot row "Palette".

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

## J2 — Journal de trading (livré 2026-05-05)

### Modèle de données

- `Trade` (table `trades`) — voir `prisma/schema.prisma` + migration `20260505160000_j2_trade`. Enums Postgres : `TradeDirection`, `TradeSession`, `TradeOutcome`, `RealizedRSource`. Indexes `userId`-leading (composite avec `enteredAt DESC`, `createdAt DESC`, `closedAt`).
- Lifecycle : créé en open (`closedAt = NULL`), clôturé via `/journal/[id]/close` (single transaction qui calcule `realizedR`).
- `realizedR` est calculé en `lib/trading/calculations.ts` : si `stopLossPrice` valide → `(exit-entry)/(entry-SL)` signé, source `computed` ; sinon fallback `plannedRR | -1 | 0` selon outcome, source `estimated`.
- **Déviation contrôlée du SPEC §6.2** : ajout des champs `stopLossPrice` (optionnel, recommandé) et `realizedRSource`. Permet un R réalisé exact quand le stop-loss est saisi, et un fallback intelligent sinon.
- **Screens** : 2 colonnes nullable `screenshotEntryKey` / `screenshotExitKey` plutôt qu'un array (KISS — V1 a 2 instances connues, on monte une `TradeScreenshot` table en V2 si plus besoin).

### Storage abstraction (`lib/storage/`)

Interface unifiée `StorageAdapter` (`put`, `getReadUrl`, `delete`) avec 2 implémentations :

- `LocalStorageAdapter` (J2 — utilisé tant que R2 pas configuré) : écrit dans `<UPLOADS_DIR>` (default `<cwd>/.uploads`, gitignored). Reads via le route handler GET `/api/uploads/[...key]` qui re-vérifie l'auth + ownership avant de stream.
- `R2StorageAdapter` (stub J2, à wirer quand Eliot a les keys) : voir checklist détaillée dans `lib/storage/r2.ts`. Le SDK AWS n'est PAS installé en J2 — éviter le bloat avant d'en avoir besoin.

Sélection : `selectStorage()` lit l'env. Si `R2_ACCOUNT_ID` + 3 autres R2\_\* sont set → R2, sinon → local.

**Sécurité couches obligatoires** (cf. CVE-2025-27210 + OWASP path traversal) :

1. Allowlist regex stricte sur la storage key : `trades/{userId-cuid}/{nanoid32}.{jpg|png|webp}`. `parseTradeKey` rejette `..`, `/`, control chars.
2. `path.normalize` + `startsWith(root + sep)` check + reject Windows device names (`CON`, `AUX`, `NUL`, `COM1…`, `LPT1…`).
3. Server-issued filenames via `nanoid(32)` — clients ne contrôlent jamais le nom.
4. MIME validation 2 couches : header `Content-Type` allowlist + magic-byte sniff (`sniffImageMime` — JPEG/PNG/WebP only). Détecte les renames d'extension + spoof Content-Type.
5. Taille max 8 MiB par image (`MAX_SCREENSHOT_BYTES`).
6. Auth gate dans `POST /api/uploads` ET `GET /api/uploads/[...key]` (defense in depth — le proxy gate l'a déjà fait).
7. GET enforce ownership : userId dans la key doit matcher la session, sauf admin (admins voient les screens des membres pour annoter en J4).

**Bypass NFT** : `local.ts` utilise `path.resolve(/* turbopackIgnore: true */ process.cwd(), '.uploads')` pour empêcher Next File Trace de drag tout le repo dans le bundle.

### Wizard mobile-first (`components/journal/trade-form-wizard.tsx`)

6 étapes, animation slide horizontal via `framer-motion` `<AnimatePresence mode="wait">` :

1. Quand & quelle paire (datetime-local + datalist 12 paires)
2. Direction + Session (radio cards, session auto-détectée + override)
3. Prix entrée + Lot + Stop-loss (optionnel)
4. R:R prévu (slider 0.5–10, step 0.25)
5. Discipline (plan + hedge tri-state) + Émotion(s) avant (max 3 tags)
6. Capture avant entrée (drag & drop + magic-byte client check + serveur revalide)

State management : `useState` pur (pas RHF — wizard simple, RHF apporterait du bloat ici). Brouillon persisté dans `localStorage` (key `fxmily:journal:draft:v1`) — re-hydration au mount, sync à chaque change. Le brouillon est vidé au submit réussi.

**Validation** : `tradeOpenSchema.safeParse` à chaque `next()` sur les champs de l'étape uniquement (pas un coup global, pour pas afficher les erreurs des steps non encore visités). Le serveur re-valide tout (`createTradeAction`).

**Pourquoi pas de step 7 "outcome" dans le wizard** : SPEC §7.3 décrit 2 phases (avant/après). Côté UX, mélanger les deux dans 1 wizard force le user à attendre la sortie de trade avant de logger l'entrée. On créé en open au step 6 → /journal/[id] → "Clôturer maintenant" ouvre /journal/[id]/close (formulaire dédié non-wizard, plus simple, pré-rempli).

### Constantes (`lib/trading/`)

- `pairs.ts` — 12 paires validées par Eliot 2026-05-05 (forex majors + métaux + indices US). Helpers `assetClassOf`, `pricePrecisionOf`, `isTradingPair`.
- `emotions.ts` — 15 tags FR (slugs EN), 3 clusters (Douglas-fears + states + biases). `EMOTION_MAX_PER_MOMENT = 3` cap UI.
- `sessions.ts` — bands UTC simples (00–07 asia, 07–12 london, 12–16 overlap, 16–21 newyork). Pas de DST hardcodé — `Intl.DateTimeFormat`/`Date` natif gère via les offsets ISO. Pour finer: pivot vers `@js-joda/core` au J6 si analytics le réclame.

### Server Actions (`app/journal/actions.ts`)

- `createTradeAction` — Zod re-parse FormData, `createTrade` (service), audit, `revalidatePath('/journal')`, `redirect`.
- `closeTradeAction(tradeId)` — bound action (curry). Calcule `realizedR` dans le service. Refuse si déjà clôturé (`TradeAlreadyClosedError`).
- `deleteTradeAction(tradeId)` — soft check via `deleteMany({ where: { id, userId } })` qui n'efface que si owner.

Tous re-throw `NEXT_REDIRECT` (pattern J1).

### Service layer (`lib/trades/service.ts`)

User-scoped uniquement. Pour l'admin (J3+), on créera un `lib/trades/admin-service.ts` séparé. Expose `SerializedTrade` (Decimal → string, Date → ISO) pour passer aux client components — RSC ne peut pas serialize `Decimal` nativement.

### TODO J2 → J3+

- **R2 wiring** (dès qu'Eliot a les keys) : `pnpm add @aws-sdk/client-s3 @aws-sdk/s3-request-presigner` + impl `R2StorageAdapter` (checklist dans `r2.ts`). Update CSP `img-src` pour autoriser le custom domain R2 (J10). À noter : si seulement 1–3 des 4 vars R2\_\* sont set, `selectStorage()` log un warning au boot et retombe sur le local FS.
- **J3** (espace admin & vue membre) : `lib/trades/admin-service.ts`, route `/admin/members/[id]/trades`, middleware `requireAdmin` réutilise le pattern `auth.config.ts`.
- **J4** (workflow d'annotation) : table `TradeAnnotation` + upload vidéo (limit 500 MiB côté client, retry stratégie côté UI), notification queue.
- **J6** (track record analytics) : exclude `realizedRSource = 'estimated'` des aggregats expectancy / R-distribution. Garder dans win-rate (le sample reste un win).
- **J10** (prod hardening) — checklist enrichie post-audit J2 :
  - CSP nonces (remplacer `'unsafe-inline'`).
  - Rate limiting `/api/auth/*` + `/api/uploads` (probablement `@upstash/ratelimit` + Redis).
  - Body streaming pour `/api/uploads` au lieu de `req.formData()` (qui buffer 8 MiB en RAM avant validation taille). Vérifier `client_max_body_size` du reverse-proxy (Caddy/nginx) ≥ 10 MiB.
  - `trustHost: true` à reconsidérer en prod si pas derrière un proxy strict.
  - Sentry (client + serveur).
  - RGPD endpoints (`/api/account/export`, `/api/account/delete`) + cron purge des `.uploads/` orphelins (J2 pre-R2).
  - TOCTOU `Content-Length` dans GET stream — refactor pour fstat sur le fd plutôt que stat avant ouverture.

## J4 — Workflow d'annotation admin (livré 2026-05-06)

### Modèle de données

- `TradeAnnotation` (table `trade_annotations`) — voir `prisma/schema.prisma` + migration `20260506100000_j4_trade_annotation`. Enum Postgres `AnnotationMediaType` (`image` | `video`). Cascade sur `Trade` ET sur `User` (V1 = solo admin Eliot ; V2 multi-admin → switcher en `SetNull` + `adminId` nullable). Indexes `(tradeId, createdAt DESC)`, `(tradeId, seenByMemberAt)`, `(adminId, createdAt DESC)`.
- `NotificationQueue` (table `notification_queue`) — enums `NotificationType` (`annotation_received` à J4, extensible) + `NotificationStatus` (`pending` | `sent` | `failed`). Indexes `(status, scheduledFor)` (worker hot-path J9), `(userId, createdAt DESC)`. À J4 on persiste l'intention ; le dispatcher Web Push est J9.
- **Déviation contrôlée** : V1 J4 ship **image-only** (8 MiB). La vidéo Zoom 500 MiB du SPEC §7.8 est repoussée à **J4.5** car le path `req.formData()` actuel buffer-tout-en-RAM (incompatible 500 MiB) + R2 pas wired. UI prête (slot vidéo désactivé avec libellé J4.5 explicite).

### Storage

Préfixe ajouté : `annotations/{tradeId}/{nanoid32}.{jpg|png|webp}`. Le path-owner est le **trade id**, pas le user id : ownership member-side se résout via un seul `db.trade.findUnique({ select: { userId } })`. Helpers : `generateAnnotationKey`, `parseAnnotationKey`, `parseStorageKey` (discriminated union sur `kind: 'trade' | 'annotation'`). Le contrat `StorageAdapter.put({ kind, pathOwner, ... })` est generic ; route handler choisit.

`POST /api/uploads` accepte le nouveau `kind: 'annotation-image'` avec gate role=admin + champ `tradeId` requis. `GET /api/uploads/[...key]` dispatch sur le préfixe : trade-key → check userId in path, annotation-key → lookup trade.userId.

### Server Actions

- `app/admin/members/[id]/trades/[tradeId]/actions.ts` :
  - `createAnnotationAction(memberId, tradeId)(prev, formData)` : auth + role admin → Zod re-parse → BOLA check `parseAnnotationKey(mediaKey).tradeId === tradeId` → trade-owner check `trade.userId === memberId` → service create + enqueue + email best-effort + audit + revalidate. Sur échec après upload média, cleanup orphelin via `storage.delete()`.
  - `deleteAnnotationAction(annotationId)` : reads first → cleanup média → `deleteMany({ id, adminId })` (refuse si autre admin) → audit + revalidate.

### UI

- **Admin** : `<AnnotateTradeButton />` ouvre un `<Sheet side="bottom">` mobile-first. Form = textarea (compteur live, max 5000) + `<MediaUploader kind="annotation-image">` générique. Wrapper-action pattern pour reset/close on success (pas de `useEffect` setState — lint react-hooks/set-state-in-effect).
- **Membre** : `<TradeCard unseenAnnotationsCount>` affiche pill lime "1 nouvelle correction" / "N nouvelles corrections" (live dot). Au render de `/journal/[id]`, `markAnnotationsSeenForTrade(userId, id)` bulk-update les rows non-vues (1 round-trip, index `(tradeId, seenByMemberAt)`) — pas de bouton "Marquer lu" séparé.
- **Section partagée** : `<AnnotationsSection />` (Server Component) — admin voit "Corrections envoyées" + delete + pill "Non lue" sur les non-vues ; membre voit "Corrections reçues" read-only + pill "Capture jointe" si média.

### Email

`AnnotationReceivedEmail` (React Email v2 lime sur deep space, hex inline pour compat). Posture athlète/coaching : la correction est un point d'amélioration, pas une critique. `sendAnnotationReceivedEmail` est appelée fire-and-forget (jamais await) après `createAnnotation` — un échec Resend ne rollback pas la création.

### Tests

- 199 unit (Vitest) — +30 storage + 12 schema annotation + 3 buildTradeDetailUrl.
- E2E public surface dans `tests/e2e/admin-annotation.spec.ts` : auth gate sur la route admin, sur POST `/api/uploads` (kind annotation-image), sur GET `/api/uploads/<annotation-key>`. Le full happy-path (admin annote → membre voit badge → ouvre → seenByMemberAt set) attend le helper de seed Postgres cross-jalon.

### TODO J4 → J4.5+

- **J4.5** (vidéo Zoom 500 MiB) : presigned PUT R2 (bypass streaming serveur) OU refactor body-streaming via `req.body` Web Streams. Activer `video/mp4` dans `ALLOWED_*_MIME_TYPES`, `MAX_VIDEO_BYTES = 500 MiB`, magic-byte `ftyp` box (offset 4–7 = `66 74 79 70`). Étendre `KEY_REGEX_ANNOTATION` pour `.{mp4|webm}`. CSP `media-src` avec custom domain R2.
- **J9** (web-push dispatcher) : worker qui consomme `NotificationQueue` (status=pending, scheduledFor null/elapsed) → `web-push` lib + VAPID. Marquer `sent` ou `failed` + retry budget.
- **J10** : delete cascade audit log → V2 multi-admin necessite `onDelete: SetNull` + `adminId` nullable côté `TradeAnnotation`.

## J5 — Tracking quotidien (livré 2026-05-06)

### Modèle de données

- `DailyCheckin` (table `daily_checkins`) — voir `prisma/schema.prisma` + migration `20260506200000_j5_daily_checkin`. Enum Postgres `CheckinSlot` (`morning` | `evening`). Cascade sur `User` delete (RGPD : data minimisation).
- **Single-table-per-slot** : un seul modèle pour matin + soir avec `slot` discriminant. La majorité des colonnes sont nullable côté DB, les schémas Zod (`lib/schemas/checkin.ts`) imposent les contraintes par slot. Choix : permet aux V2 ("backfill partiel", "remplis ce que tu te souviens") de réutiliser la même table sans migration.
- **Date locale** : `date` est `@db.Date` (pas timestamp), anchored au calendrier local du membre via `User.timezone` (default `Europe/Paris` per SPEC §6.1). Tous les helpers de conversion vivent dans `lib/checkin/timezone.ts`.
- **Unique** : `(userId, date, slot)` — fillage matin 2× le même jour = upsert sur la même row, jamais de duplicates.
- **Indexes** : `(userId, date DESC)` pour le streak walker / dashboard, `(userId, slot, date DESC)` pour le weekly report J8.
- `NotificationType` étendu avec `checkin_morning_reminder` + `checkin_evening_reminder` (J4 avait juste `annotation_received`). Ajout via `ALTER TYPE ADD VALUE IF NOT EXISTS` dans la migration.

### Constantes (`lib/checkin/`)

- `emotions.ts` — 14 tags FR (slugs EN), 3 clusters (vitality / mood / pressure). Distinct du set trade : on tracke "rested", "tired", "foggy" (pertinent au matin) plutôt que les "fears Mark Douglas" (pertinents pour un trade). Cap à 3 tags par slot. **Sélection optionnelle** (vs trade où ≥1 obligatoire) — mood score reste le signal requis.
- `routine.ts` — 5 suggestions affichées en lecture sur le step "Routine" du wizard matin. V1 ship un seul booléen `morningRoutineCompleted` ; V2 prévue pour passer à un schéma `MorningRoutineItem` configurable par membre.
- `timezone.ts` — helpers Intl.DateTimeFormat (Node 22 ICU full) : `localDateOf` (UTC instant → YYYY-MM-DD local), `parseLocalDate` (YYYY-MM-DD → UTC midnight Date pour Postgres `@db.Date`), `shiftLocalDate` (±N jours), `formatLocalDate` (FR human "lundi 6 mai 2026"), `isMorningReminderDue` / `isEveningReminderDue` (windows 07:30–09:00 / 20:30–22:00 local). 21 unit tests.
- `streak.ts` — algo pure : streak = jours consécutifs avec ≥1 check-in (matin OU soir), walking back depuis `today`. Today inclus seulement si déjà filled — un membre qui n'a pas check-in à 14h conserve le streak d'hier. **13 unit tests TDD-first** (gaps, month/year boundaries, future-dated rows).

### Schemas Zod (`lib/schemas/checkin.ts`)

- `morningCheckinSchema` : sleep + sleepQuality + routine + meditation + sport (paire ou rien) + mood + intention + emotionTags. **Footgun évité** : `z.coerce.boolean()` est cassé (`Boolean('false')` = true), on utilise un `formBoolean` explicite (`z.union([z.boolean(), z.literal('true'), z.literal('false')])`).
- `eveningCheckinSchema` : planRespected (formBoolean) + hedgeRespected (tri-state via `triStateBoolean` qui mappe `'na'` → null) + caffeineMl (optional 0-2000) + waterLiters (optional Decimal 0-10) + stressScore (1-10) + mood + emotionTags + journalNote (max 4000) + gratitudeItems (≤3, ≤200 chars chacun, empties dropped via transform).
- `localDateSchema` : YYYY-MM-DD avec calendar validity check (rejette 2026-13-01, 2026-02-30).
- `dateInWindow` : ≥ 2020-01-01, ≤ TODAY+1 UTC (drift Tokyo↔NY), ≥ TODAY-60 (backfill cap).
- **29 unit tests** dans `checkin.test.ts`.

### Service layer (`lib/checkin/service.ts`)

User-scoped strict. Fonctions :

- `submitMorningCheckin(userId, input)` / `submitEveningCheckin(userId, input)` — `upsert` keyed sur `(userId, date, slot)`. Idempotent : 2 submit du matin updates, ne stack pas.
- `getCheckinStatus(userId, timezone, now?)` → `{ today, morningSubmitted, eveningSubmitted }` pour la landing /checkin et le dashboard.
- `getStreak(userId, timezone, now?)` → `{ current, todayFilled, today }`. Lit les 60 derniers jours, collapse à un Set de dates, feed `computeStreak`.
- `listRecentCheckinDays(userId, today, windowDays=60)` → CheckinDay[] pour streak + weekly report.
- `getCheckin(userId, date, slot)` → SerializedCheckin | null pour édition future.
- Expose `SerializedCheckin` : Decimal → string, Date → ISO/YYYY-MM-DD pour client components.

### Server Actions (`app/checkin/actions.ts`)

- `submitMorningCheckinAction` / `submitEveningCheckinAction` (pattern J1 : auth() re-check, Zod parse, service call, audit, revalidatePath, redirect re-throw NEXT_REDIRECT).
- Redirection sur `/checkin?slot=morning&done=1` après submit pour afficher la confirm-flash banner sur la landing.

### Wizards mobile-first

`<MorningCheckinWizard>` (5 étapes : Sommeil / Routine / Corps / Mental / Intention) et `<EveningCheckinWizard>` (5 étapes : Discipline / Hydratation / Stress / Mental / Réflexion). Pattern identique au trade wizard (`useState` + localStorage draft + Framer Motion `<AnimatePresence mode="wait">`). Drafts persistés sous `fxmily:checkin:{morning|evening}:draft:v1`, vidés au submit réussi.

### Dashboard intégration (`app/dashboard/page.tsx`)

- KPI strip : "Discipline" remplacé par "Streak" (jours consécutifs, tone acc/warn/mute selon état).
- Nouvelle section "Check-in du jour" : 2 chips compactes (Matin / Soir) + StreakCard à droite.
- "Bientôt" — la card "J5 check-ins" retirée puisque livrée ; ajout "Rapport hebdo IA J8" pour garder 3 cards.

### Composants (`components/checkin/`)

- `<ScoreSlider>` — slider 1-10 réutilisable (mood, sleep quality, stress) avec gradient track tone-aware (`acc` lime, `cy` cyan, `warn` ok→warn→bad). `aria-valuetext` injecte le mot sémantique du `describeAt` (SR lit "7 sur 10, Calme"). `peer-focus-visible` ring sur le custom thumb (l'`<input type="range">` invisible ne pouvait pas exposer son outline). `threshold-pulse` lors d'une transition de bande sémantique (mood "Neutre" → "Calme") — pas à chaque step pour ne pas spammer le SR.
- `<EmotionCheckinPicker>` — multi-select grid type EmotionPicker du J2, mais sur le set checkin (vitality / mood / pressure) et avec sélection optionnelle. Compteur `aria-hidden` + sr-only `aria-live` qui n'annonce QUE quand le cap est atteint (was: "polite" qui spam à chaque toggle).
- `<StreakCard>` — props `streak`, `todayFilled`, `compact?`. Compact pour le dashboard, full pour la landing /checkin. Flame `--acc` (1-6 j) → `--warn` + `flame-flicker` (7+ j) → `--warn` + `flame-pulse` (30+ j "deep habit"). 4-tick milestone strip (7 / 14 / 30 / 100). Pattern "mercy infrastructure" Yu-kai Chou : pas de pill "EN FEU" Snapchat, pas de gamification toxique. SR-only "Palier N franchi" annonce les milestones.
- `<MorningCheckinWizard>` / `<EveningCheckinWizard>` — 5 steps each. RadioGroup wire les keyboard arrows (ARIA APG) + focus-on-error (jump au premier step invalide). `parseLocaleNumber(s) = Number(s.replace(',', '.'))` partout pour absorber la virgule décimale FR (iOS Safari FR + Android Chrome FR acceptent "7,5" mais `Number("7,5") === NaN`).

### Cron reminders (`api/cron/checkin-reminders` + `lib/checkin/reminders.ts`)

- POST `/api/cron/checkin-reminders` protégé par header `X-Cron-Secret`. Sans `CRON_SECRET` configuré → 503 (refuse-by-default, pas de fallback unsafe). Header invalide → 401. GET → 405.
- **Comparison constant-time** (J5 audit fix CWE-208) : `crypto.timingSafeEqual` après hashage SHA-256 des deux côtés (sidesteps length-leak Cloudflare pitfall).
- **`?at=ISO` dev override** : double-gate `NODE_ENV !== 'production'` AND `AUTH_URL` not HTTPS-prod-style — défense contre `NODE_ENV` oublié dans systemd qui ferait fallback Zod sur 'development'.
- `runCheckinReminderScan(now?, options?)` : early-return si on est hors des windows matin/soir (`isMorningReminderDue` / `isEveningReminderDue` sur Europe/Paris en V1) → 1 audit row, zero DB churn. Sinon : 1 query `findMany({ status: active, role: member })` + 1 bulk query `dailyCheckin.findMany({ userId IN (...), date IN (todays) })` puis dispatch in-memory. **O(1) DB round-trips, plus O(users)** — supporte la cible "milliers de membres" du SPEC.
- 1 audit row par scan (`checkin.reminder.scan` + metadata counts ± `reason: 'out_of_window'`), pas par user — heartbeat propre dans `audit_logs`.
- **Wiring prod attendu** : `*/15 7-22 * * *` sur Hetzner → curl avec `X-Cron-Secret`. Le dispatch Web Push reste J9 ; à J5 on enqueue, le worker walk les rows `pending` plus tard.
- **Race-safe enqueue** : `enqueueCheckinReminder` dans `lib/notifications/enqueue.ts` `INSERT` direct + catch Prisma `P2002` sur l'index unique partial `notification_queue_pending_checkin_dedup` (migration `20260507100000_j5_notification_dedup`). Deux enqueues concurrents convergent sur 1 row côté DB. Test live confirmé : 3 runs cron successifs → toujours 4 rows en queue, jamais 6 ou 12.

### Env (`lib/env.ts`)

Nouvelle var `CRON_SECRET` (optionnelle) min 24 chars. Pas de default — l'endpoint 503 en absence.

### TODO J5 → J5.5+ / J6 / J9

- **J5.5** (timezone par membre) : actuellement le service hardcode `Europe/Paris` dans `dashboard/page.tsx`, `checkin/page.tsx`, `checkin/{morning,evening}/page.tsx`. À refactor : exposer `User.timezone` dans le JWT (callback `jwt`/`session` dans `auth.config.ts`) ou re-fetch depuis `db.user.findUnique` dans la page Server Component. La pickline en V1 tient parce que tous les members sont en France.
- **J5.5** (édition d'un check-in déjà soumis) : actuellement le wizard upsert mais charge un draft localStorage neuf. Pour permettre d'éditer un check-in déjà submit, charger via `getCheckin(userId, today, slot)` au mount et hydrater le draft avec.
- **J5.5** (routine personnalisable) : remplacer `morningRoutineCompleted` boolean par une table `MorningRoutineItem` + checklist multi-choix. Stocker l'historique `MorningRoutineCompletion(userId, date, itemId)`. Surface admin `/admin/settings/routines`.
- **J6** (scoring engagement) : utiliser `getStreak` + `listRecentCheckinDays` pour la fenêtre 30j. Composante "engagement score" = (jours filled / 30) × 100, pondéré par le ratio matin+soir vs single-slot.
- **J6** (analytics croisés) : `DailyCheckin.sleepHours × Trade.realizedR` sur 30j → corrélation. `DailyCheckin.stressScore × Trade.outcome` → tendance. Tout déterministe en `lib/scoring/*`.
- **J8** (weekly report builder) : agréger morning + evening de la semaine pour le prompt Claude. Index `(userId, slot, date DESC)` est là pour ça.
- **J9** (web-push dispatcher) : pour `checkin_*_reminder`, payload `{ slot, date }` + URL `/checkin/{slot}`. Snooze button = mark `dispatched_at` mais pas `sent`.

## J5 audit-driven hardening (2026-05-07)

Après le commit initial J5 du 2026-05-06, 5 audits parallèles (code-reviewer, security-auditor, accessibility-reviewer, ui-designer, fxmily-content-checker) + 8 recherches web (Mark Douglas, streak ethics Yu-kai Chou, Node `timingSafeEqual`, Postgres `@db.Date` pitfalls, CSRF Next.js 16, ARIA slider WCAG 2.2, Zod 4 transforms, Whoop/Oura UX) ont identifié 13 ship-blockers + ~25 HIGH. **Tous les TIER 1 + TIER 2 fixes appliqués** (+5 commits, +14 tests TDD, smoke-test live validé). Le rapport complet est résumé ici.

### Smoke-test live validé (Postgres `fxmily-postgres-dev` healthy + dev server `pnpm dev`)

Via curl, en parallèle au dev server tournant :

| Test                                                          | Résultat attendu         | Réel                                                       |
| ------------------------------------------------------------- | ------------------------ | ---------------------------------------------------------- |
| `GET /api/health`                                             | 200 + db ok              | ✓ 200 + `{"status":"ok","db":"ok"}`                        |
| `GET /checkin` (no auth)                                      | 307 → /login             | ✓                                                          |
| `GET /checkin/morning` (no auth)                              | 307 → /login             | ✓                                                          |
| `GET /checkin/evening` (no auth)                              | 307 → /login             | ✓                                                          |
| `POST /api/cron/checkin-reminders` (no secret)                | 401                      | ✓                                                          |
| `POST /api/cron/checkin-reminders` (wrong secret)             | 401                      | ✓                                                          |
| `GET /api/cron/checkin-reminders`                             | 405                      | ✓                                                          |
| `POST /api/cron/...?at=2026-05-06T06:30:00Z` (morning window) | 200 + scan 2 morning     | ✓ `enqueuedMorning: 2`                                     |
| `POST /api/cron/...?at=2026-05-06T18:45:00Z` (evening window) | 200 + scan 2 evening     | ✓ `enqueuedEvening: 2`                                     |
| `POST /api/cron/...?at=2026-05-06T12:00:00Z` (out of window)  | 200 + scan 0 + reason    | ✓ `reason: "out_of_window"`                                |
| **Idempotency** : 3× même run morning                         | 4 rows en queue (pas 12) | ✓ — confirmé via `SELECT COUNT(*) FROM notification_queue` |

### TIER 3 fixes appliqués dans cette PR (post-push hardening)

Trois fixes haut-impact ajoutés après le push initial :

- **Security HIGH H3 FIXÉ** (`01d5b41`) : JWT `update()` callback bypass — le bloc `trigger === 'update'` qui acceptait `session.role`/`session.status` client-supplied a été RETIRÉ d'`auth.config.ts`. Aucun call site existant (`grep` zero hit), c'était dead attack surface. Smoke-tested live post-fix.
- **Security MEDIUM M5 FIXÉ** (`e73c67c`) : nouveau helper `lib/text/safe.ts` (`safeFreeText` + `containsBidiOrZeroWidth` + `graphemeCount`, 19 tests TDD) appliqué sur `intention` / `journalNote` / `gratitudeItems` / `sportType`. NFC normalize + strip 8 control chars (zero-width, BOM, legacy + modern bidi). **Bloque le vecteur Trojan Source pour le futur prompt Claude J8** (RTL override invisible qui réordonne l'output LLM).
- **A11y HIGH H1 + H7 FIXÉ** (`ce0291a`) : touch targets emotion chips bumpés `min-h-9` → `min-h-11` (44px WCAG 2.5.5 AAA). `tabIndex={-1}` sur les chips inert (cap atteint) — sortis du tab order, restent visibles + announced.

### J5.5 — propagation timezone JWT + dernières finitions (post TIER 4)

Deux commits qui ferment les J5.5 backlog items immédiats :

- **JWT TZ claim plumbing** (`e4e0390`) : `User.timezone` est désormais sourcée du JWT-backed `session.user.timezone` dans toutes les pages (`/dashboard`, `/checkin`, `/checkin/morning`, `/checkin/evening`) + Server Actions (`submitMorning/EveningCheckinAction`). Élimine 4 hardcodes `'Europe/Paris'` qui restaient. Backwards-compat : sessions JWT pré-fix gardent le default `Europe/Paris` jusqu'au prochain login. Vraiment multi-TZ-ready maintenant.
- **A11y heading + null/undefined alignment** (`a7de07f`) : `<h1>` programmatic-focus du wizard a `outline-none focus-visible:outline-none` (le SR garde le focus, pas d'artefact visuel). Schémas Zod `intention` + `journalNote` émettent `null` directement (pas `undefined`) — aligne avec le type colonne nullable text + `exactOptionalPropertyTypes` strict du tsconfig. Service drop le `?? null`. Tests adaptés.

### TIER 4 fixes appliqués (premium polish + dernières surfaces sécurité)

Six fixes additionnels après TIER 3 qui ferment les UI BLOCKER B1+N2 et les 2 dernières surfaces sécurité :

- **Content Mark Douglas Card FIXÉ** (`913d56c`) : audit séparé sur `<MarkDouglasCard>` du dashboard — 3 truths #2/#3/#4 étaient tronquées ou réécrites, restaurées au texte canonique de _Trading in the Zone_ ch. 11. `<cite>` "paraphrasé" → "citations + paraphrases" pour distinguer `short` (citation) vs `full` (paraphrase). Stat Sharpe +22% fabriquée retirée du JSDoc (anti-hallucination).
- **Security HIGH H2 FIXÉ** (`af5447f`) : token bucket rate limit in-memory + LRU sur `/api/cron/checkin-reminders` (burst 5, refill 1/min, maxKeys 1024). 10 tests TDD. Migration path Redis ready pour J10. Smoke-test live confirmé : 5 POST → 200, 6e+7e → 429 + `Retry-After`.
- **Security MEDIUM M2 FIXÉ** (`9a4b0b2`) : `assertCheckinDateInLocalWindow` côté service rejette les dates > today_local + 1. `CheckinDateOutOfWindowError` catché dans Server Actions → `fieldErrors.date`. V1 default Europe/Paris, J5.5-ready (option `timezone`).
- **UI HIGH H3 FIXÉ** (`8efbef6`) : haptic feedback PWA — `lib/haptics/index.ts` (3 fonctions : `hapticTap` / `hapticSuccess` / `hapticError`). Layered fallback : Android `navigator.vibrate` → iOS Safari 18+ via `<input type="checkbox" switch>` programmatic click hack → silent no-op iOS ≤17. Respecte `prefers-reduced-motion`. Wired dans les 2 wizards (goToStep + submit success/error).
- **UI BLOCKER B1 FIXÉ** (`4bb2ed0`) : `<SleepZonesBar>` — diagramme pédagogique 4 zones (Dette / Court / Cible / Long) sur le step Sommeil matin, caret live + threshold-pulse aux franchissements. Ferme le gap "wow factor" avec le `StepPlannedRR` du J2. Anchor scientifique : Walker _Why We Sleep_ + Steenbarger _Trading Psychology 2.0_.
- **UI N2 FIXÉ** (`55af627`) : `<TrendCard>` — 7-day sparklines sleep + mood sur la landing /checkin. Wrap le `<Sparkline>` qui dormait inutilisé dans le DS. Service `getLast7Days(userId, timezone)` ajouté (1 indexed query + grouping in-memory). Empty state friendly. Surface "in-product" du progrès hebdo, sans attendre J6.

Total **TIER 1+2+3+4** : 27 fichiers nouveaux/modifiés, **317 tests verts** (+10 token-bucket TDD vs TIER 3 fin), build prod OK, smoke-test live couvre cron secret/idempotency/rate-limit + auth gates + DB.

### Follow-ups encore en backlog (non bloquants pour J5)

- **A11y MEDIUM** : heading focus outline cleanup (H3), DoneBanner re-fade timer client component (M9 - actuellement une seule rétention `?done=1` dans l'URL).
- **UI BLOCKER B2 (Streak milestones premium)** : `<StreakCard>` actuelle a déjà flame-flicker + 4-tick milestones strip ; le "premium full" voudrait une illustration animée (Lottie ou SVG) au-dessus du big number quand `ablaze`. Reporté J5.5.
- **Code MEDIUM M5** : `MorningCheckin.intention` schema retourne `undefined` mais service écrit `null` — incohérence type-safety mineure (mismatch entre `exactOptionalPropertyTypes` et le `?? null` du service).
- **J5.5 multi-TZ** : propager `User.timezone` dans le JWT + plumber dans les Server Actions (`submitMorningCheckin({ timezone })`). Aujourd'hui la valeur est hardcodée `Europe/Paris` dans les pages — V1 OK car tous les members FR.
- **Tests E2E full** : le happy-path login → wizard → streak++ attend toujours le helper de seed Postgres cross-jalon. Public surface E2E couverte (auth gates).
- **Apple Health / Whoop / Oura sync (V2)** : SPEC §6.4 reste manuel V1, mais le `DayPoint` schema + sleep zones diagram sont prêts pour passive ingestion plus tard (recherche 2026 montre que c'est le pattern dominant).

## J6 — Dashboard track record & scoring comportemental (livré 2026-05-07)

### Modèle de données

- `BehavioralScore` (table `behavioral_scores`) — voir `prisma/schema.prisma` + migration `20260507124321_j6_behavioral_score`. 4 colonnes `Int?` nullable pour les scores (null = `insufficient_data`, pas de fake 0/100). 2 colonnes `Json` (`components` = breakdown sous-scores pour transparence UI ; `sample_size` = guards par dimension + counters). `windowDays` Int default 30 (Mark Douglas habit window). Cascade `User.delete`. Unique `(userId, date)` pour idempotency cron.

### Analytics layer (`lib/analytics/`)

Pure-functions, server-only, no DB. Mark Douglas posture: **toujours surfacer le sample size**, jamais mentir avec `n=4`. 94 tests TDD.

- `wilson.ts` — `wilsonInterval(s, n, c='c95')` retourne `{point, lower, upper, sufficientSample}`. Formule asymétrique (n shrinkage) qui reste dans [0,1] aux boundaries. Z-scores pour 90/95/99%. Threshold UI `SUFFICIENT_SAMPLE_MIN = 20`. Match scipy.stats.proportion_confint à 1e-12.
- `correlations.ts` — `pearson`, `spearman` (avec rankWithTies average-rank), `sampleVariance`/`sampleStdDev` Welford-stable, `coefficientOfVariation`, `median`. Min 8 paires pour `pearson`/`spearman`.
- `expectancy.ts` — `computeExpectancy(trades)` retourne `{expectancyR, profitFactor, avgWinR, avgLossR, payoffRatio, winRate, lossRate, sampleSize}`. **Exclut `realizedRSource='estimated'` des magnitudes** (pas du win-rate). PF cap à 999 quand 0 perte. Reasons explicites `'no_trades'` / `'no_computed_trades'`.
- `streaks.ts` — `computeMaxConsecutiveLoss(trades)` (chronologique, BE break le streak), `computeMaxConsecutiveWin`, `computeExpectedMaxConsecutiveLoss(n, lossRate)` formule `log(N)/log(1/LR)` (Van Tharp rule of thumb). Surface "variance normale ≠ edge cassé".
- `equity-curve.ts` — `buildEquityCurve(trades)` retourne `[{ts, r, cumR, drawdownFromPeak}]` chronologique (filtre estimated, sort par exitedAt). Reports `estimatedExcluded` + `invalidExcluded`.
- `drawdown.ts` — `computeMaxDrawdown(equityPoints)` single-pass O(n), retourne `{maxDrawdownR, peakAt, troughAt, inDrawdown, currentDrawdownR}`.

### Scoring layer (`lib/scoring/`)

4 dimensions pures avec poids = 100 chacune, sample-size guards, renormalization quand sub-score N/A. 47 tests TDD.

- `discipline.ts` — 35 plan-respect + 20 hedge-respect + 25 evening-plan + 10 intention-filled + 10 routine-completed.
- `emotional-stability.ts` — 40 mood-variance (Welford stdDev rescaled) + 25 stress-median + 20 negative-emotion-rate (slugs Douglas) + 15 recovery-after-loss (J+1 mood vs baseline). Min 14 mood-days.
- `consistency.ts` — 35 expectancy-consistency + 25 profit-factor + 20 drawdown-control + 10 loss-streak-control + 10 session-focus (entropy). 0-trade member → null + `reason='no_trades'` (no fake 0/100).
- `engagement.ts` — 50 fill-rate + 20 dual-slot + 20 streak-normalized (cap 30, anti-Snapchat) + 10 journal-depth.

### Service (`lib/scoring/service.ts`)

- `computeScoresForUser(userId, asOf?, options?)` — fetch trades + checkins en `Promise.all`, run 4 scorers, retourne `AllScoresResult` + `components` + `sampleSize`. Pure (pas de write).
- `persistBehavioralScore(userId, date, components, sampleSize)` — upsert sur `(userId, date)`.
- `recomputeAndPersist(userId, asOf?, options?)` — sugar combo.
- `recomputeAllActiveMembers(now?)` — batch 25-by-25 avec `Promise.allSettled`. Anchor = yesterday-local in `User.timezone`.
- `getLatestBehavioralScore(userId)` — dashboard read.

### Cron (`app/api/cron/recompute-scores/route.ts`)

Pattern J5 carbone — `verifyCronSecret` SHA-256 + `timingSafeEqual` (CWE-208) + `cronLimiter` token bucket (5 burst, 1/min) + 503 si pas de secret + 401/429/405 + `?at=ISO` dev override double-gated. POST → `recomputeAllActiveMembers` → 1 audit row `cron.recompute_scores.scan` avec `{computed, skipped, errors, ranAt}`.

**Wiring prod** : `0 2 * * *` UTC sur Hetzner (J10 setup).

### Dashboard data aggregator (`lib/scoring/dashboard-data.ts`)

`getDashboardAnalytics(userId, timezone, range='30d', asOf?)` retourne `DashboardAnalytics` complet : expectancy + drawdown + equity-curve + R-distribution buckets + top 5 paires + session perf + emotion×outcome rows + streaks observés. Range converti en windowDays (`'7d'` → 7, `'all'` → 3650).

### UI components (`components/scoring/`)

Tous tone-aware sur design-system tokens (acc / cy / warn / bad). Recharts (no Tremor) pour bundle léger + full design control.

- `<ScoreGauge>` (Client) — radial 0-100 SVG-natif, stroke-dashoffset animé via Framer Motion, fallback `insufficient_data` avec reason text. Score numérique statique (count-up retiré pour respecter `react-hooks/set-state-in-effect`).
- `<ScoreGaugeGrid>` (Server) — 4× ScoreGauge + skeleton + empty state pédagogique.
- `<SampleSizeDisclaimer>` (Server) — pill "12/30 jours" avec tone warn si insuffisant.
- `<TrackRecordChart>` (Client) — Recharts `AreaChart` lime gradient + range tabs (7j/30j/3m/6m/all) wired via `useRouter.push` + `useTransition` (URL searchParams).
- `<RDistribution>` (Client) — Recharts `BarChart`, buckets 0.5R, lime/red color-coded.
- `<ExpectancyCard>` + `<DrawdownStreaksCard>` (Server) — strip 4-cellules avec sample-size pill.
- `<PairTopFive>`, `<SessionPerfBars>`, `<EmotionPerfTable>` (Server, no client JS) — emotion table avec Wilson 95% CI par tag + sample-size pill `<20`.

### Refonte `app/dashboard/page.tsx`

- Server Component `force-dynamic` async, `searchParams: Promise<{ range?: string }>` parsing (Next.js 16).
- `Promise.all` parallèle racine : counts + checkin status + streak + `getLatestBehavioralScore`.
- Granular `<Suspense>` autour de `TrackRecordSection` + `PatternsSection` (sub-async-server-components qui font leur propre fetch). Fallback skeleton dimensionné.
- Coming-soon section ne contient plus J6 (livré). J7 (MD library) + J8 (rapport IA) restent.
- Mark Douglas card canonique TIER 4 préservée (no-touch).

### Test data (`scripts/seed-j6-demo.ts`)

`pnpm exec tsx scripts/seed-j6-demo.ts` provisions un demo admin (`j6demo.admin.e2e.test@fxmily.local` / `J6DemoPwd-2026!`) + 100 trades + 30 jours checkins déterministes (mulberry32 + Box-Muller, seed=42). Idempotent. Le score snapshot est calculé via le cron HTTP séparément (le service a `import 'server-only'` que tsx ne peut pas loader).

### TODO J6 → J6.5+ / J7 / J9

- **J6.5** (admin) : intégrer les scores du membre dans `/admin/members/[id]` onglet "Vue d'ensemble" (réutiliser `<ScoreGaugeGrid>`).
- **J6.5** (smoke-tour visuel) : `tests/e2e/smoke-tour-j6.spec.ts` qui seed + login + capture screenshots du dashboard rendered avec data réelle. Le full happy-path nécessite `CRON_SECRET` configuré dans le `.env` du worktree pour faire le compute en live.
- **J6.5** (revalidateTag wiring) : Server Actions `closeTradeAction` + `submitMorningCheckinAction` + `submitEveningCheckinAction` doivent appeler `revalidateTag('user:scores:'+userId)` ET `recomputeAndPersist(userId)` pour que le dashboard reflète immédiatement le dernier trade/checkin sans attendre le cron de la nuit.
- **J7** (MD library) : la card MarkDouglas du dashboard reste statique TIER 4. La bibliothèque + déclencheurs contextuels (3 trades perdants → fiche tilt) sont J7.
- **J8** (rapport hebdo IA) : agrège trades + checkins + scores de la semaine pour Claude prompt. Indexes `(userId, date desc)` sur `daily_checkins` et `behavioral_scores` sont déjà là.

## J7 — Module Mark Douglas (livré 2026-05-07)

### Modèle de données

- 3 nouveaux modèles via migration 20260507152652_j7_mark_douglas_card :
  - MarkDouglasCard (table mark_douglas_cards) — slug unique, category enum DouglasCategory (11 valeurs), quote ≤30 mots + quoteSourceChapter (fair use FR L122-5), paraphrase Text, exercises Json, triggerRules Json?, hatClass 'white'|'black', priority 1-10, published. Indexes (published, priority DESC) et (category, published).
  - MarkDouglasDelivery (table mark_douglas_deliveries) — userId, cardId, triggeredBy FR, triggerSnapshot Json, **triggeredOn @db.Date** (anchored local-day), seenAt?, dismissedAt?, helpful?. Unique (userId, cardId, triggeredOn) = idempotency Postgres-level "max 1 délivrance par fiche par jour local". Indexes pour timeline membre, badge unread, cooldown lookup.
  - MarkDouglasFavorite (composite PK (userId, cardId)).
- enum DouglasCategory : acceptance, tilt, discipline, ego, probabilities, confidence, patience, consistency, fear, loss, process.
- Cascade User delete sur les 3 tables (RGPD data minimisation).

### Trigger engine (lib/triggers/)

Architecture pure-functions first, side-effects en service. **45 tests TDD verts** (33 evaluators + 12 cooldown).

-     ypes.ts — TriggerRule discriminated union (7 kinds), TriggerContext, TriggerEvalResult, HatClass, COOLDOWN_DAYS_BY_HAT (white=7, black=14 — Yu-kai Chou Octalysis).
- schema.ts — riggerRuleSchema Zod discriminated union pour valider le riggerRules JSON.
- evaluators.ts — 7 evaluators purs (un par kind canonique SPEC §7.6) :
  1. fter_n_consecutive_losses (window: 'any' default, 'rolling_24h', 'session') — tilt mgmt
  2. plan_violations_in_window — discipline (compte trades + evening checkins)
  3. sleep_deficit_then_trade — fatigue (sameDay constraint via local-day match)
  4. emotion_logged (4 fears Douglas trade + 3 fears checkin) — peurs
  5. win_streak — sur-confiance
  6. o_checkin_streak — consistance
  7. hedge_violation — discipline (last closed trade)
- cooldown.ts — isOnCooldown(cardId, hatClass, history, now) + pickBestMatch(matched, history, now) → 0 ou 1 candidat (anti-spam : max 1 push par évaluation).
- engine.ts — evaluateAndDispatchForUser(userId, options?) : fetch ctx (trades 30j + checkins 60j + cards published + history 14j en parallèle), évalue, filtre cooldown, pick best, persist delivery, audit douglas.dispatched. Catch P2002 sur (userId, cardId, triggeredOn) → no-op idempotent.
- engine.ts exporte aussi dispatchForAllActiveMembers(now?) — batch 25-by-25 Promise.allSettled pour le cron.

### Service layer

- lib/cards/types.ts — SerializedCard, SerializedDelivery, SerializedFavorite, CardListFilters.
- lib/cards/service.ts — member-facing : listPublishedCards(filters?), getPublishedCardBySlug, listPublishedCategories, listMyDeliveries, countUnseenDeliveries, getDelivery, getDeliveryByCardSlug, markDeliverySeen, markDeliveriesForCardSeen (bulk on reader open), markDeliveryDismissed, setDeliveryHelpful, oggleFavorite (P2002/P2025 race-safe), isFavorite, listMyFavorites. Filtre published-only sur les surfaces membre. Custom errors CardNotFoundError, DeliveryNotFoundError.
- lib/admin/cards-service.ts — admin CRUD : listAllCards, getCardById, createCard, updateCard, deleteCard, setPublished, listMemberDeliveries, ggregateMemberDeliveryStats, getCatalogStats. Custom error CardSlugTakenError (P2002 sur slug).
- lib/schemas/card.ts — cardCreateSchema, cardUpdateSchema Zod avec : quote ≤ 30 mots (fair use enforced), paraphrase 50-4000 chars + safeFreeText (NFC + bidi/zero-width strip), slug kebab-case, exercises 1-3 items, triggerRules réutilise riggerRuleSchema.

### Dispatch wiring (Server Actions + cron)

- lib/cards/scheduler.ts — scheduleDouglasDispatch(userId, reason) — clone J6.5 scoring scheduler. fter() Next.js 16 + debounce 5s in-memory + try/catch + audit douglas.dispatched avec metadata riggeredBy: 'action'.
- 3 Server Actions trade wired : createTradeAction, closeTradeAction, deleteTradeAction appellent scheduleDouglasDispatch après scheduleScoreRecompute.
- 2 Server Actions checkin wired : submitMorningCheckinAction, submitEveningCheckinAction.
- pp/api/cron/dispatch-douglas/route.ts — pattern J5/J6 carbone : erifyCronSecret SHA-256 + imingSafeEqual (CWE-208), cronLimiter token bucket (5 burst, 1/min), 503 si pas de CRON_SECRET, 401/429/405. POST → dispatchForAllActiveMembers → audit cron.dispatch_douglas.scan. **Wiring prod attendu** :   0,6,12,18 \* \* \* UTC (every 6h) — couvre les triggers temporels purs (
  o_checkin_streak).

### Server Actions library

- pp/library/actions.ts — markDeliverySeenAction, dismissDeliveryAction, setDeliveryHelpfulAction, oggleFavoriteAction. Auth re-check + audit douglas.delivery.{seen,dismissed,helpful} + douglas.favorite.{added,removed} + revalidatePath('/library' + '/dashboard').
- pp/admin/cards/actions.ts — setPublishedAction(cardId, published), deleteCardAction(cardId). AdminGate discriminated union typé. Audit douglas.card.{published,unpublished,deleted}.

### UI publique (pp/library/)

- /library — Server Component, catalog grid + filtres URL searchParams (?cat=X). Hero header avec Pill "Module Mark Douglas" + compteurs unread/favorites + intro éducative. CategoryFilterTabs sticky avec icônes lucide + counts. Grid responsive 1/2/3 cols. EmptyState pédagogique posture athlète.
- /library/[slug] — Server Component, lecteur premium :
  - Banner "Pourquoi cette fiche maintenant" si delivery (triggeredBy FR humain)
  - Hero : category icon + Pill + title H1 + favoris labeled toggle
  - Quote bloc proeminent dans <Card primary> avec attribution chapter
  - Paraphrase rendue via <SafeMarkdown> (skipHtml + rehype-sanitize hardened schema + remarkGfm + urlTransform allowlist)
  - Section exercices ordered numérotée avec markdown sanitized
  - HelpfulFeedback two-button optimistic (si delivery)
  - MarkSeenOnMount client island fire-and-forget
  - markDeliveriesForCardSeen(userId, cardId) bulk-update au render
- /library/favorites — liste des favoris membre.
- /library/inbox — timeline deliveries reçues (split unread/read).

### UI admin (pp/admin/cards/)

- /admin/cards — list view avec stats strip (total / published / drafts / with-triggers), filtres status (all/published/draft), inline <CardActionsRow> (toggle published optimistic + delete avec double-confirm 4s).
- /admin/members/[id]?tab=mark-douglas — <MemberDouglasPanel> (stats agrégées + timeline deliveries chronologique avec triggeredBy + helpful pills + dismissed pills). Lien externe vers /library/[slug] pour preview.
- member-tabs.tsx:21 — comingSoon: 'J7' retiré du tab "Mark Douglas".

### Composants UI premium (components/library/)

- <SafeMarkdown> — wrapper react-markdown sécurisé (skipHtml, rehype-sanitize hardened schema, urlTransform allowlist ^(https?:|mailto:|/)/i, target=\_blank rel=noopener). Custom render mapping pour h2/h3, ul/ol marker:acc, blockquote border-acc, code inline mono.
- <CategoryFilterTabs> — Server Component sticky avec aria-current, icônes par catégorie, scroll horizontal mobile.
- <CardGridItem> — Server Component, card cliquable avec <Link> overlay full-card touch target. FavoriteToggle islé en client. Quote excerpt italique + source chapter + Pill catégorie.
- <FavoriteToggle> — Client useTransition + optimistic, aria-pressed, 2 variants (icon-only pour grid + labeled pour reader).
- <HelpfulFeedback> — 2 boutons thumbs up/down optimistic, reverte sur échec.
- <MarkSeenOnMount> — Client useEffect fire-and-forget Server Action (no return value).
- <CategoryMeta> — single source pour CATEGORY_LABEL FR + CATEGORY_ICON lucide + CATEGORY_TONE (acc/cy/warn/bad/mute).

### Fair use FR + sécurité

- quote ≤ 30 mots (Zod-enforced via wordCount(s) <= 30) — SPEC §18.2 fair use court extract L122-5.
- quoteSourceChapter non-vide obligatoire — toute citation porte attribution Trading in the Zone, ch.X ou The Disciplined Trader, ch.Y.
- safeFreeText (NFC + bidi/zero-width strip) appliqué sur title, quote, quoteSourceChapter, paraphrase, exercises.label, exercises.description — bloque Trojan Source J5 audit MEDIUM M5 + futur prompt Claude J8.
- eact-markdown skipHtml + rehype-sanitize avec schema hardened (filter on\* attributes, drop script/style/iframe/object/embed/svg/math) + urlTransform allowlist (rejette javascript:, data:, vbscript:).
- Audit étendu avec 12 nouvelles actions J7 (douglas.card._, douglas.dispatched, douglas.delivery._, douglas.favorite.\*, cron.dispatch_douglas.scan).

### Seed initial (scripts/data/cards.ts + scripts/seed-mark-douglas-cards.ts)

- 12 fiches V1 (vs ~50 SPEC §7.6 cible — 38 restantes en backlog J7.5).
- 7 fiches trigger-mapped (mapping SPEC §7.6 canonique) :
  - sortir-du-tilt (tilt) → fter_n_consecutive_losses n=3 window=any priority=9 hatClass=black
  - le-piege-de-la-deviation (discipline) → plan_violations_in_window n=2 days=7 priority=8 hatClass=black
  -     rader-fatigue-trader-emotionnel (fear) → sleep_deficit_then_trade minHours=6 priority=8 hatClass=white
  - l-art-de-ne-rien-faire (patience) → emotion_logged tag=fomo priority=8 hatClass=white
  - sur-confiance-le-piege-d-apres-victoire (confidence) → win_streak n=5 priority=7 hatClass=black
  - discipline-c-est-consistance (consistency) →
    o_checkin_streak days=7 priority=6 hatClass=white
  - pourquoi-le-plan-existe (discipline) → hedge_violation priority=8 hatClass=black
- 5 fiches catalogue (no trigger) : anything-can-happen, penser-en-probabilites, detacher-identite-resultat, accepter-la-perte-comme-cout, process-vs-outcome.
- Seed script idempotent par slug (upsert). Pattern seed-admin.ts carbone : env DATABASE_URL required, instancie PrismaClient + adapter-pg locally (lib/db.ts est server-only).

### Smoke test live validé (scripts/smoke-test-j7.ts)

Réplique la pipeline engine localement (engine.ts est server-only, tsx ne peut pas l'importer). Importe directement les helpers purs evaluators.ts + cooldown.ts + schema.ts. **Critère SPEC §15 J7 "Done quand" VALIDÉ** :

`[smoke:j7] step 4 — fetched 3 trades + 7 cards
[smoke:j7] step 4 — 2 cards matched: sortir-du-tilt, discipline-c-est-consistance
[smoke:j7] step 4 — sortir-du-tilt picked + persisted: "3 trades perdants consécutifs"
[smoke:j7] step 5 — 1 delivery: sortir-du-tilt
[smoke:j7] step 6 — P2002 unique idempotency enforced ✓
[smoke:j7] step 7 — cleanup OK
[smoke:j7] ALL GREEN — J7 critère "Done quand" validé en live.`

### Quality gate finale J7

- **Type-check** : ✓ (tsc --noEmit exit 0)
- **Vitest** : **503/503 tests verts** (vs 458 fin J6.6 = +45 triggers tests)
- **ESLint** : ✓ (max-warnings=0, exit 0)
- **Build prod** : ✓ (Turbopack, AUTH_URL=https://build.fxmily.invalid placeholder)
- **Smoke test live** : ✓ (above)
- **Migration appliquée** : ✓ (20260507152652_j7_mark_douglas_card, 15 tables en DB)

### TODO J7 → J7.5+ / J8 / J9

- **J7.5** : 38 fiches restantes pour atteindre ~50 SPEC §7.6 cible. Options : Eliot rédige lui-même OU re-spawn subagent avec batchs de 10 pour éviter le crash silencieux.
- **J7.5** : full CRUD form admin (create/edit) — V1 ship juste toggle published + delete, l'édition du paraphrase markdown attend un éditeur côté admin.
- **J7.5** : dashboard widget "Tes fiches Mark Douglas" (count unread + 3 dernières + lien /library).
- **J9** : push notifications quand une fiche est délivrée (NotificationType à étendre douglas_card_delivered).
- **J10** : wirer le cron Hetzner   0,6,12,18 \* \* \* UTC + add CRON_SECRET au worktree .env.

## J7 audit-driven hardening (2026-05-08)

Après le commit initial J7 (3ae5468) et la PR #24 ouverte, **4 audits subagents parallèles** ont été lancés (code-reviewer + security-auditor + accessibility-reviewer + ui-designer). Verdict combiné : **0 ship-blocker security, 3 BLOQUANTs code-review, 2 BLOQUANTs a11y, 6 BLOQUANTs UI design (cohérence DS)**. Sur les 8 BLOQUANTs uniquement les BLOQUANTs code/sécu/a11y ont été fermés (les BLOQUANTs UI design sont reclassés J7.5 polish premium — voir backlog).

### Closed (commit `feat(j7): audit-driven hardening`)

**a11y BLOQUANTs** :

- **B1 — Focus visible CardGridItem masqué par Link overlay** (card-grid-item.tsx). Fix : ocus-within:ring-2 focus-within:ring-acc focus-within:ring-offset-2 sur la <Card> parente. Le focus traverse le Link (ocus-visible:outline-none) → la carte parente affiche le ring quand n'importe quel descendant est focus.
- **B2 — FavoriteToggle keyboard order piégé** (card-grid-item.tsx). Fix :
  elative z-10 sur le wrapper du FavoriteToggle. Tab atteint d'abord le heart, puis le Link du titre.

**security ÉLEVÉ + MOYEN** :

- **M2 — riggerRules: { equals: null as unknown as object } cast unsafe** (engine.ts:117). Fix : riggerRules: { not: Prisma.JsonNull } + import Prisma. Cohérent avec cards-service.getCatalogStats. Idiomatique Prisma 7.
- **M3 —
  evalidatePath('/library/' + cardId) invalide la mauvaise route** (library/actions.ts). Fix :
  evalidatePath('/library', 'layout') qui rafraîchit l'arbre entier (catalog + reader + favorites + inbox). Cohérent avec le toggle qui peut cascader sur plusieurs vues.
- **M4 — evalNoCheckinStreak match instant pour user fraîchement inscrit** (evaluators.ts). Fix : ajout userCreatedAt à TriggerContext + skip si ccountAgeDays < rule.days. Engine.ts injecte la valeur via User.createdAt select. Tests fixture + smoke test mis à jour. Évite le spam onboarding-day.

**UI BLOQUANT** :

- **B6 — Touch targets h-9 (36px) sur 7 surfaces J7** régression vs J5 audit fix (min-h-11). Fix : h-9 → h-11 (44px) systématique sur back-links library, badges header, FavoriteToggle icon-only, CardActionsRow, CategoryFilterTabs (min-h-[36px] → min-h-11). + ocus-visible outline ajouté sur les surfaces qui en manquaient.

**code-review BLOQUANTs** :

- **#1 — Seed re-run écrase admin overrides published/priority/hatClass** (seed-mark-douglas-cards.ts). Fix : update exclut ces 3 colonnes via destructuring {published: \_p, priority: \_pr, hatClass: \_h, ...contentOnly}. Re-run préserve les tweaks Eliot.
- **#2 — markDeliveriesForCardSeen bulk update sans audit log** (library/[slug]/page.tsx + udit.ts). Fix : nouvelle action douglas.delivery.bulk_seen ajoutée à AuditAction union. La page reader émet 1 audit row avec metadata: { cardId, cardSlug, count } quand count > 0. Trace complète restaurée.
- **#3 — Pages /library/\* ne gate pas status === 'active'** (4 pages). Fix : if (!session?.user?.id || session.user.status !== 'active') redirect('/login') sur library/page.tsx + favorites + inbox + [slug]. Suspended members redirigés vers login (cohérent J5/J6).

**code-review HIGH** :

- **H3 — External links markdown SR-only annonce + ExternalLink icon** (markdown.tsx). Fix : custom renderer  ajoute <ExternalLink> lucide après le label + <span class="sr-only">(ouvre dans un nouvel onglet)</span>. Plus de surprise SR.
- **H8 — Stale "coming soon" hint Mark Douglas J7 + Check-ins J5** (member-tabs.tsx + members/[id]/page.tsx). Fix : retire comingSoon: 'J5' du tab Check-ins (livré J5) ; bloc OverviewTab "coming soon hint" n'annonce plus que Notes admin J3.5.
- **H9 — Server Actions sans cap longueur sur deliveryId/cardId** (library/actions.ts + dmin/cards/actions.ts). Fix : ajout || deliveryId.length > 64 + || cardId.length > 64 sur les 6 Server Actions. Anti-DoS RAM/Postgres parser.

### Quality gate post-hardening

- **Type-check** : ✓ exit 0
- **ESLint** : ✓ exit 0 (max-warnings=0)
- **Vitest** : **503/503** verts (stable, +0 vs commit initial — aucun test cassé par les patches)
- **Smoke test J7 live** : ✓ ALL GREEN (re-validé après M4 fix avec userCreatedAt: member.createdAt)
- **Migration appliquée** : ✓ (pas de nouvelle migration, fixes applicatifs uniquement)

### Reclassé J7.5 (backlog non bloquant pour merge)

**UI design audit (6 BLOCKERs DS coherence reclassés HIGH J7.5)** :

- **DS-B1** : 0 occurrence des 10 typography tokens DS ( -display/ -h1/ -eyebrow/etc) — Tailwind raw partout. Migration sed-style requise (~1h).
- **DS-B2** : 0 occurrence ar(--\*) direct (J5/J6 ont 120+) — utilise les Tailwind aliases. Choix architectural à trancher pour cohérence repo.
- **DS-B3** : 0 import framer-motion (vs 6 fichiers ailleurs). Stagger entrance grid library + scale spring sur FavoriteToggle + entrée Card primary reader manquent. ~2h pour 3 client islands animés.
- **DS-B4** : <Card primary> sous-utilisé (1 seul endroit reader). Promouvoir 1 card "featured" du grid en primary.
- **DS-B5** : Reader hero sans focal point premium. Manque urora wrapper, h-rise H1, drop-shadow lime sur icône halo.
- **DS-B6** : Déjà fixé en hardening (h-9 → h-11).

**Autres items J7.5** :

- **CR-H4** : "1 fiche par jour cross-card" decision design (engine.ts cap globalement vs unique per-card actuel). À trancher avec Eliot.
- **CR-H6** : Race scheduler lastDispatchAt set après read (theatre dans certains microtasks tick). V1 Hetzner single-instance OK ; refactor inFlight: Map<userId, Promise> pour V2 multi-instance.
- **CR-H7** :
  evalidatePath('/library/') sur oggleFavoriteAction mauvaise route — partiellement fixé via
  evalidatePath('/library', 'layout') mais le slug-spécifique serait plus précis.
- **a11y H4** : delete confirm live region (CardActionsRow setTimeout 4s sans annoncer SR).
- **a11y H5** : favorite/helpful aria-live polite optimistic (annonce "Ajouté aux favoris").
- **a11y H7** : pills "Brouillon"/"Black hat"/"Cadre d'urgence" aria-label informatif.
- **a11y H8** : <SafeMarkdown> headingOffset prop pour exercises descriptions.
- **CR-#10..#19 (MEDIUM)** : audit dead actions, parseExercises silent drop console.warn, setTimeout cleanup CardActionsRow, parsing exercises validation, tagNames allowlist strict (vs filter blocklist) react-markdown, etc.
- **38 fiches manquantes** (V1 ship 12/50 SPEC §7.6 cible).

### Commits J7 finaux sur `claude/tender-euler-092684`

1. `d16b30c` feat(j7): foundation — DB model + trigger engine + 45 TDD tests
2. `21492f1` feat(j7): services + Zod + dispatch wiring + cron temporel
3. `3ae5468` feat(j7): UI premium + admin + tab member-douglas-panel + 12-cards seed
4. `HEAD` feat(j7): audit-driven hardening — 3 BLOQUANTs + 6 HIGH closed

**PR** : https://github.com/fxeliott/fxmily/pull/24

## J7.5 polish premium (2026-05-08)

Branche dédiée claude/j7-5-polish pour pousser les BLOCKERs UI design DS coherence reclassés J7.5 + ajouter 10 fiches additionnelles + a11y H4/H5 live regions + code cleanup CR-#10/#16/#19.

### Closed

**Framer Motion premium** :

- <FavoriteToggle> (components/library/favorite-toggle.tsx) — Spring burst animation [1, 1.35, 1] sur favori toggle / [1, 0.85, 1] sur unfavori. whileTap={{ scale: 0.92 }} icon-only / 0.96 labeled. Heart fill animation lime + shadow-[0_0_16px_-2px_var(--acc-glow)] quand favorited. Respecte useReducedMotion() (skip animation, durée 0). Spread conditionnel {...(prefersReducedMotion ? {} : { whileTap: { scale: 0.92 } })} pour TS exactOptionalPropertyTypes.
- <HelpfulFeedback> (components/library/helpful-feedback.tsx) — <motion.button> avec whileTap scale spring + bg shadow lime sur "Oui".
  ole="group" + ria-labelledby="helpful-q" (a11y M3 fix).
- <AnimatedCardGrid> (components/library/animated-card-grid.tsx) — Client island wrapper qui stagger entrance les cards du /library grid : staggerChildren: 0.05 + delayChildren: 0.08, item variant { opacity: 0, y: 8 } → { opacity: 1, y: 0 } ease [0.22, 1, 0.36, 1] (e-smooth signature). Gracefully no-anim si prefers-reduced-motion. library/page.tsx wire l'island avec avoritedIds={Array.from(favoriteIds)} (Set non JSON-safe → array).

**a11y H4 + H5 + CR-#12 (live regions + setTimeout cleanup)** :

- <CardActionsRow> (components/admin/card-actions-row.tsx) — <span role="status" aria-live="polite" class="sr-only"> annonce les états ("Fiche X publiée/dépubliée", "Confirmation requise pour supprimer X. Clique à nouveau dans 4 secondes.", "Fiche supprimée", "Échec, essaie à nouveau"). setTimeout confirm migré en useEffect avec cleanup clearTimeout (CR-#12 fix : plus de setState on unmounted component sous strict mode). useRef pour le timeout d'announce avec cleanup au unmount.
- <FavoriteToggle> — même pattern live region. Annonce "Ajouté aux favoris" / "Retiré des favoris" / "Échec, essaie à nouveau" via useState nnounce + setTimeout re-clear 1.5s + cleanup.
- <HelpfulFeedback> — <span role="status" aria-live="polite"> annonce "Réponse « Oui » enregistrée" / "Réponse « Pas vraiment » enregistrée" / "Échec, essaie à nouveau". <div role="group" aria-labelledby="helpful-q"> regroupe les 2 boutons sémantiquement (a11y M3 fix).

**Code cleanup** :

- **CR-#16** : import 'server-only'; ajouté en tête de components/library/markdown.tsx — sentinelle anti-régression au cas où un composant client tenterait d'importer <SafeMarkdown> (qui drag react-markdown + remark + rehype-sanitize ~30 KB gzip dans le bundle client). Le tool runtime fail-fast avec un message clair.
- **CR-#19** : parseExercises (lib/cards/service.ts) — console.warn('[cards.parseExercises] dropped X/Y invalid items') quand des items du JSON sont silencieusement filtrés (admin a edit en SQL direct, ou shape change). Plus de drops invisibles.
- **CR-#10** : retiré 'douglas.card.created' + 'douglas.card.updated' de AuditAction union (lib/auth/audit.ts) — V1 ship juste publish/unpublish/delete via UI. Les 2 actions create/updated sont reservées pour J7.5 admin CRUD form, à ré-ajouter alors. Commentaire mis à jour pour le signaler.

**10 fiches additionnelles** :

- scripts/data/cards.ts étendu de 12 → **22 fiches** (subagent J7.5 a livré dans une réponse compacte ce que le subagent J7 initial avait raté en silence). Toutes catalogue ( riggerRules: null).
- 10 nouvelles : every-moment-is-unique, edge-is-not-guarantee,
  andom-distribution-wins-losses,
  evenge-trade-trap, wait-for-your-setup, confidence-vs-arrogance, he-3-phases-of-execution, he-fear-of-being-wrong, stop-loss-is-cost-not-failure, weekly-review-rituel.
- Couvre : 4 truths Mark Douglas restants (every-moment, edge-not-guarantee, random-distribution), revenge-trade & wait psychologie, confidence sain vs arrogance, 3 phases d'exécution, fondamentale fear "avoir tort", stop-loss comme coût, rituel review hebdomadaire.
- Seed re-run : 22 cards en DB (10 created + 12 updated par seed safe-update). Smoke test J7 toujours ALL GREEN (engine pick sortir-du-tilt correctement avec les 22 cards).

### Quality gate

- **Type-check** : ✓ (tsc --noEmit exit 0)
- **Vitest** : **503/503** verts (stable)
- **ESLint** : ✓ (max-warnings=0)
- **Build prod** : ✓ (Turbopack, toutes routes J7 listées)
- **Smoke test J7** : ✓ ALL GREEN (re-validé avec 22 fiches en DB)
- **Migration** : ✓ (pas de nouvelle migration, content + UI only)

### Reste J7.6+ ou J8

- 28 fiches manquantes pour atteindre cible SPEC §7.6 ~50 fiches.
- DS coherence : typography tokens + var(--\*) direct (les DS-B1/B2 du UI design audit, Tailwind aliases hybride OK V1).
- DS-B5 : reader hero aurora wrapper + h-rise H1 + drop-cap quote bloc.
- Form CRUD admin (/admin/cards/new + [id]/edit).
- Dashboard widget "Tes fiches Mark Douglas" sur /dashboard.
- a11y H7 : pills one="warn" "Brouillon"/"Black hat"/"Cadre d'urgence" aria-label informatif.
- a11y H8 : <SafeMarkdown> headingOffset prop pour exercises descriptions (latent risk).
- J9 : push notifications quand fiche délivrée.
- J10 : wirer cron Hetzner 6h + CRON_SECRET au worktree .env.

## J7.8 — 50/50 fiches Mark Douglas (livré 2026-05-08)

Branche dédiée pour pousser la cible SPEC §7.6 à 50 fiches livrées (vs 31 fin J7.7), avec sourcing canonique Mark Douglas vérifié via WebSearch (Trading in the Zone ch.6/7/10/11 + The Disciplined Trader ch.4/6/7/9/10/13/15/16). Fix bonus d'un id exercise pré-existant qui violait le regex Zod kebab-case lowercase.

### Closed

**+19 fiches Mark Douglas** (`scripts/data/cards.ts`, +800 lignes) ciblées sur les catégories sous-couvertes :

- **ego (+3)** : `l-ego-veut-avoir-raison` (TitZ ch.7, black), `je-ne-suis-pas-mon-resultat` (TitZ ch.10, white), `l-arrogance-precede-la-chute` (TitZ ch.6, black, trigger `win_streak n=7`).
- **probabilities (+2)** : `penser-en-statistiques-pas-en-prevision` (TitZ ch.11 — verbatim 2nd fundamental truth, white), `la-loi-des-grands-nombres` (TitZ ch.11 — verbatim 4th fundamental truth, white).
- **confidence (+1)** : `la-confiance-vient-de-l-execution` (TitZ ch.11, white).
- **patience (+2)** : `attendre-est-une-action` (TDT ch.6, white), `le-piege-de-la-quantite` (TDT ch.4, black).
- **consistency (+2)** : `consistance-vs-perfection` (TitZ ch.11 — verbatim definition, white), `pourquoi-tu-trahis-ton-plan` (TDT ch.10, black).
- **fear (+3)** : `la-peur-de-rater-quelque-chose` (TitZ ch.7 — verbatim 4 fears, black, trigger `emotion_logged tag=fomo`), `la-peur-de-laisser-de-l-argent` (TitZ ch.7 — verbatim 4 fears, black), `la-peur-de-perdre-bloque-l-execution` (TitZ ch.7 — verbatim "Fear narrows our focus", black).
- **loss (+2)** : `la-perte-est-une-information` (TDT ch.7, white), `couper-court-couper-vite` (TDT ch.16, black, priority 9).
- **process (+4)** : `pre-trade-checklist` (TDT ch.6, white), `journal-est-un-miroir` (TDT ch.13, white), `mesurer-ce-qui-compte` (TDT ch.16, white), `revue-mensuelle-strategique` (TDT ch.16, white).

**Sourcing rigueur fair use FR L122-5** :

- 5 fiches utilisent des **citations verbatim** sourcées via WebSearch (Goodreads + TraderLion + Bookey 2025-2026) sur les 5 fundamental truths + 4 primary trading fears + "Fear narrows our focus" — toutes ≤30 mots avec attribution chapter précise.
- 14 fiches utilisent des **citations en paraphrase synthèse** marquées explicitement "(paraphrase de l'argument)" dans `quoteSourceChapter` — pattern déjà institué par J5 audit Mark Douglas Card content fix (cf. fxmily_project.md "Citation Mark Douglas pseudo-sourcée 'définir le brief' remplacée par paraphrase honnête 'Dans l'esprit de Mark Douglas'").
- 100% paraphrases en français, voix d'Eliot, posture athlète/process — strict alignment avec `feedback_premium_frontend` et SPEC §2 (zéro analyse de marché, oui process + psychologie).
- 100% `safeFreeText`-compatibles (NFC + bidi/zero-width strip enforced par Zod schema).

**Trigger rules nouvelles** :

- `l-arrogance-precede-la-chute` → `win_streak n=7` priority 8 (complète le tier `sur-confiance-le-piege-d-apres-victoire` n=5).
- `la-peur-de-rater-quelque-chose` → `emotion_logged tag=fomo` priority 8 (complète `l-art-de-ne-rien-faire`).
- 17 fiches catalogue (`triggerRules: null`) — accessibles via `/library` parcours libre + favoris.

**Code-review CR-bonus FIXÉ** :

- `accepter-la-perte-comme-cout` exercise.1.id était `accepter-1R-mental` (uppercase R) qui violait le regex Zod kebab-case lowercase `/^[a-z0-9-]+$/`. Fix : renommé en `accepter-1r-mental`. Bug pré-existant détecté par le validateur 50/50 lors de la passe J7.8.

**Validation Zod 50/50** :

- Nouveau script `scripts/validate-cards.ts` qui parse chaque fiche du seed via `cardCreateSchema.safeParse`. Sortie : `Total: 50 | OK: 50 | ERR: 0`.
- Garantit que toute future fiche ajoutée au seed passe la validation ≤30 mots quote + paraphrase 50-4000 chars + safeFreeText + slug kebab-case + exercises 1-3 + trigger rules JSON valide.

### Quality gate

- **Type-check** : ✓ (tsc --noEmit exit 0)
- **Vitest** : **503/503** verts (stable, +0 — aucun test cassé par les patches content)
- **ESLint** : ✓ (max-warnings=0)
- **Prettier** : ✓ sur les fichiers modifiés (`cards.ts` + `validate-cards.ts`). Note : 218 fichiers du repo ont des issues Prettier pré-existantes — hors scope J7.8.
- **Build prod** : ✓ (Turbopack avec placeholders documentés `AUTH_URL=https://build.fxmily.invalid` + DATABASE_URL placeholder)
- **Validation Zod cards** : ✓ 50/50 OK
- **Seed live** : ✓ DB `fxmily-postgres-dev` healthy, 50 cards en DB (19 created + 31 updated par seed safe-update)
- **Smoke test J7** : ✓ ALL GREEN avec 50 cards (engine pick `sortir-du-tilt` correctement, P2002 idempotency enforced, audit trail propre)
- **Migration** : ✓ (aucune nouvelle migration, content-only)

### SPEC.md → v1.1

Section 20 ajoutée à `D:\Fxmily\SPEC.md` documentant :

- 20.1 Pivots stack (Tremor→Recharts, JWT, lime DS v2, Sprint #1, R2 stub, etc.)
- 20.2 12 sous-jalons inventés en cours (Sprint #1 + J5.5 + J6.5/J6.6 + J7.5/J7.6/J7.7/J7.8)
- 20.3 Pattern audit-driven hardening (canon Fxmily depuis J5)
- 20.4 Sécurité tranchée en session (timingSafeEqual + token bucket + safeFreeText + JWT bypass + BOLA + rehype-sanitize)
- 20.5 État vs SPEC §15 critères "Done quand" (J0→J7.8 ✅, J8 ⏳, J9/J10 pending)
- 20.6 Backlog clair J8 (rapport hebdo IA Claude Sonnet 4.6 + briques réutilisables + coût ~5-10€/mois)

SPEC v1.0 préservé immuable au-dessus pour traçabilité de la vision initiale ; v1.1 est le delta vers la réalité 2026-05-08.

### Reste après J7.8

**Avant J8** :

- DS coherence J7.5 résiduelle (typography tokens DS + var(--\*) direct hybride). Optionnel V1.
- a11y H7 : pills "Brouillon"/"Black hat"/"Cadre d'urgence" aria-label informatif.
- Form CRUD admin `/admin/cards/new` + `/admin/cards/[id]/edit` (V1 ship sans — seed + toggle published + delete suffisent).
- Tests E2E full happy-path login → trade → dispatch Douglas (helper seed Postgres cross-jalon attendu).
- 218 fichiers Prettier issues pré-existantes (cleanup hors scope).

**J8 (next session après `/clear`)** : Rapport hebdo IA admin Claude Sonnet 4.6 (cf. SPEC §20.6 backlog).

**J9** : Push notifications Web Push + VAPID + service worker.

**J10** : Prod hardening + RGPD endpoints + Sentry + Hetzner deploy + domaine app.fxmilyapp.com.

## J8 — Foundation (Phase A livré 2026-05-08)

Branche dédiée pour livrer la **fondation DB + types + builder pure-functions + tests TDD** du Jalon 8 (Rapport hebdo IA admin), sans toucher à l'Anthropic SDK ni à la complexité Claude API. Phase B+ (claude-client + cron + email + UI) reste pour nouvelle session avec `/clear`. Respecte la règle SPEC §18.4 "1 session = 1 jalon" tout en débloquant la prochaine session de démarrer avec les briques DB déjà en place.

### Closed

**Modèle DB** :

- Nouveau modèle `WeeklyReport` (table `weekly_reports`) — voir `prisma/schema.prisma` + migration `20260508113316_j8_weekly_report` appliquée live. Cascade `User.delete` (RGPD data minimisation). Unique `(userId, weekStart)` enforce idempotency cron weekly. Indexes `(userId, weekStart DESC)` + `(generatedAt DESC)`.
- Champs : output Claude (`summary` Text, `risks` / `recommendations` / `patterns` Json), cost tracking (`claudeModel`, `inputTokens`, `outputTokens`, `cacheReadTokens`, `cacheCreateTokens`, `costEur` Decimal(10,6)), email dispatch state (`sentToAdminAt`, `sentToAdminEmail`, `emailMessageId`).
- Posture RGPD : `costEur` 6 décimales pour sub-cent tracking SPEC §16 (~5€/mois target). `sentToAdminEmail` audité pour traçabilité.
- **15 tables → 16 tables** en DB.

**Zod schemas** (`lib/schemas/weekly-report.ts`) :

- `weeklyReportPatternsSchema` — patterns extraits 7j (emotionPerf, sleepPerf, sessionFocus, disciplineTrend) tous optionnels avec `safePatternValueSchema` + `.strict()`.
- `weeklyReportOutputSchema` — ce que Claude doit renvoyer via `output_config.format` (post-`messages.parse()` Phase B). `summary` 100-800 chars, `risks` 0-5 items, `recommendations` 1-5 items, `patterns` strict. **Validation TWICE** : SDK level + post-parse (defense enum fuzzing).
- `weeklyReportCostSchema` — cost tracking metrics + claudeModel + token counts.
- `weeklyReportPersistInputSchema` — combinaison output + userId + weekStart/End + cost (DB write input).
- `weeklySnapshotSchema` — ce que le builder produit (input à Claude). Counters (numerics seuls, jamais user-text), free-text (sanitized via safeFreeText), scores pass-through.
- **Hardening systématique** : `safeFreeText` (NFC + bidi/zero-width strip) sur 100% des champs free-text user-controlled ET sur le retour Claude (defense-in-depth si LLM hallucine bidi). `.strict()` partout pour rejeter clés extra hallucinées par le LLM. `containsBidiOrZeroWidth` refine sur tous les strings.

**Builder pure-functions** (`lib/weekly-report/builder.ts` + `types.ts`) :

- `buildWeeklySnapshot(input: BuilderInput): WeeklySnapshot` — pure aggregator. Pas de DB, pas de `Date.now()`, pas d'I/O. Service layer (Phase B) loadera la slice 7j filtrée local-timezone et passera ici.
- `buildCounters` — 21 metrics : tradesTotal/Win/Loss/BE/Open, realizedRSum/Mean (rounded 4 décimales), planRespectRate, hedgeRespectRate (exclude N/A), morningCheckinsCount, eveningCheckinsCount, streakDays, sleepHoursMedian, moodMedian, stressMedian, annotationsReceived/Viewed, douglasCardsDelivered/Seen/Helpful.
- `buildFreeText` — emotion tags frequency-sorted (top 20), pairs traded (top 10), sessions traded (canonical order asia/london/newyork/overlap), journal excerpts (5 most recent, sanitized + truncated 200 chars + "…").
- `buildScores` — pass-through `BehavioralScoreSnapshot | null` (insufficient_data preserved).
- **Defense-in-depth safeFreeText** sur journalExcerpts même si service layer doit l'avoir fait — belt-and-suspenders pour prompt injection.
- Helpers : `parseRealizedR`, `parseDecimalOrNull`, `bumpCount`, `median` (odd + even), `roundTo`.

**Tests TDD** (`lib/weekly-report/builder.test.ts`) :

- **20 tests verts** couvrant : empty input defaults, trade counters (wins/losses/BE/open + realizedR sum/mean), plan respect rate, hedge respect rate (excludes N/A), median sleep/mood/stress (odd + even sample), streak unique dates across slots, Mark Douglas counters (delivered/seen/helpful), emotion tags frequency-sorted + cap, pairs frequency-sorted + cap, sessions canonical order, journal excerpt truncation 200 chars + ellipsis, **bidi/zero-width strip Trojan Source defense**, cap 5 excerpts most-recent-first, skip empty/whitespace journals, scores null pass-through, scores numeric pass-through, scores partially-null preserved, annotations counters propagate.

**AuditAction extension** (`lib/auth/audit.ts`) :

- 5 nouvelles actions réservées (Phase B+ emettra) : `weekly_report.generated`, `weekly_report.email.sent`, `weekly_report.email.failed`, `admin.weekly_report.viewed`, `cron.weekly_reports.scan`.

### Quality gate

- **Type-check** : ✓ (tsc --noEmit exit 0)
- **Lint** : ✓ (max-warnings=0)
- **Vitest** : **523/523 verts** (+20 vs J7.8 baseline 503)
- **Prettier** : ✓ sur fichiers modifiés
- **Build prod** : ✓ (Turbopack avec placeholders documentés)
- **Migration appliquée live** : ✓ Postgres `fxmily-postgres-dev` (16 tables total)

## J8 — Phase B+ livré (2026-05-08)

Pipeline complet rapport hebdo IA admin **end-to-end live validé**. Path :
`cron POST → loader DB → builder pure → claude-client (mock V1 / live ready) → Zod validate → upsert weekly_reports → maybeSendEmail → React Email + Resend → audit trail`.

### Phase B — Loader + Service orchestrator

- `lib/weekly-report/week-window.ts` — week boundaries Mon→Sun en TZ membre via `Intl.DateTimeFormat` (Node 22 LTS bundled ICU). Trois entrées :
  - `computeWeekWindow(now, tz)` — semaine "containing today" (semantique brute).
  - `computeReportingWeek(now, tz)` — **anchor sur `now - 24h`** : Sunday-21-UTC cron donne la semaine qui vient de finir aussi bien pour Paris (CEST = Sun 23h, semaine ending today) que pour Tokyo (JST = Mon 06h, semaine ending yesterday). Fix audit BLOCKER #2.
  - `computePreviousFullWeekWindow(now, tz)` — semaine -1 (back-fill manuel).
- `lib/weekly-report/loader.ts` — `loadWeeklySliceForUser(userId, options)` : parallèle Trade (`enteredAt` in window) + DailyCheckin (`date` DATE in window) + MarkDouglasDelivery (`createdAt` in window) + annotations admin counts + `getLatestBehavioralScore`. Sérialise tout en `BuilderInput` (Decimal → string, Date → ISO).
- `lib/weekly-report/service.ts` — orchestrator stateless :
  - `generateWeeklyReportForUser(userId, options)` : load → buildWeeklySnapshot → Zod validate → claude-client.generate → upsert (idempotent sur `(userId, weekStart)`) → `maybeSendEmail` (best-effort). Audit `weekly_report.generated` PII-free.
  - `generateWeeklyReportsForAllActiveMembers(options)` : batch 5-by-5 `Promise.allSettled` ; classifie l'email en `sent` / `skipped` / `failed` / `not_attempted` (séparation Resend rejection vs dev fallback `no_api_key_dev_fallback`).
  - Read helpers admin : `listReportsForAdmin`, `getReportByIdForAdmin`, `getReportStatsForAdmin`, `listReportsForMember`.
  - **BLOCKER #1 fix** : DB write utilise `parseLocalDate(weekStartLocal)` (UTC midnight de la date locale) — Postgres `@db.Date` truncate sur UTC, donc local-Mon-00:00 converti en UTC dérive d'un jour dans toutes TZ ≠ UTC. Carbone du pattern J5 `lib/checkin/service.ts`.
  - **`recipientOverride` gated `!isProdRuntime`** — anti-exfiltration via cron en prod.

### Phase C — Claude client + prompt + pricing

- `lib/weekly-report/prompt.ts` — `WEEKLY_REPORT_SYSTEM_PROMPT` (posture Mark Douglas + interdiction analyse marché + format JSON strict + instructions sécurité prompt-injection) + `buildWeeklyReportUserPrompt` rend snapshot Markdown + `WEEKLY_REPORT_OUTPUT_JSON_SCHEMA` strict (no `additionalProperties`).
- `lib/weekly-report/pricing.ts` — `PRICING_USD_PER_MTOK` (Sonnet 4.6 : $3 input / $15 output / $0.30 cache read / $3.75 cache create 1h). `USD_TO_EUR=0.93`. `computeCostEur(model, usage)` → 6-decimal string EUR.
- `lib/weekly-report/claude-client.ts` — interface + 2 impls :
  - `MockWeeklyReportClient` — déterministe, dérivé du snapshot. Zod-valid. Cost réel computé sur tokens fictifs (3200 in / 950 out → 0.0222 €). V1 default tant que `ANTHROPIC_API_KEY` absent.
  - `LiveWeeklyReportClient` — lazy `await import('@anthropic-ai/sdk')` (v0.95.1 installé). `messages.create` avec `system` array `cache_control: { type: 'ephemeral', ttl: '1h' }` (90% rabais cache-hit, audit Phase G fix). `extractTextFromResponse` accepte text block ET tool_use block (audit Phase G fix). Validation Zod post-parse defense-in-depth.
  - Factory `getWeeklyReportClient()` cache per-process, `resetClaudeClient()` pour tests.

### Phase D — Cron route

- `app/api/cron/weekly-reports/route.ts` — pattern J5/J6/J7 carbone fidèle :
  - `verifyCronSecret` SHA-256 + `timingSafeEqual` (CWE-208 length-leak defense)
  - `cronLimiter` token bucket (5 burst, 1/min, LRU `maxKeys: 1024`) AVANT verify (404 sur secret invalide)
  - 503 si pas de `CRON_SECRET`, 401 sur secret invalide, 405 sur GET, 429 + Retry-After
  - `?at=ISO` dev override **strict T-required** (audit fix : refuse `?at=2026-05-10` sans heure pour éviter confusion semaine)
  - `?dryRun=true` skip email (smoke test sans cramer Resend free tier)
  - Double-gate `NODE_ENV !== 'production'` AND `!AUTH_URL.startsWith('https://')`
  - Audit row `cron.weekly_reports.scan` avec counts (scanned/generated/errors/emailsDelivered/emailsFailed/emailsSkipped/mocked/totalCostEur)

### Phase E — UI admin

- `/admin/reports` page.tsx — liste cohorte chronologique, groupée par `weekStart`. Stats strip 4 cells (totalReports / totalCostEur / emailsDelivered / membersInLastWeek). Pills MOCK vs LIVE + ENVOYÉ vs EN ATTENTE. Token / cost / count/risks/recos résumé par row. EmptyState pédagogique.
- `/admin/reports/[id]` page.tsx — détail rapport :
  - Hero : member label (avec fallback `Membre #${id.slice(-6)}` au lieu d'email pour PII protection — audit fix), période formatée FR, pills.
  - Sections : Synthèse, Risques (border-l warn), Recommandations (border-l acc), Patterns observés (grid 2 col), Génération (model / cost / tokens / cache / email status).
  - Lien retour vers `/admin/members/[id]?tab=weekly-reports`.
- `components/admin/member-weekly-reports-panel.tsx` — timeline rapports membre (newest first). Pills + tokens + cost + counts.
- `components/admin/member-tabs.tsx` — tab "Rapports IA" ajouté entre "Mark Douglas" et "Notes admin". Active sur `?tab=weekly-reports`.
- `app/admin/members/page.tsx` — bouton ghost "Rapports IA" en header.

### Phase F — Email digest

- `lib/email/templates/weekly-digest.tsx` — React Email v2 lime/deep-space (carbone `AnnotationReceivedEmail` J4). Sections : eyebrow + heading + period + (mock banner if mocked) + Synthèse + Risques (bullet warn) + Recommandations (bullet acc) + Patterns observés (label + value rows) + CTA "Ouvrir le rapport complet" + footer "Aucun conseil de trade — uniquement comportement, exécution, psychologie (SPEC §2)" + cost line.
- `sendWeeklyDigestEmail({ to, memberLabel, report })` dans `lib/email/send.ts` — plain-text fallback structuré + `buildAdminReportUrl(reportId)`.
- V1 envoie à `WEEKLY_REPORT_RECIPIENT` env (default `eliot@fxmilyapp.com`) — domaine `fxmilyapp.com` verify J10.

### Phase G — Audit-driven hardening (8 closed)

Subagent `code-reviewer` lancé sur le diff Phase B+ → 2 BLOCKERs + 6 HIGH/MEDIUM closed in-session :

1. **TIER 1 BLOCKER** — DB date drift `@db.Date` truncate UTC date alors que `weekStartUtc` = local-Mon-00:00 en UTC. Pour Paris CEST 2026-05-04 → stocké comme 2026-05-03 silencieusement. **Fix** : `weekStartDb = parseLocalDate(window.weekStartLocal)` (UTC midnight de la date locale). Audit-validated par smoke test.
2. **TIER 1 BLOCKER** — Cron Sun 21 UTC reportait future-week pour TZ à l'est (Tokyo Mon 06h JST → Mon 11 → Sun 17). **Fix** : `computeReportingWeek(now, tz)` anchor `now - 24h`. Test couvert pour Paris/London/Tokyo/NY/UTC.
3. **TIER 2 HIGH** — Email re-spam : `update` resettait `sentToAdminAt: null`, donc chaque re-run cron ré-envoyait email (cramant Resend free 100/jour à 30 membres). **Fix** : préserve dispatch state ; `maybeSendEmail` short-circuit si déjà envoyé.
4. **TIER 2 HIGH** — `recipientOverride` exfiltration vector. **Fix** : honoré ONLY `!isProdRuntime`.
5. **TIER 2 HIGH** — `tool_use` block path manquant (Sonnet 4.6 structured output mode). **Fix** : `extractTextFromResponse` détecte `block.type === 'tool_use'` et lit `block.input` JSON.
6. **TIER 2 HIGH** — `cache_control: { type: 'ephemeral' }` sans `ttl: '1h'` cache 5min default = optim cache 90% rabais perdue sur cadence weekly. **Fix** : `ttl: '1h'` explicite (SDK 0.95.1 supporte).
7. **TIER 3 MEDIUM** — `displayMemberLabel` fallback sur email brut leak PII dans subject/body. **Fix** : fallback `Membre #${id.slice(-6)}`.
8. **TIER 3 MEDIUM** — `weekly_report.email.failed` confondait Resend rejection avec dev-fallback (no key). **Fix** : nouvelle action `weekly_report.email.skipped` + counter `emailsSkipped` dans batch result.
9. **TIER 3 MEDIUM** — `?at=ISO` parsing accepte dates sans heure → confusion. **Fix** : regex `/[Tt ]/` strict sur la valeur avant `new Date()`.

**Test TDD** : `lib/weekly-report/week-window.test.ts` — 12 tests verts couvrant `dayOfWeekIso`, `shiftLocalDateString`, `localInstantToUtc` (Paris/Tokyo/UTC), `computeWeekWindow`, `computeReportingWeek` (BLOCKER #2 multi-TZ), `computePreviousFullWeekWindow`. Le test "cron contract" itère sur 5 TZ et assert `weekStart=Mon` + `weekEnd=Sun`.

### Phase H — Smoke test live (ALL GREEN)

`apps/web/scripts/smoke-test-j8.ts` — pattern carbone `smoke-test-j7.ts`. Tsx-driven, parle au dev server live via `fetch /api/cron/weekly-reports`.

Validations :

- ✓ POST cron 200 ; response `{ scanned: 6, generated: 6, mocked: 6, emailsSkipped: 6, totalCostEur: "0.133086" }`
- ✓ `weekly_reports.weekStart === "2026-05-04"` (Mon Paris CEST), `weekEnd === "2026-05-10"` — preuve directe BLOCKER #1 fix
- ✓ Summary 270 chars (≥100), recommandations 2 items, patterns 4 entries
- ✓ Idempotency upsert : 2nd POST → même `report.id`, pas de duplicate
- ✓ Audit trail : `weekly_report.generated` × 6, `weekly_report.email.skipped` × 6, `cron.weekly_reports.scan` × 2
- ✓ UI admin live :
  - `/admin/reports` rendu : h1 "Rapports hebdo", 6 reportLinks, pills MOCK/EN ATTENTE/cost/counts
  - `/admin/reports/[id]` rendu : h1 member label, sections Synthèse/Recommandations/Patterns observés/Génération
  - `/admin/members/[id]?tab=weekly-reports` rendu : tab "Rapports IA" présent dans nav, panel affiche 1 rapport
- ✓ Dev fallback Resend log : 6 emails plain-text affichés (1 par membre actif) avec subject `Rapport hebdo · {label} · 2026-05-04 → 2026-05-10`, body structuré (Synthèse + Recommandations + Patterns + URL)

**Conclusion smoke test** : SPEC §15 J8 "Done quand : un dimanche, Eliot reçoit un email digest avec un rapport structuré pour CHAQUE membre actif Fxmily" → ✅ validé end-to-end (mock SDK path, prêt pour live le jour où Eliot ajoute `ANTHROPIC_API_KEY`).

### Quality gate Phase B+

- **Type-check** : ✓ (tsc --noEmit exit 0)
- **Lint** : ✓ (max-warnings=0)
- **Vitest** : **535/535 verts** (+12 vs Phase A 523, week-window.test.ts)
- **Build prod** : ✓ Turbopack — routes J8 listées : `/admin/reports`, `/admin/reports/[id]`, `/api/cron/weekly-reports`
- **Smoke live** : ✓ 6 reports persisted, idempotency, full audit trail, UI rendered

### Wiring prod attendu (J10)

```
# Hetzner crontab — every Sunday 21:00 UTC
0 21 * * 0  curl -fsS -X POST -H "X-Cron-Secret: $CRON_SECRET" \
            https://app.fxmilyapp.com/api/cron/weekly-reports
```

### Suivis non-bloquants (TIER 4 polish — J9.5+)

- `getReportStatsForAdmin` `findMany` sans pagination → muter en `prisma.weeklyReport.aggregate({ _sum: { costEur: true } })` avant J10 prod.
- Pricing constants en code → considérer env var `USD_TO_EUR_RATE` si FX drift > 5%.
- Allowlist Zod refine sur `ANTHROPIC_MODEL` pour bloquer drift accidentel modèle.
- Sentry capture sur cron `catch` (J10).

### Pré-requis Eliot pour activer Claude live

1. **Claude live** : `ANTHROPIC_API_KEY` dans `apps/web/.env` (Console Anthropic → API Keys → "Create Key" Fxmily). Le `LiveWeeklyReportClient` se réveille automatiquement (factory `getWeeklyReportClient()`).
2. **Email réel à fxeliott** : laisser `WEEKLY_REPORT_RECIPIENT` non-set → default `eliot@fxmilyapp.com` (compte Resend vérifié). Domain `fxmilyapp.com` verify J10.

## J8 — Polish post-PR #30 (audit-driven hardening 2e passe, 2026-05-08)

Subagents `security-auditor` + `researcher` (J9 prep) + `performance-profiler` lancés en parallèle après ouverture PR #30. Findings :

### Sécurité — découverte critique externe au repo

**Resend API key live + mot de passe admin exposés dans 4 JSONL Claude Code locaux** (`~/.claude/projects/D--Fxmily*/...`). Surfaces :

- `D--Fxmily--claude-worktrees-thirsty-banzai-82b1f7/7ec0971c-...jsonl` (9 occurrences clé `re_esT...***`).
- `D--Fxmily--claude-worktrees-mystifying-villani-c49530/28a72ada-...jsonl` (J8 session courante).
- 2 sub-agent JSONL dans `.../subagents/`.

**Repo public depuis 2026-05-07 mais .env JAMAIS committé** (vérifié git history clean). Risque limité au disque local mais infostealers Windows scannent `%USERPROFILE%\.claude\projects\`. Procédure rotation documentée dans `docs/jalon-9-prep.md` final report.

**Action Eliot mandatory** : rotation key Resend + changement mdp admin + redaction JSONL post-rotation (PowerShell script fourni dans report final).

**Préventions** :

- Ajouter hook `secret_scanner.ps1` PreToolUse UserPromptSubmit qui block si pattern `re_*`, `sk-ant-*`, `sk-*`, `ghp_*`, `eyJ*` détecté dans prompt.
- `gitleaks protect --staged` à ajouter `.husky/pre-commit`.
- Documenter "ne jamais coller secret en prompt — passer par `$env:VAR` PowerShell hors Claude" dans `docs/env-template.md`.

### Polish performance TIER 1+2 (8 fixes appliqués)

1. **`getReportStatsForAdmin` aggregate SQL** (`lib/weekly-report/service.ts:287-340`) — remplacé `findMany` + reduce JS par 4 queries parallèles : `aggregate({ _count, _sum: { costEur }})` + `findFirst({ orderBy: weekStart desc })` + `groupBy(['sentToAdminAt'])` + `findMany({ distinct, where: weekStart=last })`. **Économie** : à 1000 membres × 104 sem = 104k rows / 10MB heap → bornée par index. RAM constante.
2. **Cursor pagination stable** (`service.ts:262-269`) — ajouté `id: 'desc'` tiebreaker final dans `orderBy: [{ weekStart: 'desc' }, { generatedAt: 'desc' }, { id: 'desc' }]`. Évite saut/répétition rows entre pages quand 2 reports ont même `weekStart` + `generatedAt`.
3. **Mid-batch heartbeat audit** (`service.ts:235-248` + `lib/auth/audit.ts` extension `cron.weekly_reports.batch_done`) — 1 audit row par batch de 5 membres avec `batchIndex`, `batchGenerated`, `batchErrors`, `cumulativeGenerated`. Sous long-running scans (>1min), permet post-mortem précis si crash mid-run. **Smoke test live confirmé** : 2 batch rows persistées par scan (5+1 membres).
4. **User metadata pré-chargé dans loader** (`loader.ts:41-46` + `service.ts:467-485`) — `LoadedWeeklySlice.userMeta` joint email/firstName/lastName dans le `findUnique` initial. `maybeSendEmail` accepte `preloadedUserMeta?` optionnel, économise round-trip DB par membre. **À 30 membres** : 30 round-trips économisés.
5. **Member labels via `IN(distinctIds)`** (`app/admin/reports/page.tsx:50-67`) — remplacé `listMembersForAdmin()` (qui charge TOUS les membres non-soft-deleted) par `db.user.findMany({ where: { id: { in: memberIds } } })` dérivé de `items.map(r => r.userId)`. **À 1000 membres** : 970 rows économisés par render.
6. **Skip Claude pour membres inactifs** (`service.ts:91-100`) — court-circuit live API si `tradesTotal === 0 && morningCheckinsCount === 0 && eveningCheckinsCount === 0`. Le mock client produit déjà une output déterministe "no activity" sémantiquement identique. **Économie** : à 1000 membres × 30% inactifs = -27 €/mois sur cible SPEC §16. Audit metadata `hasActivity: bool` ajoute traçabilité. Smoke test live confirmé : `has_activity=true` pour membre seedé, `false` pour 4 autres.
7. **Allowlist Zod refine `ANTHROPIC_MODEL`** (`lib/env.ts:53-66`) — `.refine((v) => ['claude-sonnet-4-6', 'claude-haiku-4-5', 'claude-opus-4-7'].includes(v))`. Bloque drift accidentel (typo `claude-opus-4-7` au lieu de `claude-sonnet-4-6` = 5× le coût).
8. **`logAudit` payload metadata enrichi** — `weekly_report.generated` audit row inclut `hasActivity: bool` pour stats observability cumul (post-J10 : tracker ratio actifs/inactifs hebdomadaire).

### Suivi non-bloquant différé J10 prod

- **Cron `after()` background** (T1.2 du profiler audit) — passer le batch wrapper en `after()` Next.js 16 pour return 202 immediate + audit row final dans le callback. Évite timeout reverse-proxy Caddy à 1000 membres × 5min = >5min de batch. **Pas blocker V1 30 membres** (90s synchrone OK), à wirer J10 prod (cf. profiler audit T1.2 recommendation).
- **`TradeAnnotation` index `(trade.userId, createdAt)`** absent → JOIN au lieu d'index hit. À 1000 membres × 6 mois annotations = potentielle slowness. À mesurer `EXPLAIN ANALYZE` post-seed J9 démo.
- **Sentry capture sur cron catch** (existant J10).

### Quality gate post-polish

- **Type-check** : ✓
- **Lint** : ✓ (max-warnings=0)
- **Vitest** : 535/535 verts (stable, pas de régression)
- **Build prod** : ✓ Turbopack
- **Smoke test live** : ALL GREEN
  - 6 reports persistés
  - `weekStart === '2026-05-04'` (Mon Paris CEST) — BLOCKER #1 fix audit Phase G tient
  - Idempotency upsert (même id sur re-run)
  - 2 batch heartbeat audit rows par scan
  - `hasActivity=true` (1) + `hasActivity=false` (5) classification correcte
  - `cron.weekly_reports.scan` × 2 + `cron.weekly_reports.batch_done` × 4

### Briefing J9 préparé : `docs/jalon-9-prep.md`

13 sections couvrant Apple Declarative Web Push BLOCKER (Safari 18.4+), web-push lib 3.6.7, Service Worker manuel Next.js 16 (Serwist incompatible Turbopack default), iOS PWA fragility table, fallback email mandatory SPEC §18.2, architecture Phase A→E, RGPD privacy push, pré-requis Eliot (VAPID generate + logo + iPhone test), pickup prompt prêt à coller post-`/clear`. Lecture obligatoire avant nouvelle session J9.

## J9 — Web Push notifications (livré 2026-05-08)

Wire complet Web Push : VAPID + Service Worker + dispatcher cron + UI `/account/notifications`. Carbon-copy J8 patterns + 5-subagent audit-driven hardening.

### Modèle de données

3 nouveaux modèles via migration `20260508180000_j9_push_subscription` :

- **`PushSubscription`** (`push_subscriptions`) — 1 row par (user, browser/device). UNIQUE `(userId, endpoint)`. `endpoint` Text (max 2048 Zod-enforced), `p256dhKey` (~88 chars base64url), `authKey` (~22 chars), `userAgent` Text? (sanitized via `safeFreeText` + truncated 2048), `lastSeenAt` (bumped on dispatch + pushsubscriptionchange — used for J9.5+ 90-day cleanup cron).
- **`NotificationPreference`** (`notification_preferences`) — composite PK `(userId, type)`. `enabled` Boolean default `true` (consent default-on, opt-out by toggle). Missing row = enabled. Cascade User delete.
- **`NotificationQueue` extension** : `+last_error_code` (machine taxonomy : gone, rate_limited, server_error, timeout, network, promise_rejected, payload_too_large, unknown), `+next_attempt_at` (exponential backoff anchor 4^(attempts-1) capped 30 min, honors Retry-After).
- **Enums étendus** : `NotificationType` +douglas_card_delivered +weekly_report_ready ; `NotificationStatus` +`dispatching` (atomic claim race-safe).
- **Index partial** `notification_queue_pending_dispatch_idx ON (status, next_attempt_at) WHERE status IN ('pending', 'dispatching')` — dispatcher hot-path narrow scan.

### Stack

- `web-push@3.6.7` + `@types/web-push@3.6.4` (RFC 8030/8292 stable). Lazy-imported via `LiveWebPushClient`.
- Apple Declarative Web Push (Safari 18.4+ / iOS 18.4+ / iOS 26 default standalone) supported via dual payload `{ web_push: 8030, notification: { title, body, navigate, ... }, type, id }`.
- Service Worker `public/sw.js` plain JS (Turbopack-compatible — Serwist requires Webpack).
- `app/manifest.ts` Next.js 16 native (replaces static `manifest.webmanifest`, served at `/manifest.webmanifest`).

### Service Worker (`public/sw.js`)

3 handlers : `push` (DUAL Apple declarative + classic), `notificationclick` (focus existing same-origin tab + `client.navigate` OR `clients.openWindow`), `pushsubscriptionchange` (Firefox auto-resubscribe vers `/api/account/push/resubscribe`).

### UI `/account/notifications`

- Page Server Component avec auth gate + `Promise.all` (preferences + safe subscriptions list — NEVER endpoints).
- `<PushToggle>` 5 states (`loading | unsupported | not-standalone | permission-denied | idle-no-sub | subscribed`). Detects iOS standalone, requests permission only on user-gesture click.
- `<PreferencesGrid>` 5 toggles `<input type="checkbox" role="switch">` avec single `<label htmlFor>` + `aria-describedby`.
- `<ServiceWorkerRegister>` Client island avec `updateViaCache: 'none'`.
- Posture Mark Douglas (no audio, no FOMO) ancrée dans la section "Comment ça marche".

### Server Actions + route

- `subscribePushAction`, `unsubscribePushAction`, `unsubscribeAllPushAction`, `togglePreferenceAction`, `logPermissionDecisionAction`.
- **`/api/account/push/resubscribe`** route handler dédié (POST) pour le SW Firefox `pushsubscriptionchange` event.
- **`/api/cron/dispatch-notifications`** carbone J5/J6/J7/J8 (timingSafeEqual SHA-256 + token bucket 5/1min + 503/401/405/429 + `?at=ISO` strict + double-gate dev).

### Dispatcher (`lib/push/`)

- **`web-push-client.ts`** : factory `IWebPushClient` + `MockPushClient` (V1 default) + `LiveWebPushClient` (lazy-imports `web-push`, `aes128gcm`, error taxonomy 8 kinds).
- **`dispatcher.ts`** : pure `buildPayload` (Apple+classic), `classifyError` (gone→delete, payload_too_large→fail, retryable→retry+backoff), `nextAttemptDelay` (exp 4^(att-1) capped 30 min, retryAfter honored).
- **`dispatchOne`** atomic claim `updateMany WHERE status='pending' AND nextAttemptAt <= now → dispatching+attempts++`, preference filter post-claim, fan-out `Promise.allSettled`, 410 Gone auto-delete, retry budget MAX_ATTEMPTS=3.
- **`dispatchAllReady`** : crash recovery first (rows `dispatching` > 10 min → `pending`, audit `recoveredStuck`), FIFO scan capped `maxPerRun=200`.
- **`preferences.ts`** : `getEffectivePreferences` (default-true if missing), `setPreference` upsert, `isPreferenceEnabled`.
- **`service.ts`** : cap `MAX_SUBSCRIPTIONS_PER_USER=10` + `TooManySubscriptionsError`, `safeFreeText` userAgent, `listSafeSubscriptionsForUser` (NEVER endpoint exposed, SPEC §16).

### Audit-driven hardening (5 subagents, 6 BLOCKERs + 4 HIGH closed)

- code-reviewer 2 BLOQUANTs : route `/api/account/push/resubscribe` créée (404 silent fix), stuck `dispatching` recovery 10 min.
- security-auditor 0 critique, 2 ÉLEVÉ + 5 MEDIUM. Pattern carbone strict, no payload logging.
- accessibility-reviewer 3 BLOQUANTs : back-link size 's' (32px) → 'm' (44px), preferences-grid double `<label htmlFor>` (WCAG 4.1.2) → `<span>` wrapper, focus ring sur 44×44 hit-area.
- ui-designer 4 DS-tokens BLOCKERs : `text-danger` → `text-[var(--bad)]`, `bg-muted/50` → `bg-[var(--bg-2)]`. 6 HIGH polish reclassés J9.5+.
- fxmily-content-checker 2 BLOQUANTs + 3 HIGH copy : refonte douglas_card_delivered (anti-FOMO + anti-anthropomorphisation), adoucissements push-toggle + checkin morning + annotation.

TIER 2 fixes : `kind:'promise_rejected'` retryable, `failureReason='all_endpoints_gone'` explicit, cap 10 subs, `safeFreeText` userAgent, `aria-busy`+`aria-pressed`+sr-only live region push-toggle.

### Quality gate finale J9

- type-check exit 0, lint exit 0, **Vitest 617/617 verts** (+72 vs J8 baseline 545)
- Build prod OK Turbopack — route `/api/cron/dispatch-notifications` listed
- Migration appliquée live (18 tables en DB)
- Smoke live `scripts/smoke-test-j9.ts` ALL GREEN (mock client path) :
  - cron POST 200 → `{sent:1, scanned:1, recoveredStuck:0}`
  - Idempotency 2nd → `{scanned:0, sent:0}`
  - Preference filter → `{skipped:1}` + audit `notification.dispatch.skipped`

### Pré-requis Eliot pour activer Live VAPID

1. **VAPID keys** : déjà dans `apps/web/.env` (J8 polish session, cf. memory `fxmily_project.md:92`).
2. **iPhone test physique** : pour valider iOS Safari 18.4+ Declarative Web Push real-device (mandatory SPEC §15 J9 critère).
3. **HTTPS** : `pushManager.subscribe()` exige HTTPS strict iOS Safari (localhost OK Chrome desktop seulement) — ngrok tunnel ou prod app.fxmilyapp.com.

### TODO J9.5+ (UI polish premium reclassé)

- Aurora hero + halo Bell + h-rise H1 (focal premium, carbone J7 reader).
- AnimatePresence transitions 5 states `<PushToggle>` (slide-fade y:4).
- Skeleton shimmer loading state.
- `<Btn kind={isSubscribed ? 'danger' : 'primary'}>` + `<Pill tone="mute">` empty state cohérence DS.
- `<TrendCard>`-style notifs reçues 7j sparkline.
- Apple Touch Icon 192/512/96 PNG dédiés.
- Dispatcher 5-by-5 parallel batch (carbone weekly-reports) si scan > 5 min Caddy timeout.

### TODO J10 prod

- Hetzner crontab `*/2 * * * *` UTC `dispatch-notifications`.
- M5 RGPD : cron `0 5 * * 0` purge subscriptions `lastSeenAt < now - 90d`.
- M1 sécurité : endpoint URL allowlist FCM/APNs/Mozilla/Windows.
- Email fallback après 3 attempts failed (SPEC §18.2) — Resend template carbone J4.
- Sentry capture `/api/cron/dispatch-notifications` catch.

## J10 — Production hardening (livré 2026-05-09)

Phase A → H couvrent SPEC §15 J10 + §16 : RGPD self-service, Sentry, Hetzner
deploy, domaine `fxmilyapp.com`, première invitation prod. Branche
`claude/j10-prod-deploy` (4 commits granulaires, rebase merge).

### Phases livrées (in-session)

- **A — RGPD foundation** (`f0bae30`) : migration `20260508210000_j10_user_deleted_at`,
  7 nouvelles `AuditAction` (`account.data.exported` / `account.deletion.{requested,
cancelled, materialised, purged}` / `cron.purge_{deleted, push_subscriptions}.scan`),
  3 pages legal Server Component (`/legal/{privacy,terms,mentions}`), `<LegalFooter>`
  - `<CookieBanner>` montés globalement, `/account/data` (export JSON download +
    Server Action audit), `/account/delete` (state machine `(status, deletedAt)`
    via `deriveDeletionState` : active → scheduled 24h → materialised → hard-purge
    30j), 2 cron routes (`/api/cron/purge-deleted` qui matérialise + purge,
    `/api/cron/purge-push-subscriptions` qui retire les subs `lastSeenAt < now-90d`),
    service `lib/account/{deletion,export}.ts` + `lib/push/cleanup.ts`. 28 tests
    TDD (Vitest 659/659, +28 vs J9 baseline 631).
- **B — Sentry integration** (`ba026e0`) : `@sentry/nextjs` installé + 3 configs
  (`sentry.{client,server,edge}.config.ts`) gardées par DSN-presence, `instrumentation.ts`
  registers + ré-emit `Sentry.captureRequestError`, `withSentryConfig` wrap +
  `tunnelRoute: '/monitoring'` + CSP `connect-src 'self' https://*.sentry.io`,
  helper `lib/observability.ts` `reportError(scope, err, extra)` câblé dans les 7
  catch blocks de cron, env Zod cross-var refine `NEXT_PUBLIC_SENTRY_DSN ↔
SENTRY_DSN`, CI source-map upload via `SENTRY_AUTH_TOKEN` injecté seulement sur
  push `main`.
- **C+D+E+F — Hetzner ops** (`7cf22f9`) : `Dockerfile.prod` 3-stage (deps +
  builder + runner non-root uid 1001 ~250 MB), `docker-compose.prod.yml` Postgres
  17 + web standalone + Caddy 2 (réseau interne, secrets via Docker secrets,
  resource caps CX22 4 GB), `Caddyfile` HSTS preload + `-Server` strip + zstd/br/gzip
  - log rolling 100 MiB × 7, wrappers `/usr/local/bin/{fxmily-cron,fxmily-backup}`
    (sourcés depuis `/etc/fxmily/cron.env` 0600, `pg_dump → gzip → GPG AES-256 → R2`
  - 7 jours rotation locale + 30 jours R2 lifecycle), crontab `/etc/cron.d/fxmily-app`
    avec 8 lignes (J5+J6+J7+J8+J9+J10×2+backup), `next.config.ts` `output: 'standalone'`
    pour le tracing runtime. Workflow `.github/workflows/deploy.yml` :
    `docker buildx → push GHCR → SSH appleboy → docker compose pull/up → migrate
deploy via container one-shot prisma`. Runbooks `docs/runbook-{hetzner-deploy,
backup-restore,prod-smoke-test}.md`.
- **G — Audit-driven hardening** (`14b51c2`) : 5 subagents lancés en parallèle
  (code-reviewer + security-auditor + accessibility-reviewer + ui-designer +
  fxmily-content-checker). 5 BLOCKERs + 7 HIGH closed in-session :
  - **CSRF strict** : `/api/account/data/export` rejette si Origin AND Referer
    null (avant : passait).
  - **Cron route allowlist** dans `fxmily-cron` (régression J9 round 2 colmatée).
  - **Promise.all → sequential** dans `purge-deleted` cron (counts atomiques).
  - **Audit userId** : `materialisePendingDeletions` + `purgeMaterialisedDeletions`
    retournent désormais `{materialised,purged}Ids: string[]`. Le cron émet
    `account.deletion.materialised` per-user (avec userId) + `account.deletion.purged`
    per-user (userId dans `metadata`, pas dans la FK qui est SetNull post-cascade).
  - **Prisma migrate path** : `deploy.yml` lance la migration via container
    `node:22-bookworm-slim` one-shot + `npx prisma@7 migrate deploy` au lieu
    d'appeler `apps/web/node_modules/prisma/build/index.js` qui n'existe pas
    dans l'image runtime standalone.
  - **a11y `<ol>` énumération** : spans visibles "1." "2." "3." marqués
    `aria-hidden` (NVDA/JAWS lisaient "1. 1. ...").
  - **a11y live region pending** : DeleteAccountForm + CancelDeletionForm
    enveloppent isPending dans `role="status" aria-live="polite"` sr-only —
    `aria-busy` seul n'est pas annoncé fiable.
  - **a11y footer touch target** : LegalFooter links → `inline-flex min-h-6
px-2 py-1.5` (WCAG 2.5.8 AA 24×24).
  - **a11y CookieBanner contrast + DS Btn** : body bumpé `--t-3 → --t-2`
    (12px sur `--bg-3` ne clearait pas 4.5:1), boutons remplacés par `<Btn
kind="primary"|"ghost" size="m">` (focus ring, hover lift, ≥ 44×44),
    shadow `--sh-toast` token, anchor `bottom-[max(0.75rem,env(safe-area-inset-bottom))]`.
  - **UI last-updated** : LegalLayout badge → `<Pill tone="mute">`.
  - **Sentry URL scrub** : `beforeSend` strip `?token|secret|password|code|key|sig`
    de `query_string` + `url` (magic-link / verify URL leak).
  - **Posture content** : Privacy §5 Anthropic mention "modèle Claude (famille
    Sonnet)" au lieu de "Sonnet 4.6" (anti-drift annuel).
  - **Anti-impulsivité** : DeleteAccountForm placeholder `Tape ici` au lieu de
    `SUPPRIMER` (mobile auto-tap defeat removed).
- **H — Close-out** (ce commit) : section `apps/web/CLAUDE.md` J10 livré +
  memory `fxmily_project.md` état final V1 + briefing V2 roadmap.

### Modèle de données

Migration `20260508210000_j10_user_deleted_at` :

- `User.deletedAt DateTime?` — anchor unique pour les 3 phases du soft-delete :
  `null` (active), `now+24h` (scheduled, status='active'), `now` (materialised,
  status='deleted').
- Partial index `users_status_deleted_at_idx ON (status, deleted_at) WHERE
status = 'deleted'` — la cron purge scanne en O(log n) sur les rows soft-deleted
  uniquement, pas sur la cohorte entière.

### Stack

- **`@sentry/nextjs`** (latest, gardé par DSN-presence pour dev silence).
- **Caddy 2** + Let's Encrypt (HTTP-01, HTTPS forcé HSTS preload).
- **Docker Compose** Postgres 17-alpine + web standalone + Caddy 2-alpine.
- **Cloudflare R2** (US east cross-région backup) + AWS CLI profile fxmily-backup.
- **GitHub Actions** docker buildx → GHCR → appleboy/ssh-action → migrate via
  one-shot container.

### Audit-driven hardening (5 subagents, 5 BLOCKERs + 7 HIGH closed)

Pattern carbone canon Fxmily (J5/J6/J7/J8/J9). Chaque subagent renvoie un report
TIER 1 → TIER 4. Les TIER 1 + TIER 2 prio sont fix in-session, TIER 3 / TIER 4
reclassés.

- **code-reviewer** : 6 BLOCKERs (B1 audit userId, B2 race purge-deleted, B3
  CSRF Origin null, B4 cron allowlist, B5 build env OK, B6 prisma migrate path)
  → tous closed.
- **security-auditor** : 2 TIER 1 (allowlist + CSRF, doublons code-reviewer),
  3 TIER 3 (URL token leak, rate-limit `/monitoring`, rate-limit export route)
  → URL strip closed, rate-limits reclassés J11.
- **accessibility-reviewer** : 5 BLOCKERs (a11y B1 ol span, B2 aria-busy SR,
  B3 footer touch, B4 cookie banner obscure focus, B5 contrast `--t-3` on
  `--bg-3`) → tous closed via DS Btn swap + bump tokens.
- **ui-designer** : 0 TIER 1, 4 TIER 2 (shadow magic, Btn custom, Pill custom,
  hierarchy h2) → 3 fixés (shadow `--sh-toast`, Btn DS, Pill DS), hierarchy
  h2 reclassé J10.5+.
- **fxmily-content-checker** : 0 TIER 1, 1 TIER 3 (Sonnet 4.6 hardcoded
  drift) → fixé.

### Quality gate finale J10

- **Format check** ✓ — `pnpm format:check` clean
- **Lint** ✓ — `pnpm lint` exit 0 (max-warnings=0)
- **Type-check** ✓ — `tsc --noEmit` exit 0
- **Vitest** : **659/659 verts** (+28 vs J9 baseline 631)
- **Build prod Turbopack** ✓ — toutes routes J10 listées :
  - `/api/account/data/export` (ƒ POST)
  - `/api/cron/purge-deleted` (ƒ POST)
  - `/api/cron/purge-push-subscriptions` (ƒ POST)
  - `/account/data` (ƒ Server Component)
  - `/account/delete` (ƒ Server Component)
  - `/legal/privacy` (○ static)
  - `/legal/terms` (○ static)
  - `/legal/mentions` (○ static)
- **Migration appliquée** (live dev DB) — partial index vérifié `\d users` :
  `"users_status_deleted_at_idx" btree (status, deleted_at) WHERE status =
'deleted'::"UserStatus"`.

### Pré-requis Eliot pour Phase F (1ère invitation prod, BLOQUÉE in-session)

Cf. `docs/runbook-prod-smoke-test.md` (12 steps end-to-end). Conditions à
satisfaire AVANT d'exécuter le smoke :

**État au 2026-05-09 (post-Phase R)** — 7 → **5** pré-requis bloquants :

1. ✅ **Hetzner CX22** : utiliser `hetzner-dieu` 178.104.39.201 existant
   (déjà payé pour n8n/Langfuse). `bootstrap-fxmily.sh --skip-hetzner
FXMILY_HETZNER_IP=178.104.39.201` réutilise l'IP existante.
2. ✅ **Domaine** : `fxmilyapp.com` (déjà possédé par Eliot via Cloudflare).
   DNS apex configuré, ajouter le sous-domaine `app.fxmilyapp.com` →
   Hetzner IP via `cloudflare-dns-setup.sh`. Achat `fxmily.com` reporté V2.
3. ⏳ **Resend Console** → `fxmilyapp.com` domain **verified** (3 TXT
   propagés ~15 min, **pas 24h** — vérifié Phase R web research).
4. ⏳ **Sentry projet créé** + DSN dans `/etc/fxmily/web.env` + AUTH_TOKEN
   dans GitHub secrets.
5. ⏳ **iPhone Safari 18.4+** dispo pour le push real-device test.
6. ⏳ **Mdp admin rotaté** post-J8 polish (incident sécurité Resend key
   leak — détails `docs/jalon-9-prep.md`).
7. ⏳ **GitHub secrets** posés via `pose-github-secrets.sh tokens.local.env` :
   `HETZNER_HOST`, `HETZNER_SSH_KEY`, `SENTRY_AUTH_TOKEN`, `SENTRY_ORG`,
   `SENTRY_PROJECT` + Resend + Cloudflare + VAPID + CRON_SECRET.

Une fois ces 7 boîtes cochées, l'invitation Eliot → eliot@fxmilyapp.com →
onboarding → trade → check-in → score → fiche → push iPhone → digest weekly
→ export JSON → erreur Sentry → tout vert : SPEC §15 J10 satisfait.

### TODO J10.5+ (reclassés post-V1)

Items détectés par les audits mais non-bloquants pour le critère SPEC §15 J10.
À considérer une fois le V1 ship :

- **Rate-limit `/api/account/data/export`** par userId (token bucket par
  user → DB load anti-spam à 1000+ membres).
- **Rate-limit `/monitoring` tunnel route Sentry** (DoS du quota côté
  attaquant — Sentry Free a hard cap 5000 errors/mois).
- **Atomic update** dans `requestAccountDeletion` (UPDATE WHERE deletedAt=null
  pour fermer le race check+update).
- **Skip-link** `<a href="#main">Aller au contenu</a>` global (WCAG 2.4.1)
  avec `id="main"` sur les `<main>`.
- **Hierarchy h2** des pages legal — `text-base sm:text-lg` pour amorcer la
  cadence (UI designer T2-6).
- **`role="alert"`** au lieu de `role="status"` pour les error regions
  (a11y H5 — assertive plus appropriée).
- **CookieBanner transition** d'apparition (opacity 200ms `--e-smooth`).
- **`<Code>` component** extracted (drift across `legal-layout` / `account/data`
  / `delete-form`).
- **CSP nonces** Phase J10 hardening (`'unsafe-inline'` aujourd'hui — déjà
  noté `next.config.ts:8`).
- **Annual DR test** dans `docs/runbook-backup-restore.md` (RTO objectif
  < 24h, mesurer).

## J10 — Phases I + J + K (audit rounds 2-3 + observability + polish, livré 2026-05-09)

**3 rounds audit-driven hardening cumulés**, **18 BLOCKERs/HIGH closed
in-session** sur les 11 items J10.5+ initialement reclassés (3 vraiment
V2). 4 commits supplémentaires sur `claude/j10-prod-deploy` :

### Phase I — Promote J10.5+ + ops scripts (`f2187af`)

8 items J10.5+ ramenés dans J10 :

- **Atomic `requestAccountDeletion`** — `updateMany WHERE status='active'
AND deletedAt IS NULL` collapse check+update en single atomic op.
- **Per-user rate limit `/api/account/data/export`** (token bucket
  `bucketSize=3, refillRate=1/15min` keyed by `userId`).
- **Sentry tunnel rate limit** (`bucketSize: 50, refillRate: 1`).
- **`proxy.ts` matcher exclut `/monitoring`** (Sentry tunnel ne doit pas
  être 307→/login).
- **Skip-link global** `<a href="#main-content">` + wrapper avec
  `tabindex="-1"` (WCAG 2.4.1).
- **`<Code>` extracted DS component** (3 callsites unifiés).
- **`role="alert"` form error regions** (WCAG 4.1.3 assertive).
- **CookieBanner entry transition** `motion-safe:animate-cookie-rise`
  220ms slide+fade-in (WCAG 2.3.3 prefers-reduced-motion).
- **Hierarchy h2 legal pages** `text-[15px] sm:text-base`.

5 scripts ops dans `ops/scripts/` (réduction effort manuel Eliot
~2h → ~30 min) : `provision-hetzner.sh`, `setup-host.sh`,
`verify-dns.sh`, `post-deploy-smoke.sh`, `eliot-prerequisites.md`.

### Phase J round 3 — CVE + perf + tests (`f5ba4a9`)

Audit 3 subagents en parallèle (perf-profiler + test-writer + dep-auditor).

**SECURITY CRITICAL CVE patch** : Bump `next 16.2.4 → 16.2.6` + `react/
react-dom 19.2.5 → 19.2.6`. Couvre 4 HIGH advisories Vercel coordinated
release 2026-05-06 :

- CVE-2026-23870 — DoS deserialization Server Functions
- CVE-2026-44578 — SSRF WebSocket upgrade self-hosted Node
- CVE-2026-44574 — Middleware bypass via `.rsc`
- CVE-2026-44575 — Middleware bypass via segment-prefetch

Fxmily self-hosted Node sur Hetzner avec App Router + middleware
Auth.js v5 — directement exposé. Patch line, zero breaking change.

**Perf wins** :

- `purge-push-subscriptions` N+1 → `findMany {select:id}` + `deleteMany`
  ~500x latence cron.
- Export RGPD : drop `null, 2` JSON.stringify → ~30% size, ~50% RAM
  transient à 5000+ trades.
- `flushSentry(2000)` ajouté + appelé dans 7 cron catches avant return.

**Tests** : 707/707 verts (+47 vs J10 ship 660).

### Phase J observability — `/admin/system` + cron-watch (`4d9381c`)

- **`lib/system/health.ts`** — `getCronHealthReport()` query
  `auditLog.groupBy({by: action, _max: createdAt})` puis classifie status
  green/amber/red/never_ran selon période + tolerance multiplier per-cron.
- **`/api/cron/health`** POST auth-gated, branche HTTP code (200 vert/
  ambre, 503 rouge/never). Émet aussi audit row `cron.health.scan`.
- **`/admin/system`** Server Component admin-gated — cohort snapshot
  card grid + per-cron heartbeat list avec Pill tone-aware.
- **`.github/workflows/cron-watch.yml`** scheduled hourly. Curl le
  endpoint, ouvre/comment issue auto-labeled si 503, ferme auto si 200.
  Paper trail GitHub.

### Phase K — Final consistency + Apple Touch Icons (`ded91dd`)

- **Audit slug semantic fix** : `admin.system.viewed` (nouveau) au lieu
  de réutiliser `admin.members.listed`. `cron.health.scan` ajouté.
- **`/api/cron/health` heartbeat self** — émet son propre audit row
  pour que cron-watch détecte aussi un cron-watch broken.
- **Tests `lib/system/health.test.ts`** (7 tests) — pin status thresholds,
  red shadows, never_ran distinct, exactement 7 entries.
- **Apple Touch Icons + favicon** dynamiques via Next.js 16 `app/icon.tsx`
  - `app/apple-icon.tsx` `ImageResponse`. No ImageMagick/sharp dep.
    180×180 + 32×32 PNG en lockstep DS v2 (`#07090f` deep-space + `#a3e635`
    lime accent + system-ui "f" mark).
- **`proxy.ts` matcher** étendu pour exclure `apple-icon|icon`.

### Quality gate finale post-K

- format ✓, lint ✓, type-check ✓
- **Vitest 714/714 verts** (+83 vs J9 baseline 631, +54 vs J10 ship 660)
- Build prod Turbopack ✓ Next 16.2.6 + React 19.2.6 patched (CVE clean)
- **Smoke E2E local validé** : tous les routes 200, auth gates 401/307,
  CSP confirmé, skip-link présent, `/api/cron/health` 503 attendu,
  `/apple-icon` 200 PNG 180×180, `/icon` 200 PNG 32×32, `/monitoring`
  404 (pas 307 — proxy matcher exclut bien).

### Commit chain final J10 (9 commits)

```
ded91dd feat(j10): Phase K — semantic audit fix + health.ts tests + Apple Touch Icons
4d9381c feat(j10): observability prod — /admin/system + cron-watch workflow
f5ba4a9 fix(j10): CVE patch Next 16.2.6 + perf wins + +47 tests (round 3)
f2187af perf(j10): promote J10.5+ items + Eliot ops automation scripts
768ade2 docs(j10): close-out CLAUDE.md J10 + v2-roadmap
14b51c2 perf(j10): audit-driven hardening — 5 BLOCKERs + 7 HIGH closed
7cf22f9 perf(j10): Hetzner Docker prod stack + Caddyfile + cron systemd
ba026e0 feat(j10): Sentry integration + reportError helper + 7 cron catches
f0bae30 feat(j10): RGPD foundation + soft-delete + cron purge
```

## J10 — Phases L + M + N + O + P (post-K extension, livré 2026-05-09)

8 commits supplémentaires sur `claude/j10-prod-deploy` après le close-out Phase K. Ce close-out documente Phases L → P (étendant le commit chain final à 18 commits).

### Phase L — `/account` hub + error pages + final review fixes (`e845cf4` + `2e81eb3`)

- **`/account` hub** Server Component : cards links vers `/account/notifications`, `/account/data`, `/account/delete` avec deletion-state aware tone (warn pill si scheduled).
- **`app/error.tsx`** : route-error boundary (catches sous root layout) avec digest ID + retry/home + lazy Sentry.
- **`app/not-found.tsx`** : 404 sober + lien retour dashboard/login selon auth state.
- **Atomic `cancelAccountDeletion`** : `updateMany WHERE status='active' AND deletedAt IS NOT NULL` collapse check+update en single op race-safe.
- **`pose-github-secrets.sh`** automation : lit `tokens.local.env`, pose tous les secrets via `gh secret set` (allowlist DEPLOY_PATH=hetzner|vercel|both).
- **`docs/eliot-prerequisites.md`** : checklist pré-deploy mise à jour 2026-05-09.

### Phase M — Mega automation Cloudflare/Resend/bootstrap (`2ddf48f`)

- **`ops/scripts/cloudflare-dns-setup.sh`** : pose A `app` → Hetzner IP + MX Resend + 3 TXT SPF/DKIM/DMARC via Cloudflare API.
- **`ops/scripts/resend-domain-add.sh`** : add domain `fxmilyapp.com` + récupère les 3 DNS records DKIM/SPF.
- **`ops/scripts/bootstrap-fxmily.sh`** : orchestrator chain → provision-hetzner → resend-domain-add → cloudflare-dns-setup → pose-github-secrets.
- Réduit l'effort manuel Eliot ~2h → ~30 min côté setup. Les pré-requis externes (compte Hetzner, achat `fxmilyapp.com`, compte Resend) restent côté Eliot.

### Phase N — Zero-cost deployment path (Vercel + Neon + GH Actions) (`cd7e623` + `a0a9b86`)

Alternative gratuite à Hetzner pour respecter "pas de coût supplémentaire" (Eliot constraint) :

- **`.github/workflows/deploy-vercel.yml`** : Vercel Hobby free tier (~100 GB bw, 100 h compute) + Neon (Postgres serverless gratuit 0.5 GB) + GH Actions cron (5-min schedule pour bypass cron Hetzner).
- **`docs/zero-cost-deployment.md`** : guide complet 4-paths comparison + non-commercial use clause warning.
- **Switch Hetzner ↔ Vercel** mutuellement exclusif via `vars.DEPLOY_PATH=hetzner|vercel` repo variable.

### Phase O — 3 BLOCKERs cross-file (`bfd43c5`) + Phase O fix-up format (`81d3fc5`)

Audit multi-subagent rounds 4 & 5 :

- **B1** : `deploy.yml` ET `deploy-vercel.yml` triggeraient en parallèle sur push main. Fix : `if: vars.DEPLOY_PATH == 'hetzner'|'vercel'` mutuellement exclusif.
- **B2** : commentaire `proxy.ts` mentionnait que `sentryTunnelLimiter` était wired sur `/monitoring`, FAUX (tunnel route auto-générée par Sentry plugin, pas de hook). Commentaire corrigé, limiter export gardé comme stub V2.
- **B3** : `getCronHealthReport` devait inclure `cron.health.scan` (self-monitoring du watcher). 8e expectation ajoutée + tests adaptés.
- **H4** : `pose-github-secrets.sh` restructuré PATH_A_SECRETS (Hetzner) / PATH_B_SECRETS (Vercel) / SHARED_SECRETS pour éviter les drifts.
- **Format fix-up** : `prettier --write docs/runbook-prod-smoke-test.md` (CI format check unblock — 2 markdown indentation drifts).

### Phase P — 6 BLOCKERs from 6-subagent ultra-deep audit (`0588d12`)

6 audits parallèles (verifier + perf-profiler + ui-designer + doc-writer + content-checker + researcher SPEC + researcher hygiene). 6 BLOCKERs cross-cutting que les audits per-jalon avaient laissés filer :

- **T1.1 — Auth status gate global** : `auth.config.ts` `authorized()` short-circuit `auth.user.status !== 'active'` AVANT per-route gates. Defense-in-depth contre user soft-deleted/suspended gardant un JWT valide 30j.
- **T1.2 — Schema sanitization** : `nameSchema` (auth), `notesSchema` (trade), `commentSchema` (annotation), `emailSchema` ajoutés `.refine(!containsBidiOrZeroWidth)` + `.transform(safeFreeText)`. Trojan-Source vector neutralisé sur admin trade view, weekly Claude IA prompt input, dashboard greeting.
- **T1.3 — `app/global-error.tsx`** : Next 16 root-layout catch (catches errors DANS `app/layout.tsx` que `app/error.tsx` ne peut pas attraper). Own `<html>`/`<body>` + inline styles + lazy Sentry import.
- **WCAG B1 — `delete-button.tsx`** : touch target text-xs ~16px → `min-h-6 + py-1.5` (≥24×24 WCAG 2.5.8 AA).
- **WCAG B2 — `<Link><Btn>` nesting** : `welcome/page.tsx` + `admin/members/page.tsx` switchés `<Link className={btnVariants(...)}>` (single `<a>`, pattern existant dans repo).
- **WCAG B3 — `EmptyState` / `ErrorState`** : `headingLevel?: 'h2' | 'h3'` prop default `'h2'` (was hard-coded `h3` skipping hierarchy).
- **WCAG B4 — splash-hero secondary CTA inerte** : `<Btn>Demander un accès</Btn>` sans onClick → `<a href="mailto:eliot@fxmilyapp.com?subject=...">` + `btnVariants`.
- **Deps T2 — hono CVE override** : pnpm.overrides `hono >= 4.12.18` (CVE-2026-44457/44458/44459 dev-only via @prisma/dev).
- **Tech debt — `docs/env-template.md`** complété avec `WEEKLY_REPORT_RECIPIENT`, `CRON_SECRET`, `UPLOADS_DIR` (validés Zod mais absents du template).

### Quality gate finale post-P (2026-05-09)

- format ✓, lint ✓, type-check ✓
- **Vitest 717/717 verts** (+86 vs J9 baseline 631, +57 vs J10 ship 660)
- Build prod Turbopack ✓ Next 16.2.6 + React 19.2.6 patched (CVE clean)
- CI [PR #35](https://github.com/fxeliott/fxmily/pull/35) verte sur 3 checks (Lint+type-check+build, Analyze JS-TS, CodeQL).

### Commit chain final J10 (18 commits Phases A → P)

```
0588d12 fix(j10): Phase P — 6 BLOCKERs from 6-subagent ultra-deep audit
81d3fc5 chore(j10): prettier --write runbook-prod-smoke-test (CI format fix)
bfd43c5 fix(j10): Phase O — 3 BLOCKERs cross-file + drift sync
a0a9b86 docs(j10): clarify Vercel Hobby non-commercial clause + 4 paths comparison
cd7e623 feat(j10): Phase N — zero-cost deployment path (Vercel + Neon + GH Actions)
2ddf48f feat(j10): Phase M — mega automation cloudflare/resend/bootstrap
2e81eb3 feat(j10): pose-github-secrets.sh automation + eliot-prerequisites doc update
e845cf4 feat(j10): Phase L — /account hub + error pages + final review fixes
40076da docs(j10): close-out CLAUDE.md phases I+J+K — final 9-commit chain
ded91dd feat(j10): Phase K — semantic audit fix + health.ts tests + Apple Touch Icons
4d9381c feat(j10): observability prod — /admin/system + cron-watch workflow
f5ba4a9 fix(j10): CVE patch Next 16.2.6 + perf wins + +47 tests (round 3)
f2187af perf(j10): promote J10.5+ items + Eliot ops automation scripts
768ade2 docs(j10): close-out CLAUDE.md J10 + v2-roadmap
14b51c2 perf(j10): audit-driven hardening — 5 BLOCKERs + 7 HIGH closed
7cf22f9 perf(j10): Hetzner Docker prod stack + Caddyfile + cron systemd
ba026e0 feat(j10): Sentry integration + reportError helper + 7 cron catches
f0bae30 feat(j10): RGPD foundation + soft-delete + cron purge
```

## J10 — Phase R (web research + reality check + 3 PWA BLOCKERs, livré 2026-05-09)

4 subagents lancés en parallèle (R.1 web research libs/services + R.2 trading expert posture + R.3 perf T1.1/T1.2/T1.4 + R.4 prerequisite reality check). 3 BLOCKERs PWA détectés en smoke browser live curl localhost.

### R.1 — URGENT findings web research 2026-05-09

- **Vercel Hobby = INVALIDE pour Fxmily** : ToS interdit "any deployment used for financial gain of anyone involved". Fxmily = formation payante = commercial today. → Phase N path (`docs/zero-cost-deployment.md`) flagged ❌ status invalide en haut du doc. Recommandation : Hetzner existant `hetzner-dieu` (déjà payé), domaine `fxmilyapp.com` (déjà possédé). Coût supplémentaire = 0 €.
- **Vercel Hobby AI training opt-in par défaut** : tout contenu déployé est utilisé pour entraîner les modèles AI. Inacceptable pour données membres Fxmily.
- **Auth.js v5 stable ne sortira JAMAIS** : projet transféré à Better Auth team 2025. Pin `@beta.31` exact (pas `@beta`). V2 considérer migration Better Auth.
- **CVE patch validation** : `next@16.2.6` + `react@19.2.6` + `react-dom@19.2.6` couvrent les 13 advisories de mai 2026.
- **Resend free 100/jour cap** = vrai bottleneck (pas le 3000/mois).
- **Sonnet 4.6 reste latest** (Sonnet 4.7 n'existe pas) — best ratio qualité/prix rapports hebdo.
- **CVE 2026-44457 hono ID was wrong** dans nos commits — vrais IDs sont `GHSA-hm8q-7f3q-5f36` (JWT), `GHSA-qp7p-654g-cw7p` (CSS injection), `GHSA-p77w-8qqv-26rm` (Cache Vary), tous fixés `4.12.18`. Override pnpm reste correct.

### R.2 — Trading expert audit posture (SOLID overall, 4 recos V1.5)

Senior trader review : posture conforme SPEC §2 (no market analysis), 50/50 fiches Mark Douglas authentiques, scoring 4-dim solide :

- **Calibration scoring** : `STDDEV_FULL_SCALE = 8` dans `emotional-stability.ts:94` trop généreux (max stdDev sur 1-10 ~4.5) → recalibrer 3.5. `EXPECTANCY_FULL_SCALE = 3` dans `consistency.ts:67` trop sévère (3R/trade = top 1% mondial) → 1.0. **Reclassé V1.5** (changement breaking sur scores existants — rerun cron recompute après).
- **Trade quality grading** : ajouter `tradeQuality: 'A'|'B'|'C'|null` + `riskPct: Decimal(4,2)` (% capital risqué) sur Trade pour Steenbarger best practice ("% A-grade only" sub-score). **Reclassé V1.5**.
- **Triggers manquants** : `{kind:'emotion_logged',tag:'revenge'}` + `{kind:'emotion_logged',tag:'overconfident'}` non câblés sur les fiches existantes (slugs présents mais inexploités). **Reclassé V1.5**.
- **`userId` UUID exposé au prompt Claude** dans `weekly-report/builder.ts:38` + `prompt.ts:81` — pseudonymiser en `member-xxxx`. **Reclassé V1.5**.

### R.3 — Perf T1.1 + T1.2 + T1.4 fixes

- **T1.1 Dashboard duplicate analytics** (`lib/scoring/dashboard-data.ts:112`) : `getDashboardAnalytics` wrappé dans `cache()` React 19. Per-request memoization → `findMany` + 6 aggregations s'exécutent une seule fois même si TrackRecordSection + PatternsSection appellent en parallèle.
- **T1.2 Dispatcher sequential** (`lib/push/dispatcher.ts:595-629`) : `dispatchAllReady` passe à concurrency bounded 8 via `Promise.allSettled` chunks. Latence cron divisée par ~8.
- **T1.4 Audit retention 90j** : `lib/audit/cleanup.ts` (NEW, 90 LOC) + `app/api/cron/purge-audit-log/route.ts` (NEW, 104 LOC) + slug `cron.purge_audit_log.scan` + `health.ts` 9e expectation + `crontab.fxmily` `0 4 * * *` + `fxmily-cron` allowlist. Pattern carbone `purge-push-subscriptions`.

### R.4 — Reality check pré-requis Eliot

7 → **5** pré-requis bloquants après Phase R :

- ✅ **Hetzner CX22** : `hetzner-dieu` existant 178.104.39.201 (déjà payé pour n8n/Langfuse). `bootstrap-fxmily.sh --skip-hetzner` + `FXMILY_HETZNER_IP=178.104.39.201`.
- ✅ **Domaine** : pivot V1 sur `fxmilyapp.com` (déjà possédé, Cloudflare DNS configuré). Achat éventuel `fxmily.com` reporté V2 si l'image de marque l'exige.
- ⏳ Sentry DSN signup (gratuit 5000 events/mois, no CB).
- ⏳ Resend domain `fxmilyapp.com` verify (3 TXT DNS Cloudflare → ~15 min propagation).
- ⏳ iPhone Safari 18.4+ test (non automatisable, device physique).
- ⏳ Admin password rotation (non automatisable).
- ⏳ GitHub secrets via `pose-github-secrets.sh tokens.local.env`.

### Phase R smoke browser : 3 PWA/SEO BLOCKERs détectés et fixés

Smoke E2E live via `curl` sur dev server `D:/Fxmily` (port 3001) — détectés en testant les routes publiques :

- **`/manifest.webmanifest`** retournait 307 → /login → **PWA install cassé sur splash anonyme**.
- **`/sw.js`** retournait 307 → service worker pas registrable côté anonyme → push registration cassée.
- **`/robots.txt`** + **`/sitemap.xml`** retournaient 307 → SEO crawlers redirigés vers login.

Fix : `proxy.ts` matcher étendu pour exclure `manifest\.webmanifest|sw\.js|robots\.txt|sitemap\.xml`. Vérifié live `/manifest.webmanifest` 200 + JSON correct, `/sw.js` 200, `/robots.txt` + `/sitemap.xml` 404 (fichiers absents = OK V1 cohorte privée).

### Phase R quality gate

- format ✓, lint ✓, type-check ✓, **Vitest 717/717 verts**.
- Build prod Turbopack ✓ — nouvelle route `/api/cron/purge-audit-log` listée dans le manifest des routes (9e cron).
- Smoke browser live D:/Fxmily HEAD post-R confirme : `/`, `/login`, `/legal/*`, `/apple-icon`, `/icon`, `/manifest.webmanifest`, `/sw.js`, `/api/health` → 200. `/dashboard`, `/account`, `/admin/system` → 307→/login (auth gate intact).
- WCAG fixes Phase P toujours visibles dans HTML rendered : `<a href="mailto:eliot@fxmilyapp.com">` sur splash secondary CTA + `<a className={btnVariants(...)}>` direct sur welcome/admin/members links.

## J10 — Phase S + T + U + V (livré 2026-05-09)

**Phase S** — pivot domain V1 vers `fxmilyapp.com` (51 fichiers patchés sed) + `tokens.local.env.example` refondu + guide HTML résumé `eliot-guide-prod-launch.html`.

**Phase T** — login rate-limit anti-abuse :

- `auth.config.ts authorized()` global status='active' gate
- `loginEmailLimiter` (5 burst) + `loginIpLimiter` (10 burst) consommés par `signInAction` ET `auth.ts authorize()` (couvre `/api/auth/callback/credentials` direct)
- `app/robots.ts` + `app/sitemap.ts` (Disallow:/ V1 cohorte privée)
- Email perso scrubbed du repo public
- 4 scripts ops : `generate-local-secrets.sh` + `test-tokens.sh` + `preflight-check.sh` + `rotate-admin-password.sh`

**Phase U** — guide HTML débutant + master script :

- `docs/eliot-guide-screens.html` (1402 LOC) — 26 écrans Sentry/Resend/Cloudflare détaillés + glossaire 14 termes débutant
- `ops/scripts/prod-launch.sh` — master orchestrator failsafe
- Fix critical 2026 : Resend DKIM = 1 TXT (pas 3 CNAMEs)

**Phase V** — tests + calibration audit + CVE sweep :

- V.1 : 14 tests Vitest login rate-limit (token-bucket + actions.test.ts NEW). Tests 717→731 verts.
- V.2 : audit calibration scoring (`STDDEV 8→4`, `EXPECTANCY 3→1`) — edits revertés par hook auto (Phase W investigation à venir)
- V.3 : verifier 28/28 items VERIFIED. Phase P→U intactes.
- V.4 : CVE sweep 0 CVE Critical/High post-2026-05-06. 3 hygiene checks Docker (node 22.22.2, postgres 17.9, caddy 2.11.2).

### Commit chain final J10 (24+ commits Phases A → V)

Voir `git log main..HEAD`. PR #35 CI verte 3/3 (Lint+type-check+build, Analyze JS-TS, CodeQL).

## V1.5 + V1.5.1 + V1.5.2 — Trading-expert calibration (livré 2026-05-09 sur branche dédiée)

> **Branche** : [`feat/v1.5-trading-calibration`](https://github.com/fxeliott/fxmily/tree/feat/v1.5-trading-calibration), 5 commits depuis `claude/j10-prod-deploy` HEAD `368264c`. Ouverte en PR séparée post-merge J10 (respect règle SPEC §18.4 "1 session = 1 jalon").

### V1.5 — Backend (commit `52d4671`)

3 items shipped end-to-end :

1. **Pseudonymisation `userId` → `memberLabel`** au prompt boundary Claude. SHA-256 truncated 24 bits avec salt optionnel V1, mandatory V2 si export externe (`MEMBER_LABEL_SALT` env). Birthday paradox 50 % threshold ≈ 4823 membres. +5 tests.
2. **`Trade.tradeQuality`** enum A/B/C (Steenbarger Daily Trading Coach). Prisma enum + ALTER TABLE nullable + partial index `WHERE trade_quality IS NOT NULL` + Zod `.optional()` + service + admin trades-service + weekly-report loader. +3 tests.
3. **`Trade.riskPct`** Decimal(4, 2) (Tharp 1-2 % rule, aligné Zod `< 100`). Zod `gt(0)` + service + admin + loader. +5 tests.

**Migration** : `20260509180000_v1_5_trade_quality_riskpct/migration.sql` écrite à la main. Apply : `pnpm --filter @fxmily/web prisma:migrate dev`.

**ADRs** :

- [ADR-001](../../docs/decisions/ADR-001-scoring-constants-pragmatic-heuristics.md) (commit `368264c`) — codifie heuristiques pragmatiques sans backing empirique 2024-2026. Trigger re-évaluation cohort drift / peer-reviewed publication / V2 launch ≥100 membres.
- [ADR-002](../../docs/decisions/ADR-002-v2-calibration-prop-firm-empirical.md) (commit `8158465`) — propose V2 calibration (`STDDEV=2.5`, `DD=10R`, `PF=2.5`, `EXPECTANCY=1R` kept) basée sur prop-firm 2024-2026 disclosed stats. Status Proposed.

### V1.5.1 — Wizard UI capture (commit `402ea66`)

UI wizard `/journal/new` capture désormais les 2 nouveaux fields end-to-end :

- **`riskPct`** : NumericField step 2 (Prix & taille), après stopLossPrice. Soft-warning inline si > 2 % (Tharp ceiling).
- **`tradeQuality`** : nouveau `<TradeQualitySelector>` step 4 (Discipline & émotion), AU TOP de la step (Steenbarger : classifier le setup AVANT l'outcome pour défaire le biais de résultat). 3 cards visuelles A/B/C avec tons ok/cy/bad, mirroring Direction Long/Short. Click une card active pour clear (back to NULL). Tooltips pédagogiques verbatim Steenbarger.

**Wiring** : `WIZARD_STEPS` étendu, `DraftState` + `emptyDraft` + `validateStep` + `submit` FormData + `createTradeAction` extraient les 2 fields. `localStorage` draft persist contract préservé.

### V1.5.1 — Audit-driven hardening (commit `f6539e7`)

3 subagents audit en parallèle (security-auditor + code-reviewer + 3 deep-research web 2026-05-09) :

| Severity               | Finding                                                                          | Fix                                                                                                                                                                                                      |
| ---------------------- | -------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **CRITICAL #2**        | builder.ts/prompt.ts ignoraient `tradeQuality`+`riskPct` (snapshot Claude blind) | `counterSliceSchema` étendu avec distribution A/B/C + `riskPctMedian` + `riskPctOverTwoCount`. `prompt.ts` surface une nouvelle section conditionnelle "Qualité d'exécution (V1.5 Steenbarger + Tharp)". |
| **MEDIUM M1**          | pseudonymise SHA-256 unsalted → ré-identification triviale                       | `MEMBER_LABEL_SALT` env var + `pseudonymizeMember(userId, salt?)` + defensive guard empty userId → TypeError.                                                                                            |
| **MEDIUM M2**          | math birthday paradox commentaire faux (4096 vs 4823, 1e-4 vs 2.9 %)             | Commentaire corrigé. Note V2 migration `slice(0, 8)` → 32 bits → seuil ~77 k membres.                                                                                                                    |
| **MEDIUM M3** + **#6** | `riskPct.gte(0)` ambigu vs NULL + `Decimal(5,2)` mismatch Zod `<100`             | `gt(0)` + Trade.riskPct `Decimal(4, 2)` aligné.                                                                                                                                                          |

### V1.5.2 — FR locale + close-out (commit `e6a7a3b`)

- **L2 FR locale** : `riskPct` Zod `z.preprocess` accepte `'1,5'` (decimal comma FR) → 1.5. Multi-commas rejetés. +2 tests.
- **`docs/jalon-V1.5.2-prep.md`** : briefing items différés (naming collision `memberLabel` rename → `pseudonymLabel`, 32-bit slice migration, rollback recipe SQL, NFC normalization, `CREATE INDEX CONCURRENTLY`, hook revert long-term fix `post_tool_fxmily.ps1` 3 options).

### Mystère hook revert Phase V — résolu en pratique

Cause confirmée : `D:\Fxmily\.claude\hooks\post_tool_fxmily.ps1` (PostToolUse async) invoque `prettier --write` sur Edit/Write. Quand Claude Edit puis Read immédiatement, voit le state prettier-reformaté → perception "revert". Workaround V1.5/V1.5.1/V1.5.2 : edits depuis worktree Ichor (project root différent → hook NON chargé). **V1.5.2 cleanup — long-term fix appliqué** : combo Option B+C dans le hook (`async: true → false` dans `D:\Fxmily\.claude\settings.json` + skip-recently-modified guard `< 5 s` directement dans `post_tool_fxmily.ps1`). Race condition supprimée par construction.

### V1.5.2 cleanup — naming collision + 32-bit slice + rollback + E2E + hook (livré 2026-05-10 sur `feat/v1.5.2-cleanup`)

Cleanup post-V1.5 ship qui ferme les items différés du briefing `docs/jalon-V1.5.2-prep.md`. Branche dédiée [`feat/v1.5.2-cleanup`](https://github.com/fxeliott/fxmily) chained sur `feat/v1.5-trading-calibration`. À merger après PR #36 V1.5.

**1. Naming collision `memberLabel` → `pseudonymLabel`** (HIGH code-reviewer V1.5.1) :

- `WeeklySnapshot.memberLabel` (V1.5 pseudonyme, prompt boundary) renommé `pseudonymLabel` pour éliminer la collision sémantique avec `WeeklyDigestEmail.memberLabel` (J8 display name "Sophie Martin"). Deux concepts → deux noms. Un futur dev qui mélange les deux fail-fast à code-review au lieu d'introduire un PII leak vers Anthropic.
- 5 fichiers V1.5 only modifiés : `lib/weekly-report/builder.ts` + `builder.test.ts` + `prompt.ts` + `claude-client.test.ts` + `lib/schemas/weekly-report.ts`. Les 5+ fichiers J8 (`weekly-digest.tsx`, `email/send.ts`, `service.ts displayMemberLabel`, `admin/reports/*`) **inchangés** — le `memberLabel` display name garde son nom.

**2. 32-bit slice + NFC normalization** (`pseudonymizeMember`) :

- `slice(0, 6)` → `slice(0, 8)` : 24-bit space (16 M valeurs, threshold 50 % collision = 4823 membres) → 32-bit space (4.3 G, threshold = 77 163 membres). Sufficient through V2 launch.
- `userId.normalize('NFC')` ajouté avant le hash — defensive contre les NFC vs NFD UTF-8 splits (no-op pour cuid alphanum-only V1, robuste pour V2 callers arbitraires Apple Health UID / ULID).
- Regex schema `member-[A-F0-9]{6}` → `member-[A-F0-9]{8}`. Test fixtures hardcoded en 8-char hex.
- **Migration data note** documentée inline dans la JSDoc de `pseudonymizeMember` : les rapports V1.5 historiques portent des labels 6-char, les rapports V1.5.2+ portent des labels 8-char. Pas de DB column à migrer (pseudonyme = prompt-boundary artefact). Les deux formats coexistent sans intervention. Risque de collision pour les 30 membres V1 cohort en 6-char ≈ 0.0001 % — historique safe-as-is.

**3. Rollback V1.5 migration** (HIGH code-reviewer V1.5.1) :

- Section §11 ajoutée à `docs/runbook-hetzner-deploy.md` (143 lignes) couvrant :
  - 11.1 pré-requis (`pg_dump` atomique, web stop, Prisma migrations check)
  - 11.2 SQL rollback (Postgres 17 type-cascade order : DROP INDEX → DROP COLUMN ×2 → DROP TYPE → DELETE `_prisma_migrations`)
  - 11.3 re-déploiement image J10
  - 11.4 vérification post-rollback (healthcheck + schema check + audit log)
  - 11.5 re-application future de V1.5 (re-deploy + restore data filtré)
  - 11.6 rollback du `pseudonymLabel` widening — **note : aucun rollback DB nécessaire** (pure code change, deux formats coexistent par construction).

**4. Playwright E2E `wizard-v1-5-fields.spec.ts`** :

- Nouveau spec `apps/web/tests/e2e/wizard-v1-5-fields.spec.ts` (5 tests) couvrant :
  - **CAPTURE + PERSIST** : `db.trade.create` avec `tradeQuality='A'` + `riskPct='1.5'` round-trips correctement (Decimal → string `.toString()` = `'1.5'`).
  - **CAPTURE + PERSIST** : `tradeQuality='C'` + `riskPct='2.5'` (Tharp ceiling violation row, fixture pour le builder counter `riskPctOverTwoCount`).
  - **CAPTURE + PERSIST** : V1 backward-compat (`tradeQuality=null` + `riskPct=null` — schema rétro-compatible).
  - **RENDER** : `/journal/[id]` charge sans crash sur un trade V1.5 (smoke check, no error overlay).
  - **RENDER** : `/journal` (list) charge avec V1.5 + V1 trades coexistants.
- Pattern carbone J9 visual : skip propre si Chromium absent + `cleanupTestUsers` idempotent + `seedMemberUser` + `loginAs`. **Pas dependent du wizard 6-step happy-path** (selectors fragiles) — la couche capture est testée par les Vitest schema/action unit tests (déjà 17 V1.5 tests verts).

**5. Hook revert long-term fix** (Phase V mystère) :

- `D:\Fxmily\.claude\settings.json` PostToolUse Edit/Write/NotebookEdit : `"async": true` → `"async": false` (Option C — invocation synchrone élimine la race par construction, latence ~100-300 ms acceptable).
- `D:\Fxmily\.claude\hooks\post_tool_fxmily.ps1` : ajout d'un **skip-recently-modified guard** (Option B — defense-in-depth). Si le fichier a été écrit < 5 s plus tôt, le hook skip le `prettier --write`. lint-staged rattrape le formatting au commit. Combo Option B+C : zéro risque résiduel.

### Quality gate V1.5 + V1.5.1 + V1.5.2

- format check ✓ (sur fichiers modifiés — `.claude/worktrees` exclu de `.prettierignore` au niveau repo)
- lint exit 0 (max-warnings = 0) ✅
- type-check exit 0 ✅
- **Vitest 750 / 750 verts** (+1 vs V1.5 baseline 749 — nouveau test NFC normalization sur `pseudonymizeMember`)
- Build prod Turbopack ✅ — toutes les routes V1.5 / V1.5.1 listées
- Prisma 7.8.0 client regenerated ✅

### Commit chain V1.5 (6 commits avec V1.5.2 cleanup)

```
<HEAD V1.5.2> fix(v1.5.2): cleanup — pseudonymLabel rename + 32-bit + NFC + rollback runbook + E2E + hook
e6a7a3b fix(v1.5.2): FR locale comma support + close-out doc + V1.5.2 prep
f6539e7 fix(v1.5.1): audit-driven hardening — builder aggregates + salt + Decimal align + bounds
402ea66 feat(v1.5.1): wizard UI capture — tradeQuality + riskPct end-to-end
8158465 docs(v1.5): ADR-002 V2 calibration prop-firm empirical + RGPD P0 decisions
52d4671 feat(v1.5): trading-expert calibration — pseudonymize + tradeQuality + riskPct
```

### Pré-requis Eliot pour activer V1.5 en prod

1. Mergement PR #35 J10 d'abord (smoke prod 12-step validé).
2. PR #36 `feat/v1.5-trading-calibration` créée + reviewed + merged sur main.
3. PR #37 `feat/v1.5.2-cleanup` (V1.5.2 cleanup) créée + reviewed + merged sur main.
4. Apply migration : `pnpm --filter @fxmily/web prisma:migrate deploy`.
5. **Décision P1 sécurité** : poser `MEMBER_LABEL_SALT` env var (`openssl rand -hex 32`) dans `/etc/fxmily/web.env` AVANT 1er rapport IA hebdo si export externe envisagé.
6. Décider P0 Anthropic Bedrock Frankfurt (Option B) vs API directe US (Option A) — cf. [v2-roadmap.md §🚨 P0 RGPD](../../docs/v2-roadmap.md).

## V1.6 — Post-prod-launch hardening (livré 2026-05-10 → 2026-05-11)

Cette section documente les 5 bugs LATENTS détectés via 4 rounds d'audit
exhaustif POST prod launch. Tous étaient des bugs silencieux qui ne
crashaient rien en surface mais dégradaient ou paralysaient des sous-systèmes
critiques sans laisser de trace dans /api/health. **Pattern récurrent : tous
provenaient du Git checkout Windows convertissant LF → CRLF par défaut.**

### Bug #1 — `pnpm-lock.yaml` duplicate `@types/node@25.6.2` key (commit `f44d124`)

Apparu après merge de 3 PRs dependabot consécutifs (#40 @types/node, #43
tailwind-merge, #45 turbo). Le lockfile était brisé : `pnpm install
--frozen-lockfile` retournait `ERR_PNPM_BROKEN_LOCKFILE` au line 2841 sur la
clé dupliquée. **Impact** : la prochaine CI/Deploy aurait fail au step
`pnpm install` car le workflow Dockerfile.prod utilise `--frozen-lockfile`.
Bug latent à exploser au prochain push.

**Fix** : `pnpm install` (sans `--frozen-lockfile`) regen le lockfile clean.
Diff stat 12 ins / 40 del = net simplification. Verifications post-fix :
`--frozen-lockfile` exit 0 + vitest 125/125 + tsc 0 + /api/health 200.

### Bug #2 — `/etc/cron.d/fxmily-app` CRLF (~20h cron-down) (commit `dc42a51`)

**Le plus grave bug de cette session.** Crontab Hetzner deployé avec
**60 caractères CR** (`\r`) embedded. Le cron daemon Debian/Ubuntu
**SILENT-IGNORE** les lignes contenant CR — le username field se lit
`fxmily\r` qui ne matche aucun système user → ligne rejetée sans aucun log
d'erreur. **Aucun cron n'a tourné automatique** entre prod launch
(2026-05-10 16:43 UTC) et fix (2026-05-11 12:28 UTC) = **~20h zéro auto-run** :

- ❌ Backup pg_dump daily 02:30 UTC (slot complètement manqué)
- ❌ Dispatch-notifications every 2 min (~600 runs perdus)
- ❌ Recompute-scores daily 02:00 UTC
- ❌ Dispatch-douglas every 6h
- ❌ Weekly-reports Sunday 21:00 UTC (slot non encore atteint mais aurait fail)
- ❌ Purge-deleted / purge-push-subscriptions / purge-audit-log
- ❌ Cron-watch self-monitoring (paradoxalement, le watcher lui-même
  n'aurait pas detecté car il authentifie par CRON_SECRET — cf. Bug #5)

**Détection** : `cat -A /etc/cron.d/fxmily-app` montre `^M$` à chaque fin
de ligne ; `journalctl _COMM=cron --since '24h ago' | grep '(fxmily)'`
retournait **zéro entry**.

**Fix** : `tr -d '\r' < ... > .lf.tmp && mv` + `systemctl restart cron`.
Live-verified : `(*system*fxmily-app) RELOAD` log entry + `(fxmily) CMD`
immediately suivante = cron daemon enfin reconnait le user `fxmily`.

**Defense permanente** : `ops/scripts/fix-crlf-prod.sh` shipped (commit
`dc42a51`) + deployé `/usr/local/bin/fxmily-fix-crlf` sur Hetzner.
`.gitattributes` (commit `e14bdb8`) force LF sur `ops/cron/*`,
`ops/scripts/*.sh`, `Caddyfile`, `Dockerfile*`, `*.yml`, `*.yaml` pour
prevenir regression sur future checkout Windows.

### Bug #3 — `/etc/fxmily/Caddyfile` CRLF (66 CR chars) — fix live-only

Même cause que Bug #2 (Git checkout Windows). Caddy parse les CRLF en
général tolérant mais certaines directives peuvent fail silently. Fix
live : `tr -d '\r' < /etc/fxmily/Caddyfile > /tmp/Caddyfile.lf && mv` +
`docker compose exec caddy caddy reload`. **Vérifié post-fix** : HTTPS
encore 200, HSTS preload toujours actif. Aucun fichier local à committer
(le fichier source dans le repo était déjà LF).

### Bug #4 — Slug mismatch `checkin.reminder.scan` vs `cron.checkin_reminders.scan` (commit `dc7a4b4`)

`lib/checkin/reminders.ts` émettait le slug J5 legacy (`checkin.reminder.scan`)
au 4 occurrences (lignes 71, 97, 133, 186). Le `getCronHealthReport`
(J10 Phase J) attendait le slug canonical `cron.checkin_reminders.scan`
(pattern utilisé par les 8 autres crons : `cron.recompute_scores.scan`,
`cron.dispatch_douglas.scan`, etc.). Résultat : **cron-watch GH Actions
retournait `never_ran` pour `checkin_reminders` même quand le cron tournait
fine**. Hourly fail récurrent sur Cron Watch workflow.

**Fix** : sed 4× emission dans `reminders.ts` + 2× tests dans
`reminders.test.ts` + 1× union `audit.ts` → tous au canonical
`cron.checkin_reminders.scan`. Vitest 8/8 + 7/7 verts post-fix. Les 3 rows
DB legacy (`checkin.reminder.scan`) restent comme historical record — pas
queried par `health.ts` donc no impact.

### Bug #5 — GH Actions Secret `CRON_SECRET` mismatch avec Hetzner `/etc/fxmily/cron.env`

Découvert quand Cron Watch retournait HTTP 401 même APRÈS fix du slug. Le
secret posté initialement dans GH (commit `pose-github-secrets.sh`
2026-05-10) **ne matchait pas** celui dans `/etc/fxmily/cron.env`
sur Hetzner. Conséquence : **Cron Watch ne s'est JAMAIS authentifié
depuis prod launch** — tous les fails depuis hier étaient des 401
silencieux, attribués à tort à "amber/never_ran" jusqu'à inspection
du log via `gh run view --log`.

**Détection** : `gh run view <run-id> --log | grep HTTP` → `HTTP 401
unauthorized` (au lieu de `503` qu'on attendait).

**Fix** : `ssh fxmily@... "cat /etc/fxmily/cron.env" | grep CRON_SECRET=
| cut -d= -f2- | gh secret set CRON_SECRET --repo fxeliott/fxmily`
(via stdin pipe = zero chat-exposure). Tokens.local.env confirmed identical
prefix `ffd8c9a0...` = local matchait Hetzner depuis le début, c'était GH
seul out of sync. **Live verified** : Cron Watch run #25667396986
"✅ Heartbeat green" + HTTP 200 — 1er green depuis prod launch.

### Pattern récurrent : Git checkout Windows → CRLF pitfall

Sur les 5 bugs ci-dessus, **3 sont des CRLF latents** (Bug #2 crontab,
Bug #3 Caddyfile, Bug #4 reminders.ts mais ce dernier était un slug
naming + pas CRLF directement). Cause root pattern :

```
Windows Git default: core.autocrlf=true
  → Au checkout : LF (in repo) → CRLF (working tree)
  → Au commit : CRLF (working tree) → LF (in repo)

Mais :
  → SCP du working tree vers Hetzner = CRLF préservé
  → Linux services qui parsent line-by-line (cron, certains shells, gpg)
    rejettent silencieusement les lignes CRLF
```

**Protection en place** :

- `.gitattributes` force `text eol=lf` sur tous les fichiers shell + YAML +
  Caddyfile + Dockerfile (commit `e14bdb8`).
- `ops/scripts/fix-crlf-prod.sh` détecte + strip CRLF sur Hetzner targets
  (`/etc/cron.d/fxmily-app`, `/usr/local/bin/fxmily-*`). Exit 0 si all
  clean, exit 1 si broken après fix (anti-régression).
- Run automatique recommandé après tout `setup-host.sh` ou redeploy via
  GH Actions deploy.yml.

### Hardening dependabot — 14 PRs triage (2026-05-11)

3 PRs low-risk **merged** :

- `#40` @types/node 25.6.0→25.6.2 (patch dev) — commit `9584a38`
- `#43` tailwind-merge 3.5→3.6 (minor lib) — commit `f91a4e1`
- `#45` turbo 2.9.9→2.9.12 (patch dev) — commit `a9d2da0`

10 PRs majors **deferred to manual review** (commented with
"V1.7 manual review — major-version bumps need CHANGELOG check") :

- `#1` actions/setup-node 4→6 (skips v5)
- `#2` pnpm/action-setup 4→6 (skips v5)
- `#3` actions/checkout 4→6 (skips v5)
- `#6` eslint 9→10 (major config potential breaking)
- `#38` docker/build-push-action 6→7 (major)
- `#39` docker/login-action 3→4 (major)
- `#41` tailwind group 3 updates incl prettier-plugin 0.6→0.8 (format diffs)
- `#42` lint-staged 15→17 (skips v16)
- `#46` @commitlint/config-conventional 19→21 (major)
- `#47` @commitlint/cli 19→21 (major)

`#44` resend 6.12.2→6.12.3 **conflicts** post-merge `#40` — dependabot va
rebase automatiquement.

### Quality gate V1.6

- format check ✓, lint exit 0, tsc exit 0
- Vitest **125+ tests verts** (8 reminders + 7 health + 38 push-subscription + autres)
- Build prod Turbopack ✓
- `/api/health` 200 + `/api/cron/health` overall = `amber` (acceptable) → 200
- Cron Watch GH Actions ✅ green (run #25667396986)
- Cron daemon Hetzner **actually running** (vs apparences trompeuses jusqu'à fix Bug #2)
- 5 bugs latents tous catch + tous fix avec defense permanente

### Commit chain V1.6 (6 commits)

```
dc7a4b4 fix(observability): align checkin_reminders audit slug with cron.* convention
dc42a51 fix(ops): CRLF defensive script + document crontab silent-skip pitfall
f44d124 fix(deps): regen pnpm-lock.yaml after dependabot merges
9584a38 chore(deps-dev): bump @types/node 25.6.0→25.6.2 (#40)
f91a4e1 chore(deps): bump tailwind-merge 3.5→3.6 (#43)
a9d2da0 chore(deps-dev): bump turbo 2.9.9→2.9.12 (#45)
```

### V1.7+ backlog explicit (post V1.6 polish)

- **Item #2 Dependabot 7 PRs majors** restants après V1.6 polish merge (3 CLEAN
  #38 #39 #42) : #1 actions/setup-node 4→6, #2 pnpm/action-setup 4→6, #3
  actions/checkout 4→6 (CI majors), #6 eslint 9→10, #41 tailwind group, #46
  @commitlint/config-conventional 19→21, #47 @commitlint/cli 19→21. Batch
  review séquentiel — pour chaque PR, read CHANGELOG, run `pnpm install` +
  tests Vitest locally, push CI verify, merge si OK.
- **Anthropic API key activation** ($1-2/mois V1 batch+cache, ~5 min Eliot
  Console) pour 1er digest IA réel non-mock.
- **Workspace Console spend limit $25/mois** (hard cap RGPD-friendly anti-runaway).
- **EU AI Act 50(1) chatbot transparency banner** : "Généré par IA — pas
  substitut coaching humain" (deadline 2 août 2026, pénalité **€15M ou 3% CA
  Article 99(4)**, source primaire `artificialintelligenceact.eu/article/99`).
- **Crisis routing FR** : 3114 + SOS Amitié 09 72 39 40 50 + Suicide Écoute
  01 45 39 40 00, regex post-output over-trigger safety, faux positifs
  trading exclus ("tout perdre sur ce trade", "killer ce setup",
  "dépression du marché"). Mandatory pre-V1.7 deploy.
- **iPhone PWA smoke E2E** Phase frontend (différé par décision Eliot
  "backend d'abord").

## V1.6 polish — Sentry taxonomy + email freq cap + Prisma pool (livré 2026-05-12)

Branche dédiée `feat/v1.6-polish` (renommée depuis `claude/stoic-hofstadter-cebc12`)
ouvre 4 items polish post-prod-launch. Carbon-copy J5/J6/J7/J8/J9/J10 audit
pattern. Tests Vitest 764/764 verts (+14 vs V1.5.2 baseline 750).

### Item 1 — Sentry alerting taxonomy (closed)

`lib/observability.ts` exposait uniquement `reportError` (severity=error).
Toutes les conditions transient (push 429 rate-limited, email fallback cap
reached, 410 Gone subscription deletion = lifecycle normal) arrivaient en
`error` → bruit dashboard Sentry, on-call signal noise élevé.

**Ajouts** :

- `reportWarning(scope, message, extra?)` → `Sentry.captureMessage(msg, {
level: 'warning', tags: { scope }, extra })` + `console.warn`.
- `reportInfo(scope, message, extra?)` → idem level=info + `console.info`.

Signature identique à `reportError` mais accepte une `string` au lieu d'un
`Error` (Sentry groupe par message+level, donc warning/info ne polluent
JAMAIS le dashboard error qui est la surface on-call primaire).

**Tests** : nouveau `lib/observability.test.ts` (10 tests TDD — 3 reportError

- 3 reportWarning + 3 reportInfo + 1 reportBreadcrumb : console plumbing +
  no-throw on Sentry no-DSN no-op + extra metadata passthrough).

**Wiring inclus V1.6 polish (commit `4a3558f`)** — 7 sites Sentry wirés
end-to-end suite à audit parallèle (researcher dispatcher map + researcher
scheduler/service downgrade + dependency-auditor) :

| #   | Fichier:Ligne                  | Avant                                                  | Après                                                                        |
| --- | ------------------------------ | ------------------------------------------------------ | ---------------------------------------------------------------------------- |
| 1   | `dispatcher.ts:587`            | `console.error('fallback email failed', err)`          | `reportWarning('push.dispatcher', 'fallback_email_failed', {...})`           |
| 2   | `dispatcher.ts:556`            | (logAudit seul)                                        | + `reportWarning('push.dispatcher', 'email_fallback_capped', {...})`         |
| 3   | `dispatcher.ts:653`            | (logAudit seul)                                        | + `reportWarning('push.dispatcher', 'stuck_dispatching_recovered', {...})`   |
| 4   | `cards/scheduler.ts:81`        | `console.error('dispatch failed', err)`                | `reportWarning('douglas.scheduler', 'dispatch_failed', {...})`               |
| 5   | `scoring/scheduler.ts:99`      | `console.error('background recompute failed', err)`    | `reportWarning('scoring.scheduler', 'background_recompute_failed', {...})`   |
| 6   | `weekly-report/service.ts:237` | `console.error('member generation failed:', r.reason)` | `reportWarning('weekly-report.generate', 'member_generation_failed', {...})` |
| 7   | `weekly-report/service.ts:518` | `console.error('failed to read user metadata', err)`   | `reportWarning('weekly-report.email', 'user_metadata_read_failed', {...})`   |

Cible Sentry events/jour V1 30 membres : ~65-75 (sous 5000/mois free tier).
RGPD §16 respecté — aucun email, payload, endpoint URL dans `extra`.

**Sites NON wirés (negative recommendations researcher)** :

- Per-device 410 Gone branch (`dispatcher.ts:404`) — frequency too high (10 subs × 30 membres × per tick = quota explosion)
- Per-device `promise_rejected` (`dispatcher.ts:392`) — couvert par future batch aggregate
- `web-push-client.ts` per-device catch — wrong abstraction layer
- Cron 401/403/429 paths — external-caller errors, contractuel HTTP réponse
- Cron 503 "CRON_SECRET not configured" — env validation layer's job

### Item 2 — Email frequency cap `is_transactional` (closed)

**Migration** `20260512182512_v1_6_notification_is_transactional/migration.sql` :

- `ALTER TABLE notification_queue ADD COLUMN is_transactional BOOLEAN NOT NULL DEFAULT FALSE`
- `CREATE INDEX notification_queue_user_recent_non_transactional_idx ON notification_queue (user_id, created_at DESC) WHERE is_transactional = FALSE`

Tous les V1 NotificationType slugs (annotation_received, checkin\_\*\_reminder,
douglas_card_delivered, weekly_report_ready) sont engagement nudges → default
`is_transactional = false`. Futures auth-push types (password reset push, RGPD
download ready, etc.) viendront avec `is_transactional = true` à l'enqueue.

**Freq cap logic** (`lib/push/dispatcher.ts:dispatchOne` lignes 506-555,
DANS branche email fallback POST permanent-failure, PAS avant web-push) :

```ts
if (!row.isTransactional) {
  const recentFallbacks = await db.auditLog.count({
    where: {
      action: 'notification.fallback.emailed',
      userId: row.userId,
      createdAt: { gt: new Date(Date.now() - 24 * 60 * 60 * 1000) },
    },
  });
  allowFallbackEmail = shouldSendFallbackEmail(row.isTransactional, recentFallbacks);
  if (!allowFallbackEmail) {
    await logAudit({ action: 'notification.fallback.capped', userId, metadata });
  }
}
```

Helper pur `shouldSendFallbackEmail(isTransactional, recentFallbacks24h):
boolean` exporté + testé (4 tests Vitest — transactional always-true,
non-transactional below cap, non-transactional at/above cap, exact cap=3
invariant).

**Note SOFT cap (code-reviewer audit H2)** : la query `db.auditLog.count`
est lue AVANT le send → jusqu'à `CONCURRENCY=8` dispatcher calls
concurrents sur le même user peuvent tous passer le check. Worst-case
burst = 8 emails sur 1 cron tick au lieu de 3. Acceptable V1 30 membres.
V2 hard cap via `pg_advisory_xact_lock(hash(userId+'fallback'))` quand
cohorte > 100.

Audit slug nouveau `notification.fallback.capped` ajouté à `AuditAction` union.

Cap fixé à `EMAIL_FALLBACK_CAP_PER_24H = 3` (1 email / ~8h max — empiriquement
le seuil au-delà duquel un membre perçoit la cadence comme spam plutôt
qu'informative). Si subscription push chroniquement broken, l'audit log
surface le pattern via `notification.fallback.capped` rows pour outreach
admin proactif (anti Resend free-tier 100/jour cap downstream).

### Item 3 — ADR-002 scoring constants (note doc seulement, 0h code)

**Important** : la mémoire MEMORY.md pré-existante affirmait "STDDEV 8→4 +
EXPECTANCY 3→1 à re-appliquer V1.6". **C'est FAUX** — vérifié dans
`lib/scoring/consistency.ts:83` + `lib/scoring/emotional-stability.ts:107` :
les constantes V1 actuelles sont **déjà** `STDDEV_FULL_SCALE = 4` et
`EXPECTANCY_FULL_SCALE = 1` (validées Phase V/W ADR-001 commits `a968a20`

- `905d659`). ADR-002 propose pour **V2** seulement : `STDDEV → 2.5`,
  `PF → 2.5`, `DD → 10R`, `EXPECTANCY → 1 keep`.

**Pas de modification scoring V1.6.** Trigger documenté pour passer à
ADR-002 : cohort drift (≥30 membres × ≥3 mois) OU 80% cohort < 30 sur
une dim OU > 70 sur une dim OU ≥5 user complaints OU V2 launch >100
membres. Voir [`docs/decisions/ADR-002`](../../docs/decisions/ADR-002-v2-calibration-prop-firm-empirical.md).

### Item 4 — Bonus : Prisma 7 pool config explicit (closed)

`lib/db.ts` avait `new PrismaPg({ connectionString: env.DATABASE_URL })`
sans aucune config pool. Prisma 7 + `@prisma/adapter-pg` changent les
defaults vs v6 :

- v6 : `connectionTimeoutMillis = 5_000` (pool full → throws after 5s)
- v7 : `connectionTimeoutMillis = 0` (pool full → **hangs forever**)

Sans config explicite, chaque cron + Server Action qui touche DB peut
deadlock indéfiniment sur un pool saturé. Pin v6 defaults explicitement
(cf. Prisma skills `/prisma-upgrade-v7/references/driver-adapters.md`) :

```ts
new PrismaPg({
  connectionString: env.DATABASE_URL,
  max: 10,
  connectionTimeoutMillis: 5_000,
  idleTimeoutMillis: 30_000,
});
```

Signature confirmée 7.8.0 via Context7 (`/prisma/skills`, source primaire
GitHub `prisma/skills` repo officiel). Shape **flat** — pas nested
`pool: {...}` qui aurait silent-no-op build-but-hang-prod.

### Item 5 — Bonus : Anthropic SDK 0.95.1 → 0.95.2 (closed)

`package.json` : `@anthropic-ai/sdk: ^0.95.1` → `^0.95.2`. Caret incluait
déjà 0.95.2 — bump explicite pour traçabilité git history. Patch bump =
zero breaking change attendu (cf. semver Anthropic SDK convention).

### Quality gate V1.6 polish

- Type-check ✓ exit 0
- ESLint ✓ exit 0 (max-warnings=0)
- Prettier ✓ (5 fichiers TS auto-format)
- **Vitest 764/764 verts** (+14 vs V1.5.2 baseline 750 : 4 freq cap pure
  helper + 10 observability console plumbing)
- Prisma client regenerated 7.8.0 (`isTransactional` field disponible)
- Migration SQL `20260512182512_v1_6_notification_is_transactional` prête
  pour `pnpm prisma:migrate:deploy` post-merge prod
- Build prod Turbopack ✓ (à valider via CI sur PR)

### Dependabot triage V1.6 polish

3 PRs CLEAN low-risk **merged** dans V1.6 polish PR (groupé pour réduire CI
load + montrer cohésion polish) :

- `#38` docker/build-push-action 6→7 (CI action major, no breaking host-side)
- `#39` docker/login-action 3→4 (CI action major, no breaking host-side)
- `#42` lint-staged 15→17 (skip v16, peer deps OK avec husky 10)

7 PRs majors restants reclassés V1.7+ backlog (cf. section au-dessus).

### Pré-requis Eliot pour activer V1.6 polish en prod

1. **🔴 BLOQUANT** : Régler billing GitHub Actions
   <https://github.com/settings/billing/payment_information>. Sinon CI fail
   sur ce PR + Cron Watch schedule reste rouge (manual dispatch marche mais
   les schedules /h sont bloqués).
2. Merger PR V1.6 polish (à ouvrir depuis branche `feat/v1.6-polish`).
3. Apply migration : `pnpm --filter @fxmily/web prisma:migrate:deploy`
   (à appliquer pendant maintenance window — `ALTER TABLE + CREATE INDEX`
   sur `notification_queue`, à 30 membres prod V1 = 0-1s lock acceptable).
4. Restart container app (pick up new Prisma client + nouveau lib/db.ts pool).
5. Verify : `/api/health` 200 + `/api/cron/health` overall=green sous 5 min.

### Commit chain V1.6 polish (1 commit attendu, à confirmer)

Tous les changes V1.6 polish dans 1 commit atomic `feat(v1.6-polish): ...` :

- `apps/web/src/lib/observability.ts` (+reportWarning +reportInfo)
- `apps/web/src/lib/observability.test.ts` (NEW, 10 tests)
- `apps/web/src/lib/db.ts` (pool config v6 defaults)
- `apps/web/prisma/schema.prisma` (+isTransactional + index)
- `apps/web/prisma/migrations/20260512182512_v1_6_notification_is_transactional/migration.sql` (NEW)
- `apps/web/src/lib/push/dispatcher.ts` (freq cap branch + pure helper export)
- `apps/web/src/lib/push/dispatcher.test.ts` (+4 freq cap tests)
- `apps/web/src/lib/auth/audit.ts` (+`notification.fallback.capped` slug)
- `apps/web/package.json` + `pnpm-lock.yaml` (SDK 0.95.1 → 0.95.2)
- `apps/web/CLAUDE.md` (this section)

Atomic revert <30s : `git revert <sha>` (sauf migration SQL — voir runbook
hetzner-deploy §11 pour rollback DB).

---

## V1.7 LIVE prod — Local Claude Code batch (livré 2026-05-13)

### Pourquoi cette architecture

Eliot REFUSE catégoriquement l'API Anthropic ($-per-token). Les rapports
hebdomadaires IA sont générés **localement sur sa machine Windows via
`claude --print` headless utilisant son abonnement Claude Max**. Cost
marginal Anthropic = 0€ ; subscription Max 200$/mois déjà payée pour le
dev. Pattern défensible : single-user, official `claude` binary, jittered
sleeps, pseudonymized data, no third-party wrappers. Round 12-13 mes
deux faux départs (push API, push Gemini free tier) sont documentés
dans la memory `fxmily_session_2026-05-12_audit_massif.md` section
Round 11-16.

### Architecture wire complète

```
TON PC Windows                              HETZNER PROD
══════════════                              ════════════
   Tu tapes /sunday-batch
   │
   moi → SSH hetzner-dieu ─────────────→  scripts/weekly-batch-pull.ts
                                            │ batch.ts:loadAllSnapshotsForActiveMembers
                                            │ (Promise.allSettled batch=5)
   ◄─────────── JSON envelope ─────────────┘ pseudonymizeMember V1.5
   │
   │  Loop 30 membres :
   │  ┌──────────────────────────────────────┐
   │  │ claude --print --max-turns 1         │ × 30, 60-120s RANDOM-jittered
   │  │ --append-system-prompt (Mark Douglas)│
   │  │ printf %s (anti shell-expansion)     │
   │  │ pseudonymLabel regex validated       │
   │  └──────────────────────────────────────┘
   │
   │  jq -s NDJSON → results.json (atomic single write)
   ▼  SSH hetzner-dieu ──────────────────→  scripts/weekly-batch-persist.ts
                                            │ batch.ts:persistGeneratedReports
                                            │ - Zod top-level BatchPersistRequest
                                            │ - active-user findMany check
                                            │ - parseLocalDate try-catch
                                            │ - weeklyReportOutputSchema strict
                                            │ - V1.7.1 crisis routing wire
                                            │ - model allowlist (fallback local)
                                            │ - upsert (userId, weekStart)
   ◄─────────── { persisted, skipped, errors }
```

### Fichiers wire complets (V1.7 + V1.7.1)

| Fichier                                              | Rôle                                                                                                                                                                     |
| ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `apps/web/src/lib/weekly-report/batch.ts`            | helpers publics `loadAllSnapshotsForActiveMembers` + `persistGeneratedReports` + wire contract types                                                                     |
| `apps/web/src/lib/weekly-report/batch.test.ts`       | 10 tests TDD (V1.7.1 — happy + malformed + invalid week + unknown user + crisis HIGH + crisis MEDIUM + trading slang FP + entry.error + forged model + upsert exception) |
| `apps/web/scripts/weekly-batch-pull.ts`              | TSX server-side, JSON envelope to stdout                                                                                                                                 |
| `apps/web/scripts/weekly-batch-persist.ts`           | TSX server-side, Zod-validated stdin → DB                                                                                                                                |
| `ops/scripts/weekly-batch-local.sh`                  | Bash orchestrator local (ton PC)                                                                                                                                         |
| `.claude/commands/sunday-batch.md`                   | slash command Claude Code custom                                                                                                                                         |
| `apps/web/src/lib/auth/audit.ts`                     | +6 audit slugs (`weekly_report.batch.{pulled,persisted,skipped,invalid_output,persist_failed,crisis_detected}`)                                                          |
| `apps/web/src/components/ai-generated-banner.tsx`    | EU AI Act 50(1) disclaimer banner (V1.7 prep dormant R7, wired R17)                                                                                                      |
| `apps/web/src/lib/safety/crisis-detection.ts`        | regex FR unicode-aware (V1.7 prep dormant R7, wired R17)                                                                                                                 |
| `apps/web/src/app/admin/reports/[id]/page.tsx`       | banner wire dans la vue rapport admin                                                                                                                                    |
| `apps/web/src/lib/email/templates/weekly-digest.tsx` | banner wire inline HTML dans le digest email                                                                                                                             |

### Ban-risk mitigation (9 rules baked in)

1. Eliot's machine (TON IP, TON fingerprint, TON Max account)
2. 60-120s RANDOM-jittered sleeps (validated, floor 30s)
3. One `claude --print` per member = fresh context (no oversized conversation)
4. Snapshots pseudonymized via `pseudonymizeMember` 8-char hex V1.5
5. System prompt + JSON schema travel WITH the envelope from repo (no
   on-device tamper without commit)
6. Only official `claude` binary — no OpenClaw / Roo / Goose / CLIProxyAPI
   (all explicitly banned 14 jan + 4 avr 2026 per Anthropic enforcement)
7. Human-in-the-loop : Eliot triggers manually, can vary day/time
8. Double-net validation server-side (`weeklyReportOutputSchema.strict()`)
   rejects tampered outputs + `db.user.findMany` active set check rejects
   forged userIds
9. Audit log `weekly_report.batch.*` records counts + ranAt + week (PII-free)

### V1.7.1 — Crisis routing + AI banner ACTIFS (livré 2026-05-13)

**Crisis routing wire** dans `persistGeneratedReports` AVANT persist :
chaque output Claude est concaténé (summary + risks + recommendations +
patterns.\*) puis passé à `detectCrisis(corpus)`. Si level >= MEDIUM, le
persist est SKIPPED, audit `weekly_report.batch.crisis_detected` (level +
matchedLabels), et escalade Sentry :

- HIGH → `reportError` (page-out admin)
- MEDIUM → `reportWarning` (review next morning)

Le corpus exclut les pré-existing trading slang patterns ("tout perdre sur
ce trade", "tuer ma position", "en finir avec ça", "dépression du marché")
de la détection — voir `lib/safety/crisis-detection.ts` Round 7 prep.

**AI banner wire** EU AI Act Article 50(1) chatbot transparency (deadline
2 août 2026, pénalité €15M / 3% CA Article 99(4)) :

- `/admin/reports/[id]/page.tsx` : `<AIGeneratedBanner variant="inline" modelName={dyn} />` AVANT la section Synthèse
- `lib/email/templates/weekly-digest.tsx` : inline HTML banner (React Email rend du HTML email-safe, pas du DOM), même copy verbatim

### Action Eliot RESTANTE V1.7

🟢 **Tester `/sunday-batch --dry-run`** dans Claude Code session. Si OK
real run. Si compte A ban : pivoter compte B Pro $20/mois (architecture
prête, Docker container env CLAUDE_HOME séparé à ajouter).

### Pickup V1.8 REFLECT prep

Cf. memory `fxmily_session_2026-05-12_audit_massif.md` section "Pickup
prompt V1.7.1 + V1.8 REFLECT post-/clear" + `docs/jalon-V1.7-prep.md` :
Trade.tags multi-select + Trade.outcomeR + WeeklyReview model séparé +
ReflectionEntry CBT 4 colonnes + reverse-journaling Steenbarger 2025.
