'use client';

import dynamic from 'next/dynamic';

import { HabitCorrelationScatterSkeleton } from './habit-correlation-scatter-skeleton';

/**
 * Lazy wrapper for HabitCorrelationScatter. Splits Recharts (ScatterChart)
 * out of /track + /dashboard correlation card bundles. SSR renders the
 * skeleton (anti-CLS) — parent `<HabitCorrelationCard>` provides card chrome.
 */
export const HabitCorrelationScatter = dynamic(
  () => import('./habit-correlation-scatter-impl').then((m) => m.HabitCorrelationScatter),
  {
    ssr: false,
    loading: () => <HabitCorrelationScatterSkeleton />,
  },
);

// Re-export the public type for parent components that consume it.
// `import type` is erased at compile time, so this does NOT pull the
// Recharts impl into the parent's bundle.
export type { ScatterPoint } from './habit-correlation-scatter-impl';
