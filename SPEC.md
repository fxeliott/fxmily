# SPEC — Fxmily App

**Date** : 2026-05-05
**Auteur** : Eliot Pena (interview structuré avec Claude Code, skill `/spec`)
**Version** : 1.0 (initiale, à valider avant implémentation)
**Statut** : Brouillon — à relire et amender par Eliot avant `/clear` + nouvelle session d'implémentation

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
| **Frontend / Backend** | Next.js 15 (App Router) + React 19 + TypeScript strict | Un seul codebase web + mobile (via PWA puis Capacitor), énorme écosystème, support IA optimal |
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
> Cf. `docs/jalon-2-prep.md` → "Décisions produit prises pendant la session J2"
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
| Stack frontend | Next.js 15 + Capacitor (V2) | Eliot a délégué, c'est le meilleur ratio qualité/effort pour un débutant |
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
| Rapport IA hebdo | Sonnet 4.6 admin uniquement | Eliot a choisi, ~5€/mois |
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

**Fin du SPEC v1.0**
