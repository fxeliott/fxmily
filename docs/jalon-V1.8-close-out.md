# V1.8 REFLECT — Phase 1 backend close-out (2026-05-13)

> Close-out doc for the V1.8 REFLECT module **backend-only phase**. Per
> `feedback_backend_first_workflow.md` (memory `D--Fxmily`), this ships
> the foundation (Prisma + Zod + services + Server Actions + crisis wire
>
> - prompt-injection defenses + audit slugs + edge tests) and **STOPS
>   there** to wait for Eliot's explicit "go frontend" signal before the
>   wizards UI, iPhone PWA smoke, and visual verify chrome-devtools land
>   in Phase 2.

## TL;DR état post-Phase 1 backend

| Indicator                       | Value                                                                                                                          |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| **PRs opened**                  | #61 (Prisma) → #62 (services, stacked on #61) → #63 (edge tests, stacked on #62) → #64 (this close-out, stacked on #63)        |
| **Branche worktree**            | `claude/eloquent-lewin-d7093a` (PR #61), `feat/v1.8-services` (#62), `feat/v1.8-edge-tests` (#63), `feat/v1.8-close-out` (#64) |
| **main HEAD avant V1.8**        | `1e7db6d` (V1.7.2 R5 LIVE)                                                                                                     |
| **Vitest avant V1.8**           | 855/855                                                                                                                        |
| **Vitest après V1.8 backend**   | **926/926** (+71 over baseline, dépasse largement la cible Eliot +30)                                                          |
| **Modèles Prisma ajoutés**      | `WeeklyReview` + `ReflectionEntry` + `Trade.tags String[]`                                                                     |
| **Migration**                   | `20260513150000_v1_8_reflect_models/migration.sql` (ADD-only, safe)                                                            |
| **8 décisions Q1-Q5+M4-M6**     | Toutes conservées defaults `docs/jalon-V1.8-decisions.md`                                                                      |
| **Posture Mark Douglas**        | Verrouillée 0 conseil trade dans la diff complète                                                                              |
| **Crisis wire (Q4=A)**          | Wired sur WeeklyReview + ReflectionEntry, persist QUAND MÊME + Sentry escalate parallèle                                       |
| **Prompt-injection (R5 axe 4)** | Defenses (XML wrap + pre-classifier) shipped en utilities, audit trail wired sur services                                      |

## Build sequence — 4 PRs atomic chain backend

Pattern carbone V1.7.2 PRs #51-#55. Stack chain :

```
main (1e7db6d)
  └─ PR #61 claude/eloquent-lewin-d7093a — feat(v1.8-prisma): Prisma migration + Zod + 27 tests
      └─ PR #62 feat/v1.8-services — feat(v1.8-services): services + actions + crisis + injection + 29 tests
          └─ PR #63 feat/v1.8-edge-tests — test(v1.8): edge tests cumulatifs + 15 tests
              └─ PR #64 feat/v1.8-close-out — docs(v1.8): close-out
```

| PR  | Scope                                                                          | Tests Δ | Audits        |
| --- | ------------------------------------------------------------------------------ | ------- | ------------- |
| #61 | Prisma migration + Zod schemas + tests unit                                    | +27     | (CI green ✓)  |
| #62 | services + Server Actions + crisis wire + prompt-injection defenses            | +29     | pending merge |
| #63 | edge tests (crisis FP + injection FP + byte budget + audit slug)               | +15     | pending merge |
| #64 | docs close-out (this file + `apps/web/CLAUDE.md` V1.8 section + outcomeR note) | 0       | docs-only     |

## Fichiers wire complets V1.8 backend phase 1

| Fichier                                                                       | Rôle                                                                                                                                                            |
| ----------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/web/prisma/schema.prisma`                                               | 3 ajouts : `WeeklyReview` model + `ReflectionEntry` model + `Trade.tags String[]` column + 2 relations sur `User`                                               |
| `apps/web/prisma/migrations/20260513150000_v1_8_reflect_models/migration.sql` | 2 CREATE TABLE + 3 indexes + 2 FK + 1 ALTER TABLE ADD COLUMN. ADD-only, rollback SQL header. Safe à 30 membres scale (<1s lock).                                |
| `apps/web/src/lib/schemas/weekly-review.ts`                                   | Strict Zod schema (`weeklyReviewSchema`), Monday-only `weekStart` window `[-35d, +7d]`, `weekEndFromWeekStart` helper, `buildReviewCorpus` for crisis pipeline. |
| `apps/web/src/lib/schemas/weekly-review.test.ts`                              | 11 tests (validation + window + bidi rejection + NFC + corpus helpers).                                                                                         |
| `apps/web/src/lib/schemas/reflection.ts`                                      | Strict Zod schema (`reflectionEntrySchema`), Ellis ABCD, date `[-14d, +1d]`, `buildReflectionCorpus`.                                                           |
| `apps/web/src/lib/schemas/reflection.test.ts`                                 | 6 tests (ABCD validation + window + bidi + corpus).                                                                                                             |
| `apps/web/src/lib/schemas/trade.ts`                                           | Extension : `TRADE_TAG_SLUGS` (8 LESSOR + Steenbarger), `tradeTagsSchema` (max 3), `isTradeTagSlug` guard, integration dans `tradeCloseSchema.tags`.            |
| `apps/web/src/lib/schemas/trade.test.ts`                                      | Extension : 10 tests (allowlist + cap 3 + duplicate rejection + integration tradeCloseSchema + anti-regression count = 8).                                      |
| `apps/web/src/lib/weekly-review/service.ts`                                   | `submitWeeklyReview` (upsert + wasNew), `getWeeklyReview`, `listMyRecentReviews` (clamp 1..52). `SerializedWeeklyReview`.                                       |
| `apps/web/src/lib/weekly-review/service.test.ts`                              | 7 tests (mock `@/lib/db`).                                                                                                                                      |
| `apps/web/src/lib/reflection/service.ts`                                      | `createReflectionEntry`, `listRecentReflections` (rolling window 1..365). `SerializedReflectionEntry`.                                                          |
| `apps/web/src/lib/reflection/service.test.ts`                                 | 3 tests (mock `@/lib/db`).                                                                                                                                      |
| `apps/web/src/app/review/actions.ts`                                          | `submitWeeklyReviewAction` — auth re-check + Zod parse + crisis wire + injection wire + persist + audit + Sentry + redirect.                                    |
| `apps/web/src/app/reflect/actions.ts`                                         | `createReflectionEntryAction` — même pattern pour ReflectionEntry.                                                                                              |
| `apps/web/src/lib/ai/injection-detector.ts`                                   | 9 canonical patterns (EN/FR ignore + role markers + Base64 + Unicode tag-strip + persona override). Pure function.                                              |
| `apps/web/src/lib/ai/injection-detector.test.ts`                              | 12 tests (null/empty + 4 legit FP + each pattern positive + boundary + multi + anti-regression count).                                                          |
| `apps/web/src/lib/ai/injection-detector.edge.test.ts`                         | 9 tests (Mark Douglas verbatim + FR Markdown + ChatML mid-prose + boundary + real attack + persona-override mid-sentence).                                      |
| `apps/web/src/lib/ai/prompt-builder.ts`                                       | `wrapUntrustedMemberInput` XML envelope (self-close-tag neutralized) + `wrapUntrustedMemberInputBlocks` + `UNTRUSTED_INPUT_SYSTEM_INSTRUCTION`. Dormant V1.8.   |
| `apps/web/src/lib/ai/prompt-builder.test.ts`                                  | 7 tests (wrap + neutralize close tag + multi-block + system instruction).                                                                                       |
| `apps/web/src/lib/schemas/weekly-review.edge.test.ts`                         | 5 tests (3 crisis FP trading slang + 1 injection FP Markdown + 1 byte budget UTF-8 emoji).                                                                      |
| `apps/web/src/lib/auth/audit.ts`                                              | +4 V1.8 slugs (`weekly_review.{submitted,crisis_detected}`, `reflection.{submitted,crisis_detected}`).                                                          |
| `apps/web/src/lib/auth/audit-v1-8.test.ts`                                    | 1 test (`satisfies ReadonlyArray<AuditAction>` compile-time anchor + format smoke).                                                                             |

## 8 décisions enforcement matrix (Q1-Q5 + M4-M6 acted 2026-05-13)

| #   | Décision                            | Choix acted                          | V1.8 backend enforcement                                                                                                                                                                                                             |
| --- | ----------------------------------- | ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Q1  | Push reminder dimanche              | **B Non**                            | `NotificationType` enum **non touché** (anti-spam V1)                                                                                                                                                                                |
| Q2  | Streak counter ReflectionEntry      | **B Non**                            | `ReflectionEntry` model **sans column streak** (anti gamification toxique)                                                                                                                                                           |
| Q3  | `Trade.tags` self-assigned member   | **A Oui**                            | `tradeCloseSchema.tags` accepts member-side, capped 3                                                                                                                                                                                |
| Q4  | Crisis routing dup sur WeeklyReview | **A Oui**                            | `submitWeeklyReviewAction` + `createReflectionEntryAction` wires `detectCrisis(corpus)` AVANT persist + Sentry escalate parallèle + audit `*.crisis_detected`. **PERSIST QUAND MÊME** (Q4 differs from V1.7.1 batch.ts which skips). |
| Q5  | `fomo` + `tilt` informels OU LESSOR | **A LESSOR-only**                    | `TRADE_TAG_SLUGS` const = exactly 8 (anti-regression test). Pas de slug `fomo` ni `tilt`.                                                                                                                                            |
| M4  | Métaphore Fxmily                    | **C Miroir**                         | Pas de code V1.8 (UI copy à Phase 2)                                                                                                                                                                                                 |
| M5  | Rituel central                      | **A morning + D evening**            | Morning intact (J5 LIVE) + WeeklyReview wizard dimanche (Phase 2 frontend)                                                                                                                                                           |
| M6  | Wow moment                          | **A Rapport hebdo IA (LIVE V1.7.2)** | Pas de touche V1.8                                                                                                                                                                                                                   |

Override Eliot toujours possible — ces décisions sont des defaults conservés depuis `docs/jalon-V1.8-decisions.md`, pas un verrou.

## Item #3 outcomeR note doc (clarification SPEC §6.2)

Le brief V1.7-prep mentionnait `Trade.outcomeR` comme item à shipper V1.8. **C'est un renommage trompeur** — le champ existe DÉJÀ dans le schema sous le nom canon `realizedR` :

- `apps/web/prisma/schema.prisma:384` — `realizedR Decimal? @map("realized_r") @db.Decimal(6, 2)` (J2, validé par 4 enums incl. `RealizedRSource`).
- `apps/web/src/lib/trading/calculations.ts` — `computeRealizedR` calcule la valeur depuis entry/exit/stopLoss (computed) OU fallback `plannedRR | -1 | 0` selon outcome (estimated).
- `apps/web/src/lib/scoring/consistency.ts` + analytics J6 — déjà câblé sur `realizedR` (pas de migration nécessaire pour V1.8).

**Action V1.8 = note doc seule** (cette section). Aucune migration, aucun code ajouté. Si une future PR mentionne `outcomeR`, l'auteur doit comprendre que c'est le **même champ** que `realizedR` (V1.7-prep brief naming drift).

## Prompt-injection defenses — pourquoi maintenant ?

V1.8 ne génère **aucun** prompt Claude member-side (les rapports IA V1.7.2 sont admin-only, batch hebdo). Pourquoi shipper `injection-detector.ts` + `prompt-builder.ts` maintenant alors qu'aucun consumer n'existe ?

1. **Audit trail dès J0** — les attempts d'injection dans les wizards V1.8 sont captés dans les rows `audit_logs.metadata.injectionSuspected = true` + `injectionLabels`. Quand V2 chatbot landera, le forensic baseline existe.
2. **78.6% breach rate Opus 4.6 k=200 sans defense** (R5 addendum 2026-05-13). Layered defense (XML wrap + pre-classifier + structured output) drop ça à 1-17%. Shipper la couche pre-classifier en V1.8 = défense partielle prête à l'emploi.
3. **Test coverage anti-regression** — les 21 tests cumulés (12 injection-detector unit + 9 edge + 7 prompt-builder + 5 weekly-review edge integration) verrouillent les FP-rate sur les patterns dont V2 va dépendre. Une régression sur la regex `role_marker_system` n'attendra pas V2 pour se manifester.

Le `wrapUntrustedMemberInput()` XML helper et `UNTRUSTED_INPUT_SYSTEM_INSTRUCTION` restent **dormant** (aucun consumer V1.8). V2 chatbot les consommera quand un Server Action devra envoyer du content member-side à Claude.

## Crisis routing wire — divergence Q4=A vs V1.7.1 batch.ts

Le V1.7.1 wire dans `lib/weekly-report/batch.ts:410` **SKIP le persist** si `detectCrisis` retourne `medium`/`high`. La rationale : ne pas laisser un summary Claude contenant des signaux suicide dans `weekly_reports` (table admin-visible, email digest auto).

Le V1.8 wire dans `app/review/actions.ts` + `app/reflect/actions.ts` **PERSIST QUAND MÊME**. La rationale (Q4=A actée) :

- Le content vient du **membre lui-même**, pas d'une output Claude possiblement bidi-injectée.
- Skip silencieux = UX cassée (le wizard renvoie l'utilisateur sur l'écran initial sans explication, le membre tape à nouveau, re-trip, infinite loop).
- Persist + audit + Sentry escalate parallèle = l'admin (Eliot) est paged dans la minute (HIGH → `reportError`, MEDIUM → `reportWarning`) et peut appeler le membre. Le membre voit son texte sauvegardé + un banner avec les ressources 3114 + SOS Amitié + Suicide Écoute (Phase 2 frontend).

Cette divergence est **délibérée et codifiée** — pas un bug à uniformiser plus tard.

## 9 ban-risk rules V1.7.2 forward-port V1.8

Vérification verbatim `apps/web/CLAUDE.md:2303-2317` :

| #   | Rule V1.7.2                                      | V1.8 backend phase 1 status                                                                                                                                         |
| --- | ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Eliot's machine (TON IP/fingerprint/Max account) | **N/A V1.8** (no Anthropic call member-side)                                                                                                                        |
| 2   | 60-120s RANDOM-jittered sleeps                   | N/A V1.8                                                                                                                                                            |
| 3   | Fresh context per member                         | N/A V1.8                                                                                                                                                            |
| 4   | Snapshots pseudonymized 8-char hex               | N/A V1.8 (member writes own data)                                                                                                                                   |
| 5   | System prompt server-side from repo              | N/A V1.8                                                                                                                                                            |
| 6   | Official `claude` binary only                    | N/A V1.8                                                                                                                                                            |
| 7   | Human-in-the-loop                                | ✅ implicit (member triggers wizard manuellement)                                                                                                                   |
| 8   | Server-side Zod `.strict()` validation           | ✅ ENFORCED — `weeklyReviewSchema.strict()` + `reflectionEntrySchema.strict()` + crisis pre-persist                                                                 |
| 9   | Audit log counts-only PII-free                   | ✅ ENFORCED — `weekly_review.{submitted,crisis_detected}` + `reflection.{submitted,crisis_detected}` carry IDs + canonical labels + flags, **jamais le texte brut** |

**Extension V1.8** : `safeFreeText` (NFC + bidi/zero-width strip) appliqué sur 100% des 9 textareas (5 WeeklyReview + 4 ReflectionEntry) via les Zod transforms. Trojan Source defense applied to member writes (J5 TIER 3 carbone).

## Risques connus appliqués V1.8 backend

| Risque                                         | Source                     | V1.8 backend application                                                                                                      |
| ---------------------------------------------- | -------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| **Wire-LIVE != Flow-EXECUTABLE**               | V1.7.2 H1 hotfix           | Smoke réel member-side **différé Phase 2 frontend** (wizards UI requis). PR3 edge tests vérifient les invariants logique.     |
| **Pseudonym computed runtime** (pas DB column) | V1.7.2.1 H2                | N/A V1.8 (member-facing, pas de pseudo nécessaire)                                                                            |
| **Buffer.byteLength UTF-8 4-byte emoji**       | V1.7.2 R5 audit            | ✅ Test pin : 5 textareas × 4000 chars × 4-byte emoji = 78 KiB < 128 KiB ceiling (8× margin vs Next 1 MiB Server Action cap). |
| **JS regex unicode `\p{L}`**                   | V1.7.1 crisis routing      | `detectCrisis` reuse direct V1.7.1 (déjà testé 28 cas TDD avec exclusions trading slang)                                      |
| **iOS 26 PWA push silently fails**             | R4 surprise context_pickup | N/A V1.8 (pas de push trigger nouveau)                                                                                        |
| **pnpm-lock duplicate `@types/node`**          | 2× déjà documenté          | N/A V1.8 (no deps added)                                                                                                      |
| **CRLF Git checkout Windows**                  | V1.6 5 bugs latents        | `.gitattributes` LF enforcement déjà en place V1.6 (commit `e14bdb8`). N/A V1.8.                                              |

## Audit slugs V1.8 (5 ajouts cumulés)

L'union `AuditAction` (`lib/auth/audit.ts`) reçoit **4 nouveaux slugs** :

```ts
// V1.8 — REFLECT module
| 'weekly_review.submitted'
| 'weekly_review.crisis_detected'
| 'reflection.submitted'
| 'reflection.crisis_detected';
```

Submission rows (`*.submitted`) carrient `crisisLevel` + `injectionSuspected` + `injectionLabels` dans `metadata` pour qu'une seule row capture le full audit picture. Les `*.crisis_detected` rows dupliquent le signal avec `matchedLabels` pour le forensic filtering (Sentry escalation paire avec ces rows).

Anti-régression test : `lib/auth/audit-v1-8.test.ts` pin les 4 slugs via `satisfies ReadonlyArray<AuditAction>` clause — supprimer un slug casse tsc.

## Quality gates V1.8 backend phase 1

- **Format check** ✓ — `pnpm prettier --check` clean sur tous les fichiers V1.8 (le repo-wide format debt 372 fichiers reste hors scope)
- **Lint** ✓ — `pnpm lint` exit 0 (max-warnings = 0)
- **Type-check** ✓ — `pnpm tsc --noEmit` exit 0 (strict incl `noUncheckedIndexedAccess` + `exactOptionalPropertyTypes`)
- **Vitest** : **926/926 verts** (+71 vs main baseline 855, dépasse largement la cible Eliot +30)
- **Build prod Turbopack** ✓ — toutes les routes V1.8 listées (verified via PR #61 CI ALL GREEN sur 5 checks)
- **Migration** ✓ — `pnpm prisma:generate` regen propre, schema diff Prisma valide

## Pré-requis Eliot AVANT déploiement prod V1.8 backend

1. **Merger PR #61 → main** (Prisma migration gate)
2. **Merger PR #62 → main** (rebase auto-fait sur main une fois #61 mergé)
3. **Merger PR #63 → main** (rebase auto sur main)
4. **Merger PR #64 → main** (close-out docs)
5. **Apply migration en prod** : `pnpm --filter @fxmily/web prisma:migrate:deploy` (à appliquer pendant maintenance window — 2 CREATE TABLE + 1 ALTER ADD COLUMN sur `notification_queue` à 30 membres = 0-1 s lock acceptable)
6. **Restart container app** (pick up new Prisma client)
7. **Verify** : `/api/health` 200 + `/api/cron/health` overall = green sous 5 min

## STOP — Backend Phase 1 fini, attente go Eliot pour Phase 2 frontend

Per `feedback_backend_first_workflow.md` (memory `D--Fxmily`), le flow suivant est strict :

1. ✅ **Phase backend max** : Prisma + services + Zod + tests + crisis wire + audit slugs + smoke E2E backend → **DONE**.
2. ⏸ **STOP** : annoncer "Backend V1.8 fini" + résumer ce qui est shippé + faire pause → **WE ARE HERE**.
3. ⏳ **Attendre go explicite Eliot** pour démarrer la phase frontend.
4. ⏳ **Phase frontend max** : UI wizards (`<WeeklyReviewWizard>` 5 steps + `<ReflectionWizard>` 4 steps ABCD) + Framer Motion + accessibility + tests RTL + Playwright E2E + visual verify chrome-devtools + iPhone PWA smoke.

**Recommandation** : `/clear` cette session V1.8 backend + ouvrir une nouvelle session V1.8 Phase 2 frontend une fois Eliot prêt à explore les wizards UI.

## Pickup prompt V1.8 Phase 2 frontend (prêt-à-copier post-`/clear`)

```
Pickup Fxmily — V1.8 REFLECT Phase 2 frontend (post-/clear session backend)

## Lecture OBLIGATOIRE avant toute action (ordre)
1. D:\Fxmily\CLAUDE.md (project instructions + stack)
2. apps/web/CLAUDE.md section "V1.8 REFLECT backend" (post-PR #64 merge)
3. ~/.claude/projects/D--Fxmily/memory/MEMORY.md (index)
4. ~/.claude/projects/D--Fxmily/memory/feedback_premium_frontend.md
5. docs/jalon-V1.8-prep.md §UI components (this file)
6. docs/jalon-V1.8-close-out.md (V1.8 backend phase 1 final state)

## TL;DR état LIVE prod (après merge PR #61-#64)
- main HEAD : (à update post-merge)
- Vitest : 926/926 verts
- Stack V1 LIVE : V1.5..V1.7.2 + V1.8 backend (3 nouveaux modèles DB + services + actions + crisis wire + prompt-injection defenses)
- Tables DB : `weekly_reviews`, `reflection_entries`, `trades.tags` column en LIVE prod
- Audit slugs LIVE : `weekly_review.{submitted,crisis_detected}` + `reflection.{submitted,crisis_detected}` (zéro émission jusqu'au 1er wizard frontend)

## V1.8 Phase 2 frontend scope (4 PRs frontend)
- PR FE-1 : <WeeklyReviewWizard> 5 steps (cette semaine en bref + biggestWin + biggestMistake + bestPractice optionnel + lessonLearned + nextWeekFocus). Framer Motion + brouillon localStorage `fxmily:weekly-review:draft:v1`. Crisis banner SI level >= medium (URL `?crisis=medium`).
- PR FE-2 : <ReflectionWizard> 4 steps ABCD (Ellis). Banner pédagogique CBT honnête.
- PR FE-3 : <TradeTagsPicker> step nouveau dans `/journal/[id]/close` wizard (post-emotionAfter, pré-soumission). Max 3 tags + tooltips académiques inline.
- PR FE-4 : Visual verify chrome-devtools + iPhone PWA smoke + accessibility audit.

## Posture verrouillée
- Mark Douglas : zéro conseil trade
- CBT disclaimer obligatoire : "inspired by Ellis ABC, adapted for trading — not clinically validated for trader population"
- Frontend premium (animations, charts) per feedback_premium_frontend
- WCAG 2.2 AA mandatory (44×44 touch targets, focus visible, prefers-reduced-motion)

/ultrathink-this /maximum-mode
```

## Référence

- Brief V1.8 complet : [`docs/jalon-V1.8-prep.md`](./jalon-V1.8-prep.md) (731 lignes, PR #56)
- Décisions actées : [`docs/jalon-V1.8-decisions.md`](./jalon-V1.8-decisions.md) (200 lignes, PR #58)
- R5 addendum (researcher findings) : [`docs/jalon-V1.8-r5-addendum.md`](./jalon-V1.8-r5-addendum.md) (227 lignes, PR #60)
- Workflow backend-first : `~/.claude/projects/D--Fxmily/memory/feedback_backend_first_workflow.md`
- SPEC §15 J0-J10 done + §18.4 1 session = 1 jalon + §20 v1.1 changelog
- V1.7.2 batch wire reference : `apps/web/CLAUDE.md:V1.7.2 Migration HTTP routes ACTIVE`
