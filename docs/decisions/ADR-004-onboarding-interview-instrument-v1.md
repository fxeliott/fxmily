# ADR-004 — Onboarding interview instrument v1 + Claude batch pipeline

- **Status** : Proposed (2026-05-28) — to be Accepted post-merge Phase A.2 + first cohort (~30 membres) MemberProfile generation successful + Eliot validates Mark Douglas posture in 5+ outputs.
- **Date** : 2026-05-28
- **Author** : Eliot Pena (Fxmily) — design + posture validation
- **Scope** : V2.4 Phase A.2 (Session β, M3 directive)
- **Supersedes** : N/A
- **Related** : ADR-003 (Pre-trade circuit breaker — Mark Douglas posture canon shared)

## Context

### M3 directive verbatim Eliot (handoff α 2026-05-27)

> _"à toi au début de poser le maximum de question pour faire le profil de chaque membre en utilisant claude pour analyser au plus deep et à la perfection chacun pour après qu'ils commence sur l'app de la meilleur façon possible chacun donc au moins à son profil et son espace sur l'app et moi admin je vois tout"_

### Posture invariante (SPEC §2 + V1.7.1 batch local Claude Max canon)

- ❌ Aucun conseil trade. Aucune analyse de marché (AMF/CIF compliance).
- ❌ Aucun diagnostic clinique (anti-clinical wording strict).
- ❌ Aucune référence Lhedge (`SPEC.md:1134,1235,1338` "Lhedge inconnu de l'assistant — JAMAIS l'inventer").
- ✅ Posture Mark Douglas (5 vérités, 4 peurs, 3 stages — _Trading in the Zone_ 2000 + _The Disciplined Trader_ 1990).
- ✅ Posture coaching mental Steenbarger (process > outcome, 57 best practices ABCD framework, _Trading Psychology 2.0_ 2015).
- ✅ Profile **descriptif-comportemental**, pas clinique.
- ✅ Pipeline IA = batch local Claude Max via `claude --print` (canon V1.7+) — pas d'API Anthropic payante (`SPEC.md:1177,1237`).

### Architecture existante (Phase A.1 LIVE prod, PR #189 `6fb410f`)

- 3 tables Prisma : `OnboardingInterview` (lifecycle started→in_progress→completed→abandoned) + `OnboardingInterviewAnswer` (free-text 10-2000 chars) + `MemberProfile` (Claude-generated summary + highlights + axes_prioritaires).
- 4 audit slugs `onboarding.interview.{started,answer_submitted,completed,abandoned}`.
- Service layer pure : `startInterview` (idempotent) / `appendAnswer` (sanitize + crisis detect) / `finalizeInterview` (idempotent status guard) / `getInterviewForUser` / `getProfileForUser`.
- Schemas Zod strict : safeFreeText + containsBidiOrZeroWidth + Trojan-Source hardening + question_key kebab-case + instrument_version regex.

### Décision attendue Phase A.2

Comment générer le `MemberProfile` Claude-analyzed à partir des 30 réponses free-text d'un membre qui a complété son onboarding ?

## Decision

### 1. Catalogue 30 questions FR figé immutable `instrument-v1.ts`

Sur 12 dimensions sourced Mark Douglas + Steenbarger + onboarding-spécifiques :

