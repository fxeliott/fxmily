# Jalon prep — Calendrier personnel adaptatif (master prompt §26)

> **Phase DESIGN (doc-only).** Ce briefing spécifie une feature GREENFIELD (aucune
> section SPEC.md existante). Il sert à builder backend-first (J-C1→J-C4) sur un
> design validé. Conçu par sub-agent `feature-dev:code-architect` (2026-06-03),
> grounded sur les patterns Fxmily réels (cf. `file:line` cités).
>
> **Numérotation** : pas de section SPEC.md numérotée ici pour éviter la collision
> avec la PR réunions #206 (§30, open). Quand on build, on ajoutera la section SPEC
> (§31+) + on formalisera **ADR-005** (Proposed→Accepted). Décisions de design = §«Décisions» ci-dessous.

## 1. Vision (master prompt §26, verbatim ≤30 mots — fair use FR L122-5)

« Chaque membre dispose de SON calendrier, qu'il adapte à sa disponibilité (selon qu'il
travaille ou est étudiant, etc.). Chaque semaine, un questionnaire d'organisation de la
semaine lui permet de mettre à jour son calendrier, et cette mise à jour est réalisée
automatiquement par Claude Opus 4.8 en LOCAL. »

**Ce que le calendrier organise** : le TEMPS de pratique du membre — sessions de trading à
respecter, entraînement/backtest, présence réunions (§30), check-ins quotidiens, révision
Mark Douglas, sommeil/routine. **PAS** du market timing, setups, ou prévisions (posture §2 — BLOQUANT).

## 2. Posture §2 (invariant BLOQUANT)

ZÉRO conseil de marché. Le system prompt Claude (`lib/calendar/prompt.ts`,
hardcodé repo-side, non-substituable sans commit — propriété de sécurité carbone
`weekly-report/prompt.ts`) interdit explicitement : analyse de marché, setups,
tendances, prévisions, paires à trader. Il organise le TEMPS, pas les trades.

