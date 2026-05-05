# Guide pas-à-pas — Utiliser Claude Design pour Fxmily

> **Pour Eliot, version débutant ultra-détaillée** — chaque clic, chaque bouton.
>
> **Durée totale estimée** : 3–4 heures réparties sur 1–2 jours.
> **Prérequis** : compte Anthropic Pro ou Max actif (tu as Max 20x ✓).

> **Sources de ce guide** : tutoriel officiel Anthropic, support.claude.com, blogs de devs qui l'ont testé en avril–mai 2026 (Sagnik Bhattacharya, Alex P., YingTu). Liens en bas du document.

---

## Vue d'ensemble — qu'est-ce qu'on va faire ?

On va utiliser **Claude Design** (produit Anthropic Labs lancé le 17 avril 2026) pour **redessiner** les écrans de Fxmily en mode "premium animé interactif". Claude Design vit sur `claude.ai/design` dans ton navigateur — c'est différent de Claude Code que tu utilises avec moi.

Le workflow en 8 étapes :

```
0. Préparatifs (5 min)
1. Ouvrir Claude Design (5 min)
2. Setup design system (15–20 min)              ← critique avant tout prompt
3. Créer le projet (5 min)
4. Premier prompt — pattern 8 blocs (10 min)
5. Itérer écran par écran (60–90 min)           ← le gros du travail
6. Vérification + récap design system (10 min)
7. Export "Hand off to Claude Code" (5 min)
8. Implémentation côté Claude Code (1–2h)        ← retour ici
```

**Le résultat** : 11 écrans Fxmily élevés (Framer Motion, illustrations animées, charts riches, micro-interactions premium).

---

## ÉTAPE 0 — Préparatifs (5 min)

### 0.1. Choisir le bon navigateur

D'après les retours utilisateurs en mai 2026 :

- ✅ **Chrome**, **Edge**, **Arc** : recommandés, fonctionnent bien
- ⚠️ **Safari** : laggy, à éviter
- ⚠️ **Firefox** : quirks de rendu sur le canvas (research preview)

