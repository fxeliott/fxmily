# V1.6 Polish — Pickup prompt pour prochaine session

> Brief généré 2026-05-11 fin de session reprise contexte (Rounds 1-4 complets).
> À utiliser après `/clear` pour démarrer une session V1.6 polish fraîche.

## Contexte court

V1 + V1.5 + V1.5.2 LIVE production `app.fxmilyapp.com`. Cron Watch GREEN 5 runs consécutifs (1er green post-V1.6 fix CRON_SECRET sync 2026-05-11). 750/750 Vitest verts à V1.5.2. **Backend complet** (pivot Eliot session backend-V1-complete 2026-05-11).

V1.6 audit-driven hardening **5 bugs latents catch déjà commités** sur main : `f44d124 + dc42a51 + dc7a4b4 + e14bdb8 + 9584a38 + f91a4e1 + a9d2da0 + 2488498`. **Restent 4 items polish non-commités** ci-dessous.

## Scope V1.6 polish (4 items, 4-6h dev)

### Item 1 — Sentry alerting taxonomy (1.5h)

**Problème** : `lib/observability.ts:reportError(scope, err, extra)` câblé dans 7 cron catches, mais pas de niveau `warning` ni `info` distinct. Tous les events arrivent en `error` → bruit dashboard Sentry.

**Action** :

- Ajouter `reportWarning(scope, message, extra?)` et `reportInfo(scope, message, extra?)` dans `apps/web/src/lib/observability.ts`
- Câbler `reportWarning` dans : `dispatcher.dispatchOne` après 1er fail retryable, `weekly-report-builder` si membre inactif skipped, `recompute-scores` si insufficient_data
- Câbler `reportInfo` dans : cron heartbeat success normaux (volume sample 10%)

**Pass/fail** : Sentry dashboard montre 3 niveaux distincts, <50 events/jour total baseline atteint sur 7j.

**Tests** : `apps/web/src/lib/observability.test.ts` (nouveau) — niveau passé correctement, DSN-guarded no-op.

### Item 2 — Email frequency cap `is_transactional` (2h)

**Problème** : SPEC §18.2 spécifie ≥3 emails fallback sur 24h glissantes → spam membre. Pas wired actuellement (`NotificationQueue` pas de champ `is_transactional`).

**Action** :

- Migration Prisma : ajouter `NotificationQueue.isTransactional Boolean @default(false)` + index partiel pour query rapide
- Mark `true` : auth/invitation/password reset/RGPD export (transactionnels = jamais capped)
- Mark `false` : douglas dispatch, weekly digest, scoring recompute notifications (capped)
- Logic dans `dispatcher.ts:dispatchOne` : check count `WHERE userId = ? AND isTransactional = false AND createdAt > NOW() - INTERVAL '24 hours' AND status IN ('sent', 'dispatching')` → si ≥3 → skip + audit `email.frequency.capped`
- **AVANT migration** : invoque skill `/fxmily-prisma-migrate` BLOQUANT

**Pass/fail** : 4 emails fallback consécutifs → seul les 3 premiers partent. Audit log montre `email.frequency.capped` pour 4e. Aucun transactionnel affecté.

**Tests** : `lib/push/dispatcher.test.ts` — scenario 4 emails en 24h, scenario mixed transactional/non-transactional.

### Item 3 — Recalibrer scoring ADR-002 (2h)

**Problème** : Constantes V1 actuelles sont `STDDEV_FULL_SCALE = 4` et `EXPECTANCY_FULL_SCALE = 1` (Phase V/W ADR-001 valeurs validées). ADR-002 propose pour V2 : `STDDEV → 2.5`, `PF → 2.5`, `DD → 10R`, `EXPECTANCY → 1 keep`.

**⚠️ CORRECTION mémoire** : la mémoire MEMORY.md affirmait "STDDEV 8→4 + EXPECTANCY 3→1 à re-appliquer". **C'est FAUX** — V1 actuelle a déjà STDDEV=4 + EXPECTANCY=1. Pas de "revert" à appliquer. Cette mémoire vient probablement d'une confusion avec valeurs pré-Phase V.

**Action V1.6** :

- **Aucune modif scoring constants** — V1 est correct.
- **Ajouter** dans `apps/web/CLAUDE.md` une note explicite : "scoring constants V1 = ADR-001 validées, ADR-002 = V2 proposed seulement, ne pas appliquer V1.6".
- **Trigger documenté** : passer à ADR-002 quand cohort ≥30 membres × ≥3 mois OU 80% cohort < 30 OU > 70 sur une dim OU ≥5 user complaints OU V2 launch >100.

**Pass/fail** : Note ajoutée `apps/web/CLAUDE.md`. Pas d'edit de `consistency.ts` ni `emotional-stability.ts`. Tests Vitest passent (sans modif).

### Item 4 — 10 PRs dependabot majors batch (1.5h)

**Problème** : 11 PRs dependabot OPEN. Mémoire dit "10 PRs majors" (peut-être 1 mineure mergeable automatiquement).

