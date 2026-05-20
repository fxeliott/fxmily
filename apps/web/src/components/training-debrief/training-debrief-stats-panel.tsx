'use client';

import dynamic from 'next/dynamic';

import { TrainingDebriefStatsPanelSkeleton } from './training-debrief-stats-panel-skeleton';

/**
 * Lazy wrapper for TrainingDebriefStatsPanel. Splits Recharts (BarChart +
 * stacked BarChart) out of /training/debrief/new + admin member training
 * debrief panel bundles. SSR renders the skeleton (anti-CLS).
 */
export const TrainingDebriefStatsPanel = dynamic(
  () => import('./training-debrief-stats-panel-impl').then((m) => m.TrainingDebriefStatsPanel),
  {
    ssr: false,
    loading: () => <TrainingDebriefStatsPanelSkeleton />,
  },
);
