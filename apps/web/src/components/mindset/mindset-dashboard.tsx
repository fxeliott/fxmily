'use client';

import dynamic from 'next/dynamic';

import { MindsetDashboardSkeleton } from './mindset-dashboard-skeleton';

/**
 * Lazy wrapper for MindsetDashboard. Splits Recharts (RadarChart +
 * LineCharts) out of /mindset + admin member detail page bundles.
 * SSR renders the skeleton (anti-CLS).
 */
export const MindsetDashboard = dynamic(
  () => import('./mindset-dashboard-impl').then((m) => m.MindsetDashboard),
  {
    ssr: false,
    loading: () => <MindsetDashboardSkeleton />,
  },
);
