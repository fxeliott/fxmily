/**
 * Catalogue de métriques centralisé — SSOT de toutes les métriques trackées
 * (Session 1 FONDATIONS, livrable « registre unique des métriques »).
 *
 * POURQUOI. Avant ce registre, chaque métrique était re-définie ad-hoc dans son
 * module avec une forme différente (scoring=`SubScore{rate,pointsAwarded,
 * pointsMax}`, method-mirror=`MethodRule{key,label,hint,good,total,rate}`,
 * analytics=fonctions pures sans métadonnée, constancy=`breakdown{honesty,
 * regularity,discipline}`). Aucun langage commun → chaque session aval devait
 * ré-inventer le mapping métrique → axe → unité → libellé. Ce fichier fige UNE
 * source de vérité { clé, libellé FR, type, axe, unité, agrégation, statut } que
 * toutes les sessions 2 → 10 (rapports IA, dashboards, espace admin, coaching)
 * réutilisent au lieu de réinventer.
 *
 * PUR & SANS DB. Métadonnée seulement — pas de `server-only`, pas de Prisma, pas
 * de secret. Importable côté serveur ET côté client (libellés/unités d'UI). Il
 * ne CALCULE rien : les calculs restent dans `lib/scoring`, `lib/method-mirror`,
 * `lib/analytics`, `lib/verification` — ce registre les DÉCRIT.
 *
 * GARDE-FOU §2 (non négociable). CHAQUE métrique mesure un ACTE de
 * process/discipline/exécution (présence, respect d'une règle, complétude),
 * JAMAIS le contenu d'une analyse de marché (direction, niveau, setup). C'est le
 * filtre d'admission : si une métrique exigeait de connaître le QUOI-analyser,
 * elle est interdite. Le registre n'introduit aucune métrique de ce type.
 *
 * ADDITION PURE. Les sous-scores marqués `additive: true` sont des signaux
 * ajoutés après-coup, renormalisés à l'absence (byte-identiques quand le champ
 * est nul) — ils ne rééquilibrent JAMAIS les poids de base (qui somment à 100
 * par dimension). Le test `registry.test.ts` verrouille cet invariant.
 *
 * @see lib/scoring/types.ts — les 4 dimensions + sous-scores
 * @see lib/method-mirror/compute.ts — les 7 règles de fidélité à la méthode
 * @see lib/verification/constancy.ts — le score de constance (honnêteté radicale)
 * @see lib/analytics/* — les métriques de track record
 */

/** Nature de la valeur produite. */
export type MetricType =
  | 'score' // agrégat 0–100 (dimension comportementale, constance)
  | 'rate' // taux 0–100 % (sous-score, règle de méthode)
  | 'ratio' // facteur sans borne haute (profit factor)
  | 'count' // dénombrement entier (pertes consécutives)
  | 'currency' // montant (€) — réservé V2
  | 'duration' // durée (h)
  | 'correlation'; // coefficient −1…1

/** Axe métier auquel la métrique se rattache (aligné SPEC / scoring). */
export type MetricAxis =
  | 'discipline'
  | 'emotional_stability'
  | 'consistency'
  | 'engagement'
  | 'method' // fidélité aux règles dures de la méthode d'Eliott
  | 'honesty' // constance / vérité terrain MT5 (§33)
  | 'track_record'; // statistiques de performance dérivées

/** Unité d'affichage. `null` = sans unité. */
export type MetricUnit = 'pts' | '%' | 'R' | 'count' | 'ratio' | 'coefficient' | 'h' | '€';

/** Règle d'agrégation temporelle / de composition. */
export type MetricAggregation =
  | 'weighted' // somme pondérée des sous-parts (dimensions, constance)
  | 'rate' // numérateur / dénominateur sur la fenêtre
  | 'avg'
  | 'median'
  | 'sum'
  | 'last'
  | 'max'
  | 'min';

/**
 * Maturité de la métrique vis-à-vis du data-model actuel.
 * - `live` : calculée et affichée aujourd'hui.
 * - `derivable` : 100 % dérivable des champs existants sans migration (à
 *   matérialiser par une session aval).
 * - `candidate_v2` : nécessite un nouveau champ (documenté, non ajouté en S1).
 */
