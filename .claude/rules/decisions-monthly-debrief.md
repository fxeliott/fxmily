---
paths:
  - 'apps/web/src/app/debrief-mensuel/**'
  - 'apps/web/src/lib/monthly-debrief/**'
  - 'apps/web/src/lib/weekly-report/**'
---

# Decisions verrouillees — monthly-debrief

Extrait de `apps/web/CLAUDE.md` le 2026-08-04. Ces decisions sont OPPOSABLES :
ce sont des landmines anti-regression, pas de l historique. Le frontmatter
`paths:` ci-dessus les charge uniquement quand on touche les fichiers concernes
— sans lui, elles seraient chargees a chaque lancement et la scission
n economiserait rien. Contexte complet du jalon : `docs/web/jalons-history.md`.

## V1.4 — Débrief Mensuel IA dédié (SPEC §25) (livré 2026-05-19)

### Décisions verrouillées (NE PAS re-litiger)

- **§25.7 ≠ §21.5 tailored** : la section RÉELLE lit légitimement `SerializedTrade.outcome`/`realizedR` = le produit du membre. Block G du firewall isolé du Block F (§21.5 isolation TRAINING only).
- **`pseudonymLabel` pré-calculé par loader** (builder pur sans import) ; `MonthlyBatchSnapshotEntry.userId` réel transite dans l'enveloppe `/pull` (routage retour, carbone EXACT weekly V1.7.2, single-admin token-gated, V2-defer pour token corrélation opaque).
- **Training = count/récence ONLY** via `countRecentTrainingActivity` (J-T4 sanctioned touchpoint). PAS de distinct-days.
- **`computeReportingMonth` ancre `now−24h`** carbone `computeReportingWeek`. `monthEnd` SSOT service-computed. 1 PR atomic.
- **§25.4 débrief TOUS actifs** (script SANS skip `hasActivity`). **Crisis HIGH/MEDIUM skip-persist** mirror V1.7.1 (output IA, ≠ REFLECT persist-anyway).
- **Email membre UNIQUEMENT** (§25.2), 0 email admin. Push TTL 86400/URGENCY low (calme anti-FOMO).
- **At-least-once accepté V1** (push tag-coalesced ⇒ dup bénin, 1 email dup max en cas de DB-hiccup) — `dispatch_stamp_failed` Sentry warning observable, JSDoc documente. Exactly-once outbox = V2-defer (toucherait aussi weekly).
- **Loader importe `getLatestBehavioralScore` de `@/lib/scoring/service` = SANCTIONNÉ §25.3** (sec-auditor a re-confirmé non-défaut J-M3 — NE PAS « fixer »).
