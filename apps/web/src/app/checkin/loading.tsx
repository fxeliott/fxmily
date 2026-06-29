/**
 * Route-level loading skeleton for /checkin. The page is `force-dynamic` and
 * awaits a 3-way `Promise.all` (status + streak + last-7-days) before any markup,
 * so on a slow connection the previous page stayed frozen with no feedback (same
 * defect S6/S12 fixed for /journal, /dashboard, /calendrier). Mirrors the real
 * max-w-2xl container (no CLS) with a calm motion-safe pulse. No score / streak /
 * urgency content — anti-Black-Hat §31.2.
 */
export default function CheckinLoading() {
  return (
    <main className="relative flex min-h-dvh w-full flex-col bg-[var(--bg)]">
      <div
        className="relative mx-auto flex w-full max-w-2xl flex-1 flex-col gap-6 px-4 py-8 lg:py-10"
        aria-busy="true"
        aria-live="polite"
        aria-label="Chargement de ton check-in"
      >
        <header className="flex flex-col gap-3 motion-safe:animate-pulse">
          <div className="h-3 w-32 rounded-full bg-[var(--bg-3)]" />
          <div className="h-7 w-64 max-w-full rounded-lg bg-[var(--bg-3)]" />
          <div className="h-4 w-3/4 rounded-full bg-[var(--bg-3)]" />
        </header>

        <div className="flex flex-col gap-6 motion-safe:animate-pulse">
          {Array.from({ length: 2 }).map((_, i) => (
            <div
              key={i}
              className="rounded-card border border-[var(--b-default)] bg-[var(--bg-2)] p-5"
            >
              <div className="mb-3 h-3 w-24 rounded-full bg-[var(--bg-3)]" />
              <div className="h-12 w-full rounded-lg bg-[var(--bg-3)]" />
            </div>
          ))}
        </div>

        <div className="grid gap-4 motion-safe:animate-pulse sm:grid-cols-2">
          {Array.from({ length: 2 }).map((_, i) => (
            <div
              key={i}
              className="rounded-card flex flex-col gap-3 border border-[var(--b-default)] bg-[var(--bg-2)] p-5"
            >
              <div className="rounded-control h-10 w-10 bg-[var(--bg-3)]" />
              <div className="h-4 w-20 rounded-full bg-[var(--bg-3)]" />
              <div className="h-3 w-32 rounded-full bg-[var(--bg-3)]" />
            </div>
          ))}
        </div>
      </div>
    </main>
  );
}
