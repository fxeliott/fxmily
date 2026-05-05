# Politique de sécurité — Fxmily

## Versions supportées

Le projet n'a pas encore de version publique. La V1 sera supportée dès le déploiement initial (Jalon 10).

| Version | Statut                            |
| ------- | --------------------------------- |
| `main`  | ✅ supportée (active development) |

## Signaler une vulnérabilité

**Ne jamais ouvrir d'issue publique** pour une vulnérabilité de sécurité.

Contact : **eliott.pena@icloud.com** (sujet : `[SECURITY] Fxmily — <résumé>`).

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

## Surface d'attaque actuelle (Jalon 0)

Au J0 : aucune surface applicative (pas d'auth, pas d'API métier, pas de stockage de données utilisateur). Seules surfaces :

- Endpoint public `/api/health` (lecture seule, JSON statut)
- Stack tech (Next.js 16, Prisma 7, Postgres 17, dépendances pnpm)
- CI GitHub Actions

Cf. SPEC.md §9 pour le programme de sécurité complet (V1 : RGPD, chiffrement, rate-limit, argon2id, CSP, Sentry, audit log, IP hashing).

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
