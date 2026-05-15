# Runbook — Bug fix workflow (Sentry → Claude Code)

> Référencé par SPEC §12.2.
> Document maintenu **par jalon** : nouvelle entrée dans `## Décisions / changements` à chaque mise à jour notable du flow.

## Vue d'ensemble

Quand une erreur runtime explose en production, le flow attendu est :

```
Sentry → email à eliot@fxmilyapp.com
         ↓
Eliot ouvre l'événement Sentry → copie le payload (stack trace + breadcrumbs + user context)
         ↓
Eliot lance Claude Code dans D:\Fxmily, colle le payload, demande "fix this bug"
         ↓
Claude Code reproduit (test qui échoue), propose un fix, écrit le test qui passe, run la suite
         ↓
Eliot review le diff (git diff), valide → push → CI/CD déploie
```

C'est **pas du 100% auto**, c'est du **1-clic pour Eliot avec qualité préservée**.

## Pré-requis

- **Sentry plan gratuit** ✅ câblé côté serveur + client (J10 Phase B, commit `ba026e0`). DSN-guarded init (silent dev), `beforeSend` scrubber pour cookies/auth/X-Cron-Secret/IP/email/body strip.
- **Source maps** ✅ uploadées en CI à chaque push main (J10 Phase C, `deploy.yml` + `deploy-vercel.yml` step "Upload Sentry source maps").
- **Tags Sentry** : `userId` (anonymisé), `route`, `release_version`.
- **Repo GitHub PUBLIC** depuis 2026-05-12 (`fxeliott/fxmily`) + branche `main` protégée (classic branch protection : Lint, type-check, build + Analyze JS-TS + Playwright chromium required) + CI vert obligatoire pour merge.

## Étape 1 — Réception de l'alerte

1. Sentry envoie un email à `eliot@fxmilyapp.com` avec le titre de l'erreur (ex. `TypeError: Cannot read properties of undefined (reading 'id') in apps/web/src/app/journal/[id]/page.tsx`).
2. Eliot clique le lien → arrive sur le dashboard Sentry de l'événement.
3. **Récupérer le payload** : copier les 4 sections suivantes :
   - **Title** (1 ligne, type d'erreur + message)
   - **Stack trace** (sans tronquer)
   - **Breadcrumbs** (les 20 derniers événements user — clics, pages, fetch)
   - **User context** (id anonymisé, role, route active)

## Étape 2 — Lancement de Claude Code

1. `cd D:\Fxmily`
2. Si une session active existe, faire `/clear` avant de coller le payload (le contexte d'un autre jalon pollue).
3. Premier message à Claude :

   ```
   Bug Sentry à fixer.

   Title:
   <coller>

   Stack trace:
   <coller>

   Breadcrumbs:
   <coller>

   User context:
   <coller>

   Procédure :
   1. Reproduis le bug avec un test qui échoue (Vitest si unit, Playwright si E2E).
   2. Propose un fix minimal.
   3. Vérifie que le test passe + que la suite complète reste verte.
   4. Lance pnpm format:check && lint && type-check && test.
   5. Donne-moi le diff à reviewer.
   ```

4. Claude doit **lire les fichiers de la stack** avant d'écrire quoi que ce soit, puis appliquer le subagent `debugger` pour la phase de reproduction.

## Étape 3 — Review et merge

1. Eliot lit `git diff` du fix proposé. Critères de validation :
   - Le test reproduit bien le bug (échoue sans le fix, passe avec).
   - Le fix est **minimal** (pas de refactor en plus, pas d'abstraction prématurée).
   - La suite complète reste verte.
   - Aucun secret / clé en dur.
2. Si OK : commit avec message Conventional `fix(<scope>): <description>` puis `git push` sur une branche dédiée (jamais direct sur `main`).
3. Ouvrir la PR via `gh pr create` ou l'interface GitHub. CI doit passer avant merge.
4. Squash-merge dans `main` → CI/CD déploie automatiquement (workflow J10 à câbler).

## Garde-fous

- **Jamais** de `git push --force` sur `main` ou sur une branche partagée — toujours créer un nouveau commit.
- **Jamais** committer le payload Sentry brut s'il contient du PII non anonymisé (vérifier avant `git add`).
- **Jamais** désactiver un test "qui dérange" pour faire passer un fix urgent — préférer ajouter un `test.skip` documenté avec un TODO + un ticket.
- Si le bug nécessite une **migration DB**, ne pas appliquer en prod sans backup (cf. `docs/runbook-backup-restore.md` — à créer en J10).

## Patterns de bugs fréquents (à enrichir au fil du temps)

### Auth (J1 wiring)

- `signIn() throws but redirect doesn't happen` → vérifier que la `Server Action` re-throw bien le `digest: 'NEXT_REDIRECT…'`.
- `Session.user.role is undefined` → vérifier que le callback `jwt` propage `user.role` quand `user` est présent (premier login après création).
- `Invitation token expired but UI dit "déjà utilisé"` → vérifier l'ordre des checks dans `findInvitationByToken` (used-then-expired vs expired-then-used).

### Database (Prisma 7)

- `PrismaClientKnownRequestError P2002` → contrainte unique violée. Récupérer le champ dans `err.meta.target` pour donner un message utile à l'utilisateur.
- `Unable to fetch from connection pool` → la pool DB est saturée. En dev c'est rare, en prod ça veut dire qu'on n'a pas correctement libéré une transaction longue. Profiler avec `prisma:query` log.

### Tests

- `vitest setup throws ZodError on env` → la stub `test.env` dans `vitest.config.ts` n'a pas été propagée. Vérifier le bloc `env` du config.

## Décisions / changements

- **2026-05-05 (J1)** : initialisation du runbook. Sentry pas encore câblé (prévu J10), mais le pattern de prompt est figé pour ne pas avoir à le réinventer le jour J.
