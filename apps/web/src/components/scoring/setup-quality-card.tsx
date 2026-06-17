'use client';

import dynamic from 'next/dynamic';

/**
 * Lazy wrapper for SetupQualityCard — splits Recharts out of the /patterns
 * main bundle (loaded on demand). SSR renders a calm skeleton (anti-CLS),
 * mirroring the r-distribution / track-record chart canon.
 */
export const SetupQualityCard = dynamic(
  () => import('./setup-quality-card-impl').then((mod) => mod.SetupQualityCard),
  {
    ssr: false,
    loading: () => (
      <div className="flex flex-col gap-3" aria-busy="true" aria-live="polite">
        <div className="skel rounded-card-lg h-[240px] border border-[var(--b-default)] bg-[var(--bg-1)]" />
        <div className="skel rounded-card-lg h-[120px] border border-[var(--b-default)] bg-[var(--bg-1)]" />
      </div>
    ),
  },
);