**Isolation données** : le snapshot envoyé à Claude exclut structurellement tout
`realizedR`/`outcome`/`plannedRR` (§2 + firewall §21.5). Il lit uniquement des
**compteurs d'activité** (count-only, carbone `countRecentTrainingActivity`) pour
adapter l'organisation : `{ tradesLast30d, checkinsLast14d, meetingsAttendedLast4w,
lastMindsetCheckDate, trainingSessionsLast14d }`. Test anti-leak dédié
(`test/anti-leak/calendar-isolation.test.ts`, carbone `training-isolation.test.ts`) :
glob-scan que `lib/calendar/**` n'importe jamais un module real-edge.

## 3. Architecture (3 concerns verticalement séparés)

1. **Questionnaire hebdo fermé** (instrument versionné, 0 free-text V1 = 0 surface
   crisis/injection, carbone `MindsetCheck` §27) — collecte profil + dispo de la
   semaine à venir.
2. **Pipeline batch local Claude** ($0 API, `claude --print`, abonnement Max) — lit
   questionnaire + résumé profil onboarding + compteurs activité → génère un planning
   hebdo structuré (JSON Zod-validé). Carbone EXACT de `weekly-report/batch.ts` +
   routes admin token-gated. **Token séparé** `CALENDAR_ADMIN_BATCH_TOKEN` (rotation
   indépendante, carbone `requireMonthlyAdminToken`).
3. **Surface calendrier read-only** membre (`/calendrier`) avec `<AIGeneratedBanner>`
   (EU AI Act 50(1), 7ᵉ site prod) + anti-Black-Hat (pas de score d'adhérence, pas de
   streak shame, pas de rouge "pas encore fait").

## 4. Modèle de données (J-C1)

Migration ADD-only `20260604_calendar_questionnaire` (2 tables, safe 30 membres,
rollback runbook §N+1).

- **`WeeklyScheduleQuestionnaire`** — `userId` (cascade User), `weekStart @db.Date`
  (lundi Europe/Paris), `instrumentVersion`, réponses (enums + `Json` pour la grille
  dispo 7 jours × 3 slots), unique `(userId, weekStart)` upsert idempotent. 0 free-text V1.
- **`AdaptiveCalendar`** — `userId` (cascade), `weekStart @db.Date`, `schedule Json`
  (sortie Claude validée), cost tracking (`claudeModel`, `inputTokens`, `outputTokens`,
  `costEur Decimal(10,6)`), `aiDisclosureShownAt`, `calendarInstrumentVersion`. Unique
  `(userId, weekStart)`. Pas de FK vers le questionnaire (snapshot-at-generation découplé,
  carbone `MemberProfile` ↛ `OnboardingInterview`).
- Enums : `CalendarBlockCategory` (`live_trading`/`backtest`/`mark_douglas_review`/
  `checkin`/`rest`/`meeting`/`free`), `CalendarSlot` (`morning`/`afternoon`/`evening`).

## 5. Questionnaire — instrument v1 figé (9 items, fermé)

`lib/calendar/instrument-v1.ts`, `as const` immuable + `LONGITUDINAL-VALIDITY INVARIANT`
(version bump pour toute modif, carbone onboarding/mindset). Items :
profil (trader_en_formation/etudiant/salarie/independant/autre) · objectif sessions (1-7) ·
dispo Lun-Ven (3 slots/jour, JSONB) · dispo week-end · sommeil (early/standard/late) ·
pic d'énergie (matin/aprem/soir) · engagement réunions (§30) · focus pratique
(live/backtest/mark_douglas/balanced) · contrainte optionnelle (voyage/examens/réduit/aucune).
Tout enum/booléen/numérique → 0 `safeFreeText`/crisis/injection nécessaire.

## 6. Sortie Claude — `adaptiveCalendarOutputSchema.strict()`

`{ weekStart, overview (100-300c), days[7]{ date, dayLabel, blocks[]{ slot, category,
durationMin (15..120), label (≤60c), priority high/med/low } }, weeklyFocus (un principe
Mark Douglas, 50-200c), warnings[] (0-3, calmes/ambre, jamais alarmistes) }`. `.strict()`
rejette les clés hallucinées ; `safeFreeText` post-parse en défense (même si output IA).

## 7. Pipeline batch (J-C2) — carbone `weekly-report/batch.ts`

- Routes `POST /api/admin/calendar-batch/{pull,persist}` gardées par `requireCalendarAdminToken`
  (503/429/401). `pull` → `CalendarBatchPullEnvelope` (systemPrompt + outputJsonSchema
  embarqués). `persist` → 6 gates : (1) active-user (anti forged userId) · (2) questionnaire
  existe pour (userId,weekStart) · (3) Zod `.strict()` · (4) `detectCrisis(overview+focus+warnings)`
  → skip+audit+Sentry si HIGH/MEDIUM (carbone V1.7.1, output IA) · (5) check AMF-style sur
  warnings · (6) upsert `(userId, weekStart)`.
- `loadAllSnapshotsForCalendarGeneration` : membres active + ont un questionnaire ce
  weekStart + n'ont pas déjà un calendrier (idempotency). 5 queries count-only (isolation).
  `pseudonymizeMember` au snapshot.
- `ops/scripts/calendar-batch-local.sh` (carbone `weekly-batch-local.sh`) : 9 ban-risk rules
  (jitter 60-120s, `claude` officiel only, fresh context `--max-turns 1`, human-in-the-loop),
  skip si `hasQuestionnaire===false` (0 token). `.claude/commands/calendar-batch.md`.
- `profileSummary` (free-text IA de l'onboarding) wrappé `wrapUntrustedMemberInput`
  (`lib/ai/prompt-builder.ts:86`) avant embed — seule free-text atteignant Anthropic.

## 8. UI (J-C3 questionnaire + J-C4 affichage)

- **J-C3** : `components/calendar/questionnaire-wizard.tsx` (4 steps, fermé, carbone
  `MindsetCheckWizard` : `useActionState` + hidden inputs + localStorage draft + APG roving
  tabindex + Framer `m.*` + `useReducedMotion`). Server Action `app/calendar/questionnaire/actions.ts`
  (auth + status active + Zod + upsert + audit PII-free + redirect `/calendrier?done=questionnaire`).
  Widget statut sur `/dashboard` (CTA questionnaire si non rempli).
- **J-C4** : `app/calendrier/page.tsx` 3 états (pas de questionnaire → CTA · rempli sans
  calendrier → "génération en cours, reviens lundi" · généré → affichage). `<AIGeneratedBanner>`
  AVANT les blocs. `components/calendar/{week-view,calendar-overview,calendar-warnings}.tsx`
  (grille 7j color-codée par category, mobile-first, anti-Black-Hat). Admin read-only
  `?tab=calendar` dans `/admin/members/[id]`.

## 9. Séquence de build (4 jalons, 1 = 1 session /clear — §18.4)

- **J-C1 data layer** : Prisma + migration + Zod schemas + instrument-v1 + snapshot (pur) +
  service + audit slugs (8) + env/admin-token/rate-limit/db-helpers patches + runbook rollback
  - Vitest TDD (schema 15+ / snapshot 10+ / service 8+ / anti-leak). Backend-first, 0 UI.
- **J-C2 pipeline** : prompt + pricing + batch + 2 routes admin + bash orchestrator + slash
  command + Vitest TDD (batch 10+ / routes 6+ chacune).
- **J-C3 questionnaire UI** : wizard + Server Action + page + dashboard widget + E2E Playwright
  (auth gate + CAPTURE + RENDER, scar GG-CI : pas d'import `server-only` en e2e).
- **J-C4 affichage** : week-view + overview + warnings + page 3-états + admin panel + 3 audits
  parallèles (a11y + ui-designer + security-auditor) + Playwright 3-états + visual smoke.

## 10. Décisions de design (mes défauts — VALIDE/OVERRIDE async sur la PR)

| #   | Question              | Mon défaut (recommandé)                                                         | Alternative                                     |
| --- | --------------------- | ------------------------------------------------------------------------------- | ----------------------------------------------- |
| Q1  | Cadence questionnaire | Hebdo (dim→lun 09:00), carbone WeeklyReview/MindsetCheck                        | "Quick update" 3-Q any time (V2)                |
| Q2  | Granularité dispo     | 3 slots/jour (matin/aprem/soir), KISS + vocab `CheckinSlot`                     | Grille horaire (+friction, V2)                  |
| Q3  | Timing batch          | Lundi matin, Eliot lance le script (carbone dimanche weekly)                    | Auto depuis profil seul si pas de questionnaire |
| Q4  | Free-text V1          | AUCUN (instrument fermé) → 0 crisis/injection/EU-banner sur le formulaire       | Note libre optionnelle (V2, wire safeFreeText)  |
| Q5  | Nom de route          | `/calendrier` (FR, cohérent `/debrief-mensuel`) + `/calendar/questionnaire/new` | `/agenda`, `/semaine`                           |

**Posture produit** : calendrier = outil d'organisation calme, pas un score. Le seul signal =
`priority` des blocs (poids visuel, pas rouge). Pas de "X/7 jours respectés" sur la page calendrier
(ça appartient au check-in/review, pas au plan). Anti-Black-Hat strict (Yu-kai Chou).

## 11. Risques / pièges

- **TZ drift** : `weekStart` = `parseLocalDate(lundi Paris)` → UTC midnight, server-authority,
  jamais client (scar PR#96). Jamais `.toISOString().slice(0,10)`.
- **Idempotency re-run** : double filet (loader skip déjà-généré + upsert).
- **Isolation §2/§21.5** : 2 couches (type-level `CalendarActivityCounts` sans P&L + test
  anti-leak + system prompt). NE JAMAIS ajouter un champ P&L au snapshot.
- **Claude $0** : si binaire `claude` exit≠0 → entry `{error}` → gate skip + `reportWarning` ;
  membre voit "génération en cours", pas de crash.
- **YAGNI V1** : pas de sync Google Calendar, pas de notifs par bloc, pas d'édition membre du
  plan, pas de comparaison plan-vs-exécution. V2 si la valeur V1 est prouvée.

## 12. Pickup prompt (build session, après /clear + validation des 5 Q)

```
PROJET FXMILY — build Calendrier adaptatif J-C1 (data layer backend-first).
Lire : ce doc (docs/jalon-calendrier-prep.md) + ~/.claude/CLAUDE.md + worktree CLAUDE.md +
apps/web/CLAUDE.md (patterns batch/instrument/checkin) + MEMORY.md D--Fxmily.
Brancher off origin/main À JOUR (fetch ; #225/#226/#227 peut-être mergées). Valider d'abord
les 5 décisions §10 (Eliot a-t-il override ?). Puis J-C1 strict (Prisma + migration + Zod +
instrument-v1 + snapshot pur + service + audit + tests TDD), backend-first, 0 UI. Formaliser
ADR-005 (Proposed). Gate format+lint+tc+build + prisma-migration-runner (audit migration) +
verifier. PR sans merge. 1 jalon = 1 session, /clear avant J-C2.
Posture §2 : ZÉRO conseil trade, le calendrier organise le TEMPS de pratique.
```
