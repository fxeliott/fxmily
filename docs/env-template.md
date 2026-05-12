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
# RESEND_FROM=no-reply@fxmilyapp.com

# -- Cloudflare R2 (media storage) — Jalon 1+ ---------------------------------
# R2_ACCOUNT_ID=
# R2_ACCESS_KEY_ID=
# R2_SECRET_ACCESS_KEY=
# R2_BUCKET=fxmily-media
# R2_PUBLIC_URL=https://media.fxmilyapp.com

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
# VAPID_SUBJECT=mailto:eliot@fxmilyapp.com
# NEXT_PUBLIC_VAPID_PUBLIC_KEY=

# -- Cron (Hetzner systemd timer / GH Actions) — Jalon 10 ---------------------
# Génère avec : openssl rand -hex 24 (24 chars min, 96 bytes recommandé)
# Vérifié timing-safe via SHA-256 + timingSafeEqual côté serveur.
# CRON_SECRET=

# -- Rapports hebdo IA — destinataire admin (Jalon 8 + 10) --------------------
# Email où sont expédiés les digests + rapports sécurité.
# Doit pointer vers une boîte que tu lis. En dev, mets ton perso ; en prod,
# mets l'alias eliot@fxmilyapp.com une fois le domaine Resend vérifié.
# WEEKLY_REPORT_RECIPIENT=eliot@fxmilyapp.com

# -- Storage local fallback (avant R2) — dev uniquement -----------------------
# Sans R2 keys, les uploads atterrissent dans ce dossier (gitignored).
# Si non défini, défaut = `apps/web/.uploads/`.
# UPLOADS_DIR=
```

## Sécurité

- ❌ Ne JAMAIS committer `apps/web/.env` (déjà dans `.gitignore`)
- ✅ `apps/web/.env.example` peut être committé (juste un template, aucun secret)
- ✅ Régénère `AUTH_SECRET` à chaque déploiement (dev / prod différents)
- ✅ Les VAR `NEXT_PUBLIC_*` sont exposées au client — n'y mets QUE des choses publiques

### ⚠️ Ne JAMAIS coller un secret dans un prompt Claude

Les prompts soumis à Claude Code finissent dans `~/.claude/projects/<scope>/<sessionId>.jsonl` **en clair**, et transitent par les serveurs Anthropic (rétention selon plan, ~30j Max consumer).

**Précédent** : 2026-05-05, une clé Resend live + un mdp admin ont été collés dans 2 prompts. Le hook `~/.claude/hooks/secret_scanner.ps1` (UserPromptSubmit) bloque désormais ces patterns automatiquement.

**Pattern recommandé** :

```powershell
# 1. Charge le secret hors Claude (PowerShell normal)
$env:RESEND_API_KEY = Read-Host "Resend key" -AsSecureString
# (ou simplement copier dans clipboard)

# 2. Dans Claude, référence par nom :
#    "j'ai mis ma clé dans $env:RESEND_API_KEY, génère le snippet qui la consomme"

# 3. Claude écrit le code → tu copies → tu lances hors Claude
```

**Si une clé fuit** :

1. Console du provider (Resend, Anthropic, etc.) → DELETE/REVOKE.
2. Verify Activity logs : aucun usage non reconnu post-leak.
3. Generate new key → coller dans `.env` hors Claude.
4. Update `gh secret set` si la clé est aussi dans GitHub Secrets CI.
5. Redact les JSONL exposés (script PowerShell dans `apps/web/CLAUDE.md` J8 polish section).

## Validation au runtime

`apps/web/src/lib/env.ts` valide via Zod le shape attendu. Si `DATABASE_URL`, `AUTH_SECRET` ou `AUTH_URL` sont absents/invalides, l'app **crash au démarrage** avec un message clair. C'est volontaire (fail fast, pas de comportement aléatoire en runtime).
