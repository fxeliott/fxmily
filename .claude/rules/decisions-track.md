---
paths:
  - 'apps/web/src/app/track/**'
  - 'apps/web/src/app/tracking/**'
  - 'apps/web/src/components/track/**'
---

# Decisions verrouillees — track

Extrait de `apps/web/CLAUDE.md` le 2026-08-04. Ces decisions sont OPPOSABLES :
ce sont des landmines anti-regression, pas de l historique. Le frontmatter
`paths:` ci-dessus les charge uniquement quand on touche les fichiers concernes
— sans lui, elles seraient chargees a chaque lancement et la scission
n economiserait rien. Contexte complet du jalon : `docs/web/jalons-history.md`.

## V2.1.0 — TRACK module frontend bootstrap (/track + Sleep wizard) (livré 2026-05-15)

### Décisions clés

- Subagent web-research 6 axes « premium frontend 2026 » + 2 sub-agents post-impl (a11y SHIP-READY 0 TIER 1 ; ui-designer 0 BLOCKER) → 3 fixes in-PR : track-hero glow bug (`--acc-glow` shadow-token sur `stopColor`) + picker `<Pill tone=mute>` + suppression ARIA dead code.
- Recharts/SVG couleurs via hex `C` (`@/lib/theme-colors`), jamais `var()` (bug WebView iOS J6.6).

## V2.1.1 — TRACK 4 wizards restants + clôture module frontend 5/5 (livré 2026-05-15)

### Décisions clés

- 3 sub-agents parallèle (a11y + ui-designer + code-reviewer) **0 TIER 1**, code-reviewer READY-TO-MERGE → 3 fixes in-PR : `focus-visible` déplacé sur `<Link>` (WCAG 2.4.7 — corrige aussi un latent sleep-picker V2.1.0) + `aria-live=polite` parité SR + retrait regex-gate caffeine client (anti silent-drop ; Zod serveur = SSOT).
- Différés rationale : `aria-pressed` vs APG radiogroup (collision flèches step-nav, pattern V1.5 accepté, pas un échec AA) + naming/TZ `lastDrinkAtUtc` (schéma V2.0 hors scope).

## V2.1.5 — TrackHero premium enrich (ambient layer) + e2e flake root-cause (livré 2026-05-16)

### Décision clé (landmine)

- **code-reviewer TIER 2 MUST-FIX** : framer `repeat:Infinity` n'est PAS tué par le filet `@media (prefers-reduced-motion:reduce)`. Corrigé via pattern canon mirror-hero : loop ambient = **classe CSS `.track-*`** (tuée par le filet `transition-duration:.01ms!important`) + pulse double-gardé `!reduceMotion`. **Invariant : loop infini = classe CSS tuée par le filet, JAMAIS framer `repeat:Infinity`. Entrance framer finie ≤0.8s OK.**

## V2.1.3 — Habit×Trade correlation card + 7-day heatmap (livré 2026-05-16)

### Décisions clés (DIVERGENT du blueprint — NE PAS « corriger »)

1. **PAS d'IC sur `r`** : `wilson.ts` = IC de proportion (win-rate), statistiquement FAUX pour Pearson ; pas de Fisher-z repo. → tier `confidence: low|adequate` (`MIN_CORRELATION_PAIRS=8` / `SUFFICIENT_SAMPLE_MIN=20`).
2. **Appariement = `localDateOf(enteredAt,'Europe/Paris')`** (jour de décision), PAS `closedAt`. Filtre trades : `closedAt!=null AND realizedR!=null AND realizedRSource='computed'`.
3. Recharts couleurs hex `C`, pas `var()` (bug WebView iOS — le web-research « CSS vars » est FAUX ici).
4. Scatter SANS trend/regression line — seulement `ReferenceLine y=0` (posture Mark Douglas arbitre une tension réelle entre 2 sub-agents).
5. **+1j slack symétrique de fetch** (asymétrie bord-de-fenêtre requête-UTC vs pairing-Paris).

- Honnêteté structurelle : union discriminée `CorrelationStatus` — la branche `insufficient_data` n'a **pas** de champ `r` (impossible de rendre un coefficient si n<8 ou variance nulle).

## V2.1.2 — TRACK spacing normalisé sur la grille DS-v2 4-pt (livré 2026-05-16)

### Décisions clés

- Scoping délégué `researcher` → application déléguée `general-purpose` sur table exacte vérifiée Grep par moi AVANT → diff re-vérifié `git diff --word-diff=porcelain` (seuls mots changés = tokens spacing, typo byte-identique sur lignes partagées).
- Option C / typo eyebrow TRACK d'abord décidée scopée-TRACK + déférée → **re-vérif post-challenge a corrigé le scope → RÉSOLU repo-wide #99** (cf. entrée suivante). Le spec TRACK-scoped est obsolète, ne PAS le ré-ouvrir.

## V2.1.4 — TRACK « Log express » FAB global + bottom-sheet (livré 2026-05-16)

### Décisions clés (landmines)

- **`habit-kinds.ts` = SoT des 5 piliers** (kind/label/Icon/href) — pure data, importable Server + Client. **Tout nouveau pilier passe par ce fichier + `HIDDEN_PREFIXES` de `log-express-fab.tsx`** (le SoT-coupling test échoue sinon = anti-récursion garanti).
- **PAS de `useSession`/`SessionProvider`** (DIVERGENT du blueprint, vérifié correct par Grep + code-reviewer) : `proxy.ts` gate tout non-public AVANT rendu ⇒ FAB pur `usePathname`. `HIDDEN_PREFIXES` = filtre clutter/anti-récursion, PAS frontière de sécurité. **NE PAS ré-introduire SessionProvider — ce n'est pas un manque.**
- A11y modale déléguée au primitive Radix `<Sheet>` (focus-trap/Escape/scroll-lock). Focus-return-au-FAB vérifié OK sous pattern controlled `useState` (Radix restaure `document.activeElement`-à-l'ouverture).
- **Fix shared-primitive intégré** : `sheet.tsx` `SheetPrimitive.Close` 16px → **`h-11 w-11` (44px)** = WCAG 2.5.8 + 2.5.5 AAA. Tout `<Sheet showCloseButton>` du repo en bénéficie.
- Anti-Black-Hat « exemplaire » (ui-designer) : FAB statique, pas de pulse/badge/streak, dismiss == log, copie neutre, seule motion = `active:scale-95`.

## T5 — Admin CRUD Public Track Record (livré 2026-05-22)

### Décisions verrouillées

- **`markBreakEvenAction` defer V1 KISS** : 6 mutations livrées vs 7 brief. Admin set `status=break_even + exitedAt=now + resultR=0` via form principal. Documenté `actions.ts:39-47`.
- **`<PublishToggle>` intégré inline dans `<PublicTradeActionsRow>`** au lieu de composant shared dédié. Fonctionnellement équivalent — extract V2.x si besoin densification.
- **Buttons custom drift J7-héritée** (T2-1 ui-designer) : `admin/cards/*` réinvente aussi `<Btn>`. Fix isolé créerait inconsistance cross-module → reclassé V1.x DS-wide polish PR séparée.
- **A11y T1#1 contrast `--ok` 3.6:1 = FALSE POSITIVE** : OKLCH math vérifiée ~11.4:1 PASS large (DS-v2 tokens documented AA-validated). Audit estimation incorrecte, skip explicite.
- **Visual verify desktop+mobile DÉFÉRÉ** : requires Docker + admin session, couvert par CI Playwright auth gate.
