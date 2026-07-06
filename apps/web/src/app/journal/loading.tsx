import { ArrowLeft } from 'lucide-react';

/**
 * S12 — route-level loading skeleton for /journal (most-visited member surface).
 *
 * `/journal` is `force-dynamic` and awaits `listTradesForUser` at the top of the
 * Server Component before any markup. On a slow connection that left the previous
 * page frozen with no feedback (same defect S6 fixed for /calendrier). Mirrors the
 * real header chrome + `--w-app` container (no CLS) + a calm list skeleton. Pulse
 * is `motion-safe` only. No score / streak / urgency — anti-Black-Hat §31.2.
 */
export default function JournalLoading() {
  return (
    <main className="relative flex min-h-dvh flex-col bg-[var(--bg)]">
      <div
        className="relative mx-auto flex w-full max-w-[var(--w-app)] flex-1 flex-col gap-6 px-4 py-8 lg:px-8 2xl:px-12"
        aria-busy="true"
        aria-label="Chargement de ton journal"
      >
        <header className="flex flex-col gap-4">
          <span className="inline-flex w-fit items-center gap-1.5 text-[12px] text-[var(--t-3)]">
            <ArrowLeft className="h-3.5 w-3.5" strokeWidth={1.75} aria-hidden="true" />
            Tableau de bord
          </span>
          <div className="flex flex-col gap-1.5">
            <span className="t-eyebrow">Journal</span>
            <h1
              className="f-display text-[28px] leading-[1.05] font-medium tracking-[-0.02em] text-[var(--t-1)] sm:text-[32px]"
              style={{ fontFeatureSettings: '"ss01" 1' }}
            >
              Mes trades
            </h1>
          </div>
        </header>

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
