> ⚠️ **ARCHIVED 2026-05-15** — superseded by [`docs/FXMILY-V2-MASTER.md`](../FXMILY-V2-MASTER.md) (source unique vérité V2).
>
> Ce document a été conservé tel quel pour traçabilité historique. §15 blueprint Prisma + §17 inventaire 120 features + §20 verdicts intégrations passives sont **absorbés** dans le master V2 §9 + §12 + §20. Les **15 open questions §11** (lignes 343-371) ont été **extraites** vers [`docs/FXMILY-V2-MASTER.md`](../FXMILY-V2-MASTER.md) §23 pour arbitrage actif Eliot. Pour toute nouvelle décision feature V2.x, lire le master, pas ce fichier.

---

# SPEC V2 VISION — Fxmily Behavioral LMS

> **Préparé** : 2026-05-11 (session ultrathink round 6 post-V1.6 audit)
> **Auteur** : Eliot Pena × Claude Code (interview vision étendue)
> **Statut** : **Design document** — extension de `SPEC.md` (vision v1.1) et de `docs/v2-roadmap.md`. Ne remplace pas, complète.
> **Pré-requis lecture** : `SPEC.md` §1-§3, §15 (jalons), §18.4 (workflow 1 jalon = 1 session).
> **À valider par Eliot** : reformulation §1 + priorisation §6 + open questions §11.

---

## 1. Vision V2 reformulée (à valider Eliot)

Fxmily est l'**outil de suivi comportemental exhaustif** des membres de la formation de trading Fxmily, propriétaire d'Eliot. La formation enseigne stratégie / méthodologie / hedge **par ailleurs** (hors-scope app). Fxmily mesure **« qu'est-ce que le membre FAIT »** (exécution, routine, psychologie, contexte de vie qui impacte le trading) — pas **« ce qu'il SAIT »**.

Le membre vit Fxmily comme un **système de routine + progression + introspection** qui lui donne :

1. Le sentiment d'avoir une **routine claire de trader** ("je sais ce que je fais")
2. Un **sens de direction** ("je sais où je vais")
3. L'**envie de se pousser** (gamification White Hat uniquement, jamais anxiogène)
4. Du **plaisir** à faire ses check-ins / QCMs / routines (premium UX low-friction)

Eliot, en tant que coach, exploite la data agrégée pour :

1. **Débriefer chaque membre** individuellement avec contexte riche
2. **Conseiller** sur l'exécution (jamais sur le trade)
3. **Mesurer la North Star** : **évolution du score discipline moyen +X % sur 12 semaines**
4. **Détecter les drift / drop-off** avant qu'ils ne quittent

---

## 2. North Star (validée Eliot 2026-05-11)

**Évolution du score discipline moyen cohorte +X % sur 12 semaines glissantes.**

Implication : **chaque feature V2 doit répondre à la question « ça améliore la mesure ou la progression du score discipline ? »**. Si la réponse est non, la feature est descope ou différée.

Métriques secondaires (suivies, non North Star) :

- D7 retention (% membres encore actifs 7 jours après onboarding)
- D30 retention (% membres encore actifs 30 jours)
- % membres ≥4 check-ins / semaine pendant 4 semaines d'affilée
- NPS membres ≥50

---

## 3. Posture éducative non-négociable (rappel SPEC §2)

- ❌ Pas de conseil sur les trades (setups, prévisions, marché)
- ✅ Conseils autorisés sur l'**exécution** (sessions, hedge, plan, discipline)
- ✅ Conseils autorisés sur la **psychologie** (framework Mark Douglas + Lo/Repin/Steenbarger 2005 peer-reviewed pour ancrage scientifique)
- ❌ Pas de signaux, pas de Discord VIP, pas de tarif affiliate >20 %, pas de promesse revenu
- ⚠️ **Ligne rouge AMF/FCA** : recommandation personnalisée d'achat/vente = régulé. Education + tracking = défendable. Consultation juriste CIF obligatoire avant 100 membres payants.

---

## 4. Architecture V2 — 7 modules

```
                            FXMILY V2 ARCHITECTURE

  MEMBRE FACE                          ADMIN (ELIOT) FACE
  ┌──────────┐                         ┌────────────┐
  │ 1.TRACK  │ ───── data ──────►      │  7.SHARE   │
  │ 2.REFLECT│ ───── data ──────►      │  (cohort + │
  │ 3.LEARN  │ ───── data ──────►      │   member   │
  │ 4.ROUTINE│ ───── data ──────►      │   detail   │
  │ 5.PROGRES│                         │   pseudo)  │
  └──────────┘                         └────────────┘
        ▲                                     │
        │                                     │
        │            ┌─────────────┐          │
        └─── nudge ──│ 6.DEBRIEF   │◄────────┘
                    │ (coach notes│
                    │  + sessions)│
                    └─────────────┘

  Toutes les modules convergent vers :
  📍 NORTH STAR = score discipline trajectoire 12 semaines
```

### Module 1 — TRACK (V1 + extension V1.6)

**Mesurer ce que le trader FAIT en exécution + contexte.**

- V1 actuel : `Trade` (3/jour max, `tradeQuality` A/B/C, `riskPct`), `DailyCheckin` matin/soir
- V2 extension :
  - `Trade.tags[]` : `revenge` / `fomo` / `overconfidence` / `oversizing` / `exit-too-early` / `discipline` (multi-select)
  - `Trade.outcomeR` : R-multiple réalisé (standard pro Steenbarger / Edgewonk)
  - `Trade.screenshotUrl` : upload R2 optionnel
  - `Trade.contextFlag` : marqueur événement vie (stress event, sommeil dégradé, etc.) sans details PII

**Alimente North Star** : ✅ DIRECTEMENT (tags = signal discipline brut)

### Module 2 — REFLECT (V1 + extension V1.7)

**Ramener le trader vers sa psychologie quand un pattern est détecté.**

- V1 actuel : 50 fiches Douglas + trigger engine 7 evaluators + cooldown
- V2 extension :
  - Nouveaux evaluators sur trade tags (revenge trade → fiche "revenge" Douglas)
  - Cooldown intelligent (pas de re-serve si `view_duration_ms` < 50 %)
  - Path Douglas (séquence apprentissage psy structurée, sous-set de PROGRESS)
  - Activation Anthropic LIVE pour rapports hebdo personnalisés (budget ~$12/mois)

**Alimente North Star** : ✅ INDIRECTEMENT (réflexion → conscience → discipline)

### Module 3 — LEARN (NOUVEAU V2.0)

**QCMs récurrents + tests psychométriques pour mesurer et entretenir la compréhension de l'exécution.**