Source : [Sagnik Bhattacharya](https://sagnikbhattacharya.com/blog/claude-design)

> Tu as Edge et Chrome installés. **Utilise Chrome** pour cette session.

### 0.2. Vérifier ton plan Anthropic

Claude Design est inclus dans **Pro / Max (5x et 20x) / Team / Enterprise**. **Pas de free tier**.

Tu as **Max 20x** → accès direct, allowance hebdo séparée du chat et de Claude Code.

⚠️ **Attention quotas** : retours utilisateurs Max 20x en mai 2026 — _« 2 petits projets = 100% du quota hebdo »_. Le quota n'est pas chiffré officiellement. **Va à l'essentiel pendant la session — n'itère pas 50 fois sur le même bouton**.

Sources : [Anthropic news](https://www.anthropic.com/news/claude-design-anthropic-labs), [flowstep.ai review](https://flowstep.ai/blog/claude-design-review/).

### 0.3. Le brief est déjà sur GitHub

Le fichier `docs/claude-design-brief-sprint-1.md` est pushé. Tu peux le voir sur :

```
https://github.com/fxeliott/fxmily/blob/main/docs/claude-design-brief-sprint-1.md
```

Pas besoin de le copier en local — Claude Design le lira directement depuis le repo.

### 0.4. Décide si ton repo est public ou privé

`fxeliott/fxmily` sur GitHub. Vérifie son statut :

- **Public** → Claude Design lit directement, rien à faire
- **Privé** → 2 options :
  - (a) tente la connexion OAuth GitHub depuis Claude Design (pas confirmé fiable en mai 2026)
  - (b) **plus sûr** : depuis GitHub, "Code → Download ZIP" (ou `git archive`), garde le ZIP sous la main pour upload direct

> Source [Sagnik Bhattacharya](https://sagnikbhattacharya.com/blog/claude-design) : _"For private repos, export the repo as a zip and upload that instead."_

---

## ÉTAPE 1 — Ouvrir Claude Design (5 min)

### 1.1. URL exacte

Dans Chrome, va sur :

```
https://claude.ai/design
```

### 1.2. Login

Pas de compte séparé. Si tu n'es pas déjà connecté à `claude.ai`, login avec ton compte Anthropic (le même que ton plan Max 20x).

### 1.3. Le layout que tu vas voir

D'après les screenshots dans les blogs :

```
┌─────────────────────────────────────────────────────────────┐
│  [Org/Account selector]              [Export]  [Share]      │
├──────────────┬──────────────────────────────────────────────┤
│              │                                              │
│  [Chat]      │                                              │
│              │           [Canvas]                           │
│  Champ       │           Sortie live                        │
│  prompt      │           Cliquable                          │
│              │           Zoom/scroll                        │
│  [Attach]    │                                              │
│              │                                              │
│              │                                              │
└──────────────┴──────────────────────────────────────────────┘
```

- **Panneau gauche** : chat conversationnel + champ prompt + bouton "Attach" (uploads)
- **Panneau droit** : canvas où s'affiche ce que Claude Design génère (cliquable, zoomable)
- **Top-right** : boutons **Export** + **Share**

### 1.4. Langue d'interface

✅ **Français disponible** (12 langues officielles : EN, FR, DE, IT, ES, JA, KO, PT, RU, ZH-CN, ZH-TW, ID).

Si l'interface est en anglais, va dans tes settings de compte Anthropic (`claude.ai/settings`) et change la langue.

Source : [support.claude.com article 14604416](https://support.claude.com/en/articles/14604416-get-started-with-claude-design).

---

## ÉTAPE 2 — Setup design system AVANT TOUT PROMPT (15–20 min)

> **Étape critique.** Si tu sautes cette étape et que tu pars direct au prompt, Claude Design va générer un look "AI générique" — couleurs, typo, spacing aléatoires. **Tu dois lui injecter le design system Fxmily AVANT**.
>
> Source : [Alex P. — Non-designer's walkthrough](https://medium.com/@0xmega/how-to-use-claude-design-the-non-designers-walkthrough-2adc18053a5c).

### 2.1. Ouvrir l'organisation

Sur la page d'accueil Claude Design :

1. **En bas à gauche du project picker** : tu vois ton nom d'organisation (ou "Personal").
2. Clique dessus → menu déroulant.
3. Sélectionne **ton organisation** (ou crée-en une si demandé).

Source : [support.claude.com — Set up design system](https://support.claude.com/en/articles/14604397-set-up-your-design-system-in-claude-design).

### 2.2. Importer ton design system

Tu as **3 méthodes** d'import :

#### Option A — URL GitHub (recommandée si repo public)

1. Clique l'option d'import "URL".
2. Colle : `https://github.com/fxeliott/fxmily`
3. Claude lit automatiquement les fichiers Tailwind, `globals.css`, `tailwind.config.*`, et extrait :
   - Tokens couleurs (`--background: #0a0e1a`, `--primary: #2563eb`, etc.)
   - Typographie (Inter / JetBrains Mono)
   - Composants existants (lit `apps/web/src/components/`)

⚠️ **Pour Fxmily monorepo** : Anthropic recommande de **lier le sous-package** (`apps/web`) plutôt que la racine du monorepo (sinon Claude lit `node_modules/`, `.next/`, etc.). Si l'UI te le permet, indique :

```
https://github.com/fxeliott/fxmily/tree/main/apps/web
```

Source : [claude.com tutorial](https://claude.com/resources/tutorials/using-claude-design-for-prototypes-and-ux).

#### Option B — Drag-and-drop dossier (recommandée si repo privé)

1. Sur ton ordi, copie le dossier `apps/web/` quelque part.
2. **Important** : avant de drag-drop, **supprime ces sous-dossiers** pour réduire la taille :
   - `node_modules/`
   - `.next/`
   - `.turbo/`
   - `src/generated/` (Prisma client)
3. Drag-drop le dossier nettoyé sur Claude Design.

#### Option C — Upload manuel

Si A et B échouent, tu peux uploader les fichiers clés un par un :

- `apps/web/src/app/globals.css` (palette CSS)
- `apps/web/src/app/layout.tsx` (fonts)
- Quelques composants représentatifs (`apps/web/src/components/spinner.tsx`, `alert.tsx`)

### 2.3. Vérifier que le design system est "Published"

Une fois importé, Claude Design affiche le système. En haut à droite tu vois 3 boutons :

- **Published** (toggle) — le système est utilisable dans tous tes futurs designs
- **Open** — voir le détail
- **Remix** — éditer le système

**Active le toggle "Published"**.

### 2.4. Temps réaliste

- ~15-20 min pour un gros codebase comme Fxmily
- ~5 min pour upload manuel d'assets simples

---

## ÉTAPE 3 — Créer le projet (5 min)

### 3.1. Bouton "New project"

Sur la page d'accueil Claude Design (sidebar gauche), un gros bouton **"New project"** au centre.

Clique dessus.

### 3.2. Choisir le mode (si demandé)

D'après [Alex P.](https://medium.com/@0xmega/how-to-use-claude-design-the-non-designers-walkthrough-2adc18053a5c), Claude Design propose un choix de mode initial :

- **Prototype** ← **choisis celui-là** pour Fxmily (multi-écrans interactifs)
- Slide deck
- Template
- Freeform

⚠️ Cette UI peut avoir évolué — si le choix n'apparaît pas, va direct au prompt.

### 3.3. Nommer le projet

Suggestion : `Fxmily Sprint #1 — élévation J0-J3`

---

## ÉTAPE 4 — Premier prompt — pattern 8 blocs (10 min)

> Le **pattern de prompt** qui marche le mieux selon la community 2026 a 8 blocs : **Goal / Audience / Surface / Context / Design system rules / Constraints / Output format / Review criteria**.
>
> Source : [YingTu — How to Use Claude Design](https://yingtu.ai/en/blog/how-to-use-claude-design).

### 4.1. Le prompt à coller

Voici ton prompt structuré (copie-colle directement dans le chat Claude Design) :

```
# GOAL
Élever le frontend de mon app Fxmily à un niveau "premium animé
interactif" — qualité Linear / Stripe / Apple Sport. Je veux 11 écrans
designés en cohérence + 8 composants transversaux, prêts à être
implémentés en Next.js 16 + Tailwind 4 + Framer Motion + shadcn/ui.

# AUDIENCE
- Membres de ma formation de trading Fxmily (athlètes-traders pros et
  débutants motivés). 30 → 100 → milliers à terme.
- Admin (moi, Eliot) qui suit chaque membre individuellement.
- Mobile-first absolu : iPhone SE 375×667 prioritaire, iPhone 15 393×852.

# SURFACE
PWA web Next.js 16 (App Router). Mode sombre uniquement V1.
Pas d'app native pour ce sprint.

# CONTEXT
Lis directement dans le repo `fxeliott/fxmily` :
- `docs/claude-design-brief-sprint-1.md` (brief complet 3000 mots)
- `SPEC.md` (vision produit complète)
- `apps/web/src/app/globals.css` (palette CSS)
- `apps/web/src/components/journal/*` (composants existants à élever)
- `apps/web/src/components/admin/*` (composants admin existants)

# DESIGN SYSTEM RULES
- Palette base : --background #0a0e1a / --primary #2563eb / --accent #3b82f6
  / --success #10b981 / --warning #f59e0b / --danger #ef4444
- Typo : Inter (body) + Inter Display (H1/H2) + JetBrains Mono
  (chiffres trading avec tabular-nums systématique)
- Tu peux ENRICHIR la palette (gradients, glows, accents secondaires)
  à condition de respecter contraste WCAG AA strict (4.5:1 texte normal,
  3:1 texte large)

# CONSTRAINTS
- Touch targets ≥ 44×44px partout (mobile-first absolu)
- prefers-reduced-motion honoré (animations conditionnelles)
- Focus rings visibles (jamais outline:none sans replacement)
- Pas de hover-only (tout doit être utilisable au clavier/tap)
- Pas d'audio dans l'app (préférence Eliot explicite)
- Posture Fxmily : pas de cliché trading (pas de bull/bear cartoon,
  pas de "to the moon", pas de chandeliers japonais omniprésents).
  Discipline + sérénité + précision.

# OUTPUT FORMAT
Pour chaque écran, je veux :
1. Vue desktop (1280px) + vue mobile iPhone SE (375px)
2. États : default, loading, error, empty (si applicable)
3. Animations : décris durée/easing/propriété animée
4. Réutilisation des composants transversaux quand pertinent
À la fin : un design system synthétique enrichi exporté avec le bundle.

# REVIEW CRITERIA
Je vais valider chaque écran sur ces points :
- Cohérence visuelle avec le reste du système
- Lisibilité mobile 375px (chiffres trading lisibles ?)
- Animations subtiles, pas surchargées
- Empty states avec illustrations animées
- États error gracieux
- Tabular-nums sur tous les chiffres financiers

Allons-y. Commence par analyser le brief + le repo, puis montre-moi
ta première proposition pour `/` (splash) et `/login`.
```

### 4.2. Attendre l'analyse

Claude Design va lire le brief, le repo, et générer ses premières propositions. **30–60 secondes**.

Tu vas voir apparaître **2 écrans** sur le canvas droit : `/` et `/login` dans les versions élevées.

---

## ÉTAPE 5 — Itérer écran par écran (60–90 min)

### 5.1. Les 3 modes d'édition disponibles

Claude Design supporte (confirmé Anthropic) :

#### Mode A — Inline comments (style "Google Docs review")

1. **Clique sur un élément** dans le canvas (un bouton, un titre, une card)
2. Une **inline toolbar** apparaît à côté avec 3 actions :
   - 💬 **Comment** — ajoute un commentaire textuel
   - ✏️ **Edit text** — change directement le texte
   - 🎚️ **Adjust** — sliders custom (couleur, espacement, animation)
3. Clique **Comment**, écris ton feedback, valide.

⚠️ **Bug connu** : _« Inline comments occasionally disappear before Claude reads them »_. Workaround : si ton commentaire disparaît, **recolle-le dans le chat principal** (panneau gauche).

Source : [support.claude.com 14604416](https://support.claude.com/en/articles/14604416-get-started-with-claude-design).

#### Mode B — Edit text directly

Double-clic sur un texte → tu tapes pour le remplacer.

Idéal pour : changer rapidement un wording, tester un autre intitulé de bouton.

#### Mode C — Adjustment sliders

Clique → **Adjust** → des sliders apparaissent (souvent custom-générés par Claude pour le contexte) :

- Slider couleur (gradient bleu nuit ↔ bleu vif)
- Slider intensité d'animation
- Slider espacement
- Slider rayon de bord

Glisse les sliders → le canvas update en live.

### 5.2. Travailler écran par écran (méthode recommandée)

Pour chaque écran du brief, suis cette routine :

1. **Demande l'écran** dans le chat : _"Maintenant fais-moi `/journal/new` step 3 (prix entrée + lot + stop-loss)"_
2. **Regarde la première version**
3. **Demande la version mobile** : _"Montre-moi cette même vue en 375px iPhone SE"_
4. **Demande les états** : _"Donne-moi les états loading, error et le case sans stop-loss"_
5. **Itère 2-3 fois max** par écran (cf. quotas)
6. **Une fois satisfait, passe au suivant**

### 5.3. Conseils itération

✅ **À faire** :

- Feedback **concret** : _"le bouton est trop pâle, augmente la saturation du primary de +20%"_ > _"j'aime pas"_
- **Demande variantes** : _"montre-moi 3 variantes pour la card empty state du journal"_
- **Valide écran par écran** : ne saute pas
- Demande les **animations en preview** : _"anime la transition wizard step 2 → step 3"_ (Claude Design peut prototyper l'animation)

❌ **À éviter** :

- Demander 30 changements d'un coup → il oublie la moitié
- Itérer 10 fois sur le même bouton (quota 🔥)
- Valider sans regarder la version mobile
- Ignorer les chiffres mono (tabular-nums sur prix / R réalisé)

### 5.4. Pièges spécifiques Fxmily

- **Vérifie les flèches Long ↗ / Short ↘** : doivent être lisibles à 375px
- **Vérifie les chips émotion** : grid en 2 colonnes sur mobile (pas 4 sinon trop serré)
- **Vérifie les chiffres financiers** : `font-mono tabular-nums` partout (prix, lots, R réalisé)
- **Vérifie le wizard step indicator** : 6 segments visibles à 375px ?
- **Vérifie l'admin members list** : tabular-nums sur le compteur "trades", initiales avatar lisibles

### 5.5. Naviguer entre les écrans

Sur le canvas droit, tu peux :

- **Scroll** pour voir tous les écrans déjà générés
- **Zoom** (Ctrl/⌘+molette)
- **Cliquer un écran** pour le mettre au centre

---

## ÉTAPE 6 — Vérification + récap design system (10 min)

### 6.1. Vérifier la couverture des 11 écrans

Avant l'export, tape dans le chat :

```
Liste-moi tous les écrans que tu as designés dans cette session,
puis confirme-moi que ces 11 écrans Fxmily Sprint #1 sont bien tous
designés (en desktop + mobile + states) :

- [ ] / (splash)
- [ ] /login
- [ ] /onboarding/welcome
- [ ] /admin/invite
- [ ] /dashboard
- [ ] /journal (liste + tabs filter + empty state)
- [ ] /journal/new (wizard 6 étapes)
- [ ] /journal/[id] (détail trade)
- [ ] /journal/[id]/close (clôture trade)
- [ ] /admin/members (liste membres)
- [ ] /admin/members/[id] (détail membre)
- [ ] /admin/members/[id]/trades/[tradeId] (trade vu par admin)

Et les 8 composants transversaux :
- [ ] EmptyState
- [ ] StatCard
- [ ] Avatar
- [ ] Skeleton
- [ ] Toast
- [ ] TabNav
- [ ] Confetti
- [ ] Spinner

Si un écran ou composant manque, fais-le maintenant avant qu'on exporte.
```

### 6.2. Demander le récap design system synthétique

Avant l'export, demande :

```
Donne-moi un récap synthétique du design system enrichi :

1. Palette finale (avec hex codes des couleurs ajoutées)
2. Les 4-6 animations Framer Motion réutilisables (durée, easing,
   propriétés animées)
3. Les illustrations / Lotties utilisées (avec sources si possible)
4. Les 8 composants transversaux et leurs specs
5. Les charts Tremor anticipés (même placeholders pour J6)
6. Les fonts ajoutées (si tu en as introduit hors Inter / JetBrains)

Format : markdown structuré que je puisse coller dans
docs/design-sprint-1-close-out.md.
```

**Sauvegarde ce récap** dans un fichier texte de ton côté ou copie-le, il sera utile à l'étape 8.

### 6.3. Hand-craft le README du bundle

Avant le hand-off, demande à Claude Design :

```
Avant l'export, génère un fichier PROMPT.md / README.md pour le hand-off
bundle qui explique à Claude Code (en local) :

- La stack cible (Next 16 / React 19 / Tailwind 4 / Framer Motion / shadcn)
- Les fichiers existants à élever (pas remplacer) avec chemins
- Les nouvelles deps à installer si applicable (Tremor, Lottie player, etc.)
- L'ordre d'implémentation recommandé (composants partagés d'abord,
  pages ensuite)
- Les tests E2E auth-gate à conserver (tests/e2e/journal.spec.ts,
  admin-members.spec.ts, auth-invitation.spec.ts)
```

> Source [claudefa.st](https://claudefa.st/blog/guide/mechanics/claude-design-handoff) : _"hand-crafting the README in the bundle = the difference between engineering ships and engineering rewrites."_

---

## ÉTAPE 7 — Export "Hand off to Claude Code" (5 min)

### 7.1. Trouver le bouton

**Top-right de l'écran** : bouton **Export**.

### 7.2. Les options d'export disponibles

Le menu Export te propose :

- **Download as `.zip`**
- **Export as PDF**
- **Export as PPTX**
- **Send to Canva**
- **Export as standalone HTML**
- **Hand off to Claude Code** ← **celui-là**, avec 2 sous-options :
  - **Send to local coding agent** ← **prends celle-là** (Claude Code CLI sur ton ordi)
  - Send to Claude Code Web (alternative cloud)

Source : [Anthropic release notes](https://support.claude.com/en/articles/12138966-release-notes).

### 7.3. Récupérer la commande

Anthropic génère une **commande prête à coller** dans Claude Code. Format approximatif :

```
claude "Implement the handoff bundle at ~/Downloads/claude-design-fxmily-sprint-1.zip in apps/web/..."
```

(Source : exemple [Sagnik Bhattacharya](https://sagnikbhattacharya.com/blog/claude-design).)

⚠️ **Important** : la commande peut référencer un ZIP téléchargé OU une URL. Selon le cas :

- **Si ZIP** : Anthropic te dit de télécharger le ZIP. Sauvegarde-le dans `D:\Fxmily\.claude\worktrees\design-handoff-sprint-1.zip` (gitignored).
- **Si URL** : copie la commande telle quelle. ❌ Durée de vie du token URL non documentée publiquement — fais-le **dans la foulée**, ne laisse pas traîner 24h.

### 7.4. Backup obligatoire

**AVANT de fermer Claude Design**, exporte aussi :

1. **ZIP standalone** (clique "Download as .zip")
2. **PDF des écrans** (pour archive visuelle)
3. **Lien de partage** ("Share" en haut à droite)

Sauvegarde tout ça dans `D:\Fxmily\.claude\worktrees\design-handoff-sprint-1\` (gitignored). Si quelque chose casse, tu pourras me ramener les screenshots ou le ZIP brut.

### 7.5. Composition du bundle

Le bundle Claude Code handoff contient typiquement :

- `design.html` — preview HTML des écrans
- `screenshots/` — captures de chaque écran (mobile + desktop)
- `design-notes.md` — décisions design tranchées
- `PROMPT.md` — instructions pour le coding agent
- `tokens.json` — design tokens (couleurs, typo, spacing)
- `assets/` — illustrations, Lotties, icônes générées

Source : [aakashg/claude-design-pm-toolkit](https://github.com/aakashg/claude-design-pm-toolkit/blob/main/11_claude_code_handoff.md).

---

## ÉTAPE 8 — Implémentation côté Claude Code (1–2h)

### 8.1. Lance une nouvelle session Claude Code

**Très important : `/clear`** dans Claude Code pour avoir un contexte frais. Le contexte de la session actuelle est trop chargé pour bien implémenter le sprint.

### 8.2. Le message à coller dans la nouvelle session

```
Implémente le handoff Claude Design pour Fxmily — Sprint #1.

Voici la commande de handoff que Claude Design m'a donnée :

[COLLE LA COMMANDE EXACTE FOURNIE PAR CLAUDE DESIGN ICI]

Backup au cas où le token expire :
- ZIP local : D:\Fxmily\.claude\worktrees\design-handoff-sprint-1.zip
- Lien Claude Design partagé : [COLLE LE LIEN ICI]

Lis aussi pour le contexte :
- D:\Fxmily\docs\claude-design-brief-sprint-1.md (le brief original)
- D:\Fxmily\apps\web\CLAUDE.md (conventions repo Next.js / Tailwind / etc.)
- D:\Fxmily\SPEC.md (vision produit)
- D:\Fxmily\docs\jalon-2-prep.md (décisions produit J2 actées)
- C:\Users\eliot\.claude\projects\D--Fxmily\memory\MEMORY.md
  (préférences user — pas d'audio, design premium)

Stack à respecter :
- Next.js 16 (App Router) + React 19 + TypeScript strict
- Tailwind 4 + shadcn/ui (style new-york)
- Framer Motion (déjà installé v12.38)
- lucide-react (icônes)
- Tremor à installer SI Claude Design en a utilisé pour les charts

Périmètre Sprint #1 :
- 11 écrans à élever (J0-J3) — liste exacte dans le brief
- 8 composants transversaux nouveaux à créer
- Logique métier (Server Actions, Zod, Prisma) NE doit PAS changer

Méthode demandée :
1. Fetch le handoff bundle
2. Liste-moi ce qui est à implémenter écran par écran avec un plan court
3. Demande validation avant de toucher au code
4. Implémente écran par écran avec commits atomiques (1 commit par écran
   ou par composant transversal)
5. Lance le dev server en background pour valider visuellement à chaque
   étape (Postgres + admin J3 sont déjà actifs sur ma machine)
6. Quality gate après chaque commit (format, lint, type-check, test, build)
7. Tests E2E auth-gate existants à préserver (zéro régression sur
   tests/e2e/auth-invitation.spec.ts, journal.spec.ts, admin-members.spec.ts)
8. Update docs/jalon-2-prep.md ou crée docs/design-sprint-1-close-out.md
   avec les décisions design et le récap palette enrichie
```

### 8.3. Suivre l'implémentation

Claude Code va :

1. **Fetch** le bundle (URL ou ZIP)
2. **Analyser** ce qui est requis (nouveaux composants, deps à installer)
3. **Présenter le plan** d'implémentation
4. **Te demander validation** avant de toucher au code
5. **Implémenter** écran par écran avec commits atomiques
6. **Lancer le dev server** pour smoke test
7. **Te demander de valider visuellement** chaque écran sur localhost:3000
8. **Push** sur `origin/main` une fois tout validé

---

## ÉTAPE 9 — Cleanup & post-sprint (15 min)

### 9.1. Mettre à jour le scoped CLAUDE.md

Demande à Claude Code :

```
Update D:\Fxmily\apps\web\CLAUDE.md pour documenter le design system
enrichi sorti du Sprint #1 Claude Design :
- Nouvelles couleurs / tokens étendus
- Animations Framer Motion réutilisables (avec specs)
- Composants transversaux ajoutés (<StatCard />, <Avatar />, etc.)
- Nouvelles deps installées (Tremor, Lottie, etc.)
- Convention illustrations (où elles vivent dans le repo)
```

### 9.2. Créer un close-out doc

```
Crée docs/design-sprint-1-close-out.md inspiré de docs/jalon-2-prep.md :
- Ce qui a été designé (les 11 écrans + 8 composants)
- Screenshots avant/après (à insérer dans .claude/worktrees/, ou liens)
- Décisions design tranchées (palette enrichie, fonts, animations)
- Quotas Claude Design consommés (estimation)
- Hand-off vers le Sprint #2 (J4-J7 — annotations + check-ins + dashboard + Mark Douglas library)
```

### 9.3. Préparer la suite

Tu peux maintenant :

- **Reprendre J4** (annotations) en mode normal — le design system est posé
- **Faire un Sprint #2 Claude Design** plus tard (après J6 livré, pour les charts Tremor riches)
- **Faire un Sprint #3 final** au J10 (landing publique + pages legal + polish prod)

---

## ÉTAPE 10 — Pièges connus & solutions (récap)

| Symptôme                              | Cause                           | Solution                                               |
| ------------------------------------- | ------------------------------- | ------------------------------------------------------ |
| Inline comments disparaissent         | Bug officiel Anthropic mai 2026 | Recolle dans le chat principal (panneau gauche)        |
| "Save error" sur compact layout       | Bug officiel                    | Recharge la page, repasse en layout normal             |
| Lag sur gros codebase                 | Limite officielle               | Limite à 1 sous-package (`apps/web/`), pas le monorepo |
| Repo privé non lu                     | OAuth limité                    | Drag-drop le ZIP du repo nettoyé                       |
| Tokens hebdo épuisés                  | Quota Max 20x                   | Attendre la nouvelle semaine ou utiliser API overage   |
| Couleurs incohérentes générées        | Design system pas Published     | Retourne à l'étape 2, vérifie le toggle                |
| Browser laggy                         | Safari ou Firefox               | Bascule sur Chrome / Edge / Arc                        |
| Token handoff expiré                  | Durée de vie inconnue           | Re-clique "Hand off to Claude Code" pour régénérer     |
| Pas de bouton "variantes côte à côte" | Pas documenté en mai 2026       | Demande "3 variantes" via le chat                      |

---

## Aide directe en chat avec moi

Si tu bloques **à n'importe quelle étape**, reviens dans une session Claude Code et dis-moi :

- _"Étape 2.X — Claude Design fait Y, je sais pas comment réagir"_
- _"Étape 5 — l'écran Z ne me plaît pas, comment lui dire ?"_
- _"Étape 7 — j'ai cliqué Export mais il me propose Z, c'est normal ?"_

Je t'aiderai à formuler la suite.

---

## Ressources annexes (community 2026)

À garder en favoris pendant le sprint :

- **[awesome-claude-design](https://github.com/VoltAgent/awesome-claude-design)** — 68 design systems prêts à l'emploi en format DESIGN.md (potentiellement un design "trading dashboard" ou "fintech mobile" inspirant)
- **[claude-design-pm-toolkit](https://github.com/aakashg/claude-design-pm-toolkit)** — template handoff PM-grade
- **[Tutoriel officiel Anthropic Claude Design](https://claude.com/resources/tutorials/using-claude-design-for-prototypes-and-ux)**
- **[Sagnik Bhattacharya — How to Use Claude Design](https://sagnikbhattacharya.com/blog/claude-design)** (avec screenshots interface)
- **[YingTu — How to Use Claude Design](https://yingtu.ai/en/blog/how-to-use-claude-design)** (pattern 8 blocs)
- **[Alex P. — Non-designer's walkthrough](https://medium.com/@0xmega/how-to-use-claude-design-the-non-designers-walkthrough-2adc18053a5c)**
- **[claudefa.st — Hand-off mechanics](https://claudefa.st/blog/guide/mechanics/claude-design-handoff)**
- **[support.claude.com — Get started with Claude Design](https://support.claude.com/en/articles/14604416-get-started-with-claude-design)** (officielle)
- **[support.claude.com — Set up your design system](https://support.claude.com/en/articles/14604397-set-up-your-design-system-in-claude-design)** (officielle)

---

## Récap — la séquence complète détaillée

```
0. ✅ Préparatifs (Chrome, plan Max OK, brief sur GitHub) — 5 min
1. ⏳ Ouvrir claude.ai/design + login — 5 min
2. ⏳ Setup design system (URL repo OU drag-drop ZIP) — 15-20 min
3. ⏳ "New project" + mode Prototype + nom — 5 min
4. ⏳ Coller le prompt 8 blocs — 10 min
5. ⏳ Itérer écran par écran (3 modes : Comment / Edit / Adjust) — 60-90 min
6. ⏳ Vérifier couverture 11 écrans + 8 composants — 10 min
7. ⏳ Export → Hand off to Claude Code → Send to local coding agent — 5 min
8. ⏳ /clear sur Claude Code, coller le message d'implémentation — 1-2h
9. ⏳ Cleanup (CLAUDE.md update + close-out doc) — 15 min
```

**Total : 3-5 heures réparties sur 1-2 jours.**

---

## Points NON documentés publiquement (à dire à Claude Design si le sujet revient)

D'après mes recherches en mai 2026, **les points suivants ne sont pas documentés publiquement** :

- ❌ Format exact + durée de vie du token/URL handoff (selon les retours, "fais-le dans la foulée")
- ❌ Scopes OAuth GitHub demandés (tente, autorise au popup)
- ❌ Taille max repo pour import URL
- ❌ Limite mots prompt et nombre max d'écrans par projet
- ❌ Quotas chiffrés Pro/Max/Team
- ❌ Bouton dédié "variantes côte à côte" (passe par le chat)
- ❌ Mobile-vs-desktop preview button (demande "vue 375px iPhone SE" dans le chat)

Si Claude Design demande des infos qui ne sont pas dans ce guide, **tu peux improviser en suivant l'esprit du brief** et me dire ensuite ce qui s'est passé pour que je mette à jour le guide.

**Bonne magie design.** ✨