export type MetricStatus = 'live' | 'derivable' | 'candidate_v2';

/** Définition canonique d'une métrique trackée. */
export interface MetricDef {
  /** Clé stable, namespacée par axe (ex. `discipline.planRespect`). */
  readonly key: string;
  /** Libellé membre, en français. */
  readonly label: string;
  /** Une ligne descriptive — un ACTE de process, jamais un appel de marché. */
  readonly hint: string;
  readonly type: MetricType;
  readonly axis: MetricAxis;
  readonly unit: MetricUnit | null;
  readonly aggregation: MetricAggregation;
  readonly status: MetricStatus;
  /** Où la valeur est produite / dérivable (chemin lib). */
  readonly source: string;
  /** Pour un sous-score : la clé de la dimension parente. */
  readonly parent?: string;
  /** Poids de contribution (sous-score de scoring : /100 ; axe de constance : /1). */
  readonly weight?: number;
  /**
   * `true` = sous-score « ADDITION PURE » (renormalisé à l'absence, ne
   * rééquilibre jamais les poids de base). Voir l'en-tête.
   */
  readonly additive?: boolean;
  /**
   * `true` = §21.5 — dérivé d'un COMPTE d'activité d'entraînement uniquement,
   * jamais d'un P&L de backtest. Firewall d'isolation statistique.
   */
  readonly trainingIsolated?: boolean;
}

/**
 * LE REGISTRE. Ordre = lecture humaine (dimension puis sous-scores). Toute
 * nouvelle métrique d'une session aval s'ajoute ICI, jamais en doublon ailleurs.
 */
