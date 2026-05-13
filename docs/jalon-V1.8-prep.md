# V1.8 REFLECT — Pickup prompt opérationnel (post-V1.7.2 LIVE prod)

> Brief généré 2026-05-13 fin de session V1.7.2 follow-up + V1.8 prep.
> **Pré-requis vérifié** : V1.7.2.1 LIVE mergée main HEAD `5beb9b9` (post-#44 resend + #47 commitlint). Smoke /api/admin/weekly-batch/pull empirique : HTTP 200 + 7780 bytes envelope JSON avec data réelle (2026-05-13 14:30 UTC via SSH hetzner-dieu).
> **Synthèse 5 subagents** : researcher (trader psych state-of-art 2024-2026) + code-reviewer (Prisma 7) + dependency-auditor (8 PRs) + planner (ultrathink V1.8 plan) + performance-profiler (V1.7.2 coverage stress).

## Contexte court

V1.8 = **REFLECT module member-facing**. Suite logique post-V1.7.2 (admin batch IA LIVE).
4 items Must (Trade.tags + WeeklyReview + ReflectionEntry CBT + outcomeR note doc). **~11h dev = 1 session pleine**.

**Distinction critique** vs V1.7.2 :

- V1.7.2 `WeeklyReport` : SQL `weekly_reports`, generated par /sunday-batch admin, viewed par Eliot dans `/admin/reports`. **Posture admin / observabilité cohorte**.
- V1.8 `WeeklyReview` : SQL `weekly_reviews` NEW, generated par chaque membre lui-même (UI wizard `/review/new`), viewed par membre dans `/journal/weekly-review`. **Posture introspection member-owned**.
- Role-based access : `session.user.role === 'admin'` (V1.7.2) vs `session.user.id === review.userId` (V1.8 member-owned).

## TL;DR état LIVE prod 2026-05-13 fin session pickup

- **main HEAD** : `5beb9b9` (post #44 + #47 squash merges, Deploy en cours async)
- **Image prod** : `ghcr.io/fxeliott/fxmily:1925c5b9...` (à confirmer après Deploy workflow)
- **Vitest baseline** : 848/848 verts (cible V1.8 : 887)
- **Stack V1 LIVE** : V1.5 + V1.5.2 + V1.6 polish + V1.6 extras + V1.7 prep dormant + V1.7 local Claude batch + V1.7.1 wires ACTIFS + V1.7.2 HTTP migration LIVE end-to-end + V1.7.2.1 hotfix pseudonym runtime
- **Routes V1.7.2 LIVE prod validées empiriques** :
  - `/api/admin/weekly-batch/pull` : HTTP 200, 7780 bytes envelope (smoke 2026-05-13 14:30 UTC)
  - `/api/admin/weekly-batch/persist` : LIVE (smoke 5 axes auth+empty+JSON+Zod+405 GET, validation session R5 précédente)
- **EU AI Act compliance débloqué** : Eliot peut tester `/sunday-batch` end-to-end avec `FXMILY_ADMIN_TOKEN` exporté (~10 sem avant deadline 2 août 2026, €15M / 3% CA Article 99(4)).
- **9 ban-risk rules V1.7.2** : verbatim documentées dans `apps/web/CLAUDE.md:2303-2317`. Toutes à forward-porter V1.8 si applicable.

## 🛑 Pré-requis Eliot non-déléguables AVANT démarrer V1.8

3 décisions produit M4/M5/M6 du master V2 §27 toujours **BLOQUANTS V1.8+** :

### M4 — LA métaphore Fxmily

WHOOP = coach fitness. Headspace = guide méditation. Calm = bedside companion. **Fxmily = ?**

Options (interview `/spec` ou directement) :

- A. "Le carnet du trader discipliné" (passive, journal)
- B. "Ton coach process en arrière-plan" (athletic mindset, Steenbarger)
- C. "Le miroir de ton exécution" (introspection, Mark Douglas)
- D. "Ton scoring de discipline mesurable" (data-driven, dashboard)

**Default recommandé** : C "Le miroir de ton exécution" (cohérent posture Mark Douglas + REFLECT V1.8 + WeeklyReview intent).

### M5 — LE rituel quotidien central

**Quand le membre ouvre Fxmily chaque jour, quoi de central ?**

- A. Morning check-in (LIVE V1 J5)
- B. Pre-trade modal (avant session, plan + risque max)
- C. Post-trade reflection (immédiat après chaque trade, 30s)
- D. Evening recap (20-22h, gratitude + leçon)

**Default recommandé** : A (LIVE, validé V1) + extension V1.8 D evening recap intégrée à WeeklyReview wizard dimanche.

### M6 — LE wow moment

**Quel moment fait dire au membre "wow, ça vaut le coup d'utiliser Fxmily" ?**

- A. Rapport hebdo IA dimanche soir personnel (LIVE V1.7.2)
- B. Pattern detection auto ("revenge trade détecté 3 fois cette semaine")
- C. Score discipline qui grimpe semaine après semaine (LIVE V1)
- D. Fiche Mark Douglas qui arrive AU BON MOMENT après 3 pertes (LIVE V1)
- E. Coach Eliot debrief 1-1 trimestre (V2.0 DEBRIEF)

**Default recommandé** : A (LIVE V1.7.2 — valorisable immédiatement avec email digest amélioré V1.9).

⚠ **Sans M4/M5/M6 tranchés**, V1.8 peut ship mais l'attachement émotionnel cohorte restera faible. À trancher AVANT V1.9.

## Knowledge absorbed (Round 2 web research 2024-2026 — researcher subagent)

### Steenbarger 2025 reverse-journaling (solution-focused brief therapy)

- **Pivot 2025 confirmé** : Steenbarger publie février 2025 _Positive Trading Psychology_ — explicitement solution-focused. Post TraderFeed décembre 2025 (SMB Summit) : "bring your best and your worst… identify what you did really well and how you did it" — pattern reverse-journaling pur.
- **Findings actionables WeeklyReview UI** :
  1. Question obligatoire "Qu'as-tu fait de bien cette semaine et comment tu l'as fait ?" (AVANT les fix-the-flaws)
  2. Champ `bestPractice` séparé (pas P&L — process)
  3. Banner explicite "passion → purpose" — leverage strengths, pas réparer faiblesses uniquement

### CBT 4 colonnes (validation clinique trader-adaptation)

- **Validation empirique des thought records** : RCT n=100 (ScienceDirect cortisol Trier Social Stress Test), N=1052 ado (Project RE-THINK JMIR 2023-2024), Review JMIR Mental Health 2025 (14 études chatbots CBT).
- **Variantes documentées** : Beck (5 col), Ellis ABC, simplifié 4 col (situation/pensée/émotion/comportement).
- **Gap critique** : aucune RCT trader-spécifique trouvée. Posture honnête à tenir dans UI : "inspired by Beck/Ellis CBT, adapted for trading context, **not clinically validated for trader population**".
- **Structure ReflectionEntry V1.8 retenue** : Ellis ABC + Disputation (A/B/C/D), pas Beck 5-cols (over-engineering V1.8).

### Mark Douglas updates 2024-2026

- **Pas de nouvelle édition** _Trading In The Zone_ depuis 2015. 5 vérités canoniques inchangées.
- **2 raffinements 2025-2026** (Mind Math Money, Bookmap, Quantitrader) :
  1. **Risk Acceptance vs Risk Management** : RA = psychologique pre-trade peace with loss, RM = mécanique sizing + stop.
  2. **Process metrics > outcome metrics** : "Stop tracking wins/losses trade by trade, start tracking whether you executed your process" — directement actionnable V1.8 scoring.
- **Successeurs intellectuels validés 2025-2026** : Cherny, Steenbarger restent les pointers les plus proches. Annie Duke / Dobelli **non validés** (researcher subagent calibrated refusal).

### CFA 2026 LESSOR taxonomy (sources primaires CFA Institute refresher)

6 émotionnels confirmés : **L**oss aversion / **E**ndowment / **S**elf-control / **S**tatus-quo / **O**verconfidence / **R**egret aversion.

**8 tags Trade.tags V1.8 PROPOSÉS** (justification académique chacun) :

| Tag                 | Source primaire                                                    | Pré-/post-outcome |
| ------------------- | ------------------------------------------------------------------ | ----------------- |
| `loss-aversion`     | CFA LESSOR-L + disposition effect (Shefrin-Statman)                | post              |
| `overconfidence`    | CFA LESSOR-O — overconfidence bubble correlate                     | pré               |
| `regret-aversion`   | CFA LESSOR-R — herd mentality cause                                | post              |
| `status-quo`        | CFA LESSOR-S — inertia bias                                        | pré               |
| `self-control-fail` | CFA LESSOR-S — short vs long-term conflict                         | post              |
| `endowment`         | CFA LESSOR-E — held-asset overvaluation                            | post              |
| `discipline-high`   | Steenbarger strengths-based reverse — process executed             | post              |
| `revenge-trade`     | Steenbarger TraderFeed classic anti-pattern (informel, pas LESSOR) | post              |

**Note** : "FOMO" / "tilt" populaires mais **non validés CFA** → marqués `informal:` slug ou exclus V1.8 (à trancher Eliot — Q3 plus bas).

### WeeklyReview pattern best-practice (journaling apps trader)

**Synthèse Edgewonk / TraderSync / TraderVue 2024-2026** :

**5 questions UX best-practice V1.8** :

1. "Sur quels moments d'exécution as-tu le mieux respecté ta checklist cette semaine ?" (Edgewonk Setup Checklists, reformulation neutre process-only)
2. "Quel moment de la journée tu as été le plus discipliné ?" (TraderSync time-of-day pattern Mark Minervini)
3. "Qu'est-ce qui t'a énergisé cette semaine ?" (Steenbarger passion → purpose)
4. "Une décision où tu as exécuté ton process malgré l'émotion ?" (Douglas process > outcome)
5. "Un trade que tu referais à l'identique demain ?" (reverse-journaling)

**3-4 métriques aggregate à afficher (compatible posture Mark Douglas)** :

- **Process adherence rate** (% trades avec plan rempli) — pas P&L
- **Checklist compliance score** (Edgewonk pattern)
- **Emotion-execution correlation** (tag × discipline score, pas tag × P&L)
- **Best-practice streak** (jours consécutifs où process exécuté)

**À éviter (anti-pattern SPEC §2 confirmé)** : win rate, R-multiple, expectancy aggregate display → poussent vers conseil trade.

## Scope V1.8 (hiérarchisation 9 items V1.7-prep)

### Items DÉJÀ LIVE post-V1.7.2 — à RETIRER du scope V1.8

- ~~Item #6 Anthropic LIVE activation~~ → PIVOTÉ V1.7 local Claude batch (Round 14 session 2026-05-12/13), LIVE prod via /sunday-batch + V1.7.2 HTTP migration.
- ~~Trade.tradeQuality A/B/C~~ → LIVE V1.5
- ~~Trade.riskPct Decimal(4,2)~~ → LIVE V1.5
- ~~AI banner EU AI Act 50(1)~~ → LIVE V1.7.1 wire ACTIF (admin/reports + email digest)
- ~~Crisis routing FR~~ → LIVE V1.7.1 wire ACTIF dans persistGeneratedReports

### Items réels V1.8 (4 Must)

| #   | Item (source `docs/jalon-V1.7-prep.md`) | Priorité                       | Reason 1-line                                                                                           | Effort |
| --- | --------------------------------------- | ------------------------------ | ------------------------------------------------------------------------------------------------------- | ------ |
| 1   | `WeeklyReview` model + wizard dimanche  | **Must-V1.8**                  | Rituel central REFLECT, north-star member-facing                                                        | 4h     |
| 2   | `ReflectionEntry` CBT 4 cols A/B/C/D    | **Must-V1.8**                  | Cœur REFLECT, Steenbarger reverse-journaling 2025 + Ellis ABC                                           | 3h     |
| 3   | `Trade.outcomeR` Decimal precise        | **Should-V1.8 note-doc seule** | `realizedR` Decimal(6,2) existe DÉJÀ schema.prisma:384 — renommage trompeur V1.7-prep, pas de migration | 0.5h   |
| 4   | `Trade.tags` String[] multi-select      | **Should-V1.8**                | Pattern detection post-outcome distinct de `tradeQuality` pre-outcome                                   | 1.5h   |

### Items DEFER V1.9+ ou V2

| #   | Item                                            | Catégorie     | Raison defer                                                     |
| --- | ----------------------------------------------- | ------------- | ---------------------------------------------------------------- |
| 5   | Post-trade prompt contextuel 30 items           | **Nice-V1.9** | UI lourd, dépend de #4 absorbé d'abord                           |
| 6   | Scoring `routineCompliance` + `tagPenalty`      | **Defer-V2**  | Recalibrage = ADR-002 path, breaking change sur scores existants |
| 7   | `MarkDouglasDelivery.view_duration_ms` tracking | **Defer-V2**  | Telemetry IA non-bloquant                                        |
| 8   | Trigger evaluators sur `Trade.tags`             | **Nice-V1.9** | Dépend de #4 ship V1.8, triggers session suivante                |
| 9   | `RoutineTemplate`/`Completion`/`HabitLog`       | **Defer-V2**  | Scope énorme, hors REFLECT pur (ROUTINE module V2)               |
| 10  | `AdminBroadcast`/`BroadcastReceipt`             | **Defer-V2**  | SHARE module V2 master plan                                      |

## Design détaillé Must-V1.8

### Item #1 — `WeeklyReview` (member-facing reflection, distinct du `WeeklyReport` admin)

#### Prisma model (NEW)

```prisma
model WeeklyReview {
  id             String   @id @default(cuid())
  userId         String   @map("user_id")
  user           User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  weekStart      DateTime @db.Date @map("week_start")
  weekEnd        DateTime @db.Date @map("week_end")
  biggestWin     String   @db.Text @map("biggest_win")           // free-text safeFreeText
  biggestMistake String   @db.Text @map("biggest_mistake")
  bestPractice   String?  @db.Text @map("best_practice")         // Steenbarger reverse-journaling 2025
  lessonLearned  String   @db.Text @map("lesson_learned")
  nextWeekFocus  String   @db.Text @map("next_week_focus")
  submittedAt    DateTime @default(now()) @map("submitted_at")
  createdAt      DateTime @default(now()) @map("created_at")
  updatedAt      DateTime @updatedAt @map("updated_at")

  @@unique([userId, weekStart])
  @@index([userId, weekStart(sort: Desc)])
  @@map("weekly_reviews")
}
```

#### Zod schema (`apps/web/src/lib/schemas/weekly-review.ts`, NEW)

```typescript
import { z } from 'zod';
import { localDateSchema, dateInWindow } from './shared-dates'; // helpers J5 carbone
import { safeFreeText, containsBidiOrZeroWidth } from '@/lib/text/safe';

const reviewTextField = z
  .string()
  .min(10, { message: 'min_10_chars' })
  .max(4000, { message: 'max_4000_chars' })
  .refine((s) => !containsBidiOrZeroWidth(s), { message: 'bidi_forbidden' })
  .transform(safeFreeText); // NFC + bidi strip

export const weeklyReviewSchema = z
  .object({
    weekStart: localDateSchema.refine(dateInWindow),
    weekEnd: localDateSchema.refine(dateInWindow),
    biggestWin: reviewTextField,
    biggestMistake: reviewTextField,
    bestPractice: reviewTextField.optional().nullable(),
    lessonLearned: reviewTextField,
    nextWeekFocus: reviewTextField,
  })
  .strict();

export type WeeklyReviewInput = z.infer<typeof weeklyReviewSchema>;
```

#### Server Action (pattern J5 carbone)

`apps/web/src/app/review/actions.ts` :

```typescript
'use server';
import { auth } from '@/auth';
import { weeklyReviewSchema } from '@/lib/schemas/weekly-review';
import { submitWeeklyReview } from '@/lib/weekly-review/service';
import { detectCrisis } from '@/lib/safety/crisis-detection'; // V1.7.1 reuse
import { reportWarning, reportError } from '@/lib/observability';
import { logAudit } from '@/lib/auth/audit';

export async function submitWeeklyReviewAction(prev: unknown, formData: FormData) {
  const session = await auth();
  if (!session?.user?.id || session.user.status !== 'active') redirect('/login');

  const parsed = weeklyReviewSchema.safeParse(/* extract formData */);
  if (!parsed.success) return { fieldErrors: parsed.error.flatten() };

  // CRISIS ROUTING WIRE — DUPLICATE V1.7.1 PATTERN (member-facing context = EVEN MORE CRITICAL)
  const corpus = [
    parsed.data.biggestWin,
    parsed.data.biggestMistake,
    parsed.data.bestPractice ?? '',
    parsed.data.lessonLearned,
    parsed.data.nextWeekFocus,
  ].join('\n');
  const crisis = detectCrisis(corpus);
  if (crisis.level !== 'none') {
    await logAudit({
      action: 'weekly_review.crisis_detected',
      userId: session.user.id,
      metadata: { level: crisis.level, matchedLabels: crisis.matchedLabels }, // PII-free
    });
    if (crisis.level === 'high')
      reportError('weekly-review.crisis', new Error('crisis_high'), {
        level: crisis.level,
        matchedLabels: crisis.matchedLabels,
      });
    else
      reportWarning('weekly-review.crisis', 'crisis_medium', {
        level: crisis.level,
        matchedLabels: crisis.matchedLabels,
      });
    // Pas de skip persist — UX cassée. On persist + escalate parallèle.
  }

  await submitWeeklyReview(session.user.id, parsed.data);
  await logAudit({
    action: 'weekly_review.submitted',
    userId: session.user.id,
    metadata: { weekStart: parsed.data.weekStart },
  });
  redirect('/review?done=1');
}
```

**Décision Q4** : duplicate crisis routing OU skip ? Le pickup propose A (duplicate). Researcher confirme member-facing context = encore plus sensible. **Default recommandé : A duplicate** (defense-in-depth, audit pattern identique batch.ts V1.7.1).

#### Service layer (`apps/web/src/lib/weekly-review/service.ts`, NEW)

```typescript
import 'server-only';
import { db } from '@/lib/db';
import type { WeeklyReviewInput } from '@/lib/schemas/weekly-review';
import { parseLocalDate } from '@/lib/checkin/timezone'; // V1.6 carbone

export async function submitWeeklyReview(userId: string, input: WeeklyReviewInput) {
  return db.weeklyReview.upsert({
    where: { userId_weekStart: { userId, weekStart: parseLocalDate(input.weekStart) } },
    create: {
      userId,
      weekStart: parseLocalDate(input.weekStart),
      weekEnd: parseLocalDate(input.weekEnd),
      biggestWin: input.biggestWin,
      biggestMistake: input.biggestMistake,
      bestPractice: input.bestPractice ?? null,
      lessonLearned: input.lessonLearned,
      nextWeekFocus: input.nextWeekFocus,
    },
    update: {
      /* same */
    },
  });
}

export async function getCurrentWeekReview(userId: string, timezone: string) {
  /* read */
}
export async function listMyRecentReviews(userId: string, limit = 12) {
  /* read */
}
```

**Note** : Pas de Mock/Live client pattern — pas d'IA member-side V1.8 (juste l'écriture user). Mock/Live reste réservé aux paths IA générés (V1.7.2 LIVE batch).

#### UI components

- `/review/page.tsx` : Server Component landing — current week status (submitted yes/no) + 5 derniers reviews timeline + CTA "Faire ma revue hebdo".
- `/review/new/page.tsx` : Server Component, redirect si déjà submitted current week.
- `<WeeklyReviewWizard>` Client Component, 5 étapes mobile-first (Framer Motion `<AnimatePresence mode="wait">`), miroir `<MorningCheckinWizard>` :
  1. **Cette semaine en bref** : weekStart/weekEnd auto-calculés (UI read-only mais Zod re-valide server-side)
  2. **Ta plus grande victoire** : biggestWin textarea (min 10, max 4000)
  3. **Ton plus grand piège** : biggestMistake textarea
  4. **Ce qui a marché (optionnel)** : bestPractice textarea — Steenbarger reverse-journaling banner pédagogique
  5. **Leçon + focus next week** : lessonLearned + nextWeekFocus (2 textareas dans même step)
- Brouillon localStorage `fxmily:weekly-review:draft:v1` (pattern J5)
- Crisis banner SI level >= medium (member doit voir qu'on a détecté + ressources 3114 + SOS Amitié)

#### Tests

- Vitest schema (8) + service (5) + Playwright E2E auth gate (2) = **15 tests**
- Crisis FP test "perdu gros sur ce trade" → MUST NOT trip (trading slang exclusion V1.7.1)

### Item #2 — `ReflectionEntry` (CBT Ellis ABC + Disputation)

#### Prisma model (NEW)

```prisma
model ReflectionEntry {
  id           String   @id @default(cuid())
  userId       String   @map("user_id")
  user         User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  date         DateTime @db.Date
  triggerEvent String   @db.Text @map("trigger_event")    // A — Activating event
  beliefAuto   String   @db.Text @map("belief_auto")      // B — Automatic belief
  consequence  String   @db.Text                          // C — Emotion / behavior
  disputation  String   @db.Text                          // D — Disputation / reframe
  createdAt    DateTime @default(now()) @map("created_at")

  @@index([userId, date(sort: Desc)])
  @@map("reflection_entries")
}
```

#### Zod schema (`apps/web/src/lib/schemas/reflection.ts`, NEW)

Similar à WeeklyReview, 4 textarea max 2000 chars chacun via `safeFreeText` + bidi refine + `.strict()`.

#### Service layer (`apps/web/src/lib/reflection/service.ts`, NEW)

`createReflectionEntry(userId, input)`, `listRecentReflections(userId, windowDays=30)`.

#### UI

- `/reflect/page.tsx` : timeline 30 derniers reflections
- `/reflect/new/page.tsx` : wizard 4 étapes (A/B/C/D séquentiel avec banner pédagogique CBT Ellis honnête "inspired by Ellis ABC, adapted for trading — not clinically validated for trader population")

#### Tests

Vitest schema (4) + service (3) + Playwright auth gate (1) = **8 tests**.

### Item #3 — `Trade.outcomeR` note doc SEULE (pas de code)

`Trade.outcomeR` du jalon-V1.7-prep.md ligne 96 = renommage trompeur. `realizedR Decimal? @db.Decimal(6,2)` existe DÉJÀ sur `Trade` (`schema.prisma:384` — `RealizedRSource` enum LIVE depuis J2). Aucune migration nouvelle nécessaire.

**Action** : ajouter note dans `apps/web/CLAUDE.md` section V1.8 close-out clarifiant "outcomeR = nom utilisé V1.7-prep brief, mais SQL existe déjà sous `realizedR` + `realizedRSource enum (computed | estimated)`".

### Item #4 — `Trade.tags` String[] multi-select

#### Prisma extension

`schema.prisma:323` ajouter `tags String[] @default([]) @map("tags")` sur `Trade`. Postgres array natif (pas table jointure V1.7 — JSON-friendly, simpler ORM).

#### Zod schema extension (`lib/schemas/trade.ts`)

Allowlist 8 slugs CFA LESSOR + Steenbarger + informal trading culture :

```typescript
export const TRADE_TAG_SLUGS = [
  'loss-aversion',
  'overconfidence',
  'regret-aversion',
  'status-quo',
  'self-control-fail',
  'endowment',
  'discipline-high',
  'revenge-trade',
] as const;

export const tradeTagSchema = z.enum(TRADE_TAG_SLUGS);
export const tradeTagsSchema = z.array(tradeTagSchema).max(3); // cap 3 tags par trade
```

**Décision Q3** : ajouter `fomo` + `tilt` informels OU pas ? Recommandé : pas V1.8 (laissons LESSOR + Steenbarger + revenge = 8 academic-validated). FOMO peut rentrer V1.9.

#### UI

- `<TradeTagsPicker>` step nouveau dans `/journal/[id]/close` wizard (post-outcome) — multi-select 3 max, tooltips académiques inline.
- `<TradeCard>` admin + member affiche tags Pills.
- `/admin/members/[id]/trades` filtre par tag.

#### Tests

Vitest schema (4) = **4 tests** (allowlist + cap + duplicate rejection + empty default).

## Migration Prisma plan

**1 seule migration idempotente** : `apps/web/prisma/migrations/20260514000000_v1_8_reflect_models/migration.sql`

```sql
-- WeeklyReview (member-facing reflection)
CREATE TABLE IF NOT EXISTS "weekly_reviews" (
  "id" TEXT PRIMARY KEY,
  "user_id" TEXT NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "week_start" DATE NOT NULL,
  "week_end" DATE NOT NULL,
  "biggest_win" TEXT NOT NULL,
  "biggest_mistake" TEXT NOT NULL,
  "best_practice" TEXT,
  "lesson_learned" TEXT NOT NULL,
  "next_week_focus" TEXT NOT NULL,
  "submitted_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "updated_at" TIMESTAMPTZ NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "weekly_reviews_user_week_unique"
  ON "weekly_reviews" ("user_id", "week_start");
CREATE INDEX IF NOT EXISTS "weekly_reviews_user_week_desc_idx"
  ON "weekly_reviews" ("user_id", "week_start" DESC);

-- ReflectionEntry (CBT Ellis ABC + Disputation)
CREATE TABLE IF NOT EXISTS "reflection_entries" (
  "id" TEXT PRIMARY KEY,
  "user_id" TEXT NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "date" DATE NOT NULL,
  "trigger_event" TEXT NOT NULL,
  "belief_auto" TEXT NOT NULL,
  "consequence" TEXT NOT NULL,
  "disputation" TEXT NOT NULL,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS "reflection_entries_user_date_desc_idx"
  ON "reflection_entries" ("user_id", "date" DESC);

-- Trade.tags extension (String[] Postgres array)
ALTER TABLE "trades" ADD COLUMN IF NOT EXISTS "tags" TEXT[] NOT NULL DEFAULT '{}';
```

- **Backfill** : aucun nécessaire (defaults `[]` + nullable `bestPractice` OK).
- **Rollback** : `DROP TABLE weekly_reviews; DROP TABLE reflection_entries; ALTER TABLE trades DROP COLUMN tags;`. À 30 membres V1 prod = <1s lock. Documenter dans `docs/runbook-hetzner-deploy.md` nouvelle sous-section §11.7.

## Build sequence — 6 PRs atomic chained

Pattern carbone V1.7.2 PRs #51 #52 #54 #55 (chaque PR <500 LOC diff, ship-able indépendamment) :

| PR      | Scope                                                                                                                                | Audit pre-merge                                                               |
| ------- | ------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------- |
| **#56** | `feat(v1.8-prisma)`: WeeklyReview + ReflectionEntry + Trade.tags Prisma migration + client regen + Zod schemas + tests unit          | code-reviewer + security-auditor                                              |
| **#57** | `feat(v1.8-services)`: lib/weekly-review/service.ts + lib/reflection/service.ts + Server Actions + crisis routing wire + audit slugs | code-reviewer + security-auditor + verifier                                   |
| **#58** | `feat(v1.8-ui-review)`: /review wizard + landing + member-facing UI                                                                  | code-reviewer + accessibility-reviewer + ui-designer + fxmily-content-checker |
| **#59** | `feat(v1.8-ui-reflect)`: /reflect wizard + landing                                                                                   | code-reviewer + accessibility-reviewer + ui-designer + fxmily-content-checker |
| **#60** | `feat(v1.8-trade-tags)`: TradeTagsPicker close-wizard + audit + admin filtre                                                         | code-reviewer + ui-designer                                                   |
| **#61** | `chore(v1.8)`: close-out CLAUDE.md + jalon-V1.8-close-out.md + outcomeR note doc                                                     | aucun (docs only)                                                             |

## 9 ban-risk rules V1.7.2 forward-port V1.8

Vérification verbatim apps/web/CLAUDE.md:2303-2317 :

| #   | Rule V1.7.2                                      | V1.8 status                                                                                         |
| --- | ------------------------------------------------ | --------------------------------------------------------------------------------------------------- |
| 1   | Eliot's machine (TON IP/fingerprint/Max account) | **N/A V1.8** (no Anthropic call member-side)                                                        |
| 2   | 60-120s RANDOM-jittered sleeps                   | N/A V1.8                                                                                            |
| 3   | Fresh context per member                         | N/A V1.8                                                                                            |
| 4   | Snapshots pseudonymized 8-char hex               | N/A V1.8 (member writes own data)                                                                   |
| 5   | System prompt server-side from repo              | N/A V1.8                                                                                            |
| 6   | Official `claude` binary only                    | N/A V1.8                                                                                            |
| 7   | Human-in-the-loop                                | ✅ implicit (member triggers wizard manuellement)                                                   |
| 8   | Server-side Zod `.strict()` validation           | ✅ MANDATORY — `weeklyReviewSchema.strict()` + crisis pre-persist                                   |
| 9   | Audit log counts-only PII-free                   | ✅ MANDATORY — `weekly_review.submitted` + `reflection.submitted` slugs avec counts JAMAIS le texte |

**Extension V1.8** : `safeFreeText` (NFC + bidi/zero-width strip) sur 5 textarea WeeklyReview + 4 ReflectionEntry — Trojan Source defense applied to member writes (J5 TIER 3 carbone).

## Risques connus appliqués V1.8

| Risque                                         | Source                     | V1.8 application                                                                                                      |
| ---------------------------------------------- | -------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| **Wire-LIVE != Flow-EXECUTABLE**               | V1.7.2 H1 hotfix           | Smoke réel member-side OBLIGATOIRE — login membre seedé + submit /review + verify DB row + audit row + crisis FP test |
| **Pseudonym computed runtime** (pas DB column) | V1.7.2.1 H2                | N/A V1.8 (member-facing, pas de pseudo nécessaire)                                                                    |
| **Buffer.byteLength UTF-8**                    | V1.7.2 hardening           | 5 textarea × 4000 + 4 × 2000 ≈ 28 KiB par submit, sous cap Next.js Server Action 1 MiB. Pas de problème.              |
| **JS regex unicode `\p{L}`**                   | V1.7.1 crisis routing      | `detectCrisis` utilise déjà unicode-aware — reuse direct                                                              |
| **Caddy XFF callerIdTrusted**                  | V1.7.2 audit               | Non concerné V1.8 (pas de cron, pas de rate-limit IP-based)                                                           |
| **iOS 26 PWA push silently fails**             | R4 surprise context_pickup | N/A V1.8 (pas de push trigger nouveau)                                                                                |
| **pnpm-lock duplicate**                        | 2× déjà documenté          | `pnpm install --lockfile-only` + verify avant push                                                                    |

**Nouveau slug AuditAction** à ajouter `lib/auth/audit.ts` :

- `weekly_review.submitted`
- `weekly_review.crisis_detected`
- `reflection.submitted`
- `trade.tags.updated`

## Tests targets

**Baseline V1.7.2.1 = 848 tests**. Cible V1.8 = **887 tests** (+39).

| Module                                                     | Tests ajoutés                              |
| ---------------------------------------------------------- | ------------------------------------------ |
| `lib/schemas/weekly-review.test.ts`                        | 8 (schema validation + NFC + bidi)         |
| `lib/schemas/reflection.test.ts`                           | 4                                          |
| `lib/schemas/trade.test.ts` (Trade.tags extension)         | 4 (allowlist + cap 3 + duplicate + empty)  |
| `lib/weekly-review/service.test.ts`                        | 5                                          |
| `lib/reflection/service.test.ts`                           | 3                                          |
| Server Actions crisis wire smoke test                      | 3 (happy + crisis HIGH + FP trading slang) |
| Playwright auth gates                                      | 3 (/review + /reflect + close-wizard tags) |
| Crisis routing edge unicode (bidi override + emoji 4-byte) | 3                                          |
| **Total +39**                                              |                                            |

## Tech debt V1.8 à absorber Phase A (recommandations subagents)

### Defense-in-depth Prisma Y1 (Y2/Y3 defer V2)

**Verdict code-reviewer subagent** : `apps/web/src/lib/db.ts` LIVE prod V1.6 polish stable, bug latent R4 connectionTimeoutMillis=0 hang DÉJÀ FIXÉ. 3 améliorations defense-in-depth :

```typescript
// V1.8 Phase A patch — ajouter 3 properties après idleTimeoutMillis ligne 24
statement_timeout: 30_000,      // kill Postgres-side après 30s
query_timeout: 30_000,          // kill client-side après 30s
application_name: 'fxmily-web', // observabilité pg_stat_activity
```

⚠ **PRÉ-VERIF context7 obligatoire** : la signature `statement_timeout` est un option Postgres standard mais le pass-through via `@prisma/adapter-pg` doit être confirmé (cf. Prisma 7.8.0 docs officielles ou GitHub `prisma/skills` repo). Risque silent-no-op si propriété mal-typée.

### 3 tests pin V1.7.2 critiques (subagent performance-profiler)

Coverage **solide V1.7.2** mais 3 critiques à pin avant gros volume (>30 membres) :

- **E1 — UTF-8 byte-length 413** (15 min) : pin défense `Buffer.byteLength` ligne 107. Critique car défense déjà codée mais non testée (oversized body emoji 4-byte → 16 MiB cap bypass).
- **E2 — req.text() reject 400** (10 min) : pin la branche `body_read_failed` (ReadableStream qui erreur en cours).
- **E3 — callerIdTrusted XFF edge** (10 min) : 3 cas empty/comma-only/whitespace-only → fallback `unknown`. Anti-régression rate-limit anti-DoS.

Total : ~75 min, +6 tests Vitest. Cible V1.8 hardening = 854 (vs 848 actuel).

### 6 PRs Dependabot YELLOW restants (post #44 #47 merged session 2026-05-13)

Vrai blocker découvert subagent dependency-auditor : **`format:check` fail sur base main**, pas OAuth scope `workflow` (memory était partiellement obsolète). Action follow-up : ouvrir 1 PR dédiée `chore: prettier reformat post-rebase` pour fix la base, ce qui débloque automatiquement #3 #2 #1 #39 (re-run CI suffira).

PRs restants :

- 🔴 **#41 tailwind group** : CI fail format:check 69 fichiers reformatés (prettier-plugin-tailwindcss 0.6→0.8 réordonne classes). PR dédiée reformat OBLIGATOIRE avant merge.
- 🔴 **#6 eslint 9→10** : DEFER (decision actée sessions précédentes).
- 🟡 **#39 docker/login-action 3→4** : revue changelog d'abord (peu probable breaking).
- 🟡 **#3 actions/checkout 4→6** : fix format base first, puis re-run.
- 🟡 **#2 pnpm/action-setup 4→6** : idem #3.
- 🟡 **#1 actions/setup-node 4→6** : idem #3.

## Décisions à trancher AVANT code (V1.8 R1 mandatory)

### Q1 — `WeeklyReview` schedule push iOS reminder dimanche 18h ?

- **A.** Oui via NotificationType nouveau `weekly_review_reminder` (extension enum)
- **B.** Non V1.8, attendre cohorte V2

**Default recommandé : B** (pas de push nouveau V1.8 — focus member-initiated wizard).

### Q2 — `ReflectionEntry` daily streak counter ?

- **A.** Oui (carbone J5 streak.ts) — visible dashboard
- **B.** Non V1.8 (engagement V2)

**Default recommandé : B** (anti-gamification toxique Yu-kai Chou — réflexion pas streak-driven).

### Q3 — `Trade.tags` self-assigned member OR admin-only ?

- **A.** Member self-assign au close wizard (cohérent avec emotionAfter)
- **B.** Admin-only via `/admin/members/[id]/trades/[tradeId]`

**Default recommandé : A** (member-owned reflection, posture Mark Douglas process > outcome).

### Q4 — Crisis routing sur WeeklyReview free-text identique batch.ts V1.7.1 ?

- **A.** Oui — duplique le wire batch.ts:411-441 (defense-in-depth)
- **B.** Non — WeeklyReview est private member, pas de risque escalation IA

**Default recommandé : A** (member-facing free-text = context encore plus sensible que IA admin output, audit pattern identique).

### Q5 — `Trade.tags` ajouter `fomo` + `tilt` informels OU LESSOR-only 8 tags ?

- **A.** LESSOR-only 8 tags (academic-validated CFA + Steenbarger)
- **B.** Ajouter `fomo` + `tilt` informels (vocab trader populaire mais pas validé)

**Default recommandé : A** (rigueur académique V1.8, FOMO peut rentrer V1.9 si demande membres).

## PICKUP PROMPT V1.8 PRÊT-À-COPIER (verbatim post-/clear nouvelle session)

```
Pickup Fxmily — V1.8 REFLECT (post-/clear session V1.7.2 follow-up)

## Lecture OBLIGATOIRE avant toute action (ordre)
1. D:\Fxmily\CLAUDE.md (project instructions + stack)
2. apps/web/CLAUDE.md section "V1.7.2 Migration HTTP routes ACTIVE"
3. ~/.claude/projects/D--Fxmily/memory/MEMORY.md (index)
4. ~/.claude/projects/D--Fxmily/memory/fxmily_session_2026-05-13_CHECKPOINT_FINAL_R3.md
5. ~/.claude/projects/D--Fxmily/memory/fact_eu_ai_act_canonical.md
6. docs/jalon-V1.8-prep.md (CE FICHIER — source de vérité scope V1.8)

## TL;DR état LIVE prod 2026-05-13 fin session V1.7.2 follow-up
- main HEAD : 5beb9b9 (#44 resend + #47 commitlint mergés cette session)
- Vitest : 848/848 verts (cible V1.8 : 887)
- Stack V1 LIVE : V1.5/V1.5.2/V1.6/V1.6 extras/V1.7 local Claude batch/V1.7.1 wires ACTIFS/V1.7.2 HTTP migration/V1.7.2.1 hotfix
- Smoke /api/admin/weekly-batch/pull : HTTP 200 + 7780 bytes envelope LIVE (validation empirique 2026-05-13 14:30 UTC)

## V1.8 REFLECT scope (4 Must items)
1. WeeklyReview model + wizard dimanche (4h)
2. ReflectionEntry CBT Ellis A/B/C/D (3h)
3. Trade.outcomeR note doc seule (0.5h — realizedR existe déjà)
4. Trade.tags String[] 8 slugs LESSOR + Steenbarger (1.5h)

## Décisions Q1-Q5 à trancher AVANT code (R1 mandatory)
Q1 push reminder dimanche 18h ? (A oui / B non — recommandé B)
Q2 ReflectionEntry streak counter ? (A oui / B non — recommandé B)
Q3 Trade.tags self-assigned ? (A member / B admin — recommandé A)
Q4 Crisis routing WeeklyReview ? (A oui / B non — recommandé A)
Q5 ajouter fomo+tilt informels ? (A LESSOR-only / B avec informels — recommandé A)

## Pre-flight checks Round 1
git worktree list
git fetch origin && git log origin/main -5 --oneline   # doit dire 5beb9b9 ou plus
gh run list --workflow ci.yml --limit 3                # CI green ?
gh run list --workflow deploy.yml --limit 3            # Deploy success ?
cd apps/web && DATABASE_URL='postgresql://placeholder:placeholder@localhost:5432/placeholder' AUTH_SECRET='test_auth_secret_dummy_value_at_least_32_chars_long_xxxx' AUTH_URL='https://app.fxmilyapp.com' npx vitest run    # Vitest baseline 848/848
Invoke fxmily-jalon-tracker subagent Round 1 (canon mandatory)

## Build sequence 6 PRs atomic
#56 prisma migration + Zod + tests unit
#57 services + actions + crisis wire + audit slugs
#58 /review wizard + landing
#59 /reflect wizard + landing
#60 Trade.tags close-wizard + admin filtre
#61 close-out docs

## Tech debt V1.8 Phase A à absorber AVANT #56
- Prisma Y1 patch (statement_timeout + query_timeout + application_name) — verify context7 signature avant apply
- 3 tests pin V1.7.2 critiques (E1 byte-length + E2 req.text + E3 XFF edge)
- 1 PR dédiée prettier reformat 69 fichiers (débloque dependabot YELLOW #3 #2 #1 #39)

## Posture verrouillée NON-NÉGOCIABLE
- Mark Douglas : ZÉRO conseil trade dans aucun livrable
- Crisis routing : duplicate batch.ts pattern verbatim (audit row PII-free + Sentry escalate HIGH/MEDIUM)
- safeFreeText (NFC + bidi strip) sur 100% textarea WeeklyReview + ReflectionEntry
- 6 PRs atomic <500 LOC diff chacun, pas de fourre-tout
- Pre-merge audit subagents (code-reviewer + security-auditor + verifier + fxmily-content-checker)
- /fxmily-deliver-jalon AVANT /clear final

Démarre Round 1 par : lecture exhaustive memory + lecture brief V1.8 + fxmily-jalon-tracker + AskUserQuestion Q1-Q5. /ultrathink-this /maximum-mode
```

## Subagents à invoquer V1.8

1. **Round 1 mandatory** : `fxmily-jalon-tracker` (canon, leçon V2 master plan R1)
2. **AVANT migration Prisma #56** : skill `/fxmily-prisma-migrate` BLOQUANT
3. **Pendant impl crisis wire #57** : `security-auditor` (privacy + audit log PII-free)
4. **Pendant UI #58 #59** : `fxmily-content-checker` (posture Mark Douglas BLOQUANT — anti anthropomorphisation IA + anti conseil trade)
5. **Fin session 4 subagents parallèles** : `code-reviewer` + `security-auditor` + `verifier` + `fxmily-content-checker`
6. **Avant `/clear` final** : `/fxmily-deliver-jalon`

## Critères "Done quand" V1.8

- WeeklyReview wizard dimanche utilisable (3 membres minimum smoke E2E réel)
- ReflectionEntry CBT wizard utilisable
- Trade.tags fill rate > 50% sur 10 trades post-V1.8
- Crisis routing duplicate wire validé (FP test "perdu gros sur ce trade" → MUST NOT trip)
- Tous Vitest verts (cible 887)
- 4 subagents audit OK
- 6 PRs atomic mergées (#56 → #61)
- apps/web/CLAUDE.md section V1.8 close-out
- `/fxmily-deliver-jalon` exécuté AVANT `/clear`

## Posture absolue

- **Mark Douglas non-négociable** : pas de conseil trade, oui exécution + psycho
- **CBT honnêteté** : "inspired by Ellis ABC, adapted for trading — not clinically validated for trader population" (banner pédagogique mandatory dans /reflect/new)
- **Anti-sycophantie** : signaler dérives même mid-session
- **EU AI Act** : N/A V1.8 (pas de génération IA member-side)
- **RGPD §16** : audit log counts-only PII-free + safeFreeText 100% free-text

## Effort total V1.8

**~11h** dev + audits = **1 session pleine**. Ne PAS étaler sur 2 sessions (drift garanti, SPEC §18.4).

Détail :

- #1 WeeklyReview : 4h
- #2 ReflectionEntry : 3h
- #3 outcomeR note doc : 0.5h
- #4 Trade.tags : 1.5h
- Audits parallèles 4 subagents + fix in-session : 1.5h
- Smoke E2E member réel + audit log SSH : 0.5h
- **Total : 11h**

---

**Crédit subagents Round 1 cette session** :

- **researcher** : 25 sources URLs cliquables 2024-2026 (Steenbarger TraderFeed + JMIR Mental Health 2025 + CFA Institute 2026 + Edgewonk/TraderVue patterns)
- **code-reviewer** : audit `apps/web/src/lib/db.ts` Prisma 7 → verdict YELLOW + 3 améliorations defense-in-depth
- **dependency-auditor** : 8 PRs triage → 2 GREEN mergées + 6 YELLOW/RED documentées
- **planner** : ultrathink V1.8 plan exhaustif (10 sections + pickup prompt)
- **performance-profiler** : V1.7.2 coverage stress-test → 3 tests critiques + 9 edge cases priorisés

**Next action recommandée Eliot** :

1. `/clear` cette session V1.7.2 follow-up + V1.8 prep
2. Nouvelle session V1.8 REFLECT avec pickup prompt ci-dessus
3. AVANT V1.8 : test `/sunday-batch --dry-run` end-to-end (validation empirique V1.7.2 flow + EU AI Act compliance final check, ~10 sem avant deadline 2 août 2026)

🟢 **Validation empirique V1.7.2 cette session** : `/api/admin/weekly-batch/pull` LIVE 200 + 7780 bytes envelope confirmé via SSH hetzner-dieu 2026-05-13 14:30 UTC. Server-side half du batch est fonctionnel end-to-end. Reste à valider le `claude --print × N membres jittered` orchestration côté Eliot machine Windows avec son abonnement Max + token exporté.
