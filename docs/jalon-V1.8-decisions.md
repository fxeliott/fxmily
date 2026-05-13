# V1.8 REFLECT — Décisions tranchées en autonomie (2026-05-13)

> Décisions actées par Claude Code en autonomie max (sur instruction explicite Eliot : "réfléchis prend du recul analyse et agis"). Source post-V1.7.2 follow-up session.
> **Source brief complet** : [`docs/jalon-V1.8-prep.md`](./jalon-V1.8-prep.md) (731 lignes, mergé PR #56 commit `f555810`).
> **Override** : Eliot peut revoir n'importe quelle décision en R1 de la session V1.8 en disant simplement "change Q3 vers B" ou similaire. Ce document n'est pas un verrou, c'est un défaut acté.

## TL;DR — 8 décisions actées

| #   | Décision                                            | Choix                                                              |
| --- | --------------------------------------------------- | ------------------------------------------------------------------ |
| Q1  | Push reminder dimanche 18h pour rappel review hebdo | **B Non V1.8**                                                     |
| Q2  | Streak counter sur `ReflectionEntry`                | **B Non**                                                          |
| Q3  | `Trade.tags` self-assigned par membre OU admin-only | **A Member self-assign**                                           |
| Q4  | Crisis routing dup sur `WeeklyReview` free-text     | **A Oui (duplicate batch.ts pattern)**                             |
| Q5  | Ajouter `fomo` + `tilt` informels OU LESSOR-only    | **A LESSOR-only 8 tags**                                           |
| M4  | Métaphore Fxmily                                    | **C "Le miroir de ton exécution"**                                 |
| M5  | Rituel quotidien central                            | **A morning check-in + extension D evening WeeklyReview dimanche** |
| M6  | Wow moment                                          | **A Rapport hebdo IA dimanche (LIVE V1.7.2)**                      |

## Décisions V1.8 techniques (Q1 → Q5)

### Q1 — Push reminder dimanche 18h ?

**Décision : B Non V1.8**

**Rationale** :

- Anti-spam V1 (anti-pattern Yu-kai Chou : push notifications gratuites = perception "appli intrusive")
- V1.7.1 wires AI banner + crisis routing déjà actifs côté push, ne pas surcharger
- Attendre signal cohorte (taux d'usage spontané de `/review`) avant de pousser
- Cohérent SPEC §18.2 ("éviter les triggers compulsifs")

**Décision opérationnelle V1.8** : `NotificationType` enum NON étendu avec `weekly_review_reminder`. PR #56-#61 V1.8 build sequence ne touche pas au push.

**Trigger V1.9 réévaluation** : si taux d'usage `/review` < 30% sur 4 semaines avec cohorte > 10 membres actifs.

### Q2 — Streak counter ReflectionEntry ?

**Décision : B Non**

**Rationale** :

- Anti-gamification toxique (Yu-kai Chou Octalysis Black-Hat) : la réflexion ne doit PAS devenir un jeu à streak
- Cohérent posture Mark Douglas (process > outcome) : pas de pression performance sur l'introspection
- V1 streak counter sur `DailyCheckin` est déjà LIVE — V1.8 reflection est un canal différent, intentionnellement détendu
- Risque trader spécifique : streak shame post-perte = renforce négative spiral émotionnel

**Décision opérationnelle V1.8** : `ReflectionEntry` n'a pas de compteur streak visible UI. Dashboard montre le timeline mais pas "X jours consécutifs".

### Q3 — `Trade.tags` self-assigned member OR admin-only ?

**Décision : A Member self-assign**

**Rationale** :

- Cohérence avec `emotionAfter` (déjà self-assigned au close wizard V1.5)
- Posture member-ownership (cf. Mark Douglas "responsabilité de l'exécution = trader")
- Admin-only créerait un workflow asymétrique inconfortable (Eliot devrait tagger 30+ membres × N trades/semaine)
- Self-assignment au close wizard = moment optimal post-outcome pour reflection ("ai-je revenge-tradé ?")

**Décision opérationnelle V1.8** : `<TradeTagsPicker>` step nouveau dans `/journal/[id]/close` wizard, post-emotionAfter, pré-soumission. Max 3 tags par trade (Zod array length).

**Admin override** : `/admin/members/[id]/trades/[tradeId]` peut éditer les tags si besoin (correctif), mais c'est le canal exceptionnel pas le canal principal.

### Q4 — Crisis routing dup sur `WeeklyReview` ?

**Décision : A Oui (duplicate batch.ts pattern)**

**Rationale** :

- Member-facing free-text = context **encore plus sensible** que sortie IA admin
- `submitWeeklyReviewAction` doit invoquer `detectCrisis(corpus)` AVANT `db.weeklyReview.create()`
- Audit pattern identique `batch.ts:411-441` V1.7.1 (audit `weekly_review.crisis_detected` PII-free + Sentry escalate HIGH/MEDIUM)
- Defense-in-depth alignement EU AI Act 50(1) + safety duty member

**Décision opérationnelle V1.8** : 5 textareas WeeklyReview (`biggestWin` + `biggestMistake` + `bestPractice` + `lessonLearned` + `nextWeekFocus`) concatenés → `detectCrisis()`. Si level >= MEDIUM :

- Persist QUAND MÊME (UX cassée sinon — différent du batch.ts où on skip)
- Audit row `weekly_review.crisis_detected` (level + matchedLabels)
- Sentry escalate parallèle (HIGH→`reportError`, MEDIUM→`reportWarning`)
- Member voit un banner UI in-app avec ressources externes (3114 + SOS Amitié)

**Trading slang exclusion** : reuse de `lib/safety/crisis-detection.ts` V1.7.1 (déjà testé 28 cas TDD avec exclusions "perdu gros sur ce trade", "killer ce setup", etc.).

### Q5 — `fomo` + `tilt` informels OR LESSOR-only ?

**Décision : A LESSOR-only 8 tags**

**Rationale** :

- Rigueur académique V1.8 = consistance avec scoring 4-dim CFA-aligned déjà LIVE
- "FOMO" / "tilt" populaires mais **non validés CFA** : risque de pseudo-scientifique
- Eviter dérive Yu-kai Chou "fake gamification slang"
- Trigger V1.9 réévaluation : si > 5 membres demandent FOMO explicit en feedback, ajouter slug `fomo` avec annotation `informal: true` dans Zod

**Décision opérationnelle V1.8** : `TRADE_TAG_SLUGS` const = exactement 8 slugs (`loss-aversion`, `overconfidence`, `regret-aversion`, `status-quo`, `self-control-fail`, `endowment`, `discipline-high`, `revenge-trade`). Pas de catégorie `informal`.

## Décisions vision produit (M4 / M5 / M6)

### M4 — La métaphore Fxmily

**Décision : C "Le miroir de ton exécution"**

**Rationale** :

- Cohérent posture Mark Douglas (introspection, process > outcome, ZÉRO conseil)
- Couvre les 3 canaux V1 LIVE : journal de trade (miroir des décisions) + check-ins (miroir des états) + reflection V1.8 (miroir du process)
- Option B "coach process" rejetée : trop directif, viole "Fxmily n'impose pas un style coach"
- Option D "scoring data" rejetée : trop dashboard, ignore le côté qualitative reflection V1.8
- Option A "carnet passif" rejetée : ignore le scoring + AI reports actifs

**Décision opérationnelle V1.8** : utiliser cette métaphore dans :

- Splash hero `/` (V1.9 polish, pas V1.8 — pas de touch UI splash V1.8)
- Email digest weekly subject : "Ton miroir de la semaine"
- Banner `/review` landing : "Le miroir de ton exécution"
- Onboarding welcome email V1.9 (non scope V1.8)

### M5 — LE rituel quotidien central

**Décision : A morning check-in (LIVE V1) + extension D evening recap via WeeklyReview wizard dimanche (V1.8)**

**Rationale** :

- Morning check-in déjà LIVE V1, validé empiriquement, pas de friction nouvelle
- WeeklyReview dimanche complète le rituel sans surcharger (1 fois par semaine, pas quotidien)
- Pre-trade modal (B) rejeté : trop intrusif "before each session"
- Post-trade reflection (C) rejeté : 30s × 5-10 trades/jour = 5min cumulés = friction quotidienne élevée

**Décision opérationnelle V1.8** :

- Morning check-in : intact
- `/review` accessible 7j/7 mais wizard targeté "Dimanche, fais ton bilan"
- Pas de timer / countdown / streak pressure
- Friction max acceptable : 5 min wizard 5 étapes (texte libre)

### M6 — LE wow moment

**Décision : A Rapport hebdo IA dimanche (LIVE V1.7.2)**

**Rationale** :

- LIVE prod V1.7.2, validé empiriquement aujourd'hui (HTTP 200 + 7780 bytes envelope)
- Feature techniquement la plus impressionnante shippée (claude --print orchestré, batch HTTP, crisis routing wire)
- B (pattern detection auto) : déjà présent dans le rapport IA, redondant comme "wow" séparé
- C (score discipline) : LIVE V1, mais moins viral émotionnellement que le rapport personnalisé
- D (fiche Mark Douglas au bon moment) : LIVE V1, valable mais moins "wow" qu'une analyse complète
- E (debrief 1-1) : V2.0 DEBRIEF, hors scope V1.8

**Décision opérationnelle V1.8+ valorisation** :

- V1.8 : ne pas toucher le digest (LIVE stable)
- V1.9 : améliorer email digest UI (banner "voici TON miroir de la semaine" + meilleure mise en forme)
- V1.9 : améliorer `/admin/reports/[id]` UI premium (carte miroir + sections actionables)

## Override Eliot — comment changer une décision

Ces décisions ne sont pas verrouillées. En R1 de la session V1.8 (post-`/clear`), Eliot peut dire :

```
"Change Q3 vers B" → Trade.tags admin-only au lieu de member self-assign
"Override M4 = B" → métaphore "coach process en arrière-plan" au lieu de "miroir"
"Reset toutes les décisions, on refait" → repart de zéro avec questions individuelles
```

L'override est gratuit (pas de re-design d'architecture nécessaire, ces décisions impactent surtout copy UI + 1-2 lignes Zod / NotificationType enum).

## Posture verrouillée (NON-NÉGOCIABLE)

- **Mark Douglas** : ZÉRO conseil de trade dans tous les livrables V1.8 (déjà audité fxmily-content-checker sur brief V1.8 = 🟢 ship-ready 701 lignes)
- **Anti-anthropomorphisation IA** : "Claude pense" / "L'IA analyse votre comportement" INTERDITS (V1.7.1 enforcement)
- **CBT honnêteté clinique** : disclaimer "inspired by Ellis ABC, adapted for trading — not clinically validated for trader population" obligatoire dans `/reflect/new` wizard
- **EU AI Act** : N/A V1.8 (pas de génération IA member-side)
- **RGPD §16** : audit log counts-only PII-free + safeFreeText 100% free-text

## Crédit décision autonome

Décisions prises 2026-05-13 par Claude Code en autonomie max sur instruction explicite Eliot. Méthodologie :

- Lecture exhaustive brief V1.8 (`docs/jalon-V1.8-prep.md`) + master V2 `FXMILY-V2-MASTER.md` §27 + memory CHECKPOINT_FINAL_R3
- Synthèse 5 subagents Round 1 + 2 deep subagents Round 2 (researcher + security-auditor)
- Verify context7 Prisma + WebSearch Steenbarger 2024-2026 + CFA LESSOR 2026
- Posture Mark Douglas verrouillée toute la chaîne décisionnelle
- Calibrated refusal sur les options trop spéculatives (Q5 informal slugs defer V1.9)

## Référence

- Brief V1.8 complet : [`docs/jalon-V1.8-prep.md`](./jalon-V1.8-prep.md) (731 lignes, PR #56 → main `f555810`)
- Master V2 : [`docs/FXMILY-V2-MASTER.md`](./FXMILY-V2-MASTER.md) §27 (3 manques M1-M10 bloquants)
- V1.7-prep : [`docs/jalon-V1.7-prep.md`](./jalon-V1.7-prep.md) (9 items hierarchisés, 4 Must-V1.8)
- SPEC §15 J0-J10 done, §18.4 1 session = 1 jalon, §20 v1.1 changelog

## Next action recommandée

```
1. /clear (workflow Claude Code utilisateur, obligatoire SPEC §18.4)
2. Nouvelle session V1.8 REFLECT avec pickup verbatim copy-paste depuis docs/jalon-V1.8-prep.md §10
3. R1 session V1.8 : invoke fxmily-jalon-tracker subagent + valider/override ces décisions
4. R2+ : build sequence 6 PRs atomic (V1.8 implem ~11h)
```
