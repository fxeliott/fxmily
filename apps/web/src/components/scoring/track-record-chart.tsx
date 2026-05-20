'use client';

import dynamic from 'next/dynamic';

import { TrackRecordChartSkeleton } from './track-record-chart-skeleton';

/**
 * Lazy wrapper for TrackRecordChart. Recharts (~150 KB gzip) ships as a
 * separate chunk loaded on demand once /dashboard mounts. Parents keep
 * importing `TrackRecordChart` from this same path — wrapper is transparent.
 *
 * SSR renders the skeleton (same h-[260px] dims, anti-CLS).
 */
export const TrackRecordChart = dynamic(
  () => import('./track-record-chart-impl').then((m) => m.TrackRecordChart),
  {
    ssr: false,
    loading: () => <TrackRecordChartSkeleton />,
  },
);
