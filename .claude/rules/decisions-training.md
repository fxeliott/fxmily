---
paths:
  - 'apps/web/src/app/training/**'
  - 'apps/web/src/components/training/**'
  - 'apps/web/src/lib/training/**'
  - 'apps/web/src/lib/training-debrief/**'
---

# Decisions verrouillees — training

Extrait de `apps/web/CLAUDE.md` le 2026-08-04. Ces decisions sont OPPOSABLES :
ce sont des landmines anti-regression, pas de l historique. Le frontmatter
`paths:` ci-dessus les charge uniquement quand on touche les fichiers concernes
— sans lui, elles seraient chargees a chaque lancement et la scission
n economiserait rien. Contexte complet du jalon : `docs/web/jalons-history.md`.

## V1.2 J-T1 — Mode Entraînement / Backtest data layer (livré 2026-05-17)

### Décisions clés (landmines — NE PAS re-casser)

- **§21.5 ISOLATION STATISTIQUE = invariant BLOQUANT, structurellement prouvé** : 0 FK vers `trades`, 0 enum partagé, 0 import cross real↔training. Tout cross-ref futur = breach.
- **`enteredAt` = `DateTime` (`@map("entered_at")`), PAS `@db.Date`** — mirror `Trade.enteredAt` (INSTANT, pas calendar day) → **délibérément AUCUNE H1 civil-window** (le pattern `isHabitDateWithinLocalWindow` s'applique uniquement aux `@db.Date` HabitLog/DailyCheckin).
- **`getTrainingTradeById` = `findFirst({id,userId})`** (V1.9 TIER B, single SQL, member-scoped) ; **`getTrainingAnnotationById` = `findUnique` unscoped** (admin-only mirror `getAnnotationById`, asymétrie CORRECTE).
- **`entryScreenshotKey` colonne nullable** (admin-repair escape-hatch) mais Zod schema REQUIRE — NE PAS tighten la colonne à NOT NULL (casserait la réparation admin).

## V1.2 J-T2 — Mode Entraînement member surface (livré 2026-05-17)

### Décisions clés (landmines)

- **Training pages check `status==='active'`** (canon track/review V2.0/V1.8) — NE PAS « re-aligner J-T2 à journal » (legacy `!session?.user`-only = latent weakness, security-auditor T2-1 vérifié).
- **`resolveUploadAuditAction` existe ON PURPOSE** comme guard unit-testé pour le slug §21.5 (la route upload n'a pas de test propre ; collapse silencieux de la map = regression-exposé). NE PAS re-inline dans le ternaire route.
- **`.t-eyebrow` (10px) sur card/stats CORRECT** (DS forbid harmonization — `globals.css:441-446` documenté). NE PAS « fix » en `.t-eyebrow-lg`.
- **R:R hero = `<Card primary>`** (canon fidelity `trade-form-wizard.tsx:747`). NE PAS revert neutral.
- Wizard utilise `m.*` (LazyMotion ancestor app-shell-provided), JAMAIS `motion.*` (V1.9 strict).

## V1.2 J-T3 — Mode Entraînement admin corrections + notification (livré 2026-05-17)

### Décisions clés (landmines)

- **§21.5 ISOLATION TRIPLE-PROUVÉE** (grep indé + security-auditor + code-reviewer convergent) : 0 FK Trade, distinct slugs/storage-prefix/deep-link/revalidate, audit metadata PII-free test-asserted.
- **MediaUploader keystone** : `trainingTradeId` ≠ `tradeId` (champs FormData distincts). NE JAMAIS fusionner — un training value ne doit JAMAIS voyager via le champ real-edge `tradeId`.
- **Member detail page : AUCUN audit row** (réutiliser le slug J4 `member.annotations.viewed` polluerait le signal §21.5 ; `seenByMemberAt` sur la row est la trace durable « seen »). Divergence J4 délibérée.
- **Cyan `--cy` training identity** sur 6 surfaces vs lime `--acc` journal — la non-confusabilité §21.5/Mark-Douglas, contraste AA ~9–11:1. Le Sheet admin garde lime J4 (contexte admin, jamais membre-confusable). NE PAS « harmoniser ».
- **Admin action ne fire PAS d'email immédiat** (J4 le fait). `enqueueTrainingAnnotationNotification` (push + email fallback wired) couvre §21.4. Direct email = hors §21.

## V1.2 J-T4 — Engagement wiring + §21.5 anti-leak (SPEC §21 COMPLET 4/4) (livré 2026-05-17)

### Décisions verrouillées (NE PAS re-casser / NE JAMAIS rééquilibrer)

- **Engagement = ADDITION PURE, AUCUN rééquilibrage des poids existants.** Les 4 poids 50/20/20/10 sont **inchangés** ; `WEIGHT_TRAINING=15` ajouté EN PLUS (`TRAINING_ACTIVITY_TARGET=8`). `trainingActivityRate=null` quand count=0 → `aggregateDimension` skip et normalise sur `pointsMax` actif → score **byte-identique** pré-J-T4 pour un membre sans backtest. Σpoids=100 n'est PAS contrainte de correctness. **Le blueprint architecte proposait WEIGHT_FILL 50→42 = VRAIE RÉGRESSION** prouvée (membre fill=0.5 → 75 avant / 77 après) → REJETÉ.
- **3 touchpoints §21.5 sanctionnés** : `scoring/service.ts` + `triggers/engine.ts` + `weekly-report/loader.ts`. Chacun importe **UNIQUEMENT** `countRecentTrainingActivity` et RIEN d'autre. Tout autre module real-edge important training = breach.
- **Trigger = carbone exact `evalNoCheckinStreak`** : `daysBetweenLocal(...)` — PAS de date-fns `differenceInDays` (halluciné par le blueprint, n'existe pas dans le trigger module). Branche "jamais" = `daysSince:accountAgeDays` (miroir fidèle, NE PAS « fixer » en `0`).
- **Weekly report = volume-count SEULEMENT** (`trainingSessionsCount`). La récence passe par le trigger (inactivité→alerte), PAS par le rapport.
- **Firewall anti-leak = GLOB de répertoires** (auto-couvre tout futur fichier real-edge), `readSrcCode` strip les commentaires AVANT grep (commentaires défensifs `// 🚨 §21.5 never db.trainingTrade` voulus). NE PAS re-naïviser en string-contains brut.
- **Fiche seed `quote` = paraphrase honnête** explicitement marquée `quoteSourceChapter:"paraphrase de l'argument — Mark Douglas, Trading in the Zone, ch.11"` (PAS un verbatim fabriqué). 25 mots ≤30, posture §2 « le moteur ne juge jamais tes analyses ».

## V1.3 — Débrief Training dédié (SPEC §23) (livré 2026-05-18)

### Décisions clés (landmines)

- **§21.5 par construction** : `TrainingDebriefStatTrade` (input agrégateur) **omet structurellement** `resultR`/`outcome`/`plannedRR`. La Server Action ne revalide PAS `/dashboard` (≠ REFLECT carbone) — recréerait le couplage. NE JAMAIS ajouter ce revalidate.
- **§23.7 / PR#96 carry-over** : `weekStart` dérivé serveur via `currentParisWeekStart()` (`localDateOf` + `parseLocalDate` + math-lundi Europe/Paris). Le wizard NE calcule PAS weekStart côté client (le `lastMondayUTC` UTC-naïf de REFLECT **délibérément non porté**, JSDoc explicite).
- **§21.7 cyan strict** : composants debrief = clone propre, JAMAIS `.v18-*`/`--v18-*`. `V18_SPRING`/`V18_SPRING_TIGHT` importés = constantes timing app-wide (pas un token thème — canon V1.9). `crisis-banner` garde `bad`/`warn` universels (sévérité doit lire pareil partout) ; seul CTA `tel:` est cyan.
- **Calm reveal anti Black-Hat STRICT** : 0 XP/streak/badge/fanfare/confetti ; `notRespected = C.warn` ambre JAMAIS `C.bad` rouge ; empty-week = panneau pédagogique « 0 backtest… le geste prime », JAMAIS score-0 ; done-reveal calme « Reviens dimanche prochain ».
- **Recharts couleurs hex `C.*`** (jamais `var()` — bug WebView iOS J6.6).
- **prefill vs draft same-week = draft-wins V1** (UX autosave + parité carbone REFLECT). PAS de bannière « ton brouillon a écrasé » V1 (scope creep).
