# ADR-005 — Calendrier adaptatif : instrument v1 + data layer + isolation (§26)

- **Status** : Proposed (2026-06-03) — to be Accepted post-build J-C2→J-C4 + first real `/calendar-batch` run successful + Eliot validates the §2 posture (no market call) in 5+ generated calendars.
- **Date** : 2026-06-03
- **Author** : Eliot Pena (Fxmily) — design + posture validation
- **Scope** : §26 jalon J-C1 (data layer backend-first). J-C2 (batch pipeline), J-C3 (questionnaire wizard), J-C4 (display) build on this ADR.
- **Supersedes** : N/A
- **Related** : ADR-004 (Onboarding interview — instrument-versioning + Claude batch-local canon shared) · ADR-003 (Mark Douglas posture canon).

## Context

### Vision (master prompt §26, verbatim ≤30 mots — fair use FR L122-5)

> « Chaque membre dispose de SON calendrier, qu'il adapte à sa disponibilité (selon qu'il travaille ou est étudiant, etc.). Chaque semaine, un questionnaire d'organisation de la semaine lui permet de mettre à jour son calendrier, et cette mise à jour est réalisée automatiquement par Claude Opus 4.8 en LOCAL. »

Le calendrier organise le **TEMPS de pratique** du membre — sessions, entraînement/backtest, présence réunions (§30), check-ins quotidiens, révision Mark Douglas, repos. **PAS** de market timing, setups, ou prévisions (posture §2 — BLOQUANT).

### Posture invariante (SPEC §2 + §21.5/§27.7 isolation canon)

- ❌ ZÉRO conseil de marché / setup / tendance / prévision / paire à trader.
- ❌ Le snapshot envoyé à Claude exclut STRUCTURELLEMENT tout `realizedR` / `outcome` / `plannedRR` / `resultR` (firewall type-level + test anti-leak).
- ✅ Le calendrier organise le TEMPS, pas les trades. Le seul signal = la `priority` d'un bloc (poids visuel, jamais un score d'adhérence, jamais de streak shame — anti-Black-Hat Yu-kai Chou).
- ✅ Pipeline IA = batch local Claude Max via `claude --print` (canon V1.7+/V1.4/V2.4) — pas d'API Anthropic payante.

### Décision attendue J-C1

Quel modèle de données + quel instrument + quelle frontière d'isolation pour un calendrier hebdomadaire personnalisé, généré par Claude en local, sans jamais lire de P&L ?

## Decision

### 1. Instrument fermé v1 figé (9 items, ZÉRO free-text)

`lib/calendar/instrument-v1.ts` — 9 items `as const` immutables + `LONGITUDINAL-VALIDITY INVARIANT` (carbone V1.5 mindset §27.7). Items : profil (5 choix) · objectif sessions (entier 1-7) · dispo Lun-Ven (grille 3 slots/jour) · dispo week-end · sommeil (early/standard/late) · pic d'énergie (matin/aprem/soir) · engagement réunions §30 · focus pratique (live/backtest/mark_douglas/balanced) · contrainte optionnelle (voyage/examens/réduit/aucune).

**Q4 = AUCUN free-text V1** → 0 surface crisis/injection sur le formulaire (mirror MindsetCheck §27). Aucun import `safeFreeText` / `detectCrisis` / `detectInjection` sur le questionnaire — la surface n'existe pas par design.

### 2. Deux modèles, FK-free entre eux (snapshot-at-generation découplé)

`WeeklyScheduleQuestionnaire` (table `weekly_schedule_questionnaires`) + `AdaptiveCalendar` (table `adaptive_calendars`). Migration ADD-only `20260603120000_calendar_questionnaire` (2 enums + 2 tables + FK CASCADE `users` + index, safe 30 membres). Les deux uniques sur `(userId, weekStart)` (upsert idempotent).

**`AdaptiveCalendar` n'a AUCUNE FK vers `WeeklyScheduleQuestionnaire`** — décision tranchée sur ses mérites : le calendrier est un **artefact snapshot-at-generation**. Un edit ultérieur du questionnaire ne doit PAS réécrire l'historique d'un calendrier déjà généré ; les deux sont découplés volontairement. Le calendrier persiste `calendar_instrument_version` pour tracer quelle version d'instrument l'a nourri.

