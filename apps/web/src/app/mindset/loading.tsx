import { ArrowLeft, Brain } from 'lucide-react';

/**
 * S12 — route-level loading skeleton for /mindset.
 *
 * `force-dynamic` + top-level `await loadMindsetDashboardData` froze the previous
 * page with no feedback on slow connections. Mirrors the real header chrome +
 * max-w-3xl container (no CLS) + a calm radar/cards skeleton. Pulse motion-safe
 * only. No score / streak — anti-Black-Hat §31.2.
 */
export default function MindsetLoading() {
  return (
    <main className="relative flex min-h-dvh w-full flex-col bg-[var(--bg)]">
      <div
        className="relative mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 px-4 py-8"
        aria-busy="true"
        aria-label="Chargement de ton mindset"
      >
        <header className="flex flex-col gap-4">
          <span className="inline-flex w-fit items-center gap-1.5 text-[12px] text-[var(--t-3)]">
            <ArrowLeft className="h-3.5 w-3.5" strokeWidth={1.75} aria-hidden="true" />
            Tableau de bord
          </span>
          <div className="flex flex-col gap-1.5">
            <span className="t-eyebrow-lg inline-flex items-center gap-1.5 text-[var(--t-3)]">
              <Brain className="h-3.5 w-3.5" strokeWidth={2} aria-hidden="true" />
              Mindset · Auto-évaluation
            </span>
            <h1
              className="f-display text-[28px] leading-[1.05] font-bold tracking-[-0.03em] text-[var(--t-1)] sm:text-[32px]"
              style={{ fontFeatureSettings: '"ss01" 1' }}
            >
              Mon mindset hebdo
            </h1>
          </div>
        </header>

        <div className="rounded-card-lg border border-[var(--b-default)] bg-[var(--bg-2)] p-5 motion-safe:animate-pulse">
          <div className="mx-auto aspect-square w-full max-w-[280px] rounded-full bg-[var(--bg-3)]" />
        </div>
        <div className="grid grid-cols-1 gap-3 motion-safe:animate-pulse sm:grid-cols-2">
          {Array.from({ length: 4 }).map((_, i) => (
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
