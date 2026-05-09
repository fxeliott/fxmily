# Fxmily

> Suivi comportemental des membres de la formation de trading **Fxmily**.

App web installable (PWA) pour le suivi de chaque membre : journal de trading, check-ins matin/soir, scoring comportemental, corrections admin (texte + vidéo), module Mark Douglas, rapport hebdo IA admin.

📋 **Spec complète** : [`SPEC.md`](./SPEC.md) — source de vérité produit.
🤖 **Conventions Claude Code** : [`CLAUDE.md`](./CLAUDE.md).
🗺️ **V2 / post-V1 backlog** : [`docs/v2-roadmap.md`](./docs/v2-roadmap.md).

**Statut** : J0 → J10 livrés (code prêt prod) · 2026-05-09. Smoke prod end-to-end bloqué par pré-requis externes Eliot (Hetzner CX22, domaine `fxmily.com`, Resend domain verify, Sentry DSN, iPhone Safari 18.4+ pour test push) — checklist dans [`docs/runbook-prod-smoke-test.md`](./docs/runbook-prod-smoke-test.md).

---

## Stack

- **Next.js 16.2.6** (App Router, Turbopack) + **React 19.2.6** + **TypeScript 6 strict** — patches CVE-2026-23870/44574/44575/44578.
- **Tailwind CSS 4.2** + **shadcn/ui** + **DS-v2 9 primitives custom** (lime + Geist + Mercury shadows) + **Framer Motion** + **Recharts** (pivot SPEC §20.1)
- **Prisma 7.8** (Rust-free, driver adapter `@prisma/adapter-pg`) + **PostgreSQL 17**
- **Auth.js v5** (Credentials + JWT strategy) — câblé J1, status gate global Phase P
- **Cloudflare R2** (médias) + **Resend** (emails) + **Sentry** (monitoring) + **Anthropic Claude API** (rapports hebdo IA, Sonnet)
- **Web Push API + VAPID** + Service Worker manuel (Apple Declarative Web Push 8030 + classic, J9)
- **Vitest 4** (717 tests) + **React Testing Library** + **Playwright** — wired J1+
- **Turborepo** + **pnpm 10 workspaces** — **Node 22 LTS**

## Structure du monorepo

```
.
├── .github/workflows/       # CI (format, lint, type-check, build)
├── .husky/                  # Git hooks (pre-commit, commit-msg)
├── .vscode/                 # Settings + extensions recommandées
├── apps/
│   └── web/                 # Application Next.js (front + API)
│       ├── prisma/          # Schéma DB
│       ├── public/          # Assets statiques (logo, favicon)
│       ├── src/
│       │   ├── app/         # App Router (pages + API routes)
│       │   │   └── api/health/  # Health endpoint (env + DB)
│       │   ├── lib/         # env (Zod), db (Prisma singleton), utils
│       │   └── instrumentation.ts  # Boot-time env validation
│       ├── components.json  # shadcn/ui config
│       ├── next.config.ts   # Headers de sécurité + typedRoutes
│       └── prisma.config.ts # Prisma 7 connection config
├── docs/                    # env-template.md, jalon-1-prep.md, runbooks
├── packages/                # Packages partagés (réservé V2)
├── CLAUDE.md                # Conventions Claude Code
├── SPEC.md                  # Spec produit (source de vérité)
├── commitlint.config.mjs    # Conventional Commits enforcement
├── docker-compose.dev.yml   # Postgres 17 local
├── lint-staged.config.mjs   # Pre-commit lint stratégie monorepo
├── tsconfig.base.json       # Config TS strict partagée
└── turbo.json               # Tâches monorepo
```

## Pré-requis

- **Node.js 22 LTS** (le `.nvmrc` épingle `22` ; Node 23/24 acceptés via `engines`)
- **pnpm 10+** : `npm install -g pnpm` (ou `corepack enable pnpm`)
- **Docker Desktop** (pour Postgres local — install nécessite WSL2 sur Windows)
- **Git** (avec identité configurée : `git config --global user.name "..."`)

## Démarrage local — première fois

```bash
# 1. Cloner et installer
git clone <repo-url> Fxmily
cd Fxmily
pnpm install --frozen-lockfile

# 2. Créer apps/web/.env (template dans docs/env-template.md)
#    Patterns .env* sont gitignored — ne JAMAIS commiter.
#    Génère un AUTH_SECRET avec : openssl rand -base64 32

# 3. Lancer Postgres en local
docker compose -f docker-compose.dev.yml up -d
docker ps   # vérifier fxmily-postgres-dev healthy

# 4. Générer le client Prisma 7
pnpm --filter @fxmily/web prisma:generate

# 5. (Au J1+) appliquer les migrations
pnpm --filter @fxmily/web prisma:migrate dev

# 6. Lancer l'app
pnpm dev
```

→ http://localhost:3000 (home Fxmily)
→ http://localhost:3000/api/health (statut env + DB en JSON)

## Démarrage local — quotidien

Une fois la première install faite, dans une nouvelle session :

```bash
docker compose -f docker-compose.dev.yml up -d   # si pas déjà up
pnpm dev
```

## Scripts utiles

