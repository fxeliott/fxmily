import { Clapperboard } from 'lucide-react';

/**
 * Route-level loading skeleton for /seances (force-dynamic + top-level await).
 * Mirrors the real container + header chrome (no CLS) + a calm stat/list
 * skeleton. Pulse motion-safe only. No score / urgency.
 */
export default function SeancesLoading() {
  return (
    <main
      className="mx-auto flex min-h-dvh w-full max-w-[var(--w-app)] flex-col gap-6 px-4 py-8 lg:px-8 2xl:px-12"
      aria-busy="true"
      aria-label="Chargement des séances"
    >
      <header className="flex flex-col gap-1.5">
        <span className="t-eyebrow-lg inline-flex items-center gap-1.5 text-[var(--t-3)]">
          <Clapperboard className="h-3.5 w-3.5" strokeWidth={2} aria-hidden="true" />
          Réunion Trading Hub · Replays
        </span>
        <h1
          className="f-display text-[28px] leading-[1.05] font-medium tracking-[-0.02em] text-[var(--t-1)] sm:text-[32px]"
          style={{ fontFeatureSettings: '"ss01" 1' }}
        >
          Les séances
        </h1>
      </header>

      <div className="grid grid-cols-3 gap-3 motion-safe:animate-pulse">
        {Array.from({ length: 3 }).map((_, i) => (
          <div
            key={i}
            className="rounded-card h-24 border border-[var(--b-default)] bg-[var(--bg-2)]"
          />
        ))}
      </div>
      <div className="grid grid-cols-1 gap-3 motion-safe:animate-pulse md:grid-cols-2 xl:grid-cols-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <div
            key={i}
            className="rounded-card h-32 border border-[var(--b-default)] bg-[var(--bg-2)]"
          />
        ))}
      </div>
    </main>
  );
}
