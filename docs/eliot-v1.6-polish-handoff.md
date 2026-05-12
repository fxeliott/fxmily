# V1.6 polish — Handoff Eliot (post-session 2026-05-12)

> Session autonomie max — code V1.6 polish 100% codé, audité, testé, committé, pushé, PR ouvert. Tout ce qui suit nécessite **toi** parce que c'est physique, ou parce que c'est une décision business, ou parce que mon OAuth token manque un scope.

## 🟢 État final session 2026-05-13 (1 PR ouvert + V1.6 polish LIVE sur main)

- **V1.6 polish MERGÉ sur main 2026-05-13** : commit `c1bf8c9` via PR #48 squash. App déployée prête à pickup.
- **PR #49 OUVERT** `feat/v1.6-extras-v1.7-prep` : <https://github.com/fxeliott/fxmily/pull/49> — V1.6 extras + V1.7 dormant :
  - `/api/health` per-IP rate-limit (closes Round 5 security HIGH)
  - `ops/scripts/healthchecks-setup.sh` (Cron Watch externalize bonus V1.6 item #9)
  - `lib/safety/crisis-detection.ts` + 28 tests TDD (V1.7 dormant, regex FR pre/post output)
  - `components/ai-generated-banner.tsx` + 11 tests TDD (V1.7 dormant, EU AI Act 50(1) bannière)
- **PR #38 + #42 + #50 MERGÉS** dans cette session (docker/build-push-action + lint-staged + pnpm-lock regen)
- **Fxmily passé PUBLIC** 2026-05-13 (LICENSE All Rights Reserved + Cron Watch disabled = quota GH plus utilisé)
- **Personal email scrubbed** : `eliott.pena@icloud.com` → `eliot@fxmilyapp.com` dans 12 fichiers (HEAD only ; cf. note `git filter-repo` recommandation pour purger l'historique)
- **PR #41 + #46 + #47** : dependabot rebased, à triager (CLEAN/UNSTABLE)
- **Vitest 803/803 verts** (cumul session)
- 10 audits subagents cumulés Round 5-9, 0 BLOCKERs prod

## 🔴 BLOQUANT à régler MAINTENANT (5 min)

### 1. Billing GitHub Actions

- **URL** : <https://github.com/settings/billing/payment_information>
- **Pourquoi bloquant** : Cron Watch schedules sont **rouges depuis 2026-05-11T21:42** (run #25726807335 etc). Le manual dispatch marche (run #25730532073 a queued), mais les schedules /h sont bloqués → tu n'as pas de monitoring auto des crons Hetzner.
- **3 scénarios possibles** :
  - **(A) CB expirée** → "Update payment method" → nouvelle CB → vert dans 30s
  - **(B) Spending limit à 0** → "Spending limits" → raise à 10 USD (= 2000 min/mois free + 100 GB transfer = largement suffisant pour Fxmily V1)
  - **(C) Tout OK mais bloqué** → screenshot + ouvre un ticket GH support
- **Vérification post-fix** : `gh workflow run cron-watch.yml` → le run schedule suivant doit passer vert dans l'heure
- **Sinon** : CI sur PR #48 va échouer aussi → tu ne pourras pas merger V1.6 polish via gate CI (mais l'admin merge reste possible).

## 🟡 URGENT après billing (10 min)

### 2. Merger #39 docker/login-action 3→4

Mon OAuth token n'a pas le scope `workflow` requis pour modifier `.github/workflows/*.yml`. Tu cliques merge via UI :

- **URL** : <https://github.com/fxeliott/fxmily/pull/39>
- **Squash + delete branch** (cohérent avec #38 que j'ai mergé)

### 3. Merger PR #48 V1.6 polish

- **URL** : <https://github.com/fxeliott/fxmily/pull/48>
- Attendre que CI passe (post-billing fix). Squash + delete branch.

### 4. Apply migration en prod (post-merge V1.6 polish)

```bash
ssh fxmily@<hetzner-ip>
cd /opt/fxmily
docker compose exec web pnpm --filter @fxmily/web prisma:migrate:deploy
docker compose restart web
```

- Migration `20260512182512_v1_6_notification_is_transactional` = `ALTER TABLE + CREATE INDEX` → < 100ms à 30 membres prod V1 (lock metadata-only Postgres 11+).
- Le restart container est nécessaire pour pick up le nouveau `lib/db.ts` pool config + nouveau Prisma client.

### 5. Vérifier prod post-deploy

- `curl https://app.fxmilyapp.com/api/health` → 200 + `{"status":"ok","db":"ok"}`
- `gh run view --workflow cron-watch.yml` → dernier run schedule = vert
- `docker compose logs web --tail 50` → pas d'erreur Prisma pool

## 🟢 Pré-requis V1.7 (à débloquer en amont, mais pas urgent)

### 6. Anthropic API key prod

- **URL** : <https://console.anthropic.com/settings/keys>
- Créer key `Fxmily-prod`
- Stockage : `/etc/fxmily/web.env` sur Hetzner (`ANTHROPIC_API_KEY=sk-ant-...`)
- Restart web container pour pickup

### 7. Workspace Console + spend limit $25/mois

- **URL** : <https://console.anthropic.com/settings/workspaces>
- Créer Workspace `Fxmily-prod` dédié à la prod
- Settings → Spending limits → **Hard cap $25/mois** (anti-runaway cost)
- Confirmé safe : V1 30 membres × 4 reports/mois × Sonnet 4.6 batch+cache = **$1-2/mois** estimé (research Round 4 session 2026-05-12). Marges 100 membres : $5-7/mois.

### 8. Décisions M4/M5/M6 (vision produit, ~10 min réflexion)

Documentées master plan V2 (`docs/FXMILY-V2-MASTER.md`). Mes **recommandations expert** par défaut :

- **M4 Métaphore** : **C "Le miroir de ton exécution"** (Mark Douglas introspection + pilier P2 "ce que membre FAIT", non-paternaliste)
- **M5 Rituel central** : **A + C combinés** (60 sec matin + 30 sec post-trade = 2 min/jour max, Rupprecht 2024 sustainable 12 sem)
- **M6 Wow moment** : **D Day 1 + B Day 7 + A Day 30** (échelonné, D déjà LIVE V1)

Si tu acceptes ces 3 → on enchaîne V1.7 immédiatement après V1.6 polish merge. Si tu rejettes un → skill `/spec` interactif.

### 9. iPhone PWA smoke physique (10 min, non automatisable)

- Safari ≥ 18.4 (idéal iOS 26)
- Visit `https://app.fxmilyapp.com` → Partager → "Sur l'écran d'accueil" → toggle **"Open as Web App" ON**
- Login `eliot@fxmilyapp.com` / `<mdp prod actuel>`
- `/account/notifications` → activer push → autoriser
- Confirme à Claude : "push activé iPhone" → je trigger un dispatch SSH + tu valides la réception

### 10. Rotation password admin (post-V1.6 polish ship, 5 min)

```bash
ssh fxmily@<hetzner-ip>
bash /opt/fxmily/ops/scripts/rotate-admin-password.sh eliot@fxmilyapp.com
# → génère mdp solide, update Hetzner, display 1× → stocke en password manager
```

## 🟢 Backlog V1.7+ documenté (non-action immédiate)

### EU AI Act compliance (deadline 2 août 2026)

- **Pénalité canonique** : **€15M ou 3% CA mondial annuel** (Article 99(4), source primaire `artificialintelligenceact.eu/article/99`). PAS €35M/7% (Art.5 prohibited) ni €7.5M (Art.99(5) misleading info).
- **Article 50(1) chatbot transparency** : bannière "Généré par IA — pas substitut coaching humain" persistante sur `/admin/reports/[id]` + email digest
- **Formulation acceptable V1.7 (pas template officiel mandaté)** :
  > "Ce rapport est généré par une intelligence artificielle (Claude, Anthropic). Il ne remplace ni un coaching humain, ni un avis médical, ni un conseil en investissement personnalisé."

### Crisis routing FR (V1.7 wire BLOQUANT pré-deploy)

- **3114** : numéro national prévention suicide (gratuit 24/7)
- **SOS Amitié** : 09 72 39 40 50 (24/7)
- **Suicide Écoute** : 01 45 39 40 00
- Regex post-output keywords HIGH `\b(suicide|me suicider|en finir|tuer (me)|pendre|sauter du|passer à l'acte)\b` → bypass Claude + push direct + ressources
- **Faux positifs trading à exclure** : "tout perdre **sur ce trade**" (capital ≠ vie), "**killer ce setup**" (jargon), "**tuer ma position**" (jargon), "**en finir avec ça**" (souvent "arrêter trading"), "**dépression du marché**" (financier)
- Over-trigger side safety toujours préféré sur trading slang

### Anthropic LIVE V1.7 — 10 patterns validés Round 4

1. Sonnet 4.6 pricing : `$3 input / $15 output / $0.30 cache read / $3.75 5m write / $6 1h write` per MTok. ⚠ `inference_geo: "us"` = 1.1× multiplier (utiliser `"global"`).
2. **Batch API 50% off viable dimanche** MAIS **PAS éligible ZDR** (data retention standard) — acceptable V1 si DPA OK.
3. **Cache 1h pre-warm > 5m parallel** : 1 requête seule `cache_control 1h` puis fan-out batch (toutes hit cache). Économie : 1 write 1h (2× base) vs N writes 5m simultanés perdent cache.
4. **`messages.parse()`** méthode officielle 2026 native Structured Outputs GA. Strip `min/max/int` Zod constraints avant envoi (Anthropic rejette schemas avec keywords non-supportés).
5. **`@anthropic-ai/sdk` 0.95.2** : déjà bumpé dans V1.6 polish ✅
6. **Petri 3.0** (`meridianlabs-ai/inspect_petri`) + add-on Dish : audit pre-release ad-hoc sur system prompt Mark Douglas FR (pas nightly CI, overkill coût)
7. **Workspace spend limit $25** = sufficient hard cap, pas besoin de DB compteur custom
8. **XML structured blocks** anti-prompt-injection : `<instructions>` / `<context>` / `<user_input>` / `<example>` (Anthropic officiel)
9. **DPA Anthropic Ireland Ltd** = entité contractante EU + SCCs Art.46 auto à acceptance Commercial Terms. **DPF Article 45 actif mars 2026**, Anthropic self-certifié. Option A (API directe US) acceptable V1 30-100 membres FR sans plainte CNIL.
10. **ZDR** sales-gated enterprise, pas self-serve. Trop petit pour Fxmily V1.

### 5 garde-fous V1.7 (à implémenter avant 1er digest IA prod)

1. System prompt verrouillé Mark Douglas hardcoded + cache_control 1h pre-warm
2. Regex post-output bloquer `\b(buy|sell|long|short|entry|exit|setup|stop[ -]?loss|take[ -]?profit|target)\b` → retry + escalade Eliot si 2e match
3. Crisis routing pre-input + post-output (cf. §Crisis routing ci-dessus)
4. Cost circuit-breaker : Workspace Console spend limit $25 hard cap + cron daily Usage API → Sentry warning 80%
5. Audit log SHA-256 hash prompt+output sans PII (RGPD-friendly)

### Worktree `vigilant-gagarin-20dd8f` cleanup MAX_PATH (à différer)

- Path Windows > 260 chars bloque `rm -rf` standard
- **Option A** : Long Paths Windows registre `HKLM\SYSTEM\CurrentControlSet\Control\FileSystem\LongPathsEnabled=1` → reboot → `rm -rf`
- **Option B** : `wsl rm -rf D:/Fxmily/.claude/worktrees/vigilant-gagarin-20dd8f` (si WSL2 installé)
- Skill `/windows-longpaths-enable` disponible globalement

### Juriste CIF (avant 100 membres payants)

- Budget : ~300-500 € (master V2 §29)
- Vérification statut Conseiller en Investissement Financier vs formation pure
- ⚠ Risque AMF si requalification : amende sanction AMF moy. ~30k €

## 📊 Status SLO V1.6 post-merge

| Indicateur               | Cible V1.6 ship          | Vérif                               |
| ------------------------ | ------------------------ | ----------------------------------- |
| Cron Watch GH            | 7 jours green continu    | Post-billing fix                    |
| Sentry events/jour       | < 50 baseline            | Post-wiring V1.7 reportWarning/Info |
| /api/health latency      | < 200 ms                 | Curl en boucle 5 min                |
| /api/cron/health overall | green                    | `gh run view` post-deploy           |
| Pool deadlock prod       | 0 (anti-régression V1.6) | Sentry 0 timeout exception 7j       |

## ⚠ Mémoire à corriger (anti-hallucination)

**Repo GitHub Fxmily** : **PUBLIC** vérifié `gh repo view`. Si mémoire dit "PRIVATE post-V1.5.2", c'est faux (déjà corrigé memory `context_pickup_rounds` Round 5, 2026-05-11).

**EU AI Act pénalité Article 50** : **€15M / 3% CA**. Si mémoire dit "€35M/7%" ou "€7.5M/1%", c'est faux (memory canonique `fact_eu_ai_act_canonical.md`).

**ADR-002 scoring constants V1.6** : V1 a **déjà** STDDEV=4 + EXPECTANCY=1 (validés Phase V/W). Si mémoire dit "à re-appliquer V1.6", c'est faux (V2 trigger documenté dans `apps/web/CLAUDE.md` §V1.6 Item 3).

---

**Session terminée 2026-05-12 ~20:48 Europe/Paris**. Tout code livré green + audité. Bonne route Eliot 🎯
