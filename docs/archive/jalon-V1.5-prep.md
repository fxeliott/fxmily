# Préparation — Jalon V1.5 (post-merge J10, calibration trading expert)

> **Statut** : EN ATTENTE — démarrer en nouvelle session avec `/clear` **après** que [PR #35](https://github.com/fxeliott/fxmily/pull/35) soit mergée sur `main` ET que le smoke prod 12-step soit validé sur `https://app.fxmilyapp.com`.
>
> Ce briefing couvre le V1.5 backlog explicit du SPEC — 3 items reportés post-J10 par décision Phase V (audit trading-expert subagent 2026-05-09).

## 1. Critère "Done" V1.5 (verbatim)

Le V1.5 est livré quand :

1. `lib/weekly-report/builder.ts` pseudonymise `userId` UUID → `member-XXXXXX` avant
   d'envoyer le snapshot dans le prompt Claude Sonnet 4.6 (defense-in-depth
   prompt-injection / data-leak).
2. `Trade` schema gagne le champ `tradeQuality` enum (`A` | `B` | `C` | null)
   capturé pendant le wizard `/journal/new` step 5 ou au close. Visible dans
   le dashboard sous forme de répartition (Sankey ou bar chart) + dans le
   weekly report comme métadata Claude.
3. `Trade` schema gagne le champ `riskPct` Decimal(4,2) — pourcentage du
   compte risqué sur ce trade. Optionnel si `stopLossPrice` absent. Visible
   dans le wizard step 3 + dans `/journal/[id]` détail.
4. Migration Prisma `0009_v1_5_trade_quality_riskpct` appliquée en prod
   sans data loss (additive only, NULL par défaut sur les rows existantes).
5. **Mystère hook revert Phase V investigué et résolu** (cf. §6 ci-dessous).

---

## 2. Pourquoi maintenant (post-J10) et pas avant

3 raisons :

1. **Règle Eliot SPEC §18.4** : 1 session = 1 jalon. J10 = production hardening +
   smoke. V1.5 = trading-feature additions. Mélanger les deux dans la même
   PR violerait la règle et augmenterait le risque CI / review.
2. **PR #35 déjà à 18 706 + additions / 991 deletions / 146 fichiers**.
   Ajouter 8-10 fichiers V1.5 (migration + types + Zod + UI + tests) = +500
   lignes minimum, alourdit la review pour zéro bénéfice ship.
3. **Investigation hook revert** mérite une session focus (§6) — la mélanger
   à du code feature crée du bruit dans le diagnostic.

---

## 3. Scope V1.5 — 3 items + investigation

### Item 1 — Pseudonymisation `userId` dans builder.ts

**Fichier cible** : [`apps/web/src/lib/weekly-report/builder.ts:38`](../apps/web/src/lib/weekly-report/builder.ts) (le champ `WeeklySnapshot.userId`).

**Diff attendu (~15 lignes)** :

```ts
// lib/weekly-report/types.ts — étendre WeeklySnapshot
export interface WeeklySnapshot {
  /** Pseudonymized member identifier — never the real userId UUID. */
  memberLabel: string; // "member-A1B2C3" — derived from userId via SHA-256(userId).slice(0,6)
  // remove: userId
  ...
}

// lib/weekly-report/builder.ts — buildWeeklySnapshot
import { createHash } from 'node:crypto';

function pseudonymizeMember(userId: string): string {
  return 'member-' + createHash('sha256').update(userId).digest('hex').slice(0, 6).toUpperCase();
}

export function buildWeeklySnapshot(input: BuilderInput): WeeklySnapshot {
  return {
    memberLabel: pseudonymizeMember(input.userId),
    timezone: input.timezone,
    weekStart: input.weekStart,
    ...
  };
}
```

**Tests** : 3 nouveaux Vitest (`builder.test.ts`) :

- `pseudonymizeMember` est déterministe (same userId → same label).
- `pseudonymizeMember` est uniformément distribué (no collision risk on cohort < 1000).
- `WeeklySnapshot` ne contient plus de field `userId`.

