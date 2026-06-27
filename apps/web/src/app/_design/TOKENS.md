# Contrat des design tokens — DS-v3 (Session 1 Fondations)

> **Statut** : contrat **descriptif**, pas normatif-nouveau. Ce document fige le
> design system **déjà en production** (« DS-v3 ») tel qu'il existe dans
> `apps/web/src/app/globals.css`. Il n'introduit **aucun** changement de rendu —
> il documente la grammaire de tokens pour que les sessions 2 → 10 (et tout
> nouveau composant) consomment les bons tokens au lieu de réinventer des couleurs
> en dur. **SSOT réelle = `globals.css`** ; en cas de divergence, le CSS gagne et
> ce fichier doit être resynchronisé.

## 1. Architecture des tokens (pourquoi deux couches)

DS-v3 sépare **valeurs** et **exposition Tailwind** :

1. **Tokens privés** (`:root` et `.light` dans `globals.css`) — portent les
   valeurs `oklch(...)` ET le flip light/dark. Noms courts : `--bg`, `--t-1`,
   `--acc`, `--bad`, `--ok`, `--warn`, `--r-card`, `--sh-card`, `--e-snap`…
2. **Bloc `@theme inline`** (`globals.css:296-379`) — **ré-exporte** les tokens
   privés en `--color-*` / `--radius-*` / `--font-*` / `--shadow-*` / `--ease-*`
   via `var(...)`. **Seuls les tokens listés dans `@theme` génèrent des classes
   utilitaires Tailwind 4** (`bg-*`, `text-*`, `border-*`, `rounded-*`, `shadow-*`).

> ⚠️ **Règle d'or Tailwind 4** : une classe `bg-x` / `text-x` / `border-x` /
> `ring-x` ne fonctionne **que** si `--color-x` est défini dans `@theme`. Une
> classe référencée sans token `@theme` correspondant résout à **vide**
> (transparent / inherit) — c'était le bug `--color-destructive` (cf. §7).

Le thème par défaut est **sombre** (`:root`). Le mode clair s'active via la classe
`.light` (et un sur-thème `.light .v18-theme` pour les routes REFLECT) qui
**réassigne** les tokens privés sémantiques. Les rampes neutres brutes (`--n-*`)
et chroma (`--c-*`) ne flippent pas.

## 2. Couleurs sémantiques (`@theme` → privé)

