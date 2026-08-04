---
paths:
  - 'apps/web/**'
---

# Decisions verrouillees — divers

Extrait de `apps/web/CLAUDE.md` le 2026-08-04. Ces decisions sont OPPOSABLES :
ce sont des landmines anti-regression, pas de l historique. Le frontmatter
`paths:` ci-dessus les charge uniquement quand on touche les fichiers concernes
— sans lui, elles seraient chargees a chaque lancement et la scission
n economiserait rien. Contexte complet du jalon : `docs/web/jalons-history.md`.

## V2.1.6 — Placeholder UI « À venir » suivi-formation (livré 2026-05-20)

### Décisions verrouillées

- **Emplacement = entre TRACK et Corrélations** (cohérence narrative : LIVE en haut + slot futur + analytics en bas). ui-designer T2-4 « fin-de-page » contradiction interne T2-1/T2-2 → NO-ACTION défer V2.1.7+.
- **Tone neutre/mute `var(--t-3)`** délibéré, signale « slot reconnu mais pas encore actif » vs modules LIVE lime `--acc`. Convention placeholder ≠ active à formaliser V2 mais non-bloquant.
- **`<Pill tone="mute">`** = `components/ui/pill.tsx:11` (border `--b-default` + text `--t-3` + bg `oklch(0.604 0.02 257 / 0.04)`).
- **`<section aria-label>` + `<div aria-describedby>`** pattern WAI-ARIA 1.2 valide. a11y T2-2 propose déplacer sur `<section>`, code-reviewer propose retirer entièrement — 2 verdicts contradictoires + impact réel 0 → NO-ACTION défer V2.1.7+.
- **`aria-hidden` sur `<GraduationCap>`** (icône décorative, texte porte le sens). Pattern J7 audit B8.
- **0 animation, 0 hover-state cliquable** — anti-Black-Hat strict.
- **Pas de bump SPEC.md ligne 5 « Version 1.1 »** (placeholder ne mérite pas un bump ; les bumps v1.3/v1.4/v1.5 = sections substantives §23/§25/§27).

## V2.3.1 — V2.3 post-ship hardening 3-fix bundle (livré 2026-05-26, PR #179 `3404e29`)

### Decisions verrouillees

- **Bundle = 1 jalon §18.4 OK** : 3 fixes orthogonaux MAIS thématique unique "V2.3 polish post-ship findings cleanup" + cohérence narrative + même origine (audit Round 2). Carbone Session V Dependabot batch combined SAFE (7 PRs → 1 PR atomic).
- **Lockfile-free path** : 0 deps changes → pas de cascade rebases, pas de risque déps drift.
- **TIER 1 sélection** : seuls les 🟠 IMPORTANT sec/perf/a11y inclus. Les 🟡 NIT V2.3 (dead useEffect, comment ment, revalidatePath inutile) DIFFÉRÉS — pattern carbone audit-driven hardening "TIER 1 fix in-session, TIER 4 reclassement".

## V2.3.1 — V2.3 post-ship hardening 3-fix bundle (livré 2026-05-26, PR #179 `3404e29`)

### Scars (Session DD #1)

- **DD1-1** Reviewer P3 V2.3 ship pre-merge a raté IMP-6 id-target mort `aria-labelledby` — violation scar W1 P1 strict (amend obligatoire si nuance détectée). **Action**: amend post-merge intégré dans cette V2.3.1 bundle.
- **DD1-2** Bundle cross-axe sec+perf+a11y validé empiriquement comme 1 jalon §18.4 OK (cohérence narrative + même origine audit) — pattern réutilisable pour futurs bundles findings post-ship.

## Session FF pivot — V2.3.2 nits cleanup intra-wizard (livré 2026-05-26, PR #181 `1136380`)

### Scars critiques (Session FF) — pattern carbone

- **FF-1 PIVOT** : brief initial `react-email v6 migration` ; investigation 3 vérifs croisées (`pnpm view` + `WebFetch` registry + sub-packages check) → **researcher Round 2 hallucination détectée** (v6 = CLI dev-server `@react-email/cli`, PAS package bundle utilisateur) → **AVORT migration**. Pivot vers V2.3.2 nits dans la même session (utilisation efficace du pickup time).
- **FF-2 NOUVEAU CANON `scar O3 re-grep tool-confirmed avant migration deps`** : avant toute migration de dep majeure, **TOUJOURS** re-grep tool-confirmed `pnpm view <pkg>@<version> --json` + WebFetch npm registry + sub-packages enumeration. NE PAS faire confiance à researcher Round 1 seul sur des migrations cross-cutting.
- **FF-3** `revalidatePath()` après `redirect()` dans une Server Action = redondance (le redirect invalide déjà le cache Next 16 RSC). À cleanup partout dans le codebase Server Actions audit futur.