**Why** : V.2 audit recommandait pseudonymisation pour prompt-injection
defense-in-depth. Le `userId` UUID lui-même n'est pas PII (cuid, no email),
mais le membre-label `member-A1B2C3` :

- Élimine le risque qu'un Claude réponse copie-colle l'UUID dans un context
  ré-identifiable (jamais arrivé mais pourquoi prendre le risque).
- Améliore la lisibilité humaine du rapport (label court vs UUID 25 chars).

---

### Item 2 — `Trade.tradeQuality` enum

**Migration** : `prisma/migrations/{timestamp}_v1_5_trade_quality/migration.sql`

```sql
CREATE TYPE "TradeQuality" AS ENUM ('A', 'B', 'C');
ALTER TABLE "trades" ADD COLUMN "trade_quality" "TradeQuality";
CREATE INDEX "trades_user_id_trade_quality_idx" ON "trades"("user_id", "trade_quality");
```

**Schema Prisma** :

```prisma
enum TradeQuality {
  A  // setup parfait, conviction élevée, contexte favorable
  B  // setup correct, conviction moyenne, ou contexte mitigé
  C  // setup limite, conviction basse, ou doute sur le contexte
}

model Trade {
  ...
  tradeQuality TradeQuality? @map("trade_quality")
  ...
  @@index([userId, tradeQuality])
}
```

**Zod schema** : ajouter à `lib/schemas/trade.ts`

```ts
tradeQuality: z.enum(['A', 'B', 'C']).optional(),
```

**UI** : nouveau step dans `TradeFormWizard` (step 5b ou 6, à définir) avec
3 cards visuelles (A vert, B jaune, C orange). Tooltip explicatif basé sur
les définitions Steenbarger ("setup parfait" vs "setup correct" vs "setup
limite").

**Service layer** : `lib/trades/service.ts` — ajouter `tradeQuality` aux
input/output types. Aucun calcul dérivé en V1.5 (juste capture). En V2,
peut alimenter un nouveau scoring sub-component.

**Tests** : ~10 nouveaux Vitest (Zod parse, service create/update,
UI widget render).

**Why** : Steenbarger (_Daily Trading Coach_) recommande explicitement de
classifier la qualité du setup AVANT de prendre le trade, indépendamment
du résultat. Permet à Eliot de coacher : "tes B et C ont un win-rate 30 %
plus bas, pourquoi tu les prends ?".

---

### Item 3 — `Trade.riskPct` Decimal

**Migration** : même fichier que tradeQuality (`0009_v1_5_trade_quality_riskpct`)

```sql
ALTER TABLE "trades" ADD COLUMN "risk_pct" DECIMAL(4,2);
-- Pas d'index — rarely filtered, jamais joiné.
```

**Schema Prisma** :

```prisma
model Trade {
  ...
  /// Pourcentage du compte risqué sur ce trade (e.g. 1.50 = 1.5%).
  /// Optionnel — la formule canonique est riskPct = (entryPrice - stopLossPrice) * lotSize / accountBalance,
  /// mais on capture la valeur saisie par le membre pour permettre l'override
  /// (account balance peut varier — pas dans le schéma actuel).
  riskPct Decimal? @map("risk_pct") @db.Decimal(4, 2)
  ...
}
```

**Zod** :

```ts
riskPct: z.coerce.number().min(0).max(99.99).optional(),
```

**UI** : nouveau champ optionnel dans `TradeFormWizard` step 3 (Prix + Lot + SL).
Format suggéré : "% du compte risqué (optionnel)" avec placeholder "1.5".

**Tests** : ~5 nouveaux Vitest.

**Why** : règle d'or Tharp — "ne risquer plus de 1-2 % du compte par trade".
Capture `riskPct` permet :

- Audit individuel (Eliot voit immédiatement si un membre risque 5 % vs 1 %).
- En V2, sub-score `riskDiscipline` dans la dimension Discipline.
- Cohort analytics (distribution risk %, outliers à coacher).

---

## 4. Ordre d'attaque recommandé

1. **Investigation hook revert d'abord** (§6). Si on ne le résout pas, les
   constantes V1.5 risquent de subir le même destin.
2. **Item 1 (pseudonymisation)** — petit, isolé, low-risk. Bon échauffement.
3. **Item 2 (tradeQuality)** — migration + Prisma + types + Zod + UI + tests.
   ~1.5h en autonomie Claude.
4. **Item 3 (riskPct)** — même migration que #2 (1 seul fichier
   `0009_v1_5_trade_quality_riskpct/migration.sql`), réuse le schema
   Prisma update. ~30 min.

