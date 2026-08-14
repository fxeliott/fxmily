# 0001 — Périmètre du module pédagogie

- **Status** : Accepted (2026-08-14) — périmètre arrêté à l'entrée de la phase 00, avant tout code.
- **Date** : 2026-08-14
- **Author** : Eliot Pena (Fxmily) — décisions de périmètre ; rédaction phase 00
- **Scope** : module pédagogie v2, phases 00 à 09
- **Supersedes** : N/A — la v1 (dépôt séparé) est abandonnée, pas amendée
- **Related** : `C:\Users\eliot\Documents\prompts-fxmily-academy-v2\REGLES-PARTAGEES.md` (constitution) · `docs/pedagogie/VISION.md` · `docs/pedagogie/a-verifier.md`

## Context

Le module pédagogique est construit **dans** l'app Fxmily, sur la même base de données. Une v1
avait été tentée dans un dépôt séparé : elle est morte sans servir un seul membre. Avant d'écrire
une ligne, il faut donc figer par écrit ce qui entre et ce qui n'entre pas — c'est la seule chose
que la v1 n'a jamais eue.

Ce document ne tranche aucune question de contenu. Il trace une frontière.

## Decision

### 1. Hors périmètre, nominativement

**La source tierce `transcript vidéo analyse fondamental et autres (connaissance).txt`**,
**203 119 octets** — identifiée par son nom et sa taille, jamais par un chemin figé : elle a déjà
été déplacée une fois. Commande de contrôle en `## Evidence base`. Ce n'est **pas** le contenu
d'Eliot : ce sont des scripts d'un tiers, destinés au projet Ichor. **Exclu de toute source
pédagogique, tranché par Eliot.** Ni lu, ni copié, ni cité, ni résumé par une phase de cette suite.
Le publier sous le nom d'Eliot serait une faute, pas une approximation. Eliot a confirmé cette
exclusion par un geste, le 2026-08-14 : il a isolé le fichier dans un sous-répertoire dont le nom
dit lui-même qu'il ne relève pas de sa méthode et ne sert que de base de connaissance.

Sont également hors périmètre, et pour la même raison — ils existent déjà ou ils ont été refusés :

- **Un second dépôt.** Le module vit dans `D:\Fxmily`, nulle part ailleurs.
- **Une authentification déléguée entre deux sites.** L'app a déjà la sienne.
- **Un design system neuf.** On étend celui du dépôt, on ne le refait pas.
- **Une décision d'architecture de pile.** La pile est tranchée ; en réécrire une est un livrable à supprimer.
- **Une seconde chaîne d'intégration continue.** On se branche sur celle qui existe.
- **Tout écran d'administration.** Tranché par Eliot le 2026-08-13 : le contenu vit en fichiers
  versionnés et se modifie par fichier et commit. Aucune phase n'en construira, et le sujet ne se
  renvoie plus à « une phase ultérieure » — il n'y en aura pas.

### 2. Dans le périmètre : les sept modules

Ordre relevé **par lecture** de `D:\Projects\fxmily-videos\src\lib\videos.ts` le 2026-08-14, jamais
retapé de mémoire. Cardinaux et correspondance des sources re-mesurés le même jour : commandes en
`## Evidence base`.

| n   | slug                       | titre                           | statut lu      | source écrite                           |
| --- | -------------------------- | ------------------------------- | -------------- | --------------------------------------- |
| 01  | `parametrage-tradingview`  | Paramétrage TradingView         | disponible     | présente                                |
| 02  | `prop-firms`               | Les Prop Firms                  | disponible     | présente, plus 2 pages externes         |
| 03  | `comprehension-marche`     | Compréhension du marché         | disponible     | présente                                |
| 04  | `analyse-technique`        | Analyse technique               | disponible     | présente, plus 2 réunions d'application |
| 05  | `gestion-trades-risque`    | Gestion des trades & du risque  | disponible     | présente                                |
| 06  | `education-independance`   | Éducation et indépendance       | disponible     | **présente depuis le 2026-08-14**       |
| 07  | `sites-importants-trading` | Les sites importants en trading | **non tourné** | sans objet                              |

Trois précisions qui ont déjà coûté cher et qui ne se devinent pas :

