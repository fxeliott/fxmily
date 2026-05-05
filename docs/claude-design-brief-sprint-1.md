# Brief Claude Design — Sprint #1 Fxmily

> **Usage** : ce fichier est destiné à être collé (en partie ou en intégralité)
> dans la première conversation Claude Design sur `claude.ai/design`.
> Il sert de "system prompt" pour aligner Claude Design sur la vision Fxmily,
> la palette, les contraintes a11y / mobile, et les écrans à designer.
>
> Voir `docs/claude-design-guide-eliot.md` pour le mode d'emploi pas-à-pas.

---

## Contexte produit

Fxmily est une **PWA web** (Progressive Web App) de **suivi comportemental
ultra-poussé** des membres de la formation de trading **Fxmily** d'Eliot.

**Posture explicite et non-négociable** :

- ❌ **Pas de conseil sur les analyses de trade** (pas de setups, pas de tendances, pas de prévisions de marché)
- ✅ Conseils autorisés sur l'**exécution** (sessions respectées, hedge, plan de trading, discipline)
- ✅ Conseils autorisés sur la **psychologie** (framework Mark Douglas, citations courtes en fair use)

**Public cible** : 30 membres au lancement → 100 à moyen terme → potentiellement plusieurs milliers à long terme. Le design doit donner une impression de **qualité haut de gamme**, comme une app de suivi pro pour athlètes.

**Principe directeur "athlète professionnel"** : l'app traite chaque membre comme un athlète de haut niveau. Tracking exhaustif (performance trading + paramètres physiques + état mental + discipline). Le visuel doit refléter cette discipline — précis, dense, lisible, sans bruit.

---

## Stack technique (à respecter)

| Couche        | Choix                                                  |
| ------------- | ------------------------------------------------------ |
| Frontend      | Next.js 16 (App Router) + React 19 + TypeScript strict |
| CSS           | Tailwind CSS 4                                         |
| Composants UI | shadcn/ui (style "new-york")                           |
| Animations    | Framer Motion (déjà installé v12.38)                   |
| Charts        | Tremor (basé Recharts) — sera installé au Jalon 6      |
| Icônes        | lucide-react                                           |
| Mode          | **Dark only en V1** (pas de light mode)                |

Le repo GitHub : `fxeliott/fxmily` — Claude Design peut le lire pour extraire le design system existant.

---

## Palette de couleurs (V1, à enrichir si pertinent)

```text
--background: #0a0e1a            (noir bleuté profond)
--foreground: #e8ecf4            (blanc cassé)
--primary: #2563eb               (bleu vif)
--primary-foreground: #ffffff
--secondary: #1e293b             (gris bleu)
--accent: #3b82f6                (bleu plus clair)
--muted: #94a3b8                 (gris, WCAG AA contrast)
--muted-foreground: #cbd5e1
--card: #0f1525                  (card background)
--success: #10b981               (vert — gains)
--warning: #f59e0b               (orange — états en attente)
--danger: #ef4444                (rouge — pertes)
--border: rgba(99, 102, 241, 0.15)
```

**Liberté créative** : tu peux ajouter des couleurs secondaires (gradients, glows, accents pour effets visuels) à condition de **rester cohérent** avec la base bleu/noir et de garder un contraste WCAG AA minimum (4.5:1 sur texte ≥ 14px, 3:1 sur texte large ≥ 18px).

---

## Typographie

- **Headings** : Inter Display (variable font, free Google Fonts)
- **Body** : Inter (variable)
- **Mono** : JetBrains Mono (pour les chiffres trading — `font-mono tabular-nums` partout sur les prix, lots, R réalisé)

Hiérarchie attendue :

- H1 : `text-3xl sm:text-4xl tracking-tight font-semibold`
- H2 (section title) : `text-xs uppercase tracking-widest text-muted` — labels minimalistes
- Body : `text-sm` (mobile par défaut), `text-base` (desktop)
- Mono : tabular-nums systématiquement sur les chiffres trading

---

## Contraintes mobile-first

**Cibles prioritaires** :

