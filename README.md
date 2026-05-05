# Fxmily

> Suivi comportemental des membres de la formation de trading **Fxmily**.

App web installable (PWA) pour le suivi de chaque membre : journal de trading, check-ins matin/soir, scoring comportemental, corrections admin (texte + vidéo), module Mark Douglas, rapport hebdo IA admin.

📋 **Spec complète** : [`SPEC.md`](./SPEC.md) — source de vérité produit.
🤖 **Conventions Claude Code** : [`CLAUDE.md`](./CLAUDE.md).
🛠️ **Préparation prochain jalon** : [`docs/jalon-1-prep.md`](./docs/jalon-1-prep.md).

**Statut** : Jalon 0 (setup) terminé · 2026-05-05.

---

## Stack

- **Next.js 16.2** (App Router) + **React 19.2** + **TypeScript 5.7 strict**
- **Tailwind CSS 4.2** + **shadcn/ui** + **Framer Motion** (J2+) + **Tremor** (J6+)
- **Prisma 7.8** (Rust-free, driver adapter `@prisma/adapter-pg`) + **PostgreSQL 17.9**
- **Auth.js v5** (email/password + magic link) — câblé au J1
- **Cloudflare R2** (médias) + **Resend** (emails) + **Sentry** (monitoring) + **Anthropic Claude API** (rapports hebdo IA)
- **Vitest** + **React Testing Library** + **Playwright** — wired au J1
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

## Stack de sécurité (J0)

Already wired :

- Headers (`next.config.ts`) : X-Content-Type-Options, X-Frame-Options DENY, Referrer-Policy, Permissions-Policy, COOP, HSTS-en-prod
- Validation env Zod au boot (`apps/web/src/lib/env.ts` via `instrumentation.ts`)
- Pas de secrets en dur, `.env*` gitignored avec allowlist `.env.example`
- `@prisma/client` 7.8 + `@prisma/adapter-pg` 7.8 — Rust-free, plus petite surface d'attaque
- `pnpm.overrides` sur `postcss` et `@hono/node-server` — patch CVE-2026-41305 + CVE-2026-39406

À câbler aux jalons suivants : CSP stricte (J1), rate limiting (J1), argon2id (J1), Sentry (J10).

## Roadmap (jalons)

Voir section 15 du [`SPEC.md`](./SPEC.md). 11 jalons (J0 → J10), ~50-70 jours estimés.

| Jalon  | Statut        | Description                                    |
| ------ | ------------- | ---------------------------------------------- |
| **J0** | ✅ 2026-05-05 | Setup projet (ce repo)                         |
| J1     | À venir       | Auth & invitation (cf. `docs/jalon-1-prep.md`) |
| J2     | —             | Journal de trading                             |
| J3     | —             | Espace admin & vue membre                      |
| J4     | —             | Workflow d'annotation                          |
| J5     | —             | Tracking quotidien (check-ins)                 |
| J6     | —             | Dashboard membre & track record                |
| J7     | —             | Module Mark Douglas                            |
| J8     | —             | Rapport hebdo IA admin                         |
| J9     | —             | Notifications push                             |
| J10    | —             | RGPD, légal, monitoring, déploiement prod      |

## Licence

Propriétaire — Fxmily © 2026. Tous droits réservés.