export const METRICS = [
  // ─── Dimensions comportementales (agrégats 0–100, scoring déterministe) ────
  {
    key: 'discipline',
    label: 'Discipline',
    hint: 'As-tu suivi ton plan et ton process (jamais : le trade a-t-il gagné) ?',
    type: 'score',
    axis: 'discipline',
    unit: 'pts',
    aggregation: 'weighted',
    status: 'live',
    source: 'lib/scoring/discipline.ts',
  },
  {
    key: 'emotional_stability',
    label: 'Stabilité émotionnelle',
    hint: 'Régulation de ton état (humeur, stress, émotions), indépendante du P&L.',
    type: 'score',
    axis: 'emotional_stability',
    unit: 'pts',
    aggregation: 'weighted',
    status: 'live',
    source: 'lib/scoring/emotional-stability.ts',
  },
  {
    key: 'consistency',
    label: 'Consistance',
    hint: "Proxys d'edge (espérance, profit factor, drawdown), la régularité, pas la chance.",
    type: 'score',
    axis: 'consistency',
    unit: 'pts',
    aggregation: 'weighted',
    status: 'live',
    source: 'lib/scoring/consistency.ts',
  },
  {
    key: 'engagement',
    label: 'Engagement',
    hint: 'Assiduité de tes rituels, check-ins, entraînement, présence et formation.',
    type: 'score',
    axis: 'engagement',
    unit: 'pts',
    aggregation: 'weighted',
    status: 'live',
    source: 'lib/scoring/engagement.ts',
  },

  // ─── Discipline — sous-scores (base 35+20+25+10+10 = 100) ──────────────────
  // prettier-ignore
  { key: 'discipline.planRespect', label: 'Plan respecté', hint: 'Trades clôturés où le plan a été respecté.', type: 'rate', axis: 'discipline', unit: '%', aggregation: 'rate', status: 'live', source: 'lib/scoring/discipline.ts', parent: 'discipline', weight: 35 },
  // prettier-ignore
  { key: 'discipline.hedgeRespect', label: 'Hedge respecté', hint: 'Trades où le hedge (système Lhedge) a été respecté ; N/A ignoré.', type: 'rate', axis: 'discipline', unit: '%', aggregation: 'rate', status: 'live', source: 'lib/scoring/discipline.ts', parent: 'discipline', weight: 20 },
  // prettier-ignore
  { key: 'discipline.eveningPlan', label: 'Plan tenu (soir)', hint: 'Check-ins du soir où le plan du jour a été tenu.', type: 'rate', axis: 'discipline', unit: '%', aggregation: 'rate', status: 'live', source: 'lib/scoring/discipline.ts', parent: 'discipline', weight: 25 },
  // prettier-ignore
  { key: 'discipline.intentionFilled', label: 'Intention posée', hint: "Matins où une intention de journée a été posée.", type: 'rate', axis: 'discipline', unit: '%', aggregation: 'rate', status: 'live', source: 'lib/scoring/discipline.ts', parent: 'discipline', weight: 10 },
  // prettier-ignore
  { key: 'discipline.routineCompleted', label: 'Routine matinale', hint: 'Matins où la routine matinale a été complétée.', type: 'rate', axis: 'discipline', unit: '%', aggregation: 'rate', status: 'live', source: 'lib/scoring/discipline.ts', parent: 'discipline', weight: 10 },
  // prettier-ignore
  { key: 'discipline.marketAnalysisDone', label: 'Analyse préparée', hint: "L'ACTE de préparer l'analyse avant la session (jamais son contenu).", type: 'rate', axis: 'discipline', unit: '%', aggregation: 'rate', status: 'live', source: 'lib/scoring/discipline.ts', parent: 'discipline', weight: 10, additive: true },
  // prettier-ignore
  { key: 'discipline.processComplete', label: 'Process complet', hint: 'Trades où tout le process a été suivi, sans rien oublier.', type: 'rate', axis: 'discipline', unit: '%', aggregation: 'rate', status: 'live', source: 'lib/scoring/discipline.ts', parent: 'discipline', weight: 10, additive: true },
  // prettier-ignore
  { key: 'discipline.intentionKept', label: 'Intention tenue', hint: "Soirs où l'intention du matin a été tenue (bouclage de la boucle).", type: 'rate', axis: 'discipline', unit: '%', aggregation: 'rate', status: 'live', source: 'lib/scoring/discipline.ts', parent: 'discipline', weight: 10, additive: true },

  // ─── Stabilité émotionnelle — sous-scores (base 40+25+20+15 = 100) ─────────
  // prettier-ignore
  { key: 'emotional_stability.moodVariance', label: "Stabilité de l'humeur", hint: 'Faible variance de ton humeur déclarée = haute stabilité.', type: 'rate', axis: 'emotional_stability', unit: '%', aggregation: 'rate', status: 'live', source: 'lib/scoring/emotional-stability.ts', parent: 'emotional_stability', weight: 40 },
  // prettier-ignore
  { key: 'emotional_stability.stressMedian', label: 'Niveau de stress', hint: 'Stress médian bas sur la fenêtre.', type: 'rate', axis: 'emotional_stability', unit: '%', aggregation: 'median', status: 'live', source: 'lib/scoring/emotional-stability.ts', parent: 'emotional_stability', weight: 25 },
  // prettier-ignore
  { key: 'emotional_stability.negativeEmotionRate', label: 'Émotions négatives', hint: 'Moins de tags émotionnels négatifs = score plus haut.', type: 'rate', axis: 'emotional_stability', unit: '%', aggregation: 'rate', status: 'live', source: 'lib/scoring/emotional-stability.ts', parent: 'emotional_stability', weight: 20 },
  // prettier-ignore
  { key: 'emotional_stability.recoveryAfterLoss', label: 'Récupération après perte', hint: 'Rebond de ton état après un jour de perte vs ta base.', type: 'rate', axis: 'emotional_stability', unit: '%', aggregation: 'rate', status: 'live', source: 'lib/scoring/emotional-stability.ts', parent: 'emotional_stability', weight: 15 },
  // prettier-ignore
  { key: 'emotional_stability.tradeEmotionFootprint', label: 'Calme en trade', hint: "Conscience/régulation de ton arc émotionnel pendant le trade.", type: 'rate', axis: 'emotional_stability', unit: '%', aggregation: 'rate', status: 'live', source: 'lib/scoring/emotional-stability.ts', parent: 'emotional_stability', weight: 15, additive: true },

  // ─── Consistance — sous-scores (base 35+25+20+10+10 = 100) ─────────────────
  // prettier-ignore
  { key: 'consistency.expectancyConsistency', label: 'Espérance (R)', hint: 'Espérance par trade en R, normalisée (1R → 33, 3R+ → 100).', type: 'rate', axis: 'consistency', unit: '%', aggregation: 'rate', status: 'live', source: 'lib/scoring/consistency.ts', parent: 'consistency', weight: 35 },
  // prettier-ignore
  { key: 'consistency.profitFactor', label: 'Profit factor', hint: 'Gains bruts / pertes brutes, normalisé (PF 1 → 0, PF 3 → 100).', type: 'rate', axis: 'consistency', unit: '%', aggregation: 'rate', status: 'live', source: 'lib/scoring/consistency.ts', parent: 'consistency', weight: 25 },
  // prettier-ignore
  { key: 'consistency.drawdownControl', label: 'Maîtrise du drawdown', hint: 'Drawdown maximal contenu (15R de DD → 0).', type: 'rate', axis: 'consistency', unit: '%', aggregation: 'rate', status: 'live', source: 'lib/scoring/consistency.ts', parent: 'consistency', weight: 20 },
  // prettier-ignore
  { key: 'consistency.lossStreakControl', label: 'Maîtrise des séries de pertes', hint: 'Série de pertes observée vs attendue statistiquement.', type: 'rate', axis: 'consistency', unit: '%', aggregation: 'rate', status: 'live', source: 'lib/scoring/consistency.ts', parent: 'consistency', weight: 10 },
  // prettier-ignore
  { key: 'consistency.sessionDispersion', label: 'Focus des sessions', hint: 'Concentration de tes trades sur tes sessions (entropie normalisée).', type: 'rate', axis: 'consistency', unit: '%', aggregation: 'rate', status: 'live', source: 'lib/scoring/consistency.ts', parent: 'consistency', weight: 10 },

  // ─── Engagement — sous-scores (base 50+20+20+10 = 100) ─────────────────────
  // prettier-ignore
  { key: 'engagement.checkinFillRate', label: 'Assiduité des check-ins', hint: 'Jours avec au moins un check-in sur la fenêtre.', type: 'rate', axis: 'engagement', unit: '%', aggregation: 'rate', status: 'live', source: 'lib/scoring/engagement.ts', parent: 'engagement', weight: 50 },
  // prettier-ignore
  { key: 'engagement.dualSlotRate', label: 'Matin + soir', hint: 'Jours où les deux créneaux (matin et soir) ont été remplis.', type: 'rate', axis: 'engagement', unit: '%', aggregation: 'rate', status: 'live', source: 'lib/scoring/engagement.ts', parent: 'engagement', weight: 20 },
  // prettier-ignore
  { key: 'engagement.streakNormalized', label: 'Régularité (streak)', hint: 'Série de jours consécutifs, plafonnée (anti-gamification toxique).', type: 'rate', axis: 'engagement', unit: '%', aggregation: 'last', status: 'live', source: 'lib/scoring/engagement.ts', parent: 'engagement', weight: 20 },
  // prettier-ignore
  { key: 'engagement.journalDepthRate', label: 'Profondeur du journal', hint: 'Soirs où une note de journal a été écrite.', type: 'rate', axis: 'engagement', unit: '%', aggregation: 'rate', status: 'live', source: 'lib/scoring/engagement.ts', parent: 'engagement', weight: 10 },
  // prettier-ignore
  { key: 'engagement.trainingActivityRate', label: "Activité d'entraînement", hint: "COMPTE d'activité de backtest (jamais un P&L de backtest, §21.5).", type: 'rate', axis: 'engagement', unit: '%', aggregation: 'rate', status: 'live', source: 'lib/scoring/engagement.ts', parent: 'engagement', weight: 15, additive: true, trainingIsolated: true },
  // prettier-ignore
  { key: 'engagement.meetingAttendanceRate', label: 'Présence aux réunions', hint: 'Réunions validées / réunions planifiées sur la fenêtre (count-only).', type: 'rate', axis: 'engagement', unit: '%', aggregation: 'rate', status: 'live', source: 'lib/scoring/engagement.ts', parent: 'engagement', weight: 15, additive: true },
  // prettier-ignore
  { key: 'engagement.sleepQualityRate', label: 'Qualité de sommeil', hint: 'Qualité subjective moyenne de sommeil (contribution positive seule).', type: 'rate', axis: 'engagement', unit: '%', aggregation: 'avg', status: 'live', source: 'lib/scoring/engagement.ts', parent: 'engagement', weight: 10, additive: true },
  // prettier-ignore
  { key: 'engagement.formationFollowedRate', label: 'Suivi de la formation', hint: "Soirs où tu déclares avoir étudié la formation (l'ACTE, jamais le contenu).", type: 'rate', axis: 'engagement', unit: '%', aggregation: 'rate', status: 'live', source: 'lib/scoring/engagement.ts', parent: 'engagement', weight: 10, additive: true },

  // ─── Fidélité à la méthode — 7 règles dures (MethodMirror, dérivé-au-render)─
  // prettier-ignore
  { key: 'method.window', label: 'Fenêtre 13h–16h', hint: "Entrées dans la fenêtre d'exécution 13h–16h Paris.", type: 'rate', axis: 'method', unit: '%', aggregation: 'rate', status: 'live', source: 'lib/method-mirror/compute.ts' },
  // prettier-ignore
  { key: 'method.oneADay', label: 'Un trade par jour', hint: 'Jours à au plus une entrée (approximation de « un risque ouvert/jour »).', type: 'rate', axis: 'method', unit: '%', aggregation: 'rate', status: 'live', source: 'lib/method-mirror/compute.ts' },
  // prettier-ignore
  { key: 'method.cut', label: 'Coupure 20h', hint: 'Trades clôturés le même jour avant 20h Paris (0 overnight).', type: 'rate', axis: 'method', unit: '%', aggregation: 'rate', status: 'live', source: 'lib/method-mirror/compute.ts' },
  // prettier-ignore
  { key: 'method.targetRR', label: 'Visée RR 3', hint: 'Trades visant un reward:risk ≥ 3.', type: 'rate', axis: 'method', unit: '%', aggregation: 'rate', status: 'live', source: 'lib/method-mirror/compute.ts' },
  // prettier-ignore
  { key: 'method.slRule', label: 'Stop selon ta règle', hint: 'Stop posé selon ta règle (M15, au-delà du dernier extrême), déclaré au close.', type: 'rate', axis: 'method', unit: '%', aggregation: 'rate', status: 'live', source: 'lib/method-mirror/compute.ts' },
  // prettier-ignore
  { key: 'method.beAtR1', label: 'Break-even à RR 1', hint: 'Passage du stop à break-even une fois à RR 1, déclaré au close.', type: 'rate', axis: 'method', unit: '%', aggregation: 'rate', status: 'live', source: 'lib/method-mirror/compute.ts' },
  // prettier-ignore
  { key: 'method.partial', label: 'Sécurisation au TP', hint: 'Clôture partielle (≈90 %) au TP, laissant courir le reliquat.', type: 'rate', axis: 'method', unit: '%', aggregation: 'rate', status: 'live', source: 'lib/method-mirror/compute.ts' },
  // Axes-méthode dérivables sans migration (à matérialiser par une session aval).
  // prettier-ignore
  { key: 'method.postLossStop', label: 'Stop après une perte', hint: 'Pas de re-trade le même jour après une perte (1 SL = stop journée).', type: 'rate', axis: 'method', unit: '%', aggregation: 'rate', status: 'derivable', source: 'dérivable de Trade.outcome+enteredAt+closedAt' },
  // prettier-ignore
  { key: 'method.disciplinedNoTrade', label: 'Jour de patience', hint: 'Analyse faite mais aucun trade pris faute de confirmations (discipline +).', type: 'rate', axis: 'method', unit: '%', aggregation: 'rate', status: 'derivable', source: 'dérivable de DailyCheckin.marketAnalysisDone ∧ 0 Trade' },
  // Candidat V2 — nécessite un champ accountType/isPropFirm (NON ajouté en S1).
  // prettier-ignore
  { key: 'method.propFirmSizing', label: 'Sizing 0,5% prop-firm', hint: 'Conformité au risque fixe 0,5% par position en compte prop-firm.', type: 'rate', axis: 'method', unit: '%', aggregation: 'rate', status: 'candidate_v2', source: 'candidat V2 — champ accountType requis' },

  // ─── Constance / honnêteté radicale (§33, reality-confronted) ──────────────
  // prettier-ignore
  { key: 'constancy.value', label: 'Score de constance', hint: 'Moyenne pondérée honnêteté/régularité/discipline, confrontée à la réalité MT5.', type: 'score', axis: 'honesty', unit: 'pts', aggregation: 'weighted', status: 'live', source: 'lib/verification/constancy.ts' },
  // prettier-ignore
  { key: 'constancy.honesty', label: 'Honnêteté', hint: 'Écart déclaré vs réalité prouvée (preuves MT5), fausses déclarations pénalisées.', type: 'rate', axis: 'honesty', unit: '%', aggregation: 'rate', status: 'live', source: 'lib/verification/constancy.ts', parent: 'constancy.value', weight: 0.4 },
  // prettier-ignore
  { key: 'constancy.regularity', label: 'Régularité de déclaration', hint: 'Déclarations faites / (faites + oubliées sans motif).', type: 'rate', axis: 'honesty', unit: '%', aggregation: 'rate', status: 'live', source: 'lib/verification/constancy.ts', parent: 'constancy.value', weight: 0.35 },
  // prettier-ignore
  { key: 'constancy.discipline', label: 'Écarts traités', hint: 'Écarts reconnus/résolus ou justifiés / total des écarts.', type: 'rate', axis: 'honesty', unit: '%', aggregation: 'rate', status: 'live', source: 'lib/verification/constancy.ts', parent: 'constancy.value', weight: 0.25 },

  // ─── Track record — statistiques de performance (dérivées au render) ───────
  // prettier-ignore
  { key: 'trackrecord.expectancyR', label: 'Espérance par trade', hint: 'R moyen attendu par trade (uniquement R calculés, jamais estimés).', type: 'score', axis: 'track_record', unit: 'R', aggregation: 'avg', status: 'live', source: 'lib/analytics/expectancy.ts' },
  // prettier-ignore
  { key: 'trackrecord.profitFactor', label: 'Profit factor', hint: 'Somme des gains R / somme des pertes R.', type: 'ratio', axis: 'track_record', unit: 'ratio', aggregation: 'rate', status: 'live', source: 'lib/analytics/expectancy.ts' },
  // prettier-ignore
  { key: 'trackrecord.winRate', label: 'Taux de réussite', hint: 'Part de trades gagnants, avec intervalle de confiance (Wilson).', type: 'rate', axis: 'track_record', unit: '%', aggregation: 'rate', status: 'live', source: 'lib/analytics/wilson.ts' },
  // prettier-ignore
  { key: 'trackrecord.maxDrawdownR', label: 'Drawdown max', hint: "Plus forte baisse de la courbe d'équité, en R.", type: 'score', axis: 'track_record', unit: 'R', aggregation: 'max', status: 'live', source: 'lib/analytics/drawdown.ts' },
  // prettier-ignore
  { key: 'trackrecord.maxConsecutiveLoss', label: 'Pertes consécutives max', hint: 'Plus longue série de pertes consécutives.', type: 'count', axis: 'track_record', unit: 'count', aggregation: 'max', status: 'live', source: 'lib/analytics/streaks.ts' },
] as const satisfies readonly MetricDef[];

/** Union des clés réelles du registre (type-safe). */
export type MetricKey = (typeof METRICS)[number]['key'];

const ALL: readonly MetricDef[] = METRICS;
const BY_KEY: ReadonlyMap<string, MetricDef> = new Map(ALL.map((m) => [m.key, m]));

/** Récupère une métrique par sa clé (ou `undefined` si inconnue). */
export function getMetric(key: string): MetricDef | undefined {
  return BY_KEY.get(key);
}

/** Toutes les métriques d'un axe, dans l'ordre du registre. */
export function metricsByAxis(axis: MetricAxis): readonly MetricDef[] {
  return ALL.filter((m) => m.axis === axis);
}

/** Les sous-scores d'une dimension/score parent. */
export function childMetrics(parentKey: string): readonly MetricDef[] {
  return ALL.filter((m) => m.parent === parentKey);
}

/** Toutes les clés du registre. */
export const METRIC_KEYS: readonly string[] = ALL.map((m) => m.key);

/** Le registre complet (lecture seule), pour itération exhaustive. */
export const ALL_METRICS: readonly MetricDef[] = ALL;
