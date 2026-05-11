# FXMILY V2 — MASTER PLAN

> **Document unique. Source de vérité produit.**
> Remplace `SPEC-V2-VISION.md` + `MANIFESTO-V2.md` (à archiver).
> Complète `SPEC.md` v1.1 (qui reste source produit V1) et `docs/v2-roadmap.md` (qui couvre dette tech).
> **Préparé** : 2026-05-11 — interview Eliot 8 rounds itératifs + 5 subagents
> **À valider** : §1 vision + §6 modules + §23 décisions M1-M10

---

## TABLE DES MATIÈRES

**PARTIE I — ÂME PRODUIT**

- §1 Vision en 5 piliers
- §2 Posture éducative non-négociable
- §3 North Star + métriques secondaires
- §4 Cinq paradoxes résolus
- §5 L'ennemi / L'allié

**PARTIE II — ARCHITECTURE PRODUIT**

- §6 Les 7 modules
- §7 Filtre stratégique 10 phrases-test
- §8 Anti-patterns confirmés (hard rules)

**PARTIE III — SURFACE FEATURES**

- §9 Inventaire 120 features par module
- §10 Priorisation D/M/L/N

**PARTIE IV — ARCHITECTURE TECHNIQUE**

- §11 Stack existant (rappel)
- §12 Nouveaux modèles Prisma (13 modèles, 5 migrations)
- §13 Intégrations passives — verdicts
- §14 AI coach Anthropic — pattern d'usage
- §15 Scoring discipline — alimentation par module
- §16 Audit log — nouveaux events

**PARTIE V — PLAN SÉQUENTIEL**

- §17 V1.6 — Stabilisation (4-6h)
- §18 V1.7 — REFLECT + foundations (10-12h)
- §19 V1.8 — ROUTINE customizable (10-12h)
- §20 V1.9 — LEARN baseline (12h)
- §21 V2.0 — PROGRESS + DEBRIEF (12h)
- §22 V2.x — Backlog post-PMF

**PARTIE VI — DÉCISIONS D'ÂME À ARBITRER**

- §23 Les 10 manques M1-M10

**PARTIE VII — ANCRAGE SCIENTIFIQUE**

- §24 Bibliographie peer-reviewed
- §25 Bibliographie pro-grade

**PARTIE VIII — OPS / DEV WORKFLOW**

- §26 Règle SPEC §18.4 non-négociable
- §27 Pickup prompt V1.6
- §28 Subagents pattern par jalon

---

# PARTIE I — ÂME PRODUIT

## §1. Vision en 5 piliers

**P1.** La formation est la maison. Fxmily est l'outil sur le mur. Eliot a une formation de trading qui marche déjà et va exploser. Fxmily n'est PAS la formation. Fxmily est l'outil qui rend la formation **mesurable et accompagnée individuellement**.

**P2.** Fxmily mesure ce que le membre FAIT, pas ce qu'il SAIT. Aucun cours, aucun signal, aucune stratégie. Que de l'observation : exécution, routines, psychologie, contexte de vie qui impacte le trading. La data est la matière première du coaching.

**P3.** Le membre vit Fxmily comme un rituel quotidien plaisant qui le pousse à devenir meilleur. Pas une corvée. Un compagnon discret qui donne sens de routine, sens de direction, envie de se pousser, introspection guidée. Le membre doit AIMER ouvrir l'app.

**P4.** Eliot devient un coach augmenté qui connaît chaque membre individuellement. Vue 360° pseudonymisée, anticipation des drift, débrief avec data. **L'IA enrichit, ne remplace pas, le coaching humain.**

**P5.** La North Star n'est pas la rentabilité du membre, c'est sa discipline. Promettre la rentabilité = trading-marketing scam. Promettre l'amélioration mesurable de la discipline = honnête + faisable + pré-requis nécessaire. Fxmily mesure ce que le membre CONTRÔLE (process), pas ce qu'il ne contrôle pas (marché).

## §2. Posture éducative non-négociable

- ❌ Pas de conseil sur les trades (setups, prévisions, marché)
- ✅ Conseils autorisés sur l'**exécution** (sessions, hedge, plan, discipline)
- ✅ Conseils autorisés sur la **psychologie** (Mark Douglas + ancrage peer-reviewed Lo/Repin/Steenbarger 2005)
- ❌ Pas de signaux, pas de Discord VIP, pas d'affiliate >20 %, pas de promesse revenu
- ⚠️ **Ligne rouge AMF/FCA** : recommandation personnalisée = régulé. Education + tracking = défendable.
- 📌 Consultation juriste CIF obligatoire avant 100 membres payants (~300-500 € budget).

## §3. North Star + métriques secondaires

**North Star (validée Eliot 2026-05-11 Q3=b)** : **évolution du score discipline moyen cohorte +X % sur 12 semaines glissantes.**

Toute feature passe par le filtre : _"ça améliore la mesure ou la progression du score discipline ?"_. Si NON → descope.

**Métriques secondaires (suivies, pas North Star)** :

- D7 / D30 / D90 retention
- % membres ≥4 check-ins/semaine pendant 4 semaines d'affilée
- NPS membres ≥50 (trimestriel)
- Routine compliance % (post V1.8)
- Engagement Douglas `view_duration_ms` moyen
- Coach impact % membres avec ≥1 coach note/mois (post V1.9)

## §4. Cinq paradoxes résolus

