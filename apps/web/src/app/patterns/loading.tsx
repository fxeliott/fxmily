import { Activity } from 'lucide-react';

/**
 * Route-level loading skeleton for /patterns.
 *
 * `force-dynamic` + auth + searchParams parsing block the shell before any
 * markup (the heavy analytics stream via their own Suspense, but the hero and
 * section chrome do not). Mirrors the real `--w-app` container + hero card
 * footprint (no CLS). Pulse motion-safe only. No score / streak — §31.2.
 */
export default function PatternsLoading() {
  return (
    <main className="relative flex min-h-dvh flex-col bg-[var(--bg)]">
      <div
        className="relative mx-auto w-full max-w-[var(--w-app)] flex-1 px-4 pt-6 pb-[max(1.5rem,env(safe-area-inset-bottom))] lg:px-8 lg:pt-8 2xl:px-12"
        aria-busy="true"
        aria-live="polite"
        aria-label="Chargement de tes patterns"
      >
        <header className="mb-6 flex flex-col gap-1.5">
          <span className="t-eyebrow-lg inline-flex items-center gap-1.5 text-[var(--t-3)]">
            <Activity className="h-3.5 w-3.5" strokeWidth={2} aria-hidden="true" />
            Patterns
          </span>
          <div className="h-8 w-56 rounded-full bg-[var(--bg-3)] motion-safe:animate-pulse sm:h-9" />
        </header>

        <div className="rounded-card-lg mb-6 h-[140px] border border-[var(--b-default)] bg-[var(--bg-2)] motion-safe:animate-pulse" />
        <div className="flex flex-col gap-6 motion-safe:animate-pulse">
          {Array.from({ length: 3 }).map((_, i) => (
            <section key={i} className="flex flex-col gap-3">
              <div className="h-3 w-40 rounded-full bg-[var(--bg-3)]" />
              <div className="rounded-card-lg h-[220px] border border-[var(--b-default)] bg-[var(--bg-2)]" />
            </section>
          ))}
        </div>
      </div>
    </main>
  );
}
