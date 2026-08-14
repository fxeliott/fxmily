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

**Le fichier `C:\Users\eliot\Documents\transcript final\transcript vidéo analyse fondamental et autres (connaissance).txt`**
— 203 119 octets, mesuré le 2026-08-14 par `ls -la`. Ce n'est **pas** le contenu d'Eliot : ce sont
des scripts d'un tiers, destinés au projet Ichor. **Exclu de toute source pédagogique, tranché par
Eliot.** Il n'est ni lu, ni copié, ni cité, ni résumé par une phase de cette suite. Le publier sous
le nom d'Eliot serait une faute, pas une approximation.

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
retapé de mémoire. Trois cardinaux mesurés le même jour par les commandes de `REGLES-PARTAGEES.md
§8 ter` : 7 contenus portent un identifiant de lecteur, 5 satellites sont annoncés, 1 seul module de
premier niveau est annoncé non tourné.

| n   | slug                       | titre                           | statut lu      | source écrite                           |
| --- | -------------------------- | ------------------------------- | -------------- | --------------------------------------- |
| 01  | `parametrage-tradingview`  | Paramétrage TradingView         | disponible     | présente                                |
| 02  | `prop-firms`               | Les Prop Firms                  | disponible     | présente, plus 2 pages externes         |
| 03  | `comprehension-marche`     | Compréhension du marché         | disponible     | présente                                |
| 04  | `analyse-technique`        | Analyse technique               | disponible     | présente, plus 2 réunions d'application |
| 05  | `gestion-trades-risque`    | Gestion des trades & du risque  | disponible     | présente                                |
| 06  | `education-independance`   | Éducation et indépendance       | **disponible** | **manquante**                           |
| 07  | `sites-importants-trading` | Les sites importants en trading | **non tourné** | sans objet                              |

Trois précisions qui ont déjà coûté cher et qui ne se devinent pas :

- **Le module 06 est lisible, pas « à venir ».** Sa vidéo est publiée et dure 804 secondes, lu dans
  `videos.ts`. Ce qui lui manque, c'est sa transcription — Eliot la fournira. Le classer « à venir »
  livrerait un module publié sans cours. Entrée `AV-013` du registre.
- **Le module 07 n'est pas tourné.** C'est le seul dans ce cas. Il reçoit une fiche d'état, sans
  aucun contenu pédagogique et sans lien mort.
- **Les deux réunions de backtest sont l'application du module 04, pas des modules.** Elles peuvent
  porter une citation sourcée ; elles ne définissent jamais seules une notion.

### 3. Ce qui existe déjà et ne se reconstruit pas

Cinq briques sont déjà en production dans le dépôt et toute phase qui en recommencerait une est une
phase à arrêter. La liste, son état mesuré et sa conséquence vivent en un seul endroit :
`REGLES-PARTAGEES.md §0`. Elle n'est pas recopiée ici.

## Alternatives considered + Why rejected

- **Reprendre le dépôt v1 et le brancher par une authentification déléguée** — rejeté par Eliot :
  la pédagogie doit lire le profil du membre, ses scores et son historique, qui existent déjà dans
  cette base. Un second système obligerait à dupliquer le membre.
- **Traiter la source tierce comme un corpus d'appoint** — rejeté : elle n'est pas d'Eliot. La
  question n'est pas sa qualité, c'est sa paternité.
- **Repousser le module 06 faute de transcription** — rejeté : sa vidéo est publiée. Un membre le
  verrait disponible et sans cours.

## Consequences

### Pros

- La frontière est écrite avant la première ligne de code, et elle est mesurée, pas déclarée.
- Aucune phase ne peut « redécouvrir » qu'un sujet appartenait à une autre.
- L'exclusion de la source tierce est nominative : elle ne peut plus rentrer par inadvertance.

### Cons / Risks

- Le module 06 restera sans cours complet tant que sa transcription manque : suivi en `AV-013`.
- Le nom exact du fichier exclu est écrit ici, une seule fois, parce que l'exclusion doit être
  nominative — un contrôle de la constitution attend pourtant zéro occurrence de cette chaîne dans
  ce répertoire. Le conflit est nommé, pas contourné : entrée `AV-014`.

## Honesty disclaimers

- Les trois cardinaux du corpus vidéo sont **remesurés** dans cette session, pas recopiés d'un
  document : ils ont déjà été comptés faux par trois lecteurs successifs.
- Le poids « environ 80 % pour l'analyse technique » est une heuristique d'Eliot, étiquetée `CADRE`.
  Elle n'est pas sourcée et ne doit jamais être servie comme un fait.
- Aucune phase de cette suite ne tranche une contradiction du corpus. Les neuf sont au registre.

## 0001 audit trail

- **2026-08-14** — Accepted (phase 00, fondation). Périmètre arrêté, registre amorcé.

## Related ADRs

- `docs/decisions/ADR-001` à `ADR-005` — décisions produit de l'app hôte, dont ce document
  reprend la forme sans reprendre la numérotation.
