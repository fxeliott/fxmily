# Politique de sécurité — Fxmily

## Versions supportées

Fxmily est **LIVE prod** sur `app.fxmilyapp.com` depuis 2026-05-10. Le cycle V1 complet est shipped (J0 → J10 + V1.5 + V1.6 + V1.7.2 + V1.8 + V1.9 + V2.0 backend). Branch protection main enabled (3 required checks).

| Version | Statut                                            |
| ------- | ------------------------------------------------- |
| `main`  | ✅ supportée (LIVE prod, active development V1.x) |

## Signaler une vulnérabilité

**Ne jamais ouvrir d'issue publique** pour une vulnérabilité de sécurité.

Contact : **eliot@fxmilyapp.com** (sujet : `[SECURITY] Fxmily — <résumé>`).

Inclure :

- Description du problème (impact + reproduction)
- Étapes pour reproduire (PoC si possible)
- Versions / commits affectés
- Toute autre info pertinente

Réponse attendue sous 72 h. Triage et fix sous 7-14 jours selon sévérité.

## Sévérité

Convention CVSS v3.1 :

- **Critique** (≥ 9.0) : fix immédiat, hotfix release
- **Élevée** (7.0-8.9) : fix dans la semaine
- **Moyenne** (4.0-6.9) : fix dans le sprint courant
- **Basse** (< 4.0) : backlog

## Reconnaissance

Les rapports de bonne foi seront crédités dans les release notes (sauf demande contraire).

## Cadre légal

Les chercheurs respectant les conditions ci-dessous bénéficient d'un cadre safe-harbor (pas de poursuites pour le test) :

- Pas d'exfiltration de données utilisateur réelles
- Pas de DoS volontaire
- Pas d'accès à des données qui ne sont pas les vôtres
- Notification responsable avant toute divulgation publique

## Surface d'attaque actuelle (V1 LIVE prod)

Mise à jour 2026-05-15. Surface applicative cycle V1 complet :

### Public (non-auth)

- `/api/health` GET — env + DB ping, rate-limited (`healthLimiter` 30 burst + 1/s refill, V1.6 extras)
- `/login` GET/POST — Server Action `signInAction` avec argon2id verifyPassword + `loginEmailLimiter` (5 burst, 1/min) + `loginIpLimiter` (10 burst, 1/min) keyed `callerIdTrusted` (XFF last-entry V1.10 sec hardening)
- `/onboarding/welcome?token=...` — invitation flow nanoid 32 (~192 bits entropy) + SHA-256 hash storage + Prisma transaction atomic
- `/legal/{privacy,terms,mentions,ai-disclosure}` — pages statiques
- Service Worker `/sw.js` + manifest `/manifest.webmanifest` + `/robots.txt` + `/sitemap.xml` (V1 cohorte privée Disallow:/)
- Sentry tunnel `/monitoring` (Next.js plugin auto-route)

### Auth required (Auth.js v5 JWT + status='active' gate global Phase P)

- Member surfaces : `/dashboard`, `/journal/*`, `/checkin/{morning,evening}`, `/library/*` (50 fiches Mark Douglas), `/review/*`, `/reflect/*`, `/account/{data,delete,notifications}`
- Admin surfaces : `/admin/{members,reports,system,invite,cards}/*`
- API routes : `/api/account/data/export` (RGPD JSON dump), `/api/account/push/*` (subscribe/resubscribe/preferences), `/api/uploads/*` (J2 BOLA cross-resource ownership)

### Admin secret-gated (X-Admin-Token SHA-256 + timingSafeEqual)

- `/api/admin/weekly-batch/{pull,persist}` — V1.7.2 local Claude Max batch HTTP migration

### Cron secret-gated (X-Cron-Secret SHA-256 + timingSafeEqual + rate-limit)

9 cron endpoints : `recompute-scores`, `checkin-reminders`, `weekly-reports`, `dispatch-douglas`, `dispatch-notifications`, `health`, `purge-deleted`, `purge-push-subscriptions`, `purge-audit-log`

### Stack tech & infra

- **Runtime** : Next.js 16.2.6 + React 19.2.6 (CVE-2026-23870/44574/44575/44578 patches) + Node 22 LTS + Prisma 7.8 + Postgres 17 + pnpm 10 overrides (`postcss ≥ 8.5.10`, `hono ≥ 4.12.18` CVE 2026-44457/58/59)
- **Auth** : Auth.js v5 beta JWT 30-day + status gate global + argon2id (OWASP 2024 19 MiB/t=2/p=1)
- **Storage** : Cloudflare R2 (médias) + Resend (emails) + Sentry (monitoring + tunnel `/monitoring` + `beforeSend` URL/cookies/headers scrub symmetric server+client+edge V1.11)
- **Deploy** : Docker Compose Hetzner CX22 + Caddy 2-alpine reverse-proxy HTTPS HSTS preload + GitHub Actions deploy.yml + Sentry source maps upload + GHCR
- **Data minimization** : audit logs IP hashed SHA-256 + AUTH_SECRET salt, RGPD 24h grace + 30j hard-purge cron, push endpoint URL never exposed member-side, member labels pseudonymized SHA-256 + MEMBER_LABEL_SALT for Claude prompt boundary
- **CSP** : default-src 'self', script-src 'self' 'unsafe-inline' (V2 nonces tracked), frame-ancestors 'none', upgrade-insecure-requests prod
- **CI/CD** : GitHub Actions (Lint+CodeQL+Playwright required) + Dependabot weekly Mon 06:00 Paris (3 ecosystems) + Socket Security per-PR + branch protection strict + linear history + no force-push

Cf. SPEC.md §9 pour le programme de sécurité complet + `apps/web/CLAUDE.md` pour les détails par jalon J0-V2.0.

## Bonnes pratiques contributeurs

- Jamais committer de secrets (`.env*` gitignored, allowlist `.env.example`)
- Toujours valider input utilisateur (Zod côté API + formulaires)
- Server-only par défaut pour `@/lib/db`, `@/lib/env`
- HTTPS partout en prod
- Conventional Commits enforced (audit traceable)
- pre-commit hook (lint-staged) + commit-msg (commitlint)

## Outils

- `pnpm audit` (dépendances)
- Dependabot (`.github/dependabot.yml`) — alertes hebdo lundi 06:00 Paris
- Sentry plan gratuit (Jalon 10)
- Audits manuels via subagents `security-auditor` avant chaque release
