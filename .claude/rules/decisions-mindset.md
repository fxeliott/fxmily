---
paths:
  - 'apps/web/src/app/mindset/**'
  - 'apps/web/src/components/mindset/**'
  - 'apps/web/src/lib/mindset/**'
---

# Decisions verrouillees — mindset

Extrait de `apps/web/CLAUDE.md` le 2026-08-04. Ces decisions sont OPPOSABLES :
ce sont des landmines anti-regression, pas de l historique. Le frontmatter
`paths:` ci-dessus les charge uniquement quand on touche les fichiers concernes
— sans lui, elles seraient chargees a chaque lancement et la scission
n economiserait rien. Contexte complet du jalon : `docs/web/jalons-history.md`.

## V1.5 (§27) — QCM athlète Mindset (MindsetCheck) (livré 2026-05-19)

### Décisions verrouillées (instrument v1 + archi — la session BUILD #4 NE re-litige PAS)

- **6 dimensions §27.3** : `uncertainty_acceptance`, `ego_result_detachment`, `discipline_plan_adherence`, `emotional_regulation`, `confidence_calibration`, `patience_anti_fomo` — self-responsibility folded into D2, « the zone » = état émergent pas dimension. Items = domaine coach Eliot, ajustables via bump `version` sans casser l'historique.
- **`MindsetCheck` 0-FK** (seul `userId→User` cascade RGPD). PAS de `submittedAt` (`updatedAt @updatedAt` couvre re-submit). PAS de colonne `weekEnd` (service-computed SSOT). PAS de colonne dispatch (audit `notification.enqueued` suffit, canon TrainingDebrief).
- **Zéro free-text §27** ⇒ AUCUN import `safeFreeText`/`buildCorpus`/`detectCrisis`/`detectInjection` (pas de dead-code spéculatif ; surface crisis/injection inexistante par design §27.6/§27.7).
- **Frontend DS-v2 NEUTRE/lime** — JAMAIS `--cy`/`oklch(0.789…)` (§21.7 training-only) ; JAMAIS `.v18-*` (REFLECT-only). Recharts hex `C` (J6.6).
- **Idempotence cron app-level** (skip si déjà soumis cette semaine OU push pending ce weekStart) — PAS de nouvel index dedup (mono-instance hebdo).