- `Quiz`, `QuizQuestion`, `QuizAttempt` (multi-types : MCQ, Likert scale, échelle 1-7)
- Tests psychométriques **scientifiquement crédibles** :
  - Risk tolerance Grable & Lytton 13-item (peer-reviewed)
  - Behavioral biases self-assessment (overconfidence / loss aversion / anchoring / confirmation)
  - Big Five OCEAN abrégé optionnel (10-50 items)
- **À NE PAS faire** : tests "trader archetype" pop-psychology marketing (debunké par Lo/Repin/Steenbarger 2005 — "pas de personality profile fiable" identifié dans les études peer-reviewed)
- **Mode plaisant** :
  - 5 questions max par session
  - ≤60 secondes
  - Feedback immédiat
  - PAS de scoring punitif
  - Spaced repetition (algorithm SM-2 type Anki) pour QCMs récurrents

**Alimente North Star** : ✅ INDIRECTEMENT (compréhension exécution → discipline appliquée)

### Module 4 — ROUTINE (NOUVEAU V1.9, IMPACT MAJEUR)

**Checklists structurées que le trader complète à intervalles fixes.**

- **Pre-market routine** : avant ouverture session — relu plan, état mental check, risk budget jour
- **Pre-trade routine** : avant chaque trade — modal "respecte plan ? size OK ? stop défini ?"
- **Post-market routine** : clôture journée — journal trades + état émotionnel
- **Weekly review** : dimanche — rétrospective + objectifs semaine
- **Custom routine** : Eliot crée des templates pour la cohorte ("routine A.M. signature Fxmily")

Modèles : `Routine`, `RoutineStep`, `RoutineLog`, `RoutineLogStep`

**Streak responsable** :

- "Freeze pass" 1/2 semaines (pas de streak shame)
- Auto-pause weekend (pas de pression non-trading)
- Celebration effort > outcome

