# `@fxmily/web` — instructions Claude Code (scoped)

> Ce fichier hérite des conventions du projet : voir `D:\Fxmily\CLAUDE.md` à la racine.
> Ici on documente uniquement les spécificités du package `apps/web`.

## Contexte

Application **Next.js 16** (App Router, Turbopack) qui sert l'app Fxmily — front + API + service worker (PWA, Jalon 9).

État au 2026-05-07 : **J0 + J1 + J2 + J3 + J4 + J5 livrés** (J5 + audit-driven hardening).

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

## Headers de sécurité

Wired dans `next.config.ts` `headers()` (réponse à toute route via `source: '/:path*'`) :

- `Content-Security-Policy` — baseline J1 (default-src 'self', script-src 'self' 'unsafe-inline' [+ 'unsafe-eval' en dev], style-src 'self' 'unsafe-inline', frame-ancestors 'none', form-action 'self', base-uri 'self', upgrade-insecure-requests prod-only). **TODO J10** : remplacer `'unsafe-inline'` par nonces générés dans `proxy.ts`.
- `X-Content-Type-Options: nosniff`
- `X-Frame-Options: DENY`
- `Referrer-Policy: strict-origin-when-cross-origin`
- `Permissions-Policy: camera=(), microphone=(), geolocation=(), interest-cohort=()`
- `Cross-Origin-Opener-Policy: same-origin`
- `Strict-Transport-Security: max-age=63072000; includeSubDomains; preload` (prod uniquement)

## Theme (Tailwind 4)

Variables CSS dans `src/app/globals.css` (palette SPEC §8.1). Mode sombre uniquement V1.

- `--background: #0a0e1a` / `--foreground: #e8ecf4`
- `--primary: #2563eb` / `--accent: #3b82f6`
- `--muted: #94a3b8` (bumpé depuis #64748b pour WCAG AA contrast)
- Border `rgba(99, 102, 241, 0.15)`
- `@layer base` pour les resets globaux
- `@media (prefers-reduced-motion: reduce)` actif

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
  - **307 tests verts au close-out J5 TIER 3** (vs 288 fin TIER 2, vs 274 au commit initial J5, 199 au close-out J4).
- **Vitest setup** : `src/test/setup.ts` charge `@testing-library/jest-dom/vitest`. `vitest.config.ts` stub `DATABASE_URL`/`AUTH_SECRET`/`AUTH_URL` pour permettre les imports transitifs sans crash Zod.
- **Playwright** (`pnpm --filter @fxmily/web test:e2e`) :
  - `tests/e2e/auth-invitation.spec.ts` (J1) — surface publique auth.
  - `tests/e2e/journal.spec.ts` (J2) — auth gates `/journal/*` + 401 sur `/api/uploads*` non-auth.
  - `tests/e2e/admin-annotation.spec.ts` (J4) — auth gates admin annotation routes + uploads.
  - `tests/e2e/checkin.spec.ts` (J5) — auth gates `/checkin/*` + 401/503 sur cron sans secret + 405 sur GET cron.
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

### TIER 3/4 — follow-ups encore recommandés (non bloquants pour J5)

- **Security HIGH H2** : rate limiting sur `/api/cron/*` (allowlist IP Hetzner ou `@upstash/ratelimit`). Repoussé à J10 prod hardening.
- **Security MEDIUM M2** : `dateInWindow` Zod fait check sur today UTC, pas TZ user. V1 single-TZ Europe/Paris donc OK aujourd'hui ; à élargir avec un check TZ-aware côté service quand J5.5 multi-TZ arrive.
- **A11y MEDIUM** : heading focus outline cleanup (H3), DoneBanner re-fade timer client component (M9 - actuellement une seule rétention `?done=1` dans l'URL).
- **UI BLOCKER B1+B2 (premium polish)** : sleep zones diagram dans le step Sommeil + `<Sparkline>` (existant mais inutilisé) sur la landing /checkin. Recommandé en J5.5 pour rejoindre le niveau du `StepPlannedRR` du J2.
- **UI HIGH H3** : haptic feedback (`navigator.vibrate`) sur step transitions + submit success — détail premium PWA.
- **Code MEDIUM M5** : `MorningCheckin.intention` schema retourne `undefined` mais service écrit `null` — incohérence type-safety mineure (mismatch entre `exactOptionalPropertyTypes` et le `?? null` du service).
- **Tests E2E full** : le happy-path login → wizard → streak++ attend toujours le helper de seed Postgres cross-jalon. Public surface E2E couverte (auth gates).
