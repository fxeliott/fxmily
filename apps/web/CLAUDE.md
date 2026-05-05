# `@fxmily/web` — instructions Claude Code (scoped)

> Ce fichier hérite des conventions du projet : voir `D:\Fxmily\CLAUDE.md` à la racine.
> Ici on documente uniquement les spécificités du package `apps/web`.

## Contexte

Application **Next.js 16** (App Router, Turbopack) qui sert l'app Fxmily — front + API + service worker (PWA, Jalon 9).

## Aliases d'import

- `@/*` → `./src/*` (configuré dans `tsconfig.json` + `components.json`)
- Server-only : `@/lib/db`, `@/lib/env`, `@/generated/prisma/*` ne doivent **JAMAIS** être importés depuis un fichier marqué `'use client'`
- Génère le client Prisma dans `apps/web/src/generated/prisma` (gitignored, exclu de tsconfig + ESLint)

## Boot

`apps/web/src/instrumentation.ts` déclenche l'import de `@/lib/env` au démarrage du runtime Node.js. Toute variable d'environnement requise (DATABASE_URL, AUTH_SECRET, AUTH_URL) y est validée par Zod et le serveur fail-fast si invalide.

→ **Ne pas déplacer `instrumentation.ts`** ailleurs sans comprendre cet effet.

## Routes connues (à compléter par jalon)

| Route                 | Méthode  | Fichier                       | Statut                  |
| --------------------- | -------- | ----------------------------- | ----------------------- |
| `/`                   | GET      | `src/app/page.tsx`            | J0 — splash placeholder |
| `/api/health`         | GET      | `src/app/api/health/route.ts` | J0 — env + DB ping      |
| `/login`              | GET/POST | (J1)                          | À venir J1              |
| `/onboarding/welcome` | GET/POST | (J1)                          | À venir J1              |
| `/admin/*`            | various  | (J3)                          | À venir J3              |
| `/journal/*`          | various  | (J2)                          | À venir J2              |

## Headers de sécurité

Wired dans `next.config.ts` `headers()` (réponse à toute route via `source: '/:path*'`) :

- `X-Content-Type-Options: nosniff`
- `X-Frame-Options: DENY`
- `Referrer-Policy: strict-origin-when-cross-origin`
- `Permissions-Policy: camera=(), microphone=(), geolocation=(), interest-cohort=()`
- `Cross-Origin-Opener-Policy: same-origin`
- `Strict-Transport-Security: max-age=63072000; includeSubDomains; preload` (prod uniquement)

À enrichir au J1 : Content-Security-Policy stricte avec nonces (Next 16 supporte `<Script nonce={...}>`), à concevoir en parallèle du wiring Auth.js.

## Theme (Tailwind 4)

Variables CSS dans `src/app/globals.css` (palette SPEC §8.1). Mode sombre uniquement V1.

- `--background: #0a0e1a` / `--foreground: #e8ecf4`
- `--primary: #2563eb` / `--accent: #3b82f6`
- `--muted: #94a3b8` (bumpé depuis #64748b pour WCAG AA contrast)
- Border `rgba(99, 102, 241, 0.15)` — note : indigo, pas blue exact, à vérifier avec le branding final
- `@layer base` pour les resets globaux
- `@media (prefers-reduced-motion: reduce)` actif

## Conventions composants

- shadcn/ui CLI v4 — `pnpm dlx shadcn@latest add <component>`
- Components dans `src/components/ui/` (générés par shadcn) et `src/components/` (custom)
- `cn()` helper dans `src/lib/utils.ts` (clsx + tailwind-merge)
- Variants : `class-variance-authority` (`cva`)
- Icônes : `lucide-react` (1.x)

## Forms (à wirer J1+)

- React Hook Form + `@hookform/resolvers/zod`
- Schéma Zod partagé client/server quand possible (déclarer dans `src/lib/schemas/*` à venir)

## Database (Prisma 7)

- Schéma : `prisma/schema.prisma` (datasource sans `url`, c'est dans `prisma.config.ts`)
- Client généré : `src/generated/prisma/client` (import via `@/generated/prisma/client`)
- Singleton avec adapter-pg : `src/lib/db.ts`
- Migrations : `pnpm --filter @fxmily/web prisma:migrate`

⚠️ **Au J1** quand on ajoutera le premier modèle, créer une migration nommée `init` :

```bash
pnpm --filter @fxmily/web prisma migrate dev --name init
```

## Tests (à wirer J1)

- Vitest + RTL pour unit/intégration
- Playwright pour E2E
- Postgres réel (testcontainers ou compose dédié `docker-compose.test.yml`) — pas de mock DB
- Mock R2 : MinIO
- Mock Resend : à choisir (lib `email-checker` ou inbucket)

## Pièges Next 16

- `typedRoutes` est au top-level de `next.config.ts`, plus dans `experimental`
- `runtime = 'nodejs'` requis sur les API routes qui touchent Prisma (sinon Edge runtime, incompatible avec adapter-pg)
- `dynamic = 'force-dynamic'` pour les routes qui dépendent de `cookies()`, `headers()`, ou env runtime
- Les conventions `loading.tsx`, `error.tsx`, `not-found.tsx`, `default.tsx` peuvent avoir évolué — toujours vérifier `node_modules/next/dist/docs/` ou la doc officielle avant de créer ces fichiers
- Cache Components (J2+ probable) : nouvelle API avec directive `'use cache'`, à étudier quand pertinent