- iPhone SE 375 × 667 (le plus petit qu'on supporte)
- iPhone 15 393 × 852

**Règles** :

- Touch targets ≥ 44 × 44 px (Apple HIG, et WCAG AAA)
- Pas de hover-only : tout doit être utilisable sans curseur
- Sticky bottom navs avec `safe-area-inset-bottom` (iOS notch)
- Pas de horizontal scroll involontaire
- Wizards multi-étapes : 1 question par écran sur mobile, regroupé sur desktop

---

## Contraintes accessibilité (WCAG 2.2 AA strict)

- Focus visible (rings bleu accent, jamais juste outline none)
- `prefers-reduced-motion: reduce` honoré (animations Framer Motion conditionnelles via `useReducedMotion()`)
- Labels associés aux inputs (`htmlFor` / `id`)
- ARIA pour les composants custom (radiogroup, tabs, alerts)
- Contraste vérifié au pixel près
- Lecteurs d'écran (NVDA / VoiceOver / TalkBack) doivent annoncer correctement les états dynamiques

---

## Écrans déjà existants à élever (Sprint #1)

> **9 écrans déjà codés** en Tailwind direct. Claude Design doit les analyser
> via le repo GitHub et proposer une élévation premium pour chacun.

### J0 — Splash / accueil public

**Route** : `/`
**Fichier source** : `apps/web/src/app/page.tsx`

**État actuel** : splash placeholder avec logo + titre.

**Élévation souhaitée** :

- Hero animé (gradient mesh ou particles subtiles bleu nuit)
- Logo Fxmily avec micro-animation à l'apparition (scale + fade)
- Tagline en typo expressive ("Le suivi comportemental des athlètes de la finance")
- CTA "Se connecter" → `/login`
- Mention "Sur invitation uniquement" en footer (pas de signup public)
- Vibe : **Apple Sport / Linear / Stripe**, pas une page marketing fade

### J1 — Login

**Route** : `/login`
**Fichier source** : `apps/web/src/app/login/page.tsx` + `login-form.tsx`

**État actuel** : email + password + bouton se connecter (Tailwind direct).

**Élévation souhaitée** :

- Card centrée avec backdrop subtil (glassmorphism léger ou aurora glow derrière)
- Inputs floating-label ou label flottant Material-style
- Icônes dans les inputs (mail, lock — lucide-react)
- Bouton "Se connecter" avec loading state animé (spinner + texte)
- Lien "Mot de passe oublié" (différé J1.5 mais l'UI doit l'anticiper)
- Animation d'entrée de la card (slide-up + fade)

### J1 — Onboarding welcome

**Route** : `/onboarding/welcome?token=...`
**Fichier source** : `apps/web/src/app/onboarding/welcome/*`

**État actuel** : prénom + nom + password + confirmation + checkbox RGPD + bouton créer.

**Élévation souhaitée** :

- Wizard visuel 3 étapes : "1. Tes infos" → "2. Sécurité" → "3. Validation RGPD"
- Progress bar animée en haut
- Animations slide entre étapes (Framer Motion AnimatePresence)
- Illustration animée à chaque étape (Lottie ou SVG animé : un athlète qui s'équipe)
- Confetti animation au submit final
- État d'erreur (token expiré / déjà utilisé) avec illustration différente

### J1 — Admin invite

**Route** : `/admin/invite`
**Fichier source** : `apps/web/src/app/admin/invite/*`

**État actuel** : champ email + bouton "Inviter".

**Élévation souhaitée** :

- Liste des invitations en attente (en cours dans la session ; reset au refresh) avec date d'expiration
- Animation fly-in du nouvel email envoyé
- Toast de confirmation "Invitation envoyée à X" avec bouton "Annuler" qui delete l'invitation
- Empty state : illustration animée + CTA "Inviter ton premier membre"

### J1 — Dashboard membre/admin

**Route** : `/dashboard`
**Fichier source** : `apps/web/src/app/dashboard/page.tsx`

**État actuel** : header avec logo + nom + rôle + bouton déconnexion. Carte "Journal de trading" avec CTA.

**Élévation souhaitée** :

- Header avec avatar (initiales auto-générées si pas d'image) + greeting selon l'heure ("Bonjour Eliot" / "Bonsoir Eliot")
- Cards d'accès aux features avec **micro-illustrations animées** (journal, check-ins, library MD, scores)
- Pour admin : section "Activité récente" (membres connectés aujourd'hui, derniers trades loggués) — placeholder J3+
- Streak counter visible si applicable (badge "🔥 12 jours")
- Layout grid responsive (cols-1 mobile, cols-2 sm, cols-3 lg)

### J2 — Journal liste

**Route** : `/journal`
**Fichier source** : `apps/web/src/app/journal/page.tsx`

**État actuel** : tabs filter (all/open/closed) + liste de trade cards + empty state + footer counter.

**Élévation souhaitée** :

- **Stats summary banner en haut** : 4 mini-cards (total trades, win rate, R moyen, current streak) avec micro-charts inline (sparklines Tremor 30 derniers jours) — placeholder J6 mais l'UI doit l'anticiper
- Trade cards avec :
  - Hover state : scale 1.01 + glow subtil
  - Mini sparkline du trade (entry → exit, ligne verte si win, rouge si loss)
  - Tags émotion en pills colorées
  - Animation fly-in à l'apparition
- Empty state : illustration animée d'un journal vide + CTA pulsant
- Filtres tabs : indicator animé qui slide entre les tabs (Framer Motion `layoutId`)

### J2 — Journal nouveau (wizard 6 étapes)

**Route** : `/journal/new`
**Fichier source** : `apps/web/src/components/journal/trade-form-wizard.tsx`

**État actuel** : 6 étapes (date+pair / direction+session / prix+lot+SL / R:R slider / discipline+émotion / capture entrée) avec slide horizontal Framer Motion.

**Élévation souhaitée** :

- Progress bar 6 segments (déjà fait) avec animation de remplissage
- **Step 1 (date+pair)** : datalist pair avec **flag countries** ou **logos métaux/indices** dans les options
- **Step 2 (direction+session)** :
  - Direction Long ↗ / Short ↘ : grosses cards avec **flèche animée** (montée pour long, descente pour short)
  - Session : 4 cards avec **horloge analogique** mini qui montre l'heure typique de la session
- **Step 3 (prix+lot+SL)** :
  - Visualisation graphique du R:R : ligne entry → lot → SL avec calcul live de "1R = X €" ou "1R = N pips"
- **Step 4 (R:R slider)** :
  - Slider custom premium avec gradient
  - Visualisation à droite : barre de risque ↔ barre de récompense (proportionnelles)
  - Présets rapides : 1.5R / 2R / 3R / 5R en pills cliquables
- **Step 5 (discipline+émotion)** :
  - Émotion picker : grid avec **émojis subtils** (calme = 🌊 minimaliste, FOMO = ⚡, etc.) sans charger inutilement
  - Counter "X/3" qui pulse à 3
- **Step 6 (capture entrée)** :
  - Drag & drop avec animation "drop zone glow" quand un fichier est au-dessus
  - Preview avec **frame de polaroid** ou **device frame mobile** qui rend la capture comme un screenshot iPhone
  - Compression/optimisation visuelle au moment de l'upload (skeleton → image)

### J2 — Détail trade

**Route** : `/journal/[id]`
**Fichier source** : `apps/web/src/components/journal/trade-detail-view.tsx`

**État actuel** : sections plan d'entrée + émotion + screenshot + sortie + notes.

**Élévation souhaitée** :

- Header avec **gros R réalisé visualisé** : si gain, animation upward arrow + glow vert ; si perte, downward arrow + glow rouge ; si BE, ligne plate
- Timeline visuelle entry → exit (avec icône session, durée du trade, position de SL si présent)
- Screenshots dans des **device frames** (mobile/desktop selon ratio détecté) avec zoom au clic
- Émotions before/after avec petite **flèche évolutive** (calme → frustration ⇡)
- Notes section : markdown rendering riche (gras, listes, citations)
- Bouton "Clôturer" avec animation pulsante quand le trade est ouvert

### J2 — Clôture trade

**Route** : `/journal/[id]/close`
**Fichier source** : `apps/web/src/components/journal/close-trade-form.tsx`

**Élévation souhaitée** :

- Outcome radios : **3 grosses cards visuelles** (Gain ✅ vert, Perte ❌ rouge, BE = neutral) avec micro-animation au sélectionner
- Calcul live du R réalisé (preview avant submit) qui change de couleur selon le signe
- Confetti animation au submit success
- Si win : illustration "athlete celebrating", si loss : illustration "athlete reflecting" (Lottie ou SVG animé subtil)

### J3 — Admin members liste

**Route** : `/admin/members`
**Fichier source** : `apps/web/src/app/admin/members/page.tsx` + `member-row.tsx`

**Élévation souhaitée** :

- **Top bar stats** : total membres, actifs aujourd'hui, en attente, suspendus (KPI cards animés)
- Search bar (filtre client-side par nom/email)
- Sort options : récents / dernière activité / plus actifs
- Member rows avec :
  - **Avatar avec initiales** (si pas de photo, fond généré à partir du hash de l'email — déterministe et coloré)
  - Activity dot (vert si connecté < 24h, jaune < 7j, gris au-delà)
  - Mini sparkline des trades 30j (placeholder J6)
  - Badge de status élégant (Admin, Suspendu)
- Empty state : illustration "groupe d'athlètes vide" + CTA "Inviter le premier"

### J3 — Admin member détail

**Route** : `/admin/members/[id]`
**Fichier source** : `apps/web/src/app/admin/members/[id]/page.tsx`

**Élévation souhaitée** :

- **Hero du membre** : grosse card avec avatar + nom + email + badges + stats clés
- **Tabs animés** : indicator slidant (Framer Motion `layoutId`) entre les onglets
- **Onglet Vue d'ensemble** :
  - 6 metrics cards (trades total, ouverts, clôturés, inscrit le, dernière connexion, dernier trade)
  - Mini sparkline activité 30 derniers jours (placeholder J5+)
  - Section "À venir" pour les onglets futurs (joliment teasée, pas juste "bientôt")
- **Onglet Trades** : liste compacte avec tri/filter, lien vers détail trade admin

### J3 — Admin trade détail (vue admin)

**Route** : `/admin/members/[id]/trades/[tradeId]`
**Fichier source** : Réutilise `<TradeDetailView />` partagé.

**Élévation souhaitée** :

- Variant subtilement différent du membre : badge "Vue admin" avec **icône bouclier** (lucide `ShieldCheck`)
- Footer prêt pour le futur **bouton "Annoter ce trade"** (J4) — placeholder visuel pour Claude Design

---

## Composants transversaux à créer

Ces composants reviennent partout — Claude Design devrait les designer une fois et on les réutilisera :

1. **`<EmptyState />`** — illustration + titre + description + CTA, animé à l'apparition
2. **`<StatCard />`** — KPI card avec valeur + label + delta (trend) + sparkline optionnelle
3. **`<Avatar />`** — initiales auto + fond hashé déterministe + ring optionnel (online/admin)
4. **`<Skeleton />`** — placeholder shimmer cohérent pour tous les loading states
5. **`<Toast />`** — notifications transitoires (success/error/info) avec animation slide-in
6. **`<TabNav />`** — tabs avec indicator animé `layoutId`
7. **`<Confetti />`** — burst on milestone (utiliser `react-confetti` ou équivalent SSR-safe)
8. **`<Spinner />`** — déjà existant mais à élever (3 variants : inline, page, button)

---

## Animations Framer Motion souhaitées

### Patterns globaux

- **Page transition** : fade + slide-up de 8px, durée 200ms, easeOut, respect reduced-motion
- **Card hover** : scale 1.02, transition 150ms
- **Button tap** : scale 0.97 sur active
- **List item enter** : stagger children avec delay 30ms par item, max 6 visibles
- **Modal/dialog** : backdrop fade-in 200ms, content scale 0.95→1 + opacity 0→1

### Spécifiques

- **Streak badge "🔥 N jours"** : icône feu qui flicker subtilement (loop infini, durée 2s)
- **Win/Loss reveal** : cubes qui flip 3D au reveal du résultat, vert/rouge selon outcome
- **Wizard step transition** : slide horizontal direction-aware (avant = +24px, retour = -24px)
- **Confetti sur milestone** : burst depuis le centre du screen pendant 3s
- **R réalisé large display** : count-up animation de 0 → valeur finale (1s, easeOut)

---

## Illustrations / iconographie cibles

Style cohérent à viser : **flat geometric**, palette bleu nuit + accents bleu vif, traits fins, **animations subtiles** (pas de cartoon overload).

Références d'inspiration (à mentionner à Claude Design pour qu'il s'aligne) :

- **Lottie Files** — recherche "trader", "finance dashboard", "minimal", "geometric"
- **Stripe** — illustrations produit (https://stripe.com)
- **Linear** — landing page (https://linear.app)
- **Framer** — interactions premium (https://framer.com)
- **Tremor** — charts dashboard (https://tremor.so)

Illustrations spécifiques nécessaires :

| Écran                     | Illustration                                       |
| ------------------------- | -------------------------------------------------- |
| Onboarding step 1         | Athlète qui s'équipe (vestiaire)                   |
| Onboarding step 2         | Casier sécurisé (cadenas qui se ferme)             |
| Onboarding step 3         | Athlète prêt sur la ligne de départ                |
| Dashboard empty (journal) | Carnet ouvert sur page blanche                     |
| Journal empty             | Schéma minimaliste R:R (entry/SL/TP)               |
| Trade win                 | Athlète qui célèbre (geste discret, pas de cliché) |
| Trade loss                | Athlète qui réfléchit assis sur banc               |
| Admin members empty       | Groupe d'athlètes en silhouette                    |
| Error / 404               | Athlète qui regarde une carte perdu                |
| Mark Douglas card (J7)    | Cerveau / livre ouvert / boussole                  |
| Streak badge              | Flamme animée minimaliste                          |

---

## Charts attendus (J6, design dès maintenant pour cohérence)

Tremor charts à designer :

- **R cumulé** : line chart avec area fill subtil, gradient vert→bleu→rouge selon zone
- **Win rate par session** : bar chart 4 barres (Asie, London, NY, Overlap), vert dégradé
- **Émotions × outcome** : heatmap avec gradient bleu→jaune→rouge
- **Sleep × performance** : scatter plot avec trendline
- **4 jauges scoring** (discipline, stabilité, consistance, engagement) : radial gauges 0-100, gradient

---

## Composants existants à respecter (déjà codés J0-J3)

> **Important pour Claude Design** : ne pas tout refaire from scratch. Lire ces composants dans le repo et **les élever**, pas les remplacer. La logique métier (Server Actions, Zod, Prisma) ne doit pas changer.

- `apps/web/src/components/spinner.tsx`
- `apps/web/src/components/alert.tsx`
- `apps/web/src/components/journal/trade-form-wizard.tsx`
- `apps/web/src/components/journal/trade-card.tsx`
- `apps/web/src/components/journal/emotion-picker.tsx`
- `apps/web/src/components/journal/pair-autocomplete.tsx`
- `apps/web/src/components/journal/screenshot-uploader.tsx`
- `apps/web/src/components/journal/close-trade-form.tsx`
- `apps/web/src/components/journal/trade-detail-view.tsx`
- `apps/web/src/components/admin/member-row.tsx`
- `apps/web/src/components/admin/member-tabs.tsx`
- `apps/web/src/components/admin/member-trades-list.tsx`

---

## Hors scope du Sprint #1 (différer aux sprints #2 et #3)

- **Charts Tremor data-driven** (placeholder OK ; vrais data viz au Sprint #2 après J6 livré)
- **Annotation trade UI** (J4 — Sprint #2)
- **Mark Douglas library reading UI** (J7 — Sprint #2)
- **Landing publique post-prod** (Sprint #3 final)
- **Pages legal RGPD** (Sprint #3 final)

---

## Livrable attendu de Claude Design

À la fin de la session claude.ai/design, Claude Design doit :

1. **Avoir designé chacun des 11 écrans** listés
2. **Définir le design system enrichi** : tokens couleurs étendus, typo, spacing, animations
3. **Lister les 8 composants transversaux** avec specs visuelles
4. **Lister les illustrations / Lotties à intégrer** (avec sources si possible)
5. **Exporter un Claude Code handoff bundle** que je colle dans une nouvelle session

Je m'occupe ensuite de l'**implémentation** dans Next.js 16 + React 19 + Tailwind 4 + Framer Motion + Tremor (à installer).

---

## Notes finales

- **Mobile-first absolu** : si Claude Design ne propose qu'une vue desktop, demander les vues 375px iPhone SE explicitement
- **Mode sombre uniquement V1** : pas de variant light pour ce sprint
- **Pas d'audio** : aucun son, aucune voix, aucun TTS dans Fxmily (préférence Eliot explicite)
- **Pas de cliché trading** : pas de bull/bear cartoonesque, pas de "to the moon", pas de chandeliers japonais omniprésents. **Discipline + sérénité + précision**
- **Cohérence > effets** : si un effet visuel se contredit avec un autre écran, on retire l'effet
- **Respect WCAG AA strict** : contraste mesuré, focus rings, motion reducible

**Bon design.** 🌌
