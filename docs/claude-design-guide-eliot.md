# Guide pas-à-pas — Utiliser Claude Design pour Fxmily

> **Pour Eliot, version débutant** — comment piloter le sprint design Fxmily de A à Z sans rien rater.
>
> **Durée totale estimée** : 2–3 heures réparties sur 1–2 jours.
> **Prérequis** : compte Anthropic Pro ou Max actif (tu as Max 20x ✓), un navigateur (Chrome ou Edge).

---

## Vue d'ensemble — qu'est-ce qu'on va faire ?

On va utiliser **Claude Design** (un nouveau produit Anthropic lancé le 17 avril 2026) pour **redessiner** les écrans de Fxmily en mode "premium animé interactif". Claude Design vit sur `claude.ai/design` dans ton navigateur — c'est différent de Claude Code que tu utilises avec moi.

Le workflow en 4 étapes :

```
ÉTAPE 1 — Préparer le brief (déjà fait, c'est dans `docs/claude-design-brief-sprint-1.md`)
            ↓
ÉTAPE 2 — Toi sur claude.ai/design : prompt + itération visuelle (1–2h)
            ↓
ÉTAPE 3 — Toi : exporter le "handoff bundle" (1 clic)
            ↓
ÉTAPE 4 — Moi (Claude Code) : implémentation dans le repo Fxmily
```

**Le résultat** : des écrans Fxmily avec animations Framer Motion, illustrations animées, charts riches, micro-interactions premium. Le tout cohérent et prêt à utiliser.

---

## ÉTAPE 1 — Vérifier que tout est prêt (5 min)

### 1.1. Le brief est dans le repo

Le fichier `docs/claude-design-brief-sprint-1.md` existe et a été pushé sur GitHub. Tu peux le voir ici :

```
https://github.com/fxeliott/fxmily/blob/main/docs/claude-design-brief-sprint-1.md
```

Il fait ~3000 mots et contient tout ce que Claude Design doit savoir : palette, typo, contraintes, écrans à designer, animations, illustrations.

### 1.2. Avoir le repo public ou accessible

Claude Design peut **lire ton repo GitHub** pour extraire le design system existant. Le repo `fxeliott/fxmily` doit être accessible :

- Si **public** : Claude Design le lit directement, rien à faire
- Si **privé** : tu devras autoriser Claude Design à y accéder via GitHub OAuth (popup à confirmer)

> **Conseil** : laisse-le privé. Au moment où Claude Design demande l'accès, autorise — c'est plus sécurisé qu'un repo public.

### 1.3. Avoir une session Claude Code prête pour la suite

Garde cette session de chat **ouverte** ou enregistre l'URL — tu reviendras ici (ou tu lanceras une nouvelle session Claude Code) après l'export Claude Design.

---

## ÉTAPE 2 — Aller sur Claude Design et briefer (60–90 min)

### 2.1. Ouvrir Claude Design

1. Va sur **https://claude.ai/design**
2. Connecte-toi avec ton compte Anthropic (le même que ton plan Max 20x)
3. Tu vois l'interface Claude Design : un grand canvas vide, une barre de prompt en bas

> **Note** : si tu vois "research preview" ou "Anthropic Labs", c'est normal — Claude Design est sorti il y a 3 semaines.

### 2.2. Démarrer une nouvelle conversation

Clique **"New design"** ou équivalent (en haut à gauche).

### 2.3. Coller le brief

Voici le prompt initial à copier-coller dans Claude Design :

