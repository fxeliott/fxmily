import type { PillarKey } from '@/lib/leaderboard/insights';
import type { LeaderboardParts } from '@/lib/leaderboard/types';

/**
 * Shared presentation metadata for the four leaderboard pillars — the single
 * source of truth for the breakdown panel (`RankBreakdown`) AND the personalized
 * "push this lever" motivation line (`MyRankCard` / dashboard widget).
 *
 * `push` is the ACTIONABLE, calm phrase shown when this pillar is the member's
 * weakest lever: what they concretely DO to grow it (never a reproach — SPEC §2
 * / §31.2, motivating not shaming). Keeping it here means the label and its
 * push copy can never drift apart.
 */

export interface PillarMeta {
  key: PillarKey;
  label: string;
  hint: string;
  /** Non-text accent (bar fill / dot) along the neutral data-viz spectrum. */
  accent: string;
  /** Calm, actionable "how to grow this lever" line for the weakest pillar. */
  push: string;
}

export const PILLARS: readonly PillarMeta[] = [
  {
    key: 'assiduity',
    label: 'Assiduité',
    hint: 'Ta présence et tes connexions au quotidien',
    accent: 'var(--dv-1)',
    push: 'reviens poser un check-in chaque jour, même court.',
  },
  {
    key: 'discipline',
    label: 'Discipline',
    hint: 'Le respect de ton plan et de ton process',
    accent: 'var(--dv-2)',
    push: 'suis ton plan et coche ton process sur chaque trade.',
  },
  {
    key: 'regularity',
    label: 'Régularité',
    hint: 'Ton rythme tenu dans la durée, absences justifiées comprises',
    accent: 'var(--dv-3)',
    push: 'tiens ton rythme sur la durée, même les jours calmes.',
  },
  {
    key: 'work',
    label: 'Travail de suivi',
    hint: 'La profondeur de ton suivi personnel',
    accent: 'var(--acc-hi)',
    push: 'complète ton suivi (notes, émotions, contexte) après tes séances.',
  },
] as const;

/** Type guard the compiler enforces: every `LeaderboardParts` key has meta. */
export const PILLAR_META_BY_KEY: Record<keyof LeaderboardParts, PillarMeta> = {
  assiduity: PILLARS[0]!,
  discipline: PILLARS[1]!,
  regularity: PILLARS[2]!,
  work: PILLARS[3]!,
};
