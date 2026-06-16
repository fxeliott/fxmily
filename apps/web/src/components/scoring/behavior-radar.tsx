'use client';

import dynamic from 'next/dynamic';

/**
 * Lazy wrapper du radar comportemental (jalon 2). Recharts se charge à la
 * demande ; le SSR rend un skeleton de MÊME hauteur (anti-CLS). Carbone
 * `trajectory-chart.tsx`.
 */
export function BehaviorRadarSkeleton() {
  return (
    <div
      className="skel rounded-card-lg h-[300px] border border-[var(--b-default)] bg-[var(--bg-1)]"
      aria-busy="true"
      aria-live="polite"
      aria-label="Chargement de ton profil comportemental"
    />
  );
}

export const BehaviorRadar = dynamic(
  () => import('./behavior-radar-impl').then((m) => m.BehaviorRadar),
  {
    ssr: false,
    loading: () => <BehaviorRadarSkeleton />,
  },
);
