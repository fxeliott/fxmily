/**
 * Route-level loading skeleton for /track. The page is `force-dynamic` and awaits
 * `listRecentHabitLogs` before any markup (and TodayHabitCards runs the same query
 * un-suspended), so on a slow connection the previous page stayed frozen with no
 * feedback (same defect S6/S12 fixed for /journal, /dashboard). Mirrors the real
 * max-w-3xl container + pentagon hero + 5 today cards (no CLS) with a calm
 * motion-safe pulse. No score / streak / urgency — anti-Black-Hat §31.2.
 */
export default function TrackLoading() {
  return (
    <main className="relative flex min-h-dvh w-full flex-col bg-[var(--bg)]">
      <div
        className="relative mx-auto w-full max-w-3xl space-y-8 px-4 py-6"
        aria-busy="true"
        aria-live="polite"
        aria-label="Chargement du suivi des habitudes"
      >
        <div className="space-y-2 motion-safe:animate-pulse">
          <div className="h-3 w-40 rounded-full bg-[var(--bg-3)]" />
          <div className="h-8 w-64 max-w-full rounded-lg bg-[var(--bg-3)]" />
          <div className="h-3 w-3/4 rounded-full bg-[var(--bg-3)]" />
        </div>

        <div className="rounded-card-lg flex justify-center border border-[var(--b-default)] bg-[var(--bg-2)] p-6 motion-safe:animate-pulse">
          <div className="h-44 w-44 rounded-full bg-[var(--bg-3)]" />
        </div>

        <div className="grid grid-cols-1 gap-3 motion-safe:animate-pulse sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 5 }).map((_, i) => (
            <div
              key={i}
              className="rounded-card flex flex-col gap-2 border border-[var(--b-default)] bg-[var(--bg-2)] p-3.5"
            >
              <div className="h-4 w-24 rounded-full bg-[var(--bg-3)]" />
              <div className="h-3 w-3/4 rounded-full bg-[var(--bg-3)]" />
            </div>
          ))}
        </div>

        <div className="rounded-card-lg h-48 border border-[var(--b-default)] bg-[var(--bg-2)] motion-safe:animate-pulse" />
      </div>
    </main>
  );
}
