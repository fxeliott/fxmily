/**
 * S20 — route-level loading skeleton for /dashboard (home, the most-visited
 * surface). The page is `force-dynamic` and awaits a `Promise.all` of 9 services
 * at the top of the Server Component before any markup, so on a slow connection
 * the previous page stayed frozen with no feedback (same defect S6/S12 fixed for
 * /journal, /mindset, /calendrier). Mirrors the real hero + `--w-app` container
 * (no CLS) with a calm pulse. No score / streak / urgency — anti-Black-Hat §31.2.
 */
export default function DashboardLoading() {
  return (
    <main className="relative flex min-h-dvh flex-col bg-[var(--bg)]">
      <div
        className="relative mx-auto w-full max-w-[var(--w-app)] flex-1 px-4 pt-6 pb-[max(1.5rem,env(safe-area-inset-bottom))] lg:px-8 lg:pt-8 2xl:px-12"
        aria-busy="true"
        aria-live="polite"
        aria-label="Chargement de ton tableau de bord"
      >
        {/* North-star hero band */}
        <div className="rounded-card-lg mb-6 border border-[var(--b-default)] bg-[var(--bg-2)] p-6 motion-safe:animate-pulse">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex flex-col gap-3">
              <div className="h-3 w-28 rounded-full bg-[var(--bg-3)]" />
              <div className="h-7 w-64 max-w-full rounded-lg bg-[var(--bg-3)]" />
              <div className="h-4 w-44 rounded-full bg-[var(--bg-3)]" />
            </div>
            <div className="h-[76px] w-[76px] shrink-0 rounded-full bg-[var(--bg-3)]" />
          </div>
        </div>

        {/* Tour 9 — session timeline strip + bento pair (guidance / progression)
            mirror the re-composed hub so the stream-in doesn't shift layout. */}
        <div className="rounded-card mb-6 h-[72px] border border-[var(--b-default)] bg-[var(--bg-2)] motion-safe:animate-pulse" />
        <div className="mb-6 grid items-start gap-4 motion-safe:animate-pulse lg:grid-cols-[1.55fr_1fr]">
          <div className="rounded-card h-[150px] border border-[var(--b-default)] bg-[var(--bg-2)]" />
          <div className="rounded-card h-[150px] border border-[var(--b-default)] bg-[var(--bg-2)]" />
        </div>

        {/* Activity strip 3-up */}
        <div className="mb-6 grid grid-cols-3 gap-3 motion-safe:animate-pulse">
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

        {/* Paired action cards (bento rows réflexive / lucidité) */}
        <div className="grid items-start gap-4 motion-safe:animate-pulse lg:grid-cols-2">
          {Array.from({ length: 2 }).map((_, i) => (
            <div
              key={i}
              className="rounded-card border border-[var(--b-default)] bg-[var(--bg-2)] p-5"
            >
              <div className="mb-3 h-3 w-24 rounded-full bg-[var(--bg-3)]" />
              <div className="mb-2 h-3 w-3/4 rounded-full bg-[var(--bg-3)]" />
              <div className="h-3 w-1/2 rounded-full bg-[var(--bg-3)]" />
            </div>
          ))}
        </div>
      </div>
    </main>
  );
}
