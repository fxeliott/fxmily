> ⚠️ **ARCHIVED 2026-05-15** — superseded by [`docs/FXMILY-V2-MASTER.md`](../FXMILY-V2-MASTER.md) (source unique vérité V2).
>
> Ce document a été conservé tel quel pour traçabilité historique. Les 5 piliers + 5 paradoxes + 10 phrases-test + dualité ennemi/allié documentés ici sont **absorbés** dans le master V2 §2 (Vision/North Star) + §7 (anti-patterns hard rules). Pour toute nouvelle décision feature V2.x, lire le master, pas ce fichier.

---

# Manifesto Fxmily V2 — l'ADN du produit

> **Source** : interview Eliot 2026-05-11 (round 8 reconstruction)
> **Statut** : Document d'âme produit. À lire AVANT toute décision feature.
> **Lien** : complète `SPEC-V2-VISION.md` (qui est le quoi) en définissant le **pourquoi** et **l'esprit**.

---

## Les 5 piliers (test feature = sert-elle un pilier ?)

### P1. La formation est la maison. Fxmily est l'outil sur le mur.

Fxmily n'est pas la formation. Fxmily est l'outil qui rend la formation **mesurable et accompagnée individuellement**. Sans la formation, Fxmily ne sert à rien. Sans Fxmily, la formation reste générique.

### P2. Fxmily mesure ce que le membre FAIT, pas ce qu'il SAIT.

Aucun cours dans Fxmily. Aucun signal. Aucune stratégie. Que de l'observation : exécution, routines, psychologie, contexte de vie qui impacte le trading. La data est la matière première du coaching.

### P3. Le membre vit Fxmily comme un rituel quotidien plaisant qui le pousse à devenir meilleur.

Pas une corvée. Un **compagnon discret** qui donne (a) sens de routine, (b) sens de direction, (c) envie de se pousser, (d) introspection guidée. Le membre doit AIMER ouvrir l'app.

### P4. Eliot devient un coach augmenté qui connaît chaque membre individuellement.

Avec Fxmily : Eliot a une vue 360° pseudonymisée de chacun, anticipe les drift, débrief avec data. **L'IA enrichit, ne remplace pas, le coaching humain.**

### P5. La North Star n'est pas la rentabilité du membre, c'est sa discipline.

Promettre la rentabilité = trading-marketing scam. Promettre l'amélioration mesurable de la discipline = honnête + faisable + pré-requis nécessaire à la performance durable. Fxmily mesure ce que le membre CONTRÔLE (son comportement), pas ce qu'il ne contrôle pas (le marché).

---

## Les 5 paradoxes résolus

| Paradoxe                                        | Résolution                                                                                       |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| Maximum data ↔ Plaisant à faire                 | **Data passive d'abord** (HealthKit, broker import). Saisie active seulement pour introspection. |
| Système ultra-autonome ↔ Membre doit se pousser | **L'app SUGGÈRE, le membre DÉCIDE.** Aucune feature coercitive.                                  |
| Eliot mieux accompagner ↔ App accompagne auto   | **Fxmily est l'OUTIL d'Eliot, pas son remplaçant.** IA prépare, Eliot conduit.                   |
| Posture éducative ↔ Accompagnement ultra-poussé | Conseiller sur **PROCESS** (respect plan, gestion émotion), jamais sur **DÉCISION TRADING**.     |
| Système le plus avancé ↔ Plaisant à utiliser    | **Modules progressifs débloqués** selon engagement. Day 1 = simple. Day 90 = complet.            |

---

## Les 10 phrases-test (avant toute feature, répondre OUI à au moins 3)