| Dimension                   | Items                | Source primaire (chapter)                                                                       |
| --------------------------- | -------------------- | ----------------------------------------------------------------------------------------------- |
| `parcours_trading`          | 2 (warmup)           | Biographical anchoring (Steenbarger TP2.0)                                                      |
| `routines_hygiene`          | 2 (warmup)           | Douglas DT ch.8 (Mechanical stage operational)                                                  |
| `uncertainty_acceptance`    | 3 (core)             | Douglas TitZ ch.11 (truths #1+#3+#5)                                                            |
| `discipline_plan_adherence` | 3 (core)             | Douglas TitZ ch.11 (7 principles #4) + Steenbarger DTC                                          |
| `formation_adherence`       | 1 (core)             | Onboarding-specific (NEW dim — distinct du plan personnel, neutral phrasing sans nommer Lhedge) |
| `patience_anti_fomo`        | 3 (core)             | Douglas TitZ ch.7 (4 fears #3 — FOMO)                                                           |
| `confidence_calibration`    | 3 (core)             | Douglas TitZ ch.11 (truth #4 + principles #1)                                                   |
| `emotional_regulation`      | 3 (core)             | Lo & Repin 2002 + Douglas DT ch.2-3                                                             |
| `ego_result_detachment`     | 3 (core)             | Douglas TitZ ch.4 (Consistency Paradox) + 4 fears #1                                            |
| `triggers_emotional`        | 3 (core)             | Douglas TitZ ch.5 + 4 fears qualitative                                                         |
| `objectifs_psyche`          | 2 (reflective_close) | Steenbarger TP2.0 self-assessment verbatim                                                      |
| `coaching_preference`       | 2 (reflective_close) | Onboarding-specific (admin coaching calibration)                                                |

**Total : 30 items / 12 dimensions / 3 phases (warmup 4 + core 22 + reflective_close 4).**

### 2. Phrasing best practices evidence-based (§M survey-research 2026)

Patterns appliqués dans les 30 questions :

- **`if at all` qualifier** → évite implicit norm (pression sociale)
- **Past-specific anchoring** (`"la dernière fois où..."` / `"Décris la situation"`) → réduit social-desirability bias + reference bias (Duckworth caveat)
- **Body-located probes** (`"où sens-tu ça dans ton corps"`) → bypass cognitive editing, accède au somatic (cohérent Lo & Repin 2002 physio)
- **Hypothetical projection** (`"Imagine que..."`) → réduit pression identité
- **3rd-person reformulation** items sensibles (`"Beaucoup de traders..."`) → mitigation SDB
- **Forgive-the-behavior phrasing** (`"...juste parce que tu en avais marre d'attendre"` assume comportement) → réduit honte
- **Multiple-choice scaffolding** (`(a)/(b)/(c)/(d) + free-text`) → précision + richesse

### 3. Pipeline Claude batch local Max ($0 marginal)

- **Modèle** : `claude-sonnet-4-6` via `claude --print` headless local sur machine Windows Eliot. **PAS Opus 4.7** (over-refusal 9% transcripts vs 1% Sonnet + 35 false-positive refusals avril 2026 — Anthropic system card).
- **Cache strategy** : `cache_control: { type: 'ephemeral', ttl: '1h' }` (90% rabais sur reads). Break-even = 4 reads, atteint trivialement avec 30 membres séquentiels.
- **Few-shot** : 2 exemples canoniques (`member-aaaaaaaa` + `member-bbbbbbbb` pseudonyms fictifs) dans `messages` array → ~18% gain anti-hallucination vs zero-shot (paper 2026).
- **System prompt 4 blocks** : (1) Rôle + posture / (2) Format strict / (3) Sécurité (anti-clinical wording) / (4) Pseudonymisation.
- **Wire architecture HTTP** : `/api/admin/onboarding-batch/{pull,persist}` (carbone V1.7.2 weekly-batch HTTP migration), authentification `X-Admin-Token` SHA-256 + timingSafeEqual + `adminBatchLimiter` (burst 10, refill 1/5min).
- **Trigger** : **MANUEL** via slash command `/onboarding-batch` (NEVER auto-trigger via `after()` — burst risk Anthropic + viole control humain Eliot M3).

### 4. 3 couches anti-hallucination MANDATORY (§J Anthropic profilage 2026)

| Couche                                          | Implémentation                                              | Action si fail                                                                             |
| ----------------------------------------------- | ----------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| 1. SDK structured-output JSON Schema            | `additionalProperties: false` partout (`prompt.ts:259-322`) | Claude doit corriger structure                                                             |
| 2. Zod `.strict()` post-parse                   | `memberProfileOutputSchema.parse` (`claude-client.ts:243`)  | Reject batch entry → `onboarding.batch.invalid_output` audit                               |
| 3. AMF + anti-clinical + evidence substring NFC | `safety.ts:runSafetyGate`                                   | Reject → `onboarding.batch.amf_violation` / `clinical_language` / `evidence_invalid` audit |

**Evidence-grounded mandatory** : chaque `highlight.evidence[i]` DOIT être verbatim substring NFC-normalisé d'une `answerText`. Carbone paper 2026 : _"the retrieved chunks contained the correct, citable source, but the model ignored it and fabricated a more impressive-sounding alternative"_ — structured-output garantit la structure, SEULE l'evidence substring NFC validation garantit la vérité.

### 5. Crisis routing SKIP-PERSIST sur output IA (mirror V1.7.1)

`detectCrisis(summary + flatMap(highlights.evidence) + axes_prioritaires)` AVANT persist :

- **HIGH** → skip persist + audit `onboarding.batch.crisis_detected` + `reportError` Sentry (page-out admin)
- **MEDIUM** → skip persist + audit + `reportWarning` (review next morning)
- **LOW** → persist + audit warning

Justification SKIP-PERSIST (≠ V1.8 REFLECT persist-anyway) : output IA dérivé pas member input direct. Skip empêche dashboard admin pollution + Sentry alert pour intervention out-of-band (3114 + SOS Amitié + Suicide Écoute FR resources).

### 6. Anti-clinical posture HARD REJECT (§J)

Mots bannis dans output IA : `dépression` (sauf "dépression du marché" trading slang exclu) / `anxiété généralisée` / `trouble psychotique|bipolaire|anxieux|dépressif|de la personnalité|TOC|TDAH|panique` / `pathologie` / `diagnostic`. Si Claude génère un de ces mots → safety gate REJECT + audit `onboarding.batch.skipped` reason=`clinical_language`.

**Rationale** : profile descriptif-comportemental, **pas clinique** (CNIL + HAS guidances IA santé mentale + AMF strict pour CIF). Paraphrase en langage athlète-coach (ex : "périodes de doute" plutôt que "anxiété", "phases de fatigue" plutôt que "épuisement").

### 7. Douglas 3-stages = grille INTERNE non membre-facing

Douglas (_The Disciplined Trader_ 1990 ch.8 p.65) propose **3 stages** : Mechanical → Subjective → Intuitive.

**NE PAS demander au membre "à quel stade es-tu ?"** — auto-évaluation biaisée + confusion avec le modèle Burch 4-stages "conscious/unconscious incompetence" (Gordon Training International 1970s, **PAS Douglas**) plus connu chez les débutants.

Au lieu de ça : **questions process indirect** (ex : "décris ta dernière entrée où tu as suivi ton plan à 100%" → mechanical signal ; "décris une entrée où ton ressenti a primé sur le plan" → subjective signal). Claude infère le stade vécu via patterns dans `MemberProfile.highlights[]`.

## Evidence base

### Mark Douglas (canon)

- **Trading in the Zone** (2000), Penguin/Prentice Hall :
  - ch.4 "The Consistency Paradox"
  - ch.5 "The Dynamics of Perception"
  - ch.7 "The Trader's Edge: Thinking in Probabilities" — **4 primary trading fears verbatim** : being wrong / losing money / missing out / leaving money on the table. _"Ninety-five percent of the trading errors […] will stem from your attitudes about being wrong, losing money, missing out, and leaving money on the table."_ (≤30 mots fair use FR L122-5).
  - ch.11 "Thinking Like a Trader" — **5 fundamental truths verbatim** + 7 principles "I am a consistent winner because" :
    1. _"Anything can happen."_
    2. _"You don't need to know what is going to happen next in order to make money."_
    3. _"There is a random distribution between wins and losses for any given set of variables that define an edge."_
    4. _"An edge is nothing more than an indication of a higher probability of one thing happening over another."_
    5. _"Every moment in the market is unique."_
- **The Disciplined Trader** (1990), NYIF / Prentice Hall :
  - ch.1-3 (motivations + responsibility + mental management)
  - ch.8 p.65 — **3 stages : Mechanical → Subjective → Intuitive**. Note : pages exactes [Eliot à vérifier sur sa copie — pdfcoffee.com PDF disponible mais pagination variable selon édition].

### Brett Steenbarger

- **Trading Psychology 2.0: From Best Practices to Best Processes** (Wiley 2015) — ABCD framework (Adapting / Building strengths / Cultivating creativity / Developing best practices) + 57 best practices. **Note critique** : il n'existe **PAS** de "Trading Performance Index de 12 best practices" précis dans Daily Trading Coach ni TP2.0 — le plus proche = "Five Best Practices for Effecting and Sustaining Change" (DTC ch.1 Lesson 10). À ne pas inventer.
- **The Daily Trading Coach: 101 Lessons for Becoming Your Own Trading Psychologist** (Wiley 2009).
- Verbatim self-assessment questions adaptées pour dim `objectifs_psyche` :
  - _"How, specifically, do you expect your market(s) to evolve over the next several years?"_
  - _"What, specifically, has been the greatest source of threat to your trading in the past year?"_

### Recherche académique trading psychology

- **Lo, A.W. & Repin, D.V. (2002)** — _"The Psychophysiology of Real-Time Financial Risk Processing"_, _Journal of Cognitive Neuroscience_ 14(3):323-339. NBER WP 8508. N=10 traders FX/IR derivatives Boston. Findings : (a) réactions physio significatives sur événements marché ; (b) traders expérimentés réagissent **moins** intensément que novices ; (c) volatilité élevée → SCR + HR plus forts. **Fondation théorique pour les body-located probes** (dimension `emotional_regulation` Q [17]).

### Instruments psychométriques (sources internes, NON membre-facing)

- **Duckworth, A.L. & Quinn, P.D. (2009)** — _"Development and Validation of the Short Grit Scale (GRIT-S)"_, _J Personality Assessment_ 91:166-174. 8 items, 2 sub-scales (Consistency of Interest + Perseverance of Effort), α=.85. **Caveats Duckworth herself** : fakeable, sujet au reference bias, **NE PAS utiliser en high-stakes** (hiring/admission). Pour self-reflection : OK. Fxmily onboarding usage : grille interne d'évaluation des réponses free-text, JAMAIS gate d'admission.
- **Neff, K.D. (2003)** — Self-Compassion Scale (SCS), 26 items, α=.92, 6 sub-scales en 3 paires opposées. Pertinent trading : after-loss self-talk = self-judgment vs self-kindness.
- **Big Five (OCEAN) trading research** — PMC10106518 (N=146) : Openness + Neuroticism élevés → returns > benchmark. NEO-FFI standard 60 items.
- **Sources rejetées** (hallucinated, NE PAS citer) :
  - "Lefevre cognitive biases inventory" → N'EXISTE PAS comme instrument validé peer-reviewed. Confusion avec Edwin Lefèvre (auteur littéraire 1923, _Reminiscences of a Stock Operator_).

### Survey design 2026 (drop-off + phrasing)

- Sopact (2026) — Open vs closed-ended questions, drop-off rate research.
- Qualtrics — Preventing survey drop-offs (12 min desktop / 9 min mobile thresholds).
- HubSpot — Ideal survey length (1-3 open-text typical, 30 = deep-interview defendable).
- NORC Working Paper — Survey mode + socially undesirable responses (3rd-person reformulation efficacy).
- arXiv 2512.22725 (2025) — Mitigating Social-Desirability Bias in silicon sampling.

### Anthropic Claude profilage 2025-2026 (§J)

- Claude Sonnet 4.6 announcement (Anthropic, Feb 17, 2026) + System Card PDF.
- Claude Sonnet 4.6 vs Opus 4.7 comparison — Opus 4.7 over-refusal 9% transcripts vs 1% Sonnet (système card) + 35 false-positive refusals reportés avril 2026.
- Anthropic prompt caching documentation — `cache_control: { type: 'ephemeral', ttl: '1h' }` 90% rabais.
- Anthropic structured outputs guide — `additionalProperties: false` + Zod post-parse double-net.
- Future Agi LLM Hallucination 2026 — _"the retrieved chunks contained the correct, citable source, but the model ignored it and fabricated a more impressive-sounding alternative"_.

## Alternatives considered + Why rejected

### Alt 1 — Likert QCM scale (carbone V1.5 mindset §27)

**Rejected** : perd richesse vs free-text deep-interview. V1.5 mindset = hebdo récurrent court (12 items Likert 1-5 figés). Onboarding = one-shot deep, motivation intrinsèque haute (membre paye). Free-text permet à Claude d'extraire patterns émergents non-anticipés.

### Alt 2 — Single session 90min unique

**Rejected** : drop-off risk élevé §M survey research (5-15% par tranche 10 questions ajoutées en single session). Architecture Phase A.1 LIVE prod supporte déjà `appendAnswer` upsert idempotent + status `started/in_progress/completed` → **save-and-resume NATIF**. Le membre peut quitter et revenir.

### Alt 3 — 5-stages Burch model "conscious/unconscious incompetence"

**Rejected** : factual error. Le modèle 4-stages "conscious/unconscious incompetence/competence" est de **Noel Burch / Gordon Training International (années 1970)**, **PAS Douglas**. Douglas propose 3 stages : Mechanical → Subjective → Intuitive (DT ch.8). Confusion fréquente chez les débutants. Si Eliot veut articuler les deux modèles, c'est une décision produit consciente à acter — mais pas une attribution canon à Douglas.

### Alt 4 — GRIT-S / SCS comme gate d'admission Fxmily

**Rejected** : Duckworth herself (2009) déconseille **high-stakes** (hiring/admission). Pour self-reflection (onboarding Fxmily) : OK comme grille interne. Mais ne **JAMAIS** en faire un seuil de passage. Le membre signe = consent. GRIT-S faible ≠ rejet — c'est un signal coaching pour Eliot.

### Alt 5 — Auto-trigger batch via `after()` Server Action

**Rejected** (auto-correction §⑧ post-CHECKPOINT 6) : 4 raisons :

1. **Ban-risk Anthropic** — burst patterns détectables. V1.7 canon = jittered manuel local Eliot.
2. **Cohorte timing** — 5 membres finalize simultanément → 5 `claude --print` parallèles = burst suspicious.
3. **Eliot control M3** — admin doit avoir la main pour review snapshots avant analyse.
4. **Test/dev complexity** — `after()` async = harder to test + timing issues.

**Décision** : trigger MANUEL via slash command `/onboarding-batch` exclusivement.

### Alt 6 — API Anthropic payante

**Rejected** : `SPEC.md:1177,1237` — Eliot refuse catégoriquement. Pipeline IA = batch local Claude Max via abonnement déjà payé. Cost marginal = 0€. Si futur scaling cohorte > 100 membres + Eliot accepte $-cost, prévoir migration `LiveOnboardingProfileClient` Sonnet 4.6 (cost estimé ~$0.022/membre × cohorte).

### Alt 7 — `MemberProfile` structuré différent

Considérés :

- `summary + risks + recommendations + patterns` (carbone V1.7 weekly-report) — **Rejected** : trop centré "risques" pour un profile onboarding qui doit révéler les forces autant que les défis.
- `summary + traits + strengths + weaknesses` — **Rejected** : language jugement ("weaknesses") pas aligné posture Mark Douglas process-language.
- `summary + highlights{key,label,evidence} + axes_prioritaires` (**chosen**) — Mark Douglas posture neutre + evidence-grounded mandatory + axes = action concrète Eliot.

### Alt 8 — `BatchResultEntry` avec `kind` discriminator

**Rejected** mid-CHECKPOINT 6 (cohérence avec batch.ts TypeScript union `'error' in entry` existant). Plain Zod `z.union` sans `kind` field — wire format minimal, TypeScript narrows via field presence. Voir `schemas/onboarding-interview.ts:230-260` rationale.

## Consequences

### Pros

- ✅ Profile descriptif-comportemental Mark Douglas-grounded
- ✅ Coaching Eliot per-member calibré (dim `coaching_preference` + `axes_prioritaires`)
- ✅ Cost **$0 marginal** via Claude Max local (Eliot subscription)
- ✅ Idempotent re-runs (pull filtre déjà-analyzed)
- ✅ Save-and-resume NATIF (architecture Phase A.1 supporte already)
- ✅ Pseudonymisation V1.5.2 (8-char hex SHA-256 + salt) — Anthropic ne voit JAMAIS email/userId réel
- ✅ 3 couches anti-hallucination défense en profondeur (SDK + Zod + AMF/clinical/evidence-NFC)
- ✅ Crisis routing SKIP-PERSIST mirror V1.7.1 — alerte Sentry pour intervention out-of-band
- ✅ Audit trail PII-free complet (10 audit slugs `onboarding.batch.*` + `member_profile.*`)
- ✅ Instrument v1 figé immutable = longitudinal-validity garantie (§27.7 INVARIANT)

### Cons / Risks

- ⚠️ 30 questions = ~30 min effort membre (drop-off risk mitigé save-and-resume + UX premium)
- ⚠️ Instrument v1 **figé immutable** = bump `v2` + migration MemberProfile data nécessaire pour tout changement futur (longitudinal-validity §27.7)
- ⚠️ Manual trigger Eliot (pas auto) = délai humain entre interview complete et MemberProfile généré (acceptable V1, candidate `after()` async path V2 si scaling)
- ⚠️ Claude Max single point of failure (Eliot machine offline = pipeline down). Mitigation : audit log `onboarding.batch.pulled` tracking + retry safe via idempotence
- ⚠️ Pseudonymisation 32-bit slice (V1.5.2 widening) = collision threshold ~77k membres (Phase A.2 V2 widening si scaling)
- ⚠️ Mark Douglas paraphrases page-exactes [Eliot à vérifier sur sa copie] — fair use FR L122-5 ≤30 mots respecté

### Trigger conditions pour status `Accepted` (post-merge)

- ✅ First cohort (~30 membres) onboarding completed
- ✅ First `/onboarding-batch` run successful (persisted ≥ 80% des entries)
- ✅ Eliot validates Mark Douglas posture in 5+ MemberProfile outputs (no AMF violation, no clinical wording, evidence verbatim verified)
- ✅ 0 `onboarding.batch.crisis_detected` HIGH detected (or all crisis paths handled out-of-band correctly)
- ✅ CI Phase A.2 PR ALL GREEN (6/6 + smoke prod 5/5)

### Trigger conditions pour `v2` bump (longitudinal-validity §27.7 cassée intentionnellement)

- 80%+ cohorte score < 30 OR > 70 sur une dimension (drift)
- Peer-reviewed empirical study post 2026-05 with calibration values
- ≥5 user complaints "le profil ne me correspond pas"
- V2 launch cohorte > 100 → full re-cal pass + add new dimensions
- Eliot decides to add LEARN/PROGRESS/DEBRIEF modules V2 = new dimensions + bump

## Honesty disclaimers

- **GRIT-S NOT high-stakes** — Duckworth caveat verbatim 2009 paper. Utilisé interne uniquement, JAMAIS gate d'admission.
- **"5 stages Mark Douglas"** = factually **3 stages** (Mechanical/Subjective/Intuitive). Le modèle 4-stages "conscious incompetence" est de Noel Burch (Gordon Training 1970s), pas Douglas. Sources internes Fxmily ne doivent pas confondre.
- **"Trading Performance Index de 12 best practices"** = **N'EXISTE PAS** dans Daily Trading Coach ni TP2.0. Le proche = ABCD framework + 57 best practices TP2.0 (Wiley 2015), pas numéroté en "12".
- **"Lefevre cognitive biases inventory"** = **N'EXISTE PAS** comme instrument validé. Confusion avec Edwin Lefèvre (auteur littéraire 1923).
- **Mark Douglas paraphrases sourcées chapter exact** — pages [Eliot à vérifier sur sa copie] pour fair use FR L122-5 ≤30 mots verbatim.
- **Page-exact attribution Mark Douglas DT 1990 ch.8 p.65** — confirmée LiquidityFinder source secondaire + Bookey, [Eliot à vérifier sur sa copie pour confirmation primaire].
- **Sonnet 4.6 NOT pinned** dans Sentry release auto-detection — `SENTRY_RELEASE` non explicitement set, defaults Git SHA CI auto-detection (non-bloquant V1).

## Sources primaires citées

### Mark Douglas

- _Trading in the Zone_, Mark Douglas, Penguin/Prentice Hall, 2000.
- _The Disciplined Trader_, Mark Douglas, NYIF / Prentice Hall, 1990.

### Steenbarger

- _Trading Psychology 2.0_, Brett Steenbarger, Wiley, 2015.
- _The Daily Trading Coach_, Brett Steenbarger, Wiley, 2009.

### Académique

- Lo, A.W. & Repin, D.V. (2002), _J Cognitive Neuroscience_ 14(3):323-339 — NBER WP 8508.
- Duckworth, A.L. & Quinn, P.D. (2009), _J Personality Assessment_ 91:166-174.
- Neff, K.D. (2003), _Self and Identity_ 2:223-250.

### Survey design + Anthropic profilage 2025-2026

- Sopact, Qualtrics, HubSpot, NORC Working Paper, arXiv 2512.22725.
- Anthropic Claude Sonnet 4.6 announcement + System Card (Feb 17, 2026).
- Future Agi LLM Hallucination 2026 paper.

## ADR-004 audit trail

- **2026-05-28** — Proposed (Eliot Pena, Session β Phase A.2).
- **TBD** — Accepted post-merge + first cohort validation.
- **TBD** — Superseded by ADR-XXX (next instrument version bump v2).

## Related ADRs

- **ADR-001** (2026-05-09 Accepted) — Scoring constants pragmatic heuristics. Even cadre INTERNE pour `MemberProfile.highlights[]` evaluation Eliot.
- **ADR-002** (2026-05-09 Proposed) — V2 calibration prop-firm empirical. Not yet triggered.
- **ADR-003** (2026-05-27 Accepted) — Pre-trade circuit breaker anti-FOMO. **Mark Douglas posture canon shared** (4 fears + 5 truths) — onboarding interview v1 réutilise + étend (3 stages DT ch.8 + 7 principles "I am a consistent winner" + Steenbarger TP2.0 ABCD).
