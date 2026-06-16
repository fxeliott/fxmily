'use client';

import dynamic from 'next/dynamic';

/**
 * Lazy wrapper de la projection de trajectoire (jalon J4). Recharts se charge à
 * la demande ; le SSR rend un skeleton de MÊME hauteur (anti-CLS). Carbone
 * `score-trend-chart.tsx`.
 */
export function TrajectoryChartSkeleton() {
  return (
    <div
      className="skel rounded-card-lg h-[316px] border border-[var(--b-default)] bg-[var(--bg-1)]"
      aria-busy="true"
      aria-live="polite"
      aria-label="Chargement de ta trajectoire"
    />
  );
}

export const TrajectoryChart = dynamic(
  () => import('./trajectory-chart-impl').then((m) => m.TrajectoryChart),
  {
    ssr: false,
    loading: () => <TrajectoryChartSkeleton />,
  },
);
