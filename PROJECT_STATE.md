# PROJECT_STATE.md — Fxmily

> **Fichier d'état partagé canonique** de la série de 9 sessions structurées (Session 1 = Fondations).
> Il répond à l'exigence d'interconnexion §27 : toute session lit ce fichier **avant d'agir**, et le met à jour **en fin de session** (hand-off).
>
> **Snapshot** : 2026-06-05 · `origin/main` = `1bd66b9` (Session 2 — 3 jalons mergés+déployés LIVE : `#235` profil widget `d43ae2b` + `#236` émotion-pendant `929cfdc` + `#238` analyse-marché déclarée `1bd66b9` ; migrations `20260605114211_add_trade_emotion_during` + `20260605170000_add_market_analysis_done` appliquées prod, health ok/ok/ok) · Mainteneur Session 1 : Claude Code (Opus 4.8) · Auteur produit : Eliot Pena.
>
> **MAJ 2026-06-06** : `origin/main` = `fb9587d`. Durcissement S2 déployé prod (ok/ok/ok) : **#240** (`questionText`←instrument + JSDoc skip-fix + `tradeCloseSchema.strict()`, `cdbf0f7`) + **#203** (prompt « vv1 »→« v1 », `fb9587d`) ; Vitest **1770**. ⚠️ **Session 2 PAS finalisée à 100%** : DoD#2 FAIL (réunions §30 multi-jalon non persisté + suivi-formation déféré) · DoD#3 PARTIAL (scoring) · **backlog 8 PRs ouvertes #200-208** → cf. §11 + §12 hand-off 2026-06-06.
>
> **MAJ-2 2026-06-06 (campagne PR backlog)** : `origin/main` = `eb25d85`. **6 PRs du backlog S2 landées + déployées prod (ok/ok/ok)**, flux `strict:true` sérialisé : #200 (tests `a7aa16e`) · #202 (a11y dup id `868ea32`) · #205 (e2e de-flake `9f959d5`) · #206 (spec §30 réunions `68409b1`, `--admin` docs-pur) · #204 (JWT tokenVersion revocation `ac25b90`, **migration `20260529150000` appliquée prod**) · #201 (validate answers vs instrument `eb25d85`, conflit #240 résolu — #201 subsume). **Reste pour vrai 100% S2** : réunions §30 **build J-M3+J-M4** (#207/#208 à merger AVEC le build, jamais à moitié → ferme DoD#2) · scoring DoD#3 · `/spec` suivi-formation. Détail → §12.

---

## 0. Comment lire ce fichier (hiérarchie des sources de vérité)

Fxmily a **21+ sessions de build réel** derrière lui et tourne **LIVE en production**. La série « 9 sessions » est une **couche de consolidation + pilotage** posée sur cet existant, **PAS un démarrage from-scratch**. Ce fichier ne duplique rien — il **pointe** :

| Source                                                                     | Rôle                                                                                                                                              | Quand la lire                               |
| -------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------- |
| **`PROJECT_STATE.md`** (ce fichier)                                        | Source de vérité d'**ÉTAT** : où on en est, le plan maître des 9 sessions, les contrats d'interface, les invariants.                              | Au démarrage de **chaque** session.         |
| [`SPEC.md`](./SPEC.md) (1463 l, v1.6+)                                     | Source de vérité **PRODUIT** : la vision, le quoi/pourquoi, la posture §2, les critères « Done quand » §15. **En cas de conflit, SPEC.md gagne.** | Pour comprendre l'intention d'un domaine.   |
| [`apps/web/CLAUDE.md`](./apps/web/CLAUDE.md)                               | Détail **jalon-par-jalon** (J0→§26) : décisions verrouillées, scars, pièges, modèle de données par jalon.                                         | Avant de toucher un domaine précis.         |
| [`CLAUDE.md`](./CLAUDE.md) (racine)                                        | **Conventions** repo + règle §18.4 (1 session = 1 jalon).                                                                                         | Toujours active.                            |
| `~/.claude/projects/D--Fxmily/memory/`                                     | Historique **session-par-session** (chronologique inverse) + feedbacks Eliot.                                                                     | Pour le contexte historique d'une décision. |
| `docs/FXMILY-V2-MASTER.md`, `docs/decisions/ADR-*.md`, `docs/runbook-*.md` | Roadmap V2, décisions d'archi, procédures ops.                                                                                                    | Référence ponctuelle.                       |

**Règle d'or** : ne jamais affirmer un état sans l'avoir vérifié (Read / build / `gh` / WebFetch). Ce fichier date ses affirmations et cite ses preuves.

---

## 1. Réalité vérifiée — snapshot daté (2026-06-05)

Vérifications faites **en réel** par la Session 1, pas de mémoire :

