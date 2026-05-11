# V1.7 — Pickup prompt opérationnel (à utiliser APRÈS V1.6 polish mergée)

> Brief généré 2026-05-11 fin de session reprise contexte (Rounds 1-5).
> **Pré-requis** : V1.6 polish mergée + Cron Watch 7j green continu + Sentry <50 events/j baseline.

## Contexte court

V1.7 = **REFLECT + extensions North Star + Anthropic LIVE activation**. ~10-12h dev (1 session). C'est le 1er jalon "feature" post-stabilisation V1.6. Trigger : feedback positif cohorte pilote V1 + M4/M5/M6 résolus.

## 🛑 Pré-requis Eliot non-déléguables AVANT démarrer V1.7

Le master V2 §23 documente **10 manques M1-M10 non-délégables à Claude**. 3 sont **BLOQUANTS V1.7** :

### M4 — LA métaphore Fxmily (CRITIQUE)

WHOOP = coach fitness. Headspace = guide méditation. Calm = bedside companion. **Fxmily = ?**

Options à arbitrer Eliot (par interview `/spec` ou directement) :

- A. "Le carnet du trader discipliné" (passive, journal)
- B. "Ton coach process en arrière-plan" (athletic mindset, Steenbarger)
- C. "Le miroir de ton exécution" (introspection, Mark Douglas)
- D. "Ton scoring de discipline mesurable" (data-driven, dashboard)

Sans métaphore = pas d'attachement émotionnel = churn rapide.

### M5 — LE rituel quotidien central (CRITIQUE)

**Quand le membre ouvre Fxmily chaque jour, quoi de central ?**

Options :

- A. Morning check-in (7-9h, état émotionnel + intention jour)
- B. Pre-trade modal (avant session, plan + risque max)
- C. Post-trade reflection (immédiat après chaque trade, 30s)
- D. Evening recap (20-22h, gratitude + leçon)

Avec quelle **friction maximale acceptable** ? (30s ? 2 min ? 5 min ?)
Sans rituel central = app accessoire = usage sporadique.

### M6 — LE wow moment (CRITIQUE)

**Quel moment fait dire au membre "wow, ça vaut le coup d'utiliser Fxmily" ?**

Candidats :

- A. Rapport hebdo IA dimanche soir personnel (déjà LIVE V1, à valoriser)
- B. Pattern detection auto ("J'ai détecté un revenge trade chez toi 3 fois cette semaine")
- C. Score discipline qui grimpe semaine après semaine (visualisation)
- D. Fiche Mark Douglas qui arrive AU BON MOMENT après 3 pertes consécutives (déjà LIVE V1, à valoriser)
- E. Coach Eliot debrief 1-1 trimestre (V2.0 DEBRIEF)

Sans wow moment = pas de viral word-of-mouth = pas de croissance.

## Knowledge absorbed (Round 4 web research 2024-2026)

### Mark Douglas + Steenbarger 2025 (modern coaching)

- **Reverse-journaling Steenbarger août 2025** : "qu'as-tu fait quand le problème ne s'est PAS produit ?" plus puissant que "what went wrong". Implementer `CheckIn.bestPractice` optionnel + CBT 4 colonnes A/B/C/D.
- **Decision fatigue neurobiologique** : mesurable, corrélée éthique compromise. Implementer `fatigue_score` proxy (nb trades/jour + heure dernier check-in + sommeil self-report).
- **Convergence trading/gambling assumée** (Frontiers Psychiatry systematic review 2025) : 31% suicidal ideation chez gambling disorders (APA 2024 meta-analyse).

### Anthropic LIVE coaching (sub B)

- **System prompt hardening** : framer Claude comme "coach non-clinique" + scope explicite + negative examples + anti-sycophantie + crisis routing rules. **Utiliser Anthropic Petri (open-sourced 2025) pour audit pré-release**.
- **Prompt injection defense** : structured message blocks (typed grammar) — JAMAIS `f"system: {sys}\nuser: {input}"` concat.
- **Prompt caching weekly reports** : `cache_control: {type:'ephemeral', ttl:'1h'}` (5min ne suffit pas, workload sporadique 7j). Stack avec Batch API 50% off → jusqu'à 95% savings.
- **Decision API direct vs Bedrock EU** : API direct US OK V1.7 weekly reports async **uniquement si** (1) inputs pseudonymisées avant envoi, (2) ZDR enterprise tier, (3) bannière transparence, (4) DPA signée. V2 chatbot synchrone = **Bedrock EU Frankfurt obligatoire**.

### Régulation 2026 (sub A)

- **AMF factsheet janvier 2026 + FCA FG24/1** : "not financial advice" **n'est PAS un bouclier**. Signaux/trade calls dans formation = advice non autorisé.
- **EU AI Act limited risk transparency obligation** : deadline **2 août 2026**. Pénalités jusqu'à €35M ou 7% CA mondial.
- **CA SB 243** (effet 1 jan 2026) : annual reports si déploiement US.

