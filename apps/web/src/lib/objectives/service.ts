import 'server-only';

import { getStreak } from '@/lib/checkin/service';
import { STREAK_MILESTONES } from '@/lib/checkin/streak';
import { getDailyGuidance, type GuidanceAction } from '@/lib/daily-guidance/service';
import { getBehavioralScoreHistory, getLatestBehavioralScore } from '@/lib/scoring/service';

import {
  DIMENSION_META,
  JOURNEY_STAGES,
  MASTERY_TARGET,
  projectTrajectory,
  tierForCap,
  type CapTier,
  type JourneyStage,
  type ObjectiveDimension,
  type ProcessObjective,
  type TrajectoryHistoryPoint,
} from './projection';

/**
 * « Où je vais » — vue de lecture pure des objectifs de PROCESS (jalon J4).
 *
 * Aucune nouvelle table : la destination du membre est DÉRIVÉE des signaux de
 * discipline que l'app calcule déjà (4 scores comportementaux + streak +
 * guidage du jour). Les "objectifs" sont des cibles de process fixes et douces
 * (atteindre le palier « Maîtrise » sur chaque dimension) — jamais une cible de
 * P&L (posture §2). Tout est en lecture, user-scopé, sans IA ni rapport admin.
 *
 * Composition : `getLatestBehavioralScore` (cap du jour) + `getBehavioralScoreHistory`
 * (trajectoire) + `getStreak` (régularité) + `getDailyGuidance` (prochaine action).
 * La logique PURE (paliers, projection, maths) vit dans `./projection` (testée
 * en isolation, sans server-only ni DB).
 */

// Re-export de la surface pure pour les composants (qui importent ces types
// depuis `@/lib/objectives/service`).
export {
  MASTERY_TARGET,
  type CapTier,
  type JourneyStage,
  type ObjectiveDimension,
  type ProcessObjective,
  type TrajectoryHistoryPoint,
  type TrajectoryProjectedPoint,
  type TrajectoryProjection,
} from './projection';

export interface ProcessObjectivesView {
  /** `false` quand le membre n'a pas encore de snapshot (état d'accueil). */
  hasScores: boolean;
  /** Cap composite du jour (moyenne des dimensions calculées), ou `null`. */
  cap: number | null;
  capTier: CapTier;
  /** Les 4 anneaux d'objectifs (ordre stable = ordre des dimensions). */
  objectives: ProcessObjective[];
  /** Dimension la plus faible (le levier prioritaire), ou `null`. */
  focus: ProcessObjective | null;
  trajectory: ReturnType<typeof projectTrajectory>;
  streak: { current: number; todayFilled: boolean; nextMilestone: number | null };
  journey: JourneyStage[];
  /** Actions concrètes (todo-first) issues du guidage du jour. */
  nextActions: GuidanceAction[];
}

export async function getProcessObjectives(
  userId: string,
  timezone: string,
): Promise<ProcessObjectivesView> {
  const [latestScore, scoreHistory, streak, guidance] = await Promise.all([
    getLatestBehavioralScore(userId),
    getBehavioralScoreHistory(userId, { sinceDays: 90 }),
    getStreak(userId, timezone),
    getDailyGuidance(userId, timezone),
  ]);

  const dimValue = (key: ObjectiveDimension): number | null => {
    if (latestScore === null) return null;
    switch (key) {
      case 'discipline':
        return latestScore.disciplineScore;
      case 'emotionalStability':
        return latestScore.emotionalStabilityScore;
      case 'consistency':
        return latestScore.consistencyScore;
      case 'engagement':
        return latestScore.engagementScore;
    }
  };

  const objectives: ProcessObjective[] = DIMENSION_META.map((meta) => {
    const current = dimValue(meta.key);
    const reached = current !== null && current >= MASTERY_TARGET;
    return {
      key: meta.key,
      label: meta.label,
      hint: meta.hint,
      current,
      target: MASTERY_TARGET,
      gap: current === null ? null : Math.max(0, MASTERY_TARGET - current),
      reached,
    };
  });

  // Cap composite = moyenne des dimensions RÉELLEMENT calculées (jamais un 0
  // fabriqué pour une dimension `null`).
  const computed = objectives.map((o) => o.current).filter((v): v is number => v !== null);
  const cap =
    computed.length > 0 ? Math.round(computed.reduce((s, v) => s + v, 0) / computed.length) : null;
  const capTier = tierForCap(cap);

  // Levier prioritaire = la dimension calculée la plus basse encore sous la cible.
  const focus =
    objectives
      .filter((o) => o.current !== null && !o.reached)
      .sort((a, b) => (a.current ?? 100) - (b.current ?? 100))[0] ?? null;

  // Trajectoire = historique discipline (points non-null) + projection honnête.
  const disciplineHistory: TrajectoryHistoryPoint[] = scoreHistory
    .filter((p) => p.discipline !== null)
    .map((p) => ({ date: p.date, value: p.discipline as number }));
  const trajectory = projectTrajectory(disciplineHistory, MASTERY_TARGET);

  const nextMilestone = STREAK_MILESTONES.find((m) => m > streak.current) ?? null;

  const journey: JourneyStage[] = JOURNEY_STAGES.map((stage) => ({
    ...stage,
    reached: cap !== null && cap >= stage.threshold,
    current: false,
  })).map((stage, idx, all) => {
    // L'étape courante = la plus haute atteinte (la dernière `reached`).
    const lastReachedIdx = all.reduce((acc, s, i) => (s.reached ? i : acc), 0);
    return { ...stage, current: idx === lastReachedIdx };
  });

  // Prochaines actions : todo d'abord, puis info ; on en garde 4 max, ordre du
  // guidage déjà trié "most-now-first".
  const nextActions = [...guidance.actions]
    .sort((a, b) => stateRank(a.state) - stateRank(b.state))
    .slice(0, 4);

  return {
    hasScores: latestScore !== null,
    cap,
    capTier,
    objectives,
    focus,
    trajectory,
    streak: { current: streak.current, todayFilled: streak.todayFilled, nextMilestone },
    journey,
    nextActions,
  };
}

function stateRank(state: GuidanceAction['state']): number {
  return state === 'todo' ? 0 : state === 'info' ? 1 : 2;
}
