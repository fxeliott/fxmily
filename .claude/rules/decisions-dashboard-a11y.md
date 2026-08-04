---
paths:
  - 'apps/web/src/app/dashboard/**'
  - 'apps/web/src/components/dashboard/**'
---

# Decisions verrouillees — dashboard-a11y

Extrait de `apps/web/CLAUDE.md` le 2026-08-04. Ces decisions sont OPPOSABLES :
ce sont des landmines anti-regression, pas de l historique. Le frontmatter
`paths:` ci-dessus les charge uniquement quand on touche les fichiers concernes
— sans lui, elles seraient chargees a chaque lancement et la scission
n economiserait rien. Contexte complet du jalon : `docs/web/jalons-history.md`.

## V1.12 P7 — A11y landmark hierarchy `/dashboard` scope minimal (livré 2026-05-25, PR #176 `21c8ae3`)

### Décisions verrouillees (NON re-litigable)

- **Sections déjà avec heading visible** (Mark Douglas card, REFLECT, TRACK, etc.) : `aria-labelledby` pointe vers le h2 existant.
- **Sections sans heading visible** (KPI strip) : ajout `<h2 id="kpi-heading" className="sr-only">` invisible visuellement mais lu SR.
- **Pattern carbone Phase R J10** : skip-link "Aller au contenu principal" déjà présent layout.tsx — V1.12 P7 complète l'arborescence en exposant les landmarks régions.
- **Scope STRICT `/dashboard`** : ne pas étendre à `/journal`, `/account`, etc. cette session — §18.4.

## V1.12 P7 — A11y landmark hierarchy `/dashboard` scope minimal (livré 2026-05-25, PR #176 `21c8ae3`)

### Scars

- P7-1 : pattern réutilisable scope élargi candidat V1.12 P9+ — ne PAS faire dans la même PR §18.4 strict.
