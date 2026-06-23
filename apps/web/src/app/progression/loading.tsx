import { ArrowLeft, Gauge } from 'lucide-react';

/**
 * S20 — route-level loading skeleton for /progression.
 *
 * `force-dynamic` + a top-level `Promise.all` of score queries blocked the hub
 * shell before markup, freezing the previous page on slow connections (the heavy
 * track-record streams via its own Suspense, but the hero + scores do not).
 * Mirrors the real header chrome + `--w-app` container (no CLS) with a calm
 * hero + cards skeleton. Pulse motion-safe only. No score / streak — §31.2.
 */
export default function ProgressionLoading() {
  return (
    <main className="relative flex min-h-dvh flex-col bg-[var(--bg)]">
      <div
        className="relative mx-auto w-full max-w-[var(--w-app)] flex-1 px-4 pt-6 pb-[max(1.5rem,env(safe-area-inset-bottom))] lg:px-8 lg:pt-8 2xl:px-12"
        aria-busy="true"
        aria-live="polite"
        aria-label="Chargement de ta progression"
      >
        <header className="mb-6 flex flex-col gap-4">
          <span className="inline-flex w-fit items-center gap-1.5 text-[12px] text-[var(--t-3)]">
            <ArrowLeft className="h-3.5 w-3.5" strokeWidth={1.75} aria-hidden="true" />
            Tableau de bord
          </span>
          <div className="flex flex-col gap-1.5">
            <span className="t-eyebrow-lg inline-flex items-center gap-1.5 text-[var(--t-3)]">
              <Gauge className="h-3.5 w-3.5" strokeWidth={2} aria-hidden="true" />
              Ma progression
            </span>
            <h1
              className="f-display text-[28px] leading-[1.05] font-bold tracking-[-0.03em] text-[var(--t-1)] sm:text-[32px]"
              style={{ fontFeatureSettings: '"ss01" 1' }}
            >
              Où j’en suis
            </h1>
          </div>
        </header>

        <div className="rounded-card-lg mb-6 h-[180px] border border-[var(--b-default)] bg-[var(--bg-2)] motion-safe:animate-pulse" />
        <div className="grid grid-cols-1 gap-3 motion-safe:animate-pulse sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <div
              key={i}
              className="rounded-card border border-[var(--b-default)] bg-[var(--bg-2)] p-4"
            >
              <div className="mb-2 h-3 w-20 rounded-full bg-[var(--bg-3)]" />
              <div className="h-3 w-3/4 rounded-full bg-[var(--bg-3)]" />
            </div>
          ))}
        </div>
      </div>
    </main>
  );
}
