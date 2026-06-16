/**
 * Logique PURE des objectifs « Où je vais » (jalon J4) — extraite de `service.ts`
 * pour être testable sans `server-only` ni accès DB. Aucune dépendance runtime :
 * uniquement des maths déterministes (paliers, régression linéaire, fan chart).
 * `service.ts` compose ces fonctions avec les lectures DB.
 */

/** Palier « Maîtrise » — aligné sur la bande `acc/Excellent` de `ScoreGauge`
 *  (score >= 85). C'est la cible de chaque dimension : une destination de
 *  process atteignable, jamais un objectif de gain. */
export const MASTERY_TARGET = 85;

/** Nombre minimum de points d'historique pour OSER projeter une trajectoire.
 *  En dessous, on ne dessine pas de projection (anti-fabrication). */
export const MIN_HISTORY_FOR_PROJECTION = 6;

/** Horizon de projection maximal (semaines) — on ne projette jamais au-delà,
 *  même si la pente est très faible (honnêteté : une extrapolation lointaine
 *  n'a pas de sens comportemental). */
export const MAX_PROJECTION_WEEKS = 12;

export type ObjectiveDimension = 'discipline' | 'emotionalStability' | 'consistency' | 'engagement';

export interface ProcessObjective {
  key: ObjectiveDimension;
  /** Libellé court (« Discipline »). */
  label: string;
  /** Sous-titre des leviers (« Plan + hedge + routine »). */
  hint: string;
  /** Score actuel 0–100, ou `null` si données insuffisantes. */
  current: number | null;
  /** Cible de process (= MASTERY_TARGET). */
  target: number;
  /** Points restants jusqu'à la cible (>= 0), ou `null` si `current` est null. */
  gap: number | null;
  /** `true` quand la cible est atteinte (current >= target). */
  reached: boolean;
}

export interface CapTier {
  key: 'discovery' | 'regularity' | 'consistency' | 'mastery';
  label: string;
}

export interface JourneyStage {
  id: CapTier['key'];
  label: string;
  caption: string;
  /** Seuil de cap composite pour « atteindre » cette étape. */
  threshold: number;
  /** `true` quand le cap actuel a franchi ce seuil. */
  reached: boolean;
  /** `true` pour l'étape courante (la plus haute atteinte). */
  current: boolean;
}

export interface TrajectoryHistoryPoint {
  /** `YYYY-MM-DD`. */
  date: string;
  value: number;
}

export interface TrajectoryProjectedPoint {
  /** `YYYY-MM-DD`. */
  date: string;
  /** Valeur projetée (ligne centrale), clampée [0, 100]. */
  value: number;
  /** Borne basse de la bande de prédiction (s'élargit dans le temps). */
  lo: number;
  /** Borne haute de la bande de prédiction. */
  hi: number;
}

export interface TrajectoryProjection {
  /** Historique réel du score discipline (points non-null uniquement). */
  history: TrajectoryHistoryPoint[];
  /** Bande prospective vers la cible (vide si non estimable honnêtement). */
  projected: TrajectoryProjectedPoint[];
  target: number;
  /** « ≈ 5 semaines à ce rythme », « Objectif déjà atteint », ou `null`
   *  (trajectoire stable / pas assez de recul). */
  etaLabel: string | null;
  /** `true` quand l'historique est trop court pour projeter. */
  insufficient: boolean;
  /** Direction qualitative et CALME de la pente (jamais alarmiste). */
  trend: 'up' | 'flat' | 'down';
}

export const DIMENSION_META: ReadonlyArray<{
  key: ObjectiveDimension;
  label: string;
  hint: string;
}> = [
  { key: 'discipline', label: 'Discipline', hint: 'Plan + hedge + routine' },
  { key: 'emotionalStability', label: 'Stabilité', hint: 'Variance + stress + tilt' },
  { key: 'consistency', label: 'Cohérence', hint: 'Expectancy + DD + sessions' },
  { key: 'engagement', label: 'Engagement', hint: 'Fill rate + streak + journal' },
];

/** 4 paliers de parcours, du cap composite le plus bas au plus haut. Les seuils
 *  reprennent les bornes des bandes de `ScoreGauge` (50 / 70 / 85). */
export const JOURNEY_STAGES: ReadonlyArray<Omit<JourneyStage, 'reached' | 'current'>> = [
  {
    id: 'discovery',
    label: 'Découverte',
    caption: 'Tu poses tes premières routines.',
    threshold: 0,
  },
  {
    id: 'regularity',
    label: 'Régularité',
    caption: 'Tu reviens chaque jour. Le réflexe s’installe.',
    threshold: 50,
  },
  {
    id: 'consistency',
    label: 'Constance',
    caption: 'Ton process tient sous pression.',
    threshold: 70,
  },
  {
    id: 'mastery',
    label: 'Maîtrise',
    caption: 'La discipline est devenue ta norme.',
    threshold: MASTERY_TARGET,
  },
];

export function tierForCap(cap: number | null): CapTier {
  if (cap === null || cap < 50) return { key: 'discovery', label: 'Découverte' };
  if (cap < 70) return { key: 'regularity', label: 'Régularité' };
  if (cap < MASTERY_TARGET) return { key: 'consistency', label: 'Constance' };
  return { key: 'mastery', label: 'Maîtrise' };
}

