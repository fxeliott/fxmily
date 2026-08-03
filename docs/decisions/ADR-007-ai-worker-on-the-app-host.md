# ADR-007 — Le worker IA quitte le PC pour l'hôte de l'app (J9)

- **Status** : Proposed (2026-08-02) — à passer Accepted après la bascule réelle : `verify-worker-vps.sh` **7/7**, dont au moins un `PASS/generated` parmi les quatre générateurs (`weekly`, `monthly`, `calendar`, `profile`) ; `onboarding` / `verification` / `seances` sortent avant tout appel modèle en `--dry-run` et plafonnent donc à `PASS/pull-only` (cf. RUNBOOK § « Compare »). Plus : tâches PC désactivées + un cycle hebdo complet sans incident.
- **Date** : 2026-08-02
- **Scope** : jalon J9 « Workers IA → VPS ». Porte l'ordonnancement et l'exécution des 7 pipelines `claude --print`. Ne touche NI aux prompts (J5), NI au chemin SDK payant (hors périmètre, interdit ❶).
- **Related** : ADR-004 / ADR-005 (canon batch-local Claude Max partagé) · `ops/worker/RUNBOOK.md` · `ops/worker/README.md` (le worker Windows que ceci remplace).

## Contexte

### Le problème, en une phrase

Toute la génération IA visible par un membre — profil d'onboarding, digest hebdo,
débrief mensuel, calendrier adaptatif, vérification de preuve MT5, re-profilage
mensuel — tourne sur le PC Windows personnel d'Eliot via le Planificateur de
tâches. **PC éteint, Eliot déconnecté de sa session Windows, ou compte Claude
expiré ⇒ plus aucune génération pour personne**, sans que rien ne le dise à un
membre qui voit deux écrans lui promettre son profil « dans les prochaines 24h ».

C'est le P1 « SPOF » de la revue produit du 2026-07-11, surface « Infra ».

### Ce qui existe déjà et ne doit pas être réinventé

`ops/worker/run-batch.sh` porte, et a déjà prouvé en production, tout ce qui rend
ces batches sûrs : verrou **global** (un seul `claude --print` à la fois), sleeps
**jitterés plancher 30 s**, stamp de **cooldown quota** avec sortie 75 remappée en
succès, pré-vol `claude auth status --json`, `status.json` par pipeline, épilogue
garanti par `trap`. Ce sont les protections anti-ban. **Le portage les transporte
telles quelles ; il n'en réécrit aucune.**

### La contradiction du SPEC qu'il faut trancher, pas contourner

`SPEC.md:60` disait, verbatim — avant l'alignement opéré au close-out de ce jalon,
et n'écrit plus cela aujourd'hui : « human-in-the-loop (**génération jamais
cronnée**, anti-ban) ». Mais `SPEC.md:1205` décrit un « Auto (cron mensuel) », et le jalon J2
a déjà mis les 6 pipelines sous Planificateur de tâches Windows — donc cronnés,
depuis 2026-07-02, sur la machine d'Eliot.

**Tranché ici, explicitement.** La phrase du SPEC visait un risque réel, mais l'a
nommé par son symptôme d'époque plutôt que par sa cause. Ce qui protège un compte
n'est pas l'absence d'ordonnanceur : c'est le **volume**, la **cadence** et
l'**humain qui reste responsable**. Les mitigations qui portent réellement cette
protection sont : une invocation par membre, sleeps jitterés ≥ 30 s, sérialisation
globale, binaire officiel uniquement, jamais `--bare`, breaker après N échecs
consécutifs, halte immédiate sur détection de limite d'usage, cooldown après un
cap, et compte dédié. **Toutes sont conservées, aucune n'est affaiblie.** Ce que
l'ordonnanceur retire, ce n'est pas la prudence — c'est le SPOF. Un humain qui
oublie de lancer un batch n'est pas une protection anti-ban ; c'est un membre qui
attend.

Le SPEC sera aligné sur cette lecture au close-out du jalon.

## Décisions

### D1 — L'hôte : la machine de l'app, pas un second VPS

**Décision : les 7 pipelines tournent sur l'hôte Hetzner existant, sous
l'utilisateur non privilégié `fxmily`.**

Deux raisons, dans cet ordre :

1. **Interdit dur ❶ — je ne loue rien.** Créer un second VPS est une dépense.
   Ce n'est pas ma décision, et l'ADR ne peut pas la prendre pour Eliot.