**Estimation totale** : 2.5–3 h en session autonome Claude (mantra long
appliqué + audits parallèles 3 subagents post-impl).

---

## 5. Décisions à prendre AVANT la session

- [ ] Position de `tradeQuality` dans le wizard : nouveau step 5b ? intégré
      step 4 ? choix Eliot.
- [ ] Tooltip exact pour A/B/C : Eliot rédige les 3 lignes en sa voix
      (pour respecter la posture cohérente avec le contenu Mark Douglas).
- [ ] Wizard step 3 — `riskPct` optionnel ou required si `stopLossPrice`
      présent ? Recommandation : optionnel partout pour ne pas casser le
      flow rapide.
- [ ] V1 vs V1.5 : faut-il backfiller `tradeQuality` sur les trades
      existants ? Recommandation : non, `null` est la bonne valeur.

---

## 6. Investigation mystère hook revert Phase V

### Symptôme observé Phase V (transcript ecstatic-visvesvaraya)

3 fichiers reverted automatiquement après Edit :

- `lib/scoring/scheduler.ts` (PUIS RE-APPLIQUÉ via commit `a968a20`)
- `lib/weekly-report/builder.ts` pseudonymisation (NON appliquée)
- `lib/triggers/schema.ts` DouglasEmotionTag (PUIS RE-APPLIQUÉ via commits
  `905d659` + `adf0aae`)

### Cause probable identifiée

[`D:\Fxmily\.claude\hooks\post_tool_fxmily.ps1`](../.claude/hooks/post_tool_fxmily.ps1)
invoque `prettier --write` async sur tous les fichiers `.tsx/.ts/.css/.json/.md/.jsx/.js`
après chaque Edit/Write/NotebookEdit.