```
Bonjour Claude Design.

Je m'appelle Eliot et je dirige une formation de trading appelée Fxmily.
Je veux élever le frontend de mon app web Fxmily à un niveau "premium
animé interactif" — qualité Linear / Stripe / Apple Sport.

Mon repo GitHub : https://github.com/fxeliott/fxmily

Lis directement le fichier `docs/claude-design-brief-sprint-1.md` à la racine
du repo — il contient le brief complet : palette, typo, contraintes a11y,
mobile-first, 11 écrans à designer, animations souhaitées, illustrations
cibles.

Lis aussi `D:\Fxmily\SPEC.md` (consultable sur GitHub) pour le contexte
produit complet (suivi comportemental ultra-poussé d'athlètes traders,
posture sans conseil de marché, framework Mark Douglas, etc.).

Mes 9 écrans déjà codés en Tailwind direct vivent dans `apps/web/src/`.
Le brief liste les composants existants à respecter (à élever, pas à
remplacer from scratch). La logique métier (Server Actions, Zod, Prisma)
ne doit pas changer — uniquement le visuel.

Je veux qu'à la fin de notre session :

1. Tu aies designé les 11 écrans listés au brief
2. Tu aies défini un design system enrichi (couleurs étendues, animations
   réutilisables, composants transversaux)
3. Tu m'exportes un "Claude Code handoff bundle" que je collerai dans
   une session Claude Code locale pour l'implémentation

Allons-y. Commence par analyser le repo et le brief, puis montre-moi
ta première proposition pour le splash `/` et le `/login`.
```

**Colle ce texte dans la barre de prompt de Claude Design et envoie**.

### 2.4. Attendre l'analyse

Claude Design va prendre 30–60 secondes pour :

- Lire le brief
- Analyser le repo Fxmily
- Extraire le design system existant (couleurs, fonts, composants)
- Proposer ses premières interprétations

Tu vas voir apparaître **un canvas avec 1 ou 2 écrans designés** dès le premier tour.

### 2.5. Itérer écran par écran

C'est là que ça devient amusant. Claude Design affiche un canvas où tu peux :

- **Cliquer sur un élément** pour voir ses propriétés (Claude Design propose souvent des sliders custom : couleur, espacement, intensité d'animation)
- **Commenter inline** : tu cliques sur un élément, tu écris "rends ça plus subtil" ou "ajoute un glow bleu"
- **Demander une variante** : "montre-moi 3 variantes pour ce header"
- **Ajouter une étape** : "et maintenant le wizard `/journal/new` step 1"

#### Conseils pour itérer efficace

✅ **À faire** :

- Donne du **feedback concret** : "le bouton est trop pâle, augmente la saturation du bleu primary" plutôt que "j'aime pas"
- **Valide écran par écran** : ne passe pas au suivant avant d'être satisfait du précédent
- Demande des **variantes mobiles** explicitement : "montre-moi cette card en 375px iPhone SE"
- Demande **les états** : "montre-moi l'état hover, l'état loading, l'état error de ce bouton"
- Demande les **animations en preview** : "anime le wizard step transition" → Claude Design peut générer des prototypes animés

❌ **À éviter** :

- Demander 30 changements d'un coup (Claude Design risque d'oublier la moitié)
- Accepter le premier jet sans regarder les détails (les chiffres mono ? les focus rings ? les tabular-nums ?)
- Sauter les écrans "boring" : login / onboarding sont aussi importants que le wizard

### 2.6. Vérifier la couverture

Avant d'exporter, assure-toi que Claude Design a bien designé **les 11 écrans du brief** :

- [ ] `/` — splash
- [ ] `/login`
- [ ] `/onboarding/welcome`
- [ ] `/admin/invite`
- [ ] `/dashboard`
- [ ] `/journal` (liste + tabs filter + empty state)
- [ ] `/journal/new` (wizard 6 étapes)
- [ ] `/journal/[id]` (détail trade)
- [ ] `/journal/[id]/close` (clôture trade)
- [ ] `/admin/members` (liste membres)
- [ ] `/admin/members/[id]` (détail membre)
- [ ] `/admin/members/[id]/trades/[tradeId]` (trade vu par admin)

Et les 8 composants transversaux (`<EmptyState />`, `<StatCard />`, `<Avatar />`, `<Skeleton />`, `<Toast />`, `<TabNav />`, `<Confetti />`, `<Spinner />`).

