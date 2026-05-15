# FXMILY V2 — MASTER PLAN

> **Document unique. Source de vérité produit.**
> Remplace [`SPEC-V2-VISION.md`](archive/SPEC-V2-VISION.md) + [`MANIFESTO-V2.md`](archive/MANIFESTO-V2.md) (archivés 2026-05-15 dans `docs/archive/`).
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

**PARTIE IX — RISQUES PRODUIT & ÉTHIQUE (Round 11)**

- §29 Top 5 risques produit (vs techniques)
- §30 Éthique IA — Anthropic LIVE garde-fous

**PARTIE X — RÉSILIENCE & LANCEMENT (Round 11)**

- §31 Workflow crise membre + bus factor Eliot
- §32 Stratégie lancement feature flags + beta cohort + go/no-go par jalon

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

**Cible X aspirationnelle Round 11 (à valider Eliot) : +15 % sur 12 semaines**, soit un effet "medium-large" à l'échelle Cohen (d ≈ 0.5-0.8). Ancrage : Rupprecht et al. 2024 méta-analyse pre-performance routines en sport rapporte Hedges' g = 0.64-0.70 sous pression. Transposé au tracker comportemental trader, +15 % discipline en 12 sem = ambitieux mais défendable scientifiquement (vs +5 % = bruit, +30 % = miracle non crédible).

**Mesure** : `discipline_score_J90_cohorte_moyen / discipline_score_J0_cohorte_moyen - 1`. Calcul cron mensuel sur 12 semaines glissantes.

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

## §6. Les 7 modules — extensions de l'existant V1 (Round 12)

> **Audit V1 réel 2026-05-11** : 5/7 modules ont déjà des fondations V1 livrées (J0-J10 + V1.5 + V1.5.2 + V1.6). Le master ne dit PAS "créer 7 modules from scratch" — il dit "étendre l'existant vers une vision orchestrée". Cf. `apps/web/CLAUDE.md` pour l'inventaire factuel J0→V1.6.

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

M1-L Avatars génériques · M2-L Thèmes · M3-N Sons satisfaisants (anti-audio Eliot — `feedback_no_audio.md` absolute, alignée tag N comme B8 Voice→texte et O1 Visualization audio) · M4-L Haptic Capacitor V2 · M5-L Wallpapers Douglas · M6-L Trader name custom

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

## §17. V1.6 — Stabilisation backend (8-12h, partiellement livré 2026-05-11)

> **Update Round 12** : V1.6 audit-driven hardening DÉJÀ EFFECTUÉ (5 bugs latents catch + commit chain `f44d124 + dc42a51 + dc7a4b4 + e14bdb8 + 9584a38 + f91a4e1 + a9d2da0`). Cf. `apps/web/CLAUDE.md §V1.6`. Restent les 4 items polish non encore commités :
>
> 1. Sentry alerting taxonomy (info/warning/exception) — wirer `reportWarning(scope, message, extra)` complémentaire à `reportError` existant
> 2. Email frequency cap (`is_transactional` field sur `NotificationQueue` + check ≥3 emails fallback 24h glissantes — SPEC §18.2)
> 3. **Recalibrer scoring V1.5 ADR-002** : `STDDEV_FULL_SCALE 8→4` (`emotional-stability.ts:94`) + `EXPECTANCY_FULL_SCALE 3→1` (`consistency.ts:67`). Edits revertés Phase W par hook auto, à re-appliquer V1.6 cleanup
> 4. 10 PRs dependabot majors batch review (cf. `apps/web/CLAUDE.md §V1.6 backlog`)

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

## §18. V1.7 — REFLECT + extensions North Star (10-12h)

> **Update Round 12 — items déjà LIVE V1.5 retirés de V1.7** :
>
> - ~~Trade.tags multi-select~~ → REDONDANT avec `Trade.tradeQuality A/B/C` V1.5 (Steenbarger grading déjà câblé). Reclassifier tags vs tradeQuality : **tradeQuality = qualité setup (avant outcome)** / **tags V1.7 si conservés = patterns émotionnels post-outcome (revenge, fomo, overconfidence)**. À arbitrer M5 décision Eliot. Pas urgent.
> - ~~Trade.riskPct~~ → DÉJÀ LIVE V1.5 (Decimal 4,2 + Tharp warning >2%). À supprimer du scope V1.7.
> - ~~Disclaimer AMF~~ → audit V1.6 confirme `LegalFooter` + pages `/legal/{privacy,terms,mentions}` LIVE V1 J10 Phase A. À supprimer V1.7.
>
> **Items réellement V1.7 (clarifiés)** :

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

