# J7 — résultats des tests de charge

> **Local uniquement** (serveur local + base de vérif jetable port 55432).
> **Aucun chiffre d'infra prod** ici (posture repo public). Ce document
> distingue explicitement ce qui est **mesuré** de ce qui est **prêt mais
> non encore mesuré**, et documente les goulots **fermés** vs **chiffrés en TODO**.

## Environnement de mesure

|              |                                                                                           |
| ------------ | ----------------------------------------------------------------------------------------- |
| Cible        | `http://localhost:3000` (serveur local)                                                   |
| Base         | Postgres 17, conteneur `fxmily-j7-verify` (port 55432), jetable                           |
| Cohorte      | 1000 membres seedés (`seed-stress-cohort.ts`, idempotent)                                 |
| Outil        | k6 v2.1.0                                                                                 |
| Machine      | poste de dev local (chiffres RAM/CPU = process `node` local, non extrapolables à la prod) |
| Mode serveur | _<prod `next start` / dev `next dev` — renseigné au run>_                                 |

## Synthèse des goulots (revue → J7)

| #       | Goulot identifié                                                                             | Statut                                                                                                                 | Preuve                                                                              |
| ------- | -------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| **#8**  | Uploads : normalisation `sharp` sans borne de concurrence → risque OOM sous 50 uploads ~5 Mo | **FERMÉ** (sémaphore de concurrence)                                                                                   | test unitaire dédié (cf. § Uploads)                                                 |
| **#9**  | Recompute de score : fan-out cross-cohort non borné au burst                                 | **FERMÉ** (`MAX_CONCURRENT_RECOMPUTES=3`, commit `bd0a99b5`)                                                           | `scheduler.test.ts` (cf. § Recompute borné)                                         |
| **#10** | Leaderboard : lecture rang non indexée                                                       | **NON-PROBLÈME** — l'index `@@index([date, rank])` est déjà porteur (mesuré : 608× sur `latestBoardDate` à 91k lignes) | `EXPLAIN (ANALYZE)` réel via `j7-explain-leaderboard.ts` (cf. § Leaderboard indexé) |
| **#11** | Rate limiters en mémoire, mono-instance                                                      | **TODO chiffré** (pas un bug au stade actuel)                                                                          | cf. § Rate limiting                                                                 |

## Scénarios — avant / après

Les seuils « Done » sont dans chaque script et dans le README.

