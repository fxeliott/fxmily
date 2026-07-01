/**
 * Route-level loading skeleton for /checkin/history. The page is `force-dynamic`
 * and awaits a 2-way `Promise.all` (year heatmap + full history) before any
 * markup, so on a slow connection the previous page would freeze with no
 * feedback (same defect fixed for /checkin, /journal, /dashboard). Mirrors the
 * real max-w-2xl container (no CLS) with a calm motion-safe pulse. No score /
 * streak / urgency content — anti-Black-Hat §31.2.
 */
export default function CheckinHistoryLoading() {
  return (
    <main className="relative flex min-h-dvh w-full flex-col bg-[var(--bg)]">
      <div
        className="relative mx-auto flex w-full max-w-2xl flex-1 flex-col gap-6 px-4 py-8 lg:py-10"
        aria-busy="true"
        aria-live="polite"
        aria-label="Chargement de ton historique"
      >
        <header className="flex flex-col gap-3 motion-safe:animate-pulse">
          <div className="h-3 w-36 rounded-full bg-[var(--bg-3)]" />
          <div className="h-7 w-56 max-w-full rounded-lg bg-[var(--bg-3)]" />
          <div className="h-4 w-3/4 rounded-full bg-[var(--bg-3)]" />
        </header>

        {/* Heatmap année */}
        <div className="motion-safe:animate-pulse">
          <div className="rounded-card border border-[var(--b-default)] bg-[var(--bg-2)] p-5">
            <div className="mb-3 h-3 w-40 rounded-full bg-[var(--bg-3)]" />
            <div className="h-28 w-full rounded-lg bg-[var(--bg-3)]" />
          </div>
        </div>

        {/* Détail jour par jour */}
        <div className="flex flex-col gap-3 motion-safe:animate-pulse">
          {Array.from({ length: 3 }).map((_, i) => (
            <div
              key={i}
              className="rounded-card border border-[var(--b-default)] bg-[var(--bg-2)] p-4"
            >
              <div className="mb-4 h-4 w-48 max-w-full rounded-full bg-[var(--bg-3)]" />
              <div className="grid gap-4 sm:grid-cols-2">
                {Array.from({ length: 2 }).map((__, j) => (
                  <div key={j} className="flex flex-col gap-2">
                    <div className="h-3 w-16 rounded-full bg-[var(--bg-3)]" />
                    <div className="h-3 w-full rounded-full bg-[var(--bg-3)]" />
                    <div className="h-3 w-5/6 rounded-full bg-[var(--bg-3)]" />
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </main>
  );
}