**Action** : triage 1-par-1, ordre :

1. **safe (low-risk)** — merge si CI verte :
   - #44 resend 6.12.2→6.12.3 (patch)
   - #39 docker/login-action 3→4 (CI action)
   - #38 docker/build-push-action 6→7 (CI action)
   - #3 actions/checkout 4→6 (CI action)
   - #2 pnpm/action-setup 4→6 (CI action)
   - #1 actions/setup-node 4→6 (CI action)
2. **dev-dep majors (test local avant merge)** :
   - #47 @commitlint/cli 19→21
   - #46 @commitlint/config-conventional 19→21
   - #42 lint-staged 15→17
   - #6 eslint 9→10
3. **possible breaking (test exhaustif)** :
   - #41 tailwind group 3 updates → test DS-v2 dark mode + iPhone SE responsive

**Pass/fail** : 6+ merges low-risk. Restants triagés avec verdict explicite (defer / breaking).

### Item 5 (BONUS découvert Round 4) — Patch Next.js security release mai 2026

**Problème** : Vercel security release mai 2026 publie **13 advisories** (CVE-2026-23870 RSC + CVE-2026-27979 maxPostponedStateSize + CVE-2026-29057 http-proxy + autres). Fxmily actuellement Next.js 16.2.6.

**Action** :

- Check Next.js version cible la plus à jour 16.x patched
- Bump via PR séparée
- Test build prod + e2e Playwright

**Pass/fail** : CVE listées par `pnpm audit` réduites de N à 0 sur webroot.

### Item 6 (BONUS découvert Round 4) — Audit `apps/web/src/lib/db.ts` pool config

**Problème** : Prisma 7 + `@prisma/adapter-pg` defaults changés vs v6. `connectionTimeoutMillis = 0` (no timeout), `idleTimeoutMillis = 10s`. Risque hang silencieux si pool full sans config explicite.

**Action** :

- Lire `apps/web/src/lib/db.ts`
- Si pas de `connectionTimeoutMillis` explicite passé au `PrismaPg` adapter → ajouter `connectionTimeoutMillis: 5000`
- Documenter dans `apps/web/CLAUDE.md` section Database

**Pass/fail** : Pool config explicite. Note doc.

## Subagents à invoquer (séquence)

1. **Début session** : `fxmily-jalon-tracker` (état actuel — vérifier que prod toujours stable)
2. **Avant item 2 migration Prisma** : skill `/fxmily-prisma-migrate` (BLOQUANT)
3. **Pendant item 1** : aucun
4. **Pendant item 4 dependabot** : `dependency-auditor` pour les majors
5. **Fin session** : 4 subagents parallèles audit :
   - `code-reviewer` (recently changed code)
   - `security-auditor` (focus dispatcher.ts changes)
   - `verifier` (claims vs réalité)
   - `fxmily-content-checker` (si UI/email touché — probablement non V1.6 polish)
6. **Avant `/clear` final** : skill `/fxmily-deliver-jalon`

## Quality gate (avant commit)

```bash
pnpm format:check && pnpm lint && pnpm type-check && pnpm build && pnpm test
```

Cron Watch doit rester GREEN sur la fin de session.

## Critères "Done quand" V1.6 (master §17)

- Cron Watch **7 jours green continu** (à vérifier après merge)
- Sentry **<50 events/jour** baseline sur 7j
- Tous les `pnpm format:check && lint && type-check && build && test` verts
- 6+ PRs dependabot mergées
- `code-reviewer` post-impl validé
- Note `apps/web/CLAUDE.md` ajoutée pour items 3 + 6
- `/fxmily-deliver-jalon` exécuté AVANT `/clear`

## Lectures obligatoires début session

1. `docs/jalon-V1.6-pickup.md` (CE FICHIER)
2. `docs/FXMILY-V2-MASTER.md` §17 + §27 (master plan V2 source unique)
3. `apps/web/CLAUDE.md` (1782 lignes — scoped V1.5.2 close-out)
4. SPEC §15 + §18.2 (cap emails fallback)
5. `docs/decisions/ADR-001` + `ADR-002` (clarification valeurs scoring)
6. `MEMORY.md` D--Fxmily (12 entrées)

## Posture

- **Mark Douglas non-négociable** : pas de conseil trade, oui exécution + psycho
- **Anti-sycophantie** : si je trouve un bug critique, je signale et propose
- **1 session = 1 jalon** : `/clear` à la fin, pas de drift

## Note critique de fin de Round 3

**Repo GitHub est PUBLIC** (vérifié `gh repo view`). Mémoire affirmait PRIVATE post-V1.5.2 round 4 = **faux**. Si tu veux strict ops sec : `gh repo edit fxeliott/fxmily --visibility private --accept-visibility-change-consequences`. Décision Eliot requise.

## Effort total V1.6 polish

**4-6h** dev pur, **+1h** audits subagents fin session = **5-7h session pleine**.