1. Cette feature sert-elle la **North Star score discipline +X% sur 12 semaines** ?
2. Cette feature est-elle **plaisante** pour le membre (pas une corvée) ?
3. Cette feature **POUSSE** le membre (sans le forcer) ?
4. Cette feature donne-t-elle à **Eliot** plus de matière de coaching ?
5. Cette feature respecte-t-elle la **posture éducative** (zéro conseil trade) ?
6. Cette feature peut-elle être **scientifiquement défendue** (peer-reviewed si possible) ?
7. Cette feature est-elle **mesurable** dans le temps (pas vanity metric) ?
8. Cette feature **mesure** ce que le membre CONTRÔLE (process), pas ce qu'il ne contrôle pas (marché) ?
9. Cette feature évite-t-elle les **Black Hat gamification patterns** (FOMO, streak shame, overjustification) ?
10. Cette feature **ferait-elle hocher la tête à Mark Douglas + Brett Steenbarger + Lo/Repin** s'ils la voyaient ?

**3+ oui** = feature valide. **<3 oui** = on ne fait pas.

---

## L'ennemi (ce que Fxmily n'est PAS, jamais)

- ❌ **Pas une formation** (la formation existe par ailleurs)
- ❌ **Pas un service de signaux**
- ❌ **Pas un Discord/Telegram VIP**
- ❌ **Pas une prop firm**
- ❌ **Pas un programme d'affiliation**
- ❌ **Pas un broker journal** type Edgewonk/TradeZella (ils sont génériques solo trader)
- ❌ **Pas une promesse de rentabilité**
- ❌ **Pas un système coercitif** (FOMO, streak shame, dark patterns)
- ❌ **Pas un système qui remplace Eliot**

---

## L'allié (ce que Fxmily EST, toujours)

- ✅ **L'outil propriétaire** de la formation Fxmily d'Eliot
- ✅ **Un système de tracking comportemental** strict (exécution + psychologie + routines + contexte)
- ✅ **Un compagnon quotidien discret** pour le membre
- ✅ **Un super-pouvoir admin** pour Eliot (coach augmenté)
- ✅ **Un système White Hat** (mastery, autonomy, meaning)
- ✅ **Un produit conforme RGPD / AMF** (par design, pas après-coup)
- ✅ **Un produit scientifiquement ancré** (Douglas + Steenbarger + Lo/Repin + Rupprecht + Grable & Lytton)

---

## Décisions d'âme à arbitrer (les 10 manques structurels)

> Voir `SPEC-V2-VISION.md` §11 + section dédiée ci-dessous. Ces décisions ne peuvent PAS être déléguées à Claude.

| #   | Décision                                                        | Statut           |
| --- | --------------------------------------------------------------- | ---------------- |
| M1  | Baseline formation actuelle (MRR, completion, rétention, churn) | ⏳ Attente Eliot |
| M2  | Définition de "meilleure formation possible"                    | ⏳ Attente Eliot |
| M3  | Profil membre idéal Fxmily                                      | ⏳ Attente Eliot |
| M4  | Métaphore produit Fxmily                                        | ⏳ Attente Eliot |
| M5  | LE rituel quotidien central                                     | ⏳ Attente Eliot |
| M6  | LE wow moment                                                   | ⏳ Attente Eliot |
| M7  | Autres outils de la formation (écosystème)                      | ⏳ Attente Eliot |
| M8  | Promesse temporelle au membre à 12 semaines                     | ⏳ Attente Eliot |
| M9  | Rituel quotidien d'Eliot dans Fxmily                            | ⏳ Attente Eliot |
| M10 | Courbe émotionnelle du membre Day 1/7/30/90                     | ⏳ Attente Eliot |

**Sans ces réponses, le SPEC-V2-VISION.md est complet mais générique. Avec ces réponses, on peut faire un Fxmily SPÉCIFIQUEMENT pour ta formation et ton public.**

---

## Comment utiliser ce manifeste

1. **Avant tout choix de feature** : passer la feature par les 10 phrases-test.
2. **Avant tout sprint** : relire les 5 piliers + 5 paradoxes.
3. **En cas de doute sur le scope** : revenir aux décisions d'âme M1-M10.
4. **En cas de drift** (l'app commence à ressembler à Edgewonk ou Discord VIP) : revenir à "l'ennemi".

Ce manifeste est l'OS produit de Fxmily. Le SPEC est le code applicatif.
