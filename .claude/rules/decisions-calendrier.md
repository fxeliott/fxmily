---
paths:
  - 'apps/web/src/app/calendrier/**'
  - 'apps/web/src/lib/calendar/**'
---

# Decisions verrouillees — calendrier

Extrait de `apps/web/CLAUDE.md` le 2026-08-04. Ces decisions sont OPPOSABLES :
ce sont des landmines anti-regression, pas de l historique. Le frontmatter
`paths:` ci-dessus les charge uniquement quand on touche les fichiers concernes
— sans lui, elles seraient chargees a chaque lancement et la scission
n economiserait rien. Contexte complet du jalon : `docs/web/jalons-history.md`.

## §26 — Calendrier adaptatif J-C3 (questionnaire wizard UI membre) (livré 2026-06-03, PR [#231](https://github.com/fxeliott/fxmily/pull/231) `6a5adaf`)

### Décisions verrouillées (NE PAS re-casser)

- **Redirect `/dashboard?done=questionnaire` (PAS `/calendrier`)** — divergence brief délibérée + JSDoc-documentée : `/calendrier` est la surface J-C4 **non construite** (404erait en prod si J-C3 merge avant J-C4). Le widget dashboard porte la confirmation ; J-C4 pourra re-pointer.
- **weekStart server-authority** : recomputé `currentParisWeekStart()`, le hidden client est ignoré (jamais lu par `getString`). `submitWeeklyScheduleQuestionnaire` re-pin via `parseLocalDate` (double filet).
- **`coerceBool`** : lit la string littérale (`'true'/'on'/'1'/'yes'`→true, reste→false), jamais `z.coerce.boolean()`. Toggle absent/`File` → false (fail-safe : indisponibilité, grille all-false légitime).
- **`constraint` vide → `undefined` → `.default('none')`** (un `''` n'est PAS un membre d'enum, le passer casserait — `...(constraintRaw ? {constraint} : {})`).
- **0 free-text** (instrument fermé §26 Q4) → AUCUN import `safeFreeText`/`detectCrisis`/`detectInjection`, **pas de bannière EU AI Act** sur CE formulaire (elle est en J-C4 sur le calendrier généré). Posture §2 : organise le TEMPS, jamais le marché (aucun import real-edge P&L).
- **DS-v2 lime NEUTRE** — jamais `.v18-*`/`--v18-*` (REFLECT), `--cy*` (training), ni le pattern bugué `shadow-[0_0_..._var(--acc-glow)]` (`--acc-glow` = box-shadow complet → `boxShadow:'var(--acc-glow)'`). `V18_SPRING`/`V18_SPRING_TIGHT` = constantes timing SSOT, pas tokens thème.
- **`calendar-step-progress.tsx` = clone dédié** (PAS de réutilisation de `mindset-step-progress` — data-slot `calendar-step-progress`, aria-label « Progression du questionnaire »).
- **Pas de `removeItem` localStorage explicite au submit** (carbon mindset identique) : le redirect navigue ailleurs + gating week/version + prefill serveur authoritatif rendent le draft inoffensif ; « draft-wins same-week » = canon REFLECT/V1.3.
- **db-helpers `cleanupTestUsers`** : `weeklyScheduleQuestionnaire`+`adaptiveCalendar` `deleteMany` AVANT `user.deleteMany` — déjà présent J-C1, pas re-touché.

## §26 — Calendrier adaptatif J-C2 (pipeline batch local Claude $0) (livré 2026-06-03)

### Gates `persistGeneratedCalendars` (ordre exact — NE PAS réordonner)

