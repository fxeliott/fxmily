/**
 * Route-level loading skeleton for /library. The page is `force-dynamic` and
 * awaits a 5-way `Promise.all` (published cards + categories + favorites + unseen
 * deliveries) before any markup, so on a slow connection the previous page stayed
 * frozen with no feedback (same defect S6/S12 fixed for /journal, /dashboard).
 * Mirrors the real max-w-6xl shell (no CLS) with a calm motion-safe pulse.
 */
export default function LibraryLoading() {
  return (
    <main className="relative flex min-h-dvh w-full flex-col bg-[var(--bg)]">
      <div
        className="relative mx-auto w-full max-w-6xl px-4 pt-6 pb-24 md:pt-10 lg:px-8"
        aria-busy="true"
        aria-live="polite"
        aria-label="Chargement de la bibliothèque"
      >
        <header className="mb-6 flex flex-col gap-3 motion-safe:animate-pulse">
          <div className="h-3 w-40 rounded-full bg-[var(--bg-3)]" />
          <div className="h-8 w-72 max-w-full rounded-lg bg-[var(--bg-3)]" />
          <div className="h-4 w-3/4 max-w-2xl rounded-full bg-[var(--bg-3)]" />
        </header>

        <div className="mb-6 flex flex-wrap gap-2 motion-safe:animate-pulse">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="rounded-pill h-9 w-24 bg-[var(--bg-3)]" />
          ))}
        </div>

        <div className="rounded-card mb-6 h-11 w-full bg-[var(--bg-3)] motion-safe:animate-pulse" />

        <div className="grid grid-cols-1 gap-4 motion-safe:animate-pulse sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <div
              key={i}
              className="rounded-card-lg border border-[var(--b-default)] bg-[var(--bg-2)] p-5"
            >
              <div className="mb-3 h-3 w-20 rounded-full bg-[var(--bg-3)]" />
              <div className="mb-2 h-4 w-3/4 rounded-lg bg-[var(--bg-3)]" />
              <div className="h-3 w-1/2 rounded-full bg-[var(--bg-3)]" />
            </div>
          ))}
        </div>
      </div>
    </main>
  );
}