**Hypothèse** : si Claude Edit une constante numérique (ex: `FULL_SCALE = 4`)
mais le fichier source contient `FULL_SCALE = 4 ;` avec un espace différent
ou une trailing comma, prettier reformate immédiatement après l'Edit. Si
Claude relit le fichier juste après son Edit (pour vérification), il voit
le formattage prettier (différent de ce qu'il a écrit) et perçoit ça comme
un revert.

### Plan d'investigation V1.5 (15 min)

```bash
# 1. Reproduire avec un fichier témoin
cd D:\Fxmily
echo "const TEST_CONST = 4 ;" > apps/web/src/test/__hook_revert_canary.ts

# 2. Lancer une session Claude Code minuscule sur D:\Fxmily, demander un Edit
#    qui remplace 4 par 5. Observer le résultat lecture immédiate.

# 3. Si revert observé : confirmer cause prettier via
docker compose exec -T web npx prettier --check apps/web/src/test/__hook_revert_canary.ts

# 4. Solution si confirmé : modifier post_tool_fxmily.ps1 pour SKIP les
#    fichiers Edit dans les 5 secondes post-Edit (anti-race), OU lancer
#    prettier en synchrone et NE PAS relire après Edit (canon Claude
#    Code 2026 — Edit retourne le state final, pas re-Read).
```

### Workaround pendant l'investigation

Pour les commits V1.5, **lancer prettier MANUELLEMENT après chaque Edit**
au lieu de laisser le hook agir :

```powershell
# Dans la session Claude Code
pnpm format        # reformate tout le repo en une passe
git diff           # vérifie ce que prettier a touché
git add -p         # stage sélectif
```

---

## 7. Quality gate pré-merge V1.5

```bash
cd D:\Fxmily
pnpm format:check
pnpm lint
pnpm type-check
pnpm test
pnpm --filter @fxmily/web prisma:generate
pnpm --filter @fxmily/web prisma:migrate dev --name v1_5_trade_quality_riskpct
pnpm build
pnpm --filter @fxmily/web exec playwright test  # E2E si UI changes
```

Tous verts → branche prête pour PR `feat(v1.5): trading expert calibration`.

---

## 8. Audit-driven hardening V1.5 (canon J5+ pattern)

3 subagents parallèles post-impl, focus :

- **`code-reviewer`** : diff complet `git diff main...HEAD`
- **`security-auditor`** : focus pseudonymisation + nouveau Zod input
- **`fxmily-content-checker`** : vérifier que les tooltips A/B/C
  respectent la posture éducative Mark Douglas (pas de "achète",
  pas de "ce setup est bon")

Triage : Critical → fix in-session, Major → fix si rapide, Minor → backlog
V1.6.

---

## 9. Branche, commits, PR

- **Branche** : `feat/v1.5-trading-calibration` (depuis `main` post-merge J10)
- **Commits suggérés (atomiques)** :
  ```
  feat(v1.5): pseudonymize userId in weekly-report builder
  feat(v1.5): add Trade.tradeQuality enum + UI step
  feat(v1.5): add Trade.riskPct optional field
  test(v1.5): add 18 Vitest covering pseudonymization + tradeQuality + riskPct
  docs(v1.5): close-out apps/web/CLAUDE.md + cohort observation note
  ```
- **PR title** : `feat(v1.5): trading expert calibration — pseudonymize + tradeQuality + riskPct`
- **PR body** : référencer ADR-001 + reproduire les 3 sources Tharp /
  Steenbarger / Trader Hub System.

---

## 10. Pickup prompt V1.5 (à coller post-`/clear`)

```
Implémente le V1.5 du SPEC à `D:\Fxmily\SPEC.md` — trading expert calibration
post-merge J10 (pseudonymisation builder + Trade.tradeQuality + Trade.riskPct).

PRÉ-REQUIS : PR #35 mergée + smoke prod validé. Vérifier git log -1 montre
le merge commit avant de démarrer.

Lis dans cet ordre :
1. SPEC.md §6.2 (Trade) + §7.3 (Journal de trading) + §7.5 (Track record analytics)
2. apps/web/CLAUDE.md sections J0→J10 close-out + V1.5 backlog
3. docs/jalon-V1.5-prep.md — briefing complet 10 sections
4. docs/decisions/ADR-001-scoring-constants-pragmatic-heuristics.md
5. memory MEMORY.md + fxmily_session_2026-05-09_smoke_prep_consolidated.md

Done quand :
- Vitest 770/770+ verts (~40 nouveaux tests V1.5)
- type-check + lint + build OK
- Smoke local : `/journal/new` → wizard step tradeQuality A/B/C → riskPct optionnel
  → trade créé avec les 2 fields → `/admin/reports` digest contient `member-XXXXXX`
- Migration `0009_v1_5_trade_quality_riskpct` appliquée local + prête prod

Stack inchangée vs J10 (Next 16.2.6, React 19.2.6, Prisma 7.8, Auth.js v5.0.0-beta.31).
PAS de migration vers Better Auth dans V1.5 — c'est V2 (cf v2-roadmap.md).

Phase α : Investigation hook revert (15 min) — cf docs/jalon-V1.5-prep.md §6.
Phase β : Pseudonymisation builder.ts + 3 tests Vitest — 30 min.
Phase γ : Migration + Trade model + Zod + service — 1h.
Phase δ : UI wizard step + tests + Playwright happy-path — 1h.
Phase ε : 3 subagents audit (code-reviewer + security-auditor + fxmily-content-checker)
  parallèles + triage findings — 30 min.
Phase ζ : Update apps/web/CLAUDE.md + memory + ADR si nouvelle décision.

Mantra long activé : pleine puissance, autonomie totale, perfection absolue,
control PC OK, anti-hallucination, smoke local obligatoire, fxmily content
checker pour tooltips A/B/C posture Mark Douglas.

Pas de pré-requis Eliot externe pour V1.5 (tout en code).
```
