# `ops/stress` — suite de tests de charge k6 (J7)

Suite **versionnée et exécutable** qui reproduit les 4 scénarios de pointe
réalistes de Fxmily. Objectif J7 : mesurer les surfaces membre sous charge,
prouver que les goulots identifiés par la revue sont fermés (ou chiffrés en
TODO), et documenter les chiffres avant/après dans [`RESULTS.md`](./RESULTS.md).

> ⚠️ **Local uniquement.** On ne charge **jamais** la prod Hetzner. Tous les
> runs visent un serveur local (`http://localhost:3000`) adossé à une base
> Postgres jetable (conteneur de vérif, port `55432`). Le seed de 1000 membres
> refuse de tourner si `DATABASE_URL` ne pointe pas sur `:55432/` (garde-fou dur
> dans `apps/web/scripts/seed-stress-cohort.ts`).

## Prérequis

| Outil                              | Version vérifiée                   | Note                                         |
| ---------------------------------- | ---------------------------------- | -------------------------------------------- |
| [k6](https://grafana.com/docs/k6/) | `k6.exe` v2.1.0 (déjà sur le PATH) | **Aucune install réseau nécessaire.**        |
| Node                               | 22 LTS                             | pour `gen-fixture.mjs` et le build.          |
| Docker                             | —                                  | Postgres de vérif (`fxmily-j7`, port 55432). |
| pnpm                               | 10                                 | build + start du serveur.                    |

## Les 4 scénarios

| Fichier                                              | Scénario                                        | Charge                                        | Verdict (seuil)                                    |
| ---------------------------------------------------- | ----------------------------------------------- | --------------------------------------------- | -------------------------------------------------- |
| [`s1-checkin-burst.js`](./s1-checkin-burst.js)       | **S1** — burst de check-ins 21h                 | 100 VUs, lecture dashboard+checkin+classement | `http_req_failed < 1%` et `p95 < 800 ms` par route |
| [`s2-uploads.js`](./s2-uploads.js)                   | **S2** — uploads simultanés                     | 50 VUs, preuve MT5 ~5 Mo                      | `upload_server_errors == 0` (0 OOM/5xx)            |
| [`s3-leaderboard-read.js`](./s3-leaderboard-read.js) | **S3** — lecture leaderboard                    | montée VUs sur 1000 membres seedés            | `p95 < 800 ms`, `p99 < 1500 ms`, `failed < 1%`     |
| [`s4-api-under-batch.js`](./s4-api-under-batch.js)   | **S4** — API membre sous charge du worker batch | batch recompute en boucle + cohorte membre    | `{scope:member} failed < 1%` et `p95 < 800 ms`     |

Config partagée pilotée par env : [`lib/config.js`](./lib/config.js). Login
Auth.js v5 (CSRF → callback credentials → cookie de session) :
[`lib/auth.js`](./lib/auth.js).

## Étape 1 — base Postgres de vérif + seed

```bash
# Conteneur Postgres jetable (si pas déjà lancé)
docker run -d --name fxmily-j7-verify -e POSTGRES_PASSWORD=verify \
  -p 55432:5432 postgres:17

export DATABASE_URL='postgres://postgres:verify@localhost:55432/fxmily_j7'
pnpm --filter @fxmily/web prisma:migrate deploy   # applique les migrations
pnpm --filter @fxmily/web exec tsx scripts/seed-stress-cohort.ts
```

Le seed est **idempotent** : 1000 membres `stress-cohort-NNNN.member.e2e.test@fxmily.local`
(mot de passe `stress-cohort-verify-only`), + snapshots de score, + rangs
calculés. Il ne crée **aucun compte MT5** (cf. § S2).

## Étape 2 — fixture d'upload (S2 uniquement)

Le fixture binaire (~5 Mo) est **gitignoré** (repo public, poids). On le génère
localement :

```bash
node ops/stress/gen-fixture.mjs        # -> fixtures/proof-5mb.jpg
```

## Étape 3 — lancer un scénario

Toujours après un **warm-up** des routes (le premier hit compile la route sous
Next.js et fausse le p95) et avec un **serveur fraîchement (re)démarré entre
chaque scénario** (pas de pollution de pool/cache entre runs).

```bash
# variables communes
export BASE_URL='http://localhost:3000'
export MEMBER_PASSWORD='stress-cohort-verify-only'

k6 run ops/stress/s1-checkin-burst.js     --summary-export ops/stress/.results/s1.json
k6 run ops/stress/s3-leaderboard-read.js  --summary-export ops/stress/.results/s3.json
k6 run -e CRON_SECRET="$CRON_SECRET" \
       ops/stress/s4-api-under-batch.js   --summary-export ops/stress/.results/s4.json
```

Le plus simple : le runner PowerShell [`run-suite.ps1`](./run-suite.ps1)
enchaîne build → start → warm-up → S1/S3/S4 → RAM/CPU → teardown et écrit les
digests dans `.results/` (gitignoré).

### S2 (uploads) — prérequis particulier

L'upload MT5 est protégé par un contrôle d'accès **BOLA** : il faut une session
membre **active qui possède le `accountId`** ciblé. La cohorte seedée n'a
volontairement **aucun compte MT5**. S2 exige donc un uploader dédié fourni au
run (jamais commité) :

```bash
k6 run -e UPLOAD_EMAIL=... -e UPLOAD_PASSWORD=... -e UPLOAD_ACCOUNT_ID=... \
       ops/stress/s2-uploads.js --summary-export ops/stress/.results/s2.json
```

Sans ces variables, `setup()` échoue avec un message explicite (pas de faux
vert). Le fix du goulot d'upload (#8, sémaphore de concurrence `sharp`) est
prouvé **unitairement** indépendamment de ce run (cf. `RESULTS.md`).

## Secrets & posture (repo PUBLIC)

- **Aucun secret dans le code / les commits.** `CRON_SECRET`, `UPLOAD_*`,
  tokens admin batch : uniquement via env au moment du run.
- **Aucun chiffre d'infra prod sensible** dans `RESULTS.md` (on documente les
  mesures locales, pas la topologie prod).
- Fixtures binaires, dossier `.results/` : gitignorés.
- On **annonce** toute commande réseau sortante avant de la lancer (k6 est déjà
  installé — aucun téléchargement nécessaire pour la suite).
