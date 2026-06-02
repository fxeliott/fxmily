# SPEC — Fxmily App

**Date initiale** : 2026-05-05 · **Dernière révision** : 2026-05-27 (v1.6 amendement, §29 Changelog v1.5 → v1.6 — pipeline auto-pilote DD→II 6/10 SHIPPED)
**Auteur** : Eliot Pena (interview structuré avec Claude Code, skill `/spec`)
**Version** : **1.6** — voir §20 (v1.0→v1.1), §22 (v1.1→v1.2), §24 (v1.2→v1.3), §26 (v1.3→v1.4), §28 (v1.4→v1.5), §29 (v1.5→v1.6) pour les pivots stack et sous-jalons inventés en cours.
**Statut** : Reflète la réalité 2026-05-29 (V2.4 onboarding interview Phases A-C + §8 batch local Opus 4.8 LIVE prod Hetzner sur `app.fxmilyapp.com` ; **différenciateur Fxmily** pre-trade × outcome correlation per-reason déployé V2.3 ; **1618/1618 tests Vitest verts** ; pipeline débrief auto-pilote DD→MM 6/10 SHIPPED — 4 restantes JJ/KK/LL/MM).

---

## 1. Vision en 1 phrase

Une web app installable comme vraie app sur téléphone (PWA d'abord, Capacitor + App Store en V2), au design bleu/noir soigné, dédiée au **suivi comportemental ultra-poussé** des membres de la formation de trading **Fxmily**, avec un workflow d'annotation admin sur leurs trades (commentaire texte + vidéo Zoom uploadée) et un module de coaching psychologique inspiré de Mark Douglas en contenu statique + déclenché par règles contextuelles.

---

## 2. Contexte business

Eliot dirige la formation de trading **Fxmily**. Il veut un outil propriétaire pour suivre individuellement chaque membre **au-delà du contenu pédagogique** : capter un maximum de données sur le trader (psychologie, routine, journal, track record, comportement face aux corrections) afin de personnaliser l'aide.

**Posture explicite et non négociable** :
- ❌ **Pas de conseil sur les analyses de trade** (setups, tendances, prévisions de marché)
- ✅ **Conseils autorisés sur l'exécution** : sessions respectées, hedge respecté, plan respecté, discipline
- ✅ **Conseils autorisés sur la psychologie** : framework Mark Douglas (citations courtes + paraphrases avec attribution)

**Public cible** : 30 membres au lancement → 100 à moyen terme → potentiellement plusieurs milliers à long terme. L'archi doit supporter la croissance.

---

## 3. Principe directeur : "approche athlète professionnel"

L'app traite chaque membre comme un athlète de haut niveau :
- **Tracking exhaustif** : performance trading + paramètres physiques + état mental + discipline
- **Adaptation automatique** : le système identifie les patterns et adapte les recommandations / déclencheurs Mark Douglas pour chaque membre individuellement
- **Données comme matière première** : chaque interaction in-app et chaque check-in génère de la donnée exploitable pour le coaching admin

Ce principe guide toutes les décisions de design : si une feature ne contribue pas à mieux connaître le membre ou à mieux l'aider, elle est hors scope.

---

## 4. Stack technique

| Couche | Choix | Rationale |
|---|---|---|
| **Frontend / Backend** | Next.js 16 (App Router) + React 19 + TypeScript strict | Un seul codebase web + mobile (via PWA puis Capacitor), énorme écosystème, support IA optimal. Note J0 : la majeure 16 (sortie 21 oct 2025) renomme `middleware.ts` → `proxy.ts`, Turbopack devient stable par défaut. Version installée : 16.2.4. |
| **CSS** | Tailwind CSS 4 | Standard 2026, parfait pour thème custom bleu/noir |
| **Composants UI** | shadcn/ui | Open-source, ownership total du code, customisable, accessible |
| **Animations** | Framer Motion | Standard React, courbes premium, faciles à orchestrer |
| **Charts** | Tremor (basé Recharts) | Très joli par défaut, optimisé dashboards trader, gratuit |
| **Auth** | Auth.js v5 (NextAuth) avec strategie email magic link + sessions DB | Self-hosted, gratuit, parfait pour invitation par email unique |
| **ORM** | Prisma | Schema-first, migrations gérées, type-safe avec TS |
| **Base de données** | PostgreSQL 17 self-hosted Hetzner | Robuste, scale facilement, gratuit |
| **Stockage médias** | Cloudflare R2 (S3-compatible) | 10 Go gratuits, 0€ frais de sortie, standard industrie |
| **Email transactionnel** | Resend | 3000 emails/mois gratuits, API simple |
| **Validation runtime** | Zod | Standard TS pour valider input API + formulaires |
| **Formulaires** | React Hook Form + Zod | Combo standard React, performant, accessible |
| **Notifications push** | Web Push API + VAPID + service worker | Standard W3C, fonctionne iOS 16.4+ et Android, gratuit |
| **PWA** | next-pwa (ou @ducanh2912/next-pwa) | Génère manifest + service worker, "Ajouter à l'écran d'accueil" |
| **IA backend (rapports hebdo)** | API Claude (Sonnet 4.6 par défaut, escalade Opus 4.7 si besoin) via SDK officiel | Coût maîtrisé, excellent pour analyse de patterns |
| **Tests unitaires & intégration** | Vitest + React Testing Library | Standard 2026, ultra rapide |
| **Tests E2E** | Playwright | Référence pour parcours utilisateur multi-écrans |
| **Monitoring erreurs** | Sentry plan gratuit | 5000 erreurs/mois gratuits, alerting email |
| **Hébergement runtime** | Serveur Hetzner Cloud (Falkenstein UE) | Existant, abordable, hébergement européen pour RGPD |
| **Déploiement** | Docker Compose (Next.js + Postgres + Caddy reverse proxy avec SSL Let's Encrypt auto) | Reproductible, simple à mettre à jour |
| **CI/CD** | GitHub Actions (gratuit pour repos privés perso) | Tests + lint + build sur chaque push |
| **Runtime Node** | Node.js 22 LTS | Stable jusqu'à 2027 |
| **Package manager** | pnpm | Plus rapide, moins d'espace disque |

---

## 5. Architecture haute niveau

```
┌──────────────────────────────────────────────────────┐
│  Membre (smartphone) — PWA installée                 │
│  Admin Eliot (smartphone + ordinateur)               │
└──────────────────┬───────────────────────────────────┘
                   │ HTTPS
                   ▼
┌──────────────────────────────────────────────────────┐
│  Caddy (reverse proxy + SSL auto)                    │
│  app.fxmily.com → Next.js                            │
└──────────────────┬───────────────────────────────────┘
                   │
                   ▼
┌──────────────────────────────────────────────────────┐
│  Next.js 15 (Hetzner)                                │
│  - Pages SSR + Server Components                     │
│  - API Routes                                        │
│  - Service Worker (PWA + Web Push)                   │
└────┬──────────┬───────────────┬───────────┬──────────┘
     │          │               │           │
     ▼          ▼               ▼           ▼
┌─────────┐ ┌────────┐  ┌──────────────┐ ┌──────────┐
│ Postgres│ │ R2     │  │ Resend       │ │ Claude   │
│ (Hetzner│ │ (CDN)  │  │ (emails)     │ │ API      │
│  local) │ │        │  │              │ │ (hebdo)  │
└─────────┘ └────────┘  └──────────────┘ └──────────┘
```

**Cron jobs sur Hetzner** :
- `pg_dump` quotidien 03:00 UTC → upload R2 (rétention 30 jours)
- Rapport hebdo IA chaque dimanche 21:00 UTC → email à fxeliott
- Push notifications check-in matin (07:30 fuseau membre) + soir (20:30)

---

## 6. Modèle de données (entités principales)

> Schémas indicatifs, à raffiner via Prisma migrations pendant l'implémentation.

### 6.1. `User`
- `id` (uuid)
- `email` (unique)
- `firstName`, `lastName`
- `avatarUrl` (R2 key)
- `role` : `'member'` | `'admin'`
- `status` : `'invited'` | `'active'` | `'suspended'` | `'deleted'`
- `invitedAt`, `joinedAt`, `lastSeenAt`
- `timezone` (default Europe/Paris)
- `pushSubscription` (JSON, Web Push subscription)
- `consentRgpdAt` (date acceptation politique)

### 6.2. `Trade`

> **Note J2 (2026-05-05)** — Le modèle livré ajoute `stopLossPrice`,
> `realizedRSource`, `enteredAt`/`exitedAt`/`closedAt` et remplace `screenshots[]`
> par deux colonnes nullable (`screenshotEntryKey`, `screenshotExitKey`)
> pour aligner avec les 2 phases du wizard (avant entrée / après sortie).
> Cf. `docs/archive/jalon-2-prep.md` → "Décisions produit prises pendant la session J2"
> et `apps/web/prisma/schema.prisma` (modèle `Trade`).

- `id`, `userId`
- `pair` (ex: "EURUSD", "XAUUSD") — validation contre allowlist 12 paires
- `direction` : `'long'` | `'short'`
- `session` : `'asia'` | `'london'` | `'newyork'` | `'overlap'`
- `enteredAt` (UTC), `exitedAt` (UTC, null tant que ouvert)
- `entryPrice`, `exitPrice`, `lotSize`
- `stopLossPrice` (optionnel, recommandé) — sans lui, `realizedR` est estimé
- `plannedRR` (decimal), `realizedR` (decimal)
- `realizedRSource` : `'computed'` | `'estimated'` — provenance du R réalisé
- `outcome` : `'win'` | `'loss'` | `'break_even'` (null tant que ouvert)
- `screenshotEntryKey`, `screenshotExitKey` (R2 keys nullable)
- `emotionBefore`, `emotionAfter` (tag slugs, max 3 par moment, min 1 obligatoire — voir `lib/trading/emotions.ts`)
- `planRespected` (bool), `hedgeRespected` (bool | null = N/A)
- `notes` (texte libre, append-only au close via `lib/trades/notes.ts`)
- `closedAt` (null tant que ouvert), `createdAt`, `updatedAt`

### 6.3. `TradeAnnotation` (correction admin)
- `id`, `tradeId`, `adminId`
- `comment` (texte)
- `mediaUrl` (R2 key, optional — vidéo Zoom uploadée)
- `mediaType` : `'image'` | `'video'`
- `seenByMemberAt` (date | null)
- `createdAt`

### 6.4. `DailyCheckin`
- `id`, `userId`, `date` (date du check-in)
- `slot` : `'morning'` | `'evening'`
- **Physique** : `sleepHours`, `sleepQuality (1-10)`, `sportType`, `sportDurationMin`, `caffeineMl`, `waterLiters`
- **Mental** : `moodScore (1-10)`, `emotionTags` (array), `meditationMin`
- **Discipline** : `morningRoutineCompleted` (bool), `planRespectedToday` (bool), `hedgeRespectedToday` (bool)
- **Réflexion (optionnel)** : `journalNote` (texte libre), `gratitudeItems` (array)
- `submittedAt`

### 6.5. `MarkDouglasCard` (fiche statique)
- `id`, `slug`, `title`, `body` (markdown), `category` (`tilt`, `discipline`, `acceptance`, `probabilities`, ...)
- `triggerRules` (JSON, ex: `{"after_n_losses": 3}`)
- `attribution` (ex: "Inspiré de *Trading in the Zone*, Mark Douglas")

### 6.6. `MarkDouglasDelivery` (livraison contextuelle)
- `id`, `userId`, `cardId`
- `triggeredBy` (texte décrivant la règle)
- `seenAt` (date | null)
- `createdAt`

### 6.7. `WeeklyReport` (rapport IA hebdo)
- `id`, `userId`, `weekStart` (date)
- `summary` (texte), `risks` (array), `recommendations` (array)
- `claudeModel` (ex: "claude-sonnet-4-6"), `tokensUsed`, `costEur`
- `createdAt`, `sentToAdminAt`

### 6.8. `AuditLog` (traçage RGPD + comportement)
- `id`, `userId`, `action` (`login`, `view_correction`, `submit_trade`, `delete_account`, ...)
- `metadata` (JSON), `ipHash` (haché, jamais en clair pour RGPD)
- `createdAt`

### 6.9. `Invitation`
- `id`, `email`, `tokenHash`, `expiresAt`, `usedAt`
- `invitedByAdminId`

### 6.10. `BehavioralScore` (calculé en cache, recalculé sur events)
- `userId`, `date`
- `disciplineScore (0-100)`, `emotionalStabilityScore (0-100)`, `consistencyScore (0-100)`, `engagementScore (0-100)`
- Calculs déterministes documentés en code, pas d'IA

---

## 7. Features détaillées par module

### 7.1. Authentification & invitation

**Flow d'invitation** :
1. Eliot (admin) saisit l'email d'un nouveau membre dans `/admin/invite`
2. Le système crée une `Invitation` avec token unique + expiration 7 jours, envoie email via Resend
3. Le membre clique le lien → arrive sur `/onboarding/welcome`
4. Il remplit prénom, nom, photo de profil (upload R2), accepte CGU/politique conf, choisit mot de passe
5. Compte créé en `status='active'`, redirigé vers son dashboard

**Login** :
- Email + password (Auth.js v5)
- Magic link en backup ("J'ai oublié mon mot de passe")
- Sessions stockées en DB (table `Session`), cookies httpOnly, SameSite=Lax

**Suspension / suppression** : Eliot peut suspendre (status='suspended', login bloqué) ou supprimer (status='deleted', soft delete + purge médias R2 sous 30 jours pour RGPD).

### 7.2. Profil membre

- Photo de profil (R2)
- Prénom, nom, fuseau horaire
- Préférences notifications push (par catégorie)
- Bouton "Demander la suppression de mon compte" → flow RGPD
- Export de mes données (JSON download) → flow RGPD

### 7.3. Journal de trading (formulaire ultra-guidé)

Champs obligatoires pour chaque trade :
- **Date / heure** (auto-rempli + ajustable)
- **Paire** (autocomplete depuis liste des paires courantes)
- **Sens** : long / short
- **Session** : Asie / Londres / NY / Overlap (radio buttons, on guide)
- **Taille** (lot)
- **R:R prévu** (champ numérique avec slider 0.5-10)
- **Plan respecté** : oui / non (radio)
- **Hedge respecté** : oui / non / N/A (radio)
- **Émotion avant entrée** : tags (peur, confiance, doute, FOMO, ennui, calme, autres)
- **Screen avant entrée** (upload obligatoire)

Champs à remplir au sortie de trade :
- **Prix sortie**
- **Outcome** : win / loss / BE
- **R réalisé** (auto-calculé si possible)
- **Émotion après sortie** : tags
- **Screen sortie** (upload obligatoire)
- **Notes** (texte libre, optionnel)

**UX guidée** :
- Wizard étape par étape sur mobile (1 question = 1 écran sur petit screen, regroupé sur grand)
- Progress bar visible
- Validations Zod avant chaque submit
- Sauvegarde automatique du brouillon (localStorage + sync DB)
- Animation Framer Motion entre étapes (slide horizontal)

### 7.4. Tracking quotidien (matin + soir)

**Check-in matin** (push à 07:30 fuseau membre, configurable) :
- Heures de sommeil + qualité (1-10)
- Routine matinale check-list (items que le membre a configurés lui-même)
- Mood score (1-10)
- Méditation faite ? Combien de min ?
- Sport ? Type + durée
- Intention du jour (texte court, optionnel)

**Check-in soir** (push à 20:30, configurable) :
- Plan de trading respecté aujourd'hui ?
- Hedge respecté ?
- Émotions principales ressenties (tags multiples)
- Caféine totale (estimation), eau bue
- Stress moyen de la journée (1-10)
- Journal libre (optionnel)
- 3 gratitudes (optionnel)

**UX** :
- Formulaire mobile-first, 1 question = 1 écran avec swipe
- Skip possible mais le système log "skipped" pour le scoring discipline
- Streaks visibles ("12 jours de check-in consécutifs 🔥") pour motivation

### 7.5. Track record & analytics membre (dashboard perso)

Dashboards visibles pour le membre :
- **Track record** : courbe de R cumulé sur 7j / 30j / 3 mois / 6 mois / all
- **Win rate, R moyen, max consecutive losses, max drawdown**
- **Performance par session** (Asie vs Londres vs NY)
- **Performance par paire** (top 5 paires les plus tradées)
- **Plan respect rate, hedge respect rate**
- **Pattern émotion → outcome** (ex: "Quand tu trades en mode FOMO, ton win rate est 23% vs 67% en mode calme")
- **Corrélations** : sommeil x perf, stress x R, méditation x discipline (graphiques croisés)
- **Scoring** : discipline, stabilité émotionnelle, consistance, engagement (jauge 0-100 chacune)

Tout en graphiques Tremor, animations Framer Motion sur les transitions.

### 7.6. Module Mark Douglas (contenu statique + déclencheurs)

**Bibliothèque de fiches** : ~50-100 fiches générées par Claude Code pendant l'implémentation, validées par Eliot. Catégories :
- Acceptation de l'incertitude (probabilities thinking)
- Tilt management
- Discipline en mode fatigué
- Le piège de l'ego
- Détacher l'identité du résultat
- Edge / consistency / probability
- Confiance vs sur-confiance
- Patience et timing
- ...

**Format de chaque fiche** :
- Titre
- Citation courte (≤ 30 mots, fair use) avec attribution `*Trading in the Zone*, Mark Douglas`
- Paraphrase du concept en 200-400 mots, en français, à la voix d'Eliot
- 1-3 exercices pratiques actionnables
- Bouton "Marquer comme lu"

**Déclencheurs contextuels** (règles déterministes en code, pas d'IA) :

| Trigger | Fiche pushée |
|---|---|
| 3 trades perdants consécutifs | "Sortir du tilt" |
| Plan non respecté ≥ 2 fois en 7 jours | "Le piège de la déviation" |
| Sommeil < 6h ET trade ce jour | "Trader fatigué = trader émotionnel" |
| Émotion "FOMO" loggée | "L'art de ne rien faire" |
| Win streak ≥ 5 | "Sur-confiance" |
| 7 jours sans check-in | "Discipline = consistance" |
| Hedge non respecté | "Pourquoi le plan existe" |

Toutes les règles sont documentées en JSON, modifiables en admin sans redéploiement.

**Accès libre** : le membre peut aussi parcourir toute la bibliothèque, marquer ses favoris, créer une "playlist" de fiches.

### 7.7. Espace admin (vue tous les membres)

URL : `/admin/*`, protégé par middleware (role check `admin`).

**Pages admin** :
- `/admin/members` : liste de tous les membres avec colonnes (nom, dernier login, # trades 30j, # check-ins 7j, score discipline, alertes), filtres et tri
- `/admin/members/[id]` : profil complet d'un membre
  - Onglet "Vue d'ensemble" : ses scores, son track record, ses dernières activités
  - Onglet "Trades" : ses trades chronologiques avec screens, possibilité d'annoter
  - Onglet "Check-ins" : ses check-ins matin/soir
  - Onglet "Mark Douglas" : fiches reçues, fiches lues, fiches ignorées
  - Onglet "Notes admin" : tes notes privées sur ce membre (pas vu par lui)
- `/admin/invite` : envoi d'invitations
- `/admin/reports` : rapports hebdo IA livrés
- `/admin/cards` : gestion bibliothèque Mark Douglas
- `/admin/settings` : configuration globale (déclencheurs, seuils, etc.)

### 7.8. Workflow d'annotation (correction trade)

1. Eliot ouvre `/admin/members/[id]/trades` → liste des trades du membre
2. Il clique sur un trade → vue détaillée du trade + ses screens
3. Bouton "Annoter ce trade" :
   - Champ commentaire texte (markdown supporté)
   - Bouton "Uploader vidéo de correction" → uploadee directement vers R2 (présigned URL, max 500 Mo, format mp4)
   - Bouton "Uploader image annotée" (alternative à la vidéo)
4. Submit → `TradeAnnotation` créée → notification push envoyée au membre + email
5. Le membre voit un badge dans son dashboard "🆕 1 correction reçue"
6. Quand il ouvre la correction, on enregistre `seenByMemberAt`
7. Si pas vue après 48h → push reminder + impacte le scoring engagement

### 7.9. Notifications push

**Stratégie "équilibrée"** validée :
- Rappel check-in matin (07:30 fuseau)
- Rappel check-in soir (20:30 fuseau)
- Notification immédiate si nouvelle correction admin reçue
- 1 push contextuel Mark Douglas par jour max (déclenché par règles)
- Reminder si correction non vue après 48h

**Implémentation** :
- Web Push API + VAPID keys (stockées en env vars sécurisées)
- Service Worker enregistré au premier load PWA
- `pushSubscription` stockée par user en DB
- Worker côté serveur (Node) qui consomme une queue (table `NotificationQueue` ou Bull/BullMQ avec Redis si besoin V2) et envoie via lib `web-push`

### 7.10. Rapport hebdo IA admin

**Cron** : chaque dimanche 21:00 UTC, pour chaque membre `status='active'` :

1. Le serveur agrège la donnée des 7 derniers jours pour le membre :
   - Tous les trades (outcome, R, émotion, plan respect)
   - Tous les check-ins (sommeil, stress, mood, méditation, discipline)
   - Toutes les corrections reçues (vues / non vues)
   - Toutes les fiches MD reçues (lues / non lues)
   - Évolution des scores comportementaux
2. Construit un prompt structuré envoyé à Claude API (Sonnet 4.6 par défaut, prompt caching activé sur instructions système)
3. Claude répond un JSON structuré : `summary`, `risks`, `recommendations`
4. Sauvegardé en `WeeklyReport`
5. Email digest envoyé à fxeliott@... avec lien vers `/admin/reports`

**Coût estimé** : ~30 membres × ~3-5k tokens input + ~1-2k tokens output × Sonnet 4.6 = ~5-10€/mois.

**Garde-fou** : si l'API Claude est down, on log et on retry à h+6, h+12, h+24 max. Aucun blocage du reste de l'app.

### 7.11. Scoring comportemental (déterministe)

Calculé chaque nuit (cron 02:00 UTC) ou en temps réel sur events critiques.

**Discipline score (0-100)** :
- 40 pts : taux de check-in matin + soir sur 30j
- 30 pts : plan respect rate
- 20 pts : hedge respect rate
- 10 pts : routine matinale complétée

**Emotional stability score (0-100)** :
- Variance du mood score sur 30j (moins de variance = plus stable)
- Présence d'émotions négatives (peur, FOMO, panique) en pondération
- Cohérence émotion ↔ comportement

**Consistency score (0-100)** :
- Régularité du nombre de trades par semaine (trop ou trop peu = pénalisé)
- Régularité des sessions tradées
- Cohérence des tailles de position

**Engagement score (0-100)** :
- % corrections vues / reçues
- % fiches MD lues / poussées
- Streak de check-ins

Formules exactes documentées en code dans `lib/scoring/*.ts`, testées unitairement.

---

## 8. UX / Design system

### 8.1. Thème couleurs (à finaliser avec logo Fxmily)

Proposition de palette par défaut, à raffiner avec Claude Design une fois logo fourni :

```
--background: #0A0E1A          (noir bleuté profond)
--foreground: #E8ECF4          (blanc cassé)
--primary: #2563EB             (bleu vif)
--primary-foreground: #FFFFFF
--secondary: #1E293B           (gris bleu)
--accent: #3B82F6              (bleu plus clair)
--muted: #64748B
--success: #10B981
--warning: #F59E0B
--danger: #EF4444
--border: rgba(99, 102, 241, 0.15)
```

Mode sombre uniquement (pas de light mode V1, c'est aligné avec ton brief).

### 8.2. Typographie

- Headings : Inter Display (variable font, free Google Fonts)
- Body : Inter (variable)
- Mono : JetBrains Mono (pour les chiffres trading)

### 8.3. Animations & micro-interactions

- Transitions de page : fade + slight slide-up (Framer Motion AnimatePresence)
- Boutons : scale 0.97 au tap + glow subtil au hover
- Charts : animation d'apparition au scroll (intersection observer)
- Toast notifications : slide-in depuis le bas
- Skeletons pendant les chargements (jamais de spinner cassé)
- Confetti animation sur milestones (100ème trade, 30 jours streak, etc.)

### 8.4. Composants prioritaires

- `<TradeCard />` (vue compacte d'un trade)
- `<CheckinForm />` (wizard mobile)
- `<ScoreGauge />` (jauge animée 0-100)
- `<EmotionPicker />` (grille de tags émotions)
- `<MediaUploader />` (drag & drop + upload R2)
- `<MarkDouglasCard />` (fiche pédagogique)
- `<AdminMemberRow />` (ligne membre avec badges)
- `<TrackRecordChart />` (Tremor wrapper)

### 8.5. Responsive

Mobile-first strict. Breakpoints :
- `sm` : 640px (tablette portrait)
- `md` : 768px (tablette landscape)
- `lg` : 1024px (laptop)
- `xl` : 1280px (desktop)

Tous les écrans testés en priorité absolue à 375x667 (iPhone SE) et 393x852 (iPhone 15).

---

## 9. Sécurité & RGPD

### 9.1. RGPD (France, CNIL)

À produire pendant l'implémentation :
- **Politique de confidentialité** (`/legal/privacy`) : finalités, durées de conservation, droits
- **CGU** (`/legal/terms`) : conditions d'utilisation
- **Mentions légales** (`/legal/mentions`)
- **Bandeau de cookies** (cookies strictement nécessaires uniquement en V1, donc pas de bandeau bloquant CNIL-style obligatoire mais info-banner OK)
- **Registre des traitements** (interne, doc Markdown)
- **Consentement explicite** à l'inscription (checkbox non pré-cochée)

Droits implémentés :
- **Droit d'accès** : export JSON de toutes les données du membre depuis son profil
- **Droit à l'effacement** : `DELETE /api/account` → soft delete immédiat + purge complète DB + R2 sous 30 jours (cron)
- **Droit de rectification** : édition profil et données

**Données sensibles spécifiques** :
- Trades (financières) → chiffrement at-rest Postgres (TDE ou pgcrypto sur colonnes critiques)
- Émotions / journal psy → considérées comme données personnelles standard, pas santé sensible (à valider si besoin avec un avocat un jour, en V1 on traite comme perso classique)
- Médias R2 → privés par défaut, accessibles seulement via presigned URLs courte durée

### 9.2. Sécurité technique

- **HTTPS partout** (Caddy + Let's Encrypt auto-renew)
- **Headers de sécurité** : CSP strict, X-Frame-Options, X-Content-Type-Options, Referrer-Policy
- **Rate limiting** : sur `/api/auth/*`, `/api/trades`, etc. (lib comme `@upstash/ratelimit` + Redis local)
- **CSRF** : token automatique avec Auth.js v5
- **Validation input** : Zod sur 100% des routes API
- **Secrets** : variables d'environnement, jamais en clair dans le code, jamais commit
- **Mots de passe** : hash argon2id (Auth.js)
- **Sessions** : DB-backed, cookies httpOnly + SameSite=Lax + Secure
- **Audit log** : toutes les actions admin loggées dans `AuditLog`
- **Pas d'IP en clair** : hash SHA-256 avec salt avant stockage

### 9.3. Backups

- `pg_dump` quotidien 03:00 UTC → upload R2 (bucket dédié `fxmily-backups`)
- Rétention 30 jours rolling
- Restore testé tous les 6 mois (procédure documentée dans `docs/runbook-backup-restore.md`)
- Médias R2 : pas de backup tiers (R2 a 99.999999999% de durabilité, suffisant V1)

---

## 10. Performance & scalabilité

V1 dimensionné pour 100 utilisateurs simultanés max (large marge sur 30 réels).

- Postgres : un seul serveur Hetzner CX22 (4€/mois) suffit jusqu'à ~500 users actifs
- Indexes obligatoires : `Trade(userId, createdAt)`, `DailyCheckin(userId, date)`, `TradeAnnotation(tradeId)`, `User(email)`, `Invitation(tokenHash)`
- N+1 prevention : Prisma `include` explicites, pas de boucles avec queries
- Caching : React Server Components naturellement cachés, ISR sur pages publiques (legal)
- Images : Next.js `<Image>` avec optimisation auto, R2 derrière Cloudflare CDN gratuit
- Vidéos : streaming HTML5 natif, pas de transcoding V1 (le membre voit la vidéo Zoom telle qu'uploadée)

**Budget perf** :
- TTFB < 300ms sur dashboard
- LCP < 2.5s sur 4G simulée
- INP < 200ms

Mesuré régulièrement avec Lighthouse en CI.

---

## 11. Tests (TDD partout, choix Eliot)

**Vitest + React Testing Library** pour tests unitaires et intégration. **Playwright** pour E2E.

### 11.1. Couverture cible

| Type | Couverture |
|---|---|
| Logique métier (lib/scoring, lib/triggers, lib/calculations) | 95%+ |
| API routes | 85%+ |
| Hooks personnalisés | 80%+ |
| Composants avec logique | 70%+ |
| Composants pure presentation | 0% (pas de TDD ici, c'est inutile) |
| E2E parcours critiques | 100% (auth, journal CRUD, annotation, check-in) |

### 11.2. TDD pragmatique

Pour chaque feature :
1. Écrire le test qui échoue
2. Écrire le code minimal qui passe
3. Refactoriser

**Exception explicite pour le pure UI** (boutons, layouts, animations) : on n'écrit pas de tests, on revue visuellement avec Claude Design + preview manuel.

### 11.3. Test infrastructure

- Base de données de test : Postgres in container Docker (testcontainers ou compose dédié)
- Pas de mocks DB (on a appris la leçon, on teste contre un vrai Postgres)
- Mock R2 : MinIO local en dev/test (S3-compatible)
- Mock Resend : email-checker en mémoire
- Mock Claude API : enregistrement des prompts pour validation visuelle, mock responses

---

## 12. Monitoring & ops

### 12.1. Sentry

- Plan gratuit (5000 erreurs/mois)
- Source maps uploadées en CI pour stack traces utiles
- Alertes email immédiates sur erreurs en prod
- Tags : `userId` (anonymisé), `route`, `release_version`

### 12.2. Workflow Claude résout les bugs

Workflow documenté dans `docs/runbook-bug-fix.md` :
1. Sentry envoie email à Eliot
2. Eliot clique sur le lien Sentry, copie le payload (stack trace + breadcrumbs + user context)
3. Eliot lance Claude Code dans le repo, colle le payload, dit "fix this bug"
4. Claude diagnose, propose fix, écrit test qui reproduit, fixe, run tests
5. Eliot review le diff, valide, push → CI/CD déploie

C'est pas du "100% auto" mais c'est du "1-clic pour Eliot" avec qualité préservée. Le `/verify-no-hallucinate` skill peut être utilisé pour vérifier le fix.

### 12.3. Logs serveur

- Stdout structuré JSON (pino logger)
- Rotation automatique (logrotate)
- Pas de PII en clair dans les logs

### 12.4. Health check

- Endpoint `/api/health` vérifiant : DB up, R2 reachable, Resend reachable
- Uptime monitoring externe gratuit (UptimeRobot ou Better Uptime free)

---

## 13. Hors scope V1 (explicite)

Pour cadrer le projet, voici ce qui est **explicitement EXCLU** de la V1 :

- ❌ Connexion broker (MT4/MT5/cTrader) — le membre saisit ses trades manuellement
- ❌ Paiement intégré — invitation manuelle uniquement
- ❌ Communauté entre membres (chat, forum, leaderboard public)
- ❌ Multi-langue — full français
- ❌ Multi-admin — fxeliott unique
- ❌ Annotations dessinées sur les screens (cercles, flèches) — V2
- ❌ Chatbot IA conversationnel Mark Douglas en runtime — contenu statique uniquement
- ❌ App native iOS/Android dans les stores — PWA pure d'abord
- ❌ Notifications email transactionnelles riches (digest hebdo membre) — V2
- ❌ Mode hors ligne complet PWA — sync optimiste basique seulement
- ❌ Light mode — dark only
- ❌ Modèles de trading à choisir, templates de plans, etc. — V2
- ❌ Calculateur de position size — V2
- ❌ Économique calendar embed — jamais (pas dans la posture "pas d'analyse")

---

## 14. Roadmap V2 / V3 (prioritisée pour quand V1 est validée)

### V2 (après ~1-3 mois de V1 en prod)
- Capacitor wrapper + publication App Store + Play Store (compte Apple Developer ~99€/an)
- Annotations dessinées sur screens (Fabric.js ou tldraw)
- Chatbot Mark Douglas en runtime (Claude API, à la demande, quota par membre)
- Digest email hebdo pour le membre lui-même
- Light mode optionnel (si demande)
- Templates de plans de trading

### V3 (à plus long terme)
- Multi-admin (coachs assistants pour Eliot)
- Connexion broker MT5 via API (lecture trades auto)
- Communauté privée entre membres (chat asynchrone, modéré)
- Onboarding self-service avec paiement Stripe
- Multi-langue (EN d'abord)
- App desktop Electron (si justifié)

---

## 15. Plan d'implémentation par jalons

> Chaque jalon est livrable et testable en isolation. Eliot peut tester progressivement.

### Jalon 0 — Setup projet (3-5 jours)
- Init monorepo Turborepo + pnpm workspaces (un seul package `apps/web` au début, ouvert à plus en V2)
- Next.js 15 + TS strict + Tailwind + shadcn/ui
- Prisma + Postgres local Docker
- ESLint + Prettier + lint-staged + Husky pre-commit
- GitHub Actions CI (type check + tests + build)
- Variables d'environnement structurées
- Docker Compose dev local
- Charte graphique de base + logo Eliot intégré

**Done quand** : `pnpm dev` lance l'app sur localhost avec page d'accueil bleue/noire au logo Fxmily.

### Jalon 1 — Auth & invitation (5-7 jours)
- Auth.js v5 configuré avec Postgres adapter
- Page `/login` (email + password)
- Magic link "mot de passe oublié"
- Pages admin `/admin/invite` (form + envoi email Resend)
- Email template d'invitation (React Email)
- Page `/onboarding/welcome` (form prénom/nom/photo/password)
- Upload photo de profil → R2
- Tests unitaires (services), intégration (API routes), E2E (full invitation flow)

**Done quand** : Eliot peut inviter un faux email, recevoir le mail, créer le compte et logger.

### Jalon 2 — Journal de trading (7-10 jours)
- Schéma `Trade` Prisma + migration
- Form wizard `<TradeForm />` avec étapes (mobile-first)
- Upload screens (drag & drop) → R2 via presigned URL
- Pages `/journal` (liste) et `/journal/new` (création) et `/journal/[id]` (détail)
- Validation Zod côté client + serveur
- Tests TDD sur la logique de calcul R réalisé
- Tests E2E création de trade complète

**Done quand** : un membre peut créer un trade complet, voir la liste, ouvrir un trade et voir ses screens.

### Jalon 3 — Espace admin & vue membre (5-7 jours)
- Middleware `requireAdmin`
- Page `/admin/members` (liste paginée avec filtres)
- Page `/admin/members/[id]` (vue d'ensemble + onglets)
- Composant `<AdminMemberRow />` avec badges
- Tests E2E navigation admin

**Done quand** : Eliot voit la liste des membres, ouvre un membre, voit ses trades.

### Jalon 4 — Workflow d'annotation (5-7 jours)
- Schéma `TradeAnnotation` + migration
- UI annotation (textarea + bouton upload média R2 large)
- Notification push créée (queue) à la création de l'annotation
- Côté membre : badge "🆕 1 correction" sur le trade
- Tracking `seenByMemberAt`
- Tests TDD service d'annotation, E2E flow complet admin → membre

**Done quand** : Eliot annote un trade, le membre reçoit un push, ouvre la correction, le statut "vu" se met à jour.

### Jalon 5 — Tracking quotidien (5-7 jours)
- Schéma `DailyCheckin` + migration
- Forms `<MorningCheckin />` et `<EveningCheckin />` mobile-first wizard
- Pages `/checkin/morning` et `/checkin/evening`
- Cron pour push reminder matin + soir
- Streak counter
- Tests TDD calcul streak, E2E parcours check-in

**Done quand** : un membre peut faire ses 2 check-ins quotidiens, voit son streak, reçoit ses pushes.

### Jalon 6 — Dashboard membre & track record (5-7 jours)
- Page `/dashboard` (membre)
- Composants `<TrackRecordChart />`, `<ScoreGauge />`, croisements de patterns
- Calculs scoring déterministe (`lib/scoring/*.ts`)
- Cron nightly pour recalcul scores
- Tests TDD sur tous les calculs scoring

**Done quand** : un membre voit ses 4 scores, ses graphiques, ses patterns émotion x perf.

### Jalon 7 — Module Mark Douglas (7-10 jours)
- Schémas `MarkDouglasCard` + `MarkDouglasDelivery` + migration
- Génération du contenu (Claude Code génère ~50 fiches initiales, Eliot relit/valide)
- Page `/library` (parcourir toutes les fiches)
- Page `/library/[slug]` (lire une fiche)
- Système de déclencheurs contextuels (engine de règles JSON, lib `lib/triggers/*.ts`)
- Tests TDD sur chaque règle de déclenchement
- Page admin `/admin/cards` (gestion CRUD bibliothèque + édition règles)

**Done quand** : Eliot a sa bibliothèque de fiches, le membre reçoit une fiche après 3 trades perdants consécutifs en test.

### Jalon 8 — Rapport hebdo IA admin (3-5 jours)
- Schéma `WeeklyReport` + migration
- Cron dimanche 21:00 UTC
- Service `lib/weekly-report/builder.ts` qui agrège la data du membre
- Service `lib/weekly-report/claude.ts` qui appelle l'API Claude avec prompt caching
- Page `/admin/reports` (liste + détail)
- Email digest à fxeliott
- Tests d'intégration avec Claude API (mock)

**Done quand** : un dimanche, Eliot reçoit un email avec le rapport de chaque membre actif.

### Jalon 9 — Notifications push complètes (3-5 jours)
- VAPID keys générées + stockées
- Service Worker enregistré
- Page `/account/notifications` (toggles par catégorie)
- Worker `lib/push/dispatcher.ts` consommant la queue
- Tests E2E avec mock service worker

**Done quand** : un membre active ses notifs, reçoit les pushes prévus, peut les désactiver par catégorie.

### Jalon 10 — RGPD, légal, monitoring, déploiement prod (3-5 jours)
- Pages legal (privacy, terms, mentions)
- Bandeau info cookies (light, pas de tracking, aucun cookie tiers)
- Export de données (JSON download)
- Suppression de compte (soft delete + cron purge)
- Sentry intégré (client + serveur)
- Setup serveur Hetzner production (Docker Compose + Caddy + cron jobs)
- Achat domaine fxmily.com (recommandé Cloudflare Registrar)
- DNS app.fxmily.com → Hetzner
- Premier déploiement prod
- Première invitation réelle (toi en test)

**Done quand** : l'app est en prod sur app.fxmily.com, Eliot peut s'inviter et tester end-to-end.

**Total estimé** : 50-70 jours de travail. Soit ~10-14 semaines à temps partiel, ou ~6-8 semaines à temps plein équivalent. Réaliste pour un duo Eliot + Claude Code en sessions itératives.

---

## 16. Coûts récurrents prévisionnels

| Poste | Coût | Notes |
|---|---|---|
| Hetzner Cloud CX22 | ~5€/mois | Serveur déjà existant probablement |
| Cloudflare R2 (10 Go free) | 0€/mois | Au-delà : 0,015$/Go/mois |
| Resend (3000 emails free) | 0€/mois | Au-delà : 20$/mois pour 50k |
| Sentry (5000 erreurs free) | 0€/mois | Au-delà : 26$/mois |
| Claude API (rapports hebdo) | ~5-10€/mois | Sonnet 4.6, 30 membres |
| Cloudflare Registrar (domaine) | ~10€/an | Ou OVH |
| **Total V1** | **~10-15€/mois** | Hors abonnement Claude Max 20x déjà payé |
| Apple Developer (V2) | 99€/an | Si publication App Store |
| Google Play (V2) | 25€ one-shot | Si publication Play Store |

---

## 17. Décisions documentées avec rationale

| Sujet | Décision | Rationale |
|---|---|---|
| Stack frontend | Next.js 16 + Capacitor (V2) | Eliot a délégué, c'est le meilleur ratio qualité/effort pour un débutant. ⚠️ Capacitor V2 wrapping exige `output: 'export'` (incompatible avec les Server Actions utilisés en J1+). Refactor REST custom à planifier au moment du wrapping App Store. |
| Database | PostgreSQL self-hosted | Eliot a choisi, robuste et scale naturel |
| Médias | Cloudflare R2 | Eliot a choisi, gratuit jusqu'à 10 Go, pas de frais sortie |
| Auth | Email + password + magic link | Standard, pas de OAuth pour simplifier V1 |
| Composants UI | shadcn/ui | Standard 2026, customisable, accessible |
| Animations | Framer Motion | Standard React, qualité premium |
| Charts | Tremor | Très joli par défaut, gratuit |
| Tests | TDD partout (pragmatique) | Eliot a choisi "tests partout (TDD)" |
| Mobile V1 | PWA pure | Eliot a choisi (gratuit, on commence) |
| Mobile V2 | Capacitor + stores | Eliot validera 99€ Apple quand prêt |
| App Store iOS | Reporté V2 | Eliot veut commencer gratuit |
| Coach MD | Statique uniquement | Eliot a choisi (zéro coût API runtime) |
| Rapport IA hebdo | batch local Claude Max (Opus 4.8 §8) admin uniquement | Eliot a choisi — $0 API marginal (pivot V1.7) |
| Déclencheurs MD | Règles déterministes | Eliot a choisi |
| Social | 100% solo + admin | Eliot a choisi |
| Tracking quotidien | Matin + soir | Eliot a choisi |
| Visibilité données membre | Tout voir + dashboard perso | Eliot a choisi |
| Nom de l'app | Fxmily | Eliot a choisi |
| Domaine | app.fxmily.com (à acheter) | Eliot a choisi, je rappelle l'achat |
| Branding visuel | Logo Eliot + charte créée par Claude Design | Eliot fournira logo, je crée le reste |
| Backups | pg_dump + R2, 30 jours rétention | Tranché par moi (Eliot a dit "fais au mieux") |
| RGPD | Politique + CGU + consentement + droit effacement | Tranché par moi |
| Volume cible | 30 → 100 → milliers | Eliot a précisé |
| Langue | Français uniquement V1 | Eliot a précisé |
| Monitoring | Sentry gratuit | Eliot a choisi |
| Workflow bugs | Sentry → Eliot → Claude Code | Adaptation pragmatique de "Claude résout en autonomie" |
| Approche release | Tout en V1 mais en jalons | Eliot a dit "tout en même temps", j'ai structuré en livrables intermédiaires |

---

## 18. Notes finales & alertes

### 18.1. Ce que je n'ai PAS validé avec Eliot

- L'achat exact du domaine fxmily.com (à confirmer disponible avant J10)
- Le logo précis (à fournir au J0)
- Les emails business pour le compte admin (probablement fxeliott@fxmily.com une fois domaine acheté)
- Les paires de trading exactes pour l'autocomplete (à confirmer ensemble : juste forex majeurs ? + or ? + indices ? + crypto ?)
- Le fuseau par défaut des nouveaux membres (Europe/Paris ou détection auto via navigateur ?)

### 18.2. Risques identifiés

| Risque | Mitigation |
|---|---|
| Eliot débutant code, scope énorme | Jalons hebdomadaires utilisables, je documente chaque PR pour qu'Eliot comprenne |
| Vidéos Zoom > 500 Mo trop lourdes | Limite côté client, message clair, suggérer compression Handbrake |
| Membre qui désinvitable demande RGPD complexe | Procédure documentée + endpoint testé |
| Coût Claude API explose si beaucoup de membres | Switch automatique sur Haiku 4.5 si > 1000 membres |
| Mark Douglas droits d'auteur (citations) | Citations courtes uniquement, attribution systématique, paraphrase pour le reste |
| iOS push notifications bug PWA | Tests réels dès le J9, fallback email si échec persistant |
| Hetzner panne | Backups R2 cross-région, restore documenté, Eliot pas seul à gérer (je suis là pour aider) |

### 18.3. Choses à demander à Eliot avant la session d'implémentation

1. **Logo Fxmily** en SVG si possible, sinon PNG transparent haute résolution
2. **Codes hex précis du bleu Fxmily** s'il en a un (sinon on prend ma proposition section 8.1)
3. **Identifiants Hetzner** (clé SSH, IP serveur) pour configurer le déploiement
4. **Identifiants Cloudflare** (compte pour R2 + futur registrar)
5. **Liste des paires de trading** prioritaires
6. **Email business** pour le compte admin (sinon fxeliott@fxmily.com après achat domaine)

### 18.4. Recommandation forte de phasage des sessions

Pour ne pas surcharger une seule session Claude Code (qualité dégrade au-delà de ~30k tokens dans le contexte), je recommande :

- **1 session = 1 jalon** (parfois 2 si très petits)
- **`/clear` entre chaque jalon**, en partant à chaque fois de SPEC.md + git log + diffs récents
- **Vérifier après chaque jalon** : tests passent, type check passe, l'app tourne en local sur les écrans concernés
- **Commit + push après chaque feature significative**, jamais de gros commit fourre-tout

---

## 19. Prochaines étapes immédiates

1. **Eliot** relit ce SPEC.md tranquillement (~30-45 min de lecture attentive)
2. **Eliot** modifie / annote / commente ce qui ne lui convient pas (directement dans le fichier, ou par feedback à Claude)
3. **Eliot** prépare ses inputs (logo, codes hex, identifiants Hetzner, etc.)
4. **Eliot** lance une **nouvelle session Claude Code** avec `/clear`
5. Premier message de la nouvelle session : *"Implémente le Jalon 0 du SPEC.md à `D:\Fxmily\SPEC.md`. Setup projet uniquement."*
6. Itérer jalon par jalon

---

**Fin du SPEC v1.0** (préservé tel quel pour traçabilité de l'intent initial)

---

## 20. Changelog v1.0 → v1.1 (2026-05-08)

> Cette section documente les pivots tranchés en cours d'implémentation entre 2026-05-05 et 2026-05-08, qui n'étaient pas reflétés dans le SPEC v1.0. **Le SPEC v1.0 est préservé immuable au-dessus pour traçabilité de la vision initiale** — cette section v1.1 est le delta vers la réalité.

### 20.1 — Pivots stack (déviations contrôlées validées)

| Item | SPEC v1.0 | Réalité v1.1 | Justification | Jalon |
|---|---|---|---|---|
| Charts | Tremor (§4) | **Recharts** | Bundle 200KB→150KB + control DS complet (Cell, Tooltip, fontSize tokens) | J6.6 |
| Auth strategy | DB sessions (§7.1) | **JWT** | Bug Auth.js v5 + Credentials + DB strategy (issue `nextauthjs/next-auth#12848`). JWT-only edge-compat et officiellement recommandé par Auth.js. Table `Session` conservée pour future Email provider. | J1 |
| Middleware | `middleware.ts` (§17) | **`proxy.ts`** | Renommage Next 16 (sortie 21 oct 2025) + matcher exclude `/api/*` (handler retourne 401 JSON, pas 307 redirect). | J1 + J2 fix |
| Palette | bleu/noir + Inter (§8.1, §8.2) | **lime accent + Geist + Mercury shadows** | Handoff Claude Design Sprint #1, validé visuellement par Eliot. Tokens DS v2 (`--acc`, `--bg-*`, `--t-*`, `--b-*`). | Sprint #1 |
| Composants UI | shadcn/ui (§4) | **shadcn/ui + 9 primitives DS-v2 custom** | Sprint #1 a généré : `btn`, `card`, `pill`, `tooltip`, `kbd`, `sparkline`, `empty-state`, `error-state`, `info-dot`. Tailwind 4.2 + variants tone-aware. | Sprint #1 |
| Trade screens | `screenshots[]` array (§6.2) | **2 colonnes nullable** `screenshotEntryKey` / `screenshotExitKey` | KISS — V1 a 2 instances connues alignées sur les 2 phases du wizard (avant/après). Migration vers `TradeScreenshot` table en V2 si plus besoin. | J2 |
| R2 | wired V1 (§4) | **stub local FS** (LocalStorageAdapter) | Cloudflare R2 keys non livrées par Eliot. Switch automatique vers R2StorageAdapter quand `R2_ACCOUNT_ID + 3 autres R2_*` sont set en `.env`. AWS SDK pas installé. | J2 |
| Trade R réalisé | calc auto si possible (§7.3) | **`stopLossPrice` optionnel + `realizedRSource: 'computed' \| 'estimated'`** | Permet R réalisé exact quand stop-loss saisi, fallback intelligent selon outcome sinon. Exclu des aggregates précision-sensibles. | J2 |
| Vidéo Zoom 500MB annotation | J4 (§7.8) | **différée J4.5** | `req.formData()` actuel buffer-tout-en-RAM (incompatible 500 MiB) + R2 pas wired. UI prête (slot vidéo désactivé J4.5). | J4 |
| Markdown rendering | non spécifié | **`<SafeMarkdown>` server-only** (react-markdown + remark-gfm + rehype-sanitize hardened schema + skipHtml + urlTransform allowlist) | Hardening défense-en-profondeur pour le contenu Mark Douglas (ch.J7) + futur prompt Claude J8. Bundle 30KB en RSC, 0 client JS. | J7 |
| Fiches Mark Douglas | ~50 (§7.6) | **50 livrées** (12 J7 + 10 J7.5 + 9 J7.6 + 19 J7.8) | Cible atteinte. Citations ≤30 mots fair use FR L122-5 + `quoteSourceChapter` obligatoire + paraphrases 200-400 mots à la voix d'Eliot + 1-3 exercises. | J7.8 |
| Cooldown Mark Douglas | non spécifié | **Yu-kai Chou Octalysis** : white hat 7j / black hat 14j | Anti-spam push notifications. Black hat = fiches d'urgence (tilt, deviation, hedge violation). White hat = fiches catalogue (acceptance, probabilities, process). | J7 |
| Streak design | non spécifié | **Mercy infrastructure** anti-Snapchat | Pill "EN FEU" retirée. Flame-flicker (7+ j) + flame-pulse (30+ j) + 4-tick milestone strip 7/14/30/100 + sr-only "Palier franchi". | J5 audit |

### 20.2 — Sous-jalons inventés en cours (12)

Le SPEC v1.0 §15 décrivait 11 jalons J0→J10. La réalité a produit **12 sous-jalons polish/hardening** non prévus, intercalés entre les jalons SPEC. Pattern récurrent : "audit-driven hardening" post-implémentation initiale (4-5 subagents code-reviewer + security-auditor + accessibility-reviewer + ui-designer + fxmily-content-checker en parallèle).

| Sous-jalon | PR | mergeCommit | Scope |
|---|---|---|---|
| **Sprint #1 Design** | #12 | `a62280f` | Palette lime + Geist + Mercury shadows + 12/12 écrans élevés DS v2 |
| **J1.5 magic link** | _différé_ | — | Reset password Auth.js (Email provider workaround Credentials) |
| **J4.5 vidéo Zoom 500MB** | _différé_ | — | Presigned PUT R2 + body streaming |
| **J5.5 timezone JWT + édition checkin + routine perso** | inclus #15 | `c8c891f` | `User.timezone` propagée via JWT à toutes pages + Server Actions, élimine 4 hardcodes Europe/Paris |
| **J5 ops** | #16 #17 #18 #19 | — | E2E helpers cross-jalon, smoke-tour visuel Playwright, CI quota optim, `tsx` devDep |
| **J6.5 live recompute** | #22 | `8e01f64` | Server Actions `closeTrade`/`submitMorning`/`submitEvening` appellent `scheduleScoreRecompute` via `after()` Next 16 + debounce 5s |
| **J6.6 premium polish** | #23 | `8813ee0` | Recharts hex (Safari iOS CSS-var fix) + count-up `useMotionValue` + glow95+ + a11y BLOCKERs |
| **J7.5 polish premium** | #25 | `e187c63` | Framer Motion (FavoriteToggle spring + AnimatedCardGrid stagger + HelpfulFeedback tap) + a11y H4-H5 + 10 cards + cleanup CR-#10/#16/#19 |
| **J7.6 deep polish** | #26 | `fb336a0` | Reader hero aurora halo + h-rise H1 f-display 32-48px + drop-cap magazine + 9 cards + a11y H8 (`headingOffset` prop) |
| **J7.7 dashboard widget** | #27 | `607e6ae` | `<DouglasInboxWidget>` Server Component sur `/dashboard` (top 3 deliveries + counter unread + CTAs) + smoke browser live validé |
| **J7.8 50/50 fiches** | _en cours_ | _en cours_ | +19 fiches Mark Douglas (ego+3, prob+2, conf+1, pat+2, cons+2, fear+3, loss+2, proc+4) → cible §7.6 atteinte. Fix `accepter-1r-mental` lowercase. SPEC.md → v1.1. |

### 20.3 — Pattern audit-driven hardening (canon Fxmily)

Institué progressivement de J5 → J7. Chaque jalon non-trivial est livré en 2 phases :

```
Phase 1 — Implementation (commit "feat(jX): ...")
Phase 2 — Audit-driven hardening :
  ├─ 4-5 subagents en parallèle (code-reviewer + security-auditor +
  │   accessibility-reviewer + ui-designer + fxmily-content-checker)
  ├─ Tri TIER 1 (BLOCKERs) → TIER 2 (HIGH) → TIER 3 (MEDIUM) → TIER 4 (LOW)
  ├─ Fix TIER 1+2+3 in-session (commit "feat(jX): audit-driven hardening")
  ├─ Reclassement TIER 4 → sous-jalon polish suivant (J5.5, J6.5, J7.5...)
  ├─ Smoke test live (curl + DB + dev server) prouvant SPEC §15 critère "Done quand"
  ├─ Update apps/web/CLAUDE.md (section close-out)
  └─ PR + rebase merge (préserve commits granulaires)
```

**Stats par jalon** : J5 (13 ship-blockers + ~25 HIGH closed), J6 (8 BLOCKERs + 6 HIGH), J7 (8 BLOCKERs + 6 HIGH closed, 6 BLOCKERs UI design DS-coherence reclassés J7.5).

### 20.4 — Sécurité tranchée en session (canon Fxmily, à conserver pour J8+)

| Pattern | Origine | Application |
|---|---|---|
| `crypto.timingSafeEqual` SHA-256 sur `X-Cron-Secret` | J5 (CWE-208 Cloudflare length-leak) | Tous crons (`/api/cron/checkin-reminders`, `recompute-scores`, `dispatch-douglas`, `weekly-reports` à venir J8) |
| Token bucket in-memory (5 burst, 1/min) + LRU `maxKeys: 1024` | J5 | Tous crons |
| `?at=ISO` dev override double-gated (`NODE_ENV !== 'production'` AND `AUTH_URL` not HTTPS-prod) | J5 | Tous crons (smoke test live sans attendre temporel) |
| `safeFreeText` NFC + bidi/zero-width strip | J5 audit M5 (Trojan Source) | 100% champs free-text user-controlled (`intention`, `journalNote`, `gratitudeItems`, `sportType`, `paraphrase`, `quote`, `title`, `exercises.label/description`). **CRITIQUE pour J8 prompt Claude**. |
| Postgres unique partial index (`WHERE status='pending' AND ...`) | J5 dedup | Idempotency cron-side au niveau DB (pattern J5 carbone J7) |
| JWT `update()` callback bypass closé | J5 audit H3 | Dead-code retiré (`session.role` / `session.status` client-supplied refusés) |
| BOLA cross-resource check à 2 niveaux (path-owner + auth check) | J2 | Tous uploads (`trades/*`, `annotations/*`) + GET re-vérifie ownership |
| `rehype-sanitize` hardened schema + `urlTransform` allowlist | J7 | `<SafeMarkdown>` server-only (anti-XSS + anti-`javascript:` URLs) |

### 20.5 — État vs SPEC §15 critères "Done quand"

| Jalon | Critère SPEC §15 | État 2026-05-08 |
|---|---|---|
| J0 | `pnpm dev` lance app + page accueil bleue/noire au logo | ✅ (palette pivotée lime DS v2) |
| J1 | Eliot peut inviter, recevoir mail, créer compte, logger | ✅ smoke E2E live validé via Resend réel |
| J2 | Membre crée trade complet, voit liste, ouvre trade + screens | ✅ smoke live curl + magic-byte + BOLA |
| J3 | Eliot voit liste membres, ouvre membre, voit trades | ✅ |
| J4 | Eliot annote, membre reçoit push, ouvre, statut "vu" | ⚠️ V1 image-only 8 MiB (vidéo 500 MiB → J4.5) |
| J5 | Membre fait 2 check-ins, voit streak, reçoit pushes | ✅ smoke cron+P2002+rate-limit+JWT validé |
| J6 | Membre voit 4 scores + graphiques + patterns émotion×perf | ✅ 458→503 tests, 100 trades demo seeded |
| J7 | Bibliothèque + déclencheurs + membre reçoit fiche après 3 pertes consécutives | ✅ smoke `scripts/smoke-test-j7.ts` ALL GREEN avec 50 cards |
| J8 | Eliot reçoit email avec rapport hebdo de chaque membre actif | ✅ Phase B+ smoke live ALL GREEN — Claude Sonnet mock + cron Sun 21 UTC + email digest |
| J9 | Membre active notifs, reçoit pushes prévus | ✅ smoke `scripts/smoke-test-j9.ts` ALL GREEN — Apple Declarative Web Push 8030 + classic dual SW + email fallback |
| J10 | App en prod, Eliot s'invite + teste end-to-end | ⚠️ code prêt (18 commits Phases A→P + Phase Q + R sur `claude/j10-prod-deploy`). **Phase R reality check 2026-05-09** : pivot domaine V1 sur `app.fxmilyapp.com` (déjà possédé par Eliot via `fxmily-prod`) au lieu de `app.fxmily.com` (achat reporté V2). Pre-requis bloquants restants : Sentry DSN + Resend `fxmilyapp.com` verify + iPhone Safari 18.4+ device test + admin password rotation + GitHub secrets posés. `fxmily.com` purchase = optionnel V2. |

### 20.6 — Backlog J8 (livré ✅ 2026-05-08)

J8 livré PR #30 + Phase B+. 6 fixes audit-driven hardening + 8 polish post-PR. Voir `apps/web/CLAUDE.md` section J8 pour les détails. Cron Sun 21 UTC + email digest + cache 1h Sonnet + 535 tests verts.

### 20.7 — État final V1 (2026-05-09)

J0 → J10 livrés. Branche `claude/j10-prod-deploy` HEAD `0588d12` après Phases A → P (18 commits granulaires) :

- **Phases A → H** : RGPD (soft-delete + cron purge) + Sentry (DSN-guarded + scrubber) + Hetzner Docker prod stack + audit-driven hardening round 1 (5 BLOCKERs + 7 HIGH).
- **Phases I → K** : promote J10.5+ items (atomic deletion + 2 rate-limits + skip-link + `<Code>` + `role="alert"` + h2 hierarchy + CookieBanner transition + Apple Touch Icons), CVE patch Next 16.2.6 (4 HIGH advisories), observability `/admin/system` + cron-watch GH Actions hourly.
- **Phases L → N** : `/account` hub + `error.tsx` + `not-found.tsx` + automation Cloudflare/Resend/bootstrap + zero-cost Vercel Hobby alternative.
- **Phases O → P** : 6 BLOCKERs cross-file finaux (auth status gate global + 4 schemas sanitization bidi + global-error.tsx + 4 WCAG) + override hono CVE 2026.

**Quality gate finale** : format ✓, lint ✓, type-check ✓, **Vitest 717/717 verts**, build prod Turbopack ✓. CI [PR #35](https://github.com/fxeliott/fxmily/pull/35) verte sur 3 checks.

**Reclassé V2 / J10.5+** : CSP nonces, JWT `tokenVersion`, login rate-limit credential-stuffing, Capacitor + App Store, Stripe paiement, multi-admin, annual DR test, Service Worker offline strategy, retention auditLog 90j.

---

## 21. Mode Entraînement / Backtest TradingView (spec V1.2 — 2026-05-17)

> Source : interview `/spec` 2026-05-17 (8 questions, 2 rounds, autonomie max). HORS SPEC v1.0/v1.1 (gap-analysis 2026-05-17 : 0 hit applicatif backtest/training). Cette section fait foi pour le jalon. **Impl = session dédiée post-`/clear`** (cette session = design only, règle 1 session = 1 jalon §18.4).

### 21.1 Vision en 1 phrase

Un espace où chaque membre journalise ses backtests TradingView (analyses + captures) **totalement isolé de son trading réel**, où Eliot dépose des corrections expertes comme sur le réel, et où l'**activité de pratique** (le volume/la régularité — jamais les résultats) nourrit le signal d'engagement/coaching — sans jamais polluer l'edge réel ni juger la qualité des analyses (système Lhedge inconnu de l'assistant).

### 21.2 Décisions d'architecture (choix Eliot, avec rationale)

| Décision | Choix validé | Rationale |
|---|---|---|
| Discriminant réel/training | **Entité séparée `TrainingTrade`** (PAS de flag `Trade.mode`) | Choix Eliot explicite (override reco assistant) — isolation béton : impossible que le backtest pollue le réel par construction. Trade-off accepté : surface de code training dédiée. Migration maîtrisée via `prisma-migration-runner`. |
| Edge réel | **Training EXCLU** de track-record / score 4-dim / expectancy / corrélation Habit×Trade réels ; vues training dédiées séparées | Intégrité statistique = thèse produit (ne jamais mentir avec les chiffres, posture Mark Douglas). L'edge réel ne reflète que du risque réel. |
| Surface UI | **Section `/training/*` dédiée** (landing + `/training/new` wizard cloné, identité visuelle "MODE ENTRAÎNEMENT" non-confondable) | Ne jamais flouter backtest/live = point de discipline Mark Douglas ; frontière URL claire (membre + admin) ; cohérent avec REFLECT (routes dédiées). DS-v2 (PAS `.v18-theme`). |
| Corrections admin | **Table `TrainingAnnotation` séparée**, réutilisant EXACTEMENT le pattern/UX/flow J4 (commentaire + capture annotée + notif "correction reçue") | Cohérence isolation bout-en-bout + schéma propre, zéro FK conditionnelle. Le geste de correction est identique pour Eliot. |
| Champs de saisie | **Jeu allégé spécifique backtest** (paire, capture analyse à l'entrée, R:R prévu, résultat, respect système/plan auto-check, leçon tirée) — SANS émotions/sommeil/confiance du live | Émotion de backtest ≠ émotion en risque réel (Mark Douglas) ; capturer des signaux psy de pratique fausserait la lecture réelle. Focus = exécution du process/règles. |
| Lien TradingView | **Capture d'écran (V1.2)** ; URL/replay interactif → V2 | Pipeline upload éprouvé (validation magic-byte, R2-ready, offline PWA), zéro dépendance tierce, correction directe sur l'image. |
| Coaching / engagement | **Hybride (raffinement Eliot)** : l'*activité* training (volume/régularité/récence — **JAMAIS** le P&L backtest) alimente (a) la dimension `engagement`, (b) un nouveau trigger Mark Douglas `no_training_activity_in_window` configurable en admin (inactivité → alerte), (c) une ligne "volume de pratique" du rapport hebdo IA (count/récence only) | Verbatim Eliot : « plus de trade en training = le membre veut évoluer et pratique beaucoup → à prendre en compte ; inversement s'il fait rien → à alerter ». Le moteur ne commente JAMAIS la qualité des analyses (= correction admin Eliot). |

### 21.3 Modèle de données (cible — à raffiner en impl via `prisma-migration-runner`)

- **`TrainingTrade`** (`training_trades`) : `userId`→User cascade, `pair`, `entryScreenshotKey`, `plannedRR`, `outcome`/`resultR`, `systemRespected` (tri-state), `lessonLearned` (Text, canon `safeFreeText` + reject bidi/zero-width), `enteredAt`, `createdAt`, `updatedAt`. Index `(userId, enteredAt DESC)`. Aucune réutilisation de `Trade`.
- **`TrainingAnnotation`** (`training_annotations`) : mirror EXACT de `TradeAnnotation` (J4) mais `trainingTradeId`→TrainingTrade cascade + `adminId`→User cascade ; `comment` (Text canon), `mediaKey?`/`mediaType?`, `seenByMemberAt?`, timestamps. Index `(trainingTradeId, createdAt DESC)`, `(trainingTradeId, seenByMemberAt)`, `(adminId, createdAt DESC)`.
- Storage prefix dédié `training/{trainingTradeId}/{nanoid32}.{jpg|png|webp}` (mirror convention keys J4).
- **Aucune modification** des modèles réels (Trade / BehavioralScore / corrélation) — isolation par construction.

### 21.4 Comportement attendu

- **Membre** : `/training` (track-record training dédié + liste) → `/training/new` (wizard allégé : paire → capture → R:R → résultat → respect système → leçon) → submit → trade training créé (isolé) → liste + stats training.
- **Admin** : `/admin/members/[id]` onglet/vue training → liste trades training du membre → annoter (flux J4 carbone sur `TrainingAnnotation`) → membre reçoit notif "correction reçue (entraînement)", statut "vu" tracké.
- **Engagement** : activité training (count/récence) → dimension `engagement` + trigger inactivité (config JSON admin §7.6) + ligne rapport hebdo (volume pratique, jamais P&L).
- **Edge cases** : 0 trade training → état vide pédagogique (jamais "score 0" mensonger) ; un trade training n'apparaît JAMAIS dans `/journal` réel, dashboard réel, scoring réel, expectancy/corrélation réels (filtres explicites + **tests anti-fuite obligatoires**) ; suppression membre = cascade training (RGPD).
- **Erreurs** : upload invalide → garde-fous J2 (magic-byte, taille) ; corrections training = admin-only (auth + role, mirror J4).

### 21.5 Critères d'acceptation (testables)

- [ ] Migrations `TrainingTrade` + `TrainingAnnotation` additives, `prisma-migration-runner` SAFE, rollback documenté (runbook).
- [ ] **Test anti-fuite** : un trade training n'apparaît dans AUCUNE surface réelle (assertions explicites journal/dashboard/scoring/expectancy/corrélation).
- [ ] Membre crée un backtest (wizard allégé), le voit dans `/training` + stats training dédiées.
- [ ] Eliot annote un trade training → membre reçoit notif "correction reçue (entraînement)" → statut "vu".
- [ ] Activité training alimente engagement + trigger inactivité configurable admin + ligne rapport hebdo (count only, 0 P&L).
- [ ] Posture : aucune surface ne commente la qualité des analyses Lhedge ; zéro conseil trade.
- [ ] Gate complet vert + audit-driven hardening (security-auditor frontière isolation + a11y wizard + code-reviewer + prisma-migration-runner).

### 21.6 Hors scope V1.2 (explicite — anti scope-creep)

- URL/replay TradingView interactif → **ÉLIMINÉ définitivement** (décision Eliot 2026-05-18 — l'analyse reste sur TradingView ; l'app log trades/screens/comportement = posture §2 déjà en place ; ne jamais re-proposer). La capture suffit.
- Débrief/coaching d'entraînement DÉDIÉ autonome → **specé V1.3, voir §23** (jalon #1 de la séquence §21.6 verrouillée 2026-05-18 : débrief training → débrief mensuel → QCM athlète → suivi-formation). V1.2 = training nourrit l'engagement réel + corrections admin.
- Débrief mensuel (#2) → **specé V1.4, voir §25** (jalon #2 de la séquence §21.6 verrouillée : synthèse IA mensuelle dual-audience, dual-périmètre cloisonné réel / training §21.5-safe ; cadré via interview `/spec` 2026-05-19).
- QCM athlète (#3) → **specé V1.5, voir §27** (jalon #3 de la séquence §21.6 verrouillée : auto-évaluation mindset hebdomadaire courte, 100 % déterministe, isolée du score §7.11, restitution premium anti Black-Hat ; cadré via interview `/spec` 2026-05-19).
- Suivi-formation/cursus (#4) → **À VENIR — placeholder UI calme exposé `/dashboard`** (décision Eliot 2026-05-20 supersede 2026-05-19 — la dépendance « projet pédagogie externe » est retirée ; un placeholder « Suivi formation — À venir » marque le slot futur dans l'app pour les membres ; activation V1.x via `/spec` dédié + build séparé sur décision Eliot ultérieure, jamais bundlés §18.4). Séquence §21.6 reste à 4 jalons (verrouillée 2026-05-18, gap-analysis 2026-05-17) : #1 #2 #3 CLOS+déployés (#132 / #135 / #137) ; #4 placeholder UI exposé V2.1.6 — domaine coach restera à cadrer en `/spec` quand Eliot décidera de l'activer.
- Analytics training avancées (corrélation training, equity curve training détaillée) au-delà d'un track-record training basique → V2.
- Vidéo de correction sur training → image-only V1.2 (cf. J4 → J4.5 pour la vidéo).

### 21.7 Invariants (NON négociables)

- Posture Mark Douglas / zéro conseil sur les analyses Lhedge (SPEC §2, verrouillé).
- **Intégrité statistique** : l'edge réel ne reçoit JAMAIS de résultat backtest ; seul l'effort (activité count/récence) touche engagement/coaching.
- SPEC.md = source de vérité (cette §21 fait foi).
- Stack : Next.js 16 + React 19 TS strict + Prisma 7 + Auth.js v5 + DS-v2 (PAS `.v18-theme` = REFLECT only) + mobile-first PWA dark-only.
- Pattern Fxmily : backend-first, TDD logique critique, migration via subagent `prisma-migration-runner`, audit-driven hardening (security-auditor + code-reviewer + accessibility-reviewer + prisma-migration-runner), gate exit-codes-explicites, 1 PR atomic = 1 jalon, checkpoint + supersede.
- 1 session = 1 jalon : impl en session DÉDIÉE post-`/clear`.

### 21.8 Prochaine étape (recommandée)

1. Relire/ajuster §21 (10 min) — corriger ce qui ne correspond pas à ta vision.
2. `/clear` → nouvelle session dédiée.
3. Dire : « Implémente SPEC §21 (Mode Entraînement) — backend-first ».
4. Découpage suggéré en sous-jalons atomiques (gros jalon schema + ~12-18 fichiers) : **J-T1** data + migrations + service `TrainingTrade` + tests · **J-T2** wizard membre `/training/*` + UI · **J-T3** corrections admin `TrainingAnnotation` (mirror J4) · **J-T4** wiring engagement + trigger inactivité + ligne rapport hebdo + tests anti-fuite. Chaque sous-jalon = 1 PR atomic + audit-driven hardening.

Pourquoi nouvelle session : le contexte d'interview pollue l'implémentation ; une session vierge avec §21 comme référence donne une qualité supérieure (pattern Anthropic interview-first).

---

## 22. Changelog v1.1 → v1.2 (2026-05-17)

- **§21 ajoutée** : Mode Entraînement / Backtest TradingView (interview `/spec` 2026-05-17, 8 questions, 2 rounds). Décisions clés : entité `TrainingTrade` **séparée** (isolation béton, choix Eliot — override reco), **exclu** de l'edge réel, section `/training/*` dédiée, `TrainingAnnotation` mirror J4, champs **allégés** backtest, capture d'écran V1.2, activité→engagement+alerte inactivité (**jamais** le P&L backtest). Impl = jalon dédié multi-PR post-`/clear`.
- Contexte : suit le marathon V1.x→V2.1 (jalon #2 "Notes admin privées" SPEC §7.7 livré PR #108 `26f15d2` 2026-05-17). Mode Entraînement = la prochaine grande étape produit (différenciateur formation), nécessitait amendement SPEC avant tout code (gap-analysis 2026-05-17).

---

## 23. Débrief Training dédié (spec V1.3 — 2026-05-18)

> Source : interview `/spec` 2026-05-18 (2 rounds, 6 questions, autonomie max). **Jalon #1 de la séquence §21.6** (4 jalons verrouillés 2026-05-18 : débrief training → débrief mensuel → QCM athlète → suivi-formation ; un `/spec` + un build chacun, `/clear` entre, jamais bundlés §18.4). HORS §21 V1.2 (différé explicite §21.6 « Débrief/coaching d'entraînement DÉDIÉ autonome »). **Impl = session dédiée post-`/clear`** (règle 1 session = 1 jalon §18.4). Mirror patterns REFLECT V1.8 (`WeeklyReview` / `ReflectionEntry`).

### 23.1 Vision en 1 phrase

Un bilan **hebdomadaire** structuré où le membre prend du recul sur sa **pratique d'entraînement** (ses backtests §21 de la semaine) — un panneau de stats **process** auto-calculées (régularité, discipline, diversité, leçons — **jamais le P&L**) + une réflexion guidée Steenbarger reverse-journaling — visible **en lecture seule** par Eliot pour le coaching, **totalement isolé de l'edge réel** (§21.5) et sans jamais juger les analyses Lhedge (système inconnu de l'assistant, posture §2).

### 23.2 Décisions d'architecture (choix Eliot via interview, avec rationale)

| Décision | Choix validé | Rationale |
|---|---|---|
| Cadence | **Hebdomadaire ancré** lundi `@db.Date`, idempotent `(userId, weekStart)`, upsert au re-submit | Choix Eliot (override reco on-demand). Crée un rituel de recul régulier ; miroir exact `WeeklyReview` V1.8 = pattern éprouvé, zéro invention. Semaine ancrée Europe/Paris via `parseLocalDate` (invariant anti-drift `@db.Date` PR#96). |
| Entité | **`TrainingDebrief` séparée** (mirror `WeeklyReview`) | Isolation béton §21.5 par construction — aucune FK vers `Trade`/`WeeklyReview`/`BehavioralScore`. Cohérent avec l'entité `TrainingTrade` séparée (choix Eliot §21.2). |
| Structure | **Stats process auto (read-only) + wizard réflexion Steenbarger** : 2 forces de process + 1 micro-ajustement + 1 leçon transversale | Choix Eliot (reco confirmée). « Bilan structuré » = data objective (effort) + sens (réflexion). Reverse-journaling Steenbarger = canon lignée V1.7-prep/REFLECT (strengths-based, pas seulement fix-the-flaws). |
| Posture résultats | **Strict process — JAMAIS de P&L** : le débrief n'affiche jamais `outcome`/`resultR`, même en training | Choix Eliot (reco confirmée). Cohérent bannière `/training` (« la régularité qui compte, pas le P&L ») + posture §2 maximale + boot « ZÉRO analyse marché ». Le service débrief ne `select` JAMAIS `resultR`/`outcome` (discipline §21.5-style appliquée même intra-training). |
| Stats surfacées | **Les 4 familles** : Volume & régularité · Respect du système · Diversité de pratique · Leçons & corrections | Choix Eliot (4/4 cochées). Toutes dérivées des champs `TrainingTrade` + count `TrainingAnnotation` existants ; **calculées au render, jamais stockées** (pas de duplication, recompute-safe). |
| Visibilité admin | **Lecture seule** dans l'onglet `/admin/members/[id]?tab=training` EXISTANT (liste read-only, comme les backtests J-T3) | Choix Eliot (reco confirmée). Garde le jalon ATOMIQUE (1 session = 1 jalon §18.4). L'annotation/notif sur le débrief = jalon §21.6 follow-up séparé éventuel, PAS ce jalon. |
| Couplage edge réel | **AUCUN nouveau couplage** — faire un débrief n'alimente PAS l'engagement réel | Intégrité §21.5 : seul le `countRecentTrainingActivity` existant (compte les BACKTESTS, pas les débriefs) touche l'engagement. Le débrief est un outil de recul training-interne. |
| Crisis routing + injection | **Mirror REFLECT carbone** : `detectCrisis` + `detectInjection` sur le corpus réflexion, **persist QUAND MÊME**, audit PII-free + Sentry escalate, redirect `?crisis=` | Décidé (canon Server Action REFLECT). Le free-text réflexif peut porter un signal de détresse même sans champ émotion ; coût nul, sécurité maximale, anti-régression. |
| Identité visuelle | **DS-v2 cyan `--cy` « Mode entraînement »** (PAS `.v18-theme`) | Invariant §21.7 (`.v18-theme` = REFLECT only). Frontière backtest/live jamais floutée (discipline Mark Douglas). Mirror chrome `/training`. |

### 23.3 Modèle de données

- **`TrainingDebrief`** (`training_debriefs`) : `userId`→User cascade, `weekStart` `@db.Date` (lundi local Europe/Paris), réflexion Steenbarger — `processStrengthOne` (Text, mandatory), `processStrengthTwo` (Text, mandatory), `microAdjustment` (Text, mandatory), `transversalLesson` (Text, mandatory) — tous canon `safeFreeText` + reject bidi/zero-width. `createdAt`/`updatedAt`. **Unique `(userId, weekStart)`** (idempotency, upsert). Index `(userId, weekStart DESC)`. Cascade User delete (RGPD §17). **Aucune FK** vers `Trade`/`WeeklyReview`/`BehavioralScore` (isolation §21.5 par construction).
- **Stats = calculées au render, jamais stockées** : agrégateur PUR (testable TDD, §21.5-sensible) sur les `TrainingTrade` dont `enteredAt` ∈ `[weekStart, weekStart + 6 j]` (semaine Europe/Paris), **sans jamais `select` `resultR`/`outcome`**. Mapping famille→source explicite : (1) **Volume & régularité** = nombre de backtests + jours civils distincts pratiqués + plus long écart sans pratique (dérivés de `enteredAt`) ; (2) **Respect du système** = répartition tri-state de `systemRespected` (respecté / non respecté / non renseigné) ; (3) **Diversité de pratique** = nombre de `pair` distinctes ; (4) **Leçons & corrections** = nombre de `lessonLearned` non vides (le texte n'est PAS affiché) + `count` des `TrainingAnnotation` de la semaine (§21.5-safe). Recompute-safe, idempotent.
- Migration **additive** (1 `CREATE TABLE`), `prisma-migration-runner` SAFE, rollback documenté runbook (nouvelle section après §17). **Carry-over prod** : ajoute 1 migration à la maintenance window Eliot.

### 23.4 Comportement attendu

- **Membre** : `/training/debrief` (landing — hero cyan + timeline ~12 derniers débriefs) → `/training/debrief/new` (panneau stats process read-only de la semaine courante + wizard réflexion Steenbarger 4 champs) → submit → upsert `(userId, weekStart)` → redirect landing `?done=1` (calm reveal, anti Black-Hat : pas de XP/streak/fanfare).
- **Admin** : `/admin/members/[id]?tab=training` (onglet EXISTANT J-T3) → section read-only listant les débriefs hebdo du membre (réflexion + stats process recalculées) — **aucune action** (lecture seule ce jalon).
- **Edge cases** : semaine training à 0 backtest → le membre PEUT quand même écrire un débrief ; le panneau stats affiche « 0 backtest cette semaine » pédagogique (jamais « score 0 » mensonger, §21.4 canon). Re-submit même semaine = upsert (1 row). Un débrief n'apparaît JAMAIS dans `/journal`, dashboard, scoring, expectancy, corrélation Habit×Trade réels (filtres explicites + **test anti-fuite obligatoire**). Suppression membre = cascade (RGPD).
- **Crisis** : corpus réflexion → `detectCrisis` ; HIGH/MEDIUM → audit `training_debrief.crisis_detected` + Sentry escalate (HIGH `reportError`, MEDIUM `reportWarning`) → **persist quand même** → redirect `?crisis=` → bannière FR ressources (3114 + SOS Amitié + Suicide Écoute). Mirror REFLECT exact.
- **Erreurs** : Zod `safeParse` du payload complet côté serveur (autorité) ; `weekStart` = un **lundi local Europe/Paris** matérialisé en `Date` UTC-minuit via `parseLocalDate` (canon `WeeklyReview` `weekly-review/service.ts` — JAMAIS `getUTCDay()` ni `toISOString().slice(0,10)` sur un input naïf, invariant §23.7), dans une fenêtre bornée `[-35 j, +7 j]` ; `weekEnd` = `weekStart + 6 jours` service-computed (SSOT anti-tamper, jamais reçu du client) ; injection suspectée → audit metadata + Sentry warning, **jamais bloquant** (un FP ne doit pas manger le texte membre).

### 23.5 Critères d'acceptation (testables)

- [ ] Migration `TrainingDebrief` additive, `prisma-migration-runner` SAFE, rollback documenté runbook.
- [ ] **Test anti-fuite** : un `TrainingDebrief` + ses stats n'apparaissent dans AUCUNE surface réelle (assertions explicites journal/dashboard/scoring/expectancy/corrélation) ; le service débrief ne `select` JAMAIS `resultR`/`outcome`.
- [ ] Membre crée un débrief hebdo (stats process auto + 4 champs réflexion), le voit dans `/training/debrief` + timeline.
- [ ] Re-submit même semaine = upsert (1 row), pas de duplicate.
- [ ] Semaine 0 backtest → débrief possible + panneau « 0 backtest » pédagogique (jamais score-0 mensonger).
- [ ] Stats process exactes (4 familles) calculées depuis `TrainingTrade`/`TrainingAnnotation`, zéro P&L affiché.
- [ ] Eliot voit les débriefs en lecture seule dans `/admin/members/[id]?tab=training`.
- [ ] Crisis HIGH/MEDIUM → audit + Sentry escalate + persist + bannière FR (mirror REFLECT).
- [ ] Posture : aucune surface ne commente la qualité des analyses Lhedge ni n'affiche de P&L ; zéro conseil trade.
- [ ] Gate complet vert + audit-driven hardening (security-auditor frontière §21.5 + a11y wizard + code-reviewer + prisma-migration-runner).

### 23.6 Hors scope (explicite — anti scope-creep)

- **Annotation admin du débrief** (commentaire/capture/notif « correction reçue »/seen) → jalon §21.6 follow-up séparé éventuel (ce jalon = lecture admin seule).
- **Débrief mensuel** = jalon #2 distinct de la séquence §21.6 (cadrage `/spec` ultérieur dédié).
- **QCM athlète** (#3) + **Suivi-formation/cursus** (#4) = jalons #3/#4 distincts de la séquence.
- Stats avancées training (equity curve training, corrélation training) → V2 (déjà §21.6).
- Affichage de tout P&L backtest (`resultR`/`outcome`) dans le débrief → exclu par design (posture stricte, choix Eliot).
- TradingView interactif → ÉLIMINÉ définitivement (décision Eliot 2026-05-18, ne jamais re-proposer).

### 23.7 Invariants (NON négociables)

- Posture Mark Douglas / zéro conseil ni jugement des analyses Lhedge (SPEC §2, verrouillé). Système Lhedge INCONNU de l'assistant — ne JAMAIS l'inventer.
- **Intégrité statistique §21.5** : le débrief ne touche que `TrainingTrade`/`TrainingAnnotation` (training-scoped) ; l'edge réel ne reçoit JAMAIS rien du débrief ; le service ne `select` JAMAIS `resultR`/`outcome`. Test anti-fuite bloquant.
- `@db.Date` ⇒ `parseLocalDate`/`localDateOf` Europe/Paris, JAMAIS `toISOString().slice(0,10)` (invariant flake nocturne PR#96).
- Crisis routing FR + `safeFreeText` + `detectInjection` sur tout free-text (canon REFLECT).
- SPEC.md = source de vérité (cette §23 fait foi pour le jalon).
- Stack : Next.js 16 + React 19 TS strict + Prisma 7 + Auth.js v5 + **DS-v2 cyan training** (PAS `.v18-theme` = REFLECT only).
- Pattern Fxmily : backend-first, TDD logique critique, migration via `prisma-migration-runner`, audit-driven hardening, gate exit-codes-explicites, 1 PR atomic = 1 jalon, checkpoint + supersede.
- 1 session = 1 jalon : impl en session DÉDIÉE post-`/clear`.

### 23.8 Prochaine étape (recommandée)

1. Relire/ajuster §23 (10 min) — corriger ce qui ne correspond pas à ta vision.
2. Merger la doc-PR (SPEC §23) → `main`.
3. `/clear` → nouvelle session dédiée.
4. Dire : « Implémente SPEC §23 (Débrief Training dédié) — backend-first ».
5. Découpage suggéré (jalon atomique, ~12-16 fichiers) — **backend, DANS CET ORDRE** : migration `TrainingDebrief` (`prisma-migration-runner`, backup DB avant, jamais prod) → Zod `trainingDebriefSchema.strict()` (+ `weekStart` lundi/`parseLocalDate`, `weekEnd`=+6 j) → **agrégateur stats PUR D'ABORD** (fonction pure testée TDD, §21.5-sensible : ne `select` JAMAIS `resultR`/`outcome` ; mapping famille→champ §23.3 ; c'est la pièce à risque, la blinder avant l'UI) → service user-scoped → Server Action carbone `reflect/actions.ts` → audit slugs PII-free → tests TDD → STOP/confirm (backend-first canon) → **frontend** (`/training/debrief` landing + `/training/debrief/new` wizard cyan + panneau stats + admin read-only dans l'onglet training existant + Playwright auth-gates + happy-path). 1 PR atomic.

Pourquoi nouvelle session : le contexte d'interview pollue l'implémentation ; une session vierge avec §23 comme référence donne une qualité supérieure (pattern Anthropic interview-first, précédent §21 → J-T1..J-T4).

---

## 24. Changelog v1.2 → v1.3 (2026-05-18)

- **§23 ajoutée** : Débrief Training dédié (interview `/spec` 2026-05-18, 2 rounds, 6 questions). Décisions clés : entité `TrainingDebrief` **séparée** (mirror `WeeklyReview`, isolation §21.5 béton), cadence **hebdomadaire ancrée** lundi `@db.Date` idempotent `(userId, weekStart)`, structure **stats process auto + wizard réflexion Steenbarger**, posture **strict process — jamais de P&L** (jamais `resultR`/`outcome`), 4 familles de stats (volume & régularité · respect système · diversité · leçons & corrections) **calculées au render**, visibilité admin **lecture seule** dans l'onglet training existant (jalon atomique), **aucun nouveau couplage** edge réel, crisis routing + injection **mirror REFLECT carbone**, identité **cyan DS-v2** (PAS `.v18-theme`). Impl = jalon dédié post-`/clear`.
- **§21.6 mis à jour** : la séquence des 4 jalons différés est verrouillée (2026-05-18) ; TradingView interactif **éliminé définitivement** ; le 1ᵉʳ jalon (débrief training) renvoie désormais vers §23.
- Contexte : suit la complétion §21 Mode Entraînement 4/4 (J-T1..J-T4 #110→#113) + le hardening post-§21 (#114/#115/#130/#129). Le débrief training = jalon #1 de la séquence §21.6, nécessitait amendement SPEC avant tout code (pattern interview-first, précédent §21).
- Note traçabilité : l'en-tête du SPEC (ligne 5, « Version : 1.1 ») est resté désynchronisé depuis l'ajout de §21 (« spec V1.2 », end-marker « v1.2 »). Drift pré-existant **volontairement non corrigé ici** (hors-scope d'une doc-PR §23 ; un re-sync de l'en-tête mérite sa propre PR pour ne pas masquer le diff §23).

---

## 25. Débrief Mensuel IA dédié (spec V1.4 — 2026-05-19)

> Source : interview `/spec` 2026-05-19 (3 rounds, 11 questions, autonomie max). **Jalon #2 de la séquence §21.6** (4 jalons verrouillés 2026-05-18 : débrief training → débrief mensuel → QCM athlète → suivi-formation ; un `/spec` + un build chacun, `/clear` entre, jamais bundlés §18.4). HORS §21 V1.2 (différé explicite §21.6). **Impl = session dédiée post-`/clear`** (règle 1 session = 1 jalon §18.4). Réutilise le pipeline rapport hebdo IA V1.7/V1.7.2 (batch local Claude Max). Distinct du débrief training §23 (qui est écrit par le membre, zéro IA, hebdo, training-only).

### 25.1 Vision en 1 phrase

Une **synthèse IA mensuelle** (générée par batch local Claude Max — **jamais l'API payante**) du **mois civil écoulé**, **dual-audience** (le membre la lit pour prendre du recul, Eliot la voit en lecture seule pour le coaching), structurée en un narratif de **progression mois-sur-mois** + **deux sections strictement cloisonnées** — Trading réel + Pratique d'entraînement §21 (§21.5-safe : count/récurrence only, **jamais le P&L backtest**) — sans jamais donner de conseil de trade ni juger les analyses Lhedge (système inconnu de l'assistant, posture §2).

### 25.2 Décisions d'architecture (choix Eliot via interview, avec rationale)

| Décision | Choix validé | Rationale |
|---|---|---|
| Nature | **Synthèse IA générée** (PAS de rédaction membre) — réutilise le pipeline rapport hebdo IA V1.7.2 (batch local Claude Max), cadence mensuelle | Choix Eliot. Capitalise sur l'infra éprouvée (J8 + V1.7.2), coût marginal Anthropic 0€ (abonnement Max déjà payé). Distinct du débrief training §23 (membre-written, zéro IA). |
| API payante | **Exclue définitivement** — génération via batch local Claude Max uniquement | Contrainte dure Eliot (canon V1.7 : « REFUSE catégoriquement l'API Anthropic $-per-token »). Les 9 ban-risk mitigation rules V1.7 sont conservées. |
| Audience | **Dual** : le membre lit son débrief + Eliot le voit en lecture seule dans `/admin` | Choix Eliot (posture athlète + coach). **Un seul débrief généré** (pas 2 angles) ; la posture Mark Douglas s'applique au texte unique member-facing (zéro conseil trade, calme, anti Black-Hat). |
| Périmètre | **Dual cloisonné** : section Trading réel (P&L réel légitime — coaching admin du risque réel) + section Entraînement §21 (**§21.5-firewall : count/récurrence only, JAMAIS `resultR`/`outcome`/`plannedRR` backtest**) | Choix Eliot. Intégrité statistique §21.5 = thèse produit : le réel ne reçoit rien du training ; le training n'expose que l'effort (count/récence). Mirror exact de la primitive J-T4 `countRecentTrainingActivity`. |
| Source | **Synthèse des (≤4) `WeeklyReport` IA du mois + agrégats bruts du mois civil** | Choix Eliot. Capitalise sur les synthèses hebdo déjà générées (narratif de progression) tout en restant robuste si des semaines manquent (membre inactif → les agrégats bruts portent quand même la synthèse). |
| Cadence | **Mois civil** (1er → dernier jour, Europe/Paris), idempotent `(userId, monthStart)`, généré le 1er du mois suivant pour le mois écoulé | Choix Eliot. Modèle mental membre (« mon bilan de mai »), ré-consultable. Ancrage `parseLocalDate` Europe/Paris (canon, JAMAIS `toISOString().slice` / `getUTCDay` sur input naïf). |
| Entité | **`MonthlyDebrief` séparée** (mirror `WeeklyReport`) | Isolation §21.5 béton — aucune FK vers `Trade`/`WeeklyReport`/`TrainingTrade`/`BehavioralScore`. Cohérent doctrine entités séparées (TrainingTrade/WeeklyReview/TrainingDebrief). |
| Structure | **Spécifique mensuelle** : narratif de progression mois-sur-mois + section Trading réel + section Entraînement §21 (§21.5-safe) | Choix Eliot. Met en valeur la tendance (valeur ajoutée vs hebdo), respecte le cloisonnement par design. |
| Génération | **Pipeline mirror V1.7.2** : équivalent mensuel de `/sunday-batch` + endpoints `/api/admin/monthly-batch/{pull,persist}` (`X-Admin-Token`, mirror weekly-batch) | Pattern HTTP éprouvé (le runtime container standalone n'embarque pas tsx — leçon V1.7.2). Token séparé du weekly pour rotation indépendante. |
| Pseudonymisation | **`pseudonymizeMember` V1.5** au boundary Claude (8-char hex, jamais userId/email brut) | Canon RGPD + ban-risk mitigation V1.7. |
| Notif membre | **Push (`monthly_debrief_ready` nouveau `NotificationType`, mirror J9) + email membre (mirror template weekly-digest)** | Choix Eliot. Visibilité, calme (anti-FOMO, pas de fanfare). |
| Notif admin | **Aucun email admin mensuel** — Eliot consulte `/admin` en lecture seule (il a déjà le digest hebdo IA par email) | Choix Eliot : anti sur-notification d'Eliot. |
| Annotation admin | **Différée** — read-only ce jalon (mirror §23.6) | Choix Eliot. Garde le jalon ATOMIQUE (§18.4). L'annotation/notif « correction reçue » = jalon §21.6 follow-up séparé éventuel. |
| Couplage edge réel | **AUCUN nouveau** — le débrief mensuel ne nourrit NI score NI engagement NI trigger | Intégrité §21.5, canon §23. C'est un outil de recul (un read/synthèse), pas un input. |
| Crisis + injection | **Mirror V1.7.1 `batch.ts` carbone** : `detectCrisis` + `detectInjection` sur l'output IA concaténé AVANT persist ; HIGH/MEDIUM → **skip persist** + audit PII-free + Sentry escalate | Décidé (canon batch admin/IA). Le texte IA peut surfacer un signal de détresse depuis la data membre. ⚠️ C'est l'**output Claude** qui est scanné (skip persist comme le weekly batch admin), **PAS** le pattern REFLECT « persist-quand-même » (qui s'applique au texte écrit par le membre — ici rien n'est écrit par le membre). |
| Identité visuelle | **DS-v2** ; section Entraînement §21 = accent **cyan** (frontière §21 jamais floutée, §21.7) ; PAS `.v18-theme` | Invariant §21.7 (`.v18-theme` = REFLECT only). Discipline Mark Douglas : la frontière backtest/live reste visible même dans un débrief mixte. |
| EU AI Act | **Bannière transparence Article 50(1)** (« Généré par IA — pas substitut coaching humain ») sur la vue membre, la vue admin ET l'email (mirror `AIGeneratedBanner` V1.7.1) | Texte IA member-facing. Canon V1.7.1, deadline 2 août 2026. |

### 25.3 Modèle de données

- **`MonthlyDebrief`** (`monthly_debriefs`) : `userId`→User cascade, `monthStart` `@db.Date` (1er du mois local Europe/Paris ; `monthEnd` = dernier jour du mois, **service-computed SSOT anti-tamper**, jamais reçu du client). Output IA cloisonné : `progressionNarrative` (Text), `summaryReal` (Text), `summaryTraining` (Text), `risks` (Json array), `recommendations` (Json array), `patterns` (Json) — tous canon validation stricte. Cost tracking mirror `WeeklyReport` (`claudeModel`, token counts, `costEur` Decimal — batch local Claude Max ⇒ marginal 0€ mais conservé pour traçabilité/audit). État dispatch membre : `sentToMemberAt`, `sentToMemberEmail`, `pushEnqueuedAt` (**aucun** champ dispatch admin — pas d'email admin). `generatedAt`. **Unique `(userId, monthStart)`** (idempotency, upsert). Index `(userId, monthStart DESC)`. Cascade User delete (RGPD §17). **Aucune FK** vers `Trade`/`WeeklyReport`/`TrainingTrade`/`BehavioralScore` (isolation §21.5 par construction — les `WeeklyReport` du mois sont lus en **INPUT** par l'agrégateur, jamais liés en FK).
- **Agrégateur = pur, testable TDD, §21.5-sensible** : produit un `MonthlySnapshot` à **deux sections** — **(A) Réel** : agrégats du mois civil (trades réels outcome/R/expectancy, scores comportementaux, checkins, habitudes) + les ≤4 `WeeklyReport.summary` du mois en **contexte** ; **(B) Training §21** : **count-only** via la primitive `countRecentTrainingActivity` (canon J-T4) sur la fenêtre mois — nombre de backtests + jours civils distincts pratiqués + récence ; **JAMAIS** `resultR`/`outcome`/`plannedRR` (firewall §21.5). Le snapshot ne `select` JAMAIS un champ P&L backtest. Pseudonymisé au boundary Claude.
- Migration **additive** : 1 `CREATE TABLE` + 1 valeur enum `monthly_debrief_ready` sur `NotificationType` (`ALTER TYPE ADD VALUE`). `prisma-migration-runner` SAFE, rollback documenté runbook (nouvelle section après §18). **Carry-over prod** : ajoute 1 migration à la maintenance window Eliot.

### 25.4 Comportement attendu

- **Auto (cron mensuel)** : le 1er du mois (~XX UTC, ancre `now − Xj` multi-TZ-safe comme `computeReportingWeek`) → pour chaque membre `status='active'` : agrège le mois écoulé → snapshot 2 sections → `claude --print` batch local (mirror `/sunday-batch` mensuel) → Zod strict validate l'output → crisis/injection scan output → upsert `(userId, monthStart)` → enqueue push `monthly_debrief_ready` + email membre.
- **Membre** : `/debrief-mensuel` (landing — hero + timeline ~12 derniers mois) → ouvre le débrief du mois (lecture : narratif progression + section Trading réel + section Entraînement §21 §21.5-safe + bannière EU AI Act). **Pas de wizard** (rien à écrire — c'est une synthèse IA).
- **Admin** : onglet existant `/admin/members/[id]` → liste **read-only** des débriefs mensuels du membre (narratif + 2 sections recalculées/persistées) — **aucune action** (lecture seule ce jalon).
- **Edge cases** : mois 0 activité (0 trade réel, 0 backtest, 0 `WeeklyReport`) → débrief généré quand même avec cadrage pédagogique honnête « mois calme » (jamais « score 0 » mensonger, canon §21.4/§23.4) ; membre inscrit en cours de mois → couverture depuis la date d'inscription, IA informée de l'âge du compte (garde account-age canon J-T4) ; re-run cron même mois = upsert (1 row) ; un `MonthlyDebrief` n'apparaît JAMAIS dans `/journal`, dashboard, scoring, expectancy, corrélation Habit×Trade réels (filtres explicites + **test anti-fuite obligatoire**) ; semaines sans `WeeklyReport` → IA informée « semaine sans rapport (inactif) », les agrégats bruts portent quand même la synthèse ; suppression membre = cascade (RGPD).
- **Crisis** : output IA concaténé → `detectCrisis` ; HIGH/MEDIUM → audit `monthly_debrief.batch.crisis_detected` (level + matchedLabels, PII-free) + Sentry escalate (HIGH `reportError`, MEDIUM `reportWarning`) → **persist SKIPPED** (mirror V1.7.1 `batch.ts` — output IA/admin ⇒ skip ; ≠ REFLECT « persist-quand-même » qui ne s'applique qu'au texte écrit par le membre). Injection suspectée sur l'output → audit metadata + Sentry warning, **jamais bloquant**.
- **Erreurs** : Zod `safeParse` strict de l'output Claude (autorité, double-net mirror weekly batch) ; `monthStart` = 1er du mois local Europe/Paris matérialisé `@db.Date` UTC-minuit via `parseLocalDate` (canon — JAMAIS `toISOString().slice(0,10)` ni `getUTCDay()` sur input naïf, invariant §25.7) ; `monthEnd` service-computed SSOT ; userId pseudonymisé au boundary Claude ; active-user set re-check server-side (mirror weekly batch anti-forge).

### 25.5 Critères d'acceptation (testables)

- [ ] Migration `MonthlyDebrief` + valeur enum `monthly_debrief_ready` additive, `prisma-migration-runner` SAFE, rollback documenté runbook.
- [ ] **Test anti-fuite §21.5** : un `MonthlyDebrief` n'apparaît dans AUCUNE surface réelle (assertions explicites journal/dashboard/scoring/expectancy/corrélation) ; l'agrégateur ne `select` JAMAIS `resultR`/`outcome`/`plannedRR` backtest ; la section training = count/récurrence only.
- [ ] Agrégateur **PUR** testé TDD : snapshot 2 sections (réel + training §21.5-safe), ≤4 `WeeklyReport` ingérés en contexte, fenêtre mois civil Europe/Paris exacte.
- [ ] Cron mensuel génère 1 débrief / membre actif, idempotent `(userId, monthStart)` (re-run = upsert, pas de duplicate).
- [ ] Mois 0 activité → débrief généré + cadrage pédagogique « mois calme » (jamais score-0 mensonger).
- [ ] Pipeline batch local Claude Max (mirror V1.7.2 `/api/admin/monthly-batch/{pull,persist}`, `X-Admin-Token`, **jamais l'API payante**).
- [ ] Membre reçoit push `monthly_debrief_ready` + email ; lit le débrief sur sa page dédiée (narratif progression + section Réel + section Training §21.5-safe + bannière EU AI Act).
- [ ] Eliot voit les débriefs mensuels en **lecture seule** dans `/admin` ; **aucun** email admin mensuel.
- [ ] Crisis HIGH/MEDIUM sur output IA → **skip persist** + audit + Sentry escalate (mirror V1.7.1).
- [ ] Posture : aucune surface ne commente la qualité des analyses Lhedge ni n'affiche de P&L backtest ; zéro conseil trade ; bannière EU AI Act 50(1) présente (vue membre + admin + email).
- [ ] Gate complet vert + audit-driven hardening (security-auditor frontière §21.5 + a11y + code-reviewer + `prisma-migration-runner`).

### 25.6 Hors scope (explicite — anti scope-creep)

- **Annotation admin du débrief mensuel** (commentaire/notif « correction reçue »/seen) → jalon §21.6 follow-up séparé éventuel (ce jalon = lecture admin seule).
- **Digest admin mensuel par email** pour Eliot → exclu (choix Eliot : `/admin` read-only suffit, anti sur-notification).
- **Rédaction membre / wizard réflexion mensuel** → exclu (c'est une synthèse IA ; le débrief écrit par le membre est le débrief training hebdo §23).
- **QCM athlète (#3)** + **Suivi-formation/cursus (#4)** = jalons #3/#4 distincts de la séquence §21.6 (cadrage `/spec` ultérieur dédié chacun).
- **Visualisations/charts mois-sur-mois avancés** (equity curve mensuelle, graphes tendance détaillés) → V2 (le narratif IA + agrégats textuels suffisent V1.4).
- **Affichage de tout P&L backtest** (`resultR`/`outcome`/`plannedRR`) dans la section training → exclu par design (firewall §21.5, choix Eliot strict).
- **API Anthropic payante** → exclue définitivement (contrainte dure Eliot, canon V1.7 — batch local Claude Max only).

### 25.7 Invariants (NON négociables)

- Posture Mark Douglas / zéro conseil ni jugement des analyses Lhedge (SPEC §2, verrouillé). Système Lhedge INCONNU de l'assistant — ne JAMAIS l'inventer.
- **Intégrité statistique §21.5** : la section training du débrief = count/récurrence only ; l'agrégateur ne `select` JAMAIS `resultR`/`outcome`/`plannedRR` backtest ; l'edge réel ne reçoit JAMAIS rien du débrief. **Test anti-fuite bloquant.**
- **Jamais l'API Anthropic payante** : génération via batch local Claude Max uniquement (contrainte dure Eliot, canon V1.7 ; 9 ban-risk mitigation rules conservées).
- `@db.Date` ⇒ `parseLocalDate`/`localDateOf` Europe/Paris, JAMAIS `toISOString().slice(0,10)` ni `getUTCDay()` sur input naïf (invariant flake nocturne PR#96).
- Pseudonymisation `pseudonymizeMember` V1.5 au boundary Claude ; audit PII-free (RGPD §16) ; crisis/injection mirror V1.7.1 carbone (skip persist sur output IA).
- **Aucun nouveau couplage edge réel** : le débrief mensuel ne nourrit NI score NI engagement NI trigger (canon §23).
- SPEC.md = source de vérité (cette §25 fait foi pour le jalon).
- Stack : Next.js 16 + React 19 TS strict + Prisma 7 + Auth.js v5 + **DS-v2** (section training accent cyan §21.7 ; PAS `.v18-theme` = REFLECT only) + mobile-first PWA dark-only.
- Pattern Fxmily : backend-first, **agrégateur pur §21.5-sensible TDD-first AVANT le pipeline** (canon §23.8), migration via `prisma-migration-runner`, audit-driven hardening (security-auditor + code-reviewer + accessibility-reviewer + `prisma-migration-runner`), gate exit-codes-explicites, 1 PR atomic = 1 jalon, checkpoint + supersede.
- 1 session = 1 jalon : impl en session DÉDIÉE post-`/clear`.

### 25.8 Prochaine étape (recommandée)

1. Relire/ajuster §25 (10 min) — corriger ce qui ne correspond pas à ta vision.
2. Merger la doc-PR (SPEC §25) → `main`.
3. `/clear` → nouvelle session dédiée.
4. Dire : « Implémente SPEC §25 (Débrief Mensuel IA) — backend-first ».
5. Découpage suggéré en sous-jalons atomiques : **J-M1** agrégateur pur 2 sections §21.5-safe + `MonthlyDebrief` schema/migration + tests anti-fuite TDD · **J-M2** pipeline batch local Claude Max (`/api/admin/monthly-batch/{pull,persist}` + script mensuel + crisis/injection wire) · **J-M3** UI membre `/debrief-mensuel` + bannière EU AI Act + push/email · **J-M4** vue admin read-only + close-out. Découpage **indicatif** — le build session arbitre l'atomicité réelle (possible en 1 PR atomic si le périmètre tient, comme §23 → #132).

Pourquoi nouvelle session : le contexte d'interview pollue l'implémentation ; une session vierge avec §25 comme référence donne une qualité supérieure (pattern Anthropic interview-first, précédents §21 → J-T1..J-T4, §23 → #132).

---

## 26. Changelog v1.3 → v1.4 (2026-05-19)

- **§25 ajoutée** : Débrief Mensuel IA dédié (interview `/spec` 2026-05-19, 3 rounds, 11 questions). Décisions clés : **synthèse IA** générée (réutilise le pipeline rapport hebdo IA V1.7.2 batch local Claude Max, **jamais l'API payante**), cadence **mois civil** ancré Europe/Paris idempotent `(userId, monthStart)`, **dual-audience** (le membre lit + Eliot read-only `/admin`, **un seul débrief**), **dual-périmètre cloisonné** (section Trading réel + section Entraînement §21 **§21.5-safe count/récurrence only, jamais le P&L backtest**), source = **synthèse des ≤4 `WeeklyReport` IA du mois + agrégats bruts** (narratif progression mois-sur-mois), entité `MonthlyDebrief` **séparée** (mirror `WeeklyReport`, isolation §21.5 béton), notif **push `monthly_debrief_ready` + email membre** (pas de digest admin mensuel), annotation admin **différée** (read-only ce jalon), **aucun nouveau couplage** edge réel, crisis/injection **mirror V1.7.1 batch carbone** (skip persist sur output IA), bannière **EU AI Act 50(1)**, agrégateur **pur §21.5-sensible TDD-first**. Impl = jalon dédié post-`/clear`.
- **§21.6 mis à jour** : le jalon #2 (débrief mensuel) renvoie désormais vers §25 ; #3 (QCM athlète) / #4 (suivi-formation) restent à cadrer `/spec` (un chacun, jamais bundlés §18.4).
- Contexte : suit la complétion + le ship du jalon #1 §21.6 (Débrief Training dédié — spec §23 #131 `b4fdc07`, impl #132 `f48cde4`, doc-debt §18 #133 `02c2aba`). Le débrief mensuel = jalon #2 de la séquence §21.6 verrouillée, nécessitait un amendement SPEC avant tout code (pattern interview-first, précédents §21/§23).
- Note traçabilité : l'en-tête du SPEC (ligne 5) reste désynchronisé (drift pré-existant depuis §21, déjà noté §24) — **volontairement non corrigé ici** (hors-scope d'une doc-PR §25 ; un re-sync de l'en-tête mérite sa propre PR pour ne pas masquer le diff §25).

---

## 27. QCM athlète — auto-évaluation mindset hebdomadaire (spec V1.5 — 2026-05-19)

> Source : interview `/spec` 2026-05-19 (2 rounds, 7 questions, autonomie max + méta-délégation calibrée). **Jalon #3 de la séquence §21.6** (4 jalons verrouillés 2026-05-18 : débrief training → débrief mensuel → QCM athlète → suivi-formation ; un `/spec` + un build chacun, `/clear` entre, jamais bundlés §18.4). HORS §21 V1.2 (différé explicite §21.6). **Impl = session dédiée post-`/clear`** (règle 1 session = 1 jalon §18.4). Mirror patterns `TrainingDebrief` §23 (cadence hebdo ancrée lundi `@db.Date`, idempotent `(userId, weekStart)`, profil calculé au render, admin read-only) — instrument **100 % déterministe, zéro IA** (distinct du débrief mensuel IA §25).

### 27.1 Vision en 1 phrase

Un **auto-questionnaire mindset hebdomadaire court** (échelle type Likert, ~8-12 items, 2-3 min — **pas de bonne/mauvaise réponse**) où le membre s'auto-évalue sur les piliers psychologiques de l'athlète-trader (cadre Mark Douglas §7.6), produisant un **profil mental multi-dimensionnel et sa tendance dans le temps** — restitué au membre de façon **calme, strengths-based, ultra-visuelle et premium** (anti Black-Hat) et **visible en lecture seule par Eliot** pour le coaching — **100 % déterministe (zéro IA, zéro API)**, **totalement isolé** de l'edge réel et du score déterministe §7.11 (aucun nouveau couplage, canon §23/§25), sans jamais donner de conseil de trade ni juger les analyses Lhedge (système inconnu de l'assistant, posture §2).

### 27.2 Décisions d'architecture (choix Eliot via interview, avec rationale)

| Décision | Choix validé | Rationale |
|---|---|---|
| Nature | **Auto-évaluation mindset** (Likert, pas de bonne/mauvaise réponse) — PAS un test de connaissances, PAS un gate de certification | Choix Eliot explicite (R1). Objectif verbatim : « max de data récurrente pour le meilleur suivi, l'aider, l'améliorer ». Capture le ressenti psychologique du membre = matière première coaching §3. |
| Cadence | **Hebdomadaire ancrée** lundi `@db.Date`, idempotent `(userId, weekStart)`, upsert au re-submit | Choix Eliot (R2). Mirror EXACT `TrainingDebrief`/`WeeklyReview` (pattern éprouvé, zéro invention). Hebdo court = max de data longitudinale fine sans fatigue de questionnaire (remise en question §27 : un instrument long passé fréquemment ⇒ réponses non fiables). Ancrage Europe/Paris via `parseLocalDate` (invariant anti-drift `@db.Date` PR#96). |
| Longueur instrument | **Court : ~8-12 items fermés, échelle Likert 1-5**, ~2-3 min | Décidé (méta-délégation, rationale qualitatif) : la fiabilité psychométrique d'un instrument répété tient à sa brièveté + sa stabilité. Échelle 1-5 = charge cognitive minimale, mobile-first. |
| Entité | **`MindsetCheck` séparée** (mirror `TrainingDebrief`/`WeeklyReport`) | Isolation §21.5 béton — aucune FK vers `Trade`/`BehavioralScore`/`TrainingTrade`/`WeeklyReport`. Cohérent doctrine entités séparées (canon §21/§23/§25). |
| Provenance des items | **Instrument statique versionné** (`instrumentVersion`), écrit par Claude Code à l'impl + **validé par Eliot**, en code (PAS de CRUD admin) | Décidé (méta-délégation, remise en question §27). Validité longitudinale = l'instrument doit être STABLE entre passations ; questions éditables en admin ⇒ dérive ⇒ comparaison temporelle cassée. Mirror le canon « ~50-100 fiches MD §7.6 écrites à l'impl, validées Eliot ». Comparaison de tendance **intra-`instrumentVersion` uniquement**. |
| Dimensions mesurées | **Piliers Mark Douglas §7.6** (set proposé §27.3, à ajuster par Eliot à la relecture — son domaine de coach) | Dérivées du cadre explicite de l'app (§2/§7.6) + voisines conceptuelles des 4 dims déterministes §7.11 mais **distinctes** (auto-perçu ≠ mesuré). Eliot valide/ajuste le set à l'étape §27.8.1. |
| Couplage scoring/engagement | **AUCUN nouveau couplage** — le QCM ne nourrit NI `BehavioralScore` §7.11 NI engagement NI trigger | Décidé (méta-délégation, remise en question §27). Injecter de l'auto-déclaratif subjectif dans le score **déterministe** (thèse produit §7.11) le corromprait. Canon §23/§25 « aucun nouveau couplage ». Le QCM est un instrument de recul/connaissance, pas un input du moteur. |
| Génération | **100 % déterministe — ZÉRO IA, zéro pipeline, zéro API** | Décidé (méta-délégation R2). Garde le jalon atomique (§18.4), zéro coût, zéro bannière EU AI Act, zéro surface crisis-sur-output-IA. La data `MindsetCheck` devient un **INPUT disponible** pour la synthèse mensuelle IA §25 dans un jalon ultérieur (pas de nouveau pipeline ici, isolation préservée). « Plus » ≠ mieux : la bonne archi = instrument pur + réutilisation du pipeline §25 déjà construit. |
| Free-text | **Aucun champ libre v1 — instrument 100 % fermé (Likert only)** | Décidé. « QCM » = choix multiples par définition. Zéro free-text ⇒ zéro surface `detectCrisis`/`detectInjection`/`safeFreeText` (jalon plus atomique). La réflexion écrite guidée = le rôle du **débrief training §23** (wizard Steenbarger), pas du QCM. Champ réflexif = explicitement hors-scope (§27.6). |
| Restitution membre | **Calme, strengths-based, ULTRA-VISUELLE et premium** (radar multi-dimensions + courbes de tendance + texte structuré, animations premium) ; anti Black-Hat | Choix Eliot (R2, verbatim « max de data visuel, schéma/graphique, ultra design, animation premium, ultra structuré »). Cadre Steenbarger strengths-based (canon §23) : jamais « score nul » mensonger, jamais fanfare/streak/classement. Recharts (stack §4/§20.1) + Framer Motion (§8.3) + DS-v2. |
| Visibilité admin | **Lecture seule** dans `/admin/members/[id]` (section dédiée, mirror §23/§25 « aucune action ») | Choix Eliot (objectif « le meilleur suivi »). Garde le jalon ATOMIQUE (§18.4). L'annotation/notif sur le QCM = follow-up §21.6 séparé éventuel. |
| Notif membre | **Push `mindset_check_ready` (nouveau `NotificationType`, mirror J9) — rappel hebdo doux** ; PAS d'email | Décidé (méta-délégation, calme/anti-FOMO canon §7.9/§23). Rappel non culpabilisant ; le rituel hebdo se suffit dans l'app, anti sur-notification. |
| Identité visuelle | **DS-v2 neutre** — **PAS de cyan §21.7, PAS de `.v18-theme`** | Décidé : l'accent cyan §21.7 est le marqueur frontière du **mode entraînement §21 uniquement** ; le QCM est un instrument de psychologie neutre (ni réel ni training). `.v18-theme` = REFLECT only (invariant). |
| Couplage edge réel / training | **AUCUN** — le QCM ne touche ni `Trade` ni `TrainingTrade` ; §21.5 trivialement satisfait (0-FK, ne `select` jamais aucun P&L) | Intégrité §21.5 canon. Instrument psychologique pur, orthogonal au réel et au training. |

### 27.3 Modèle de données

- **`MindsetCheck`** (`mindset_checks`) : `userId`→User cascade, `weekStart` `@db.Date` (lundi local Europe/Paris ; `weekEnd` = `weekStart + 6 j` **service-computed SSOT anti-tamper**, jamais reçu du client), `instrumentVersion` (Int — version de l'instrument figé en code), `responses` (Json — map `itemId → valeur Likert 1-5`, validée Zod strict contre le schéma de la version d'instrument), `createdAt`/`updatedAt`. **Unique `(userId, weekStart)`** (idempotency, upsert). Index `(userId, weekStart DESC)`. Cascade User delete (RGPD §17). **Aucune FK** vers `Trade`/`TrainingTrade`/`WeeklyReport`/`BehavioralScore` (isolation §21.5 par construction — le QCM est psychologie pure, orthogonale).
- **Instrument figé en code, versionné** : `lib/mindset/instrument.ts` exporte l'instrument courant = liste d'items `{ id, dimension, libellé FR, ancrage Likert 1-5 }`, écrit par Claude Code à l'impl, **validé par Eliot**. Tout changement d'items ⇒ **bump `instrumentVersion`** (les tendances ne se comparent qu'intra-version — intégrité longitudinale).
- **Profil = calculé au render, jamais stocké** : agrégateur **PUR** (testable TDD) mappant `responses` → score par dimension (moyenne normalisée 0-100 des items de la dimension, recompute-safe, idempotent). Set proposé (cadre Mark Douglas §7.6, **à ajuster Eliot §27.8.1**) : (1) **Acceptation de l'incertitude / pensée probabiliste** ; (2) **Détachement résultat & ego** ; (3) **Discipline & respect du plan (auto-perçu)** ; (4) **Régulation émotionnelle / gestion du tilt** ; (5) **Confiance vs sur-confiance** ; (6) **Patience & anti-FOMO**. ~2 items/dimension ⇒ ~12 items. Aucune dimension ne porte de notion de « réussite/échec ».
- Migration **additive** : 1 `CREATE TABLE` + 1 valeur enum `mindset_check_ready` sur `NotificationType` (`ALTER TYPE ADD VALUE`). `prisma-migration-runner` SAFE, rollback documenté runbook (nouvelle section après §19). **Déploiement prod = automatique** via `deploy.yml` (CI/CD `DEPLOY_PATH=hetzner` → `prisma migrate deploy` sur push `main`, vérifié 2026-05-19) — **plus de carry-over manuel** (canon « maintenance window » §23/§25 corrigé : le pipeline applique les migrations au merge).

### 27.4 Comportement attendu

- **Membre** : `/mindset` (landing — hero + dashboard premium ultra-visuel : radar du profil de la semaine + courbes de tendance multi-semaines par dimension + lecture strengths-based structurée + timeline ~12 dernières passations) → `/mindset/new` (instrument hebdo court de la semaine courante : ~8-12 items Likert 1-5, barre de progression, mobile-first) → submit → upsert `(userId, weekStart)` → redirect landing `?done=1` (calm reveal, anti Black-Hat : pas de XP/streak/score-shaming/fanfare).
- **Admin** : `/admin/members/[id]` → section **read-only** listant les `MindsetCheck` du membre (profil + tendance recalculés) — **aucune action** (lecture seule ce jalon).
- **Edge cases** : 0 passation passée → état vide pédagogique (jamais « score 0 » mensonger, canon §21.4/§23.4) ; re-submit même semaine = upsert (1 row) ; **changement d'`instrumentVersion`** ⇒ les courbes de tendance segmentent par version (jamais comparer entre versions — intégrité psychométrique) ; semaine sans passation = trou honnête dans la tendance (jamais extrapolé) ; suppression membre = cascade (RGPD) ; un `MindsetCheck` n'apparaît JAMAIS dans `/journal`, dashboard, scoring, expectancy, corrélation Habit×Trade réels, ni dans aucune surface training (filtres explicites + **test anti-fuite obligatoire**).
- **Erreurs** : Zod `safeParse` strict du payload serveur (autorité) — chaque `itemId` doit appartenir au schéma de l'`instrumentVersion` courante, chaque valeur ∈ {1..5}, instrument complet requis (refus serveur + message clair sinon) ; `weekStart` = un **lundi local Europe/Paris** matérialisé `@db.Date` UTC-minuit via `parseLocalDate` (canon `WeeklyReview`/`TrainingDebrief` — JAMAIS `getUTCDay()` ni `toISOString().slice(0,10)` sur input naïf, invariant §27.7), fenêtre bornée `[-35 j, +7 j]` ; `weekEnd` service-computed (SSOT anti-tamper).

### 27.5 Critères d'acceptation (testables)

- [ ] Migration `MindsetCheck` + valeur enum `mindset_check_ready` additive, `prisma-migration-runner` SAFE, rollback documenté runbook.
- [ ] **Test anti-fuite §21.5** : un `MindsetCheck` n'apparaît dans AUCUNE surface réelle ni training (assertions explicites journal/dashboard/scoring/expectancy/corrélation/training) ; entité 0-FK ; ne nourrit NI `BehavioralScore` NI engagement NI trigger.
- [ ] Agrégateur de profil **PUR** testé TDD : `responses` → score 0-100 par dimension, recompute-safe, idempotent, mapping item→dimension exact §27.3.
- [ ] Instrument **versionné** : bump `instrumentVersion` sur changement d'items ; tendance comparée intra-version uniquement (test de segmentation).
- [ ] Membre passe l'instrument hebdo court (Likert 1-5), le voit dans `/mindset` + dashboard premium (radar + tendances + lecture strengths-based) + timeline.
- [ ] Re-submit même semaine = upsert (1 row), pas de duplicate.
- [ ] 0 passation → état vide pédagogique (jamais score-0 mensonger) ; semaine manquante = trou honnête (jamais extrapolé).
- [ ] Restitution **calme strengths-based** (anti Black-Hat : zéro fanfare/streak/classement/score-shaming) ET **ultra-visuelle premium** (Recharts radar + courbes tendance + Framer Motion + DS-v2, mobile-first iPhone SE/15).
- [ ] Eliot voit les `MindsetCheck` en **lecture seule** dans `/admin/members/[id]` ; aucun couplage scoring.
- [ ] Push `mindset_check_ready` rappel hebdo doux ; **pas d'email** ; pas de fanfare.
- [ ] **Zéro IA / zéro API / zéro pipeline** ; **zéro free-text** (instrument 100 % fermé) ⇒ pas de surface crisis/injection ; pas de bannière EU AI Act (rien généré par IA).
- [ ] Posture : aucune surface ne commente la qualité des analyses Lhedge ni n'affiche de P&L ; zéro conseil trade.
- [ ] Gate complet vert + audit-driven hardening (security-auditor frontière §21.5 + 0-couplage + accessibility-reviewer **dont a11y des charts** : jamais information couleur-seule, équivalents texte, WCAG 2.2 AA + ui-designer qualité premium + code-reviewer + `prisma-migration-runner`).

### 27.6 Hors scope (explicite — anti scope-creep)

- **Synthèse IA du mindset** (narration de l'évolution) → exclu v1 (instrument déterministe pur, choix tranché). La data `MindsetCheck` = **INPUT futur** pour la synthèse mensuelle IA §25 (jalon ultérieur, pas de nouveau pipeline ici).
- **Champ réflexif libre / wizard d'écriture** → exclu (c'est le rôle du débrief training §23 Steenbarger). Le QCM est 100 % fermé ⇒ pas de surface crisis/injection.
- **Couplage au `BehavioralScore` §7.11 / engagement / triggers** → exclu par design (intégrité du score déterministe, canon §23/§25).
- **CRUD admin des questions** → exclu (instrument figé versionné = validité longitudinale ; édition libre = dérive).
- **Annotation admin du QCM** (commentaire/notif « correction reçue »/seen) → follow-up §21.6 séparé éventuel (ce jalon = lecture admin seule).
- **Gate « prêt à trader live » / certification / notion de réussite-échec** → exclu (auto-évaluation sans bonne réponse, choix Eliot R1).
- **Email membre / digest** → exclu (push doux suffit, anti sur-notification).
- **QCM adaptatif, item-response-theory, branching** → V2 (instrument fixe court v1).
- **Suivi-formation/cursus (#4)** = jalon #4 distinct de la séquence §21.6 (cadrage `/spec` ultérieur dédié, jamais bundlé §18.4).

### 27.7 Invariants (NON négociables)

- Posture Mark Douglas / zéro conseil ni jugement des analyses Lhedge (SPEC §2, verrouillé). Système Lhedge INCONNU de l'assistant — ne JAMAIS l'inventer.
- **Intégrité statistique §21.5 + score déterministe §7.11** : `MindsetCheck` entité 0-FK ; ne nourrit JAMAIS `BehavioralScore`/engagement/trigger/edge réel/training ; ne `select` JAMAIS aucun P&L réel ou backtest. Test anti-fuite bloquant.
- **Validité longitudinale** : instrument figé **versionné** ; tendance comparée intra-`instrumentVersion` uniquement.
- **100 % déterministe** : zéro IA, zéro API Anthropic (payante ou batch), zéro pipeline — donc pas de bannière EU AI Act (rien généré par IA). Si une synthèse IA est voulue un jour, elle passera par le pipeline §25 existant (jalon séparé).
- `@db.Date` ⇒ `parseLocalDate`/`localDateOf` Europe/Paris, JAMAIS `toISOString().slice(0,10)` ni `getUTCDay()` sur input naïf (invariant flake nocturne PR#96).
- Anti Black-Hat (canon §23) : restitution calme strengths-based ; jamais « score nul » mensonger, fanfare, streak, classement, score-shaming.
- DS-v2 **neutre** : PAS de cyan §21.7 (= mode training only), PAS de `.v18-theme` (= REFLECT only).
- SPEC.md = source de vérité (cette §27 fait foi pour le jalon).
- Stack : Next.js 16 + React 19 TS strict + Prisma 7 + Auth.js v5 + DS-v2 + Recharts + Framer Motion + mobile-first PWA dark-only.
- Pattern Fxmily : backend-first, **agrégateur de profil pur TDD-first AVANT l'UI** (canon §23.8/§25.8 — pièce à risque blindée d'abord), migration via `prisma-migration-runner`, audit-driven hardening (security-auditor + accessibility-reviewer + ui-designer + code-reviewer + `prisma-migration-runner`), gate exit-codes-explicites, 1 PR atomic = 1 jalon, checkpoint + supersede.
- 1 session = 1 jalon : impl en session DÉDIÉE post-`/clear`.

### 27.8 Prochaine étape (recommandée)

1. Relire/ajuster §27 (10 min) — **en particulier le set de dimensions §27.3 et les items de l'instrument (ton domaine de coach)** : corriger ce qui ne correspond pas à ta vision.
2. Merger la doc-PR (SPEC §27) → `main`.
3. `/clear` → nouvelle session dédiée.
4. Dire : « Implémente SPEC §27 (QCM athlète) — backend-first ».
5. Découpage suggéré (jalon atomique, ~12-16 fichiers) — **backend, DANS CET ORDRE** : migration `MindsetCheck` + enum (`prisma-migration-runner`, backup DB avant, jamais prod) → instrument figé versionné `lib/mindset/instrument.ts` (items validés Eliot) → Zod `mindsetCheckSchema.strict()` (validation item↔version + Likert 1-5 + `weekStart` lundi `parseLocalDate` + `weekEnd`=+6 j) → **agrégateur de profil PUR D'ABORD** (fonction pure testée TDD : `responses`→score/dimension, segmentation par version ; c'est la pièce à risque) → service user-scoped → Server Action carbone `training-debrief`/`reflect` → audit slugs PII-free → tests TDD anti-fuite → STOP/confirm (backend-first canon) → **frontend** (`/mindset` landing + dashboard premium Recharts radar+tendances + `/mindset/new` instrument + admin read-only section + Playwright auth-gates + happy-path). 1 PR atomic.

Pourquoi nouvelle session : le contexte d'interview pollue l'implémentation ; une session vierge avec §27 comme référence donne une qualité supérieure (pattern Anthropic interview-first, précédents §21 → J-T1..J-T4, §23 → #132, §25 → #135).

---

## 28. Changelog v1.4 → v1.5 (2026-05-19)

- **§27 ajoutée** : QCM athlète — auto-évaluation mindset hebdomadaire (interview `/spec` 2026-05-19, 2 rounds, 7 questions + méta-délégation calibrée). Décisions clés : **auto-évaluation mindset** (Likert, pas de bonne/mauvaise réponse), cadence **hebdomadaire ancrée** lundi `@db.Date` idempotent `(userId, weekStart)` (mirror §23), instrument **court ~8-12 items, statique versionné** (validité longitudinale ; écrit à l'impl + validé Eliot ; PAS de CRUD admin), entité `MindsetCheck` **séparée** (0-FK, isolation §21.5 béton), **aucun nouveau couplage** (ne nourrit NI `BehavioralScore` §7.11 NI engagement NI trigger — intégrité du score déterministe), **100 % déterministe (zéro IA / zéro API / zéro pipeline / zéro bannière EU AI Act)** — la data devient un INPUT futur de la synthèse mensuelle IA §25, **zéro free-text** (instrument fermé ⇒ pas de surface crisis/injection), restitution membre **calme strengths-based ET ultra-visuelle premium** (Recharts radar+tendances + Framer Motion + DS-v2, anti Black-Hat), visibilité admin **lecture seule**, push `mindset_check_ready` doux **sans email**, DS-v2 **neutre** (PAS cyan §21.7, PAS `.v18-theme`). Impl = jalon dédié post-`/clear`.
- **§21.6 mis à jour** : le jalon #3 (QCM athlète) renvoie désormais vers §27 ; #4 (suivi-formation/cursus) reste à cadrer `/spec` (un `/spec` + un build, jamais bundlé §18.4).
- Contexte : suit le ship du jalon #2 §21.6 (Débrief Mensuel IA — spec §25 #134 `0ce2f79`, impl #135 `3603954` auto-déployé prod 2026-05-19T15:12:24Z). Le QCM athlète = jalon #3 de la séquence §21.6 verrouillée, nécessitait un amendement SPEC avant tout code (pattern interview-first, précédents §21/§23/§25).
- Note traçabilité : l'en-tête du SPEC (ligne 5) reste désynchronisé (drift pré-existant depuis §21, déjà noté §24/§26) — **volontairement non corrigé ici** (hors-scope d'une doc-PR §27 ; un re-sync de l'en-tête mérite sa propre PR pour ne pas masquer le diff §27).

---

## 29. Changelog v1.5 → v1.6 (2026-05-27)

- **Pipeline auto-pilote DD→MM** : séquence de 10 jalons §18.4 strict (1 session = 1 jalon, `/clear` entre chaque) couvrant V2.3 base hardening + extensions analytics + correlation + 4 jalons suivants. **6/10 SHIPPED** au 2026-05-27 — DD #1 hardening + EE drift-resync + FF pivot V2.3.2 + GG E2E + HH analytics + II correlation. **4 restantes** : JJ Mark Douglas card auto-delivery trigger (5 `fomo` 7d → fiche peur-de-rater) / KK EmptyState DS adoption `/review` + `/reflect` / LL Admin tab `/admin/members/[id]?tab=pre-trade` vue pseudonymisée / MM JWT `tokenVersion` Int + Auth.js session callback révocation immédiate.
- **V2.3 base** ship Session BB+CC (PR #178 `602787c` 2026-05-26T14:29:25Z) : pre-trade circuit breaker anti-FOMO wizard 4-step + auto-link no-FK race-safe P2025 + ADR-003 evidence Gollwitzer if-then meta d=0.65 PMC4500900 + Mark Douglas 4 fears + Steenbarger boredom extension + Russell 1989 affect grid 2×2 ; migration `20260526100000_v2_3_pre_trade_check` 2 enums + 1 table closed instrument zéro free-text ; audit slug `pre_trade_check.created` PII-FREE.
- **V2.3.1 hardening** Session DD #1 (PR #179 `3404e29`) : sec `passwordSchema.max(256)` argon2id CWE-400 DoS mirror + perf `optimizePackageImports: ['lucide-react']` ~10-30KB First Load JS + a11y `id="ptw-heading"` aria-labelledby wizard form.
- **V2.3.2 nits** Session FF pivot (PR #181 `1136380`) : dead `useEffect` retiré + comment fix + `revalidatePath` inutile retiré post-investigation react-email v6 migration AVORT (researcher Round 2 hallucination détectée — v6 = CLI dev-server ≠ bundle). **Scar O3 re-grep tool-confirmed avant migration deps** = nouveau canon documenté.
- **Session GG E2E** (PR #182 `a54d90b`) : Playwright `apps/web/tests/e2e/v2-3-pre-trade-happy-path.spec.ts` 7 tests / 4 phases anti-régression V2.3 surface. **Scar GG-CI nouveau canon** : replica auto-link inline car `service.ts:1 'server-only'` incompatible Playwright runtime. ADR-003 status Proposed → **Accepted** post-#178/#179/#181/#182.
- **Session HH pre-trade analytics 30j** (PRs #184 `7fb02b2` backend + #185 `2063326` frontend) : module pur `analytics.ts:1-172` (0 DB / 0 Date.now() / 0 `'server-only'` Playwright-importable) ; `MIN_SAMPLE_PRE_TRADE_ANALYTICS=8` ; discriminated union `ReasonDistributionResult`/`RateResult` branche `insufficient_data` structurellement n'expose pas distribution/rate (compile-time honesty) ; 4 buckets `{edge, fomo, revenge, boredom}` single-pass ; widget Server Component tone `acc` UNIQUEMENT sur `edge` Yu-kai Chou anti-Black-Hat ; wire `/dashboard` après `<PreTradeCheckBanner>`.
- **Session II pre-trade × outcome correlation** (PRs #186 `ad5bdb5` backend + #187 `4dd8616` frontend LIVE prod 2026-05-27T08:15:29Z) — **TIER 0 différenciateur Fxmily LIVE** : correlation per-reason 4 buckets indépendants no Pearson/Spearman (variable catégorielle × outcome) ; `MIN_SAMPLE_PER_REASON_CORRELATION=8` floor PER REASON ; `PerReasonStats` discriminated union ok expose `winRate+lossRate+breakEvenRate+avgRealizedR+avgRSampleSize≠sampleSize` transparence ; pair-up 2 Prisma queries + JS merge no-FK race-safe P2025 + defensive skip dangling rows ; em-dash null `formatRMagnitude` ; win-rate JAMAIS rouge ; aucune comparaison auto edge>fomo (membre interprète) ; 16 tests Vitest TDD.
- **Patterns drift-resync** (PRs #180 `3587089` Session EE + #183 `ef37f4e` Session HH-pre) : 6ème + 7ème jalon ops "drift resync" §18.4 (carbone Sessions N/O/P/Q/AA). 0 deploy paths-ignore.
- **Tests baseline** : Vitest → **1618/1618 verts** post V2.4 onboarding + §8 (107 files, run live 2026-05-29). E2E Playwright 20 specs.
- **Décisions d'âme M1-M10** : 10/10 closed verbatim Eliot 2026-05-27 — M4/M5/M6 LIVRÉS V1.7-V1.8 ; **M3 LIVRÉ V2.4** (onboarding interview Phases A-C LIVE 2026-05-28 — profilage IA deep + profil par membre) ; **M8** (promesse 12 sem = discipline ↑ + erreurs psy ↓ + routines + entraînement + résultats réels ; tracker max data via QCM/tests récurrents auto-rapport) = **seule directive restante à implémenter** ; M1/M2/M7/M9/M10 = **out-of-scope app** (interne, projet Scale séparé).
- **Cadre interne légal clarifié** : app interne, membres déjà payants, partie légale traitée en amont (disclaimer "pas conseiller en investissement"), flow accès = membre fait demande + crée compte → admin (Eliot) confirme.
- **Trajectoire restante post-MM** : 3 voies V2 stratégiques A (Capacitor iOS+Android, DEFERRED Session U, pas de refactor REST nécessaire — WebView shell hybride), B (Stripe billing, DEFERRED), C (Multi-admin, DEFERRED). M3 onboarding interview IA + M8 axes 3+4 (formation + market analysis tracking) à câbler avant V2 stratégique.

---

**Fin du SPEC v1.6**
