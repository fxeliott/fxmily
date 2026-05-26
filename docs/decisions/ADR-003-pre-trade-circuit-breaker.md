# ADR-003 — Pre-trade circuit breaker (Mark Douglas anti-FOMO + Gollwitzer if-then implementation intentions)

- **Status** : Proposed (2026-05-26) — to be Accepted after Eliot review + Session BB ship.
- **Supersedes** : nothing.
- **Authors** : Claude Code (Session BB pre-code researcher subagent + main agent synthesis) + Eliot Pena (review pending).
- **Related** : [SPEC.md §2](../../SPEC.md) posture · [`docs/FXMILY-V2-MASTER.md` §6 module ROUTINE + §9 features O3/B1](../FXMILY-V2-MASTER.md) · [`memory/auto_session_resume.md` §4](C:/Users/eliot/.claude/projects/D--Fxmily/memory/auto_session_resume.md) Session BB brief canon.

---

## Context

The concept `pre_trade_circuit_breaker` (anti-FOMO pre-trade pause) does **NOT** exist in `SPEC.md` (§1-28) nor in `docs/FXMILY-V2-MASTER.md` §9 features inventory. The closest entries in the master are :

- **O3-D** _Pre-trade checklist modal_ (master §10.O ligne 296) — too generic, no Douglas anchoring
- **B1-M** _Pre-trade hesitation_ (master §10.B ligne 244) — V2.0 feature track, descriptive only
- **§O Module ROUTINE pre-trade rituel** (master :294-296) — backlog category, not a specific implementation

The concept was surfaced by the Session AA web research subagent (2026-05-25) when Eliot triggered "exploite tes capacités... maximum ultra parfait". The subagent recommended 4 TIER 1 evidence-strongest low-friction jalons (auto_session_resume §10) ; `pre_trade_circuit_breaker` ranked #1 because :

1. Strongest causal evidence base (Gollwitzer if-then meta d=0.65) of any jalon proposed
2. Lowest friction (~30s vs 5min) → highest expected member adoption
3. Targets the 4 Mark Douglas "primary trading fears" directly — perfectly aligned with [SPEC §2](../../SPEC.md) posture invariant
4. Greenfield (no `PreTradeCheck*` in current Prisma schema — grep 0 hit)
5. Backend-first compatible (Prisma migration + service + tests + UI wizard pattern carbone J5 DailyCheckin)

This ADR exists to **formalize the decision before code**, so the concept is traceable in the source-of-truth tree and not re-litigated session-by-session.

---

## Decision

We **build** `pre_trade_circuit_breaker` as a V2.3 jalon (Session BB ship target 2026-05-26, ~3-5h dev + deploy).

### Scope V1 (atomic, §18.4 strict)

1. **Migration Prisma** `20260526100000_v2_3_pre_trade_check` — 2 enums (`PreTradeReason`, `PreTradeEmotion`) + 1 model `PreTradeCheck` + relation `User.preTradeChecks` cascade + index `[userId, createdAt DESC]`.
2. **Schemas Zod** `lib/schemas/pre-trade-check.ts` — instrument frozen, `.strict()`, 4 fields (`reasonToTrade` + `emotionLabel` + `planAlignment` boolean + `stopLossPredefined` boolean). **NO free-text** → no `safeFreeText` needed → no crisis surface → no `*.crisis_detected` audit slug.
3. **Service** `lib/pre-trade/service.ts` — `createPreTradeCheck` + `listRecentPreTradeChecks` (cap 100) + `linkRecentCheckToTrade(window 15min, P2002-safe via WHERE linkedTradeId IS NULL)`.
4. **Server Action** `app/pre-trade/actions.ts` — pattern J5 carbone : `auth()` re-check + `safeParse` + service + `logAudit('pre_trade_check.created', PII-FREE metadata)` + `revalidatePath` + `redirect('/?done=1')` NEXT_REDIRECT re-thrown.
5. **UI wizard** `components/pre-trade/pre-trade-wizard.tsx` — 4 steps Framer Motion `<AnimatePresence mode="wait">`, ZERO free-text inputs, **full-page wizard** (not modal — see Alternatives §3), no Skip button (friction IS the feature).
6. **2 triggers UI** :
   - **Trigger A** : Card dédiée `/dashboard` au-dessus du Journal de trading section (visible immédiate, posture pré-décision)
   - **Trigger B** : Step 0 optionnel du wizard `/journal/new` (intégré flow journal)
7. **Audit slug** `pre_trade_check.created` — single slug, PII-free metadata `{checkId, reasonToTrade, emotionLabel, planAlignment, stopLossPredefined, linkedTradeId?: null}`.
8. **Auto-link** wire dans `createTrade*` + `closeTrade*` Server Actions (call `linkRecentCheckToTrade` post-create).

### Out-of-scope V1 (explicit non-goals)