| Paradoxe                                        | Résolution                                                                                        |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| Maximum data ↔ Plaisant à faire                 | **Data passive d'abord** (HealthKit, broker import). Saisie active uniquement pour introspection. |
| Système ultra-autonome ↔ Membre doit se pousser | **L'app SUGGÈRE, le membre DÉCIDE.** Zéro feature coercitive.                                     |
| Eliot mieux accompagner ↔ App accompagne auto   | **Fxmily est l'OUTIL d'Eliot, pas son remplaçant.** IA prépare, Eliot conduit.                    |
| Posture éducative ↔ Accompagnement ultra-poussé | Conseiller sur **PROCESS** (respect plan, gestion émotion), jamais sur **DÉCISION TRADING**.      |
| Système le plus avancé ↔ Plaisant à utiliser    | **Modules progressifs débloqués** selon engagement. Day 1 = simple. Day 90 = complet.             |

## §5. L'ennemi / L'allié

**Fxmily n'est PAS, jamais** :

- Une formation (la formation existe par ailleurs)
- Un service de signaux / Discord VIP / Telegram
- Une prop firm / programme d'affiliation
- Un broker journal type Edgewonk générique solo trader
- Une promesse de rentabilité
- Un système coercitif (FOMO, streak shame, dark patterns)
- Un système qui remplace Eliot

**Fxmily EST, toujours** :

- L'outil propriétaire de la formation Fxmily d'Eliot
- Un système de tracking comportemental strict (exécution + psychologie + routines + contexte)
- Un compagnon quotidien discret pour le membre
- Un super-pouvoir admin pour Eliot
- Un système White Hat (mastery, autonomy, meaning, accomplishment)
- Un produit conforme RGPD + AMF par design
- Un produit scientifiquement ancré

---

# PARTIE II — ARCHITECTURE PRODUIT

## §6. Les 7 modules

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
        └─── nudge ──│ 6.DEBRIEF   │◄─────────┘
                    │ (coach notes│
                    │  + sessions)│
                    └─────────────┘

  Toutes les modules convergent vers :
  📍 NORTH STAR = score discipline trajectoire 12 semaines