| Commande                                    | Description                              |
| ------------------------------------------- | ---------------------------------------- |
| `pnpm dev`                                  | Lance Next.js en mode dev avec Turbopack |
| `pnpm build`                                | Build de production (Turbopack)          |
| `pnpm start`                                | Lance le build de prod                   |
| `pnpm lint`                                 | ESLint sur tout le monorepo              |
| `pnpm lint:fix`                             | ESLint avec auto-fix                     |
| `pnpm type-check`                           | TypeScript strict (`tsc --noEmit`)       |
| `pnpm test`                                 | Tests unitaires Vitest (J1+)             |
| `pnpm test:e2e`                             | Tests E2E Playwright (J1+)               |
| `pnpm format`                               | Formatage Prettier (auto-fix)            |
| `pnpm format:check`                         | Vérification format (CI)                 |
| `pnpm --filter @fxmily/web prisma:generate` | Générer le client Prisma                 |
| `pnpm --filter @fxmily/web prisma:migrate`  | Créer/appliquer une migration            |
| `pnpm --filter @fxmily/web prisma:studio`   | Ouvrir Prisma Studio (UI DB)             |

## Quality gate avant commit

Le pre-commit hook (Husky + lint-staged) tourne automatiquement Prettier + ESLint sur les fichiers staged. Pour vérifier manuellement :

```bash
pnpm format:check && pnpm lint && pnpm type-check && pnpm build
```

Conventional Commits enforced via commit-msg hook (commitlint). Format : `type(scope?): subject`.
Types : `feat`, `fix`, `chore`, `docs`, `refactor`, `perf`, `test`, `build`, `ci`, `revert`, `style`.

## Stack de sécurité

Wired J0 → J10 :

- Headers (`next.config.ts`) : CSP, X-Content-Type-Options, X-Frame-Options DENY, Referrer-Policy, Permissions-Policy, COOP, HSTS preload prod
- Validation env Zod au boot (`apps/web/src/lib/env.ts` via `instrumentation.ts`)
- Pas de secrets en dur, `.env*` gitignored avec allowlist `.env.example`
- `argon2id` (`@node-rs/argon2`, OWASP 2024 — 19 MiB/t=2/p=1) + bidi/zero-width sanitization sur tous les champs free-text
- `crypto.timingSafeEqual` SHA-256 sur `X-Cron-Secret` + token bucket rate limiter (5 burst, 1/min) sur tous les crons
- BOLA cross-resource ownership check 2 niveaux sur uploads
- Origin/Referer enforcement export RGPD + Zod allowlist hosts FCM/APNs/Mozilla sur push subscriptions
- Soft-delete RGPD 24h grace + cron purge 30j + audit slugs `account.deletion.*`
- Sentry beforeSend scrubber (cookies/auth/X-Cron-Secret/IP/email/body strip)
- `pnpm.overrides` : `postcss` ≥ 8.5.10, `@hono/node-server` ≥ 1.19.13, `hono` ≥ 4.12.18 (CVE 2026-44457/44458/44459)

Reclassé V2 : CSP nonces (`'unsafe-inline'` aujourd'hui), JWT `tokenVersion` révocation immédiate, login rate-limit credential-stuffing.

## Roadmap (jalons)

Voir section 15 du [`SPEC.md`](./SPEC.md). 11 jalons (J0 → J10), ~50-70 jours estimés.

| Jalon   | Statut        | Description                                                      |
| ------- | ------------- | ---------------------------------------------------------------- |
| **J0**  | ✅ 2026-05-05 | Setup projet (Turborepo + Next 16 + Prisma 7 + DS-v2 lime)       |
| **J1**  | ✅ 2026-05-05 | Auth.js v5 + invitation Resend + onboarding atomique             |
| **J2**  | ✅ 2026-05-05 | Journal trading wizard 7-step + uploads R2/local + BOLA          |
| **J3**  | ✅ 2026-05-06 | Espace admin + vue membre + trades tab                           |
| **J4**  | ✅ 2026-05-06 | Annotation admin (image V1, vidéo Zoom V2) + queue notifications |
| **J5**  | ✅ 2026-05-06 | Check-ins matin/soir + streak Mercy + cron reminders             |
| **J6**  | ✅ 2026-05-07 | Dashboard membre + 4 scores comportementaux + Recharts           |
| **J7**  | ✅ 2026-05-07 | 50/50 fiches Mark Douglas + déclencheurs Octalysis               |
| **J8**  | ✅ 2026-05-08 | Rapport hebdo IA admin (Claude Sonnet + cache 1h)                |
| **J9**  | ✅ 2026-05-08 | Web Push API + VAPID + SW + 5 toggles préférences                |
| **J10** | ⏳ 2026-05-09 | RGPD + Sentry + Hetzner/Vercel deploy + observability            |

**J10 status** : code prêt, smoke prod end-to-end bloqué par 7 pré-requis externes Eliot. Une fois levés (Hetzner CX22 provisionné + `fxmily.com` acheté + Resend domain verified + Sentry DSN + iPhone Safari 18.4+ + admin password rotated + GitHub secrets posés), checklist 12-step dans [`docs/runbook-prod-smoke-test.md`](./docs/runbook-prod-smoke-test.md) conclut l'itération.

## Licence

Propriétaire — Fxmily © 2026. Tous droits réservés.