| Classe Tailwind         | Token `@theme`      | Privé                        | Valeur DARK (`:root`)                | Valeur LIGHT (`.light`)         |
| ----------------------- | ------------------- | ---------------------------- | ------------------------------------ | ------------------------------- |
| `bg-bg`                 | `--color-bg`        | `--bg`                       | `oklch(0.085 0.02 254)`              | `oklch(0.968 0.005 256)`        |
| `bg-bg-1`               | `--color-bg-1`      | `--bg-1`                     | `oklch(0.13 0.028 254)`              | `oklch(1 0 0)`                  |
| `bg-bg-2`               | `--color-bg-2`      | `--bg-2`                     | `oklch(0.15 0.03 254)`               | `oklch(0.94 0.008 256)`         |
| `bg-bg-3`               | `--color-bg-3`      | `--bg-3`                     | `oklch(0.18 0.03 254)`               | `oklch(1 0 0)`                  |
| `text-text-1`           | `--color-text-1`    | `--t-1`                      | `oklch(0.929 0.005 256)`             | `oklch(0.24 0.02 262)`          |
| `text-text-2`           | `--color-text-2`    | `--t-2`                      | `oklch(0.762 0.013 256)`             | `oklch(0.42 0.02 260)`          |
| `text-text-3`           | `--color-text-3`    | `--t-3`                      | `oklch(0.604 0.02 257)`              | `oklch(0.5 0.022 258)`          |
| `text-text-4`           | `--color-text-4`    | `--t-4`                      | `oklch(0.62 0.022 257)`              | `oklch(0.48 0.022 258)`         |
| `bg-acc`                | `--color-acc`       | `--acc`                      | `oklch(0.62 0.19 254)` (#3b82f6)     | `oklch(0.52 0.2 260)` (#2563eb) |
| `*-acc-hi`              | `--color-acc-hi`    | `--acc-hi`                   | `oklch(0.74 0.16 250)`               | `oklch(0.46 0.2 262)`           |
| `text-acc-fg`           | `--color-acc-fg`    | `--acc-fg`                   | `oklch(0.98 0.01 247)`               | `oklch(0.99 0.01 247)`          |
| `bg-acc-dim`            | `--color-acc-dim`   | `--acc-dim`                  | `…254 / 0.16`                        | `…260 / 0.1`                    |
| `*-acc-2`               | `--color-acc-2`     | `--acc-2`                    | `oklch(0.55 0.21 262)` (#5b5bd6)     | `oklch(0.5 0.21 264)`           |
| `*-acc-2-hi`            | `--color-acc-2-hi`  | `--acc-2-hi`                 | `oklch(0.66 0.19 260)`               | `oklch(0.44 0.2 266)`           |
| `bg-acc-2-dim`          | `--color-acc-2-dim` | `--acc-2-dim`                | `…262 / 0.16`                        | `…264 / 0.12`                   |
| `*-cy`                  | `--color-cy`        | `--cy`                       | `oklch(0.789 0.139 217)` (#22d3ee)   | `oklch(0.52 0.12 220)`          |
| `*-dv-1/2/3`            | `--color-dv-1/2/3`  | `--acc` / `--acc-2` / `--cy` | (datavis : accent / accent-2 / cyan) | idem                            |
| `text-ok` / `bg-ok`     | `--color-ok`        | `--ok`                       | `oklch(0.804 0.181 145)` (#4ade80)   | `oklch(0.52 0.17 150)`          |
| `text-bad` / `bg-bad`   | `--color-bad`       | `--bad`                      | `oklch(0.7 0.165 22)` (#f87171)      | `oklch(0.53 0.2 25)` (#c92a26)  |
| `text-warn` / `bg-warn` | `--color-warn`      | `--warn`                     | `oklch(0.834 0.158 80)` (#fbbf24)    | `oklch(0.56 0.13 78)`           |

### Sémantique d'usage (à respecter)

- **Surfaces** : `bg` (fond app) < `bg-1` (carte) < `bg-2` (carte secondaire) <
  `bg-3` (élévation). En clair, `bg-1`/`bg-3` montent au blanc.
- **Texte** : `text-1` (primaire) → `text-2` (secondaire) → `text-3`/`text-4`
  (tertiaire / muted). Jamais de gris en dur — toujours un `text-N`.
- **Accent** : `acc` (bleu, action primaire), `acc-2` (indigo, secondaire),
  `cy`/`dv-*` (datavis). `acc-fg` = texte SUR accent.
- **États** : `ok` (succès/gain), `bad` (erreur/perte/danger), `warn`
  (attention). **Posture §2** : ces couleurs qualifient un ACTE/état de discipline,
  jamais une direction de marché.

## 3. Aliases legacy shadcn (`@theme`, `globals.css:321-339`)

Pont de compatibilité pour les composants issus de shadcn/ui. Chacun pointe sur un
token privé sémantique (donc flip light/dark hérité). À terme « Phase 2 migrera les
appelants » (commentaire `globals.css:321`) vers les noms DS-v3 — **ne pas en
ajouter de nouveaux** sauf compat d'un composant shadcn importé.

| Classe                                   | `@theme`                         | Pointe sur                             |
| ---------------------------------------- | -------------------------------- | -------------------------------------- |
| `bg-background`                          | `--color-background`             | `--bg`                                 |
| `text-foreground`                        | `--color-foreground`             | `--t-1`                                |
| `bg-primary` / `text-primary-foreground` | `--color-primary(-foreground)`   | `--acc` / `--acc-fg`                   |
| `bg-secondary` / `…-foreground`          | `--color-secondary(-foreground)` | `--bg-2` / `--t-1`                     |
| `bg-accent` / `…-foreground`             | `--color-accent(-foreground)`    | `--acc-hi` / `--acc-fg`                |
| `bg-muted` / `…-foreground`              | `--color-muted(-foreground)`     | `--t-3` / `--t-2`                      |
| `bg-card` / `…-foreground`               | `--color-card(-foreground)`      | `--bg-1` / `--t-1`                     |
| `text-success`                           | `--color-success`                | `--ok`                                 |
| `text-warning`                           | `--color-warning`                | `--warn`                               |
| `text-danger`                            | `--color-danger`                 | `--bad`                                |
| `*-destructive`                          | `--color-destructive`            | `--bad` — **alias API shadcn, cf. §7** |
| `border-border`                          | `--color-border`                 | `--b-default`                          |
| `bg-input`                               | `--color-input`                  | `--b-strong`                           |
| `ring-ring`                              | `--color-ring`                   | `--acc`                                |

## 4. Typographie (`globals.css:341-344`)

| Classe         | Token            | Pile                              |
| -------------- | ---------------- | --------------------------------- |
| `font-display` | `--font-display` | Geist Sans → Inter → system-ui    |
| `font-sans`    | `--font-sans`    | Inter → system-ui → -apple-system |
| `font-mono`    | `--font-mono`    | JetBrains Mono → ui-monospace     |

## 5. Rayons, ombres, eases

- **Rayons** (`globals.css:346-357`) : `rounded-control` 6px · `rounded-input`
  8px · `rounded-card` 12px · `rounded-card-lg` 16px · `rounded-hero` 20px ·
  `rounded-pill` 999px · `rounded-tooltip` 8px · plus l'échelle shadcn
  `rounded-sm/md/lg/xl` dérivée de `--radius` (0.625rem).
- **Ombres** (`globals.css:359-368`, multi-couches « Mercury-grade », flip
  light/dark) : `shadow-card`, `shadow-card-hover`, `shadow-card-primary`,
  `shadow-card-selected`, `shadow-modal`, `shadow-tooltip`, `shadow-toast`,
  `shadow-btn-pri`, `shadow-btn-pri-hover`.
- **Eases** (`globals.css:370-374`) : `ease-snap` (overshoot ressort) ·
  `ease-smooth` (sortie douce) · `ease-data` (linéaire-ish datavis) ·
  `ease-overshoot`.

## 6. Spacing — NON exposé à `@theme` (limite connue)

L'échelle 4-points `--s-1 … --s-16` (`globals.css:218-228`) et la largeur app
`--w-app: 1600px` existent en tokens privés mais **ne sont pas dans `@theme`** :
elles se consomment en `var(--s-n)`, **pas** via des classes Tailwind. C'est un
choix actuel (le spacing reste sur l'échelle Tailwind par défaut `p-4`, `gap-6`…).
Documenté ici pour éviter qu'une session aval croie à des classes `p-s-4`
inexistantes. **Ne pas exposer sans décision produit** (élargirait la surface
d'API).

## 7. Correctif `--color-destructive` (Session 1)

**Bug corrigé** : `button.tsx` (`:8` état `aria-invalid`, `:14` variant
`destructive`) utilise `bg-destructive` / `border-destructive` /
`ring-destructive`. En Tailwind 4 ces classes résolvent `var(--color-destructive)`,
qui **n'était pas défini** dans `@theme` → classes mortes (bordure/ring
transparents, fond absent). Aucun `variant="destructive"` n'est utilisé
aujourd'hui, mais l'état `aria-invalid` s'applique à **tout bouton** en erreur de
formulaire → bug latent atteignable.

**Correctif (additif, 0 régression)** : ajout de `--color-destructive: var(--bad)`
dans le bloc d'alias `@theme`, jumeau `--color-danger` côté API shadcn. Contraste
vérifié **WCAG 2.2 AA** : blanc sur `--bad` = **5.45:1** (light) / **~6.2:1**
(dark `/60`) ; bordure/ring `aria-invalid` (cible non-texte 3:1) = **4.78:1**
light / **6.3:1** dark. `--color-destructive-foreground` n'est **pas** ajouté :
non référencé (`button.tsx` utilise `text-white` en dur) → YAGNI.

## 8. Règles pour les sessions aval

1. **Jamais de couleur en dur** dans un composant — toujours une classe DS-v3
   (`bg-bg-1`, `text-text-2`, `text-bad`…). Une valeur `#xxxxxx` ou `oklch(...)`
   inline est une dette à refuser en review.
2. **Nouveau token** = l'ajouter en privé (`:root` + `.light`) PUIS l'exposer dans
   `@theme`. Sans l'étape `@theme`, pas de classe utilitaire.
3. **Pas de nouvel alias legacy** sauf compat d'un composant shadcn importé.
4. **Light + dark obligatoires** : tout token sémantique doit avoir sa valeur
   `.light`. Vérifier au runtime dans les **deux** thèmes (canon des sessions
   frontend : auditer les pages AUTH, pas que le public).

## 9. Session 9 — CP1 (consolidation du design system)

Ajouts **100 % additifs** (aucun contrat existant cassé ; S4/S6/S7/S8 consomment sans friction).

- **Boutons — source unique `Btn`** (`components/ui/btn.tsx`, 4 kinds × 3 sizes ×
  6 états, touch ≥ 44px). `button.tsx` (shadcn legacy) est **déprécié** et retiré
  du rendu (son unique usage, le « Close » de `DialogFooter`, est migré vers
  `Btn kind="secondary"`). Toute nouvelle UI utilise `Btn` ; `button.tsx` reste
  uniquement pour l'alias `--color-destructive` (§7), suppression à confirmer.
- **Échelle z-index sémantique** (`globals.css`, `:root`) : `--z-below` (-1) ·
  `--z-base` (0) · `--z-content` (10) · `--z-nav` (30) · `--z-sticky` (35) ·
  `--z-overlay` (40) · `--z-modal` (50) · `--z-toast` (60). Reprend l'empilement
  déjà en place ; se consomme via `z-[var(--z-nav)]`. Migration des z-index en dur
  = incrémentale (non bloquante).
- **Primitives d'état de données** :
  - `<Skeleton>` / `<SkeletonText>` (`components/ui/skeleton.tsx`) — wrappe `.skel`,
    `aria-hidden`, neutralisé sous `prefers-reduced-motion`.
  - `<DataState status loading empty error>` (`components/ui/data-state.tsx`) —
    aiguilleur `loading / empty / error / ready`, framework-neutre (server +
    client). Compose `<EmptyState>` / `<ErrorState>` existants. Supprime les
    écrans morts ; les skeletons bespoke (anti-CLS) restent valables.
- **Vitrine vivante** : route **dev-only** `/design` (`app/design/page.tsx` →
  `components/design-system/showcase.tsx`, `notFound()` en production). Ancre
  anti-régression : tokens couleur, typographie, boutons, pills, cartes, états de
  données et dialog réunis sur une page. À vérifier en light **et** dark.

> **Couches composants / motion / layout / contrats** → ce fichier documente la
> couche **tokens**. L'API des composants primitifs (`Btn`, `Card`, `Pill`,
> `DataState`…), les patterns d'animation (60 fps compositor-only,
> reduced-motion, `HoverLift`/`AnimatedNumber`…), l'échelle typographique nommée
> `.t-*`, les conventions de layout/responsive (`--w-app`, breakpoints, grilles)
> et les contrats de consommation aval sont documentés dans
> [`DESIGN-SYSTEM.md`](./DESIGN-SYSTEM.md) (export S9, DoD §35 box 3-4).
