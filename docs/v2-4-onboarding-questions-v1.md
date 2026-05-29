# V2.4 — Catalogue onboarding interview questions (instrument v1)

> **Statut** : `v1` figé immutable, livré 2026-05-28 (Session β Phase A.2 — M3 directive).
> **Code source** : `apps/web/src/lib/onboarding-interview/instrument-v1.ts`.
> **Tests** : `apps/web/src/lib/onboarding-interview/instrument-v1.test.ts` (pin item count + dimension count + question_index unique + all dimensions covered).
> **ADR** : `docs/decisions/ADR-004-onboarding-interview-instrument-v1.md` (à shipper CHECKPOINT 10).

## §1 — Vision & posture

Cet instrument v1 capture le profil profond d'un membre Fxmily au moment de son onboarding — au-delà du tracking quotidien V1 (DailyCheckin / Trade journal / MindsetCheck §27 / WeeklyReview §28). C'est un **deep-interview free-text** (vs Likert QCM mindset hebdo) que Claude (batch local Max, **Opus 4.8** par défaut depuis §8 — env-overridable `FXMILY_CLAUDE_MODEL`) analyse pour générer un `MemberProfile` lu par Eliot en admin.

**Mission directive M3 Eliot verbatim** (handoff α 2026-05-27) :

> _"à toi au début de poser le maximum de question pour faire le profil de chaque membre en utilisant claude pour analyser au plus deep et à la perfection chacun pour après qu'ils commence sur l'app de la meilleur façon possible chacun donc au moins à son profil et son espace sur l'app et moi admin je vois tout"_

**Posture invariante** (`SPEC.md` §2 + ADR-003 alignement) :

- ❌ Aucun conseil trade. Aucune analyse de marché.
- ❌ Aucun diagnostic clinique (`dépression`, `anxiété généralisée`, `trouble`, `pathologie` — bannis du prompt Claude ET du MemberProfile généré).
- ❌ Aucune référence Lhedge (système Eliot privé — `SPEC.md:1134,1235,1338` "Lhedge inconnu de l'assistant — JAMAIS l'inventer").
- ✅ Posture coaching mental Mark Douglas (process > outcome, 4 fears, 5 truths).
- ✅ Profile descriptif-comportemental, **pas clinique**.
- ✅ Posture athlète-coach (langage process, training, discipline).

## §2 — Architecture instrument v1 (30 questions / 12 dimensions / 3 phases)

### Phases (order survey-research evidence-based §M)

| Phase                | Items | Range qIdx | Objectif                                                              |
| -------------------- | ----- | ---------- | --------------------------------------------------------------------- |
| **Warmup**           | 4     | 0-3        | Biographique low-stakes → rapport-building + baisser garde sociale    |
| **Core**             | 22    | 4-25       | Dimensions psycho profondes — séquence moins sensible → plus sensible |
| **Reflective close** | 4     | 26-29      | Projet + ouverture finale "anything else" safety net                  |

### 12 dimensions

