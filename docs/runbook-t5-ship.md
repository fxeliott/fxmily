# Runbook — Ship T5 admin track-record en prod (niveau débutant)

> **Pour qui** : Eliot, niveau débutant. Chaque étape est expliquée + commande
> exacte à copier-coller + ce que tu dois VOIR pour confirmer succès.
>
> **Temps estimé** : ~30-45 min si tout va bien. ~1h-1h30 si troubleshoot.
>
> **Pré-requis** : Docker Desktop installé, `gh` CLI authentifié, terminal
> Git Bash ou PowerShell ouvert à `D:\Fxmily`.

---

## Vue d'ensemble — qu'est-ce qu'on fait

T5 = module admin pour gérer les trades publics d'Eliot
(`/admin/track-record/*`). Tu as actuellement **2 Pull Requests (PR) ouvertes** :

- **PR #148** — Foundation `feat/track-record-T0` (T0-T4) base `main`
- **PR #151** — T5 admin CRUD base `feat/track-record-T0` (dépend de #148)

Chain depend → **#148 doit être mergée AVANT #151**. Une fois mergées, on
applique la migration DB locale, on seed les 139 trades 2025 d'Eliot
depuis l'ODS, et on smoke test l'UI admin. Si OK local → push main →
pipeline auto-deploy Hetzner via GitHub Actions.

**Jargon** :

- **PR (Pull Request)** = proposition de fusionner une branche de code dans
  `main` (la branche de production). GitHub UI permet de review + merger.
- **Migration Prisma** = script SQL qui crée des tables / colonnes en base
  de données. On l'applique LOCAL d'abord, puis PROD via auto-pipeline.