| Élément                           | Valeur                                                                                                    | Preuve                                                                                |
| --------------------------------- | --------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| `origin/main`                     | `5dce847` (`fix(batch): isolate claude --print`, #233, 2026-06-04)                                        | `git log`                                                                             |
| CI applicative sur le commit prod | **SUCCESS** — `CI` 2m25s + `Deploy` 2m25s + `E2E (Playwright)` 5m29s                                      | `gh run list --workflow {ci,deploy,e2e}.yml`                                          |
| Santé prod LIVE                   | `{"status":"ok","environment":"production","checks":{"env":"ok","db":"ok"}}` HTTP 200 @ 2026-06-04T23:05Z | WebFetch `app.fxmilyapp.com/api/health`                                               |
| Modèle de données                 | **34 modèles + 22 enums**                                                                                 | [`apps/web/prisma/schema.prisma`](./apps/web/prisma/schema.prisma) (lu intégralement) |
| Migrations Prisma                 | **25** (de `20260505152759_init` à `20260603120000_calendar_questionnaire`)                               | `ls apps/web/prisma/migrations/2026*/ \| wc -l` = 25 [tool-output]                    |
| Code source                       | **552** fichiers `.ts/.tsx`, **119** fichiers `.test.*`                                                   | `find apps/web/src`                                                                   |
| Tests Vitest                      | **1762/1762 passed** (119 fichiers) — **re-run first-hand**                                               | `vitest run` EXIT 0 [tool-output 2026-06-05]                                          |
| Gate qualité local                | `prisma generate` ✓ · `type-check` EXIT 0 ✓ · `lint` EXIT 0 ✓ · build Turbopack EXIT 0 ✓                  | [tool-output 2026-06-05]                                                              |

**Bruit CI à ignorer** : des runs `Dependabot Updates` `hono` apparaissent en `failure` sur main — `hono` est une dépendance **dev-only** (via `@prisma/dev`), pas la CI applicative. C'est un point de **backlog** (§11), pas une régression de build.

---

## 2. Stack technique (réelle, installée, justifiée) — §28

Source : [`apps/web/package.json`](./apps/web/package.json) + [`SPEC.md`](./SPEC.md) §4. La stack « à choisir » de la Session 1 est **déjà installée et en prod** :

| Couche       | Choix réel                                                                      | Version                                                       | Rationale                                                                       |
| ------------ | ------------------------------------------------------------------------------- | ------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| Front + Back | **Next.js 16** (App Router, Turbopack) + **React 19** + **TypeScript strict**   | `next 16.2.6`, `react 19.2.6`, `typescript ^6.0.3`            | Codebase unique web + PWA → Capacitor V2. `middleware.ts`→`proxy.ts` (Next 16). |
| CSS          | **Tailwind CSS 4**                                                              | `^4.3.0`                                                      | Thème custom dark-only (DS-v2 lime).                                            |
| Composants   | **shadcn/ui** (Radix) + `class-variance-authority` + `lucide-react`             | `radix-ui ^1.4.3`                                             | Ownership total du code, a11y.                                                  |
| Animations   | **Framer Motion**                                                               | `^12.40.0`                                                    | LazyMotion `m.*` (bundle).                                                      |
| Charts       | **Recharts** (pivot J6.6 — Tremor abandonné)                                    | `^3.8.1`                                                      | Couleurs hex `C` (bug `var()` WebView iOS).                                     |
| Auth         | **Auth.js v5** (Credentials argon2id + JWT strategy)                            | `next-auth 5.0.0-beta.31` (pin exact — pas de stable à venir) | Self-hosted, `proxy.ts` edge gate.                                              |
| ORM          | **Prisma 7** (Rust-free, `@prisma/adapter-pg`)                                  | `^7.8.0`                                                      | `url` dans `prisma.config.ts`, client généré `src/generated/prisma`.            |
| DB           | **PostgreSQL 17** self-hosted Hetzner                                           | —                                                             | Pool pinné v6-defaults (`lib/db.ts`).                                           |
| Médias       | **Cloudflare R2** (S3-compat)                                                   | —                                                             | Abstraction `lib/storage` (Local dev / R2 prod).                                |
| Email        | **Resend** + React Email                                                        | `resend ^6.12.3`                                              | Free 100/jour = vrai cap.                                                       |
| Validation   | **Zod**                                                                         | `^4.4.3`                                                      | `.strict()` partout (API + forms + env + output IA).                            |
| Push         | **Web Push** + VAPID + Service Worker `public/sw.js`                            | `web-push ^3.6.7`                                             | Apple Declarative (Safari 18.4+).                                               |
| IA           | **Claude en LOCAL** (`claude --print`, abonnement Max, **$0 API marginal**)     | Opus 4.8 §8                                                   | Chemin SDK API (`@anthropic-ai/sdk ^0.98`) **dormant**. Cf. §5.                 |
| Monitoring   | **Sentry** (DSN-gated)                                                          | `@sentry/nextjs ^10.53`                                       | `reportError/Warning/Info` + URL scrub.                                         |
| Tests        | **Vitest** + RTL + **Playwright**                                               | `vitest ^4.1.7`                                               | Unit (logique critique) + e2e (auth gates + happy-path).                        |
| Build/CI     | **Turborepo** + **pnpm 10** + **Node 22 LTS** + GitHub Actions + Docker + Caddy | —                                                             | Cf. §8.                                                                         |

**Pivots stack documentés** (SPEC §20.1) : Tremor→Recharts · DB session→JWT · bleu→DS-v2 lime · API Claude payante→batch local Claude Max. Aucune décision de Session 1 ne ré-ouvre ces pivots.

---

## 3. Architecture globale & orchestration — §28 / §23-24

Monorepo **Turborepo + pnpm workspaces** ; app principale `apps/web`. Pattern Next.js 16 App Router :

```
Client (PWA mobile-first, dark-only DS-v2)
   │  HTTPS  (Caddy reverse-proxy, HSTS, XFF rewrite)
   ▼
proxy.ts  ── auth gate edge (status==='active'), public-route allowlist
   │
   ├── Server Components (force-dynamic) ── lectures DB scoped
   ├── Server Actions ('use server') ────── mutations (pattern J5 carbone)
   └── Route Handlers (runtime nodejs)
         ├── /api/health, /api/auth/[...nextauth]
         ├── /api/cron/*           (X-Cron-Secret, timingSafeEqual, token-bucket)
         ├── /api/admin/*-batch/*  (X-Admin-Token, moteur Claude — §5)
         └── /api/uploads/*        (BOLA, magic-byte, ownership)
   │
   ▼  couches transverses (toutes server-only)
Zod schemas (lib/schemas) → Services (lib/<domaine>/service.ts) → Prisma (lib/db.ts)
   │
   └── transverses : audit (PII-free) · safeFreeText (anti-Trojan-Source) ·
       crisis/injection/AMF detection · firewall anti-leak §21.5/§27.7 ·
       rate-limit token-bucket · observability Sentry · DS-v2 tokens
```

**Principe directeur (SPEC §23-24, directive Eliot)** : _« pas de simplicité bête, pas de complexité gratuite — une architecture parfaitement orchestrée »_. Chaque ajout passe par la **même grammaire** (schema → service server-only → action/route → UI) ; aucune couche n'est superposée ad-hoc.

### 3.1 Arbre `lib/` par domaine (`apps/web/src/lib/`)

- **Infra runtime** : `db.ts` (singleton Prisma 7 + adapter-pg, pool pinné `max:10`/`connectionTimeoutMillis:5_000` — les défauts v7 hangeraient à l'infini) [`lib/db.ts:20-29`] · `env.ts` (Zod sur `process.env`, fail-fast, tokens batch/VAPID/Sentry) [`lib/env.ts`, 267 l] · `instrumentation.ts` (importe `@/lib/env` au boot Node).
- **Domaines IA (moteur Claude — §5)** : `weekly-report/` (réf canonique : `builder·loader·service·claude-client·prompt·pricing·batch·week-window`) · `monthly-debrief/` · `onboarding-interview/` (+`instrument-v1`·`safety`) · `calendar/` (+`instrument-v1`·`snapshot`·`format`).
- **Domaines real-edge** : `scoring/` (4 dimensions + `dashboard-data`) · `analytics/` (maths pures : `wilson·correlations·expectancy·streaks·equity-curve·drawdown·habit-trade-correlation`) · `triggers/` (engine fiches Mark Douglas) · `cards/` · `pre-trade/` (`service·analytics·correlation`) · `trades/` · `annotations/` · `checkin/` · `habit/` · `account/` · `push/` · `admin/`.
- **Domaines isolés (firewall §21.5/§27.7)** : `training/` + `training-debrief/` · `mindset/` · `reflection/`.
- **Transverses** : `auth/` (`audit.ts` **~121 slugs** · `admin-token.ts` · `password.ts` argon2id · `invitations.ts`) · `schemas/` (~25 fichiers Zod, un par entité) · `safety/crisis-detection.ts` (`detectCrisis`, regex FR) · `ai/` (`injection-detector.ts` 9 patterns · `prompt-builder.ts` wrap XML untrusted) · `text/safe.ts` (`safeFreeText`) · `rate-limit/token-bucket.ts` · `observability/` (Sentry + url-scrub) · `storage/` · `email/`.

### 3.2 Couches transverses (invariants partagés par tous les domaines)

- **Frontière server-only stricte** : `@/lib/db`, `@/lib/env`, `@/auth`, les services → **jamais** importés depuis `'use client'`. Sentinelle `import 'server-only'`.
- **Validation runtime Zod** : input API + forms (RHF + zodResolver) + env (`lib/env.ts`, fail-fast au boot via `instrumentation.ts`) + **output IA** (`.strict()`).
- **Audit log PII-free** (`lib/auth/audit.ts`) : IPs SHA-256 + sel `AUTH_SECRET`, jamais de texte brut ; ~100+ slugs `domaine.action`.
- **Sécurité texte** : `safeFreeText` (NFC + strip bidi/zero-width) sur tout free-text user-controlled → bloque Trojan-Source avant tout prompt LLM.
- **Firewall anti-leak** (`src/test/anti-leak/*`) : isolation statistique **§21.5** (Entraînement ↔ real-edge) + **§27.7** (Mindset) + **§26** (Calendrier). Tests « Block A→H » qui glob `lib/{scoring,analytics,trades,habit}/**` et échouent si un module real-edge importe un token training/mindset/calendar.
- **Design system DS-v2** : tokens lime/deep-space (`globals.css`) ; overlay `.v18-theme` (REFLECT blue+black) ; cyan `--cy` (Entraînement §21.7) ; Recharts hex `C` jamais `var()`.

---

## 4. Modèle de données central, global et unifié — §28 (la colonne vertébrale)

**34 modèles, 22 enums** dans [`apps/web/prisma/schema.prisma`](./apps/web/prisma/schema.prisma) — lu intégralement par la Session 1. Le tableau ci-dessous **prouve que le data model couvre 100 % des axes des sessions 2-9** (critère DoD §29). Tous les modèles métier cascadent sur `User` delete (RGPD §17).

| #   | Domaine (→ session)                                | Modèles Prisma                                                              | Enums                                                                                                      | Isolation / note                                                                                                        |
| --- | -------------------------------------------------- | --------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| —   | **Auth / socle**                                   | `User`, `Account`, `Session`, `VerificationToken`, `Invitation`, `AuditLog` | `UserRole`, `UserStatus`                                                                                   | Contrat PrismaAdapter Auth.js. `User` = hub de 30+ relations. Soft-delete RGPD (`deletedAt`).                           |
| A   | **Journal de trade** (real-edge)                   | `Trade`, `TradeAnnotation`                                                  | `TradeDirection`, `TradeSession`, `TradeOutcome`, `RealizedRSource`, `TradeQuality`, `AnnotationMediaType` | `realizedR` computed/estimated ; V1.5 `tradeQuality`/`riskPct` ; tags LESSOR.                                           |
| B   | **Tracking quotidien**                             | `DailyCheckin`, `HabitLog`                                                  | `CheckinSlot`, `HabitKind`                                                                                 | `@db.Date` Europe/Paris ; upsert `(userId,date,slot/kind)`.                                                             |
| C   | **Pré-trade anti-FOMO** (différenciateur)          | `PreTradeCheck`                                                             | `PreTradeReason`, `PreTradeEmotion`                                                                        | Auto-link `Trade` 15 min, **no-FK** race-safe (dangling toléré). ADR-003.                                               |
| D   | **Scoring & track record**                         | `BehavioralScore`                                                           | —                                                                                                          | Snapshot quotidien 4 dimensions ; `Int?` nullable = `insufficient_data` (jamais fake-0).                                |
| E   | **Module Mark Douglas**                            | `MarkDouglasCard`, `MarkDouglasDelivery`, `MarkDouglasFavorite`             | `DouglasCategory`                                                                                          | 50 fiches ; trigger engine ; cooldown white 7j/black 14j. Fair use ≤30 mots.                                            |
| F   | **REFLECT** (introspection)                        | `WeeklyReview`, `ReflectionEntry`                                           | —                                                                                                          | CBT Ellis ABCD ; crisis routing FR ; thème `.v18-theme`.                                                                |
| G   | **Notifications**                                  | `NotificationQueue`, `PushSubscription`, `NotificationPreference`           | `NotificationType`, `NotificationStatus`                                                                   | Dispatcher J9 ; 410 Gone→DELETE ; cap email §18.2.                                                                      |
| H   | **Admin & coaching**                               | `AdminNote`                                                                 | —                                                                                                          | Notes privées admin (membre ne voit jamais).                                                                            |
| I   | **Mode Entraînement / backtest** (§21)             | `TrainingTrade`, `TrainingAnnotation`, `TrainingDebrief`                    | `TrainingOutcome`, `TrainingAnnotationMediaType`                                                           | **§21.5 isolation béton** : enums séparés, 0 FK vers `Trade`.                                                           |
| J   | **Rapports IA** (moteur Claude — §5)               | `WeeklyReport`, `MonthlyDebrief`                                            | —                                                                                                          | Cost-tracking `costEur` Decimal(10,6) ; idempotent `(userId,week/monthStart)`.                                          |
| K   | **Mindset QCM** (§27)                              | `MindsetCheck`                                                              | —                                                                                                          | Déterministe **0-AI** ; instrument versionné ; profil dérivé au render (jamais stocké).                                 |
| L   | **Onboarding & Profil IA** (§V2.4, moteur Claude)  | `OnboardingInterview`, `OnboardingInterviewAnswer`, `MemberProfile`         | `InterviewStatus`                                                                                          | ~30 questions ; Claude synthétise axes psycho/process (jamais analyse trade).                                           |
| M   | **Calendrier adaptatif** (SPEC §31, moteur Claude) | `WeeklyScheduleQuestionnaire`, `AdaptiveCalendar`                           | `CalendarSlot`, `CalendarBlockCategory`                                                                    | Organise le **TEMPS**, jamais les trades. 0 champ P&L. EU AI Act 50(1) disclosure.                                      |
| ⚠   | **Track Record public** (DÉPRÉCIÉ)                 | `PublicTrade`, `PublicTradePartial`                                         | `PublicTradeSegment`, `PublicTradeStatus`                                                                  | **Migré vers repo standalone `trackrecord-fxmily`** (2026-05-25). Gardés `@deprecated` pour sync DB Hetzner avant drop. |

**Invariant data-model #1 (§2 posture)** : tout modèle « adaptatif IA » (Calendar, MemberProfile, WeeklyReport, MonthlyDebrief) porte des données de **temps / process / psychologie** — **jamais** un avis de marché ni un setup.

**Invariant data-model #2 (§21.5 / §27.7)** : `TrainingTrade`/`TrainingAnnotation`/`TrainingDebrief`/`MindsetCheck`/`AdaptiveCalendar` n'ont **aucune FK** vers les modèles real-edge (`Trade`, `BehavioralScore`, `WeeklyReport`). L'isolation statistique est **prouvée par la forme du schéma** + les tests anti-leak (Blocks A→H, cf. §5.3).

> **⚠ Note de numérotation SPEC** (relevée à l'audit) : le **Calendrier** est spécifié en **`SPEC.md §31`** (`:1388`) — le « §26 » des labels de jalon dans `apps/web/CLAUDE.md`/MEMORY est en fait le _changelog_ v1.3→v1.4. Les **réunions §30** ne sont **pas encore** dans `SPEC.md` (numéro réservé, PR #206 `/spec` en attente de merge) — elles sont référencées comme dépendance _future_ du calendrier (`CalendarBlockCategory.meeting`). C'est le seul domaine « planifié-non-construit » du data model.

---

## 5. Moteur Claude Opus 4.8 en LOCAL — service IA central réutilisable — §28

**LE point névralgique de la Session 1.** Fxmily refuse catégoriquement l'API Anthropic payante (décision Eliot). Toute génération IA passe par **`claude --print` headless sur la machine d'Eliot, abonnement Claude Max → $0 API marginal** (SPEC §8). Le chemin SDK API (`@anthropic-ai/sdk`) existe mais reste **dormant**.

### 5.1 Flux end-to-end (pattern carbone, réutilisé par 4 pipelines)

```
Machine Eliot (Windows)                    HETZNER PROD (Caddy → fxmily-web)
  /<pipeline>-batch  (slash command)
  bash ops/scripts/<pipeline>-batch-local.sh
   │ curl POST X-Admin-Token ───────────→  POST /api/admin/<pipeline>-batch/pull
   │                                        │ requireXAdminToken (SHA-256 + timingSafeEqual
   │                                        │   + token-bucket → 503/429/401)
   │                                        │ loadAllSnapshots… (Promise.allSettled batch=5)
   │ ◄──── enveloppe JSON (pseudonymisée) ──┘ pseudonymizeMember (8-char hex, sel MEMBER_LABEL_SALT)
   │
   │  Loop par membre :  claude --print  (Opus 4.8)
   │    --setting-sources ""    ← #233 : 0 CLAUDE.md/hooks de l'opérateur
   │    --system-prompt <REPLACE>   (system prompt + JSON schema voyagent AVEC l'enveloppe)
   │    --max-turns 8  --max-budget-usd 5.00   (circuit-breaker)
   │    60-120s jittered, contexte FRAIS par membre
   │
   ▼  curl POST X-Admin-Token ───────────→  POST /api/admin/<pipeline>-batch/persist
                                            │ MAX_BODY_BYTES 16 MiB + Zod .strict() (results.max 1000)
                                            │ persistGenerated… → GATES (cf. 5.3) → DB
   ◄──── { persisted, skipped, errors, total }
```

### 5.2 Les 4 pipelines (tous LIVE prod, même squelette)

| Pipeline                        | Sortie                                      | Modèle DB          | Statut                                                                                              |
| ------------------------------- | ------------------------------------------- | ------------------ | --------------------------------------------------------------------------------------------------- |
| **Weekly report** (J8 / V1.7.2) | digest hebdo admin                          | `WeeklyReport`     | LIVE — `/api/admin/weekly-batch/{pull,persist}`, `/sunday-batch`                                    |
| **Monthly debrief** (V1.4 §25)  | débrief mensuel membre (dual-section §21.5) | `MonthlyDebrief`   | LIVE — `/api/admin/monthly-batch/*`, `/monthly-batch`                                               |
| **Onboarding profile** (V2.4)   | `MemberProfile` (axes psycho/process)       | `MemberProfile`    | LIVE — `/api/admin/onboarding-batch/*`, `/onboarding-batch`                                         |
| **Calendrier adaptatif** (§26)  | plan hebdo de **temps**                     | `AdaptiveCalendar` | LIVE (infra activée, attend 1ᵉʳ run data réelle) — `/api/admin/calendar-batch/*`, `/calendar-batch` |

Chacun expose `prompt.ts` (system prompt §2-hardcodé + JSON schema strict) + `batch.ts` (`loadAllSnapshots…` + `persistGenerated…`). **Asymétrie vérifiée** [`ls lib/*`] : `weekly-report` + `calendar` ont aussi `claude-client.ts` (`Mock` déterministe / `Live` SDK dormant) **et** `pricing.ts` (sentinel `claude-code-local` → $0) ; `onboarding-interview` a `claude-client.ts` **sans** `pricing.ts` ; `monthly-debrief` a `pricing.ts` **sans** `claude-client.ts` (génération pass-through).

### 5.3 Couches de validation/sécurité de l'output IA (gates `persist…`)

Ordre exact (ne pas réordonner) : **(1)** `error` field d'abord → **(2)** `parseLocalDate(weekStart)` → **(3)** active-user `findMany` (anti forged userId) → **(4)** existence du questionnaire/interview (gate pipeline-spécifique) → **(5)** `<output>Schema.strict().safeParse` (anti-fuzzing enum/clés hallucinées) → **(6)** `detectCrisis(corpus IA complet)` → skip + Sentry (HIGH `reportError` / MEDIUM `reportWarning`) → **(6b)** `detectAMFViolation` (posture §2) → skip + audit `*.amf_violation` → **(7)** `persist`. Onboarding ajoute anti-clinical + evidence verbatim NFC.

### 5.4 Mitigation ban-risk (9 règles, invariantes)

Machine + IP + fingerprint + compte Max d'Eliot · jitter 60-120s (floor 30) · 1 `claude --print` par membre (contexte frais) · données pseudonymisées · system prompt + schema voyagent depuis le repo · **binaire `claude` officiel uniquement** (jamais OpenClaw/Roo/Goose) · human-in-the-loop (Eliot déclenche) · double-net validation serveur (`.strict()` + active-user set) · audit `*.batch.*` PII-free.

### 5.5 Précisions vérifiées (audit architecture)

- **Flags `claude --print` réels** [`ops/scripts/weekly-batch-local.sh:60-63,306-331`] : `--setting-sources ""` + `--system-prompt` (REPLACE) + `--max-turns 8` (PAS 1 — Opus 4.8 consomme 1 turn de thinking avant le JSON) + `--max-budget-usd 5.00` + `--model claude-opus-4-8` + `--effort xhigh` + `printf %s` (anti shell-expansion). `--bare` **retiré** (cassait l'auth OAuth Max).
- **`requireXAdminToken`** [`lib/auth/admin-token.ts:31-180`] : `verifyAdminToken` = SHA-256 des deux côtés + `timingSafeEqual` (CWE-208). Ordre **503** (token absent, refuse-by-default) → **401** (consomme le bucket via `callerIdTrusted` last-XFF non-spoofable) → **429** → null. **3 tokens env pour 4 pipelines** : `ADMIN_BATCH_TOKEN` (**weekly + onboarding le PARTAGENT** [`onboarding-batch/pull/route.ts:3` importe `requireAdminToken`]), `MONTHLY_ADMIN_BATCH_TOKEN`, `CALENDAR_ADMIN_BATCH_TOKEN` [`lib/env.ts:159/172/186`].
- **Firewall anti-leak Blocks A→H** [`src/test/anti-leak/training-isolation.test.ts:90-634`] : A (import firewall) · B (primitive count-only) · C (engagement P&L-invariance) · D (trigger) · E (weekly snapshot `.strict()`) · F (TrainingDebrief §23) · **G** (MonthlyDebrief §25 — lit _légitimement_ le P&L réel, isolation training-only) · **H** (MindsetCheck §27, le plus isolé). `BREACH_TOKENS` interdit `TrainingTrade`/`db.trainingTrade`/`@/lib/training` dans tout module real-edge. Le firewall calendrier glob `lib/calendar/**`.
- **Fichiers réels du moteur** (asymétrie par pipeline vérifiée `ls`) : `weekly-report/` + `calendar/` = les 4 (`claude-client·prompt·batch·pricing.ts`) ; `monthly-debrief/` = `prompt·batch·pricing.ts` (**pas** de `claude-client.ts`) ; `onboarding-interview/` = `claude-client·prompt·batch.ts` + `safety·instrument-v1.ts` (**pas** de `pricing.ts`). Transverses : `lib/auth/admin-token.ts` · `lib/ai/{injection-detector,prompt-builder}.ts` · `lib/safety/crisis-detection.ts` · `app/api/admin/*-batch/{pull,persist}/route.ts` (8 routes) · `ops/scripts/{weekly,monthly,onboarding,calendar}-batch-local.sh` · `.claude/commands/{sunday,monthly,onboarding,calendar}-batch.md`.

---

## 6. Conventions du repo (invariantes) — §6 CLAUDE.md

- **TypeScript strict partout** (`noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`). Pas de `any` non motivé.
- **Validation runtime systématique** (Zod) sur input API, forms, env, output IA.
- **Server-only par défaut** : Prisma/env/secrets jamais depuis un `'use client'`.
- **Conventional Commits en anglais**, courts, scopés.
- **Une feature = une branche** ; pas de commit direct sur `main`.
- **Tests pour la logique critique** (`lib/scoring`, `lib/triggers`, `lib/analytics`, `lib/*/service`) en Vitest ; UI pure non testée en unit (Playwright pour les gates/render).
- **Mobile-first strict** : iPhone SE (375×667) + iPhone 15 (393×852).
- **Dark-only V1** (DS-v2). `maximumScale`/`userScalable:false` **interdits** (WCAG 1.4.4).
- **🔴 Règle §18.4 (non négociable)** : **1 session Claude Code = 1 jalon, `/clear` entre chaque.** Quand Eliot dit « fais tout d'un coup » → rappeler la règle, l'appliquer dans le scope du jalon courant.

---

## 7. PLAN MAÎTRE — mapping des 9 sessions sur les domaines réels — §28

La série « 9 sessions » se mappe **proprement** sur la décomposition métier réelle du projet. **Toutes les sessions de build (2-9) sont DÉJÀ LIVRÉES et LIVE prod** — leur travail n'est donc pas « construire » mais **auditer en profondeur, durcir, et pousser 100× plus loin** (directive Eliot), dans le scope d'un jalon par session (§18.4).

> **Convention d'interconnexion** : chaque session lit `PROJECT_STATE.md` (entrées) **avant**, met à jour son §domaine + le hand-off §12 (sorties) **après**. La colonne vertébrale partagée par toutes = §4 (data model) + §5 (moteur Claude) + §3.1 (transverses).

| Session | Domaine                                                         | Statut réel                    | Modèles                                                                                            | Routes membres                                                                         | « 100× plus loin » (backlog d'amélioration)                                                                                                                                                                                                                                                             |
| ------- | --------------------------------------------------------------- | ------------------------------ | -------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **1**   | **Fondations** (ce fichier)                                     | ✅ Consolidé ici               | —                                                                                                  | —                                                                                      | Maintenir ce fichier à jour à chaque session.                                                                                                                                                                                                                                                           |
| **2**   | **Onboarding & Profil IA** (V2.4 §L) + **émotion-pendant** (§A) | ✅ LIVE prod (2 jalons mergés) | `OnboardingInterview(+Answer)`, `MemberProfile`, `Trade.emotionDuring`                             | `/onboarding/interview*`, `/profile`, **`/dashboard` (widget)**, `/journal/[id]/close` | ✅ **#235 pipeline profilage branché sur le parcours** (`d43ae2b`, était orphelin) + ✅ **#236 émotion AVANT/PENDANT/APRÈS le trade complète** (`929cfdc`, migration prod appliquée). Reste : re-profilage périodique ; dette `questionText:''` ; allowlist `opus-4-8` ; contraste DS `--acc→--acc-hi`. |
| **3**   | **Tracking comportemental** (§B + §C)                           | ✅ LIVE prod                   | `DailyCheckin`, `HabitLog`, `PreTradeCheck`                                                        | `/checkin*`, `/track*`, `/pre-trade/new`                                               | Étendre corrélation pré-trade×outcome aux 5 piliers ; HealthKit/wearables (V2).                                                                                                                                                                                                                         |
| **4**   | **Journal de trade** (§A)                                       | ✅ LIVE prod                   | `Trade`, `TradeAnnotation`                                                                         | `/journal*`                                                                            | Vidéo Zoom 500 MiB (J4.5) ; `Trade.tags` admin filter ; account balance (V2).                                                                                                                                                                                                                           |
| **5**   | **Scoring & Track record** (§D + analytics)                     | ✅ LIVE prod                   | `BehavioralScore`                                                                                  | `/dashboard`                                                                           | Calibration ADR-002 (cohort drift) ; nouvelles corrélations habit×trade.                                                                                                                                                                                                                                |
| **6**   | **Calendrier adaptatif** (SPEC §31 · jalons §26 §M)             | ✅ LIVE prod (4/4)             | `WeeklyScheduleQuestionnaire`, `AdaptiveCalendar`                                                  | `/calendrier`, `/calendar/questionnaire/new`                                           | **Flip ADR-005 Accepted** (1ᵉʳ batch réel + validation §2 sur 5+ calendriers) ; **réunions §30** (PR #206 en attente).                                                                                                                                                                                  |
| **7**   | **Rapports IA hebdo/mensuel** (§J — moteur Claude)              | ✅ LIVE prod                   | `WeeklyReport`, `MonthlyDebrief`                                                                   | `/debrief-mensuel`                                                                     | Outbox exactly-once (V2) ; observabilité coût ; smoke batch réel.                                                                                                                                                                                                                                       |
| **8**   | **Mode Entraînement** (§21 §I) + **Mindset** (§27 §K)           | ✅ LIVE prod                   | `TrainingTrade(+Annotation)`, `TrainingDebrief`, `MindsetCheck`                                    | `/training*`, `/mindset*`                                                              | Maintenir le firewall §21.5/§27.7 sur tout ajout ; placeholder « suivi formation ».                                                                                                                                                                                                                     |
| **9**   | **Mark Douglas & REFLECT** (§E §F) + **Admin/coach** (§H §G)    | ✅ LIVE prod                   | `MarkDouglasCard/Delivery/Favorite`, `WeeklyReview`, `ReflectionEntry`, `AdminNote`, notifications | `/library*`, `/review*`, `/reflect*`, `/admin/*`, `/account/notifications`             | 50→+ fiches ; CRUD admin fiches ; multi-admin (V2 `SetNull`).                                                                                                                                                                                                                                           |

**Ordre / checkpoints** : Sessions 2-9 sont **indépendantes** (chaque domaine est déjà livré et isolé). L'ordre suggéré suit la valeur produit : profilage (2) → tracking (3) → analytics (5) → IA (6,7). Chaque session = 1 jalon = 1 PR atomique, gate vert + audits Opus + vérif réelle (Playwright/screenshots) **avant** merge, `/clear` après.

---

## 8. Infra / Deploy / CI / Crons — §28

- **Runtime prod** : Hetzner Cloud (Falkenstein UE, RGPD) — **Docker Compose** (`docker-compose.prod.yml`) : Postgres 17 + web standalone (`Dockerfile.prod` non-root) + **Caddy 2** (`ops/caddy/Caddyfile`, HSTS preload, XFF rewrite non-spoofable).
- **Deploy auto** : `DEPLOY_PATH=hetzner` ⇒ `.github/workflows/deploy.yml` déploie chaque push `main` non-docs (build → GHCR → SSH → `docker compose pull/up` → `prisma migrate deploy`). **0 carry-over manuel.**
- **CI** : `ci.yml` (lint + type-check + build + Vitest), `e2e.yml` (Playwright chromium + Postgres service), `codeql.yml`, `zizmor.yml` (Actions SHA-pinned, hard-gate medium+), `cron-watch.yml` (heartbeat horaire → issue auto si 503).
- **Crons Hetzner** (`ops/cron/crontab.fxmily`, LF-forcé `.gitattributes`) : backup `pg_dump`→GPG→R2 · `dispatch-notifications` (2 min) · `recompute-scores` (02:00) · `dispatch-douglas` (6h) · `checkin-reminders` · `weekly-reports` (dim 21:00) · `mindset-check-reminders` (lun 09:00) · purges (deleted / push-subs 90j / audit-log 90j) + le backup `caddy_data`.
- **Tooling** : `turbo.json` (tasks build/lint/type-check/test, env `DATABASE_URL`/`AUTH_SECRET`/`AUTH_URL`) · `pnpm-workspace.yaml` (`packageManager: pnpm@10.33.2`, Node ≥22, `pnpm.overrides` CVE postcss/hono) · Husky `.husky/pre-commit` → lint-staged (prettier root + **ESLint délégué au workspace** `pnpm --filter @fxmily/web exec eslint`) · commitlint.

### 8.1 Fichiers infra réels (audit)

- **Docker** : `ops/docker/Dockerfile.prod` (multi-stage `node:22-bookworm-slim` non-root uid 1001, Next standalone, `HEALTHCHECK /api/health`) · `ops/docker/docker-compose.prod.yml` (3 services postgres-17/web/caddy, réseau interne `10.42.42.0/24`, secrets file) · `docker-compose.dev.yml` (Postgres dev seul).
- **Caddy** : `ops/caddy/Caddyfile:20-52` — `app.fxmilyapp.com` → `web:3000`, HSTS preload 2 ans, `-Server`, zstd/br/gzip, **overwrite `X-Forwarded-For {remote_host}`** (`:35-37`, single-hop non-spoofable, aligné `callerIdTrusted`).
- **Workflows** (`.github/workflows/`, **toutes SHA-pinned**) : `ci.yml` (paths-ignore `**/*.md`,`docs/**`) · `e2e.yml` (Playwright chromium + Postgres service réel + seed J6) · `codeql.yml` · `zizmor.yml` (hard-gate `--min-severity medium`) · `deploy.yml` · `cron-watch.yml` (heartbeat horaire `:15`).
- **Crons Hetzner** (`ops/cron/crontab.fxmily`, **11 jobs**, wrapper `fxmily-cron` allowlist 9 routes, LF-forcé `.gitattributes`) : `checkin-reminders` (15 min fenêtres) · `recompute-scores` (`0 2`) · `dispatch-douglas` (`0 0,6,12,18`) · `weekly-reports` (`0 21 * * 0`) · `dispatch-notifications` (`*/2`) · `purge-deleted` (`0 3`) · `purge-push-subscriptions` (`0 5 * * 0`) · `purge-audit-log` (`0 4`) · `fxmily-backup` pg_dump→GPG→R2 (`30 2`) · `fxmily-caddy-backup` (`30 6 * * 0`) · `mindset-check-reminders` (`0 9 * * 1`). **Les 4 batchs IA ne sont PAS dans le crontab** — déclenchés manuellement depuis le PC d'Eliot (§5).
- **Deploy flux** (`deploy.yml`) : gate `vars.DEPLOY_PATH=='hetzner'` → `build-and-push` (buildx → GHCR) → `ssh-deploy` (appleboy, `docker compose pull web` + `up -d`, refresh `/opt/fxmily/prisma` depuis l'image, **`prisma migrate deploy`** via container one-shot) → `notify`.

---

## 9. Contrats d'interface & invariants non-négociables (pour sessions 2-9)

Toute session 2-9 **hérite** de ces contrats et ne doit **jamais** les violer :

1. **Posture §2 (BLOQUANT)** : ❌ aucun conseil sur les analyses de trade (setups/tendances/prévisions). ✅ exécution (sessions/hedge/plan/discipline) + ✅ psychologie Mark Douglas (citations ≤30 mots + paraphrases attribuées). Tout output IA passe le gate `detectAMFViolation`.
2. **Isolation statistique §21.5 / §27.7 / §26** : pas de FK ni d'import cross entre surfaces Entraînement/Mindset/Calendrier et le real-edge (scoring/analytics/journal). Le firewall `test/anti-leak/*` doit rester vert.
3. **IA = $0 (batch local Claude Max)** : aucune session ne réintroduit l'API Anthropic payante sans décision Eliot explicite. Pattern §5 obligatoire (isolation `claude --print` #233).
4. **Audit PII-free** (RGPD §16) : jamais d'email/texte brut/endpoint dans `metadata` ni dans un sink externe (Sentry).
5. **RGPD** : tout nouveau modèle cascade sur `User` delete ; free-text passe `safeFreeText`.
6. **Data model = SSOT** : pas de donnée dérivée stockée (profil mindset, stats debrief = calculés au render). `.strict()` sur tout schema.
7. **Mobile-first + dark-only + a11y WCAG 2.2 AA** ; DS-v2 tokens (jamais de hex/`var()` magiques hors convention).
8. **§18.4** : 1 session = 1 jalon = 1 PR atomique revertable.

---

## 10. Definition of Done §29 — vérification réelle

| Critère §29                                                                  | Statut                                          | Preuve                                                                                                                                                                                                                                                                              |
| ---------------------------------------------------------------------------- | ----------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Le dépôt démarre, build vert, 0 warning critique                             | ✅ **VÉRIFIÉ EN RÉEL (local + CI)**             | **Local 2026-06-05** (`pnpm install --frozen-lockfile` + `prisma generate`) : `type-check` EXIT 0 ✓ · `lint` EXIT 0 ✓ · **Vitest 1762/1762** EXIT 0 ✓ · **build Turbopack** EXIT 0 ✓ [tool-output]. **CI** : CI+Deploy+E2E SUCCESS sur `5dce847` [gh].                              |
| Le modèle de données couvre **100 %** des besoins sessions 2-9               | ✅ **VÉRIFIÉ champ par champ**                  | §4 — 34 modèles mappés sur 8 domaines 2-9, schéma lu intégralement [`schema.prisma`, 1914 l].                                                                                                                                                                                       |
| Le moteur Claude Opus 4.8 local répond en full performance sur un appel réel | ✅ **VÉRIFIÉ (e2e documenté + logique testée)** | Calendar validé e2e DEV : Opus 4.8 → calendrier §2-clean persisté tous gates, $0 (PR #233, MEMORY sess.21). Logique batch (`loadAllSnapshots`/`persist` + gates) couverte par les `batch.test.ts` du **1762 vert** [tool-output]. Infra batch prod activée (token + health ok/401). |
| Le plan maître est sans zone d'ombre, validé contre le CONTEXTE GLOBAL       | ✅ **FAIT**                                     | §7 (9 sessions ↔ domaines réels) + §9 (invariants §2/§21.5/IA-$0) + §1 (réalité datée).                                                                                                                                                                                             |

---

## 11. Backlog consolidé « 100× plus loin » + dettes connues

- **CI** : runs `Dependabot hono` en failure (dep dev-only via `@prisma/dev`) → triage override ou pin. _(Candidat jalon séparé.)_
- **Doc-hygiène** : `README.md` (en-tête status) figé à un état antérieur — la vérité courante vit dans `apps/web/CLAUDE.md` ; numérotation SPEC §26(changelog)/§30(réunions, absent)/§31(calendrier) prête à confondre → harmoniser les labels de jalon « §26 » un jour.
- **ADR-005 Calendrier → Accepted** : nécessite 1ᵉʳ run batch réel + validation Eliot §2 sur 5+ calendriers (0 avis marché).
- **Profilage IA** : smoke `onboarding-batch --dry-run` sur data réelle (taux de refus Opus 4.8 à observer).
- **Profilage IA — dettes** : (a) `questionText=''` → ✅ **RÉSOLU PR #240 (`cdbf0f7`, 2026-06-06)** — peuplé depuis `instrument-v1` au write (`appendAnswer`). (d) prompt « Instrument: **vv1** » (double `v`) → ✅ **RÉSOLU PR #203 (`fb9587d`, 2026-06-06)**. (b) `env.ANTHROPIC_MODEL` allowlist exclut `claude-opus-4-8` ([`env.ts:89`]) → ⏳ ouvert : touche l'invariant §9 (API payante) + exige les vrais tarifs Opus dans la pricing table ; le path bash prod ($0 Opus 4.8) est correct, donc §28 respecté en pratique. (c) re-profilage périodique (one-shot `@unique userId`) → ⏳ ouvert (`/spec`).
- **DS — contraste `--acc` sur fond `acc-dim`** (a11y WCAG 1.4.3, **app-wide ~44 fichiers**, pas une régression) : eyebrow/CTA `text-[var(--acc)]` = 3.15–3.23:1 < 4.5:1 ; fix = `--acc`→`--acc-hi` ([`globals.css:92`], « text-accent ») sur les eyebrows/CTA posés sur `acc-dim`. **Jalon DS dédié** (ne pas fixer un widget isolé → incohérence avec les voisins). UI polish lié : icône état `pending` du widget profil → `--t-3` (réserver l'accent au `ready`).
- **Tracking — axes §28 manquants (M8, « la seule directive restante » SPEC:1382, chacun un `/spec` + build dédié §18.4)** : (1) **suivi-formation** (placeholder UI seul [`dashboard/page.tsx`], jalon #4 séquence §21.6) ; (2) **analyse-marché déclarée** (booléen « as-tu fait ton analyse ? » conforme §2, 0 contenu) ; (3) **présence réunions §30** (PR #206 `/spec` en attente) ; (4) **émotion PENDANT le trade** (`Trade` n'a que `emotionBefore`/`emotionAfter`).
- **Backlog PR S2 — campagne landing 2026-06-06 (`origin/main`=`eb25d85`)** : ✅ **6 PRs landées+déployées prod (ok/ok/ok)** flux `strict:true` sérialisé : #200 (`a7aa16e`) · #202 (`868ea32`) · #205 (`9f959d5`) · #206 spec §30 (`68409b1` `--admin` docs) · #204 JWT tokenVersion revocation (`ac25b90`, migration `20260529150000` appliquée prod) · #201 validate-vs-instrument (`eb25d85`, conflit #240 résolu — #201 **subsume** #240). **Reste ouvert (DoD#2)** : #207 (J-M1 data) + #208 (J-M2 member), **à rebaser + merger AVEC le build J-M3 (admin: cron `generate-meetings` + `/admin/reunions` + `?tab=presence`) + J-M4 (engagement wiring), jamais à moitié** → persiste `model Meeting` → **ferme DoD#2**. SPEC §30 (foundation) désormais sur main.
- **Rapports IA** : outbox exactly-once (V2, touche weekly+monthly) ; observabilité coût.
- **Pré-trade** : extension corrélation aux 5 piliers (différenciateur Fxmily).
- **Track Record public** : drop des tables `PublicTrade*` dépréciées (runbook §21) une fois la sync standalone confirmée.
- **Sécurité infra** (Eliot, SSH) : firewall Hetzner → plages Cloudflare + SSH key-only + fail2ban (le scrub HEAD ne corrige pas l'historique git public).
- **V2 multi-admin** : `TradeAnnotation`/`AdminNote`/`TrainingAnnotation` → `onDelete: SetNull` + `adminId` nullable.

---

## 12. Hand-off — comment reprendre (§27)

**Au démarrage de toute session 2-9 :**

1. Lire **ce fichier** (état + plan maître + invariants §9) + le §domaine ciblé (§7).
2. Lire `SPEC.md §<N>` (intention produit) + la section `apps/web/CLAUDE.md` du jalon.
3. Vérifier l'état réel **avant d'agir** : `git log origin/main`, `gh run list` (CI verte ?), WebFetch `/api/health` (prod ok ?), Read des fichiers concernés.
4. Respecter §18.4 (1 session = 1 jalon) + tous les invariants §9.

**À la fin de toute session :** mettre à jour le §domaine (statut, ce qui a été poussé) + §11 (backlog) + §1 (snapshot daté si l'état global a bougé) ; écrire le détail atomique dans un topic-file MEMORY ; `/clear`.

**Session 1 — hand-off** : Fondations **consolidées** (non reconstruites — choix validé par Eliot). `PROJECT_STATE.md` créé comme fichier d'état canonique. Stack/data-model/archi/moteur-Claude documentés sur le réel + vérifiés (CI verte, prod ok/ok/ok). Les 8 domaines des sessions 2-9 sont **tous LIVE prod** ; leur travail futur = audit profond + durcissement + « 100× plus loin », jamais reconstruction.

**Session 2 — hand-off (Onboarding & Profilage & Tracking)** : audit profond du cœur d'absorption de données via **4 researchers parallèles** (onboarding / profilage IA / tracking quotidien / QCM+axes). Verdict : cœur **solide et LIVE** (signup race-safe, pipeline profilage 6-gates posture §2 tenue, tracking idempotent TZ-robuste, QCM mindset défensif). **Défaut #1 trouvé + corrigé** (confirmé par 2 audits indépendants) : le pipeline de profilage (entretien → Opus 4.8 → `MemberProfile` → `/profile`) était **construit mais orphelin** — `/dashboard` n'avait **0 lien** vers `/onboarding/interview` ni `/profile`, donc 0 % des membres atteignaient le « profilage initial » (§28) → §29 « profil » non tenu. **Jalon livré** : `ProfileStatusWidget` sur `/dashboard` (carbone `CalendarStatusWidget`, 4 états, frontend-only, 0 migration). Gate vert (type-check/lint/Vitest 1762/build) + e2e réel 3/3 + screenshots iPhone SE/15 + **4 audits Opus 0 TIER1** (ui + a11y SHIP-READY + code-reviewer + verifier 7/7). Backlog Session 2 → §11 (dette `questionText`, allowlist `opus-4-8`, contraste DS `--acc`→`--acc-hi` app-wide, axes M8 manquants).

**Session 2 — FINALISÉE (3 jalons LIVE prod)** : (1) **PR #235** widget profil **MERGÉ `d43ae2b`** + deploy SUCCESS + prod ok/ok/ok → le profilage est découvrable. (2) **PR #236** **émotion PENDANT le trade** (§22 « avant/pendant/après ») **MERGÉ `929cfdc`** — `Trade.emotionDuring`, migration additive **appliquée prod**, gate vert (Vitest **1768**), e2e réel **4/4** (full form submit), **4 audits Opus** (verifier 7/7). (3) **PR #238** **analyse-marché déclarée** (§28/§22) **MERGÉ `1bd66b9`** — `DailyCheckin.marketAnalysisDone Boolean?` (« as-tu préparé ton analyse de marché ? » au check-in matin ; posture §2 = le FAIT booléen, jamais le contenu), byte-mirror de `morningRoutineCompleted`, migration `20260605170000` **appliquée prod**, gate vert (Vitest **1770**), e2e réel **2/2** (ligne DB `marketAnalysisDone=true` asserted), **5 audits Opus 0 TIER1** (verifier 8/8). **Accounting honnête §29.2** : tous les axes buildables-seul désormais LIVE (trade avant/pendant/après, checkin + analyse-marché, habit, pre-trade, mindset, training, REFLECT, onboarding→profil) ; **réunions §30 EN CONSTRUCTION** (#206 spec + #207 data + #208 UI, non mergées) ; **suivi-formation déféré** (`docs/defer-suivi-formation-jalon4`). **CANON** : survoler `gh pr list` + `git branch -a` AVANT d'auditer « ce qui manque ». **CANON e2e** : ajouter un champ REQUIS à un wizard partagé casse TOUS les specs qui le pilotent → grep `tests/e2e` avant le 1er push (miss `smoke-tour.spec.ts` rattrapé par CI sur #238).

**Session 2 — durcissement + backlog (2026-06-06)** : re-vérif hardcore → S2 **PAS 100%** (mon « finalisée » précédent sous-pondérait le backlog PR — canon `gh pr list` réaffirmé). **Déployés prod (ok/ok/ok)** : #240 (`questionText`←instrument + JSDoc skip-fix + `tradeCloseSchema.strict()`, `cdbf0f7`) + #203 (« vv1 »→« v1 », `fb9587d`), gate vert Vitest **1770**. **Reste pour un vrai 100% S2** (cf. §11) : lander #200/#202/#205 (CLEAN, flux `strict:true`) ; rebaser+lander #201/#204/#206 ; **construire réunions §30 J-M3 (admin) + J-M4 (engagement) puis merger #207/#208 → ferme DoD#2** ; faire le scoring consommer les axes ignorés (DoD#3) ; `/spec` suivi-formation. Détail + conflict-map → mémoire `D--Fxmily/fxmily_session_2026-06-06_s2_hardening_pr_backlog.md`.

**Session 2 — campagne PR backlog landée (2026-06-06, `origin/main`=`eb25d85`)** : **6 PRs du backlog landées + déployées prod ok/ok/ok**, flux `strict:true` sérialisé (update-branch BEHIND→CI verte→squash→watch deploy→health après CHAQUE ; overlap CI/deploy canon sess.20 ; **jamais `--admin` sur du code**). Pre-merge review (4 sub-agents parallèles) = **4/4 SHIP 0 blocker**. Ordre : #200 `a7aa16e` (tests onboarding-batch) → #202 `868ea32` (a11y) → #205 `9f959d5` (e2e de-flake) → #206 `68409b1` (spec §30, `--admin` docs-pur, 0 deploy ; conflit SPEC.md résolu par script : §30 réunions + §31 Calendrier préservé + §32 Changelog renuméroté + Fin v1.7) → #204 `ac25b90` (**JWT tokenVersion revocation, sécu** ; migration `20260529150000` **appliquée prod** [log « All migrations successfully applied » 08:42:01Z] ; conflit runbook résolu : §24 calendrier préservé + §25 J4 renuméroté) → #201 `eb25d85` (validate answers vs instrument ; conflit code #240 résolu — #201 **subsume** #240 : résout+valide `item` du catalogue puis utilise `item.id`/`item.text`, closes aussi la dette `questionText` vide ; dédup import). **CANON résolution conflit** : merge main IN (pas rebase force-push) → résoudre → push normal (0 force-push) ; doc-conflits = script déterministe (0 transcription manuelle) ; code-conflit validé par **CI réelle** (Vitest+tsc) avant merge. **PICKUP next jalon (ferme DoD#2)** : `/clear` → « Construis réunions §30 J-M3 (admin) puis J-M4 (engagement) ; rebase #207/#208 ; merge le stack » — SPEC §30.8 (désormais sur main) découpe J-M1→J-M4 **jamais bundlés** (§18.4) ; `model Meeting`+`MeetingAttendance` migration **additive** (`prisma-migration-runner`) ; helper DST `localInstantToUtc` (`lib/weekly-report/week-window.ts:138`, PROUVÉ 8/8). Puis **scoring DoD#3** (consommer `marketAnalysisDone`/émotions trade/sommeil, pondération neutre & sûre) · **`/spec` suivi-formation** (interactif Eliot) · **Session 3** audit Espace membre (durcissement, PAS reconstruction).

---

_Fichier maintenu par la série 9-sessions. Toute affirmation y est datée et sourcée. En cas de conflit avec `SPEC.md`, SPEC.md gagne._