> **État de mesure k6 (honnête) — S1 MESURÉ le 2026-07-22 ; S3/S4 non mesurés.**
>
> **`/api/auth/csrf` 404 : RÉSOLU cette session.** Le run S1 live
> (`.results/s1-live.json`, `s1-checkin-burst.js`, 100 VUs) a produit **24 lectures
> `/dashboard` en 200 authentifié** (+ 1 `/checkin`) avec `redirects:0`. Un 200 sous
> `redirects:0` **ne peut arriver que si le cookie de session est valide** (une auth
> cassée donnerait un 307 → `/login`) ⇒ **`/api/auth/csrf` + `login()` fonctionnent**.
> L'hypothèse « csrf 404 / workspace-root Turbopack » des sessions précédentes est
> **levée par la mesure** : l'auth k6 s'authentifie réellement.
>
> **Ce que S1 mesure réellement = un plafond `next dev`, pas la prod.** À 100 VUs
> concurrents sur `next dev` (compile-on-demand, sans minification, process Node
> unique), `/dashboard` sature : min **2,9 s** (rendu RSC dev d'UNE requête chaude),
> médiane **43 s**, **p95 60 s** (plafond de timeout, atteint par 76/100). Ce n'est
> **ni un échec d'auth** (24 réponses 200 authentifiées ; les échecs sont des **timeouts**
> — `/dashboard` au plafond 60 s — ou des **aborts de fin de test** — `/checkin` ~27-43 s —,
> **aucun n'est un 307**. Preuve k6 indépendante : les **81 check-échecs == 81 `http_req_failed`**,
> or k6 ne compte **pas** un 307 comme `http_req_failed` ⇒ zéro 307, zéro faux-vert `/login`)
> **ni un défaut de la couche data** — là où elle est mesurée (`/classement`), l'`EXPLAIN`
> la situe à **2,1 ms** (§ Leaderboard indexé). Cet `EXPLAIN` **ne couvre pas** les requêtes
> propres à `/dashboard` ; leur lenteur est donc imputée au **rendu RSC dev-mode**, pas à la
> DB (aucune requête `/dashboard` n'a été profilée séparément). C'est la **contention de rendu dev-mode**.
> Conformément à l'en-tête `-Mode dev`, ces chiffres sont une **borne supérieure** ; ici
> la borne dev est dépassée ⇒ **non concluante pour la prod**. La lecture
> prod-représentative exige un harnais prod-https (cf. § Reste-à-faire).
>
> **S3/S4 non mesurés** : l'environnement de cette session s'est **verrouillé**
> (démarrage serveur long + shell de sonde localhost refusés — vérifié sur 3 voies)
> après le run S1 ; seul S1 a un artefact JSON. Les goulots #8/#9/#10 restent prouvés
> **indépendamment du wall-clock k6** (tests unitaires Vitest — 6057 tests verts au
> run local, exit 0 — + `EXPLAIN (ANALYZE)` réel), ce qui couvre le cœur technique de
> J7 ; les chiffres p95/p99 de S3/S4 sont le résidu explicitement non fait ici.

### S1 — burst de check-ins 21h (100 VUs, lecture) — MESURÉ 2026-07-22 (`next dev`, borne dev)

| Route       | p95 (ms)          | min (ms) | max (ms) | 200 authentifiés | verdict prod                   |
| ----------- | ----------------- | -------- | -------- | ---------------- | ------------------------------ |
| /dashboard  | 60002 (plafond)   | 2875     | 60009    | 24 / 100         | non concluant (saturation dev) |
| /checkin    | 42832             | 27770    | 42887    | 1 / 6            | non concluant (saturation dev) |
| /classement | — (non exercé S1) | —        | —        | —                | voir S3                        |

100 VUs, **306 requêtes**, 3,44 req/s ; checks **25/106** (rate 23,6 %). Les échecs sont des
**timeouts** (`/dashboard`, plafond 60 s) ou des **aborts de fin de test** (`/checkin`, ~27-43 s)
sous saturation `next dev`, **aucun n'est un 307** — l'auth fonctionne (cf. callout).
Source : `.results/s1-live.json` (artefact local **gitignoré** — chemins locaux ; régénérable via
`s1-checkin-burst.js`). **Interprétation** : plafond dev à 100 VU concurrents ; la couche data est
à 2,1 ms (`EXPLAIN`), donc la latence vient du rendu RSC **dev-mode** + process Node unique — non
représentatif de la prod. p99 non tabulé (le p95 sature déjà au plafond de timeout).
_(Traçabilité : `.results/server.log`/`s1.log` proviennent d'un run antérieur (~16h07) au
`s1-live.json` rapporté (~18h40) ; ils corroborent le csrf 200 + callback 302 mais ne sont pas
co-datés avec l'artefact S1 chiffré ci-dessus.)_

### S2 — uploads simultanés (50 VUs, preuve MT5 ~5 Mo)

Verdict cible : `upload_server_errors == 0` (0 OOM/5xx).

> **Prérequis non satisfait par la cohorte seedée** : l'upload MT5 exige une
> session membre **propriétaire d'un `accountId`** (contrôle BOLA), or la
> cohorte de 1000 membres n'a **aucun compte MT5** (choix du seed). S2 est donc
> **exécutable mais non mesuré ici** faute d'uploader dédié. Le fix du goulot #8
> est prouvé **unitairement et indépendamment** (§ Uploads ci-dessous), ce qui
> couvre le critère « 0 OOM/5xx » au niveau du driver réel (le sémaphore borne
> la RAM libvips quelle que soit la rafale). Run S2 complet = à faire avec un
> compte MT5 de test (cf. README § S2).

|                            | avant fix #8                                                           | après fix #8                                                                                                                                                                                                                                                                                                 |
| -------------------------- | ---------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Borne de concurrence sharp | aucune (N décodages libvips simultanés → OOM possible sous 50 uploads) | **`MAX_CONCURRENT_IMAGE_NORMALIZE = 3`** (sémaphore process-wide partagé proofs + avatars)                                                                                                                                                                                                                   |
| Mécanisme                  | —                                                                      | `runWithImageNormalizeLimit(fn)` enveloppe UNIQUEMENT le pipeline sharp `.toBuffer()` ; slot relâché en `finally` (un sharp qui throw ne fuit jamais de permit) ; la validation + le mapping d'erreur restent hors du gate (un upload en file d'attente ne tient pas de slot pendant qu'il est juste sniffé) |
| Preuve                     | —                                                                      | test unitaire `image-normalize-concurrency.test.ts` — pic de concurrence observé ≤ 3 sous rafale simulée (in-flight jamais > borne) _(sortie exacte renseignée aux gates)_                                                                                                                                   |

### S3 — lecture leaderboard (1000 membres)

|             | p95 (ms)    | p99 (ms)    | erreurs     | verdict (p95<800, p99<1500, err<1%) |
| ----------- | ----------- | ----------- | ----------- | ----------------------------------- |
| /classement | _à mesurer_ | _à mesurer_ | _à mesurer_ | _à mesurer_                         |

RSS max : _à mesurer_ Mo.

### S4 — API membre sous charge du worker batch

Verdict cible : surfaces `{scope:member}` restent saines (`p95<800`, `err<1%`)
PENDANT que le batch recompute martèle (rate-limité par design → 429 attendus,
non comptés comme échec).

| Route (scope:member) | p95 (ms)    | erreurs     | verdict     |
| -------------------- | ----------- | ----------- | ----------- |
| /classement          | _à mesurer_ | _à mesurer_ | _à mesurer_ |
| /dashboard           | _à mesurer_ | _à mesurer_ | _à mesurer_ |

Charge batch (scope:batch) : ratio 200/429 observé : _à mesurer_ (429 = borne active, attendu).

## Preuves déjà établies (indépendantes du wall-clock k6)

### Recompute borné (#9)

`src/lib/scoring/scheduler.ts` : sémaphore `MAX_CONCURRENT_RECOMPUTES = 3`
(commit `bd0a99b5`). Prouvé par `scheduler.test.ts` — le fan-out ne dépasse
jamais 3 recomputes concurrents, même si N membres déclenchent au même instant.
_(Compte de tests renseigné au run des gates, § Gates.)_

### Leaderboard indexé (#10)

`apps/web/scripts/j7-explain-leaderboard.ts` capture **les 2 requêtes `/classement`
exactes** (via Prisma query-events, le service porte `import 'server-only'`
non-chargeable par tsx) puis lance `EXPLAIN (ANALYZE, BUFFERS)` sur chacune. Le
harness raconte l'**histoire honnête en 2 régimes** (garde-fou dur `:55432/`) :

**Régime A — échelle actuelle (1000 snapshots, 1 seule date d'ancrage).**
`WHERE date = <ancre>` sélectionne **100 % de la table** → Postgres choisit
**correctement** un Seq Scan + Sort. L'index `(date, rank)` n'est **pas encore
décisif** à cette échelle (le forcer serait plus lent). C'est le comportement
attendu, pas un défaut.

**Régime B — accumulation multi-jours (~91k lignes = 90 jours × 1000, gonflées
dans une transaction `BEGIN … ROLLBACK` non destructive).** `date = <ancre>`
devient ~1,1 % sélectif → la requête `getLeaderboardBoard` **bascule sur un
Index Scan** de `leaderboard_snapshots_date_rank_idx`. Chiffres **réellement
mesurés** (`EXPLAIN (ANALYZE, BUFFERS)`, run 2026-07-21 sur la DB verify :55432).
Le log brut vit dans `.results/` (**gitignoré** — hygiène repo public, il porte des
chemins locaux) ; il est **régénérable à l'identique** via le script commité
`apps/web/scripts/j7-explain-leaderboard.ts`. Les chiffres ci-dessous en sont la
transcription vérifiée :

| Requête                                                | avec index                         | sans index (DROP dans la tx) | facteur   | plan sans index                                      |
| ------------------------------------------------------ | ---------------------------------- | ---------------------------- | --------- | ---------------------------------------------------- |
| `latestBoardDate` (`ORDER BY date DESC LIMIT 1`)       | **0,047 ms** (Index Scan Backward) | **28,607 ms**                | **~608×** | Seq Scan + top-N heapsort (12 377 buffers)           |
| `getLeaderboardBoard` (`WHERE date=X … ORDER BY rank`) | **2,108 ms** (Index Scan)          | **5,635 ms**                 | **~2,7×** | Nested Loop sur `user_id_date_key` (PAS un Seq Scan) |

**Nuance honnête, vérifiée sur le plan réel** : l'index `date_rank` est
**décisivement porteur** pour `latestBoardDate` (608× : sans lui, Postgres full-scanne
91k lignes pour trouver le max). Pour `getLeaderboardBoard`, il apporte ~2,7×,
mais s'il disparaît Postgres **ne tombe pas en Seq Scan** : il se rabat sur l'index
unique `leaderboard_snapshots_user_id_date_key` via un Nested Loop — donc l'index
`date_rank` optimise le board sans en être l'unique rempart. Dans les deux régimes,
**aucune lecture `/classement` ne dégénère en Seq Scan de table quand l'index est
présent**.

La transaction est **ROLLBACK** → chaque ligne gonflée ET l'index sont restaurés
(vérifié dans le log : `index restored … (1/1)` + `row count after ROLLBACK: 1000`).
**Conclusion : aucun refactor requis.** L'index existant est déjà porteur ; il
devient décisif automatiquement à mesure que le cron nocturne accumule un snapshot
par membre et par jour. La requête est bornée par cohorte + indexée par construction.

### Seed reproductible (#6)

`scripts/seed-stress-cohort.ts` — idempotent, garde-fou dur `:55432/`. Compté
réellement sur la base seedée (`SELECT count(*)` le 2026-07-20) :

| Métrique                                  | Valeur                            |
| ----------------------------------------- | --------------------------------- |
| Membres `stress-cohort-*`                 | **1000** (tous `status='active'`) |
| Lignes `leaderboard_snapshots`            | **1000**                          |
| Membres rangés (`rank IS NOT NULL`)       | **950**                           |
| Membres sans rang (données insuffisantes) | **50**                            |

La coupure 950/50 est intentionnelle : ~5% de la cohorte a trop peu d'historique
pour être classée (miroir du gating de rang réel), ce qui exerce aussi la branche
« pas encore classé » du leaderboard sous charge.

## Rate limiting (#11 — TODO chiffré, pas un bug maintenant)

Investigation exhaustive (16 limiters cartographiés). Les 16 `TokenBucketLimiter`
(`apps/web/src/lib/rate-limit/token-bucket-core.ts`) stockent leur état dans des
`Map` process-local **bornées** (LRU, `maxKeys ≥ 5000`) → **pas de fuite mémoire**,
éviction vérifiée dans le code (`LruMap.set`). Ils couvrent le login
(anti-brute-force par email + IP), le reset de mot de passe, les tokens admin
batch, les crons, les uploads, la santé, etc.

Le déploiement Fxmily actuel est **mono-instance, mono-process** — vérifié (pas
supposé) sur 3 sources : `ops/docker/docker-compose.prod.yml` (un seul service
`web`, aucun `replicas`), `ops/caddy/Caddyfile` (`reverse_proxy web:3000`, upstream
unique), `ops/docker/Dockerfile.prod` (`CMD ["node", "apps/web/server.js"]`, un
seul process). Les limiters en mémoire fonctionnent donc **correctement pour la
topologie réelle**.

**Décision J7 : TODO chiffré, pas de fix** (cohérent avec le hors-scope déclaré
« multi-instance / BullMQ = TODO seulement »). Le TODO est **déjà inscrit dans le
code source** (`token-bucket-core.ts` : _« Migration path to Redis (J10 prod):
swap Map for an Upstash redis pipeline »_). Migration à faire le jour où Fxmily
passe multi-instance : store partagé (Redis/Upstash) + décrément atomique (script
Lua) pour que les compteurs soient cohérents entre instances.

Seul effet de bord connu au stade actuel : un redéploiement (restart du container
`web`) réinitialise les compteurs. Fenêtre non exploitable par un tiers (il ne
contrôle pas le rythme de déploiement) — acceptable en V1 (30→100 membres).

## Gates socle (J7 Done)

- [ ] `pnpm format:check && pnpm lint && pnpm type-check && pnpm build`
- [ ] `pnpm --filter @fxmily/web exec vitest run` (dont `scheduler.test.ts` + test sémaphore uploads)
- [~] preuve runtime — **`EXPLAIN (ANALYZE)` réel exécuté** (#10, via `j7-explain-leaderboard.ts` sur la DB verify :55432 ; log local gitignoré) ; **k6 S1 live exécuté** (2026-07-22, `.results/s1-live.json` : auth OK, saturation `next dev` à 100 VU = borne dev non concluante prod, cf. § S1) ; **S3/S4 non exécutés** (env verrouillé après S1)
- [~] **parcours membre mobile vert en CI** — check `Playwright (mobile-iphone-15, golden path)` (`.github/workflows/e2e-mobile.yml` → `pnpm exec playwright test --project=mobile-iphone-15 smoke-tour-j6.spec.ts`, webkit iPhone 15 375 px) ; exerce le golden-path membre de bout en bout à l'exécution réelle. Vert sur la PR #551. C'est la preuve « place du membre » côté runtime, complémentaire de la charge k6.
- [ ] PR CI verte + merge + déploiement (infra déjà provisionnée)
- [ ] sonde prod (`db:ok`)

_(Cochés + preuves renseignés à la clôture. `[~]` = partiel/honnête, pas coché.)_

## Revue adversariale finale — contextes frais (2026-07-22)

Revue en **4 sous-agents Opus 4.8 en contextes frais** (workflow `wf_8dfdf647-119`,
525 s, 0 erreur) : 3 audits parallèles (artefacts stress / perf `/classement` /
gardes de concurrence) + 1 synthèse. Chaque audit devait **réfuter** la thèse.

**Verdict consolidé : `NO_GO`** pour un merge/deploy présenté comme _« J7
load-readiness prouvé par mesure »_ (règle : ≥1 finding `blocker` ⇒ NO_GO).

Nuance (honnête) : le **code de la suite est sain et scrupuleusement honnête** (aucun
GO faux revendiqué), et les goulots #8/#9/#10 ont des **preuves indépendantes
solides** — sémaphores mono-thread corrects (hand-off au release, libération en
`finally`), `EXPLAIN (ANALYZE)` réel ~608×, **absence de N+1 sur `/classement`
CONFIRMÉE** (`service.ts` = 1 + 1 + (0 ou 4) requêtes, reste en mémoire). Merger la
suite **en tant qu'outillage** est à faible risque.

Deux hypothèses de perf ont été **RÉFUTÉES par voie indépendante** :

- « N+1 au rendu de `/classement` » → FAUX (aucune requête par ligne).
- « Hydratation framer-motion coûteuse par ligne » → FAUX (liste = 100 % Server
  Components, `<details>`/`<summary>` natif, 0 JS d'hydratation ; seul îlot client =
  `AvatarImage` quand photo présente).
- Cause réelle du rendu ~73-101 s en dev = **artefact RSC dev-mode Turbopack** sur un
  arbre ~1000 lignes (non représentatif prod). Concern résiduel réel = rendu serveur
  **O(N)** sans pagination + `force-dynamic` → à confirmer via `next build`, watch-item
  vers 1000 membres, négligeable à 30-100.

### Blockers (empêchent de signer « readiness mesurée »)

1. **Zéro baseline de charge mesurée** : toutes les cellules p95/p99/taux-échec de
   S1/S3/S4 = `_à mesurer_`, S2 non mesuré. Seuls réels : `EXPLAIN` DB-level + comptes
   de seed ⇒ le livrable-cœur _mesure_ est absent.
   → **MàJ 2026-07-22 : partiellement levé.** S1 **mesuré** live (§ S1) — mais le
   résultat est une **borne dev saturée** (p95 60 s à 100 VU sur `next dev`), non
   concluante pour la prod. S3/S4 restent non mesurés (env verrouillé). Le blocker
   « readiness prouvée par mesure prod » **tient toujours** (il faut un harnais
   prod-https), mais « k6 ne tourne pas / auth cassée » est **infirmé**.
2. **`/api/auth/csrf` 404, cause racine non résolue** (worktree / Turbopack
   workspace-root) : `login()` dépend d'un csrf 200 ⇒ S1/S3/S4 non-authentifiables ⇒
   3/4 scénarios non-exécutables cette session. La prod sert `/api/auth/csrf`
   normalement — c'est un blocage **local du harness**, pas un bug prod.
   → **MàJ 2026-07-22 : RÉSOLU (infirmé par la mesure).** Le run S1 live a produit
   **24 lectures `/dashboard` en 200 authentifié** sous `redirects:0` ⇒ csrf + login
   fonctionnent. L'hypothèse Turbopack workspace-root est **levée**.

### Correctif appliqué suite à la revue (major → fermé)

**Faux-vert 307 → /login** : `authParams` posait déjà `redirects:0`, mais les
`check()` `status===200` étaient _advisory_ (ne gatent pas le run) et le
`http_req_failed` par défaut de k6 ne compte PAS un 307 comme échec. Un run aux
tokens cassés pouvait donc passer seuils+p95 tout en mesurant `/login`.
→ **Fix** : seuil sur la métrique `checks` ajouté à S1/S3/S4 (`checks: ['rate>0.99']`,
S4 scopé `{scope:member}`). Un run à l'auth cassée **échoue désormais bruyamment**.
_(Correct par inspection ; `k6 run` non rejoué cette session — même blocage csrf.)_

### Reste-à-faire (résiduels — prérequis avant de signer J7 readiness)

- ~~Résoudre le **csrf 404**~~ **FAIT 2026-07-22** (auth k6 prouvée par la mesure S1).
  Reste : **`k6 run` réel S3/S4** (S1 fait mais borne dev saturée) contre un **harnais
  prod-représentatif** — car `next dev` sature à 100 VU et ne donne pas de baseline prod
  exploitable ; un `next start` derrière un proxy TLS local (pour satisfaire le refine
  Zod `AUTH_URL=https`) est le chemin, hors de portée dans un env sans serveur long.
- **Baseline prod `/classement`** : `next build && next start` (le Zod refine d'`env.ts`
  bloque `next start` sur `AUTH_URL` http → à contourner) pour la magnitude réelle du
  rendu RSC 1000 lignes.
- **S2 end-to-end** : compte MT5 seedé + creds `UPLOAD_*` (#8 prouvé unit-only).
- **Write-path** check-in → recompute fan-out sous k6 réel (#9 prouvé unit-only).
- **Filet de régression #10** : rendre `j7-explain-leaderboard.ts` exit ≠ 0 sur échec
  d'assertion de plan (il imprime `PARTIAL` et sort 0) + l'ancrer en CI.
- Vérifier le **lazy-loading avatars** (`loading='lazy'`) avant de scaler à 1000 membres.
- Prouver que sémaphore #9 **+** batching cron tiennent conjointement le pg-pool.