> ⚠️ **Correction du briefing de design** (`docs/jalon-calendrier-prep.md` §4) : ce découplage n'est PAS justifié par « MemberProfile ↛ OnboardingInterview ». C'est l'inverse — `MemberProfile` **A** une FK `interviewId @unique → OnboardingInterview onDelete:Restrict` (`schema.prisma`). Le découplage du calendrier tient sur sa propriété intrinsèque (snapshot figé), pas sur cette analogie inversée. §4 du doc a été corrigé.

### 3. Deux enums Postgres, chacun ancré à une colonne réelle

`CalendarSlot` (morning/afternoon/evening) + `CalendarBlockCategory` (live_trading/backtest/mark_douglas_review/checkin/rest/meeting/free).

> ⚠️ **Correction du briefing §4** : Prisma DROP silencieusement tout enum non référencé par une colonne. Pour que les 2 enums soient de vrais types Postgres (et pas du schéma mort), chacun est **ancré à une colonne réelle** : `WeeklyScheduleQuestionnaire.energyPeakSlot CalendarSlot` (le pic d'énergie EST un slot — naturel + admin-queryable) et `AdaptiveCalendar.primaryCategory CalendarBlockCategory?` (catégorie de bloc dominante de la semaine, dérivée au persist — résumé admin). Vérifié par `prisma-migration-runner` : les 2 `CREATE TYPE` sont bien émis dans la migration. `energyPeakSlot` est une projection typée de `responses.energyPeak` (le jeu complet versionné reste dans `responses` JSON — single source of truth longitudinale).

### 4. Snapshot count-only (§2/§21.5 isolation, prouvée par construction)

`lib/calendar/snapshot.ts` est un module **PUR** (no DB, no `Date.now()`, no `'server-only'`) qui définit le type `CalendarActivityCounts` (`{ tradesLast30d, checkinsLast14d, trainingSessionsLast14d, lastMindsetCheckDate }`) — **AUCUN champ P&L possible sans éditer ce type**. Le service (`service.ts`, server-only) fait les lectures count-only (`db.trade.count`, `db.dailyCheckin.count`, `db.mindsetCheck.findFirst`) et lit l'activité backtest via la **primitive sanctionnée `countRecentTrainingActivity`** (§21.5, count-only — la seule lecture training autorisée).

Test anti-leak dédié `test/anti-leak/calendar-isolation.test.ts` (carbone `training-isolation.test.ts`) : firewall statique sur `lib/calendar/**` + les 2 schemas calendrier (0 token P&L / 0 import scoring/analytics/trades-service) + bornage des 2 cross-imports sanctionnés (`countRecentTrainingActivity` only depuis `@/lib/training`, `pseudonymizeMember` only depuis `@/lib/weekly-report/builder`) + checks runtime (la payload n'expose que les 4 clés count-only ; `adaptiveCalendarOutputSchema.strict()` rejette un `realizedR` injecté).

> ⚠️ **Déviation du briefing §2** : `meetingsAttendedLast4w` est **ABSENT** en J-C1 — les modèles §30 `Meeting` / `MeetingAttendance` ne sont **pas sur `main`** (PR §30 ouverte, non mergée — vérifié `schema.prisma`). Le compteur sera **additif** quand §30 atterrira (champ ajouté au type + au service, zéro breaking change).

### 5. Sortie Claude — `adaptiveCalendarOutputSchema.strict()`

`lib/schemas/adaptive-calendar.ts` (carbone `weeklyReportOutputSchema`) : `{ weekStart, overview (100-300c), days[7]{ date, dayLabel, blocks[]{ slot, category, durationMin 15-120, label ≤60c, priority high/med/low } }, weeklyFocus (50-200c), warnings[] (0-3) }`. `.strict()` rejette les clés hallucinées ; `safeFreeText` + `containsBidiOrZeroWidth` appliqués sur chaque champ free-text **même sur l'output IA** (défense Trojan-Source). Validé DEUX fois (le batch J-C2 demande ce schéma à Claude puis re-parse).

### 6. weekStart = lundi Europe/Paris, server-authority (anti-flake PR#96)

`weekStart` est re-pinné en UTC-midnight via `parseLocalDate` au service AVANT le write `@db.Date` — JAMAIS `new Date().toISOString().slice(0,10)` ni un instant client. `lib/calendar/week.ts` (carbone `mindset/week.ts`) dérive le lundi Paris. Upsert `(userId, weekStart)` idempotent (re-soumission = correction).

### 7. Token batch séparé + rate-limit + 8 audit slugs (pré-déclarés)

`CALENDAR_ADMIN_BATCH_TOKEN` (env, ≥32 chars, refuse-by-default 503) + `calendarBatchLimiter` (token-bucket burst 10 / 1-per-5min) + `requireCalendarAdminToken` (503/401/429) — carbone V1.4 monthly. Rotation indépendante des tokens weekly/monthly. 8 audit slugs `calendar.*` pré-déclarés dans `AuditAction` (wirés J-C2/J-C3/J-C4, mirror onboarding pré-déclaration), PII-free strict (jamais `responses`, `schedule`, `pseudonymLabel`).

## Evidence base

- **Mark Douglas**, _Trading in the Zone_ (2000) — posture process > outcome ; le `weeklyFocus` du calendrier porte un principe psychologique, jamais un avis marché.
- **Yu-kai Chou**, _Actionable Gamification_ (Octalysis) — anti-Black-Hat : un outil d'organisation calme, pas un score d'adhérence ni un streak shame. Le seul signal est la `priority` (poids visuel).
- **Pattern Fxmily §21.5/§27.7** — isolation statistique prouvée par construction (type-level + firewall test + system prompt), canon V1.2 (training) / V1.5 (mindset) / V1.4 (monthly).
- **Canon batch local Claude Max** (V1.7 weekly / V1.4 monthly / V2.4 onboarding) — `claude --print`, abonnement Max, $0 API marginal, 9 ban-risk rules, human-in-the-loop.

## Alternatives considered + Why rejected

### Alt 1 — Note libre optionnelle sur le questionnaire (free-text)

**Rejected V1 (Q4)** : ouvrirait une surface crisis/injection + impliquerait `safeFreeText` + une bannière EU AI Act sur le formulaire. KISS V1 = instrument 100% fermé (mirror MindsetCheck). Re-considérer V2 (wire `safeFreeText` + crisis-detect comme V1.8 REFLECT) si la valeur est prouvée.

### Alt 2 — Grille horaire fine (par heure) au lieu de 3 slots/jour

**Rejected V1 (Q2)** : +friction de saisie, vocabulaire incohérent avec `CheckinSlot`. 3 slots (matin/aprem/soir) = KISS, suffisant pour organiser une semaine de pratique.

### Alt 3 — FK `AdaptiveCalendar → WeeklyScheduleQuestionnaire`

**Rejected** : un calendrier généré est un snapshot figé. Une FK ferait qu'un edit ultérieur du questionnaire « tirerait » sur l'historique du calendrier. Le découplage + `calendar_instrument_version` capture la provenance sans coupler les cycles de vie.

### Alt 4 — `CalendarBlockCategory` / `CalendarSlot` en TS/Zod uniquement (pas d'enum Postgres)

**Rejected** : le briefing demande 2 enums Postgres, et un enum non-ancré serait droppé par Prisma (schéma mort). Les ancrer à `energyPeakSlot` / `primaryCategory` donne de vrais types DB + des colonnes admin-queryables, sans contrivance (les deux colonnes sont sémantiquement justifiées).

### Alt 5 — Snapshot lisant le P&L réel (winrate, R) pour « mieux » organiser

**Rejected — BLOQUANT §2** : violerait la posture (le calendrier deviendrait un conseil dérivé de la performance). Le snapshot lit UNIQUEMENT des compteurs d'activité (combien / quand le membre pratique), jamais comment il performe. Type-level + firewall test l'empêchent.

### Alt 6 — API Anthropic payante

**Rejected** : Eliot refuse catégoriquement (`SPEC.md` §1177/§1237). Batch local Claude Max, $0 marginal. Migration `Live*Client` Sonnet 4.6 candidate V2 si scaling > 100 membres + accord coût.

## Consequences

### Pros

- ✅ Posture §2 prouvée par construction (type-level `CalendarActivityCounts` sans P&L + firewall test + system prompt J-C2).
- ✅ Instrument v1 figé = longitudinal-validity garantie (§27.7 INVARIANT).
- ✅ Idempotence upsert `(userId, weekStart)` + snapshot découplé (re-runs safe).
- ✅ Pseudonymisation V1.5.2 (8-char hex SHA-256 + salt) — Anthropic ne voit jamais email/userId.
- ✅ Token batch séparé (rotation indépendante) + rate-limit + audit PII-free.
- ✅ Coût $0 marginal (Claude Max local).
- ✅ 2 enums Postgres réels (vérifiés émis) + colonnes admin-queryables.

### Cons / Risks

- ⚠️ `meetingsAttendedLast4w` absent jusqu'au merge §30 (le calendrier sous-estime l'engagement réunions en attendant — additif, non bloquant).
- ⚠️ Instrument v1 figé = bump `v2` + note de migration pour tout changement d'items.
- ⚠️ `energyPeakSlot` est une projection dénormalisée de `responses.energyPeak` (légère redondance assumée pour ancrer l'enum + query admin).
- ⚠️ Manual trigger Eliot (J-C2) = délai humain entre questionnaire et calendrier généré (acceptable V1).
- ⚠️ Le snapshot lit le COUNT de trades réels (`db.trade.count`) — count-only, jamais P&L ; à re-confirmer à chaque audit que personne n'ajoute un `select` de `realizedR`.

### Trigger conditions pour status `Accepted` (post-build J-C4)

- ✅ J-C2/J-C3/J-C4 mergés + premier `/calendar-batch` réel réussi.
- ✅ Eliot valide la posture §2 dans 5+ calendriers générés (0 market call, 0 setup, 0 prévision).
- ✅ 0 `calendar.batch.crisis_detected` HIGH non géré.
- ✅ Test anti-leak `calendar-isolation` vert sur main + 3 audits J-C4 (a11y + ui-designer + security-auditor) 0 TIER 1.

### Trigger conditions pour `v2` bump (longitudinal-validity §27.7 cassée intentionnellement)

- Ajout/retrait d'un item ou d'une option de l'instrument.
- §30 mergé → ajout du compteur `meetingsAttendedLast4w` (additif au snapshot — pas un bump d'instrument, mais une note).
- Passage à une grille horaire fine (Q2 override) ou à une note libre (Q4 override).

## Honesty disclaimers

- **`meetingsAttendedLast4w` non implémenté en J-C1** — les modèles §30 ne sont pas sur `main`. Documenté §4 ci-dessus + dans `snapshot.ts`. Ne pas prétendre que le calendrier connaît la présence réunions tant que §30 n'est pas mergé.
- **`AdaptiveCalendar.primaryCategory` nullable** — calculé au persist (J-C2). En J-C1, aucune ligne n'est persistée par un batch réel ; la colonne existe, prête.
- **Chiffres de coût Claude** — `costEur` tracké en `Decimal(10,6)` mais à $0 marginal (Claude Max local). Le tracking sert l'observabilité, pas une facture.
- **Le snapshot lit `db.trade.count`** — c'est une lecture du COUNT de trades réels (activité), pas une lecture de P&L. La distinction est BLOQUANTE : un futur `select: { realizedR }` serait un breach §2 attrapé par le test anti-leak.

## ADR-005 audit trail

- **2026-06-03** — Proposed (Eliot Pena, sess.17 J-C1 build). Data layer + instrument v1 + isolation shippés ; J-C2→J-C4 à venir (1 jalon = 1 session).
- **TBD** — Accepted post-build J-C4 + first cohort calendar validation.
- **TBD** — Superseded by ADR-XXX (next instrument version bump v2).

## Related ADRs

- **ADR-004** (2026-05-28 Proposed) — Onboarding interview instrument v1 + Claude batch pipeline. **Instrument-versioning canon + batch-local Claude Max canon shared** ; le calendrier réutilise le pattern `as const` + LONGITUDINAL-VALIDITY INVARIANT + pseudonymisation + token batch séparé.
- **ADR-003** (2026-05-27 Accepted) — Pre-trade circuit breaker. **Mark Douglas posture canon shared** (process > outcome) ; le `weeklyFocus` du calendrier porte un principe psychologique, jamais un avis marché.
