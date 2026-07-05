# Design System DS-v3 — export & contrats de consommation (Session 9)

> **Statut** : contrat **descriptif**, pas normatif-nouveau. Ce document fige le
> design system **déjà en production** tel qu'il existe dans le code
> (`apps/web/src/app/globals.css` + `apps/web/src/components/ui/**`). Il
> n'introduit **aucun** changement de rendu — il documente la grammaire pour que
> les surfaces aval (espace membre, fonctionnalités avancées, admin,
> entraînement) consomment les bons tokens/composants au lieu de réinventer.
> **SSOT réelle = le code** ; en cas de divergence, le code gagne et ce fichier
> doit être resynchronisé.
>
> **Périmètre / non-duplication.** La couche **tokens** (couleurs sémantiques,
> rampes, aliases shadcn, rayons/ombres/eases, règle d'or Tailwind 4) est
> documentée dans [`TOKENS.md`](./TOKENS.md) — ne pas la redupliquer. **Ce
> document couvre les 4 couches que `TOKENS.md` ne détaille pas** : §1 familles
> de tokens transverses (rappel + lignes), §2 typographie nommée `.t-*`, §3
> motion & performance, §4 API des composants primitifs, §5 conventions de
> layout/responsive, §6 contrats de consommation pour les sessions aval.

---

## 1. Tokens — rappel d'architecture & familles transverses

Voir [`TOKENS.md`](./TOKENS.md) pour les valeurs complètes light/dark. Rappel de
la **structure 3 couches** (vérifiée `globals.css:31-404`) :

1. **Primitives** (`:root`) : rampe neutre `--n-50…--n-950` (`globals.css:55-66`),
   rampe cyan `--c-300…--c-600` (`globals.css:69-72`). Brutes, ne flippent pas.
2. **Tokens sémantiques** (`--bg`, `--t-1`, `--acc`, `--ok`…) : seule couche que
   `.light` (`globals.css:420-534`) redéclare. ~3137 consommateurs `var(--…)`
   suivent automatiquement (`globals.css:401-404`).
3. **Exposition Tailwind** : `@theme inline` (`globals.css:310-394`) ré-expose en
   `--color-*` / `--radius-*` / `--shadow-*` / `--ease-*`. **Seuls les tokens
   listés là génèrent une classe utilitaire** (règle d'or, `TOKENS.md` §1).

`@custom-variant dark` (`globals.css:31`) keye le `dark:` sur la classe `.dark`
(next-themes), pas sur `prefers-color-scheme`.

Familles transverses **présentes dans le code** mais peu détaillées dans
`TOKENS.md` (à connaître pour ne pas les réinventer) :

| Famille                                               | Tokens (dark)                                                                                                                                        | Lignes                           |
| ----------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------- |
| Accent — fond CTA                                     | `--acc-btn` `oklch(0.54 0.19 264)` (#3364db, label blanc 4.97:1), `--acc-btn-hover` (5.92:1)                                                         | `globals.css:112-113`            |
| Accent — fills/edges/glows                            | `--acc-dim`, `--acc-dim-2`, `--acc-edge`, `--acc-glow`, `--acc-glow-strong`                                                                          | `globals.css:102-106`            |
| Cyan secondaire (charts/jauges, **jamais CTA**)       | `--cy`, `--cy-dim`, `--cy-dim-strong`, `--cy-edge-soft`, `--cy-edge`, `--cy-glow`, `--cy-glow-strong`                                                | `globals.css:114-127`            |
| Indigo `acc-2` (2ᵉ série data, **jamais CTA**)        | `--acc-2`, `--acc-2-hi`, `--acc-2-dim`, `--acc-2-dim-2`, `--acc-2-edge`, `--acc-2-glow`                                                              | `globals.css:136-141`            |
| Data-viz catégoriel (alias qui flippent)              | `--dv-1`=`acc`, `--dv-2`=`acc-2`, `--dv-3`=`cy` (+ `-dim`/`-edge`) → `--color-dv-1…3`                                                                | `globals.css:143-158`, `328-330` |
| Brand gradient (décoratif, **jamais fond de bouton**) | `--grad-brand` (135deg bleu→indigo→cyan), `--grad-brand-soft`                                                                                        | `globals.css:166-177`            |
| États étendus                                         | `--ok/-hi/-dim/-dim-2/-edge/-glow`, `--bad/…`, `--warn/…`, `--mute-dim`                                                                              | `globals.css:180-207`            |
| Bordures                                              | `--b-subtle` `/0.08`, `--b-default` `/0.14`, `--b-strong` `/0.22`, `--b-stronger` `/0.34`, `--b-acc` `/0.42`, `--b-acc-strong` `/0.65`, `--b-danger` | `globals.css:90-96`              |
| Ombres multi-couches                                  | `--sh-card`, `-hover`, `-primary`, `-selected`, `-modal`, `-tooltip`, `-toast`, `-btn-pri`, `-btn-pri-hover`                                         | `globals.css:237-262`            |
| Z-index sémantique                                    | `--z-below` -1 · `--z-base` 0 · `--z-content` 10 · `--z-nav` 30 · `--z-sticky` 35 · `--z-overlay` 40 · `--z-modal` 50 · `--z-toast` 60               | `globals.css:272-279`            |
| Focus ring                                            | `--ring` `0 0 0 2px var(--bg), 0 0 0 4px var(--acc)`                                                                                                 | `globals.css:265`                |

**Grammaire finance non négociable** (posture §2) : `ok`=vert (long/gain),
`bad`=rouge (short/perte), `warn`=ambre (en cours). Ces couleurs qualifient un
**acte/état de discipline**, jamais une direction de marché.

---

## 2. Typographie — échelle nommée `.t-*`

Helpers de famille (`globals.css:762-775`) : `.f-display` (Geist, `ls -0.02em`,
`ss01`), `.f-body` (Inter), `.f-mono` / `.tnum` (JetBrains Mono, `tabular-nums`).
Familles déclarées `@theme` (`globals.css:360-363`) : `--font-display` (Geist→Inter),
`--font-sans` (Inter), `--font-mono` (JetBrains Mono).

| Classe                    | Taille                 | Poids  | line-height | Famille | Usage                                                                                                                   | Réf.                  |
| ------------------------- | ---------------------- | ------ | ----------- | ------- | ----------------------------------------------------------------------------------------------------------------------- | --------------------- |
| `.t-display`              | 68px                   | 800    | 0.96        | display | Hero desktop, `ls -0.04em`, `ss01`                                                                                      | `globals.css:777-784` |
| `.t-display-fluid`        | `clamp(36px,7vw,56px)` | 800    | 0.96        | display | Hero fluide mobile (wizards REFLECT), `overflow-wrap:anywhere`+`hyphens:auto`                                           | `:794-803`            |
| `.t-h1`                   | 32px                   | 700    | 1.05        | display | Titre de page, `ls -0.03em`                                                                                             | `:804-810`            |
| `.t-h2`                   | 20px                   | 600    | 1.2         | display | Sous-titre de section, `ls -0.015em`                                                                                    | `:811-817`            |
| `.t-h3`                   | 15px                   | 600    | 1.3         | display | Titre de carte/bloc, `ls -0.005em`                                                                                      | `:818-824`            |
| `.t-question`             | `clamp(21→26px)`       | 600    | 1.3         | display | Énoncés longs (onboarding/wizard)                                                                                       | `:830-838`            |
| `.t-lead`                 | 16px                   | 400    | 1.55        | sans    | Chapô/intro, couleur `--t-2`                                                                                            | `:839-845`            |
| `.t-body`                 | 13px                   | hérité | 1.55        | sans    | Corps standard, couleur `--t-2`                                                                                         | `:846-851`            |
| `.t-cap`                  | 11px                   | hérité | 1.45        | sans    | Légende, couleur `--t-3`                                                                                                | `:852-857`            |
| `.t-mono-cap`             | 11px                   | hérité | 1.3         | mono    | Caption numérique tabulaire, `--t-3`                                                                                    | `:858-864`            |
| `.t-eyebrow` / `.eyebrow` | **10px**               | 500    | hérité      | sans    | Eyebrow **compact** (KPI strips), `ls 0.14em`, `uppercase`, couleur **bakée** `--t-3`                                   | `:865-873`            |
| `.t-eyebrow-lg`           | **12px**               | 500    | hérité      | sans    | Eyebrow **standard** (labels form/section), `ls 0.10em`, `uppercase`, **couleur agnostique** (fournie par le call-site) | `:888-894`            |
| `.t-foot`                 | 10px                   | hérité | 1.4         | sans    | Footnote, `italic`, couleur `--t-4`                                                                                     | `:895-901`            |

> ⚠️ **Divergence eyebrow voulue** (`globals.css:874-887`, commentaire « Do not
> "harmonize" them ») : `.t-eyebrow` (10px) et `.t-eyebrow-lg` (12px) divergent
> sur **3 axes** — taille (10/12), tracking (`0.14em`/`0.10em`), couleur (bakée
> vs agnostique). Ce ne sont **pas** deux tailles d'une même paire ; ne pas les
> fusionner.

---

## 3. Motion & performance

### Wrapper global

`MotionProvider` (`motion-provider.tsx:30-36`) monte **un seul**
`<LazyMotion features={domAnimation} strict>` enveloppant `<MotionConfig
reducedMotion="user">` :

- `domAnimation` (pas `domMax`) = ~50 % de bundle en moins, délibéré (zéro
  `layout`/`drag`/`Reorder` dans l'app, `:13-17`).
- `strict` fait **throw** tout `motion.*` résiduel → l'app utilise l'alias `m.*`
  partout (`hover-lift.tsx:3`, `reveal.tsx`, `training-form-wizard.tsx:45`…).
- `reducedMotion="user"` délègue à la préférence OS au niveau Framer (`:33`).

### Règle 60 fps — compositor-only

Règle **non négociable pour toute animation récurrente / en boucle**
(`globals.css:1288-1297`, `1833-1852`, `2129-2477`) : un keyframe **bouclé**
n'anime **que `transform` / `opacity`**. Les glows sont peints **une fois**
(`box-shadow` sur un `::after`) et seule l'opacité/scale du `::after` pulse —
**jamais** de `box-shadow` animé **en boucle**. `will-change: transform, opacity`
posé sur les orbes (`.ds-orb`, `.v18-orb`, `.login-orb`, `.splash-*`). Les boucles
ambiantes infinies sont **CSS-class-driven** (pas Framer `repeat:Infinity`) pour
que reduced-motion les neutralise (`globals.css:1425-1436`).

**Exception bornée — transients one-shot** : deux keyframes déclenchés par un geste
utilisateur isolé peignent une propriété non-compositor sur une **durée finie, non
bouclée**, sans `infinite` : `thresholdPulse` (`box-shadow` spread, 600ms,
`globals.css:1284-1286`) et `confirmFlash` (`background-color`, 700ms,
`globals.css:1383-1385`). Bornés, ils ne menacent pas le budget 60 fps et le filet
`prefers-reduced-motion` les neutralise.

**Exception assumée — shimmer skeleton (boucle infinie, non-compositor)** : `shimmer`
(`globals.css:1322-1329`) anime `background-position` (-200%→200%, **non**
compositor) en boucle `infinite` sur `.skel` (`globals.css:1340`) — ce n'est PAS un
one-shot. Toléré quand même car (a) **éphémère** : un skeleton n'est monté que le
temps d'un chargement puis démonté (jamais une surface persistante) ; (b)
reduced-motion le neutralise réellement (`animation-iteration-count:1` du filet
`globals.css:1483-1492` le fige sur une frame) ; (c) aire peinte faible, sans
`box-shadow` ni second paint concurrent. **Ne jamais l'étendre** à une surface
durable : un repaint `background-position` en boucle sur un large bloc menacerait le
budget. **Consigne S4/6/7/8** : pour une animation **récurrente**, rester strictement
`transform`/`opacity` ; un paint non-compositor n'est toléré que sur un transient
one-shot lié à un geste, ou un loader éphémère reduced-motion-safe comme `shimmer`.

### Wrappers réutilisables (`components/ui/`, tous `'use client'`, no-op sous reduced-motion)

| Composant                                           | Comportement                                                                                                                                                                                         | Réf.                         |
| --------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------- | -------------------------------------------------------------------------------------------- | --------------------------- |
| `AnimatedNumber`                                    | Count-up via `animate()` impératif écrivant `ref.textContent` → **0 re-render React/frame**. SSR rend la valeur finale (pas de flash « 0 »). Court-circuit total si reduced-motion ; `tabular-nums`. | `animated-number.tsx:66-123` |
| `HoverLift`                                         | spring 310/22/0.7, `whileHover {scale:1.02, y:-2}`, `whileTap {scale:0.98}`. GPU only.                                                                                                               | `hover-lift.tsx:29-43`       |
| `HoverGlowLift`                                     | même spring + halo `.wow-hover-glow` (opacité seule transitionne). `tone:'acc'                                                                                                                       | 'cy'                         | 'indigo'`, `noLift`. **Interdit sur surface `glass`\*\* (conflit backdrop-filter+transform). | `hover-glow-lift.tsx:39-59` |
| `Reveal` / `RevealGroup`                            | entrée `y`+opacity, `once` par défaut, `stagger` 70ms (group).                                                                                                                                       | `reveal.tsx:31-81`           |
| `Tilt3D`, `Magnetic`, `Spotlight`, `GradientBorder` | décoratifs compositor-only, ignorent pointeurs coarse / souris-only.                                                                                                                                 | `globals.css:2464-2576`      |

### Classes d'orchestration

- `.page-stagger > *` : entrée échelonnée (`wowRise`, délais 60→300ms, `both`) ;
  opt-out `[data-self-animate]` ; garde reduced-motion (`globals.css:1909-1941`).
- `.wow-rise`, `.wow-reveal` (scroll-driven `animation-timeline: view()`, fallback
  visible), `.wow-hover-glow` (+`-cy`/`-2`), `.celebrate-pop`/`-halo`,
  `.milestone-settle` (`globals.css:1957-2095`).

### Eases nommés (`globals.css:230-234`, exposés `--ease-*` `389-393`)

`--e-snap` `cubic-bezier(0.5,1.5,0.5,1)` · `--e-smooth` `cubic-bezier(0.22,1,0.36,1)`
· `--e-data` `cubic-bezier(0.4,0,0.2,1)` · `--e-overshoot` `cubic-bezier(0.34,1.56,0.64,1)`.

### `prefers-reduced-motion` — défense en profondeur

1. **Filet global** (`globals.css:1483-1492`) : `*,*::before,*::after` →
   `animation-duration:0.01ms`, `iteration-count:1`, `transition-duration:0.01ms`,
   `scroll-behavior:auto` (tous `!important`).
2. **Gardes explicites** sur login orbs/WOW (`:2101-2119`), splash (`:2242-2267`),
   page-stagger — épinglent l'état final visible.
3. **Framer** : `MotionConfig reducedMotion="user"` + `useReducedMotion()` dans
   chaque wrapper.
4. `forced-colors: active` retire orbes/glows décoratifs (`:1506-1533`, etc.).

---

## 4. Composants primitifs — API

> Inventaire de `apps/web/src/components/ui/`. Toutes les props/défauts/types sont
> lus dans le code source (cités `fichier:ligne`). **Invariant transverse** :
> chaque primitive pose un `data-slot` (ancre CSS stable, anti-drift). Pour `Card`
> c'est `data-slot="card"` qui porte l'anti-bordure-blanche (aucune bordure en dur
> côté JS, couleurs via `var(--b-*)`).

### 4.1 `Btn` — contrôle primaire (**source unique**)

`import { Btn, btnVariants } from '@/components/ui/btn';`

| Prop      | Type        | Défaut      | Réf.                                                     |
| --------- | ----------- | ----------- | -------------------------------------------------------- | --------- | ------------------ | ------------------ |
| `kind`    | `'primary'  | 'secondary' | 'ghost'                                                  | 'danger'` | `'primary'`        | `btn.tsx:12-21,29` |
| `size`    | `'s'        | 'm'         | 'l'`                                                     | `'m'`     | `btn.tsx:22-26,30` |
| `kbd`     | `ReactNode` | —           | `btn.tsx:41` (badge `<Kbd inline>`)                      |
| `loading` | `boolean`   | —           | `btn.tsx:43` (`<Spinner>`, force `aria-busy`+`disabled`) |
| `type`    | natif       | `'button'`  | `btn.tsx:55`                                             |

`EmptyState` réutilise `btnVariants` pour styler un `<Link>` (`empty-state.tsx:127`).
L'ancien `Button` shadcn (`button.tsx`) est **`@deprecated`** (`button.tsx:39-45`) —
plus aucun consommateur en rendu, conservé pour l'alias `--color-destructive`.
**Tout nouveau bouton → `Btn`.**

### 4.2 `Card` — surface de base

`import { Card } from '@/components/ui/card';`

| Prop          | Type      | Défaut | Réf.                                                                            |
| ------------- | --------- | ------ | ------------------------------------------------------------------------------- |
| `primary`     | `boolean` | —      | `card.tsx:8` (glow accent)                                                      |
| `selected`    | `boolean` | —      | `card.tsx:10` (ring accent ; exclusif avec `primary`)                           |
| `interactive` | `boolean` | —      | `card.tsx:12` (hover border-strong + shadow-card-hover)                         |
| `edge`        | `boolean` | `true` | `card.tsx:14,38` (ligne gradient bord sup., pattern Linear)                     |
| `glass`       | `boolean` | —      | `card.tsx:22` (`.glass-panel` ; **ne pas combiner avec un wrapper transformé**) |

### 4.3 `Pill` — badge de statut

`import { Pill } from '@/components/ui/pill';`

| Prop   | Type     | Défaut  | Réf. |
| ------ | -------- | ------- | ---- | ------------------------------------------------ | ------ | ---- | -------- | -------- | ---------------- |
| `tone` | `'mute'  | 'acc'   | 'ok' | 'bad'                                            | 'warn' | 'cy' | 'solid'` | `'mute'` | `pill.tsx:11-21` |
| `dot`  | `boolean | 'live'` | —    | `pill.tsx:29` (`'live'` → animation `.live-dot`) |

### 4.4 → 4.13 — autres primitives (résumé)

| Composant                   | Import                            | Points clés                                                                                                                                                                                                                                          | Réf.                        |
| --------------------------- | --------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------- | ------- | --------------------------------------------------------------------------------- | --------------------- |
| `Kbd`                       | `@/components/ui/kbd`             | `inline` (transparent, insertion dans Btn/Pill)                                                                                                                                                                                                      | `kbd.tsx:5-13`              |
| `EmptyState`                | `@/components/ui/empty-state`     | 6 strates : `icon`(`Target`)/`headline`/`lead`/`guides[]`/`tip`/`ctaPrimary`+`ctaHref`(`<Link>`)/`ctaSecondary`/`onPrimary`/`onSecondary`/`headingLevel`(`'h2'`)                                                                                     | `empty-state.tsx:8-43`      |
| `ErrorState`                | `@/components/ui/error-state`     | client ; `headline`/`action`/`cause`(repliable)/`onRetry`/`headingLevel`                                                                                                                                                                             | `error-state.tsx:9-26`      |
| `DataState`                 | `@/components/ui/data-state`      | aiguilleur `'loading'                                                                                                                                                                                                                                | 'empty'                     | 'error' | 'ready'`; **server-safe** (aucun hook) ;`loading`défaut`<SkeletonText lines={4}>` | `data-state.tsx:5-37` |
| `Skeleton` / `SkeletonText` | `@/components/ui/skeleton`        | `circle` ; `lines`(`3`) ; `data-slot="skeleton"`+`aria-hidden`                                                                                                                                                                                       | `skeleton.tsx:5-49`         |
| `InfoDot`                   | `@/components/ui/info-dot`        | client, **Radix Popover** (tap mobile) ; `tip`(req)/`label`/`side`(`'top'`)/`width`(`240`)                                                                                                                                                           | `info-dot.tsx:9-23`         |
| `Code`                      | `@/components/ui/code`            | passe-plat `<code>`, classes DS centralisées                                                                                                                                                                                                         | `code.tsx:16-19`            |
| `Sparkline`                 | `@/components/ui/sparkline`       | client, 0-dep SVG ; `data`(req, null si <2) ; `width`140/`height`36/`color``var(--acc)`/`strokeWidth`(`1.5`)/`fill`/`showLastDot`/`animate`/`duration`(`1400`)/`ariaLabel`                                                                           | `sparkline.tsx:8-30`        |
| `AnimatedNumber`            | `@/components/ui/animated-number` | `value`(req)/`decimals`/`prefix`/`suffix`/`durationMs`900/`startOnView`. **`format` non sérialisable RSC** → depuis un Server Component utiliser `decimals/prefix/suffix`                                                                            | `animated-number.tsx:43-64` |
| `SuccessState`              | `@/components/ui/success-state`   | server-safe (aucun hook) ; `role="status"` (⇒ aria-live polite) ; `headline`/`children`/`icon`(`Check`)/`size`(`'inline'`) — 4e état vivant §33bis-2 (succès / feedback), tokens uniques `--b-acc`/`--acc-dim`/`rounded-card`, posture Douglas sobre | `success-state.tsx:6-15`    |

### 4.14 Primitives Radix encapsulées

Ré-exports Radix avec `data-slot` + classes DS. Props = celles du primitive Radix

- extras :

| Composant | Sous-composants                                                                 | Extras (défaut)                                                                                                  | Réf.                  |
| --------- | ------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- | --------------------- | ---------------- |
| `Tabs`    | `Tabs, TabsList, TabsTrigger, TabsContent, tabsListVariants`                    | `TabsList.variant` `'default'                                                                                    | 'line'` (`'default'`) | `tabs.tsx:11-81` |
| `Dialog`  | `Dialog, …Trigger/Portal/Close/Overlay/Content/Header/Footer/Title/Description` | `DialogContent.showCloseButton`(`true`) ; `DialogFooter.showCloseButton`(`false`, rend `<Btn kind="secondary">`) | `dialog.tsx:45-144`   |
| `Popover` | `Popover, …Trigger/Content/Anchor/Header/Title/Description`                     | `PopoverContent.align`(`'center'`)/`.sideOffset`(`4`)                                                            | `popover.tsx:18-74`   |
| `Tooltip` | `Tooltip, …Trigger/Content/Provider`                                            | `Provider.delayDuration`(`0`) ; `Content.sideOffset`(`0`)                                                        | `tooltip.tsx:9-53`    |
| `Sheet`   | `Sheet, …Trigger/Close/Content/Header/Footer/Title/Description`                 | `SheetContent.side`(`'right'`)/`.showCloseButton`(`true`)                                                        | `sheet.tsx:44-134`    |
| `Slider`  | `Slider`                                                                        | `min`(`0`)/`max`(`100`) + props Radix                                                                            | `slider.tsx:11-58`    |

### 4.15 Wrappers décoratifs

`HoverLift`, `HoverGlowLift`, `Tilt3D`, `Magnetic`, `Spotlight`, `GradientBorder`,
`Reveal`, `RevealGroup` — cf. §3 (compositor-only, no-op reduced-motion,
décoratifs ; l'interactivité réelle vit dans `children`).

---

## 5. Conventions de layout & responsive

### Largeur d'app — `--w-app: 1600px`

Token privé unique (`globals.css:52`), **non exposé à `@theme`** : se consomme via
`max-w-[var(--w-app)]`, jamais une classe `max-w-w-app`. SSOT des shells
full-width (dashboard, admin, analytics) — « no `max-w-[1600px]` drift ».

### Wrapper de page type (vérifié identique sur 7+ pages)

```html
relative mx-auto flex w-full max-w-[var(--w-app)] flex-1 flex-col gap-6 px-4 py-8 lg:px-8 2xl:px-12
```

`journal:94`, `objectifs:60`, `reunions:39`, `admin:56`, `admin/reports:94`,
`admin/members:92`, `verification:143`. Le dashboard varie le bottom safe-area :
`pb-[max(1.5rem,env(safe-area-inset-bottom))]` (`dashboard:231`, idem
`progression:89`, `patterns:77`). Les `loading.tsx` miroirent le conteneur (0 CLS).

### Breakpoints

Pas de `tailwind.config.*` (Tailwind v4 CSS-first) → **défauts `sm/md/lg/xl/2xl`**.
Conventions : padding `px-4` → `lg:px-8` → `2xl:px-12` ; gate sidebar/gutter à
`lg` (1024px) ; gate orbe mobile `@media (max-width:640px)` (`globals.css:1088`).

### Grille responsive dominante — `grid lg:grid-cols-2` + `items-start`

« 1 colonne mobile → 2 colonnes desktop, alignées en haut ». `items-start`
(au lieu de `stretch`) empêche deux cartes de hauteurs différentes de s'étirer
mutuellement. Ex. `dashboard:302,316,425,563`, `verification:227`, `journal:250`.

### Règle « 0 chevauchement / plein écran »

Backplate ambient `.app-ambient` (`globals.css:998-1013`) : `position:fixed;
inset:0; z-index:-1`, rendu **une seule fois** dans le layout root
(`app/layout.tsx:120`). Sur ultra-wide, les pages à `<main>` transparent révèlent
le mesh deep-space dans leurs gouttières au lieu d'une bande noire. Échelle
z-index sémantique anti-chevauchement (`globals.css:272-279`, cf. §1).

> Exception documentée : `admin/members/[id]:340` utilise `max-w-6xl` (1152px) au
> lieu de `--w-app` — choix délibéré (mesure de lecture des rapports IA, `:332-338`).

---

## 6. Contrats de consommation (espace membre / avancées / admin / entraînement)

> Il n'existe pas de routes nommées `s4/s6/s7/s8`. Les surfaces correspondantes
> sont : **espace membre** (`dashboard`, `journal`, `checkin`, `track`,
> `objectifs`, `progression`…), **fonctionnalités avancées** (`pre-trade`,
> `scoring`, `verification`, `library`), **admin** (`app/admin/**`),
> **entraînement** (`app/training/**`). Le contrat ci-dessous est celui qu'elles
> consomment réellement.

### Règle d'or : aucune couleur en dur

Tout passe par les tokens DS-v3 → utilitaires Tailwind (`bg-*`, `text-*`,
`border-*`, `shadow-*`) ou arbitrary values (`text-[var(--t-3)]`,
`bg-[var(--acc-btn)]`, `shadow-[var(--sh-toast)]`). Un `#xxxxxx`/`oklch()` inline
dans un composant est une **dette à refuser en review** (`TOKENS.md` §8).

### Primitives partagées

127 imports / 69 fichiers depuis `@/components/ui/{card,btn,pill,empty-state,
data-state,skeleton,tooltip,dialog}`. Échantillon vérifié :

- **Admin** : `admin/page.tsx:17-19` importe `AnimatedNumber`/`HoverGlowLift`/`Pill` ;
  16 panels admin importent `Card`.
- **Entraînement** : `training/page.tsx:14-17` importe `btnVariants`/`Card`/
  `EmptyState`/`HoverGlowLift` ; 11 composants `components/training/*` importent
  les primitives.
- **Espace membre / avancées** : `components/dashboard/*`, `components/checkin/*`,
  `components/scoring/*`, `components/pre-trade/*` importent tous `Card` (+`Pill`/`Btn`).

### Classes typographiques `.t-*`

Consommées sur ≥30 pages (cf. §2). Rappel : `.t-eyebrow` ne pose **pas** de
couleur — chaque call-site fournit `text-[var(--t-3)]` etc.

### Showcase `/design` — ancre anti-régression

Route **dev-only** (`app/design/page.tsx:17-20`, `notFound()` si
`NODE_ENV === 'production'` → jamais exposée aux membres). Réunit tokens couleur,
typographie `.t-*`, et primitives `Btn`/`Card`/`DataState`/`Dialog`/`EmptyState`/
`ErrorState`/`Pill`/`Skeleton` (`components/design-system/showcase.tsx`). **À
vérifier en light ET dark** à chaque évolution du DS.

### Règles imposées aux sessions aval (`TOKENS.md:143-153`)

1. Jamais de `#xxxxxx`/`oklch()` inline → toujours une classe DS-v3.
2. Nouveau token = privé (`:root`+`.light`) **puis** `@theme`, sinon pas de classe.
3. Pas de nouvel alias legacy shadcn sauf compat d'un composant importé.
4. Light + dark obligatoires (vérif **runtime** des deux thèmes, pages AUTH incluses).