```

| Module          | Quoi                                           | Impact North Star   | Effort total V2         |
| --------------- | ---------------------------------------------- | ------------------- | ----------------------- |
| **1. TRACK**    | Trades, check-ins, contexte                    | ⭐⭐⭐ direct       | 8h V1.7 extension       |
| **2. REFLECT**  | Douglas, weekly review, post-trade prompt      | ⭐⭐ indirect       | 10-12h V1.7             |
| **3. LEARN**    | QCMs, tests psychométriques, spaced repetition | ⭐ indirect         | 12h V1.9                |
| **4. ROUTINE**  | Pre/post-market, weekly review, custom         | ⭐⭐⭐ direct       | 10-12h V1.8             |
| **5. PROGRESS** | Path 6 phases, milestones, archetype           | ⭐ indirect         | 6h V2.0 (avec DEBRIEF)  |
| **6. DEBRIEF**  | Coach notes, sessions, brief generator         | ⭐ direct via coach | 6h V2.0 (avec PROGRESS) |
| **7. SHARE**    | Cohort dashboard admin, broadcast              | ⭐ direct via Eliot | 5-7h V1.7 broadcast     |

## §7. Filtre stratégique — 10 phrases-test

**Avant toute feature, répondre OUI à au moins 3** :

1. Sert-elle la North Star score discipline +X % sur 12 semaines ?
2. Est-elle plaisante pour le membre (pas une corvée) ?
3. Pousse-t-elle le membre (sans le forcer) ?
4. Donne-t-elle à Eliot plus de matière de coaching ?
5. Respecte-t-elle la posture éducative (zéro conseil trade) ?
6. Peut-elle être scientifiquement défendue (peer-reviewed si possible) ?
7. Est-elle mesurable dans le temps (pas vanity metric) ?
8. Mesure-t-elle ce que le membre CONTRÔLE (process), pas ce qu'il ne contrôle pas (marché) ?
9. Évite-t-elle les Black Hat gamification patterns (FOMO, streak shame, overjustification) ?
10. Ferait-elle hocher la tête à Mark Douglas + Brett Steenbarger + Lo/Repin s'ils la voyaient ?

**3+ OUI = feature valide. <3 OUI = on ne fait pas.**

## §8. Anti-patterns confirmés (hard rules)

1. **Black Hat gamification** (Yu-kai Chou CD8 loss/avoidance) — addiction risk doublé en contexte trading
2. **Streak shame** — `if streak_lost: shame_user` = burnout pattern (Decision Lab 2024)
3. **Trader archetype / personality profile fixe** — debunké par Lo/Repin/Steenbarger 2005 (pas de personality profile fiable)
4. **Conseil personnalisé d'achat/vente** — ligne rouge AMF/FCA
5. **Data collection sans consentement granulaire** — RGPD strict
6. **Push notifications hors fenêtre attentionnelle** — pas avant 7h ni après 22h timezone membre
7. **Test psychométrique non validé scientifiquement** — pas de "What's your trading personality?" Buzzfeed
8. **Forced sharing / social pressure** — pas de "X autres ont déjà fait Y"
9. **Streaks infinis sans freeze** — toujours mécanisme repos responsable
10. **Vendre Fxmily comme garantie de rentabilité** — illégal + faux (70-85 % retail perdants ESMA)

**Ego features identifiées et rejetées** :

- TradingView screenshot auto (ROI négligeable, 20-30h dev)
- iOS Screen Time tracking (data non-actionnable)
- Google Calendar full sync auto (surface OAuth vs dropdown 2 lignes)
- Cycle menstruel (Art. 9 RGPD + pseudoscience retail + stigmatisation)
- Système messagerie 1-1 complet (overkill, CoachDebrief.sessions[] suffit)

---

# PARTIE III — SURFACE FEATURES

## §9. Inventaire 120 features par module

Notation : **D**=V1.7-V1.8 / **M**=V2.0 / **L**=V2.x+ / **N**=ne pas faire

### A. Module TRACK — contexte de vie élargi (14 features)

A1-D Sommeil détaillé · A2-M Nutrition · A3-M Caféine timing · A4-M Sport · A5-M Méditation · A6-L Événements vie · A7-L Pression $ · A8-L Météo/luminosité · A9-L Isolement · A10-L Ergonomie · A11-L Écrans bleus · A12-N Cycle menstruel · A13-L Alcool/médicaments · A14-L Phone usage

### B. Module TRACK — process trade granulaire (10 features)

B1-M Pre-trade hesitation · B2-D SL move count · B3-D Position size deviation · B4-M Time-in-trade · B5-D Re-entry after stop-out · B6-M Confidence rating per trade · B7-M Pre-mortem 1-ligne · B8-N Voice→texte (anti-audio) · B9-N Screen recording · B10-M Auto-tag IA

### C. Module REFLECT — émotionnel deep (9 features)

C1-M Granularité Feldman Barrett · C2-L Body scan · C3-D Trigger tracking · C4-D Coping mechanism · C5-L Self-compassion Neff · C6-M CBT reframing · C7-M Mood color picker · C8-D Daily intention 1-phrase · C9-L Reverse journal

### D. Module REFLECT — AI coach (9 features)

D1-M Daily AI debrief texte court · D2-D Pattern detection auto · D3-M Weekly AI challenge · D4-M Monthly evolution · D5-L Talk-to-your-data · D6-M Real-time nudge · D7-M Past-self compare · D8-L Eliot talk-to-cohort · D9-M Auto-tag IA trades

### E. Intégrations passives (8 features)

E1-M HealthKit Capacitor · E2-L iOS Screen Time · E3-L MT4/5 · E4-L IBKR API · E5-M TradingView webhook · E6-L Calendar opt-in · E7-L Chrome extension · E8-D CSV manuel universal

### F. Module ROUTINE — athlète pro (8 features)

F1-M Pre-game ritual · F2-M Cool-down post-game · F3-M Active recovery days · F4-L Peaking cycles · F5-L Off-season structuré · F6-L Athlete mode toggle · F7-M Breathing exercise 4-7-8 · F8-M Best/worst week auto-detect

### G. Risk management actif (6 features)

G1-D Daily loss limit nudge · G2-D Weekly limit warning · G3-D Stop trading suggestion 3 losing · G4-M Position sanity check 2x · G5-M Revenge trade cooldown 15min · G6-L Fatigue alert 8h+

### H. Module REFLECT — knowledge management (6 features)

H1-M Glossary perso · H2-D Bookmarks fiches · H3-M Highlight+annotate fiches · H4-M Lessons learned library · H5-D Pre-trade checklist custom · H6-M Fiches Eliot custom

### I. Module REFLECT — réflexions multi-niveau (7 features)

I1-D Daily review courte 60s · I2-D Weekly review 10min dimanche · I3-M Monthly review · I4-L Quarterly review · I5-L Annual review · I6-L Pre/post event marché · I7-M Trade post-mortem deep dive

### J. Module SHARE — social opt-in anonyme (5 features) + 1N

J1-L Vibe check cohort agrégé · J2-L Cohort weekly report · J3-L Buddy system 1:1 anonyme · J4-L Group challenges sans leaderboard · J5-L Anonymous Q&A · ❌ Public leaderboard = N

### K. Module SHARE — Eliot super-pouvoirs (8 features)

K1-M At-risk alert · K2-M Cohort compare · K3-D Heat map calendrier · K4-M Broadcast 1-many · K5-L DM Eliot→member · K6-L Fiches custom · K7-M MRR/churn/LTV · K8-D Cohort health score

### L. Module REFLECT — voice of member (5 features)

L1-L SOS button · L2-D Feedback widget · L3-D NPS trimestriel · L4-M Member-initiated debrief · L5-L Suggestion box features

### M. Fun / plaisant White Hat (6 features)

M1-L Avatars génériques · M2-L Thèmes · M3-M Sons satisfaisants · M4-L Haptic Capacitor V2 · M5-L Wallpapers Douglas · M6-L Trader name custom

### N. Module TRACK — performance peaks (5 features)

N1-M Correlation sleep×discipline · N2-M Correlation stress×outcome · N3-L Correlation workouts×focus · N4-L Best state replay · N5-M Personal benchmark trajectory

### O. Module ROUTINE — pre-trade rituel (5 features) + 1N

O1-N Visualization audio · O2-M Visualization texte · O3-D Pre-trade checklist modal · O4-M Breathing 4-7-8 timer · O5-D Affirmation Douglas du jour

### P. Module ROUTINE — post-trade cool-down (5 features)

P1-M Décompression 5min · P2-M Gratitude prompt · P3-D Last lesson 1-ligne · P4-L Forced break big win/loss · P5-L Auto-lock session

### Q. Module PROGRESS — intégration formation externe (4 features)

Q1-L SSO LMS externe · Q2-L Module en cours visible read-only · Q3-L Référencement depuis Fxmily · Q4-L Webhook bidirectionnel

### R. Module REFLECT — sécurité émotionnelle (4 features)

R1-L Burnout detection · R2-L Mental health day suggested · R3-D Ressources externes SOS · R4-M Self-binding limites quotidiennes

### S. Module PROGRESS — performance long-terme (4 features)

S1-L 6-month retro · S2-L 12-month compare · S3-L Archetype evolution graph · S4-L PDF snapshot exportable

### T. Business membre (3 features)

T1-L Stripe self-service · T2-L Renewal reminder · T3-L Member portal facturation

## §10. Priorisation D/M/L/N

- **D (V1.7-V1.8)** : ~17 features — focus direct North Star
- **M (V2.0)** : ~35 features — enrichissement IA, athlète, risk actif
- **L (V2.x+)** : ~55 features — post-PMF, scale, intégrations lourdes
- **N (ne pas faire)** : 5 anti-patterns documentés

**Effort total** : D+M = ~52 features = 200-300h dev = ~20-30 sessions Claude Code. L = 300-500h additionnel.

**Garde-fou** : aucune feature codée sans avoir passé §7 (10 phrases-test).

---

# PARTIE IV — ARCHITECTURE TECHNIQUE

## §11. Stack existant (rappel)

Next.js 16 + React 19 + TypeScript strict + Prisma 7 (driver adapter `@prisma/adapter-pg`) + Postgres 17 self-hosted Hetzner CX22 + Caddy + Docker Compose. Auth.js v5 JWT + argon2id. Tailwind 4 + shadcn/ui + Framer Motion. Resend HTTP API. R2 (médias). Sentry tunnel. Anthropic Claude API (V1 mock, V1.7 live). Vitest + Playwright. Turborepo + pnpm + Node 22 LTS.

**Réutilisé tel quel** : audit log + 9 crons + cron-watch + RGPD export + Web Push VAPID + pseudonymisation admin (`pseudonymLabel`) + backup pg_dump + GPG + `.gitattributes` LF-enforce + `fix-crlf-prod.sh`.

## §12. Nouveaux modèles Prisma — 13 modèles, 5 migrations

### Migration 1 — `v1_7_routines_habits_broadcast` (LOW risk)

3 tables + 1 enum

```prisma
model RoutineTemplate {
  id        String              @id @default(cuid())
  ownerId   String?             @map("owner_id")     // null = admin-defined
  owner     User?               @relation("OwnedRoutines", fields: [ownerId], references: [id], onDelete: Cascade)
  slug      String              @unique
  title     String
  kind      RoutineKind
  steps     Json                                      // [{ id, label, type: 'boolean'|'rating'|'text', required }]
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
  date        DateTime        @db.Date
  responses   Json
  completedAt DateTime?       @map("completed_at")
  createdAt   DateTime        @default(now()) @map("created_at")
  updatedAt   DateTime        @updatedAt @map("updated_at")

  @@unique([userId, templateId, date])
  @@index([userId, date(sort: Desc)])
  @@map("routine_completions")
}

