# `@fxmily/web` — instructions Claude Code (scoped)

> Ce fichier hérite des conventions du projet : voir `D:\Fxmily\CLAUDE.md` à la racine.
> Ici on documente uniquement les spécificités du package `apps/web`.

## Contexte

Application **Next.js 16** (App Router, Turbopack) qui sert l'app Fxmily — front + API + service worker (PWA, Jalon 9).

État au 2026-05-05 : **J0 + J1 + J2 livrés**.

## Aliases d'import

- `@/*` → `./src/*` (configuré dans `tsconfig.json` + `components.json`)
- Server-only : `@/lib/db`, `@/lib/env`, `@/generated/prisma/*`, `@/auth` (root), `@/lib/auth/*`, `@/lib/email/*` ne doivent **JAMAIS** être importés depuis un fichier marqué `'use client'`.
- Génère le client Prisma dans `apps/web/src/generated/prisma` (gitignored, exclu de tsconfig + ESLint).

## Boot

`apps/web/src/instrumentation.ts` déclenche l'import de `@/lib/env` au démarrage du runtime Node.js. Toute variable d'environnement requise (DATABASE_URL, AUTH_SECRET, AUTH_URL) y est validée par Zod et le serveur fail-fast si invalide.

→ **Ne pas déplacer `instrumentation.ts`** ailleurs sans comprendre cet effet.

## Routes connues (à compléter par jalon)

| Route                         | Méthode  | Fichier                                       | Statut                                         |
| ----------------------------- | -------- | --------------------------------------------- | ---------------------------------------------- |
| `/`                           | GET      | `src/app/page.tsx`                            | J0 — splash placeholder                        |
| `/api/health`                 | GET      | `src/app/api/health/route.ts`                 | J0 — env + DB ping                             |
| `/api/auth/[...nextauth]`     | GET/POST | `src/app/api/auth/[...nextauth]/route.ts`     | J1 — Auth.js v5 handlers (Node)                |
| `/login`                      | GET/POST | `src/app/login/{page,login-form,actions}.tsx` | J1 — Credentials login                         |
| `/onboarding/welcome?token=…` | GET/POST | `src/app/onboarding/welcome/*`                | J1 — invitation consume + autologin            |
| `/admin/invite`               | GET/POST | `src/app/admin/invite/*`                      | J1 — admin-only invite form                    |
| `/dashboard`                  | GET      | `src/app/dashboard/page.tsx`                  | J1 — landing post-login (links to journal)     |
| `/journal`                    | GET      | `src/app/journal/page.tsx`                    | J2 — list, status filter (all/open/closed)     |
| `/journal/new`                | GET      | `src/app/journal/new/page.tsx`                | J2 — wizard mobile-first 6 étapes              |
| `/journal/[id]`               | GET      | `src/app/journal/[id]/page.tsx`               | J2 — détail + delete + close CTA               |
| `/journal/[id]/close`         | GET/POST | `src/app/journal/[id]/close/page.tsx`         | J2 — formulaire de clôture                     |
| `/api/uploads`                | POST     | `src/app/api/uploads/route.ts`                | J2 — multipart, magic-byte, audit              |
| `/api/uploads/[...key]`       | GET      | `src/app/api/uploads/[...key]/route.ts`       | J2 — stream local FS (dev), R2 redirect (prod) |

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
  - **J1** : `auth.login.success/failure`, `auth.logout`, `invitation.created/consumed`, `onboarding.completed`.
  - **J2** : `trade.created`, `trade.closed`, `trade.deleted`, `trade.screenshot.uploaded` (metadata = `{ kind, key, mime, size, adapter }`, pas le contenu).

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
- **Naming convention DB** : tables et colonnes en `snake_case` via `@map`, modèles Prisma en PascalCase / camelCase. C'est la convention Auth.js officielle.
- **Decimal** : `Prisma.Decimal` exporté via `@/generated/prisma/client`. Au write, on passe `new Prisma.Decimal(numericValue)` (Prisma 7 accepte aussi un number, mais on est explicite). Au read, `.toNumber()` ou `.toString()` selon le cas. Pour passer aux client components, **toujours sérialiser en string** (`SerializedTrade` dans `lib/trades/service.ts`).

## Tests

- **Vitest** (`pnpm --filter @fxmily/web test`) — unit tests purs (pas de DB) :
  - **J1** : `src/lib/auth/{password,invitations,audit}.test.ts`, `src/lib/schemas/auth.test.ts`, `src/lib/email/send.test.ts`
  - **J2** : `src/lib/trading/{pairs,emotions,sessions,calculations}.test.ts`, `src/lib/schemas/trade.test.ts`, `src/lib/storage/keys.test.ts`
  - **159 tests verts au close-out J2** (vs 38 au close-out J1).
- **Vitest setup** : `src/test/setup.ts` charge `@testing-library/jest-dom/vitest`. `vitest.config.ts` stub `DATABASE_URL`/`AUTH_SECRET`/`AUTH_URL` pour permettre les imports transitifs sans crash Zod.
- **Playwright** (`pnpm --filter @fxmily/web test:e2e`) :
  - `tests/e2e/auth-invitation.spec.ts` (J1) — surface publique auth.
  - `tests/e2e/journal.spec.ts` (J2) — auth gates `/journal/*` + 401 sur `/api/uploads*` non-auth.
  - Le full happy-path member (login → create → close → list) attend le helper de seed Postgres (cross-jalon).
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

- **R2 wiring** (dès qu'Eliot a les keys) : `pnpm add @aws-sdk/client-s3 @aws-sdk/s3-request-presigner` + impl `R2StorageAdapter` (checklist dans `r2.ts`). Update CSP `img-src` pour autoriser le custom domain R2 (J10).
- **J3** (espace admin & vue membre) : `lib/trades/admin-service.ts`, route `/admin/members/[id]/trades`, middleware `requireAdmin` réutilise le pattern `auth.config.ts`.
- **J4** (workflow d'annotation) : table `TradeAnnotation` + upload vidéo (limit 500 MiB côté client, retry stratégie côté UI), notification queue.
- **J6** (track record analytics) : exclude `realizedRSource = 'estimated'` des aggregats expectancy / R-distribution. Garder dans win-rate (le sample reste un win).
- **J10** (prod hardening) : CSP nonces, rate limiting `/api/auth/*` + `/api/uploads`, Sentry, RGPD endpoints (`/api/account/export`, `/api/account/delete`).