2. **Mesuré, l'hôte actuel est très largement dimensionné** : 8 cœurs, 15,6 Go
   de RAM (14,2 Go disponibles), 269 Go libres sur 301, `load average 0.05` sur
   25 jours d'uptime, fuseau `Europe/Paris`. Il fait tourner trois conteneurs
   (web, Postgres, Caddy) qui n'en consomment presque rien.

Ce que ça coûte, et que je ne masque pas : l'isolation CPU/RAM est **souple**.
Un batch qui s'emballerait partagerait la machine avec Postgres et l'app. Trois
garde-fous, du plus faible au plus fort : `nice -n 10` + `ionice` (politesse),
plafond mur de 2 h par batch (`FXMILY_WORKER_TIMEOUT`, équivalent Linux de
l'`ExecutionTimeLimit` Windows), et le verrou global qui garantit qu'**un seul**
batch tourne à la fois. En pratique un `claude --print` attend le réseau ; le
coût CPU réel est celui d'un process Node par membre, sérialisé.

Si un jour la contention devient mesurable, la sortie propre est un VPS dédié —
et c'est alors une décision d'Eliot, pas une dérive silencieuse.

**Alternatives écartées.** _(a)_ Second VPS : interdit ❶. _(b)_ Conteneur Docker
dédié sur le même hôte : ajoute une couche (image à builder, à déployer, à
mettre à jour) pour une isolation que `nice` + le verrou global donnent déjà, et
le CLI `claude` devrait de toute façon monter un volume pour ses credentials —
la complexité ne paie pas. _(c)_ GitHub Actions : le compte Claude Max ne peut
pas y être connecté, et ce serait exactement l'extraction de token que le jalon
interdit.

### D2 — L'ordonnanceur : `cron`, pas des timers systemd

**Décision : `/etc/cron.d/fxmily-worker`, dans son propre fichier.**

Les timers systemd sont techniquement supérieurs (dépendances, `Persistent=`,
`RandomizedDelaySec`, cgroups). Ils ne gagnent pas ici, pour trois raisons
concrètes :

- **L'hôte a déjà un modèle cron éprouvé** : 25 lignes dans
  `/etc/cron.d/fxmily-app`, un wrapper `/usr/local/bin/fxmily-cron`, un
  convergeur root `fxmily-sync-cron`, une convention de forme de ligne, un log
  central. Introduire un second ordonnanceur pour sept lignes, c'est deux
  modèles mentaux à tenir en tête à 2 h du matin.
- **Le fuseau est déjà résolu, et prouvé** : Debian `vixie-cron` lit les heures
  de `/etc/cron.d` en **heure locale de l'hôte**, qui est `Europe/Paris`. Les
  horaires Windows se transposent 1:1, DST compris. J9 demande « reproduire les
  schedules en heure Paris » — c'est littéralement gratuit ici.
- **`Persistent=` ne nous manque pas** : sur une machine allumée en permanence,
  le rattrapage d'un tick manqué n'a pas d'objet, et chaque `pull` est
  idempotent — un tick sauté est repris par le suivant.

**Fichier séparé, délibérément.** Un rollback est `rm /etc/cron.d/fxmily-worker`,
sans le moindre risque de toucher une des 25 lignes de l'app, et le validateur
root de l'app n'a jamais à accepter un nouveau nom de commande.

### D3 — Où vivent les logs et les statuts

**Décision : deux surfaces, deux publics, aucune duplication.**

| Surface                                                                   | Contenu                                                   | Pour qui                         |
| ------------------------------------------------------------------------- | --------------------------------------------------------- | -------------------------------- |
| `~/worker/ops/worker/logs/<batch>.{log,status.json}`                      | sortie brute + verdict machine du dernier run             | diagnostic en SSH, watchdog      |
| `/var/log/fxmily/worker.log`                                              | une ligne par tick : batch, verdict, mode, durée          | lecture chronologique, logrotate |
| `/var/log/fxmily/<batch>.wrapper.log`                                     | la sortie complète du batch, hors du chemin chronologique | diagnostic après une ligne FAIL  |
| **Postgres `audit_logs`** (`*.batch.pulled`, `worker.watchdog.heartbeat`) | le heartbeat que lit `/admin/system`                      | Eliot, sans SSH                  |

`/admin/system` **ne lit aucun fichier**. Il lit les lignes d'audit que le
serveur écrit lui-même à chaque `pull` — ce qui est la bonne source : elle
prouve que le batch a réellement parlé à la prod, pas qu'un fichier existe sur
une machine. C'est aussi ce qui rend le tableau indépendant de l'endroit où
tourne le worker : le portage ne change pas une ligne du modèle.

Les fichiers restent locaux à la machine (jamais de PII vers un tiers), tournés
par `logrotate` hebdo, 8 conservés.

### D4 — Ce que `seances` rejoint, et ce qu'il ne rejoint pas

**Décision : `seances` entre dans le contrat worker pour tout ce que le contrat
gouverne, et rien de plus.**

`ReplaySession` stocke des **métadonnées** de transcript — verbatim dans le
schéma : _« content lives derived, never raw here »_. Le transcript brut n'est
jamais persisté côté serveur. La machine qui génère le contenu d'une séance doit
donc être celle qui le détient : celle de l'opérateur. **Aucun portage ne déplace
cette jambe-là** : il n'y a rien, sur le serveur, à partir de quoi générer.

Ce qui entre : verrou global, `worker.env`, `status.json`, cooldown, pré-vol
d'auth, log central, ordonnancement, heartbeat, et surveillance sur
`/admin/system` — d'où `seance.batch.pulled` est aujourd'hui **exclu** au motif
(exact, à l'époque) qu'un pipeline tiré à la demande n'a pas de période
attendue. Il en a une maintenant.

Ce que ça achète concrètement : la séance cesse d'être un angle mort. Chaque
tick nomme dans le log les sessions tenues qui attendent encore un dépôt humain,
au lieu que le manque soit découvert par un membre devant une rediffusion vide.

### D5 — L'alerte : le serveur d'abord, Healthchecks.io ensuite

**Décision : `WORKER_HOST=server` fait rejoindre le tableau worker à
`/api/cron/health`, donc à `cron-watch.yml`. Healthchecks.io reste une seconde
voie, optionnelle.**

Le tableau worker était délibérément tenu **hors** de `/api/cron/health` : sur un
PC légitimement éteint la nuit, le watcher GitHub aurait ouvert une issue chaque
soir, et un veilleur qui crie au loup tous les soirs est un veilleur que
personne ne lit. Cette objection meurt avec le SPOF. Une fois sur l'hôte
permanent, « la machine était éteinte » n'est plus une excuse : les tolérances
se resserrent sur la cadence réelle, et un pipeline mort **atteint un humain
tout seul**, par le même canal qu'un cron mort.

Pourquoi pas Healthchecks.io en premier : créer un compte tiers n'est pas une
action que je prends seul, et un canal gratuit tourne déjà toutes les heures en
production.

> **Correction 2026-08-03 — ce canal n'est pas celui écrit ici.** Cette phrase
> disait `health → cron-watch → issue GitHub`. Vérifié : `gh repo view --json
hasIssuesEnabled` retourne `false`, et un grep de `cron-watch.yml` ne trouve
> **aucune** création d'issue. Le canal réel est `health → cron-watch → run en
échec → notification GitHub par e-mail`. Il existe et il est gratuit, mais il
> est plus fragile que ce que ce paragraphe laissait croire : il ne laisse aucune
> trace assignable, il se noie dans les autres rouges de l'onglet Actions — c'est
> exactement ce qui s'est passé le 2026-08-03, l'apex répondant CF 522 toutes les
> heures pendant que le heartbeat, lui, était vert — et une notification e-mail
> se désactive d'un clic sans que personne ne s'en aperçoive.
>
> Ce que ça change : le refus de Healthchecks.io tient toujours (compte tiers =
> décision d'Eliot), mais il ne peut plus s'appuyer sur « un pipeline mort
> atteint un humain tout seul » comme sur un fait acquis. Le « Done quand » #3 du
> jalon reste **ouvert** tant qu'une alerte n'a pas été observée de bout en bout.

Les URLs
Healthchecks.io sont donc **câblées et inertes** (une par pipeline, vides par
défaut) : Eliot les colle quand il veut une alerte qui survit même à une app
tombée.

Une URL **par pipeline**, jamais une partagée : sept pipelines derrière un seul
check, un seul tick sain garde le check vert pendant que six sont morts — pire
que pas de check du tout.

### D6 — La bascule : un interrupteur, pas une procédure

**Décision : `FXMILY_WORKER_DRY_RUN` dans `/etc/fxmily/cron.env`.**

`1` = le serveur tire et génère pour de vrai mais ne persiste rien (fenêtre
d'observation, le PC reste maître). `0` = le serveur prend la main. Une ligne,
un fichier, effet au tick suivant, réversible par le même geste.

Basculer en réécrivant `/etc/cron.d` demanderait de réinstaller un fichier root
dans les deux sens — c'est le genre de rollback que personne n'exécute à 23 h
quand quelque chose ne va pas. Un rollback qu'on peut faire en cinq secondes
sous pression est le seul qui soit réellement exécuté.

## Conséquences

**Acquis.** Le PC redevient un poste de travail : l'éteindre n'a plus d'effet
sur un seul membre. Les 7 pipelines gagnent un ordonnanceur permanent, un log
central, une rotation, un plafond de temps, une politesse CPU/IO, et une alerte
automatique. `seances` sort de l'angle mort. La bascule et le rollback sont
chacun une ligne.

**Coûts assumés.** Isolation souple (D1). Un second `~/.claude` à maintenir à
jour sur l'hôte. Un checkout dédié qui doit rester aligné sur la version
déployée de l'app — le runbook en fait une étape de maintenance explicite, parce
qu'un checkout en retard sur un changement de schéma serveur est exactement la
façon dont un batch se met à échouer sur une validation Zod que personne
n'attendait.

**Ce qui reste à Eliot, et que je ne peux pas faire.** Choisir le compte Claude
dédié et le connecter (`claude auth login --claudeai`) : c'est un geste de
credentials, il reste manuel par construction. Tant qu'il n'est pas fait, chaque
tick est un skip propre et documenté — jamais un échec silencieux.

## Risques et parades

| Risque                                                     | Parade                                                                                                                                                  |
| ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Deux maîtres (PC réactivé pendant que le serveur persiste) | Un seul maître à la fois, écrit dans le runbook ; rien ne se corrompt (pulls filtrants, persists idempotents) mais deux quotas brûlent pour un résultat |
| Session Claude expirée sans que ça se voie                 | Pré-vol à chaque batch + `claude_auth:logged_out` escaladé en rouge sur `/admin/system` avec la commande exacte                                         |
| CRLF dans `/etc/cron.d` (panne muette de ~20 h en 2026-05) | `.gitattributes` + strip à l'installation + comptage d'octets CR par l'installeur ET par le watchdog                                                    |
| Cap de quota qui martèle un compte limité                  | Halte immédiate à la détection + stamp de cooldown + skip bénin des ticks suivants (porté tel quel du PC)                                               |
| Le worker sature l'hôte de l'app                           | `nice`/`ionice` + plafond 2 h + verrou global ; escalade = VPS dédié, décision d'Eliot                                                                  |
| Fausse alarme pendant la fenêtre d'observation             | Le watchdog serveur rapporte `claude_auth:observation_pending` (informatif) et non `claude_auth:logged_out` (rouge) tant que `FXMILY_WORKER_DRY_RUN=1`  |

## Addendum 2026-08-03 — ce que le jalon avait créé sans le voir

Trois passes de revue en contexte frais ont fermé les défauts que J9 s'était
lui-même infligés (#580, #581). Une quatrième, menée depuis deux angles opposés,
en a trouvé un cinquième et un structurel. Consignés ici parce qu'ils changent
la façon de maintenir ce worker, pas seulement son code.

### D7 — Les wrappers n'avaient aucun canal vers l'hôte

_État constaté **avant** le correctif décrit plus bas._ Le `scp` de `deploy.yml`
envoyait une liste **explicite de huit fichiers**. Les deux wrappers que ce jalon
a créés — `ops/cron/fxmily-worker` et `ops/cron/fxmily-worker-watchdog` — n'en
faisaient pas partie, et le checkout `~/worker` non plus. Merger un correctif de
wrapper changeait donc le dépôt et **rien d'autre**, sans qu'aucune porte ne le
dise.

Depuis, cette liste en compte **dix** (les deux wrappers ont été ajoutés). Elle
vit sur la ligne `source:` du step `Sync cron + ops scripts` — pas de numéro de
ligne ici, les précédents pointaient déjà vers un commentaire et non vers la
liste.

Ce n'est pas théorique : #580 et #581 ont tous deux modifié le watchdog, et
l'hôte a continué de faire tourner la version de #579.

C'est la **troisième occurrence** de la même classe de panne dans ce dépôt
(tour 14 : `docker-compose.prod.yml`, volume uploads perdu ; 2026-07-29 :
`ops/caddy/Caddyfile`, d'où `sync-caddy-prod.yml`).

**Correction — le canal automatique existait déjà.** La première rédaction de ce
D7 concluait à un manque de canal et construisait un workflow ops. Une revue
finale en contexte frais a montré que la conclusion était fausse d'un cran :
`deploy.yml` copie les scripts ops vers `/home/fxmily/cron-sync` **puis lance
`sudo /usr/local/bin/fxmily-sync-cron`** — précisément l'unique commande que
l'utilisateur `fxmily` a le droit d'exécuter en root — et ce validateur porte
une table générique `MANAGED_SCRIPTS`. Le défaut n'était pas l'absence de canal :
c'était que J9 avait livré ses deux wrappers **dans aucune des deux listes**.
Deux noms de fichier (`deploy.yml:169`) et deux lignes (`fxmily-sync-cron:56`)
les font converger **automatiquement à chaque déploiement sain**, sans geste.

Un point à connaître : `fxmily-sync-cron` est **root-pinned et ne s'installe
jamais lui-même**. La table mise à jour ne prend donc effet qu'après une
installation root ponctuelle du nouveau validateur depuis le répertoire de
staging. Tant qu'elle n'a pas eu lieu, les déploiements continuent de converger
les cinq scripts d'avant et ne disent rien des deux wrappers.

Reste `.github/workflows/worker-host-sync.yml`, frère de `sync-caddy-prod.yml`,
qui garde une utilité distincte du déploiement : il **mesure** l'hôte depuis CI.
`inspect` compare chaque wrapper installé **octet à octet** avec le checkout —
c'est exactement ce qui aurait attrapé la dérive #580/#581 le jour même ;
`converge` remet `~/worker` sur `origin/main` (que **rien** ne pousse : aucun
déploiement ne touche ce checkout, alors que c'est lui que les wrappers
exécutent) puis installe si l'hôte lui en donne le droit ; `verify` lance le
balayage 7 pipelines.

Il n'est **délibérément pas planifié** : `Cron Watch` est rouge en permanence sur
la sonde de l'apex depuis des jours et ne peut donc plus annoncer une panne
_nouvelle_. Un second veilleur rouge par défaut n'achèterait rien.

### D8 — Sept familles de labels critiques sur huit n'avaient aucune remédiation

`SERVER_CRITICAL_LABELS` escalade alors huit familles en rouge. `LABEL_HOST_ACTIONS`
comptait **trois** clés, en égalité stricte — mais une seule de ces trois
(`claude_auth:logged_out`) appartenait aux huit familles critiques ; les deux
autres (`claude_auth:observation_pending`, `claude_quota:capped`) n'y sont pas.
D'où **sept** familles sans remédiation, et non huit moins trois : la
soustraction naïve donne cinq et c'est l'erreur que ce paragraphe induisait.
`task_missing:onboarding`
rougissait bien la ligne (#580 avait appris les préfixes à `isCriticalLabel`)
puis tombait dans `if (!remediation) continue` : la carte « Actions hôte »
affichait alors _« le watchdog du worker ne tourne plus, réinstalle »_ — le
diagnostic exactement inverse, énoncé avec assurance, sur un hôte dont le
watchdog était vivant et disait vrai.

Corrigé par une résolution exacte-puis-famille qui reprend la règle ancrée sur
`:` de `isCriticalLabel` — c'est le séparateur qui empêche
`batch_failed_observation:*`, émis à **chaque** tick d'une fenêtre d'observation
saine, d'être capté par la famille bloquante `batch_failed`.

### D9 — Les sept pipelines vivaient dans six listes qui ne se parlaient pas

Le nom des sept pipelines est codé en dur dans six fichiers, en trois langages
(planification, deux listes blanches, watchdog, porte de bascule, installeur).
Rien ne les comparait ; `check-cron-crontab-sync.mjs` fait ce travail pour les
routes `/api/cron/*` de l'app et ne contient pas le mot « worker ».

Les deux pannes sont asymétriques et toutes deux silencieuses : **planifié mais
non surveillé** (le pipeline tourne, et le jour où il meurt rien ne le dit — la
cécité même que ce jalon existe pour supprimer) et **surveillé mais non
planifié** (`task_missing:<nom>` à chaque tick, pour toujours, donc un tableau
rouge en permanence que plus personne ne lit).

`scripts/check-worker-pipeline-sync.mjs` tient les six listes à l'égalité stricte
et vérifie que chaque pipeline a une entrée sur le tableau. Ajouter un huitième
pipeline demande six éditions correctes ; c'est désormais une porte, plus une
discipline.

La vérification du tableau est volontairement la plus faible qui ne peut pas
donner de faux positif — la chaîne d'action doit **apparaître** dans le fichier —
mais elle apparaît désormais **dans du code** : les commentaires sont retirés
avant la recherche, sans quoi un `// TODO: câbler 'seance.batch.pulled'` suffirait
à faire verdir la porte sur un tableau qui n'a pas cette entrée. Les blocs
`/* … */` sont suivis par un drapeau d'état et non par la forme des lignes : une
première version ne retirait que les lignes commençant par `//`, `*` ou `/*`, ce
qui laissait le **corps** d'un bloc entièrement cherchable — démontré, pas
supposé, par un commentaire de deux lignes qui faisait passer la porte sur un
tableau vide. Vérifié dans l'autre sens aussi : sur les 1 860 lignes de
`health.ts`, le retrait n'enlève **aucune** ligne de code.

### D10 — « Aucun secret dans le dépôt » était vrai, et ne se vérifiait qu'à la main

Le cinquième critère « Done quand » de J9 a été prouvé à la main : `.gitignore:32`
ignore `ops/worker/worker.env`, aucun `worker.env` n'est suivi, aucun jeton
littéral, seules des IP de documentation RFC 5737. Une vérification manuelle
prouve l'état du jour où elle est faite et rien après : le dépôt est **public**,
et il suffit du prochain contributeur qui colle un vrai jeton dans
`worker.env.example` « pour montrer la forme ».

Le critère a donc désormais une porte
(`apps/web/src/lib/system/worker-secrets-hygiene.test.ts`) : la ligne
d'ignorance existe, aucune clé de type jeton n'a de valeur dans l'exemple, et
aucun fichier de la surface worker n'assigne de littéral long à une clé de
secret — sous trois formes de collage (`CLÉ=valeur`, `clé: valeur` YAML, et
l'en-tête HTTP d'un `curl -H`), casse indifférente. Le balayage énumère les
fichiers **sur le disque** plutôt qu'en dur, pour qu'un script ajouté demain dans
`ops/worker/` soit couvert le jour où il arrive — et un test refuse qu'une liste
vide passe pour une preuve, la faute même que l'installeur de ce jalon avait dû
corriger.

**Ce qu'elle ne prouve pas, et pourquoi c'est écrit ici.** Sa première version
s'appelait « le dépôt ne livre aucun secret worker ». Elle ne prouvait pas ça, et
une revue a montré en une minute par où passer (jeton dans un en-tête `curl`,
clé en minuscules, `AWS_ACCESS_KEY_ID`, hash commençant par `$`). Trois de ces
angles sont maintenant couverts, les autres non, et le libellé de la porte
n'énonce plus que ce qu'elle mesure : **aucun littéral long sous une clé de type
secret, sur une liste de fichiers nommée**. Un scanner de secrets à l'échelle du
dépôt est un autre outil, avec un autre budget de faux positifs — sa place est au
pre-commit, pas ici. Sur un dépôt public, une porte dont le nom promet plus que
sa preuve finit par servir d'argument pour ne pas regarder.

Deux réglages viennent de ce que la porte a trouvé **sur elle-même** au premier
lancement : `PING_URL` n'est pas ancré en fin de clé (les sept vraies clés sont
`HEALTHCHECK_PING_URL_WORKER_*`, le marqueur est au milieu — ancré, il ne matchait
aucune des sept clés pour lesquelles il avait été ajouté), et les valeurs de
remplacement sont reconnues par **préfixe** (`CRON_SECRET=changeme_openssl_rand_hex_24_BYTES_REQUIRED`
fait 43 caractères et se lisait comme un vrai secret ; une porte qui crie au loup
sur le placeholder documenté est une porte qu'on coupe dans la semaine).

### Ce que la revue a REFUTÉ

Un relecteur a remonté en BLOQUANT que rien ne crée `/var/log/fxmily` avec les
droits `fxmily`, ce qui ferait échouer silencieusement toute redirection de
sortie de batch. Mesuré : `ops/scripts/setup-host.sh:91-92` fait exactement ça.
Le grep qui fondait le finding portait sur six fichiers dont `setup-host.sh` était
absent — un négatif **scopé** présenté comme global. Aucune modification.
