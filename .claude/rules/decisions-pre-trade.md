---
paths:
  - 'apps/web/src/app/pre-trade/**'
  - 'apps/web/src/components/pre-trade/**'
  - 'apps/web/src/lib/pre-trade/**'
---

# Decisions verrouillees — pre-trade

Extrait de `apps/web/CLAUDE.md` le 2026-08-04. Ces decisions sont OPPOSABLES :
ce sont des landmines anti-regression, pas de l historique. Le frontmatter
`paths:` ci-dessus les charge uniquement quand on touche les fichiers concernes
— sans lui, elles seraient chargees a chaque lancement et la scission
n economiserait rien. Contexte complet du jalon : `docs/web/jalons-history.md`.

## V2.3 — Pre-trade circuit breaker anti-FOMO wizard + auto-link (livré 2026-05-26, PR #178 `602787c`)

### Decisions verrouillees (NON re-litigable)

- **Q1 trigger UI = D combo** (Card `/dashboard` + Banner `/journal/new` optional).
- **Q2 auto-link window = A 15min silencieux** (P2002-safe optimistic locking via `WHERE linkedTradeId IS NULL`).
- **Q3 enums proposés** : `reasonToTrade` (edge/fomo/revenge/boredom) + `emotionLabel` (calme/excite/frustre/anxieux) + `planAlignment` boolean + `stopLossPredefined` boolean.
- **`boredom` Steenbarger extension** honestly documented ADR-003 §Honesty disclaimer (NOT one of Douglas's 4 canonical fears — kept for operational accuracy ↑ vs strict fidelity ↓, _Daily Trading Coach_ Lesson 23).
- **`linkedTradeId String?` no FK** vers trades (intentionnel — race-safe P2025, scar I1 documenté schema.prisma:1532-1537 : un Trade supprimé laisse `linkedTradeId` dangling plutôt que nuller le check).
- **Redirect target** `/dashboard?done=pre-trade` (déviation explicite vs brief Session BB `/?done=pre-trade` — splash `/` est public, dashboard est landing auth user). JSDoc-documenté `actions.ts:130-138`.
- **Closed instrument** : ZERO free-text → ZERO crisis/injection surface (mirror V1.5 §27 mindset — no `*.crisis_detected` slug counterpart, no `safeFreeText`/`containsBidiOrZeroWidth` import, no EU AI Act banner).
- **Non-bloquant** : Fxmily NEVER blocks a trade (master §29 R1 invariant AMF/FCA — wizard est un miroir, pas une gate).
- **No Skip button** : friction IS the feature (ADR-003 §Alt 3 reject — Skip créerait silent-skip backdoor qui défait le mécanisme cognitive-pause).
- **No `MAX_CHECKS_PER_DAY`** : no Black Hat coercion (ADR-003 §Alt 4 reject — membre self-régule).

## V2.3 — Pre-trade circuit breaker anti-FOMO wizard + auto-link (livré 2026-05-26, PR #178 `602787c`)

### Scars CC1-CC6

- **CC1** Worktree spawn différent : Session CC spawn sur `romantic-jemison-95dd5f` au lieu de `clever-kare-52a1fd` recommandé brief. Vérification git ls-remote + path-aware Read/Write a permis de continuer dans clever-kare via absolute paths. **Toujours vérifier CWD vs auto_session_resume §1 CWD recommandé au pickup**.
- **CC2** Format:check 565 file drift local non-bloquant CI (Lint/TC/build SUCCESS).
- **CC3** Redirect target deviation `/dashboard?done=pre-trade` vs brief `/?done=pre-trade` (UX justifiée splash public, JSDoc-documentée). **Pattern : déviations explicites avec justification au lieu de suivre brief aveuglément quand UX cassée**.
- **CC4** Code-reviewer P3 spawné en parallèle de git ops (read-only review n'a pas conflit avec git commit). Pattern parallélisme efficient.
- **CC5** Dead `useEffect` lignes 229-242 détectés par reviewer — squelette unused (cleanup draft sur unmount). **Supprimer tout code mort avant commit** (la review aurait été 0 nit).
- **CC6** Smoke `curl -L=no` invalide — par défaut curl ne suit pas redirects (besoin `-L` POUR suivre). Pattern : pour smoke 307, juste pas mettre `-L`.

## Session GG — E2E Playwright spec `/pre-trade/new` (livré 2026-05-27, PR #182 `a54d90b`)

### Scars (Session GG)

- **GG-1** CI 6/6 vert local ≠ CI Playwright vert remote : les imports `server-only` ne crashent pas localement (Vitest alias kick in à la résolution) mais Playwright sur GitHub Actions runner échoue. **Toujours pousser + watch CI Playwright avant de claim "tests passent"** (la validation locale `vitest run` ne couvre pas Playwright). Pattern Eliot "tu es sûr d'avoir tout fait" appliqué.
- **GG-2** Diagnostic via `gh run view <id> --log-failed | grep -E "(Error|FAIL)"` = méthode canonique pour root-cause les CI fails Playwright. ~30s pour identifier le `server-only` message vs spelunking aveugle. À documenter en V1.x ops runbook.
- **GG-3** Worktree main blocked by autre worktree `lucid-mclaren-b95627` → `git checkout main` fail. Solution : `git checkout -b <new-branch> origin/main` directement, ou continuer sur la branche worktree courante avec rebase. NE JAMAIS `reset --hard` (hook protection + pattern destructif).
- **GG-4** Squash-merge cleaning : après PR #182 merged, ma branche `claude/cranky-gagarin-b47ccc` avait 2 commits dont le contenu = squash sur main. `git rebase origin/main` a tenté de re-appliquer → conflit. La bonne réponse = `git rebase --abort` + nouvelle branche depuis origin/main.