**Alimente North Star** : ✅ DIRECTEMENT (routine respectée = signal discipline #1)
**Inspiration pro vérifiée** : SMB Capital PlayBook (Bellafiore), Steenbarger journaling protocol

### Module 5 — PROGRESS (NOUVEAU V2.0)

**Path linéaire + milestones que le membre traverse pendant sa formation.**

- `LearningPath`, `PathModule`, `Milestone`, `PathProgress`
- UX type Duolingo skill tree (path linéaire avec checkpoints) — mécanique éprouvée long-terme
- Milestones débloquées par data réelle ("10 trades documentés avec tags" / "4 semaines de routine pre-market 100 %")
- Pas de "level up" vide

**Alimente North Star** : ✅ INDIRECTEMENT (sens de progression → engagement → check-ins réguliers → measurement discipline possible)

**Anti-patterns à éviter** :

- ❌ Streak shame (perdre série pour 1 oubli)
- ❌ FOMO badges
- ❌ Black Hat gamification Yu-kai Chou Core Drive 8 (loss/avoidance forcée)
- ❌ Social pressure visible ("5 autres membres ont déjà checkin")
- ❌ Surprise rewards aléatoires (slot-machine pattern)

### Module 6 — DEBRIEF (NOUVEAU V1.8, côté admin)

**Outils Eliot pour débriefer 1-1.**

- `CoachNote` : texte + tags + lien event (ex : "note suite revenge trade 2026-05-11")
- `DebriefSession` : scheduled_at, agenda, completed_at, action_items[]
- `MemberSnapshot` : vue 360° pseudo-anonyme membre (timeline événements comportementaux)

**Alimente North Star** : ✅ INDIRECTEMENT (qualité coaching → discipline membre)

### Module 7 — SHARE (V1 + extension V2.1)

**Admin dashboard cohorte.**

- V1 actuel : pseudonymisation + `listMemberTradesAsAdmin`
- V2 extension :
  - Cohort heatmap discipline (vue agrégée temps réel)
  - Drop-off alerts (membre inactif 7 jours → notif Eliot)
  - NPS tracker (envoi automatique trimestriel)
  - Export CSV anonymisé cohorte

---

## 5. Priorisation features par impact North Star

| Module                              | Impact direct | Impact indirect | Effort dev | Priorité |
| ----------------------------------- | ------------- | --------------- | ---------- | -------- |
| TRACK extension (tags, outcomeR)    | ⭐⭐⭐        | ⭐              | ~7-8h      | **#1**   |
| ROUTINE (pre/post-market, weekly)   | ⭐⭐⭐        | ⭐⭐            | ~15-20h    | **#2**   |
| DEBRIEF (coach notes + session)     | ⭐            | ⭐⭐⭐          | ~10-12h    | **#3**   |
| REFLECT V2 (evaluators + cooldown)  | ⭐⭐          | ⭐⭐            | ~6-8h      | **#4**   |
| LEARN (QCM + tests psychométriques) | ⭐            | ⭐⭐⭐          | ~15-20h    | **#5**   |
| PROGRESS (path + milestones)        | ⭐            | ⭐⭐⭐          | ~12-15h    | **#6**   |
| SHARE V2 (cohort heatmap)           | ⭐            | ⭐⭐            | ~5-7h      | **#7**   |

**Lecture honnête** : ROUTINE et DEBRIEF ont l'impact le plus DIRECT sur la North Star. LEARN/PROGRESS sont gros efforts pour impact indirect — à n'attaquer qu'après ROUTINE/DEBRIEF.

---

## 6. Plan séquentiel V1.6 → V2.0 (RÉVISÉ post-subagent planner 2026-05-11)

> Règle SPEC §18.4 non-négociable : 1 session = 1 jalon, `/clear` entre chaque. Chaque jalon ~8-12h dev.
>
> **Pivot 2026-05-11** : V1.6 = STABILISATION (pas features), pour ne pas empiler sur les 5 bugs latents fraîchement patchés. Mes premiers items (Trade tags + outcomeR + Disclaimer + Prompts + D7/D30) basculent en V1.7-V1.8.

### Jalon V1.6 — Stabilisation backend (4-6h dev) ⭐ PROCHAIN

- Sentry alerting taxonomy (`error` vs `warning` vs `info` baseline)
- Email frequency cap (`is_transactional` field, anti-spam push fallback)
- `/admin/system` cron-watch enrichi (backup runtime + R2 status)
- 10 PRs dependabot majors triagés (batch review + merge low-risk)
- **Done** : Cron Watch 7 jours green continu, Sentry <50 events/jour mock, email cap actif

### Jalon V1.7 — REFLECT enrichissement (10-12h dev)

- `WeeklyReview` model + wizard dimanche 19:00 → 21:00 push
- Post-trade prompt contextuel (1 question depuis pool 30 items Eliot-authored)
- `ReflectionEntry` model (séparée du `DailyCheckin.journalNote`)
- Trade tags multi-select (`revenge` / `fomo` / `overconfidence` / `oversizing` / `exit-too-early` / `discipline`)
- Trade.outcomeR (R-multiple)
- Scoring discipline avec pondération tags
- Disclaimer AMF footer + emails (compliance)
- **Done** : 80% adhésion weekly review sur 3 membres test pendant 2 semaines

### Jalon V1.8 — ROUTINE customizable (10-12h dev) ⭐ IMPACT NORTH STAR MAJEUR

- `RoutineTemplate` + `RoutineCompletion` + `HabitLog` Prisma models (cf. §15 blueprint)
- Builder admin UI (Eliot crée templates pour cohorte)
- Pre-market routine UI + cron rappel
- Post-market routine UI + cron rappel
- Weekly review routine UI dimanche
- Adherence feeds `lib/scoring/discipline.ts` (refactor)
- Prompts post-session rotatifs intégrés
- **Done** : 3 membres test avec ≥1 routine custom + 7 jours adherence tracking
- **Preuve scientifique** : Rupprecht, Tran, Gröpel 2024 méta-analyse 112 effect sizes, Hedges' g=0.64-0.70 sous pression

### Jalon V1.9 — LEARN baseline (12h dev, sur-budget toléré)

- `QuizTemplate` + `QuizAttempt` Prisma models
- 1 test psychométrique onboarding (~20 questions) — **Grable & Lytton 13-item Risk Tolerance** (peer-reviewed validé, libre)
- 1 banque QCM execution (~50 questions, allowlist topics `session/hedge/plan/risk` — JAMAIS `setup/entry-signal/market direction`)
- Spaced Repetition FSRS lite (Anki 23.10+ algorithm) — preuve la plus solide en psycho cognitive (Cepeda et al. 2006)
- Affichage `Knowledge` score sur dashboard
- D7/D30 retention metric admin
- **Done** : nouveau membre fait test onboarding + 1 QCM hebdo récurrent, `fxmily-content-checker` valide allowlist
- ⚠️ **Risque élevé** : red line AMF/FCA. `/spec` obligatoire avant. `fxmily-content-checker` AVANT chaque commit.

### Jalon V2.0 — PROGRESS + DEBRIEF (12h dev)

- `PathModule` + `PathMilestone` + `MemberMilestoneProgress` (cf. §15)
- Path "Trader Discipliné" 6 phases (Découverte → Calibration → Stabilisation → Consistance → Performance → Maîtrise)
- Critères factuels par phase (X check-ins / score discipline ≥ Y / N QCMs réussis)
- `CoachDebrief` model + Eliot brief auto-generator
- Member-side "ma prochaine session : 3 sujets" widget
- After-call structured note Eliot
- **Done** : Eliot fait 3 debriefs réels avec briefs auto-générés et action items tracked

### Post V2.0 (V2.1+, hors session planification immédiate)

- iPhone PWA smoke physique (Steps 5/6/9 SPEC §15 J10)
- Frontend polish premium
- SHARE module (cohort heatmap, NPS) — reporter post-PMF ≥80 membres
- Capacitor + App Store (SPEC §17)
- Consultation juriste CIF (obligatoire avant 100 membres payants — coût ~300-500€)

**Total backend V2 : ~50-55h dev pur ≈ 5 sessions (1 jalon par session, /clear entre)**

---

## 7. Anti-patterns à éviter (hard rules)

1. **Black Hat gamification** (Yu-kai Chou Core Drive 8) — interdit en contexte trading où addiction = risque documenté
2. **Streak shame** — `if streak_lost: shame_user` = burnout pattern (cf. Decision Lab 2024)
3. **Trader archetype / personality profile fixe** — debunké par Lo/Repin/Steenbarger 2005
4. **Conseil personnalisé d'achat/vente** — ligne rouge AMF/FCA
5. **Data collection sans consentement explicite** — RGPD strict, opt-in granulaire par catégorie
6. **Push notifications hors fenêtre attentionnelle** — pas de push avant 7h ni après 22h (timezone membre)
7. **Test psychométrique non validé scientifiquement** — pas de "What's your trading personality?" Buzzfeed-style
8. **Forced sharing / social pressure** — pas de "X autres ont déjà fait Y"
9. **Streaks infinis sans freeze** — toujours mécanisme de repos responsable
10. **Vendre Fxmily comme garantie de rentabilité** — illégal + faux (70-85 % retail perdants ESMA)

---

## 8. Tests psychométriques pré-validés (CONFIRMÉ researcher 2026-05-11)

**À intégrer** (peer-reviewed solide) :

| Test                                         | Source                                           | Validité                                     |
| -------------------------------------------- | ------------------------------------------------ | -------------------------------------------- |
| **Grable & Lytton 13-item Risk Tolerance**   | Kuzniak et al. 2015 (n=160 279, Cronbach α=0.77) | ✅ Validé, libre, ancrage académique         |
| **Big Five OCEAN trading-applied**           | Jiang/Peng/Yan LSE, Durand et al. 2013           | ✅ Validé comme _prédicteur_, pas diagnostic |
| **Abdellaoui 2016 loss aversion**            | ScienceDirect, recommandé ESMA/FCA (n=4 780)     | ✅ Validé, plus complexe à implémenter       |
| **CFA Institute Behavioral Biases taxonomy** | CFA refresher reading 2026                       | ✅ Standard pro, base structure QCM          |

**À FUIR** (pop-psychology trading marketing) :

- ❌ "Daily questionnaires Steenbarger" — Steenbarger publie blog/livres crédibles (_The Daily Trading Coach_) MAIS **pas d'instrument psychométrique peer-reviewed validé à son nom**. À citer comme inspiration heuristique, jamais comme science.
- ❌ "What trader personality are you?" type quizz (pop-psychology marketing Instagram coaches)
- ❌ MBTI dérivés (validité scientifique contestée)
- ❌ "Trader chronotype" sans base scientifique
- ❌ "Trading DNA" propriétaires des YouTube coaches non-publiés

**Posture présentation** : les résultats sont un **miroir**, pas un **diagnostic**. Pas de "tu es de type X, donc tu trades comme Y". Privilégier le format "voici comment tu te perçois sur les dimensions standard mesurées".

---

## 9. Engagement design — White Hat uniquement (Yu-kai Chou)

**Core drives à activer** (White Hat) :

- CD2 — Development & Accomplishment (mastery)
- CD3 — Empowerment of Creativity & Feedback (creative ownership)
- CD5 — Social Influence & Relatedness (cohorte, pas comparaison anxiogène)

**Core drives à NE PAS activer** (Black Hat) :

- CD8 — Loss & Avoidance (FOMO, streak shame)
- CD6 — Scarcity & Impatience (artificial rarity)
- CD7 — Unpredictability & Curiosity (slot-machine pattern)

---

## 10. Métriques de succès V2 (à mesurer dès V1.6)

- **North Star** : score discipline moyen cohorte → trajectoire 12 semaines glissantes
- **Adoption** : % membres ≥4 check-ins / semaine pendant 4 semaines d'affilée
- **Retention** : D7 / D30 / D90
- **Routine compliance** (post V1.9) : % routines complétées par membre par semaine
- **Engagement Douglas** : `view_duration_ms` moyen fiches servies
- **NPS** : Net Promoter Score trimestriel (post V2.1)
- **Coach impact** (post V1.8) : % membres avec ≥1 coach note / mois

---

## 11. Open questions — à arbitrer dans `/spec` Eliot

### Sur le module ROUTINE (V1.9)

1. La pre-trade routine est-elle bloquante (modal qui force completion avant ouverture trade) ou non-bloquante (suggestion soft) ?
2. Le weekly review est-il auto-généré (résumé data) ou auto-rédigé (le membre écrit) ?
3. Les routines doivent-elles être notifiées par push, par email, par les deux ?

### Sur le module LEARN (V2.0)

4. Les QCMs sont-ils obligatoires (path bloquant) ou optionnels (gamification soft) ?
5. Les tests psychométriques sont-ils répétés (mensuel ? trimestriel ?) ou one-shot onboarding ?
6. Les résultats psychométriques sont-ils visibles au membre ou uniquement coach ?

### Sur le module PROGRESS (V2.0)

7. Le path linéaire force-t-il un ordre ou permet-il du parallèle ?
8. Les milestones sont-elles débloquées par data réelle, par temps, ou par les deux ?
9. Le membre voit-il les milestones futures (motivation) ou seulement actuelles (focus) ?

### Sur le module DEBRIEF (V1.8)

10. Les coach notes sont-elles visibles au membre ou privées admin ?
11. Les debrief sessions sont-elles planifiées via Fxmily (calendar intégré) ou externe (Calendly link) ?
12. Les action items générés en session sont-ils trackés comme tasks pour le membre ?

### Sur la posture publique

13. Le disclaimer AMF est-il visible permanent (footer) ou uniquement à l'onboarding ?
14. Faut-il ajouter une page `/about` qui explique anti-scam vs marketing trading ?
15. Quel est le ratio formation pricing / valeur Fxmily perçue ? (pour future décision standalone pricing si applicable)

---

## 12. Réutilisation V1 — ce qu'on garde tel quel

- Auth.js v5 + JWT + argon2id
- Prisma 7 + driver adapter `@prisma/adapter-pg`
- Postgres 17 + 18 tables existantes
- Audit log + 9 crons + cron-watch
- Resend HTTP API + domain verified
- Sentry tunnel `/monitoring`
- Web Push VAPID + Service Worker
- Pseudonymisation admin (`pseudonymLabel`)
- Backup pg_dump + GPG + 7d rotation
- `.gitattributes` LF-enforce + `fix-crlf-prod.sh`

---

## 13. Refs

- `SPEC.md` v1.1 — source de vérité produit
- `docs/v2-roadmap.md` — précédent backlog V2 (CSP nonces, JWT tokenVersion, etc.)
- `apps/web/CLAUDE.md` — instructions web app + V1.6 audit
- **Recherche externe ancrée** :
  - ESMA disclosure 70-85 % retail perdants
  - Lo, Repin, Steenbarger 2005 "Fear and Greed" SSRN 690501
  - Yu-kai Chou Octalysis (White Hat / Black Hat)
  - SMB Capital PlayBook (Bellafiore)
  - Grable & Lytton 13-item risk tolerance scale
  - Decision Lab "Streak Creep" 2024

---

## 14. Décision finale 2026-05-11

✅ **Vision V2 validée** par interview Eliot (5 questions Q1-Q5 répondues)
✅ **Architecture 7 modules** proposée
✅ **Plan séquentiel V1.6 → V2.0 RÉVISÉ** post-subagent planner (V1.6 = stabilisation, pas features)
✅ **Anti-patterns** documentés
✅ **Tests psychométriques** confirmés Grable & Lytton + Big Five + Abdellaoui + CFA
✅ **Preuve scientifique ROUTINE** : Rupprecht 2024 méta-analyse Hedges' g=0.64-0.70
✅ **Preuve scientifique LEARN** : FSRS Anki + Cepeda 2006 spaced repetition
✅ **Aucun concurrent direct** confirmé sur "LMS comportemental trading"
⏳ **Open questions** §11 à arbitrer par Eliot avant V1.7+
⏳ **Premier jalon** à attaquer : **V1.6 Stabilisation backend** dans une nouvelle session après `/clear`

---

## 15. Blueprint Prisma V1.7 → V2.0 (subagent code-architect 2026-05-11)

> **Note** : ce blueprint a été produit par lecture directe de `apps/web/prisma/schema.prisma` — toutes conventions repérées sont citées (CUID, PascalCase models, snake_case `@@map`, enums lowercase, `onDelete: Cascade` RGPD, `AuditLog.action` = TS union pas Postgres enum). À utiliser comme source de vérité pour les jalons V1.7+.

### Migration 1 — `20260512000000_v1_7_routines_habits` (V1.7, LOW risk)

**Tables** : `routine_templates`, `routine_completions`, `habit_logs`
**Enums** : `RoutineKind` (`pre_market` / `post_market` / `weekly_review` / `custom`)

```prisma
model RoutineTemplate {
  id        String              @id @default(cuid())
  ownerId   String?             @map("owner_id") // null = admin-defined, userId = member-custom
  owner     User?               @relation("OwnedRoutines", fields: [ownerId], references: [id], onDelete: Cascade)
  slug      String              @unique
  title     String
  kind      RoutineKind
  steps     Json                // [{ id, label, type: 'boolean'|'rating'|'text', required }]
  published Boolean             @default(false)
  archived  Boolean             @default(false)
  createdAt DateTime            @default(now()) @map("created_at")
  updatedAt DateTime            @updatedAt @map("updated_at")
  completions RoutineCompletion[]

  @@index([kind, published])
  @@index([ownerId])
  @@map("routine_templates")
}

model RoutineCompletion {
  id          String          @id @default(cuid())
  userId      String          @map("user_id")
  user        User            @relation(fields: [userId], references: [id], onDelete: Cascade)
  templateId  String          @map("template_id")
  template    RoutineTemplate @relation(fields: [templateId], references: [id], onDelete: Cascade)
  date        DateTime        @db.Date // matches DailyCheckin.date convention
  responses   Json            // { [stepId]: boolean | number | string | null }
  completedAt DateTime?       @map("completed_at") // null = started but not finished
  createdAt   DateTime        @default(now()) @map("created_at")
  updatedAt   DateTime        @updatedAt @map("updated_at")

  @@unique([userId, templateId, date])
  @@index([userId, date(sort: Desc)])
  @@index([userId, templateId, date(sort: Desc)])
  @@map("routine_completions")
}

model HabitLog {
  id       String   @id @default(cuid())
  userId   String   @map("user_id")
  user     User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  date     DateTime @db.Date
  habitKey String   @map("habit_key") // sleep_hours, screen_time_min, sport_duration_min, etc.
  value    Decimal  @db.Decimal(10, 4)
  source   String   @default("manual") // 'manual' | 'apple_health' | 'whoop' | 'oura'
  createdAt DateTime @default(now()) @map("created_at")

  @@unique([userId, date, habitKey, source])
  @@index([userId, date(sort: Desc)])
  @@index([userId, habitKey, date(sort: Desc)])
  @@map("habit_logs")
}

enum RoutineKind {
  pre_market
  post_market
  weekly_review
  custom
}
```

**Impact scoring** : `RoutineCompletion.completedAt IS NOT NULL` → `routinePreMarketRate` sub-part remplace `routineCompleted` (10→15 pts) dans `lib/scoring/discipline.ts`.

### Migration 2 — `20260519000000_v1_8_quizzes` (V1.8, LOW risk)

**Tables** : `quiz_templates`, `quiz_attempts`
**Enums** : `QuizKind` (`knowledge` / `psychometric`)
**Extension** : `ALTER TYPE NotificationType ADD VALUE IF NOT EXISTS 'quiz_result_ready'`

```prisma
model QuizTemplate {
  id          String        @id @default(cuid())
  slug        String        @unique
  title       String
  description String?       @db.Text
  kind        QuizKind
  questions   Json          // [{ id, text, kind: 'single'|'multi'|'scale'|'likert', options? }]
  scoring     Json          // { type: 'sum'|'weighted'|'dimensional', dimensions? }
  published   Boolean       @default(false)
  recurrence  String?       // null | 'weekly' | 'monthly' | 'quarterly'
  createdAt   DateTime      @default(now()) @map("created_at")
  updatedAt   DateTime      @updatedAt @map("updated_at")
  attempts    QuizAttempt[]

  @@index([kind, published])
  @@map("quiz_templates")
}

model QuizAttempt {
  id          String       @id @default(cuid())
  userId      String       @map("user_id")
  user        User         @relation(fields: [userId], references: [id], onDelete: Cascade)
  templateId  String       @map("template_id")
  template    QuizTemplate @relation(fields: [templateId], references: [id], onDelete: Cascade)
  attemptNum  Int          @map("attempt_num") // application-side MAX+1 in transaction
  answers     Json
  score       Int?         // 0-100, null during async grading
  dimensions  Json?        // { [dimensionId]: score } — null for knowledge quizzes
  startedAt   DateTime     @default(now()) @map("started_at")
  completedAt DateTime?    @map("completed_at")
  createdAt   DateTime     @default(now()) @map("created_at")

  @@unique([userId, templateId, attemptNum])
  @@index([userId, templateId, createdAt(sort: Desc)])
  @@index([userId, completedAt(sort: Desc)])
  @@map("quiz_attempts")
}

enum QuizKind {
  knowledge     // QCM execution — right/wrong answers
  psychometric  // Risk tolerance, behavioral biases — scored profile
}
```

**Impact scoring** : `knowledge` quiz completion rate → `engagement.quizCompletionRate`. `psychometric` → feeds `TraderProfile` (V2.0), **neutre** au numeric discipline score.

### Migration 3 — `20260526000000_v1_9_path_coach` (V1.9, MEDIUM risk)

**Tables** : `path_modules`, `path_milestones`, `member_milestone_progress`, `coach_debriefs`
**Enums** : `ProgressStatus` (`not_started` / `in_progress` / `completed` / `skipped`)

```prisma
model PathModule {
  id          String          @id @default(cuid())
  slug        String          @unique
  title       String
  description String?         @db.Text
  position    Int
  published   Boolean         @default(false)
  requires    String[]        // prerequisite slugs
  createdAt   DateTime        @default(now()) @map("created_at")
  updatedAt   DateTime        @updatedAt @map("updated_at")
  milestones  PathMilestone[]

  @@index([position])
  @@map("path_modules")
}

model PathMilestone {
  id                 String                    @id @default(cuid())
  moduleId           String                    @map("module_id")
  module             PathModule                @relation(fields: [moduleId], references: [id], onDelete: Cascade)
  slug               String                    @unique
  title              String
  description        String?                   @db.Text
  position           Int
  completionCriteria Json                      @map("completion_criteria")
  // { type: 'manual'|'quiz_passed'|'routine_streak', quizTemplateSlug?, streakDays?, minScore? }
  createdAt          DateTime                  @default(now()) @map("created_at")
  updatedAt          DateTime                  @updatedAt @map("updated_at")
  memberProgress     MemberMilestoneProgress[]

  @@index([moduleId, position])
  @@map("path_milestones")
}

model MemberMilestoneProgress {
  userId      String         @map("user_id")
  user        User           @relation(fields: [userId], references: [id], onDelete: Cascade)
  milestoneId String         @map("milestone_id")
  milestone   PathMilestone  @relation(fields: [milestoneId], references: [id], onDelete: Cascade)
  status      ProgressStatus @default(not_started)
  startedAt   DateTime?      @map("started_at")
  completedAt DateTime?      @map("completed_at")
  createdAt   DateTime       @default(now()) @map("created_at")
  updatedAt   DateTime       @updatedAt @map("updated_at")

  @@id([userId, milestoneId])
  @@index([userId, status])
  @@index([userId, completedAt(sort: Desc)])
  @@map("member_milestone_progress")
}

model CoachDebrief {
  id        String   @id @default(cuid())
  memberId  String   @map("member_id")
  member    User     @relation("DebriefSubject", fields: [memberId], references: [id], onDelete: Cascade)
  coachId   String   @map("coach_id")
  coach     User     @relation("DebriefAuthor", fields: [coachId], references: [id], onDelete: Cascade)
  notes     String?  @db.Text // safeFreeText-enforced Zod layer. NEVER raw PII names.
  sessions  Json     @default("[]") // [{ scheduledAt, durationMin, notes, status: 'planned'|'done'|'cancelled' }]
  tags      String[] // 'discipline' | 'risk' | 'psychology' | 'process' | 'pattern'
  createdAt DateTime @default(now()) @map("created_at")
  updatedAt DateTime @updatedAt @map("updated_at")

  @@index([memberId, createdAt(sort: Desc)])
  @@index([coachId, createdAt(sort: Desc)])
  @@map("coach_debriefs")
}

enum ProgressStatus {
  not_started
  in_progress
  completed
  skipped
}
```

⚠️ **Risque CoachDebrief.notes PII** (HIGH si non enforced) :

- `safeFreeText(notes)` au Zod layer (NFC + bidi strip, existant `lib/text/safe.ts`)
- Zod `.refine(!containsBidiOrZeroWidth)` obligatoire
- **NEVER log notes content** dans AuditLog metadata
- `RGPD export` doit inclure `CoachDebrief` (Art. 15 — notes Eliot écrit sur le membre = data du membre)
- `purge-deleted` cron cascade via `onDelete: Cascade` sur `memberId`

### Migration 4 — `20260601000000_v2_0_trader_profile` (V2.0, LOW risk)

**Tables** : `trader_profiles`
**Pas de nouvel enum** (archetype stocké comme `String` pour zero-migration extensibility)

```prisma
model TraderProfile {
  id         String   @id @default(cuid())
  userId     String   @unique @map("user_id")
  user       User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  archetype  String?  // 'analyst' | 'intuitive' | 'disciplined' | 'impulsive' | 'conservative' | 'aggressive'
  dimensions Json?    // { riskTolerance: 0-100, impulsivity, lossAversion, overconfidence, processAdherence }
  correlated Json?    // { sleepVsPerformance: r, stressVsOutcome: r, qualityVsOutcome: r }
  computedAt DateTime @default(now()) @map("computed_at")
  createdAt  DateTime @default(now()) @map("created_at")
  updatedAt  DateTime @updatedAt @map("updated_at")

  @@index([archetype])
  @@map("trader_profiles")
}
```

**Impact scoring** : neutre. TraderProfile enrichit le contexte du weekly AI report mais ne modifie pas le numeric discipline score (qui reste déterministe/observable).

### Nouveaux audit actions (TypeScript union `lib/auth/audit.ts`)

```typescript
// V1.7
'routine.pre_market.submitted'; // { completionId, templateId, date, completedSteps, totalSteps }
'routine.post_market.submitted';
'routine.weekly_review.submitted';
'routine.custom.submitted';
'habit.log.created'; // { habitKey, source, date } — JAMAIS la value (privacy)
'cron.profile_recompute.scan';

// V1.8
'quiz.knowledge.submitted'; // { attemptId, templateId, score, attemptNum }
'quiz.psychometric.submitted'; // { attemptId, templateId, dimensions: dimensionIds, attemptNum }
'quiz.result.viewed';

// V1.9
'path.milestone.started'; // { milestoneId, moduleId }
'path.milestone.completed'; // { milestoneId, moduleId, durationDays }
'path.milestone.skipped';
'coach.debrief.created'; // { debriefId, memberId } — NO notes content
'coach.debrief.updated';
'coach.session.scheduled';
'coach.session.completed';

// V2.0
'profile.archetype.computed'; // { userId (pseudonym), archetype, fromAttempts }
```

### 5 risques identifiés + mitigations

1. **User model bloat** (HIGH dev ergonomics) : 14 relations actuelles → ~24 en V2.0. Pas d'impact perf. Mitigation : grouper sections schema + service files domain-scoped.
2. **Write volume CX22** (MEDIUM scale) : V2 peak ~500 writes/jour à 30 membres = négligeable. À 1000 membres, batch Apple Health.
3. **RGPD export size** (MEDIUM) : double surface en V2. Mitigation : streaming export JSONL en V2.0+.
4. **DailyCheckin vs HabitLog duplication** (LOW-MEDIUM) : bridge rule `lib/analytics/habits.ts` priorité `manual_checkin > habit_log`.
5. **CoachDebrief PII** (HIGH si non enforced) : `safeFreeText` Zod + exclusion AuditLog metadata + Art. 15 RGPD export + cascade purge.

---

## 17. Surface exhaustive features candidates (Round 7 ultrathink 2026-05-11)

> **Pivot honnête** : les Rounds 1-6 ont sous-livré (~25 features). L'inventaire exhaustif est ~120 features candidates. Cette section consolide.
>
> Notation priorité :
>
> - **D** = V1.7-V1.8 (3-4 mois)
> - **M** = V2.0 (6 mois)
> - **L** = V2.x+ (post-PMF >80 membres)
> - **N** = NE PAS FAIRE (anti-pattern documenté)

### 17.A. Contexte de vie élargi (14 features)

A1-A4 : sommeil détaillé / nutrition / caféine / sport (priorités **D** à **M**)
A5-A14 : méditation, événements vie, pression $, météo, isolement, ergonomie, écrans bleus, cycle menstruel, alcool, phone usage (**L** opt-in fort RGPD)

### 17.B. Process trade granulaire (10 features)

B1-B7 : hésitation pré-entry / SL move count / size deviation / time-in-trade / re-entry / confidence rating / pre-mortem (**D** à **M**)
B8-B9 : voice-to-text + screen recording → **N** (anti-audio Eliot + GDPR/cost)
B10 : auto-tag IA depuis description (**M**)

### 17.C. Émotionnel DEEP (9 features)

C1-C9 : granularité (Feldman Barrett) / body scan / trigger tracking / coping mechanism / self-compassion Neff / CBT reframing / mood color / daily intention / reverse journal

### 17.D. AI coach personnalisé via Anthropic (9 features)

D1-D9 : daily debrief / pattern detection / weekly challenge / monthly evolution / talk-to-data / real-time nudge / past-self compare / Eliot talk-to-cohort / auto-tag

### 17.E. Intégrations passives (8 features)

E1-E8 : HealthKit (Capacitor V2) / Screen Time / MT4-5 / IBKR / TradingView webhook / Calendar / Chrome extension / CSV manuel (le seul **D** réaliste V1.7)

### 17.F. Approche athlète pro SPEC §3 (8 features)

F1-F8 : pre-game ritual / cool-down / active recovery days / peaking cycles / off-season / athlete mode toggle / breathing exercises / best-worst week auto-detect

### 17.G. Risk management actif (6 features)

G1-G6 : daily loss limit / weekly limit / stop trading suggestion / size sanity / revenge cooldown / fatigue alert

### 17.H. Knowledge management Douglas+ (6 features)

H1-H6 : glossary / bookmarks / annotate / lessons learned / pre-trade checklist custom / fiches Eliot custom

### 17.I. Réflexions structurées (7 niveaux)

I1-I7 : daily court / weekly long / monthly / quarterly / annual / pre-post event marché / trade post-mortem deep

### 17.J. Social opt-in anonyme (5 features) + 1 N

J1-J5 : vibe check cohorte / aggregate report / buddy system / group challenges / anonymous Q&A
❌ Public leaderboard = **N** (Black Hat anxiety documentée)

### 17.K. Eliot super-pouvoirs (8 features admin)

K1-K8 : at-risk alert / cohort compare / heat map calendrier / broadcast 1-many / DM Eliot→member / fiches custom / MRR/churn/LTV / cohort health score

### 17.L. Voice of the member (5 features)

L1-L5 : SOS button / feedback widget / NPS trimestriel / member-initiated debrief / suggestion box

### 17.M. Fun / plaisant White Hat (6 features)

M1-M6 : avatars / thèmes / sons / haptic Capacitor V2 / wallpapers Douglas / trader name custom

### 17.N. Performance peaks tracking (5 features)

N1-N5 : correlation sleep×discipline / stress×outcome / workouts×focus / best state replay / personal benchmark

### 17.O. Pre-trade rituel (5 features) + 1 N

O2-O5 : visualization texte / pre-trade checklist modal / breathing 4-7-8 / affirmation jour
❌ O1 audio = **N** (anti-audio Eliot)

### 17.P. Post-trade cool-down (5 features)

P1-P5 : décompression / gratitude / last lesson / forced break big win-loss / auto-lock session

### 17.Q. Intégration formation externe (4 features)

Q1-Q4 : SSO LMS externe / module en cours visible / référencement / webhook bidirectionnel

### 17.R. Sécurité émotionnelle (4 features)

R1-R4 : burnout detection / mental health day suggested / ressources externes SOS / self-binding limites

### 17.S. Performance long-terme (4 features)

S1-S4 : 6-month retro / 12-month compare / archetype evolution / PDF snapshot

### 17.T. Business membre (3 features)

T1-T3 : Stripe self-service V2 / renewal reminder / member portal facturation

---

## 18. Recap priorisation Round 7

- **D (V1.7-V1.8)** : ~17 features — focus North Star direct (discipline)
- **M (V2.0)** : ~35 features — enrichissement (IA, athlète, risk active)
- **L (V2.x+)** : ~55 features — post-PMF, scale, intégrations lourdes
- **N (ne pas faire)** : 5 features anti-patterns

**Implication scope** : V1 → V1.6 actuel = 25% du périmètre cible V2. V2.0 cumulé = 60%. V2.x complète à 95%. Les 5% restants resteront probablement non-réalisés (anti-patterns, ego features).

**Implication effort** : si on code TOUTES les D + M = ~52 features = ~200-300h dev = 20-30 sessions Claude Code. Le reste L = ~55 features = ~300-500h additionnels.

**Garde-fou** : on ne code aucune feature sans qu'elle ait passé le filtre **"ça améliore la mesure ou la progression du score discipline ?"** (cf. §2 North Star).

---

## 20. Intégrations passives — verdicts honnêtes (Round 7 code-architect 2026-05-11)

### 20.A. HealthKit / Google Health Connect — 3 niveaux

| Niveau                         | Effort                    | Path                                                                                     |
| ------------------------------ | ------------------------- | ---------------------------------------------------------------------------------------- |
| **V1.7 export ZIP manuel**     | 8-10h                     | iOS Health > Exporter > upload .zip Fxmily > parser fast-xml-parser > persist `HabitLog` |
| **V2.0 iOS Shortcuts webhook** | 4-5h                      | Raccourcis app lit HealthKit + POST `/api/health-webhook`, semi-passif                   |
| **V2.0+ Capacitor native**     | 15-20h + $99/an Apple Dev | Plugin natif HealthKit, background sync overnight (vrai passif)                          |

**RGPD critique** : données santé = **Art. 9** (catégorie spéciale). Consentement séparé granulaire obligatoire, pas intégrable consentement général. **DPIA CNIL** probable avant déploiement. À budgéter dans la consultation juriste CIF.

### 20.B. Brokers (MT4/MT5/IBKR/TradingView)

| Path                       | V     | Effort | Note                                                                                                                                      |
| -------------------------- | ----- | ------ | ----------------------------------------------------------------------------------------------------------------------------------------- |
| **CSV import universel**   | V1.7  | 8-10h  | Le seul realiste tous brokers. Membre exporte CSV depuis sa plateforme, upload Fxmily, reconciliation `(pair, enteredAt ±2min)` matching. |
| **TradingView webhook**    | V2.0  | 4-6h   | Push depuis alertes TradingView Pro+. Conforme T&C tant que **logging post-hoc**, pas execution.                                          |
| **IBKR Client Portal API** | V2.0+ | 20-25h | OAuth 2.0 + session token + refresh flow. Vérifier T&C IBKR Pro avant. Le seul broker avec API publique solide 2026.                      |

**MT4/MT5** : pas d'API HTTP officielle uniforme. Chaque broker MT5 a son protocole. Recommandation : _"bring your own export CSV"_ plutôt qu'intégrer 30+ variants broker-side.

**Webhook auth** : `/api/webhooks/tradingview` protégé par HMAC secret (pattern `CRON_SECRET` existant).

### 20.C. Calendar Apple/Google — NE PAS FAIRE auto

**ROI / risque négatif** :

- Surface OAuth lourde + tokens refresh
- Calendar = PII catégorie A (RDV médicaux, famille, intime)
- Maintenance élevée

**Alternative pragmatique** (zéro risque RGPD) : dropdown 2-lignes dans le check-in soir :

> _"Y avait-il un événement particulier aujourd'hui ?"_
> [ ] FOMC / NFP / CPI [ ] Sport / gym [ ] Stress familial [ ] Voyage [ ] Autre [ ] Aucun

→ stocker dans `DailyCheckin.contextFlags Json?` (nouveau champ). Aucun stockage events tiers. **Couvre 90% du besoin pour 5% de l'effort.**

### 20.D. Cycle menstruel — NE JAMAIS FAIRE (4 raisons cumulées)

1. **Données santé Art. 9 RGPD** — DPIA CNIL probable, régime juridique distinct
2. **Coates & Herbert 2008** : étude **trading floor London pros**, **PAS validée retail formation**. Utiliser cette corrélation pour coacher = pseudoscience exactement interdite §7
3. **Stigmatisation** : coach masculin recevant données cycle élèves femmes = risque relationnel grave + discrimination perçue
4. **APIs Flo/Clue** : aucune API publique documentée 2026

**Alternative légitime** : fiche Mark Douglas catégorie `acceptance` sur _"intéroception et conscience corporelle"_ — éducatif, non-mesuring, non-stigmatisant.

### 20.E. Broadcast admin (Eliot 1-many)

**ROI immédiat** pour cohorte 30 membres. Eliot peut communiquer sans email externe. **V1.7 priorité.**

```prisma
model AdminBroadcast {
  id          String    @id @default(cuid())
  authorId    String    @map("author_id")
  author      User      @relation("BroadcastsAuthored", fields: [authorId], references: [id], onDelete: Cascade)
  title       String    // safeFreeText Zod
  body        String    @db.Text // markdown, safeFreeText + rehype-sanitize render
  publishedAt DateTime? @map("published_at") // null = draft
  expiresAt   DateTime? @map("expires_at")
  audienceFilter Json?  @map("audience_filter") // V1 tous, V2 segments
  createdAt   DateTime  @default(now()) @map("created_at")
  updatedAt   DateTime  @updatedAt @map("updated_at")
  receipts    BroadcastReceipt[]

  @@index([publishedAt(sort: Desc)])
  @@index([authorId])
  @@map("admin_broadcasts")
}

model BroadcastReceipt {
  broadcastId String         @map("broadcast_id")
  broadcast   AdminBroadcast @relation(fields: [broadcastId], references: [id], onDelete: Cascade)
  userId      String         @map("user_id")
  user        User           @relation(fields: [userId], references: [id], onDelete: Cascade)
  seenAt      DateTime?      @map("seen_at")
  createdAt   DateTime       @default(now()) @map("created_at")

  @@id([broadcastId, userId])
  @@index([userId, seenAt])
  @@map("broadcast_receipts")
}
```

**NotificationType** à étendre : `admin_broadcast_published`. Dispatcher J9 existant envoie le push. Zéro nouvelle infra.

**Pour DM 1-1 Eliot → membre** : **ne pas construire un système de messagerie complet** en V2. Alternative pragmatique : étendre `CoachDebrief.sessions[]` (§15 Migration 3) avec un champ `async_notes` visible côté membre. Canal asynchrone 1-1 sans complexité inbox général.

### 20.F. Modèles Prisma additionnels au blueprint §15

Ajouts au blueprint Migration 1 V1.7 :

```prisma
model HealthImportBatch {
  id              String   @id @default(cuid())
  userId          String   @map("user_id")
  user            User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  source          String   // 'apple_health_manual_export' | 'shortcuts_webhook' | 'capacitor_healthkit' | 'google_health_connect'
  importedAt      DateTime @default(now()) @map("imported_at")
  recordsInserted Int      @map("records_inserted")
  recordsSkipped  Int      @map("records_skipped")
  dateFrom        DateTime @db.Date @map("date_from")
  dateTo          DateTime @db.Date @map("date_to")
  createdAt       DateTime @default(now()) @map("created_at")

  @@index([userId, importedAt(sort: Desc)])
  @@map("health_import_batches")
}

model BrokerImportBatch {
  id             String   @id @default(cuid())
  userId         String   @map("user_id")
  user           User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  source         String   // 'csv_metatrader' | 'csv_ibkr' | 'csv_ctrader' | 'tradingview_webhook' | 'ibkr_api'
  filename       String?
  storageKey     String?  @map("storage_key") // R2 key for raw file (audit/replay)
  recordsTotal   Int      @map("records_total")
  recordsMatched Int      @map("records_matched")
  recordsCreated Int      @map("records_created")
  recordsSkipped Int      @map("records_skipped")
  importedAt     DateTime @default(now()) @map("imported_at")
  dateFrom       DateTime @db.Date @map("date_from")
  dateTo         DateTime @db.Date @map("date_to")
  createdAt      DateTime @default(now()) @map("created_at")

  @@index([userId, importedAt(sort: Desc)])
  @@map("broker_import_batches")
}

// Extension Trade model V2.0
// trade.brokerImportBatchId String? @map("broker_import_batch_id")
// trade.brokerTradeId       String? @map("broker_trade_id") // dedup
```

### 20.G. Audit log — nouvelles actions

```typescript
// V1.7
'health.import.zip.completed';
'health.import.shortcuts.received';
'broker.import.csv.completed';
'broadcast.created';
'broadcast.published';
'broadcast.seen';

// V2.0
'health.import.capacitor.completed';
'broker.import.tradingview.received';
'broker.sync.ibkr.completed'; // cron action
```

### 20.H. Anti-patterns confirmés (ajout à §7)

1. **TradingView screenshot auto** — extension Chrome lourde, économise 10s/trade, ROI négligeable, effort 20-30h
2. **iOS Screen Time** — "3h YouTube hier" pas actionnable, data pour data
3. **Google Calendar full sync** — sur-engineering vs dropdown 2 lignes
4. **Cycle menstruel tracking** — Art. 9 RGPD + pseudoscience retail + stigmatisation
5. **Email/SMS messagerie 1-1** — sur-engineering, `CoachDebrief.sessions[].async_notes` suffit

Filtre commun : _"ça améliore la mesure ou la progression du score discipline ?"_ → NON → on ne fait pas.

### 20.I. Total effort V1.7 intégrations passives

- AdminBroadcast + BroadcastReceipt + UI admin : **~5-7h**
- CSV import broker universel (MT4/MT5/IBKR/cTrader parsers) : **~8-10h**
- HealthKit export ZIP manuel + parser XML : **~8-10h**
- `DailyCheckin.contextFlags Json?` champ + UI dropdown : **~1-2h**
- HealthImportBatch + BrokerImportBatch models + audit actions : **~2h**

**Total V1.7 si on fait tout** : ~25-30h. **Mais on ne fait PAS tout V1.7** — V1.7 reste **REFLECT + foundations North Star + broadcast admin** (~12-15h). HealthKit + Brokers CSV → V1.8.

---

## 21. Pickup prompt V1.6 (pour nouvelle session post-/clear)

> Copier-coller ce prompt au démarrage de la prochaine session Claude Code.

```text
Démarre le Jalon V1.6 — Stabilisation backend. Lis d'abord :
1. docs/SPEC-V2-VISION.md (vision V2 produit + plan séquentiel)
2. apps/web/CLAUDE.md (V1.6 audit section + V1.7 backlog)
3. SPEC.md §15 (jalons V1)

Scope V1.6 (4-6h dev) :
- Sentry alerting taxonomy (`error` vs `warning` vs `info`)
- Email frequency cap (`is_transactional` field sur notifications)
- `/admin/system` cron-watch enrichi (backup runtime + R2 status)
- 10 PRs dependabot majors triagés (merge low-risk, defer high-risk)

Critères Done :
- Cron Watch 7 jours green continu après V1.6
- Sentry <50 events/jour mock baseline
- Email cap actif vérifié scenarios test
- pnpm format:check && pnpm lint && pnpm type-check && pnpm build verts
- Tests Vitest pour le freq cap
- code-reviewer post-impl
- /fxmily-deliver-jalon AVANT /clear

Posture : Mark Douglas (pas de conseil trade). Autonomie max selon CLAUDE.md global. /clear à la fin.

Lance fxmily-jalon-tracker au démarrage pour confirmer l'état git.
```