| ID                          | Label FR                     | Items | Source primaire                                        |
| --------------------------- | ---------------------------- | ----- | ------------------------------------------------------ |
| `parcours_trading`          | Parcours trading             | 2     | Steenbarger TP2.0 biographical anchoring               |
| `routines_hygiene`          | Routines & hygiène           | 2     | Douglas Disciplined Trader ch.8 (Mechanical stage)     |
| `uncertainty_acceptance`    | Acceptation de l'incertitude | 3     | Douglas TitZ ch.11 (5 truths #1/#3/#5)                 |
| `discipline_plan_adherence` | Discipline & plan personnel  | 3     | Douglas TitZ ch.11 (7 principles #4) + Steenbarger DTC |
| `formation_adherence`       | Respect système formation    | 1     | Onboarding-specific (distinct du plan personnel)       |
| `patience_anti_fomo`        | Patience & anti-FOMO         | 3     | Douglas TitZ ch.7 (4 fears #3 — FOMO)                  |
| `confidence_calibration`    | Confiance calibrée           | 3     | Douglas TitZ ch.11 (truth #4 + principles #1)          |
| `emotional_regulation`      | Régulation émotionnelle      | 3     | Lo & Repin 2002 + Douglas DT ch.2-3                    |
| `ego_result_detachment`     | Détachement & ego            | 3     | Douglas TitZ ch.4 (Consistency Paradox) + 4 fears #1   |
| `triggers_emotional`        | Déclencheurs émotionnels     | 3     | Douglas TitZ ch.5 + 4 fears qualitative                |
| `objectifs_psyche`          | Objectifs psychologiques     | 2     | Steenbarger TP2.0 self-assessment verbatim             |
| `coaching_preference`       | Style coaching préféré       | 2     | Onboarding-specific (admin calibration)                |

**Total : 30 items / 12 dimensions / 3 phases.**

## §3 — Catalogue verbatim 30 questions

> Format : `[qIdx] [phase] dimension_id — question FR`

### Phase 1 — Warmup (rapport-building biographique)

**[0] [warmup] parcours_trading** — `parcours_origin`

> Raconte comment tu es arrivé au trading — premier contact, premier compte réel, première fois où tu as su que ça allait devenir sérieux pour toi. 3-5 phrases.

**[1] [warmup] parcours_trading** — `parcours_history`

> Depuis combien de temps tu trades sérieusement (capital réel, pas démo) ? Combien de méthodes ou styles différents tu as testés avant celui d'aujourd'hui ?

**[2] [warmup] routines_hygiene** — `routines_day`

> Décris ta journée-type un jour où tu trades. De ton réveil à ton coucher. Sommeil, repas, sport, écran — pas idéal, réel.

**[3] [warmup] routines_hygiene** — `routines_presession`

> As-tu un rituel pré-session (les 5-30 min avant ta première analyse) ? Si oui, décris-le étape par étape. Si non, dis-le sans gêne.

### Phase 2 — Core (dimensions psycho profondes, sensibilité graduée)

#### uncertainty_acceptance (abstrait, low-stakes émotionnel)

**[4]** `uncertainty_two_outcomes`

> À quel point, si du tout, es-tu d'accord avec l'idée que "deux setups identiques peuvent donner deux résultats opposés sans que rien soit cassé dans ta méthode" ? Explique ton ressenti, pas seulement ton accord intellectuel.

**[5]** `uncertainty_last_surprise`

> Décris la dernière fois où le marché a fait l'inverse exact de ce que ton analyse prévoyait. Qu'est-ce que tu as ressenti dans les 5 minutes qui ont suivi ?

**[6]** `uncertainty_unknown_moment`

> Quand tu entres dans un trade, à quoi ressemble dans ta tête le moment où tu reconnais "je ne sais pas ce qui va se passer maintenant" ? Cette pensée arrive-t-elle, ou ton mental cherche-t-il toujours à prédire ?

#### discipline_plan_adherence (process personnel, low-stakes émotionnel)

**[7]** `discipline_plan_written`

> Écris-tu ton plan AVANT d'entrer (entry + stop + target chiffrés), ou se construit-il pendant le trade ? Sois honnête, pas idéaliste.

**[8]** `discipline_last10_count`

> Sur tes 10 derniers trades, combien ont été exécutés à 100% selon ton plan écrit (entrée, stop, target — pas de déplacement) ?

**[9]** `discipline_last_deviation`

> La dernière fois que tu as dévié de ton plan en cours de trade, c'était quand ? Qu'est-ce qui s'est passé dans les 30 secondes avant la déviation ?

#### formation_adherence (NEW dim — distinct du plan personnel)

**[10]** `formation_last10_count`

> Sur tes 10 derniers trades, combien ont suivi à 100% les règles du système que tu apprends dans la formation Fxmily — pas ton plan personnel, mais l'enseignement reçu ?

#### patience_anti_fomo (sensible moyenne)

**[11]** `fomo_last_impulsive`

> Décris la dernière fois où tu as pris une trade que tu savais pas idéale, juste parce que tu en avais marre d'attendre. Qu'est-ce que tu te disais juste avant de cliquer ?

**[12]** `fomo_missed_move`

> Quand tu vois un mouvement parti sans toi (gros mouvement déjà tracé), ressens-tu : (a) indifférence, (b) frustration brève, (c) urgence d'entrer quand même, (d) auto-blâme ? Détaille le dernier épisode.

**[13]** `fomo_chart_refresh`

> Combien de fois cette semaine, si du tout, as-tu rafraîchi tes graphiques "pour voir si quelque chose bouge" en dehors de tes sessions planifiées ?

#### confidence_calibration (métacognitif, sensible moyenne)

**[14]** `confidence_winrate_estimate`

> Imagine ton meilleur setup. Sur 100 fois ce setup, combien tu penses qu'il gagne ? Et tu te bases sur quoi pour ce chiffre — backtest chiffré, ressenti, ou estimation ?

**[15]** `confidence_aplus_feeling`

> Quand un setup A+ se présente, ressens-tu une certitude ("ça va marcher") ou une probabilité ("c'est mon meilleur cas, et c'est tout") ? La nuance compte.

**[16]** `confidence_winrate_real`

> Sur ton dernier mois, ton win-rate réel correspond-il à celui que tu estimais avant d'ouvrir ton suivi ? Quel a été l'écart ?

#### emotional_regulation (somatic + cognitif, sensible — body-located probes §M)

**[17]** `emotion_body_stress`

> Quand une trade te met en stress (drawdown intra-trade, signal contradictoire), où sens-tu ça dans ton corps ? Quelle est ta première réaction physique — respiration, tension épaules, posture ?

**[18]** `emotion_3_losses_thought`

> Quand tu enchaînes 3 pertes consécutives, quelle est la pensée la plus fréquente qui apparaît : "le marché est cassé", "ma méthode est cassée", "JE suis cassé", autre ?

**[19]** `emotion_recovery_ritual`

> As-tu des rituels (respiration, pause, walk-away) après un trade émotionnel, ou enchaînes-tu directement le suivant ? Décris le dernier épisode.

#### ego_result_detachment (identité, sensible+)

**[20]** `ego_pnl_mood`

> Après une journée verte, comment tu te sens vs après une journée rouge ? À quel point ton humeur du soir dépend du P&L du jour — sois honnête, pas idéaliste.

**[21]** `ego_win_feeling`

> Après un trade gagnant, ressens-tu une fierté personnelle ("j'avais raison") ou une neutralité ("le plan a fonctionné cette fois") ? Décris la nuance la plus récente.

**[22]** `ego_held_loser` (3rd-person reformulation §M)

> Beaucoup de traders gardent un loser ouvert plus longtemps que prévu "parce que ça devait revenir". Te souviens-tu d'une fois où ça t'est arrivé ? Qu'est-ce qui parlait à ce moment-là — la méthode ou ton besoin d'avoir raison ?

#### triggers_emotional (révèle douleur dominante, plus sensible)

**[23]** `triggers_worst_pain`

> Qu'est-ce qui te fait le plus mal en trading : prendre une perte sur une trade A+, rater un move que tu avais vu, sortir trop tôt d'un gain, ou être contrarian et avoir tort ? Pourquoi cette douleur-là plutôt qu'une autre ?

**[24]** `triggers_market_stress`

> Quelle situation de marché te met systématiquement le plus en stress — gap à l'ouverture, news, range serré, breakout violent ? Décris pourquoi.

**[25]** `triggers_avoided_setup`

> Y a-t-il un type de trade ou d'instrument que tu évites, alors qu'il colle techniquement à ta méthode ? Si oui, lequel et pourquoi — sois honnête sur le ressenti.

### Phase 3 — Reflective close (ouverture + projet)

**[26] [reflective_close] objectifs_psyche** — `objectifs_proud_12m`

> Si dans 12 mois tu te regardes trader et que tu es fier de toi, qu'est-ce que tu vois ? Pas un chiffre P&L — un comportement, un état, une posture.

**[27] [reflective_close] objectifs_psyche** — `objectifs_consistency_vs_pnl`

> Si tu trades pendant 6 mois et que ton P&L est à zéro mais que tu n'as PAS dévié de ton plan une seule fois, considères-tu ça comme un succès ou un échec ? Sois honnête.

**[28] [reflective_close] coaching_preference** — `coaching_style`

> Quand on te donne une consigne, préfères-tu : (a) le "quoi" sans le "pourquoi" pour exécuter vite, (b) le "pourquoi" détaillé pour internaliser, (c) un dialogue où tu construis le "pourquoi" toi-même ?

**[29] [reflective_close] coaching_preference** — `open_anything_else`

> Y a-t-il quelque chose qu'on n'a pas abordé dans ces questions et que tu veux qu'Eliot sache à ton sujet — sur ton trading, ta vie autour, ce qui te freine ou t'élève ? Pas obligatoire. Si rien : "rien" suffit.

## §4 — Best practices phrasing appliquées (§M evidence-based 2026)

| Pattern                           | Usage dans v1                                                                                                    | Exemples                                                                                                                                     |
| --------------------------------- | ---------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| **`if at all` qualifier**         | Évite implicit norm (pression sociale)                                                                           | [4] "À quel point, **si du tout**..." / [13] "Combien de fois cette semaine, **si du tout**..."                                              |
| **Past-specific anchoring**       | "the last time...", "describe a specific situation when..." → réduit SDB + reference bias                        | [5] "la dernière fois où..." / [9] "La dernière fois que..." / [11] "Décris la dernière fois où..." / [22] "Te souviens-tu d'une fois où..." |
| **Body-located probes**           | "Where do you feel that in your body" → bypass cognitive editing, accède au somatic (cohérent Lo & Repin physio) | [17] "**où sens-tu ça dans ton corps** ?"                                                                                                    |
| **Hypothetical projection**       | "Imagine que..." → réduit pression identité                                                                      | [14] "**Imagine** ton meilleur setup" / [26] "**Si dans 12 mois**..."                                                                        |
| **3rd-person reformulation**      | "Some traders feel X..." → mitigation SDB sur items sensibles                                                    | [22] "**Beaucoup de traders** gardent un loser ouvert..."                                                                                    |
| **Forgive-the-behavior phrasing** | Assume behavior → réduit honte                                                                                   | [11] "...juste parce que tu en avais marre d'attendre" (assumes l'impulsivité)                                                               |
| **Multiple-choice scaffolding**   | (a)/(b)/(c)/(d) options + free-text explication = balance précision + richesse                                   | [12] options FOMO / [18] options thought-pattern / [23] options pain dominante / [28] options coaching style                                 |

**Anti-patterns évités** :

- ❌ Leading questions ("Tu sais qu'il faut suivre ton plan, n'est-ce pas ?")
- ❌ Double-barreled ("Décris ta routine ET tes objectifs" — 2-en-1)
- ❌ Jargon-heavy sans définition
- ❌ Yes/no sur sujets nuancés en free-text
- ❌ Mots value-laden ("discipline" sans contexte — préférer "adherence to written plan")
- ❌ Questions sur conseils trade (interdit posture Fxmily §2)
- ❌ Diagnostics cliniques (interdit anti-clinical posture §J)

## §5 — Décisions design verrouillées

| #   | Décision                                                | Rationale                                                                                                                                                                                        |
| --- | ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1   | **30 questions** save-and-resume natif                  | Architecture Phase A.1 LIVE supporte déjà status `started/in_progress/completed` + `appendAnswer` upsert idempotent. Pas de split forcé. Manifesto §15 "poser le maximum de questions" préservé. |
| 2   | **Wording neutre coach FR**                             | Mark Douglas posture + §M phrasing best practices. Eliot peut ajuster pre-merge PR si besoin.                                                                                                    |
| 3   | **3 questions par dimension Douglas**                   | Équilibre 6 dims × 3 q = 18 q core Douglas + 4 dim auxiliaires (parcours/routines/formation/objectifs/coaching).                                                                                 |
| 4   | **1 question `formation_adherence` NEW dim**            | Capture info distincte du plan personnel (C5) — l'adhérence au système enseigné par Eliot. Formulation neutre sans nommer Lhedge (respect SPEC §1134/1235/1338).                                 |
| 5   | **Douglas 3-stages = grille INTERNE non membre-facing** | Claude infère le stade via patterns dans `MemberProfile.highlights[]`, JAMAIS question "à quel stade es-tu ?" (auto-évaluation biaisée + confusion Burch 4-stages).                              |
| 6   | **Order warmup → core → close**                         | Survey-research evidence-based §M (Sopact + Qualtrics 2026). Phase warmup baisse garde sociale, core graduée moins → plus sensible, close ouverte safety net.                                    |
| 7   | **INSTRUMENT_METADATA exporté** (dépassement §⑧)        | Traçabilité evidence-based : `{version, createdAt, author, primarySources}` pour audit + ADR-004 + RGPD ("comment le profil est-il généré ?").                                                   |
| 8   | **`coaching_preference` 12ème dim** (dépassement §⑧)    | §15 "moi admin je vois tout" → Eliot doit adapter SON coaching per-member. Cette dim permet à Claude d'inférer ET à Eliot de calibrer ses messages.                                              |

## §6 — Caveats sources hallucinées détectées (§M sub-agent)

Pour mémoire — si vous voyez ces sources citées ailleurs, **elles n'existent pas** :

| Source citée (FAUX)                              | Réalité                                                                                                                                                                                                                                         |
| ------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| "Trading Performance Index de 12 best practices" | **N'EXISTE PAS** dans Daily Trading Coach ni TP2.0. Le proche = ABCD framework + 57 best practices de TP2.0 (Wiley 2015), **pas numéroté en "12"**.                                                                                             |
| "Mark Douglas 5 stages"                          | **3 stages** (Mechanical/Subjective/Intuitive). Les 5 = Fundamental Truths, **distincts** des stages. Le modèle 4-stages "conscious/unconscious incompetence" est de **Noel Burch / Gordon Training International (années 1970)**, pas Douglas. |
| "Lefevre cognitive biases inventory"             | **N'EXISTE PAS** comme instrument validé. Confusion avec Edwin Lefèvre (auteur littéraire 1923, _Reminiscences of a Stock Operator_).                                                                                                           |

**GRIT-S caveat** (Duckworth herself, _J Personality Assessment_ 91:166-174, 2009) : auteure déconseille **high-stakes** (hiring/admission). Pour self-reflection (notre cas) : OK. Mais ne **jamais** en faire un gate d'admission Fxmily.

## §7 — Pipeline Phase A.2 downstream (CHECKPOINTS 4-12 prochaine sessions)

L'instrument v1 est consommé par :

1. **`apps/web/src/lib/onboarding-interview/claude-client.ts`** (CHECKPOINT 4) — Mock + Live carbone `weekly-report/claude-client.ts`. `claude --print --max-turns 1 --max-budget-usd 5.00` via Claude Max local Eliot.
2. **`apps/web/src/lib/onboarding-interview/prompt.ts`** (CHECKPOINT 4) — System prompt 4 blocks (Rôle/Format/Sécurité/Pseudonymisation) + JSON schema strict `MemberProfile {summary, highlights[], axes_prioritaires[]}` + 2-3 few-shot examples.
3. **`apps/web/src/lib/onboarding-interview/batch.ts`** (CHECKPOINT 5) — `loadAllSnapshotsForCompletedInterviews` (Promise.allSettled batches-of-5) + `persistGeneratedProfiles` (validation TWICE + active-user findMany check + crisis routing PRE-PERSIST + AMF regex post-gen + evidence substring NFC validation + idempotent upsert `MemberProfile.userId`).
4. **`apps/web/src/app/api/admin/onboarding-batch/{pull,persist}/route.ts`** (CHECKPOINT 6) — X-Admin-Token SHA-256 + adminBatchLimiter + 503/401/405/429.
5. **`apps/web/src/app/onboarding/interview/actions.ts:finalizeInterviewAction`** (CHECKPOINT 7 — dépassement §⑧) — Server Action wrapper + `after()` trigger batch async Next.js 16.
6. **`docs/decisions/ADR-004-onboarding-interview-instrument-v1.md`** (CHECKPOINT 10) — Evidence base : 11 sources primaires citées + posture + scope + alternatives rejetées.
7. **Tests TDD Vitest** (CHECKPOINT 9) — instrument integrity (30 items / 12 dims / questionIndex unique 0-29) + claude-client mock + prompt + service wire + AMF filter + crisis interrupt + idempotency + few-shot.

**MemberProfile output schema** (carbone Anthropic structured output §J) :

```json
{
  "summary": "string FR 100-800 chars (descriptif-comportemental, pas clinique)",
  "highlights": [
    {
      "key": "string (kebab-case)",
      "label": "string FR ≤80 chars",
      "evidence": ["string ≤200 chars (verbatim substring NFC d'answerText)"]
    }
  ],
  "axes_prioritaires": ["string FR ≤120 chars"]
}
```

**3 couches anti-hallucination** (§J Anthropic profilage) :

1. **Zod `.strict()` post-parse** — rejette extra keys du LLM
2. **Regex AMF post-gen** — `/(LONG|SHORT|BUY|SELL|achetez|vendez|strike|TP \d+|stop[- ]?loss à \d+|niveau de support)/i` → reject batch + `reportWarning('onboarding.batch', 'amf_violation')`
3. **Evidence substring validation NFC** — `validateEvidenceSubstring(highlight.evidence[i], concatAnswerTexts)` → reject batch si evidence non substring

**Crisis routing SKIP-PERSIST** (mirror V1.7.1 carbone weekly-report `batch.ts:410-440`) :

```ts
const crisisCorpus = [
  output.summary,
  ...output.highlights.flatMap((h) => h.evidence),
  ...output.axes_prioritaires,
].join('\n');
const crisis = detectCrisis(crisisCorpus);
if (crisis.level === 'high' || crisis.level === 'medium') {
  // skip-persist + audit onboarding.batch.crisis_detected + Sentry escalate
}
```

## §8 — Sources primaires citées (fair use FR L122-5 ≤30 mots verbatim per quote)

### Mark Douglas

- _Trading in the Zone_, Mark Douglas, Penguin/Prentice Hall, 2000.
- _The Disciplined Trader_, Mark Douglas, NYIF / Prentice Hall, 1990.

### Brett Steenbarger

- _Trading Psychology 2.0: From Best Practices to Best Processes_, Brett Steenbarger, Wiley, 2015.
- _The Daily Trading Coach: 101 Lessons for Becoming Your Own Trading Psychologist_, Brett Steenbarger, Wiley, 2009.

### Recherche académique trading psychology

- Lo, A.W. & Repin, D.V. (2002), "The Psychophysiology of Real-Time Financial Risk Processing", _Journal of Cognitive Neuroscience_ 14(3):323-339. NBER WP 8508.
- Fenton-O'Creevy et al. (Open University) — Emotion regulation and trader expertise.

### Psychometric instruments

- Duckworth, A.L. & Quinn, P.D. (2009), "Development and Validation of the Short Grit Scale (GRIT-S)", _Journal of Personality Assessment_ 91:166-174.
- Neff, K.D. (2003), "Development and Validation of a Scale to Measure Self-Compassion", _Self and Identity_ 2:223-250.
- Tellegen, A. & Waller, N.G. — Multidimensional Personality Questionnaire (MPQ).
- Rotter, J.B. (1966), Locus of Control Scale, _Psychological Monographs_ 80(1):1-28.

### Survey design

- Sopact 2026 — Open vs closed-ended questions, drop-off rate research.
- Qualtrics — Preventing survey drop-offs (12 min desktop / 9 min mobile thresholds).
- HubSpot — Ideal survey length.
- NORC Working Paper — Survey mode + socially undesirable responses.
- Wikipedia — Social-desirability bias (mitigation patterns).

### Anthropic Claude (profilage best practices 2025-2026)

- Claude Sonnet 4.6 announcement (Anthropic, Feb 2026).
- Claude Sonnet 4.6 System Card PDF (Feb 17, 2026).
- Anthropic prompt caching documentation.
- Anthropic structured outputs guide (`additionalProperties: false` + Zod-validate post-parse).

## §9 — Anti-régression invariants

| Invariant                                  | Test                                                                                       |
| ------------------------------------------ | ------------------------------------------------------------------------------------------ | ------- | ------- | ---------- | ----------- |
| **30 items exactement**                    | `CURRENT_ONBOARDING_ITEM_COUNT === 30`                                                     |
| **12 dimensions exactement**               | `CURRENT_ONBOARDING_DIMENSION_COUNT === 12`                                                |
| **questionIndex unique 0-29**              | Set sur items.map(i => i.questionIndex).size === 30                                        |
| **Tous items.dimensionId ∈ dimensions.id** | foreach item, dimensions.find(d => d.id === item.dimensionId) !== undefined                |
| **Toutes dimensions ont ≥1 item**          | foreach dim, items.some(i => i.dimensionId === dim.id)                                     |
| **Toutes phases couvertes**                | warmup count > 0, core count > 0, reflective_close count > 0                               |
| **`v1` immuable**                          | Si test échoue ici sans bump `v2` → INVARIANT BREACH (longitudinal-validity §27.7 carbone) |
| **0 mot clinique banni**                   | Aucun item.text contient `dépression                                                       | anxiété | trouble | pathologie | diagnostic` |
| **0 référence Lhedge**                     | Aucun item.text contient `lhedge` (insensitive)                                            |

À shipper CHECKPOINT 9 — `apps/web/src/lib/onboarding-interview/instrument-v1.test.ts` (Vitest).

---

**Version doc** : v1 (figée 2026-05-28). Tout changement de questions, dimensions, ordre, ou wording ⇒ bump `v2` + migration data MemberProfile (carbone V1.5 mindset §27.7 INVARIANT).