> **Update Round 12** : V1 a `DailyCheckin.morningRoutineCompleted Boolean` + `lib/scoring/discipline.ts:routineCompleted` weight=10. V1.8 = **étendre ce Boolean** vers `RoutineTemplate` + `RoutineCompletion` (§15) **sans casser** le scoring V1. Le scorer V1.8 lit `RoutineCompletion.completedAt IS NOT NULL` OU fallback `DailyCheckin.morningRoutineCompleted` (backward-compat ≥30j). Migration : seed 1 template "Routine matinale Fxmily" reproduisant le Boolean V1.

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

> **Update Round 12** : V1 a déjà `/admin/members/[id]` avec 4 tabs (Vue d'ensemble / Trades / Mark Douglas / Rapports IA — J3/J7/J8). V2.0 DEBRIEF = **ajouter 5e tab "Debriefs"** branché sur `CoachDebrief` model (§15 Migration 3) + Eliot brief generator. PAS création du dashboard admin from scratch. Le PROGRESS module est nouveau (Path 6 phases + Milestones).

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

## §23. Les 10 manques M1-M10 — hiérarchisés Round 11

Ces 10 décisions sont **non-déléguables à Claude**. Elles personnalisent Fxmily à TA formation et TON public.

**Hiérarchie de criticité (Round 11)** :

- ~~🔴 **BLOQUANTS V1.7+** : M4 (métaphore), M5 (rituel central), M6 (wow moment).~~ → **✅ Tous 3 tranchés 2026-05-13 + livrés V1.7.2/V1.8** (cf. table M4/M5/M6 ci-dessous). Reste BLOQUANTS : M1, M8.
- 🟠 **CRITIQUES pour mesure** : M1 (chiffres baseline), M8 (promesse 12 sem). Sans, on ne peut pas évaluer +15% North Star.
- 🟡 **IMPORTANTS pour design** : M3 (membre idéal), M9 (rituel Eliot), M10 (courbe émotionnelle).
- 🟢 **NICE-TO-HAVE narratif** : M2 (définition meilleure formation), M7 (autres outils écosystème).

~~**Si tu n'as que 5 minutes : réponds M4, M5, M6.**~~ → **M4/M5/M6 tranchés 2026-05-13 + livrés**. Si tu n'as que 5 minutes : réponds **M1 (baseline chiffres) + M8 (promesse 12 sem)** pour rendre la North Star +X% mesurable.

| #       | Question                                                                                                                  | Pourquoi bloquant                               | Statut                                                                                                                                                                                                         |
| ------- | ------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **M1**  | C'est quoi "ta formation marche bien" en chiffres (MRR, % completion, rétention, churn) ?                                 | Sans baseline, "+X % discipline" est arbitraire | ⏳ Attente Eliot                                                                                                                                                                                               |
| **M2**  | C'est quoi "la meilleure formation possible" pour toi (rentabilité membres / nb membres / NPS / durée) ?                  | Sans définition, on optimise dans le vide       | ⏳ Attente Eliot                                                                                                                                                                                               |
| **M3**  | Membre idéal Fxmily : débutant 6 mois ? Break-even 2 ans ? Edge psy 5 ans ?                                               | Change tout le design UX                        | ⏳ Attente Eliot                                                                                                                                                                                               |
| **M4**  | LA métaphore Fxmily pour le membre (WHOOP = coach fitness, Headspace = guide médit, Fxmily = ?)                           | Sans métaphore, aucun attachement               | ✅ **C — "Le miroir de ton exécution"** (tranché 2026-05-13 [`jalon-V1.8-decisions.md`](./jalon-V1.8-decisions.md), livré V1.8 via `<MirrorHero>` SVG 2026-05-14 commit `55868c3`)                             |
| **M5**  | LE rituel quotidien central (morning checkin / soir routine / pre-trade modal) ?                                          | Sans rituel, l'app reste accessoire             | ✅ **A morning check-in (LIVE V1 J5) + D evening WeeklyReview dimanche** (tranché 2026-05-13 [`jalon-V1.8-decisions.md`](./jalon-V1.8-decisions.md), livré V1.8 via `<WeeklyReviewWizard>` 5 steps 2026-05-14) |
| **M6**  | LE wow moment qui fait dire "ça vaut le coup" (rapport hebdo IA / pattern detection / score grimpe) ?                     | Sans wow moment, churn rapide                   | ✅ **A — Rapport hebdo IA dimanche** (LIVE V1.7.2 batch HTTP 2026-05-13 commit `03f7769`, tranché 2026-05-13 [`jalon-V1.8-decisions.md`](./jalon-V1.8-decisions.md))                                           |
| **M7**  | Les 3 autres outils de ta formation à côté de Fxmily (Discord ? Notion ? Skool ? Livestreams ?)                           | Pour positionner Fxmily dans l'écosystème       | ⏳ Attente Eliot                                                                                                                                                                                               |
| **M8**  | Promesse temporelle au membre à 12 semaines ("Je suis discipliné" / "Plus de revenge trade" / "J'ai compris ma psycho") ? | Sans promesse, aucune narration                 | ⏳ Attente Eliot                                                                                                                                                                                               |
| **M9**  | Ton rituel quotidien à TOI dans Fxmily ? Tu ouvres l'app, tu fais quoi en 5 min ?                                         | Pour designer l'admin DE VRAI                   | ⏳ Attente Eliot                                                                                                                                                                                               |
| **M10** | Courbe émotionnelle du membre Day 1 / Day 7 / Day 30 / Day 90 ?                                                           | Pour designer la rétention                      | ⏳ Attente Eliot                                                                                                                                                                                               |

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

# PARTIE IX — RISQUES PRODUIT & ÉTHIQUE (Round 11)

## §29. Top 5 risques produit (vs risques techniques)

Les 5 risques techniques sont en §15 (User bloat, write volume, RGPD export, DailyCheckin duplication, CoachDebrief PII). Voici les **5 risques PRODUIT** distincts :

| #      | Risque                                                                                                     | Probabilité | Impact                                 | Mitigation V1.7+                                                                                                 |
| ------ | ---------------------------------------------------------------------------------------------------------- | ----------- | -------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| **R1** | **Drift posture** : un membre demande conseil trade en privé, Eliot répond, ligne rouge AMF franchie       | Moyenne     | CRITIQUE (sanctions pénales possibles) | Disclaimer dans tout email/notif (V1.7) + audit log conversations Eliot↔membre + formation Eliot ligne rouge AMF |
| **R2** | **Adoption faible cohorte 25 actuels** : <5/25 utilisent quotidiennement après 30j                         | Élevée      | HIGH (data trop maigre pour scoring)   | D7/D30 metric (V1.6) + interviews 5 premiers users avant V1.7 + feature flags par user                           |
| **R3** | **Cannibalisation formation** : membres préfèrent Fxmily au coaching direct = formation devient accessoire | Faible      | MEDIUM (modèle business inversé)       | Module DEBRIEF V2.0 force interaction Eliot×membre + zone "réponses uniquement Eliot"                            |
| **R4** | **Burnout coaching Eliot** : à 100 membres, Eliot ne peut plus suivre quotidien                            | Élevée      | HIGH (qualité chute)                   | K1 at-risk alerts intelligentes V1.8 + auto-priorisation top 5/jour + bus factor §31                             |
| **R5** | **Churn invisible** : membres paient mais désengagent silencieusement                                      | Moyenne     | HIGH (rétention payante chute)         | NPS trimestriel (L3 V1.7) + cohort health score (K8 V1.6) + exit interview obligatoire si cancel                 |

## §30. Éthique IA — Anthropic LIVE V1.7

L'activation Anthropic LIVE en V1.7 va générer des messages personnalisés pour des humains en état émotionnel fragile (post-loss, après revenge trade, en burnout). **Responsabilité réelle.**

**Garde-fous obligatoires V1.7** :

1. **System prompt verrouillé** : posture Mark Douglas hardcoded, refuse tout output contenant `[buy/sell/long/short/entry/exit/setup]` (regex post-generation)
2. **Hallucination disclaimer** : tout message IA flagué visuellement (`✨ Généré par IA — pas un substitut au coaching humain`)
3. **Modération output** : 2-pass review avant push — (a) `fxmily-content-checker` regex AMF, (b) score sentiment (refuser si <-0.7, escalade Eliot)
4. **Crisis detection** : si membre mentionne suicidaire / dépression / argent désespéré dans free-text → IA ne répond pas, push direct Eliot + ressources externes §31
5. **Coût circuit-breaker** : si usage Anthropic >$25/mois → auto-disable + email Eliot
6. **Audit log obligatoire** : `ai.message.generated` avec hash prompt + hash output (sans contenu PII), pour audit posterior
7. **Opt-out membre** : settings → toggle "AI coach" off (membre peut refuser)

**Référence éthique** : Anthropic [Acceptable Use Policy](https://www.anthropic.com/legal/aup) + EU AI Act (catégorie "limited risk" pour AI coaching).

# PARTIE X — RÉSILIENCE & LANCEMENT (Round 11)

## §31. Workflow crise membre + bus factor Eliot

### Workflow crise psy membre (V1.7+)

Aucun process défini Rounds 1-10. Ajout obligatoire V1.7 :

1. **Détection automatique** : free-text contenant mots-clés crisis (`suicide`, `dépression`, `tout perdu`, etc.) → ne pas afficher IA response, déclencher workflow
2. **Push direct Eliot** : notification haute priorité + nom pseudonyme membre + extrait safe (sans détail PII)
3. **Ressources externes intégrées** (R3 V1.6) :
   - SOS Amitié 09 72 39 40 50 (24/7)
   - Suicide Écoute 01 45 39 40 00
   - 3114 (numéro national prévention)
   - Service de Santé au Travail (si applicable membre pro)
4. **Modal in-app** : "Si tu traverses un moment difficile, voici des ressources. Eliot a été notifié."
5. **Pas de tracking automatique post-crisis** : pause score discipline pendant 7j, l'app ne push plus rien
6. **Coach note auto-créée** : CoachDebrief.notes pre-rempli pour Eliot avec contexte safeFreeText

### Bus factor Eliot

Si Eliot tombe malade 3 mois, Fxmily survit comment ? Pilier P4 dit "L'IA enrichit, ne remplace pas Eliot". Sans Eliot, le coaching humain disparaît.

**Plan résilience V2.x** :

1. **Documentation transferable** : ce master + SPEC.md + apps/web/CLAUDE.md = onboarding tech complet pour dev externe
2. **Coach délégué** : V2.x permettre 1 coach secondaire (User.role = 'coach'), partage cohorte
3. **Mode dégradé "auto-pilot"** : si Eliot inactif >14j, mode notif "Eliot est en pause, mais ta data continue d'être trackée pour son retour"
4. **Export complet cohorte** : `/admin/export/cohort` zip JSON anonymisé, transférable à un coach successeur
5. **Sauvegardes** : déjà en place V1 (pg_dump GPG quotidien 02:30 UTC)

## §32. Stratégie de lancement V1.6 → V2.0

Aucune stratégie ramp documentée Rounds 1-10. Comment ramper 5 jalons sur cohorte 25 → 100 membres ?

### Pattern recommandé : feature flags + beta cohort

1. **Feature flag par module** : `featureFlags.routinesV1_8 = boolean` dans `User` settings. Activable progressivement.
2. **Beta cohort** : 3-5 membres volontaires testent V1.7+ pendant 2 semaines AVANT rollout général. Critères sélection : déjà ≥4 check-ins/sem, NPS ≥8, vocal sur le Discord.
3. **Rollout en 4 vagues** par jalon :
   - Semaine 1 : beta 3-5 membres
   - Semaine 2 : +10 membres (early adopters)
   - Semaine 3 : +cohorte complete
   - Semaine 4 : monitoring intensif + interview 5 membres + go/no-go V suivant
4. **Rollback plan** : feature flag off (instant) + script Prisma `DELETE FROM feature_rows WHERE created_at > $rolloutDate` documenté
5. **Communication membre** : email broadcast V1.7+ "Nouvelles features Fxmily : voici comment ça t'aide" — 200 mots max, pas de jargon tech
6. **Mesure go/no-go** : avant chaque jalon suivant, audit cohort health score (K8) — si <70 % en green, on attend +2 sem avant ship suivant

### Critères go/no-go par jalon

| Jalon       | Critère pour passer au suivant                                                                            |
| ----------- | --------------------------------------------------------------------------------------------------------- |
| V1.6 → V1.7 | Cron Watch 7j green continu, Sentry <50 events/j, 0 régression Vitest                                     |
| V1.7 → V1.8 | ≥3 membres utilisent WeeklyReview pendant 4 sem, Trade.tags taux remplissage >60 %                        |
| V1.8 → V1.9 | ≥3 membres ont 1 routine custom + 14 jours adherence ≥70 %                                                |
| V1.9 → V2.0 | ≥5 membres ont fait test psychométrique + ≥1 QCM/sem pendant 2 sem, 0 alerte AMF `fxmily-content-checker` |
| V2.0 → V2.x | 3 debriefs Eliot conduits avec brief IA, ≥2 milestones complétées sur 5 membres                           |

**Pas de jalon suivant tant que critère go non rempli.** Évite drift architectural.

---

## §33. Open questions — arbitrage Eliot (extracted V1.11 phase 5)

> Extraction depuis [`archive/SPEC-V2-VISION.md`](archive/SPEC-V2-VISION.md) §11 (lignes 343-371 du document archivé). **15 questions** à arbitrer formellement par Eliot avant ship V1.9/V2.0 frontend. Sub-agent L Round 3 finding : ces questions n'étaient PAS dans le master, elles étaient prisonnières du SPEC-V2-VISION archivé. Promues en §33 pour arbitrage actif.

### ROUTINE module (V1.9 — pre-trade routine + weekly review)

1. **Pre-trade routine bloquante OU non-bloquante** ? Modal qui force completion avant ouverture trade OU suggestion soft (push notification + free entry) ?
2. **Weekly review auto-généré OU auto-rédigé** ? Résumé data IA (synthèse trade + check-ins + scores) OU le membre écrit lui-même (current V1.8 REFLECT path) ?
3. **Notifications routines** : push, email, ou les deux ?

### LEARN module (V2.0 — psychométrie + QCM)

4. **QCMs obligatoires OU optionnels** ? Path bloquant (membre doit valider quiz pour débloquer features) OU gamification soft (badge + progression visible) ?
5. **Tests psychométriques fréquence** : répétés (mensuel ? trimestriel ?) OU one-shot onboarding ?
6. **Résultats psychométriques visibles au membre OU uniquement coach (Eliot)** ?

### PROGRESS module (V2.0 — path 6 phases Découverte→Maîtrise)

7. **Path linéaire ordre strict OU parallèle** ? Force-t-il une séquence Découverte→...→Maîtrise OU permet plusieurs phases simultanées ?
8. **Milestones débloquées par data réelle, par temps écoulé, ou les deux** ? (ex: "30j check-ins consécutifs" data vs "30j compte créé" temps vs combo)
9. **Membre voit milestones futures (motivation) OU seulement actuelles (focus)** ?

### DEBRIEF module (V2.0 — coach sessions admin)

10. **Coach notes visibles au membre OU privées admin** ?
11. **Debrief sessions planifiées via Fxmily (calendar intégré) OU externe (Calendly link)** ?
12. **Action items générés en session trackés comme tasks pour le membre** ? (ouvre un module task list dans Fxmily) OU restent dans la note coach uniquement ?

### Posture publique (transverse V1+)

13. **Disclaimer AMF visible permanent (footer toutes pages) OU uniquement onboarding** ?
14. **Page `/about` anti-scam vs marketing trading** : faut-il l'ajouter pour clarifier la posture publiquement ?
15. **Ratio formation pricing / valeur Fxmily perçue** — pour future décision standalone pricing si Fxmily devient produit séparé de la formation.

### Process arbitrage

- Chaque question = 1 ligne décision dans `docs/decisions/` (ADR pattern, ADR-001 + ADR-002 déjà établis pour scoring constants).
- Default behavior si non arbitré : posture conservative (bloquante OU privée OU one-shot OU permanent). Eliot peut déverrouiller via décision explicite documentée.

---

# CHANGELOG

- **2026-05-11 v1.0** — Création initiale via interview Eliot 9 rounds + 5 subagents (planner, researcher × 3, code-architect × 2). Remplace [SPEC-V2-VISION.md](archive/SPEC-V2-VISION.md) + [MANIFESTO-V2.md](archive/MANIFESTO-V2.md) (archivés 2026-05-15 V1.11 phase 5). Source unique de vérité produit V2.
- **2026-05-15 v1.1** — V1.11 phase 5 archive : MANIFESTO + SPEC-VISION déplacés vers `docs/archive/` avec stub deprecation. Extraction des 15 open questions §11 SPEC-V2-VISION vers nouveau §33 master (arbitrage actif Eliot). M3-M Sons rétrogradé N anti-audio Eliot (§10.M ligne 288). Sub-agent L Round 3 + sub-agent S Round 4 findings.
- **2026-05-11 v1.1** — Round 11 audit critique self-imposed : (a) §3 X=15% défendu Rupprecht 2024, (b) §17 V1.6 effort corrigé 4-6h → 8-12h réaliste, (c) §23 M1-M10 hiérarchisés (M4/M5/M6 bloquants), (d) ajout PARTIE IX risques produit + éthique IA Anthropic LIVE, (e) ajout PARTIE X résilience bus factor + stratégie lancement feature flags + beta cohort + go/no-go par jalon.