- **Seed** = remplir la DB avec des données initiales (ici, 139 trades 2025
  importés depuis le fichier `.ods` d'Eliot).
- **Smoke test** = clic-tester manuellement les fonctionnalités critiques
  pour vérifier que rien n'est cassé visuellement / fonctionnellement.

---

## Pré-requis — à vérifier 5 min

Ouvre un terminal à `D:\Fxmily` (depuis Explorer Windows : clic droit dans
le dossier → "Ouvrir dans Terminal" OU lance Git Bash + `cd /d/Fxmily`).

### Vérifier Docker Desktop

```bash
docker --version
```

**Tu dois voir** : `Docker version 27.x.x` ou similaire. Si erreur "command
not found" → ouvre Docker Desktop depuis le menu démarrer Windows, attends
~30s qu'il démarre.

### Vérifier gh CLI

```bash
gh auth status
```

**Tu dois voir** : `✓ Logged in to github.com as fxeliott`. Si non
authentifié : `gh auth login` → suivre les prompts.

### Vérifier que tu es sur la bonne branche

```bash
git status
```

**Tu dois voir** : `On branch main` ou `On branch feat/track-record-admin-T5`,
working tree clean (pas de fichiers modifiés non-commit). Si dirty, commit
ou stash avant de continuer.

---

## Étape 1 — Merger PR #148 (T0-T4 foundation)

**Pourquoi en premier** : PR #151 dépend de #148. Tu DOIS merger #148
d'abord, sinon GitHub refusera de merger #151.

### Option A — Via terminal (gh CLI, plus rapide)

```bash
gh pr merge 148 --repo fxeliott/fxmily --squash --auto
```

> **`--squash`** = combine tous les commits de la branche en 1 seul commit
> sur `main`. C'est le mode recommandé pour Fxmily (historique propre).
> **`--auto`** = merge automatiquement dès que les checks CI passent au vert.
> Si tu veux merger IMMÉDIATEMENT sans attendre CI, retire `--auto`.

**Tu dois voir** :

```
✓ Pull request #148 will be automatically merged via squash when all
requirements are met
```

OU s'il fail :

```
X Pull request #148 is not mergeable: ...
```

→ voir Troubleshoot ci-dessous.

### Option B — Via GitHub web (visuel)

1. Ouvre [https://github.com/fxeliott/fxmily/pull/148](https://github.com/fxeliott/fxmily/pull/148) dans ton navigateur.
2. Scrolle en bas de la page. Tu dois voir un bouton vert "Squash and merge".
   - Si bouton **rouge** "Merging is blocked" → un check CI a échoué. Clique
     sur "Details" du check rouge pour voir pourquoi.
   - Si bouton **gris** "This branch must be updated before merging" → il
     faut rebase la branche sur main (clique "Update branch").
3. Clique "Squash and merge" → confirme le message de commit → "Confirm squash and merge".
4. **Tu dois voir** : badge violet "Merged" en haut de la page + message
   "Pull request successfully merged and closed".
5. **Important** : NE clique PAS "Delete branch" (PR #151 dépend encore de
   `feat/track-record-T0` pour son base ref ; GitHub va auto re-target sur
   main mais garde la branche le temps).

### Vérifier le merge

```bash
gh pr view 148 --repo fxeliott/fxmily --json state
```

**Tu dois voir** : `{"state":"MERGED"}`.

---

## Étape 2 — Merger PR #151 (T5 admin CRUD)

Après que #148 soit mergée, GitHub auto re-target PR #151 sur `main`
(plus besoin d'intervention manuelle).

### Vérifier le re-target automatique

Attends ~30 secondes après le merge de #148, puis :

```bash
gh pr view 151 --repo fxeliott/fxmily --json baseRefName,mergeStateStatus
```

**Tu dois voir** :

```
{"baseRefName":"main","mergeStateStatus":"CLEAN"}
```

Si `baseRefName` est encore `feat/track-record-T0` → attends 1 min de plus
ou ouvre la PR web et clique "Change base" → `main` manuellement.

Si `mergeStateStatus` est `BEHIND` → la branche est en retard sur main, fais
`gh pr update-branch 151 --repo fxeliott/fxmily` puis re-vérifier.

### Merger PR #151

```bash
gh pr merge 151 --repo fxeliott/fxmily --squash --auto
```

**Tu dois voir** la même confirmation qu'à l'étape 1.

### Vérifier le merge

```bash
gh pr view 151 --repo fxeliott/fxmily --json state
```

**Tu dois voir** : `{"state":"MERGED"}`.

### Récupérer le code mergé localement

```bash
git checkout main
git pull origin main
```

**Tu dois voir** : `Updating <SHA>..<SHA>` avec une liste de fichiers modifiés
(beaucoup — c'est normal, T5 a 26 commits).

---

## Étape 3 — Démarrer Postgres dev local

T5 a ajouté une migration `20260521172000_track_record_public_trades` qui
crée 2 nouvelles tables (`public_trades` + `public_trade_partials`). Il
faut appliquer cette migration sur ta DB Postgres locale AVANT de pouvoir
tester `/admin/track-record`.

### Démarrer le container Postgres

```bash
docker compose -f docker-compose.dev.yml up -d
```

> **`-d`** = detached mode (le container tourne en arrière-plan, tu récupères
> ton terminal). **`docker-compose.dev.yml`** = config Postgres local Fxmily
> (déjà setup au J1, voir CLAUDE.md global).

**Tu dois voir** :

```
[+] Running 1/1
 ✔ Container fxmily-postgres-dev  Started
```

### Vérifier qu'il tourne

```bash
docker ps --filter "name=fxmily-postgres" --format "{{.Names}}: {{.Status}}"
```

**Tu dois voir** : `fxmily-postgres-dev: Up 10 seconds (healthy)` (le
"healthy" peut prendre ~15s à apparaître — réessaye si tu vois juste "Up").

### Si erreur "port 5432 already in use"

Un autre Postgres tourne déjà sur ta machine (peut-être pgAdmin ?). 2 options :

- **A** : stop l'autre Postgres : `Get-Service postgresql*` puis `Stop-Service postgresql-x64-XX` (PowerShell admin).
- **B** : change le port Fxmily dans `docker-compose.dev.yml` ligne ~10 : `5432:5432` → `5433:5432`, puis update `DATABASE_URL` dans `apps/web/.env` à `localhost:5433`.

---

## Étape 4 — Appliquer la migration Prisma

```bash
pnpm --filter @fxmily/web prisma:migrate dev
```

> **`prisma:migrate dev`** = applique les migrations pending en mode dev
> (génère aussi le Prisma client TS). Va lire `apps/web/prisma/migrations/`
> et exécuter celles qui ne sont pas encore dans `_prisma_migrations`.

**Tu dois voir** une cascade de logs Prisma, et à la fin :

```
The following migration(s) have been applied:
migrations/
  └─ 20260521172000_track_record_public_trades/
      └─ migration.sql

Your database is now in sync with your schema.
✔ Generated Prisma Client
```

Si tu vois `Error: P1001: Can't reach database server at localhost:5432` →
le container Postgres n'est pas démarré. Retourne à l'Étape 3.

Si tu vois `Migration drift detected` → la DB locale a un schéma divergent.
Reset : `pnpm --filter @fxmily/web exec prisma migrate reset --force` (⚠️
EFFACE TOUTE LA DB LOCALE — OK en dev). Puis recommencer `prisma:migrate dev`.

### Vérifier les tables créées

```bash
docker exec fxmily-postgres-dev psql -U fxmily -d fxmily -c "\dt public_trades public_trade_partials"
```

**Tu dois voir** :

```
                 List of relations
 Schema |          Name           | Type  | Owner
--------+-------------------------+-------+--------
 public | public_trade_partials   | table | fxmily
 public | public_trades           | table | fxmily
(2 rows)
```

---

## Étape 5 — Seeder les 139 trades 2025

Le script `scripts/import-fxmily-trades.ts` lit le fichier `.ods` source
d'Eliot et insère les 139 trades de l'année 2025 dans la table `public_trades`.

```bash
pnpm --filter @fxmily/web exec tsx scripts/import-fxmily-trades.ts --year 2025
```

**Tu dois voir** quelque chose comme :

```
[import] Reading .ods file: data/fxmily-trades.ods
[import] Filter year=2025, found 139 rows
[import] Imported 139 trades (segment=historical, ordinal 1..139)
[import] Done.
```

### Vérifier le count en DB

```bash
docker exec fxmily-postgres-dev psql -U fxmily -d fxmily -c "SELECT COUNT(*) FROM public_trades;"
```

**Tu dois voir** :

```
 count
-------
   139
(1 row)
```

Si tu vois `0` → le script a échoué silencieusement, check les logs au-dessus.
Si tu vois un autre nombre, contacte-moi pour debug.

---

## Étape 6 — Smoke E2E manuel `/admin/track-record`

Lance le dev server :

```bash
pnpm dev
```

**Tu dois voir** :

```
▲ Next.js 16.x.x (Turbopack)
- Local:    http://localhost:3000
- ready in 2.5s
```

Ouvre [http://localhost:3000/login](http://localhost:3000/login) dans ton
navigateur. Connecte-toi avec ton compte admin Eliot. Tu devrais arriver sur
`/dashboard`.

Va sur [http://localhost:3000/admin/track-record](http://localhost:3000/admin/track-record).

### Test plan smoke (10 min, dans cet ordre)

#### Smoke 1 — Page list rend OK

- **Tu dois voir** : 4 stats cells en haut (Total: 139, Historique: 139, Live: 0, Brouillons: 0), suivies d'une liste de 139 trades avec ordinal, instrument, R, etc.
- **Vérif** : ouvre les outils dev (F12) → onglet Console → aucune erreur rouge.

#### Smoke 2 — Toggle isPublished

- Sur la liste, clique le bouton "📤 Publier" / "📥 Brouillon" sur un trade.
- **Tu dois voir** : pill "Brouillon" apparaît/disparaît + audit log row
  (`docker exec fxmily-postgres-dev psql -U fxmily -d fxmily -c "SELECT action, created_at FROM audit_logs WHERE action LIKE 'admin.public_trade.%' ORDER BY created_at DESC LIMIT 3;"`).
- **Phase H+7 check** : clique 3× le même bouton "Publier" sur un trade déjà publié.
  Vérifie que **UNE SEULE** audit row est créée (vs 3). C'est le fix idempotence wasChanged.

#### Smoke 3 — Phase H BLOQUANT-1 (clear nullable fields)

- Clique "Edit" sur un trade.
- Efface complètement le champ "Notes" (sélectionne tout + delete) → submit.
- **Tu dois voir** : redirect vers la list page sans erreur.
- **Vérif DB** : la column `notes` a passé à `NULL` (vs garder l'ancienne valeur).

#### Smoke 4 — Phase H BLOQUANT-3 (publishedAt preserved)

- Note la date de `publishedAt` d'un trade publié (via Edit ou DB query).
- Unpublish ce trade → republish.
- **Tu dois voir** : `publishedAt` est INCHANGÉ (date d'origine).

#### Smoke 5 — Phase H+1 SSRF defense

- Edit un trade → champ `screenshotUrl` → tape `javascript:alert(1)` → submit.
- **Tu dois voir** : message d'erreur inline rouge sur le champ
  ("URL https:// (avec domaine DNS valide, pas IP literal) ou storage-key..."),
  pas de submit.
- Idem pour : `http://localhost`, `https://169.254.169.254/`, `https://[::1]/`,
  `https://cdn.example.com/../etc/passwd`.

#### Smoke 6 — Phase H+4 TIER 1 open invariant

- Create un nouveau trade : status `open`, mais remplis `exitedAt` ET `resultR`.
- **Tu dois voir** : 2 erreurs inline ("exitedAt doit être vide quand status = open"
  - "resultR doit être vide quand status = open"), pas de submit.

#### Smoke 7 — Phase H+4 FR locale comma

- Edit un trade : champ `riskPercent` → tape `1,5` (virgule FR).
- **Tu dois voir** : submit OK, DB stocke `1.5`. (avant fix : silent NaN → null clear).

#### Smoke 8 — Phase H+5 + H+8 timezone round-trip

- Note l'`enteredAt` d'un trade en DB (en UTC, ex. `2026-05-22T10:00:00.000Z`).
- Edit le trade SANS toucher `enteredAt`, juste change une autre colonne (notes par ex).
- Submit. Re-query DB.
- **Tu dois voir** : `enteredAt` est IDENTIQUE (pas de drift +2h cumulatif).

#### Smoke 9 — Partials add + delete

- Clique "Edit" sur un trade closed → scrolle vers "Partials" section.
- Add un partial leg : closedAtR=1.5, closedPercent=50, closedAt=2026-05-22T11:00.
- **Tu dois voir** : le partial apparaît dans la section + badge "1 leg" sur la list page.
- Delete le partial (double-click confirm 4s).
- **Tu dois voir** : disparaît + badge "0 leg".

#### Smoke 10 — Delete trade (cascade partials)

- Sur un trade avec partials, delete (double-click confirm 4s).
- **Tu dois voir** : trade + partials supprimés.
- DB check : `SELECT COUNT(*) FROM public_trade_partials WHERE public_trade_id = '<ID>';` → 0.

### Si tout passe :

Stop le dev server (Ctrl+C). T5 est validé local. Tu peux push la prod.

---

## Étape 7 — Deploy prod (automatique)

Le merge sur `main` (Étape 2) a déjà déclenché le workflow `deploy.yml`
GitHub Actions (si `DEPLOY_PATH=hetzner` est set en repo variable).

### Vérifier le run

```bash
gh run list --repo fxeliott/fxmily --workflow deploy.yml --limit 3
```

**Tu dois voir** : un run en `in_progress` ou `success` correspondant au
commit de merge T5.

### Suivre les logs en direct

```bash
gh run watch --repo fxeliott/fxmily
```

(Suit le dernier run en cours, log streaming temps réel.)

### Vérifier la migration prod

Une fois le run terminé GREEN :

```bash
ssh fxmily@app.fxmilyapp.com "docker exec fxmily-postgres-prod psql -U fxmily -d fxmily -c \"SELECT COUNT(*) FROM public_trades;\""
```

**Tu dois voir** : `0` (la migration a créé la table mais le seed n'est pas
auto-prod). Le seed 139 trades 2025 prod = action manuelle séparée si tu
veux que la vitrine `trackrecordfxmily.pages.dev` affiche tes trades.

### Smoke prod URL

Ouvre [https://app.fxmilyapp.com/admin/track-record](https://app.fxmilyapp.com/admin/track-record)
dans ton navigateur (login admin). La page doit rendre OK (liste vide à 0 trades).

### Rollback si problème

Si tu vois quelque chose de cassé en prod, le runbook rollback est dans
`docs/runbook-hetzner-deploy.md` §21 (T5 track-record migration rollback).
Pattern : pg_dump atomique → docker stop → DROP TABLES → DELETE FROM
\_prisma_migrations → re-deploy image pré-T5.

---

## Troubleshoot — cas d'échec courants

### "Pull request #148 is not mergeable: dirty"

La branche a un conflit avec main. Solution : depuis le terminal local :

```bash
git checkout feat/track-record-T0
git pull origin feat/track-record-T0
git merge main
# Résous les conflits dans VS Code, puis :
git add .
git commit -m "merge: resolve conflicts with main"
git push origin feat/track-record-T0
```

Puis re-essayer le merge PR.

### CI rouge sur PR #148 ou #151

```bash
gh pr checks 148 --repo fxeliott/fxmily
```

Identifie le check rouge. Le plus souvent :

- **Lint** : `pnpm format:check && pnpm lint && pnpm type-check && pnpm build` localement, fix les erreurs.
- **Playwright e2e** : flake ou auth gate cassé → check logs `gh run view <run-id> --log-failed`.

### Migration apply fail

Si `prisma:migrate dev` échoue avec :

- **`P3009: failed migrations`** : une migration précédente a partiellement appliqué. Reset DB : `pnpm --filter @fxmily/web exec prisma migrate reset --force`.
- **`P1010: Permission denied`** : user `fxmily` n'a pas les droits. Check `docker-compose.dev.yml` : `POSTGRES_USER=fxmily POSTGRES_PASSWORD=fxmily_dev`.

### Seed script "Cannot find module"

Le script utilise `tsx` qui doit être installé. Run :

```bash
pnpm install
pnpm --filter @fxmily/web add -D tsx
```

### Dev server "EADDRINUSE :3000"

Un autre process tourne sur port 3000. Trouve-le :

```bash
# PowerShell
Get-NetTCPConnection -LocalPort 3000 | Select-Object OwningProcess
Get-Process -Id <pid>
```

Stop-le ou change le port Next : `pnpm dev -- -p 3001`.

### Smoke test échoue sur un Phase H+X check

Le test est précis (chaque fix Phase H+X a un comportement attendu). Si tu
vois un comportement différent, contacte-moi avec :

- Le check exact qui fail
- Screenshot de l'UI
- Log dev server (terminal `pnpm dev`)

---

## Récap — ce que tu viens de faire

1. ✅ Mergé PR #148 (T0-T4 foundation) sur main
2. ✅ Mergé PR #151 (T5 admin CRUD) sur main (26 commits, 8 rounds audit)
3. ✅ Démarré Postgres dev local
4. ✅ Appliqué la migration T5 (2 nouvelles tables)
5. ✅ Seedé 139 trades 2025 d'Eliot
6. ✅ Smoke E2E manuel `/admin/track-record` (10 checks)
7. ✅ Vérifié le deploy prod auto (GitHub Actions deploy.yml)

T5 SHIP. Backlog V1.x post-merge documenté dans `apps/web/CLAUDE.md` section T5.