/** Décalage en jours entre deux dates civiles `YYYY-MM-DD` (parse UTC, anti-drift TZ). */
export function dayOffset(fromIso: string, toIso: string): number {
  const [fy, fm, fd] = fromIso.split('-').map(Number);
  const [ty, tm, td] = toIso.split('-').map(Number);
  const a = Date.UTC(fy!, fm! - 1, fd!);
  const b = Date.UTC(ty!, tm! - 1, td!);
  return Math.round((b - a) / 86_400_000);
}

/** Ajoute `days` à une date civile `YYYY-MM-DD` et reformate en `YYYY-MM-DD`. */
export function addDaysIso(iso: string, days: number): string {
  const [y, mo, d] = iso.split('-').map(Number);
  const t = Date.UTC(y!, mo! - 1, d!) + days * 86_400_000;
  return new Date(t).toISOString().slice(0, 10);
}

/**
 * Projection HONNÊTE de la trajectoire discipline (fan chart).
 *
 * Régression linéaire moindres carrés sur (jours écoulés → score), puis bande de
 * prédiction qui s'ÉLARGIT avec l'horizon (issue de l'écart-type résiduel) — on
 * ne dessine jamais une ligne sèche qui surpromet. Si la pente est nulle/négative,
 * l'historique trop court, ou la droite déjà au-delà de la cible au dernier point,
 * on s'abstient de projeter (`projected: []`).
 */
export function projectTrajectory(
  history: TrajectoryHistoryPoint[],
  target: number,
): TrajectoryProjection {
  if (history.length < MIN_HISTORY_FOR_PROJECTION) {
    return {
      history,
      projected: [],
      target,
      etaLabel: null,
      insufficient: true,
      trend: 'flat',
    };
  }

  const first = history[0]!.date;
  const xs = history.map((p) => dayOffset(first, p.date));
  const ys = history.map((p) => p.value);
  const n = xs.length;
  const meanX = xs.reduce((s, x) => s + x, 0) / n;
  const meanY = ys.reduce((s, y) => s + y, 0) / n;

  let sxx = 0;
  let sxy = 0;
  for (let i = 0; i < n; i++) {
    const dx = xs[i]! - meanX;
    sxx += dx * dx;
    sxy += dx * (ys[i]! - meanY);
  }
  const slope = sxx === 0 ? 0 : sxy / sxx;
  const intercept = meanY - slope * meanX;

  // Écart-type résiduel (dispersion autour de la droite) → demi-largeur de bande.
  // n >= MIN_HISTORY_FOR_PROJECTION (>= 6) garanti par le garde du haut → n-2 >= 4.
  let sse = 0;
  for (let i = 0; i < n; i++) {
    const pred = intercept + slope * xs[i]!;
    sse += (ys[i]! - pred) ** 2;
  }
  const residualStd = Math.sqrt(sse / (n - 2));

  const lastX = xs[n - 1]!;
  const lastIso = history[n - 1]!.date;
  const lastValue = ys[n - 1]!;

  // Tendance qualitative calme : ~+0.07 pt/j sur 7 j ≈ +0.5 pt/sem = seuil "up".
  const weeklySlope = slope * 7;
  const trend: TrajectoryProjection['trend'] =
    weeklySlope >= 0.5 ? 'up' : weeklySlope <= -0.5 ? 'down' : 'flat';

  // Déjà au palier : on ne projette pas une montée, on célèbre l'état.
  if (lastValue >= target) {
    return {
      history,
      projected: [],
      target,
      etaLabel: 'Objectif déjà atteint',
      insufficient: false,
      trend,
    };
  }

  // Pente plate/négative : pas d'ETA honnête. On affiche la trajectoire telle
  // quelle, sans extrapoler une fausse montée.
  if (slope <= 0) {
    return { history, projected: [], target, etaLabel: null, insufficient: false, trend };
  }

  const daysToTarget = (target - intercept) / slope - lastX;
  // Garde honnête : si la droite a déjà dépassé la cible au dernier point réel
  // (tendance globale > cible mais derniers points redescendus sous 85), un ETA
  // chiffré sur-promettrait. On s'abstient (§2 : une tendance, pas une promesse).
  if (daysToTarget <= 0) {
    return { history, projected: [], target, etaLabel: null, insufficient: false, trend };
  }
  const weeksToTarget = Math.max(1, Math.ceil(daysToTarget / 7));
  const horizonWeeks = Math.min(weeksToTarget, MAX_PROJECTION_WEEKS);

  const projected: TrajectoryProjectedPoint[] = [];
  for (let w = 1; w <= horizonWeeks; w++) {
    const x = lastX + w * 7;
    const center = Math.max(0, Math.min(100, intercept + slope * x));
    // Bande qui s'élargit : ~1 résidu-std au 1er pas, croît en racine du temps.
    const half = residualStd * (0.8 + 0.5 * Math.sqrt(w));
    projected.push({
      date: addDaysIso(lastIso, w * 7),
      value: Math.round(center * 10) / 10,
      lo: Math.max(0, Math.round((center - half) * 10) / 10),
      hi: Math.min(100, Math.round((center + half) * 10) / 10),
    });
  }

  const etaLabel =
    weeksToTarget > MAX_PROJECTION_WEEKS
      ? 'Au-delà de 12 semaines à ce rythme'
      : `≈ ${weeksToTarget} semaine${weeksToTarget > 1 ? 's' : ''} à ce rythme`;

  return { history, projected, target, etaLabel, insufficient: false, trend };
}