- ❌ No Mark Douglas card auto-delivery trigger based on PreTradeCheck patterns (e.g. "5 fomo last 7d → fiche peur-de-rater") — reserved for Sessions CC+
- ❌ No dashboard analytics widget (distribution `reasonToTrade` 30j, plan alignment rate, etc.) — reserved Sessions CC+
- ❌ No admin tab `/admin/members/[id]?tab=pre-trade` (pseudonymized view) — reserved V1+
- ❌ No correlation `pre_trade × trade outcome` (V2.x extension of `habit-trade-correlation` pattern)
- ❌ No Capacitor haptic confirmation per option-tap (V2 — Capacitor deferred per Session U)
- ❌ No `MAX_CHECKS_PER_DAY` enforcement (no Black Hat coercion — let the member self-regulate)

---

## Evidence base

### Implementation intentions — Gollwitzer & Sheeran 2006

- **Meta-analysis** : 94 independent studies, n = 8 461, Cohen's d = **0.65** (CI 95% [0.6, 0.7]). Published in _Advances in Experimental Social Psychology_, vol. 38, pp. 69-119. URL : [PMC4500900](https://pmc.ncbi.nlm.nih.gov/articles/PMC4500900/).
- **Mechanism** : if-then plans (`"Si [cue], alors [action]"`) increase **prospective memory cue accessibility** and **automate decision execution**, reducing cognitive load at the impulsive-decision moment.
- **Updates** :
  - Sheeran et al. 2024 — _European Review of Social Psychology_ — **642 tests** meta. URL : [Taylor & Francis](https://www.tandfonline.com/doi/abs/10.1080/10463283.2024.2334563).
  - Gollwitzer & Sheeran 2025 — _Annual Review of Psychology_ 76:303-328. URL : [Annual Reviews](https://www.annualreviews.org/content/journals/10.1146/annurev-psych-021524-110536).
- **Application to trading** : the pre-trade wizard IS the implementation intention rendered operational UI. Format canonique : `"Si [cue = j'ouvre un chart pour entrer un trade], alors [action = je remplis le wizard 4 questions 30s]"`.

### Mark Douglas — 4 primary trading fears

Verbatim source (_Trading in the Zone_, Mark Douglas, 2000) :

> _"Ninety-five percent of the trading errors you are likely to make—causing the money to just evaporate before your eyes—will stem from your attitudes about being wrong, losing money, missing out, and leaving money on the table. What I call the four primary trading fears."_

The 4 fears, confirmed via 4+ concordant secondary sources :

1. **Fear of being wrong**
2. **Fear of losing money**
3. **Fear of missing out** (FOMO)
4. **Fear of leaving money on the table**

Source : _Trading in the Zone_, ch. 7-8 [TBD — exact chapter not confirmed from a paid copy ; PDF mirror at [fxf1.com](https://dl.fxf1.com/books/english/Trading_in_the_Zone.pdf) is unofficial, used only to cross-check verbatim. Eliot to verify against owned copy.]

### `PreTradeReason` enum mapping — honest disclosure

| Enum value | Theoretical anchor                                                          | Notes                                                                                                                                                                                                                   |
| ---------- | --------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `edge`     | **Absence of the 4 fears** — setup conforme to plan, state-neutral entry    | Direct Douglas (the "zone" itself, ch. 1)                                                                                                                                                                               |
| `fomo`     | **Fear of missing out**                                                     | Direct 1:1 Douglas                                                                                                                                                                                                      |
| `revenge`  | **Fear of being wrong** (re-prove) + **Fear of losing money** (recoup loss) | Mixed mapping — covers 2 of the 4 Douglas fears simultaneously, not 1:1                                                                                                                                                 |
| `boredom`  | **Steenbarger "low arousal" affect** — _NOT_ one of Douglas's 4 fears       | Extension citée hors-Douglas-canonique : Brett Steenbarger, _The Daily Trading Coach_, Lesson 23 ("Find Your Calling") + _Enhancing Trader Performance_. Documented honestly per CLAUDE.md `calibrated refusal` policy. |

**Why keep `boredom` despite the theoretical gap** :

- The 4th Douglas fear ("leaving money on the table") describes a post-trade emotion, not a pre-trade trigger to enter — it's hard to operationalize as a pre-trade self-assessment option.
- Steenbarger's "boredom trading" (entering for stimulation, not edge) is a documented retail pattern in _The Daily Trading Coach_ and is more actionable in a pre-trade context.
- Renaming `boredom → leaving_money` would distort the underlying meaning the wizard captures.
- Adding a 5th enum value (`leaving_money` distinct) would inflate friction beyond the 30s target.
- **Trade-off accepted** : strict Douglas fidelity ↓ vs operational accuracy + member adoption ↑.

### `PreTradeEmotion` enum

Validated by the Russell-Weiss-Mendelsohn 1989 affect grid (valence × arousal 2×2). The 4 options map to the 4 quadrants :

- `calme` (low arousal, positive valence)
- `excite` (high arousal, positive valence)
- `frustre` (high arousal, negative valence)
- `anxieux` (low-to-medium arousal, negative valence)

Reference : Russell, Weiss & Mendelsohn (1989) — _Journal of Personality and Social Psychology_, 57(3), 493-502.

---

## Alternatives considered

### Alt 1 — Modal vs full-page wizard

**Rejected modal**. Mobile users (iPhone SE / iPhone 15 priority) can swipe-down-dismiss a modal in <500ms with zero friction — this defeats the entire point of the circuit breaker. Full-page wizard at `/pre-trade/new` makes the friction structurally enforced.

### Alt 2 — Bloquant vs non-bloquant

**Non-bloquant kept** (Session BB Q1=D Card dashboard + Step 0 wizard journal combined). The member remains master of their decision — Fxmily NEVER blocks a trade. Per master §29 R1 invariant, blocking a trade would cross the AMF/FCA "personalized advice" line. The wizard is a **mirror**, not a gate.

### Alt 3 — Skip button on each question

**Rejected**. Per UX research subagent finding : "the friction IS the feature". A Skip button creates a silent-skip backdoor that defeats the cognitive-pause mechanism. The 4 questions are 1-tap each — total friction ~30s — under the threshold where users build abandonment habit.

### Alt 4 — `MAX_CHECKS_PER_DAY` rate limit

**Rejected**. No Black Hat coercion. The member self-regulates. If a member fills 50 checks/day, that's data Eliot can use as a coach (compulsive trading flag), not a system the app should silently block.

### Alt 5 — Auto-link window N

**A (15min) kept** vs B (30min) vs C manual checkbox vs D no-link. 15min matches the typical retail decision-to-entry latency on intraday timeframes. P2002-safe via `WHERE linkedTradeId IS NULL` predicate in the UPDATE.

---

## Trade-offs

| Trade-off                      | Choice                                      | Rationale                                              |
| ------------------------------ | ------------------------------------------- | ------------------------------------------------------ |
| Strict Douglas fidelity ↓      | `boredom` enum kept (Steenbarger extension) | Operational accuracy ↑, adoption ↑, documented honesty |
| Pre-trade UX friction ↑        | 4 questions × 1-tap = ~30s                  | Friction is the feature (Gollwitzer cue accessibility) |
| Member can't dismiss           | Full-page wizard, no Skip                   | Anti-FOMO core mechanism                               |
| No card-trigger correlation V1 | Out-of-scope V1                             | Atomic §18.4, ship base first, extend Sessions CC+     |
| No dashboard analytics V1      | Out-of-scope V1                             | Idem                                                   |

---

## Trigger for re-evaluation

- **≥30 members × ≥3 months** of `PreTradeCheck` data → cohort distribution analysis :
  - If <10 % of trades have a linked `PreTradeCheck` → adoption failure, redesign UX (modal vs persistent FAB vs onboarding tour)
  - If >50 % `reasonToTrade=fomo` or `=revenge` → high signal, consider auto-deliver Mark Douglas cards (Sessions CC+ jalon)
- **Eliot review trigger** : 5+ members report the wizard as "annoying" → reconsider friction (4 questions → 3, or 30s → 20s)
- **Empirical re-anchor** : if a peer-reviewed trading-specific implementation-intentions study (vs Gollwitzer general d=0.65) lands 2026-2027, recalibrate evidence claims.

---

## Sources cited

- Gollwitzer & Sheeran 2006 — [PMC4500900](https://pmc.ncbi.nlm.nih.gov/articles/PMC4500900/)
- Gollwitzer & Sheeran 2025 — [Annual Review of Psychology](https://www.annualreviews.org/content/journals/10.1146/annurev-psych-021524-110536)
- Sheeran et al. 2024 — [European Review of Social Psychology](https://www.tandfonline.com/doi/abs/10.1080/10463283.2024.2334563)
- Douglas — _Trading in the Zone_, 2000 (verbatim 4 fears, ch. 7-8 [TBD exact ch.])
- Steenbarger — _The Daily Trading Coach_, 2009 ([Wiley](https://www.wiley.com/en-us/The+Daily+Trading+Coach%3A+101+Lessons+for+Becoming+Your+Own+Trading+Psychologist-p-9780470398562)) — boredom trading extension
- Russell, Weiss & Mendelsohn 1989 — affect grid 2×2 _J. Personality & Social Psychology_ 57(3):493-502

**Honesty disclaimer** : `boredom` is not a Douglas-canonical 4 fear (see mapping table above). Sentiment quadrants are research-anchored but the specific 30s friction target is heuristic, not empirically validated for trading apps (Openwebsolutions 2026 blog cited UX pattern is not peer-reviewed). Re-validate post-cohort observation (trigger above).
