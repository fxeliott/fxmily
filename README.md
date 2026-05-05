# Fxmily

> Suivi comportemental des membres de la formation de trading **Fxmily**.

App web installable (PWA) pour le suivi de chaque membre : journal de trading, check-ins matin/soir, scoring comportemental, corrections admin (texte + vidéo), module Mark Douglas, rapport hebdo IA admin.

Voir [`SPEC.md`](./SPEC.md) pour la spec complète.

---

## Stack

- **Next.js 16** (App Router) + **React 19** + **TypeScript strict**
- **Tailwind CSS 4** + **shadcn/ui** + **Framer Motion** + **Tremor**
- **Prisma 7** + **PostgreSQL 17**
- **Auth.js v5** (email/password + magic link)
- **Cloudflare R2** (stockage médias) — **Resend** (emails) — **Sentry** (monitoring)
- **Vitest** + **React Testing Library** + **Playwright**
- **Turborepo** + **pnpm workspaces** — **Node 22 LTS**

## Structure du monorepo

```
.
├── apps/
│   └── web/                 # Application Next.js (front + API)
├── packages/                # Packages partagés (réservé V2)
├── docs/                    # Runbooks ops
├── docker-compose.dev.yml   # Postgres local pour le dev
├── SPEC.md                  # Spécification produit (source de vérité)
└── turbo.json
```

## Pré-requis

- **Node.js 22 LTS** (`nvm use` lit `.nvmrc`)
- **pnpm 10+** : `npm install -g pnpm`
- **Docker Desktop** (pour Postgres local)
- **Git**

## Démarrage local

```bash
# 1. Installer les dépendances
pnpm install

# 2. Lancer Postgres en local
docker compose -f docker-compose.dev.yml up -d

# 3. Copier l'env et l'éditer
cp apps/web/.env.example apps/web/.env

# 4. Appliquer les migrations Prisma
pnpm --filter web prisma migrate dev

# 5. Lancer l'app
pnpm dev
```

L'app sera disponible sur http://localhost:3000.

## Scripts utiles

| Commande          | Description                               |
| ----------------- | ----------------------------------------- |
| `pnpm dev`        | Lance Next.js en mode dev avec hot-reload |
| `pnpm build`      | Build de production                       |
| `pnpm lint`       | ESLint sur tout le monorepo               |
| `pnpm type-check` | TypeScript en mode strict, sans build     |
| `pnpm test`       | Tests unitaires (Vitest)                  |
| `pnpm test:e2e`   | Tests E2E (Playwright)                    |
| `pnpm format`     | Formatage Prettier                        |

## Roadmap (jalons)

Voir section 15 du `SPEC.md`. Statut courant : **Jalon 0 — Setup projet**.

## Licence

Propriétaire — Fxmily © 2026. Tous droits réservés.
