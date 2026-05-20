'use client';

import dynamic from 'next/dynamic';

import { RDistributionSkeleton } from './r-distribution-skeleton';

/**
 * Lazy wrapper for RDistribution. Splits Recharts out of /dashboard's
 * main bundle — loaded on demand. SSR renders the skeleton (anti-CLS).
 */
export const RDistribution = dynamic(
  () => import('./r-distribution-impl').then((m) => m.RDistribution),
  {
    ssr: false,
    loading: () => <RDistributionSkeleton />,
  },
);