### Recherche scientifique (sub C)

- **Rupprecht 2024 PPR** : effet g=0.64-0.70 acquis avec 10-15 min suffisent. Checklist 5-7 items.
- **CFA Biais 2026 = 15 (pas 21)** : 9 Cognitive (corrigeables) + 6 Emotional (LESSOR mnémo : Loss aversion, Endowment, Self-control, Status quo, Overconfidence, Regret aversion — adaptables seulement).
- **Retention benchmarks** : 30% J30 = leader (CashWalk). Pour Fxmily formation payante, benchmark = WHOOP-like (lock-in subscription).

## Scope V1.7 (clarifié Round 12 master V2)

### Items DÉJÀ LIVE V1/V1.5 — à RETIRER du scope V1.7

- ~~Trade.tradeQuality A/B/C~~ → LIVE V1.5
- ~~Trade.riskPct Decimal(4,2)~~ → LIVE V1.5
- ~~Disclaimer AMF~~ → LIVE V1 J10 Phase A (`/legal/*`)

### Items réels V1.7

1. **Migration 1** : `RoutineTemplate` + `RoutineCompletion` + `HabitLog`
2. **Migration 1bis** : `AdminBroadcast` + `BroadcastReceipt`
3. **`Trade.tags`** multi-select : revenge / fomo / overconfidence / oversizing / exit-too-early / discipline / paid-attention
   - Distinct de `tradeQuality` (qualité setup pre-outcome) — tags = patterns émotionnels post-outcome
4. **`Trade.outcomeR`** : Decimal pour journaling outcome précis (réutilise existant ?)
5. **Scoring V1.7** : `routineCompliance` + `tagPenalty` ajoutés dimension discipline
6. **Anthropic LIVE activation** :
   - Poser `ANTHROPIC_API_KEY` prod `/etc/fxmily/web.env`
   - Garde-fous §30 master V2 (7 obligatoires)
   - Cost circuit-breaker $25/mois
   - `cache_control` 1h activé weekly reports
7. **Trigger engine** evaluators sur tags : nouveau pattern detection
8. **Cooldown intelligent** : `MarkDouglasDelivery.view_duration_ms` tracking
9. **WeeklyReview** model séparé + wizard dimanche
10. **Post-trade prompt contextuel** : 30 items Eliot-authored
11. **ReflectionEntry** model séparée

### Decisions architecturales V1.7

| Décision                              | Recommandation                                                       |
| ------------------------------------- | -------------------------------------------------------------------- |
| Anthropic API US direct vs Bedrock EU | **API direct US** avec 4 garde-fous (V2 chatbot synchrone = Bedrock) |
| Trade.tags storage                    | **String[]** Postgres array natif (pas table jointure V1.7)          |
| Reverse-journaling Steenbarger        | **Inclure** `WeeklyReview.bestPractice` optionnel                    |
| Fatigue_score scoring                 | **Defer V1.8** (manque data routine compliance V1)                   |
| CFA Biais self-assessment             | **Defer V1.9** (LEARN module)                                        |

## Subagents à invoquer

1. **Début session** : `fxmily-jalon-tracker`
2. **AVANT toute migration** : skill `/fxmily-prisma-migrate` BLOQUANT
3. **Pendant impl Anthropic LIVE** :
   - `security-auditor` (system prompt hardening + prompt injection)
   - `fxmily-content-checker` (audit posture Mark Douglas BLOQUANT)
4. **Fin session 4 subagents parallèles** :
   - `code-reviewer`
   - `security-auditor`
   - `verifier`
   - `fxmily-content-checker`
5. **Avant `/clear` final** : `/fxmily-deliver-jalon`

## Tests obligatoires V1.7

- Vitest baseline 750 + 30-40 nouveaux (trigger evaluators V1.7 TDD)
- Playwright E2E nouveau spec `tests/e2e/weekly-review-wizard.spec.ts`
- Anthropic LIVE smoke : 1 weekly report live cost <€0.10 + qualité posture audit

## Critères "Done quand" V1.7

- WeeklyReview wizard dimanche utilisable (3 membres minimum)
- Trade.tags fill rate >60% sur 10 trades post-V1.7
- Anthropic LIVE actif <€15/mois cap
- Crisis detection ressources externes intégrées (3114 + SOS Amitié + Joueurs Info Service)
- Tous Vitest verts
- 4 subagents audit OK
- `code-reviewer` post-impl validé
- `/fxmily-deliver-jalon` exécuté AVANT `/clear`

## Posture absolue

- **Mark Douglas non-négociable** : pas de conseil trade, oui exécution + psycho
- **AMF/FCA red lines** : `fxmily-content-checker` BLOQUANT sur TOUT contenu user-facing
- **Anti-sycophantie** : signaler dérives même mid-session
- **EU AI Act** : transparency bannière "Généré par IA — pas substitut coaching humain"

## Effort total V1.7

**10-12h** dev + audits = **1 session pleine**. Ne PAS étaler sur 2 sessions (drift garanti).
