import { ArrowLeft, GraduationCap } from 'lucide-react';

/**
 * Route-level loading skeleton for /training. The page is `force-dynamic` and
 * awaits `listTrainingTradesForUser` (limit 50) + a 3-way `Promise.all` before any
 * markup, so on a slow connection the previous page stayed frozen with no feedback
 * (same defect S6/S12/S20 fixed for /journal, /dashboard). Mirrors the real
 * MODE ENTRAÎNEMENT header + max-w-3xl container (no CLS) with a calm motion-safe
 * pulse. No score / streak / urgency — anti-Black-Hat §31.2. Reads no data, so the
 * §21.5 training firewall is untouched.
 */
export default function TrainingLoading() {
  return (
    <main className="relative flex min-h-dvh w-full flex-col bg-[var(--bg)]">
      <div
        className="relative mx-auto flex w-full max-w-3xl flex-col gap-6 px-4 py-8"
        aria-busy="true"
        aria-live="polite"
        aria-label="Chargement de tes backtests"
      >
        <header className="flex flex-col gap-4">
          <span className="inline-flex w-fit items-center gap-1.5 text-[12px] text-[var(--t-3)]">
            <ArrowLeft className="h-3.5 w-3.5" strokeWidth={1.75} aria-hidden="true" />
            Tableau de bord
          </span>
          <div className="flex flex-col gap-1.5">
            <span className="t-eyebrow inline-flex items-center gap-1.5 text-[var(--cy)]">
              <GraduationCap className="h-3.5 w-3.5" strokeWidth={2} aria-hidden="true" />
              Mode entraînement
            </span>
            <h1
              className="f-display text-[28px] leading-[1.05] font-bold tracking-[-0.03em] text-[var(--t-1)] sm:text-[32px]"
              style={{ fontFeatureSettings: '"ss01" 1' }}
            >
              Mes backtests
            </h1>
          </div>
        </header>

        <div className="grid grid-cols-3 gap-3 motion-safe:animate-pulse" role="presentation">
          {Array.from({ length: 3 }).map((_, i) => (
            <div
              key={i}
              className="rounded-card flex flex-col gap-2 border border-[var(--b-default)] bg-[var(--bg-2)] p-3.5"
            >
              <div className="h-6 w-12 rounded-md bg-[var(--bg-3)]" />
              <div className="h-2.5 w-16 rounded-full bg-[var(--bg-3)]" />
            </div>
          ))}
        </div>

        <div className="flex flex-col gap-3 motion-safe:animate-pulse" role="presentation">
          {Array.from({ length: 5 }).map((_, i) => (
            <div
              key={i}
              className="rounded-card border border-[var(--b-default)] bg-[var(--bg-2)] p-4"
            >
              <div className="mb-3 flex items-center justify-between gap-3">
                <div className="h-3 w-24 rounded-full bg-[var(--bg-3)]" />
                <div className="h-3 w-16 rounded-full bg-[var(--bg-3)]" />
              </div>
              <div className="mb-2 h-3 w-3/4 rounded-full bg-[var(--bg-3)]" />
              <div className="h-3 w-1/2 rounded-full bg-[var(--bg-3)]" />
            </div>
          ))}
        </div>
      </div>
    </main>
  );
}