model HabitLog {
  id        String   @id @default(cuid())
  userId    String   @map("user_id")
  user      User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  date      DateTime @db.Date
  habitKey  String   @map("habit_key")
  value     Decimal  @db.Decimal(10, 4)
  source    String   @default("manual")  // 'manual' | 'apple_health_manual_export' | 'shortcuts_webhook' | 'capacitor_healthkit'
  createdAt DateTime @default(now()) @map("created_at")

  @@unique([userId, date, habitKey, source])
  @@index([userId, date(sort: Desc)])
  @@map("habit_logs")
}

enum RoutineKind {
  pre_market
  post_market
  weekly_review
  custom
}
```

Migration 1bis (même PR) — Broadcast admin :

```prisma
model AdminBroadcast {
  id             String   @id @default(cuid())
  authorId       String   @map("author_id")
  author         User     @relation("BroadcastsAuthored", fields: [authorId], references: [id], onDelete: Cascade)
  title          String
  body           String   @db.Text       // markdown + safeFreeText
  publishedAt    DateTime? @map("published_at")
  expiresAt      DateTime? @map("expires_at")
  audienceFilter Json?    @map("audience_filter")
  createdAt      DateTime @default(now()) @map("created_at")
  updatedAt      DateTime @updatedAt @map("updated_at")
  receipts       BroadcastReceipt[]

  @@index([publishedAt(sort: Desc)])
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

### Migration 2 — `v1_8_quizzes` (LOW risk)

2 tables + 1 enum + ALTER TYPE

```prisma
model QuizTemplate {
  id          String        @id @default(cuid())
  slug        String        @unique
  title       String
  description String?       @db.Text
  kind        QuizKind
  questions   Json
  scoring     Json
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
  attemptNum  Int          @map("attempt_num")
  answers     Json
  score       Int?
  dimensions  Json?
  startedAt   DateTime     @default(now()) @map("started_at")
  completedAt DateTime?    @map("completed_at")

  @@unique([userId, templateId, attemptNum])
  @@index([userId, completedAt(sort: Desc)])
  @@map("quiz_attempts")
}

enum QuizKind {
  knowledge
  psychometric
}
```

`ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'quiz_result_ready';`

### Migration 3 — `v1_9_path_coach` (MEDIUM risk — relations doubles)

4 tables + 1 enum

```prisma
model PathModule {
  id          String          @id @default(cuid())
  slug        String          @unique
  title       String
  description String?         @db.Text
  position    Int
  published   Boolean         @default(false)
  requires    String[]
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
  @@map("member_milestone_progress")
}

model CoachDebrief {
  id        String   @id @default(cuid())
  memberId  String   @map("member_id")
  member    User     @relation("DebriefSubject", fields: [memberId], references: [id], onDelete: Cascade)
  coachId   String   @map("coach_id")
  coach     User     @relation("DebriefAuthor", fields: [coachId], references: [id], onDelete: Cascade)
  notes     String?  @db.Text                  // safeFreeText OBLIGATOIRE
  sessions  Json     @default("[]")
  tags      String[]
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

⚠️ **CoachDebrief.notes PII** (HIGH si non enforced) :

- `safeFreeText(notes)` Zod layer
- `NEVER` log notes content dans AuditLog metadata
- Inclus dans RGPD export Art. 15
- Cascade purge via `onDelete: Cascade`

### Migration 4 — `v2_0_trader_profile` (LOW risk)

1 table

```prisma
model TraderProfile {
  id         String   @id @default(cuid())
  userId     String   @unique @map("user_id")
  user       User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  archetype  String?
  dimensions Json?
  correlated Json?
  computedAt DateTime @default(now()) @map("computed_at")
  createdAt  DateTime @default(now()) @map("created_at")
  updatedAt  DateTime @updatedAt @map("updated_at")

  @@index([archetype])
  @@map("trader_profiles")
}
```

### Migration 5 — `v2_x_imports` (V2.x, après Capacitor)

2 tables pour audit imports passifs + extension Trade

```prisma
model HealthImportBatch {
  id              String   @id @default(cuid())
  userId          String   @map("user_id")
  user            User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  source          String
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
  source         String
  filename       String?
  storageKey     String?  @map("storage_key")
  recordsTotal   Int      @map("records_total")
  recordsMatched Int      @map("records_matched")
  recordsCreated Int      @map("records_created")
  recordsSkipped Int      @map("records_skipped")
  importedAt     DateTime @default(now()) @map("imported_at")
  dateFrom       DateTime @db.Date @map("date_from")
  dateTo         DateTime @db.Date @map("date_to")

  @@index([userId, importedAt(sort: Desc)])
  @@map("broker_import_batches")
}

// Extension Trade — backward-compat nullable
// trade.brokerImportBatchId String? @map("broker_import_batch_id")
// trade.brokerTradeId       String? @map("broker_trade_id")
```

## §13. Intégrations passives — verdicts

| Intégration                               | V    | Effort                | Décision                                                                                 |
| ----------------------------------------- | ---- | --------------------- | ---------------------------------------------------------------------------------------- |
| HealthKit export ZIP manuel               | V1.8 | 8-10h                 | ✅ FAIRE                                                                                 |
| HealthKit iOS Shortcuts webhook           | V2.0 | 4-5h                  | ✅ FAIRE post-Capacitor                                                                  |
| HealthKit Capacitor natif                 | V2.x | 15-20h + $99/an Apple | ✅ FAIRE post-PMF                                                                        |
| CSV broker universel (MT4/5/IBKR/cTrader) | V1.8 | 8-10h                 | ✅ FAIRE                                                                                 |
| TradingView webhook ingestion             | V2.0 | 4-6h                  | ✅ FAIRE                                                                                 |
| IBKR Client Portal API                    | V2.x | 20-25h                | ⏳ Sur demande membre                                                                    |
| Calendar Apple/Google auto                | —    | —                     | ❌ NE PAS FAIRE — dropdown manual checkin couvre 90 %                                    |
| Cycle menstruel Flo/Clue                  | —    | —                     | ❌ NE JAMAIS FAIRE — Art. 9 RGPD + pseudoscience retail + stigmatisation + APIs absentes |
| iOS Screen Time                           | —    | —                     | ❌ Ego feature non-actionnable                                                           |
| Chrome extension TradingView              | —    | —                     | ❌ ROI négligeable vs 20-30h                                                             |

**Alternative Calendar pragmatique** : `DailyCheckin.contextFlags Json?` + dropdown checkin soir `[FOMC/NFP] [Sport] [Stress fam] [Voyage] [Autre]`. Effort 1-2h, ROI quasi-identique, ZÉRO risque RGPD.

## §14. AI coach Anthropic — pattern d'usage

**V1 mock → V1.7 LIVE** (ANTHROPIC_API_KEY + ~$12/mois budget cap).

**Patterns implémentés** :

- Weekly report personnalisé (existant V1 mock)
- Daily AI debrief texte court 180 char max (V2.0)
- Pattern detection automatique (V1.7) : ex. 3 revenge trades / 5 jours → push contextuel + fiche Douglas ciblée
- Weekly AI challenge personnalisé 1 objectif comportemental (V2.0)
- Monthly AI rapport évolution 1 page (V2.0)
- "Talk to your data" via tool use (V2.x) — query sa propre data en langage naturel

**Garde-fous** :

- System prompt verrouille posture (zéro conseil trade)
- `fxmily-content-checker` valide chaque pattern avant deployment
- Budget cap mensuel hard ($25/mois max)
- Sentry tracks API errors + latency p99

## §15. Scoring discipline — alimentation par module

Le score discipline (`lib/scoring/discipline.ts`) actuel V1 :

```
discipline = planRespect(35) + hedgeRespect(20) + eveningPlan(25) + intentionFilled(10) + routineCompleted(10)
```

**V1.7 extension** :

```
discipline = planRespect(30) + hedgeRespect(20) + eveningPlan(20) + intentionFilled(5) + routinePreMarketRate(15) + tradeTagPenalty(10)
```

`routinePreMarketRate` lit `RoutineCompletion.completedAt IS NOT NULL` sur 30j.
`tradeTagPenalty` lit `Trade.tags` sur 30j et pénalise `revenge` / `fomo` / `oversizing`.

**V1.9 extension** :

- `quizCompletionRate` → alimente `engagement` scorer (pas discipline)
- `pathProgressRate` → alimente `engagement` scorer

**V2.0 extension** :

- `TraderProfile` reste NEUTRE au score numérique (interprétatif uniquement)
- Coach notes restent NEUTRES au score (contexte weekly report uniquement)

**Principe** : le score est **déterministe + observable + behaviorial**. Pas d'IA dans le calcul.

## §16. Audit log — nouveaux events

```typescript
// V1.7
'routine.pre_market.submitted';
'routine.post_market.submitted';
'routine.weekly_review.submitted';
'routine.custom.submitted';
'habit.log.created'; // metadata: { habitKey, source, date } — NEVER value
'broadcast.created';
'broadcast.published';
'broadcast.seen';

// V1.8
'health.import.zip.completed';
'broker.import.csv.completed';
'quiz.knowledge.submitted';
'quiz.psychometric.submitted';
'quiz.result.viewed';

// V1.9
'path.milestone.started';
'path.milestone.completed';
'path.milestone.skipped';
'coach.debrief.created'; // metadata: { debriefId, memberId } — NEVER notes content
'coach.debrief.updated';
'coach.session.scheduled';
'coach.session.completed';

// V2.0
'profile.archetype.computed';
'cron.profile_recompute.scan';

// V2.x
'health.import.capacitor.completed';
'broker.sync.ibkr.completed';
'broker.import.tradingview.received';
```

---

# PARTIE V — PLAN SÉQUENTIEL

> **Règle SPEC §18.4 non-négociable** : 1 session Claude Code = 1 jalon. `/clear` entre chaque. Chaque jalon ~8-12h dev.

## §17. V1.6 — Stabilisation backend (4-6h) ⭐ PROCHAIN JALON

**Scope** :

- Sentry alerting taxonomy (`error` vs `warning` vs `info`)
- Email frequency cap (`is_transactional` field anti-spam)
- `/admin/system` cron-watch enrichi (backup runtime + R2 status)
- 10 PRs dependabot majors triagés (merge low-risk, defer high-risk)

**Done** :

- Cron Watch 7 jours green continu
- Sentry <50 events/jour mock baseline
- Email cap actif scenarios test
- `pnpm format:check && pnpm lint && pnpm type-check && pnpm build` verts
- Vitest pour freq cap
- `code-reviewer` post-impl
- `/fxmily-deliver-jalon` AVANT `/clear`

## §18. V1.7 — REFLECT + foundations North Star (10-12h)

**Scope** :

- `RoutineTemplate` + `RoutineCompletion` + `HabitLog` (Migration 1)
- `AdminBroadcast` + `BroadcastReceipt` (Migration 1bis)
- Trade.tags multi-select (revenge/fomo/overconfidence/oversizing/exit-too-early/discipline)
- Trade.outcomeR (R-multiple)
- Scoring discipline V1.7 (routine + tagPenalty)
- Anthropic LIVE activation + monitoring coût
- Trigger engine evaluators sur trade tags V1.7
- Cooldown intelligent fiches (`view_duration_ms` threshold)
- Sentry capture taxonomy
- Disclaimer AMF footer + emails
- `WeeklyReview` model + wizard dimanche
- Post-trade prompt contextuel (pool 30 items Eliot-authored)
- `ReflectionEntry` model séparée

**Done** :

- 80 % adhésion weekly review sur 3 membres test pendant 2 semaines
- Trigger engine répond aux tags
- Anthropic LIVE budget <$15/mois
- Build vert
- `fxmily-content-checker` valide tous nouveaux contenus

## §19. V1.8 — ROUTINE customizable + HealthKit/CSV (10-12h)

**Scope** :

- Builder admin Routine (UI Eliot crée templates pour cohorte)
- Pre-market routine UI + cron rappel
- Post-market routine UI + cron rappel
- Weekly review routine UI dimanche
- HealthKit ZIP manuel + parser XML + `HealthImportBatch`
- CSV broker universel (MT4/5/IBKR/cTrader parsers) + `BrokerImportBatch`
- `DailyCheckin.contextFlags Json?` champ + UI dropdown
- Heat map calendrier admin (K3)

**Done** :

- 3 membres test avec ≥1 routine custom + 7 jours adherence tracking
- HealthKit ZIP fonctionnel sur 1 membre
- CSV import fonctionnel sur 1 membre (n'importe quel broker)
- Build vert + tests Vitest scoring

## §20. V1.9 — LEARN baseline (12h)

**Scope** :

- `QuizTemplate` + `QuizAttempt` (Migration 2)
- 1 test psychométrique onboarding (Grable & Lytton 13-item)
- 1 banque QCM execution ~50 questions (allowlist topics `session/hedge/plan/risk` — JAMAIS `setup/entry-signal`)
- Spaced Repetition FSRS lite (Anki 23.10+ algorithm)
- Affichage `Knowledge` score sur dashboard membre
- D7/D30 retention metric admin

**Done** :

- Nouveau membre fait test onboarding + 1 QCM hebdo récurrent
- `fxmily-content-checker` valide allowlist OBLIGATOIRE chaque QCM
- Build vert

⚠️ **Risque AMF/FCA élevé** : `/spec` obligatoire avant pour clarifier scope quiz. Subagent `fxmily-content-checker` BLOQUANT avant commit.

## §21. V2.0 — PROGRESS + DEBRIEF (12h)

**Scope** :

- `PathModule` + `PathMilestone` + `MemberMilestoneProgress` + `CoachDebrief` (Migration 3)
- Path "Trader Discipliné" 6 phases (Découverte → Calibration → Stabilisation → Consistance → Performance → Maîtrise)
- Critères factuels par phase (X check-ins / score ≥ Y / N QCMs réussis)
- Eliot brief auto-generator (LLM Anthropic résume contexte 7 derniers jours)
- Member-side "ma prochaine session : 3 sujets" widget
- After-call structured note Eliot
- `TraderProfile` (Migration 4) + cron recompute Lundi 05:00 UTC
- TradingView webhook ingestion

**Done** :

- Eliot fait 3 debriefs réels avec briefs auto-générés et action items tracked
- 3 membres test ont path visible + 1 milestone completed
- Build vert

## §22. V2.x — Backlog post-PMF (≥50 membres actifs)

- iPhone PWA smoke physique (Steps 5/6/9 SPEC §15 J10)
- Capacitor V2 + App Store ($99/an Apple)
- HealthKit Capacitor native plugin
- IBKR Client Portal API (sur demande membre)
- SHARE module (cohort heatmap NPS) — reporter post-PMF ≥80 membres
- CSP nonces (refactor proxy.ts edge)
- JWT tokenVersion révocation immédiate
- Login rate-limit credential-stuffing
- Service Worker offline strategy
- Listing cursor pagination >100 trades
- Annual DR test automatisé
- Consultation juriste CIF (~300-500€) AVANT 100 membres payants

---

# PARTIE VI — DÉCISIONS D'ÂME À ARBITRER

## §23. Les 10 manques M1-M10

Ces 10 décisions sont **non-déléguables à Claude**. Elles personnalisent Fxmily à TA formation et TON public. Sans elles, le plan §17-§22 est complet mais générique.

| #       | Question                                                                                                                  | Pourquoi bloquant                               | Statut           |
| ------- | ------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------- | ---------------- |
| **M1**  | C'est quoi "ta formation marche bien" en chiffres (MRR, % completion, rétention, churn) ?                                 | Sans baseline, "+X % discipline" est arbitraire | ⏳ Attente Eliot |
| **M2**  | C'est quoi "la meilleure formation possible" pour toi (rentabilité membres / nb membres / NPS / durée) ?                  | Sans définition, on optimise dans le vide       | ⏳ Attente Eliot |
| **M3**  | Membre idéal Fxmily : débutant 6 mois ? Break-even 2 ans ? Edge psy 5 ans ?                                               | Change tout le design UX                        | ⏳ Attente Eliot |
| **M4**  | LA métaphore Fxmily pour le membre (WHOOP = coach fitness, Headspace = guide médit, Fxmily = ?)                           | Sans métaphore, aucun attachement               | ⏳ Attente Eliot |
| **M5**  | LE rituel quotidien central (morning checkin / soir routine / pre-trade modal) ?                                          | Sans rituel, l'app reste accessoire             | ⏳ Attente Eliot |
| **M6**  | LE wow moment qui fait dire "ça vaut le coup" (rapport hebdo IA / pattern detection / score grimpe) ?                     | Sans wow moment, churn rapide                   | ⏳ Attente Eliot |
| **M7**  | Les 3 autres outils de ta formation à côté de Fxmily (Discord ? Notion ? Skool ? Livestreams ?)                           | Pour positionner Fxmily dans l'écosystème       | ⏳ Attente Eliot |
| **M8**  | Promesse temporelle au membre à 12 semaines ("Je suis discipliné" / "Plus de revenge trade" / "J'ai compris ma psycho") ? | Sans promesse, aucune narration                 | ⏳ Attente Eliot |
| **M9**  | Ton rituel quotidien à TOI dans Fxmily ? Tu ouvres l'app, tu fais quoi en 5 min ?                                         | Pour designer l'admin DE VRAI                   | ⏳ Attente Eliot |
| **M10** | Courbe émotionnelle du membre Day 1 / Day 7 / Day 30 / Day 90 ?                                                           | Pour designer la rétention                      | ⏳ Attente Eliot |

**Process recommandé** : tu réponds en 1-2 phrases courtes par question, dans l'ordre. Tu peux en sauter, en grouper. L'important = avoir TES réponses, pas de la perfection.

Une fois ces 10 réponses obtenues → re-tri des 120 features § 9 selon TON projet spécifique.

---

# PARTIE VII — ANCRAGE SCIENTIFIQUE

## §24. Bibliographie peer-reviewed

**Posture trading psychology** :

- Lo, Repin, Steenbarger (2005) — _Fear and Greed: A Clinical Study of Day-Traders_ (SSRN 690501) — traders avec réaction émotionnelle plus intense ont performance significativement pire ; pas de personality profile fiable identifiable
- Kahneman & Tversky — overconfidence, loss aversion, anchoring, confirmation bias (Nobel 2002)
- Andrew Lo — Adaptive Markets Hypothesis (MIT)
- Barber & Odean — _The Profitability of Day Traders_ (FAJ) — 64 % net négatif, transaction costs

**Stats réalité retail** :

- ESMA disclosure CFD 2018 → 70-85 % retail perdants, perte moyenne €1 600 à €29 000
- FCA UK ~80 % non profitables
- Étude Brésil ~20 000 day traders / 300 jours → 97 % perdent, 1 % rentable durable

**Routines pre-performance** :

- Rupprecht, Tran, Gröpel (2024) — _International Review of Sport and Exercise Psychology_ — méta-analyse 112 effect sizes, **Hedges' g = 0.64-0.70 sous pression**

**Spaced repetition** :

- Cepeda et al. (2006) — _Psychological Bulletin_ — effet d'espacement robuste depuis Ebbinghaus 1885
- FSRS algorithm (Anki 23.10+) — 20-30 % moins de révisions à rétention équivalente vs SM-2

**Tests psychométriques** :

- Grable & Lytton 13-item Risk Tolerance — Kuzniak et al. 2015 (n=160 279, Cronbach α=0.77)
- Big Five OCEAN trading-applied — Jiang/Peng/Yan LSE, Durand et al. 2013
- Abdellaoui 2016 loss aversion — ScienceDirect, recommandé ESMA/FCA (n=4 780)
- CFA Institute Behavioral Biases taxonomy 2026

**Granularité émotionnelle** :

- Lisa Feldman Barrett (Northeastern) — emotion granularity prédit régulation

**Self-compassion** :

- Kristin Neff (UT Austin) — Self-Compassion Scale (SCS)

**Hawthorne / observer effect** :

- McCambridge et al. (2014) — _Journal of Clinical Epidemiology_ — systematic review 19 études

## §25. Bibliographie pro-grade

- Mark Douglas — _Trading in the Zone_ (référence du framework triggers Fxmily)
- Brett Steenbarger — _The Daily Trading Coach_, _Enhancing Trader Performance_, blog TraderFeed (inspiration heuristique, ⚠️ pas instrument psychométrique validé peer-reviewed)
- Mike Bellafiore (SMB Capital) — _The PlayBook_, framework process-discipline
- Yu-kai Chou — _Actionable Gamification_ (Octalysis framework White Hat / Black Hat)
- Denise Shull — _Market Mind Games_
- Linda Raschke — patterns process

## §25bis. Sources marché / régulation

- AMF France finfluencers fact-sheet jan 2026
- FCA UK regulatory priorities 2025 (9 finfluencers poursuivis 2024)
- IOSCO Final Report FR/08/2025 — Finfluencers and unregistered brokers
- SEC Investor Alert — Group Chats as Gateway to Investment Scams

---

# PARTIE VIII — OPS / DEV WORKFLOW

## §26. Règle SPEC §18.4 non-négociable

**1 session Claude Code = 1 jalon. `/clear` entre chaque.**

Chaque jalon respecte le workflow :

1. Lire `SPEC.md` + ce master + `apps/web/CLAUDE.md` au démarrage (auto via `fxmily-jalon-tracker`)
2. TodoWrite plan court avant code multi-fichiers
3. Implémentation par incréments vérifiables
4. Vérification systématique `pnpm format:check && pnpm lint && pnpm type-check && pnpm build`
5. Tests Vitest pour logique critique (`lib/scoring/*`, `lib/triggers/*`, `lib/calculations/*`)
6. Subagent `code-reviewer` post-implémentation
7. Subagent `fxmily-content-checker` si UI / emails / blog touchés
8. Skill `/fxmily-prisma-migrate` AVANT toute modif schema
9. Skill `/commit-safe` pour commit
10. Skill `/fxmily-deliver-jalon` AVANT `/clear`

## §27. Pickup prompt V1.6 — copier dans nouvelle session post-/clear

```text
Démarre le Jalon V1.6 — Stabilisation backend.

Lis d'abord :
1. docs/FXMILY-V2-MASTER.md (source de vérité produit + plan séquentiel)
2. apps/web/CLAUDE.md (V1.6 audit + V1.7 backlog)
3. SPEC.md §15 (jalons V1 livrés)

Scope V1.6 (4-6h dev) :
- Sentry alerting taxonomy
- Email frequency cap (is_transactional field)
- /admin/system cron-watch enrichi (backup runtime + R2 status)
- 10 PRs dependabot majors triagés

Critères Done (cf. §17 master) :
- Cron Watch 7 jours green continu
- Sentry <50 events/jour baseline
- pnpm format:check && pnpm lint && pnpm type-check && pnpm build verts
- Tests Vitest freq cap
- code-reviewer post-impl
- /fxmily-deliver-jalon AVANT /clear

Posture : Mark Douglas non-négociable. Autonomie max. /clear à la fin.

Lance fxmily-jalon-tracker au démarrage.
```

## §28. Subagents pattern par jalon

| Jalon                       | Subagents recommandés                                                                                        |
| --------------------------- | ------------------------------------------------------------------------------------------------------------ |
| V1.6 stabilisation          | `fxmily-jalon-tracker` (début) + `code-reviewer` (fin)                                                       |
| V1.7 REFLECT + foundations  | `/fxmily-prisma-migrate` (avant schema) + `fxmily-content-checker` (avant commit UI) + `code-reviewer` (fin) |
| V1.8 ROUTINE + intégrations | `/fxmily-prisma-migrate` + `security-auditor` (HealthKit data sensible) + `code-reviewer`                    |
| V1.9 LEARN                  | `/fxmily-prisma-migrate` + `fxmily-content-checker` BLOQUANT (red line AMF) + `code-reviewer`                |
| V2.0 PROGRESS + DEBRIEF     | `/fxmily-prisma-migrate` + `security-auditor` (CoachDebrief.notes PII) + `code-reviewer`                     |

---

# CHANGELOG

- **2026-05-11 v1.0** — Création initiale via interview Eliot 9 rounds + 5 subagents (planner, researcher × 3, code-architect × 2). Remplace SPEC-V2-VISION.md + MANIFESTO-V2.md (à archiver). Source unique de vérité produit V2.