`error` field traité EN PREMIER → (1) `parseLocalDate(weekStart)` → `invalid_week_window` (whole-batch, `errors=results.length`) · (2) active-user Set → `unknown_or_inactive_user` (anti forged userId) · (3) `WeeklyScheduleQuestionnaire` existe pour (userId,weekStart) → `calendar.batch.skipped` reason `no_questionnaire` (**gate CALENDAR-ONLY**, pas d'analog weekly/monthly) · (4) `adaptiveCalendarOutputSchema.safeParse` → `invalid_output` · (5) `detectCrisis(corpus IA complet)` → skip + `crisis_detected` + Sentry `reportError`(high)/`reportWarning`(medium) (`=== 'high' || === 'medium'`, PAS `>=` — `CrisisLevel` est une union non ordonnée) · **(5b) `detectAMFViolation(corpus IA complet)`** → skip + `amf_violation` + `reportWarning` · (6) `persistAdaptiveCalendar` (J-C1, dérive `primaryCategory`).

## §26 — Calendrier adaptatif J-C2 (pipeline batch local Claude $0) (livré 2026-06-03)

### Décisions verrouillées (NE PAS re-litiger)

- **Gate 5b AMF n'est PAS un carbon weekly/monthly** : NI le weekly NI le monthly n'ont de gate AMF (vérifié). Le SEUL carbon AMF du repo = `lib/onboarding-interview/safety.ts` ; on réutilise **uniquement** `detectAMFViolation` (couche AMF-regex : langage conseil marché/réglementé), PAS `detectClinicalLanguage` ni `validateEvidenceSubstrings` (= onboarding-only). Le doc `docs/jalon-calendrier-prep.md §7` a été corrigé (son "(5) check AMF-style … carbone" était imprécis).
- **Corpus crisis + AMF = output IA COMPLET** : `composeCalendarOutputCorpus` concatène `overview + weeklyFocus + warnings + tous les dayLabels + tous les block labels` — pas seulement `warnings` (§2 BLOQUANT, un avis marché peut atterrir n'importe où). Plus profond que le corpus weekly (summary/risks/recos).
- **Slug dédié `calendar.batch.amf_violation`** (pas réutiliser `crisis_detected`) : une violation de posture est un signal de sécurité distinct d'une détresse — ne pas polluer le signal crisis (qui escalade `reportError` sur HIGH). Mirror `onboarding.batch.amf_violation`.
- **Model persisté = sentinel `claude-code-local` (cost $0)** : la bash n'envoie PAS de champ `model` → `entry.model` undefined → fallback `CLAUDE_CODE_LOCAL_MODEL`. `PRICING_KEYS = [claude-opus-4-8, claude-sonnet-4-6, claude-code-local]` accepte le binaire réel si jamais envoyé. `claude-opus-4-8` pricé $0 (binaire local Max) — c'est CORRECT pour son seul usage réel (le batch local). Sonnet gardé avec pricing réel pour un futur path API payant (ADR-005 Alt 6).
- **Persist request = `{ weekStart, results }`** (PAS de `weekEnd` — `AdaptiveCalendar` n'a pas de colonne weekEnd, l'output `days[7]` couvre la semaine).
- **`calendarInstrumentVersion`** passé à `persistAdaptiveCalendar` = la version du questionnaire qui a nourri (lue dans la Map `instrumentVersionByUser` du gate 3), pas une constante.
- **Pull n'a pas de body-cap** (POST sans body, envelope produite serveur) — correct par design ; `calendarBatchLimiter` protège du flood.

## §26 — Calendrier adaptatif J-C4 (affichage `/calendrier`) — DERNIER jalon §26 (clôt 4/4) (livré 2026-06-03)

### Décisions verrouillées (NE PAS re-casser)

- **`meeting` = NEUTRE (`C.t2`), PAS amber** — l'amber est réservé au rail
  warnings (`--warn`) ; un bloc réunion amber se lirait comme une « caution » et
  rimerait visuellement avec les warnings (collision ui audit T2). La category
  est TOUJOURS conveyed en TEXTE → la couleur est décorative. Palette : 3 hues
  pour les 3 pratiques cœur (live=acc/blue, backtest=cy/cyan, mark_douglas=ok/
  green) + neutres pour meeting/checkin/rest/free. JAMAIS `C.bad` (rouge).
- **Disclosure stamp au 1ᵉʳ affichage UNIQUEMENT** (membre) ; le panel admin ne
  stampe jamais. `markAdaptiveCalendarDisclosureShown` est idempotent
  (`updateMany WHERE aiDisclosureShownAt IS NULL`) ; le service stampe la ligne,
  la PAGE émet le slug `calendar.disclosure.shown`. **L1 accepté** (audit
  double-émission TOCTOU sous 2 GET concurrents = au pire 1 log best-effort
  dupliqué, stamp DB non corrompu, échelle 30 membres — security-auditor verdict
  « acceptable V1 », mirror at-least-once monthly).
- **Admin tab render guard `tab === 'calendar'`** (pas `&& calendar !== null`) :
  ici `null` = état légitime (pas de calendrier) → le panel rend un EmptyState
  honnête. Le fetch ne tourne que si `tab === 'calendar'`, pas de collision
  stale-null.
- **DS-v2 lime NEUTRE** — jamais `.v18-*` (REFLECT), `--cy*` en chrome (cyan
  uniquement comme hex category `backtest` + dans `<AIGeneratedBanner>` propre),
  ni le pattern bugué `shadow-[0_0.._var(--acc-glow)]`.
- **Page `max-w-3xl`** (carbon debrief-mensuel) + grille `sm:grid-cols-2` (pas de
  strip 7-colonnes — chips riches en texte). `force-dynamic`.
