'use client';

import dynamic from 'next/dynamic';

import type { TrainingEquityPoint } from './training-equity-card-impl';

/**
 * Lazy wrapper for the training "système tenu" curve. Recharts (~150 KB gzip)
 * loads on demand once `/training` mounts — parents import `TrainingEquityChart`
 * from this same path, the wrapper is transparent. SSR renders a fixed-height
 * skeleton (anti-CLS, same 200px as the loaded figure). Carbone the dashboard
 * `track-record-chart` lazy pattern.
 */
export function TrainingEquityChartSkeleton() {
  return (
    <div
      className="skel rounded-card h-[200px] border border-[var(--cy-edge-soft)] bg-[var(--bg-1)]"
      aria-busy="true"
      aria-live="polite"
      aria-label="Chargement de ta progression d'entraînement"
    />
  );
}

export const TrainingEquityChart = dynamic(
  () => import('./training-equity-card-impl').then((mod) => mod.TrainingEquityCardChart),
  {
    ssr: false,
    loading: () => <TrainingEquityChartSkeleton />,
  },
);

export type { TrainingEquityPoint };
