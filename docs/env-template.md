# Variables d'environnement — template

> **Pourquoi ce fichier ?** Le pattern `.env*` est bloqué par mes garde-fous Claude Code (`~/.claude/CLAUDE.md`). Plutôt que d'affaiblir ces garde-fous, on documente le template ici. **Copie le bloc ci-dessous dans `apps/web/.env.example`** (création manuelle) puis dans `apps/web/.env` (jamais committé) avec tes vraies valeurs.

## Création initiale

```bash
# Depuis D:\Fxmily, en PowerShell ou Git Bash :
# 1. Crée apps/web/.env.example en copiant le bloc ci-dessous (ouvre VS Code, paste, save)
# 2. cp apps/web/.env.example apps/web/.env
# 3. Édite apps/web/.env avec tes vraies valeurs (DATABASE_URL local OK pour Docker)
# 4. Génère AUTH_SECRET : openssl rand -base64 32
# 5. pnpm dev
```

## Contenu à mettre dans `apps/web/.env.example`

```dotenv
# =============================================================================
# Fxmily — variables d'environnement
# Copie ce fichier en `.env` (jamais committé) et remplace les valeurs.
# =============================================================================

# -- Runtime ------------------------------------------------------------------
NODE_ENV=development

# -- Database (Postgres) ------------------------------------------------------
# En local : docker compose -f docker-compose.dev.yml up -d
DATABASE_URL=postgresql://fxmily:fxmily_dev@localhost:5432/fxmily?schema=public

# -- Auth.js v5 ---------------------------------------------------------------
# Génère un secret avec : openssl rand -base64 32
AUTH_SECRET=changeme_generate_with_openssl_rand_base64_32
AUTH_URL=http://localhost:3000

# -- Resend (transactional email) — Jalon 1 -----------------------------------
# RESEND_API_KEY=re_...
# RESEND_FROM=no-reply@fxmily.com

# -- Cloudflare R2 (media storage) — Jalon 1+ ---------------------------------
# R2_ACCOUNT_ID=
# R2_ACCESS_KEY_ID=
# R2_SECRET_ACCESS_KEY=
# R2_BUCKET=fxmily-media
# R2_PUBLIC_URL=https://media.fxmily.com

# -- Sentry (monitoring) — Jalon 10 -------------------------------------------
# SENTRY_DSN=
# SENTRY_AUTH_TOKEN=
# NEXT_PUBLIC_SENTRY_DSN=

# -- Anthropic Claude API (rapports hebdo IA) — Jalon 8 -----------------------
# ANTHROPIC_API_KEY=sk-ant-...
# ANTHROPIC_MODEL=claude-sonnet-4-6

# -- Web Push (VAPID) — Jalon 9 -----------------------------------------------
# Génère avec : npx web-push generate-vapid-keys
# VAPID_PUBLIC_KEY=
# VAPID_PRIVATE_KEY=
# VAPID_SUBJECT=mailto:eliott.pena@icloud.com
# NEXT_PUBLIC_VAPID_PUBLIC_KEY=
```

## Sécurité

- ❌ Ne JAMAIS committer `apps/web/.env` (déjà dans `.gitignore`)
- ✅ `apps/web/.env.example` peut être committé (juste un template, aucun secret)
- ✅ Régénère `AUTH_SECRET` à chaque déploiement (dev / prod différents)
- ✅ Les VAR `NEXT_PUBLIC_*` sont exposées au client — n'y mets QUE des choses publiques

## Validation au runtime

`apps/web/src/lib/env.ts` valide via Zod le shape attendu. Si `DATABASE_URL`, `AUTH_SECRET` ou `AUTH_URL` sont absents/invalides, l'app **crash au démarrage** avec un message clair. C'est volontaire (fail fast, pas de comportement aléatoire en runtime).
