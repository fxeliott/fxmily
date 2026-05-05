# Fxmily — instructions Claude Code

> Source de vérité produit : [`SPEC.md`](./SPEC.md). En cas de conflit entre ce fichier et SPEC.md, c'est SPEC.md qui gagne.

## Contexte court

App web/PWA de **suivi comportemental** des membres de la formation de trading **Fxmily** d'Eliot. Posture explicite (SPEC §2) :

- ❌ **Pas de conseil sur les analyses de trade** (setups, tendances, prévisions de marché)
- ✅ Conseils autorisés sur l'**exécution** (sessions, hedge, plan, discipline)
- ✅ Conseils autorisés sur la **psychologie** (framework Mark Douglas, citations courtes + paraphrases attribuées)

Public : 30 → 100 → milliers de membres. Mobile-first PWA (V1) → Capacitor + stores (V2). Fuseau Europe/Paris.

## Stack

Détails complets dans SPEC.md §4. En pratique :

- **Next.js 16** (App Router) + **React 19** + **TypeScript strict**
- **Tailwind CSS 4** + **shadcn/ui** + **Framer Motion** + **Tremor**
- **Prisma 7** (Rust-free, driver adapter `@prisma/adapter-pg`) + **PostgreSQL 17**
- **Auth.js v5** (email + password + magic link)
- **Cloudflare R2** (médias) + **Resend** (emails) + **Sentry** (monitoring) + **Anthropic Claude API** (rapports hebdo IA)
- **Vitest** + **React Testing Library** + **Playwright**
- **Turborepo** + **pnpm workspaces** — **Node 22 LTS** — **pnpm 10**

## Conventions du repo

- **Strict TypeScript partout.** Pas de `any` non motivé. `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes` sont activés (cf. `tsconfig.base.json`) — les types doivent les respecter.
- **Validation runtime systématique** : Zod sur les input API, formulaires (RHF + zodResolver), env (`apps/web/src/lib/env.ts`).
- **Server-only par défaut** : importer Prisma / env / secrets uniquement depuis Server Components ou route handlers. Ne JAMAIS importer `@/lib/db` ou `@/lib/env` depuis un fichier `'use client'`.
- **Conventional Commits en anglais**, courts, scope quand pertinent (`feat(auth):`, `fix(trade-form):`, `chore:`).
- **Une feature = une branche.** Pas de commit sur `main` directement après le J0 (au-delà du setup).
- **Tests pour la logique critique** : `lib/scoring/*`, `lib/triggers/*`, `lib/calculations/*` (Vitest). UI pure : pas de tests.
- **Mobile-first strict.** Tester en priorité absolue iPhone SE (375x667) et iPhone 15 (393x852).
- **Mode sombre uniquement V1.** Palette dans `apps/web/src/app/globals.css` (variables `--background`, `--foreground`, `--primary`, etc.).

## Workflow par jalon (CRITIQUE — règle Eliot, SPEC §18.4)

> **1 session Claude Code = 1 jalon. `/clear` entre chaque.**

Cette règle est **non négociable**. Quand Eliot dit "fais tout d'un coup", rappeler la règle, proposer de la maintenir, et appliquer la qualité max **dans le scope du jalon en cours**.

Ordre d'attaque par jalon :

1. Lire le SPEC §15 pour le jalon ciblé (critères "Done quand").
2. Plan court (TodoWrite) avant code multi-fichiers.
3. Implémentation par incréments vérifiables (atomic).
4. **Vérification systématique** : `pnpm format:check && pnpm lint && pnpm type-check && pnpm build` — pas de "ça devrait marcher".
5. Test manuel (golden path + edge cases) si UI.
6. Commit + push.

## Commandes utiles

```bash
# Dev
pnpm dev                                    # lance Next.js en dev
docker compose -f docker-compose.dev.yml up # Postgres local

# Qualité (à lancer avant commit)
pnpm format:check && pnpm lint && pnpm type-check && pnpm build

# Prisma (Prisma 7 — schéma sans `url`, config dans prisma.config.ts)
pnpm --filter @fxmily/web prisma:generate
pnpm --filter @fxmily/web prisma:migrate
pnpm --filter @fxmily/web prisma:studio
```

## Pièges connus

- **Prisma 7** : `url` n'est plus dans `schema.prisma`, il vit dans `apps/web/prisma.config.ts`. Le client est généré dans `apps/web/src/generated/prisma` (gitignored). On instancie via `new PrismaClient({ adapter: new PrismaPg({ connectionString }) })`.
- **`.env*` bloqué par les permissions Claude** d'Eliot. Pour créer / éditer `.env.example` ou `.env`, demander à Eliot — il a un workaround dans `docs/env-template.md`.
- **Husky + lint-staged + pnpm workspaces** : la binaire ESLint n'est pas au root. La config `lint-staged.config.mjs` délègue ESLint au workspace via `pnpm --filter`.
- **CI sans Postgres réel** : le job `build` reçoit des placeholders `DATABASE_URL` / `AUTH_SECRET` / `AUTH_URL`. Si du code touche réellement la DB pendant `next build`, ajouter Postgres (services) ou marquer la route `dynamic = 'force-dynamic'`.
- **`maximumScale` / `userScalable: false`** : interdits (WCAG 1.4.4). Ne jamais les remettre dans `viewport`.

## Outils prioritaires (cf. ~/.claude/CLAUDE.md d'Eliot)

- Doc lib / API → MCP `context7` (jamais ta mémoire d'entraînement).
- Recherche sémantique > 3 fichiers → subagent `researcher` ou `Explore`.
- Vérification post-changement → subagent `verifier`.
- Audit avant release / sur PR critique → subagents `code-reviewer` + `security-auditor` + `accessibility-reviewer` + `ui-designer` en parallèle.

## Eliot (rappel court)

Débutant motivé. Travaille en français pour discuter, anglais pour code/commits. Style direct sans flagornerie. Tester avant d'affirmer (`YOU MUST` du CLAUDE.md global). Demander confirmation avant toute commande destructive ou modif `.git/`/`.claude/`/`.env`.
