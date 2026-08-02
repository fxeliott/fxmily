# ADR-007 — Le worker IA quitte le PC pour l'hôte de l'app (J9)

- **Status** : Proposed (2026-08-02) — à passer Accepted après la bascule réelle (7/7 en `PASS/generated` depuis le serveur + tâches PC désactivées + un cycle hebdo complet sans incident).
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

`SPEC.md:60` dit, verbatim : « human-in-the-loop (**génération jamais cronnée**,
anti-ban) ». Mais `SPEC.md:1205` décrit un « Auto (cron mensuel) », et le jalon J2
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
action que je prends seul, et le canal `health → cron-watch → issue GitHub`
existe, est gratuit, et tourne déjà toutes les heures en production. Les URLs
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
