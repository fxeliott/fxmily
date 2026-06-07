'use client';

import dynamic from 'next/dynamic';

/**
 * Lazy wrapper for the behavioral-score trend chart (Session 3 §28). Recharts
 * loads on demand once /dashboard mounts; SSR renders the skeleton (same
 * ~272px height as the loaded card, anti-CLS). Carbone `track-record-chart`.
 */
export function ScoreTrendChartSkeleton() {
  return (
    <div
      className="skel rounded-card-lg h-[272px] border border-[var(--b-default)] bg-[var(--bg-1)]"
      aria-busy="true"
      aria-live="polite"
      aria-label="Chargement de l'évolution de tes scores"
    />
  );
}

export const ScoreTrendChart = dynamic(
  () => import('./score-trend-chart-impl').then((m) => m.ScoreTrendChart),
  {
    ssr: false,
    loading: () => <ScoreTrendChartSkeleton />,
  },
);
