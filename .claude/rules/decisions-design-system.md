---
paths:
  - 'apps/web/src/app/globals.css'
  - 'apps/web/src/components/ui/**'
---

# Decisions verrouillees — design-system

Extrait de `apps/web/CLAUDE.md` le 2026-08-04. Ces decisions sont OPPOSABLES :
ce sont des landmines anti-regression, pas de l historique. Le frontmatter
`paths:` ci-dessus les charge uniquement quand on touche les fichiers concernes
— sans lui, elles seraient chargees a chaque lancement et la scission
n economiserait rien. Contexte complet du jalon : `docs/web/jalons-history.md`.

## DS — Consolidation de l'eyebrow 12px app-wide en token `.t-eyebrow-lg` (livré 2026-05-16)

### Décisions clés (landmines)

- **`.t-eyebrow-lg` (12px) = standard ; `.t-eyebrow` (10px) = variante compacte volontaire.** JSDoc `globals.css` documente la **divergence 3-axes** (10/12px · 0.14/0.10em · baked vs agnostic color) → anti futur PR « harmonize ».
- Naming-smell connu (le commun a le suffixe `-lg`) → rename mécanique différé (PR dédié + verifier byte-équivalence, 0 gain visuel).
- 3 vérifs convergentes : self `git diff --ignore-all-space --word-diff` (minus-cluster **64===64** plus-token) + verifier adversarial DÉCISION OK + ui-designer 0 T1/0 T2.