Demande-lui directement : _"liste-moi les écrans que tu as designés et confirme la couverture vs le brief"_. S'il manque des trucs, demande-les.

### 2.7. Demander le design system synthétique

Avant l'export, demande :

```
Avant d'exporter, donne-moi un récap synthétique :

1. La palette finale (avec hex codes des couleurs ajoutées)
2. Les 4–6 animations Framer Motion réutilisables (avec specs : durée, easing, propriétés animées)
3. La liste des illustrations / Lotties que tu as utilisées (avec sources)
4. Les 8 composants transversaux et leurs specs
5. Les charts Tremor que tu as designés en preview (même placeholder)
```

Sauvegarde ce récap dans un fichier texte de ton côté — il sera utile à Claude Code à l'étape 4.

---

## ÉTAPE 3 — Exporter le handoff bundle (5 min)

### 3.1. Cliquer "Export → Hand off to Claude Code"

Dans Claude Design, le bouton d'export est en haut à droite. Tu vois plusieurs options :

- "Export ZIP" (assets + code HTML)
- **"Hand off to Claude Code"** ← celui-là
- "Share preview link"

Clique **"Hand off to Claude Code"**.

### 3.2. Copier la commande générée

Anthropic génère une commande prête à coller. Elle ressemble à :

```
claude-code design-handoff fetch https://design.anthropic.com/handoffs/<token-unique>
```

Ou un format similaire (ça peut évoluer). **Copie-la dans ton presse-papier**.

### 3.3. Sauvegarder le lien (au cas où)

Au cas où le token expire ou la session est perdue, sauvegarde aussi :

- Le lien de partage Claude Design (read-only)
- Le ZIP export (en backup)

Ça te permettra de retomber sur tes pieds si quelque chose casse.

---

## ÉTAPE 4 — Revenir à Claude Code pour l'implémentation (1–2h)

### 4.1. Lancer une nouvelle session Claude Code

Dans **Claude Code** (la CLI que tu utilises avec moi), fais :

```
/clear
```

Puis colle ce premier message :

```
Implémente le handoff Claude Design pour Fxmily — Sprint #1.

Voici la commande de handoff que Claude Design m'a donnée :

[COLLE ICI LA COMMANDE EXPORT]

Lis aussi :
- D:\Fxmily\docs\claude-design-brief-sprint-1.md (le brief original)
- D:\Fxmily\apps\web\CLAUDE.md (conventions repo)
- D:\Fxmily\SPEC.md (vision produit)
- C:\Users\eliot\.claude\projects\D--Fxmily\memory\MEMORY.md (préférences)

Stack à respecter : Next.js 16 + React 19 + Tailwind 4 + Framer Motion (déjà
installé) + shadcn/ui + lucide-react. Tremor à installer si Claude Design en
a utilisé pour les charts.

11 écrans à élever, 8 composants transversaux à créer. Mode sombre uniquement
V1, mobile-first iPhone SE, WCAG AA strict.

Implémente écran par écran, commit atomique par écran. Lance le dev server
en background pour valider visuellement à chaque étape. Quality gate après
chaque commit (format, lint, type-check, test).
```

### 4.2. Suivre l'implémentation

Claude Code va :

1. Fetch le handoff bundle (le ZIP/JSON avec les designs)
2. Analyser ce qui est requis (nouveaux composants, new dependencies, illustrations à intégrer)
3. Installer les nouvelles deps si besoin (Tremor, Lottie player, etc.)
4. Implémenter écran par écran avec commits atomiques
5. Lancer le dev server pour smoke test
6. Te demander de valider visuellement avant de commit final

**Tu devras valider visuellement** chaque écran à `localhost:3000` dans Edge ou Chrome.

### 4.3. Pousser le résultat sur GitHub

Une fois tout validé :