- **Le module 06 est lisible ET sourcé.** Sa vidéo est publiée et dure 804 secondes. Sa
  transcription a été déposée par Eliot le 2026-08-14 à 12h30 : `éducation trading indépendance
vision.txt`, 16 983 octets. **Aucune phase ne doit plus le traiter comme « sans source ».**
  Son cours est dû dès la phase de rédaction, au même titre que les cinq premiers.
- **Le module 07 n'est pas tourné.** C'est le seul dans ce cas. Il reçoit une fiche d'état, sans
  aucun contenu pédagogique et sans lien mort.
- **Les deux réunions de backtest sont l'application du module 04, pas des modules.** Elles peuvent
  porter une citation sourcée ; elles ne définissent jamais seules une notion.

### 3. Ce qui existe déjà et ne se reconstruit pas

Cinq briques sont déjà en production dans le dépôt et toute phase qui en recommencerait une est une
phase à arrêter. La liste, son état mesuré et sa conséquence vivent en un seul endroit :
`REGLES-PARTAGEES.md §0`. Elle n'est pas recopiée ici.

## Evidence base

Chaque affirmation chiffrée ci-dessus porte sa commande. Elles se rejouent, elles ne se recopient pas.

| Ce qui est mesuré                 | Commande                                                                                                 | Valeur du 2026-08-14               |
| --------------------------------- | -------------------------------------------------------------------------------------------------------- | ---------------------------------- |
| La source tierce, où qu'elle soit | `find "/c/Users/eliot/Documents/transcript final" -type f -printf '%s\t%p\n' \| awk -F'\t' '$1==203119'` | 1 fichier, dans un sous-répertoire |
| Sources écrites disponibles       | `ls -1 "/c/Users/eliot/Documents/transcript final/"*.txt \| wc -l`                                       | 8 fichiers à la racine             |
| Contenus lisibles du parcours     | `grep -c "^[[:space:]]*vimeoId: '" src/lib/videos.ts`                                                    | 7                                  |
| Satellites annoncés               | `grep -c "^        kind: 'coming'," src/lib/videos.ts`                                                   | 5                                  |
| Modules non tournés               | `grep -c "^    status: 'coming-soon'," src/lib/videos.ts`                                                | 1, le module 07                    |

## Alternatives considered + Why rejected

- **Reprendre le dépôt v1 derrière une authentification déléguée** — rejeté par Eliot : la
  pédagogie doit lire le profil, les scores et l'historique du membre, déjà présents dans cette base.
- **Traiter la source tierce comme un corpus d'appoint** — rejeté : la question n'est pas sa
  qualité, c'est sa paternité.
- **Identifier l'exclusion par son chemin absolu** — rejeté après l'avoir essayé le jour même : le
  chemin a cessé d'être vrai en une heure. Un nom et une taille survivent à un déplacement.

## Consequences

- **Pros** — la frontière est écrite avant la première ligne de code et elle est mesurée, pas
  déclarée ; aucune phase ne peut « redécouvrir » qu'un sujet appartenait à une autre ; l'exclusion
  tient à une propriété stable, pas à un emplacement.
- **Cons** — deux motifs de la constitution attendent zéro occurrence de littéraux que ce document
  et `VISION.md` sont pourtant tenus d'écrire : conflit nommé en `AV-014`, jamais contourné. Et le
  parcours reste incomplet tant que le 07 n'est pas tourné — un état, pas un défaut.

## Honesty disclaimers

- **La première version de ce document affirmait que le module 06 n'avait pas de source.** C'était
  faux quand elle a été écrite : le fichier avait été déposé deux minutes plus tôt. La cause n'est
  pas l'inattention, c'est d'avoir repris l'affirmation d'un prompt au lieu de mesurer le disque.
  `REGLES §9.4` le dit : le réel fait foi, le document est ce qui a tort.
- Les cardinaux sont **remesurés** ici, pas recopiés : ils ont déjà été comptés faux trois fois.
- « Environ 80 % pour l'analyse technique » est une heuristique d'Eliot, étiquetée `CADRE`.
- Aucune phase ne tranche une contradiction du corpus : les neuf sont au registre. Ce document reprend la forme des ADR de `docs/decisions/`, sans reprendre leur numérotation.

## 0001 audit trail

- **2026-08-14** — Accepted (phase 00). Périmètre arrêté, registre amorcé.
- **2026-08-14, amendé après relecture en contexte frais** — module 06 corrigé de « sans source » à
  « sourcé » ; exclusion ré-identifiée par nom et taille ; `Evidence base` ajoutée.
