# ÉTAT — module pédagogie

> Journal d'avancement des dix phases. Une phase ne passe à `FAIT` qu'avec une commande de preuve
> datée sur sa propre ligne. Constitution, bornes et porte de sortie :
> `C:\Users\eliot\Documents\prompts-fxmily-academy-v2\REGLES-PARTAGEES.md`.
> Registre des questions ouvertes : `a-verifier.md`. Périmètre : `DECISIONS/0001-perimetre.md`.

États autorisés : `À FAIRE` · `EN COURS` · `FAIT` · `BLOQUÉ`.

| Phase | Titre                          | État     | Date       | Livrables mesurés                     | Preuve (commande)                                         |
| ----- | ------------------------------ | -------- | ---------- | ------------------------------------- | --------------------------------------------------------- |
| 00    | Fondation & constitution       | EN COURS | 2026-08-14 | 5 fichiers — compteur brut ci-dessous | `wc -l docs/pedagogie/*.md docs/pedagogie/DECISIONS/*.md` |
| 01    | Ancrage Fxmily et parcours     | À FAIRE  | —          | —                                     | —                                                         |
| 02    | Ingestion pédagogie            | À FAIRE  | —          | —                                     | —                                                         |
| 03    | Conception apprentissage       | À FAIRE  | —          | —                                     | —                                                         |
| 04    | Modèle de données et migration | À FAIRE  | —          | —                                     | —                                                         |
| 05    | Interface et composants        | À FAIRE  | —          | —                                     | —                                                         |
| 06    | Build parcours et cours        | À FAIRE  | —          | —                                     | —                                                         |
| 07    | Build évaluation et indexation | À FAIRE  | —          | —                                     | —                                                         |
| 08    | Absorption de l'app vidéo      | À FAIRE  | —          | —                                     | —                                                         |
| 09    | Vérification et production     | À FAIRE  | —          | —                                     | —                                                         |

Les titres des phases 01 à 09 sont relevés des noms de fichiers présents dans le dossier de prompts
le 2026-08-14. Les dix fichiers existent : aucune phase ne porte `titre à confirmer`.

## Compteur mesuré — phase 00, le 2026-08-14

Sortie brute de `wc -l docs/pedagogie/*.md docs/pedagogie/DECISIONS/*.md`, collée telle quelle :

```
   62 docs/pedagogie/ETAT.md
   82 docs/pedagogie/VISION.md
   40 docs/pedagogie/a-verifier.md
  113 docs/pedagogie/DECISIONS/0001-perimetre.md
  297 total
```

Borne de la phase : chaque livrable sous `docs/pedagogie/` tient en 120 lignes au maximum.

## Baseline de non-régression, relevée avant toute écriture

Prise le 2026-08-14, depuis `D:\Fxmily`, sur la branche `feat/pedagogie-00-fondation` créée depuis
le sommet de `feat/leaderboard-classement` (commit `9dc36a88`) :

| Mesure                            | Commande                          | Valeur relevée                                                     |
| --------------------------------- | --------------------------------- | ------------------------------------------------------------------ |
| Arbre de travail                  | `git status --porcelain \| wc -l` | `95` fichiers modifiés, tous antérieurs à ce chantier              |
| Compilation TypeScript            | `pnpm type-check; echo $?`        | `0` — cache Turbo `7ad4b7a1088d4c08`                               |
| Compilation réelle, sans cache    | `tsc --noEmit; echo $?`           | `0`, aucune ligne d'erreur                                         |
| Empreinte de `CLAUDE.md` (racine) | `sha256sum CLAUDE.md`             | `08248bc8121d0f3640478f9ad80feec0090a3f248bc538f290399555ad3f0d77` |
| Empreinte de `apps/web/CLAUDE.md` | `sha256sum apps/web/CLAUDE.md`    | `3774d46055bd17ebcbb3f736dcc2888de3ce23a49bcaa2a57963eb657fab5d35` |

`apps/web/CLAUDE.md` était **déjà modifié avant l'arrivée de cette phase** : il fait partie des 95.
Ce n'est ni le problème ni l'alibi de la phase ; l'empreinte ci-dessus est la référence contre
laquelle on prouve qu'elle n'y a pas touché.

## Ce que la phase 00 n'a pas fait, et qui ne doit pas être supposé

Aucun membre n'est servi. Aucune surface d'interface, aucun modèle de données, aucun contenu de
cours. Les deux cases de la porte de sortie qui portent sur le membre — « consommateur réel côté
membre » et « preuve navigateur en 1280 et 375 » — se cochent `N/A`, avec cette raison : la phase 00
ne livre aucune surface membre. Elles ne se cochent jamais vertes.