```
push origin main
```

Le CI GitHub Actions va re-tester le tout.

---

## ÉTAPE 5 — Quoi faire si ça coince

### 5.1. "Claude Design ne lit pas mon repo"

→ Vérifie que le repo est public OU que tu as autorisé l'accès via OAuth. Si le repo est privé, force le re-prompt :

> "Re-essaie de lire le repo `fxeliott/fxmily` — j'ai autorisé l'accès."

### 5.2. "Claude Design propose un design qui ne respecte pas la palette"

→ Renvoie-lui la palette explicite :

> "Respecte strictement cette palette : `--background: #0a0e1a`, `--primary: #2563eb`, `--accent: #3b82f6`. Refais le splash avec ces couleurs."

### 5.3. "Le handoff bundle a expiré"

→ Re-clique "Export → Hand off to Claude Code" dans la même session Claude Design pour générer un nouveau token.

### 5.4. "Claude Code ne sait pas comment fetch le handoff"

→ Donne-lui le ZIP en local :

```
J'ai téléchargé le ZIP du handoff Claude Design dans
D:\Fxmily\.claude\worktrees\design-handoff.zip

Décompresse-le dans .claude/worktrees/design/, lis tout son contenu
et implémente les écrans dans le repo Fxmily.
```

### 5.5. "Tremor / Lottie ne s'installe pas"

→ Pas grave. Demande à Claude Code :

> "Skip Tremor pour ce sprint, garde des placeholders SVG ou des cards statiques. On installera Tremor au Sprint #2 quand on a la vraie data J6."

### 5.6. "Le résultat ne me plaît pas"

→ Retour à l'étape 2 : itère encore avec Claude Design jusqu'à être satisfait. Le handoff est rejouable autant de fois que tu veux.

---

## ÉTAPE 6 — Après le sprint (cleanup)

### 6.1. Mettre à jour le scoped CLAUDE.md

Demande à Claude Code :

```
Update D:\Fxmily\apps\web\CLAUDE.md pour documenter le design system
enrichi sorti du Sprint #1 Claude Design : nouvelles couleurs, animations
Framer Motion réutilisables, composants transversaux ajoutés
(<StatCard />, <Avatar />, etc.).
```

### 6.2. Documenter le close-out du Sprint #1

```
Crée docs/design-sprint-1-close-out.md avec :
- ce qui a été designé (les 11 écrans + 8 composants)
- les screenshots avant/après
- les décisions design tranchées (palette enrichie, fonts, animations)
- le hand-off vers le Sprint #2 (J4-J7)
```

### 6.3. Préparer la suite

Tu peux maintenant :

- **Continuer J4** (annotations) en mode normal — le design system est posé
- **Faire un Sprint #2** Claude Design plus tard (après J6 livré, pour les charts riches)

---

## Récap — la séquence complète

```
1. ✅ Brief rédigé (docs/claude-design-brief-sprint-1.md) — fait, sur GitHub
2. ⏳ Tu vas sur claude.ai/design avec le brief — 60-90 min
3. ⏳ Tu itères jusqu'à satisfaction sur les 11 écrans
4. ⏳ Tu exportes le handoff bundle
5. ⏳ Tu reviens sur Claude Code, /clear, colles le handoff
6. ⏳ Claude Code implémente, commits atomiques
7. ⏳ Tu valides visuellement, push origin/main
8. ⏳ Cleanup : CLAUDE.md update + close-out doc
```

---

## Aide directe en chat avec moi

Si tu bloques **à n'importe quelle étape**, reviens dans une session Claude Code et dis-moi :

- "Étape 2.X — Claude Design fait ça, je sais pas comment réagir"
- "Étape 4 — j'ai le handoff mais Claude Code dit X"
- "L'écran Y rendu par Claude Design ne me plaît pas, comment lui dire ?"

Je t'aiderai à formuler la suite.

**Bonne magie design.** ✨
