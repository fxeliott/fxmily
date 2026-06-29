/**
 * Route-level loading skeleton for the /admin segment. Admin pages are
 * `force-dynamic` and await parallel aggregations (member stats, pending access
 * requests, catalog stats, cohort attention) before any markup. This gives the
 * admin segment the same slow-connection feedback the member routes already have,
 * mirroring the `--w-app` console shell (no CLS) with a calm motion-safe pulse.
 */
export default function AdminLoading() {
  return (
    <main className="relative mx-auto flex min-h-dvh w-full max-w-[var(--w-app)] flex-col gap-6 px-4 py-8 lg:px-8 2xl:px-12">
      <div
        className="flex flex-col gap-6"
        aria-busy="true"
        aria-live="polite"
        aria-label="Chargement de la console admin"
      >
        <header className="flex flex-col gap-3 motion-safe:animate-pulse">
          <div className="h-3 w-28 rounded-full bg-[var(--bg-3)]" />
          <div className="h-7 w-56 max-w-full rounded-lg bg-[var(--bg-3)]" />
          <div className="h-4 w-3/4 max-w-xl rounded-full bg-[var(--bg-3)]" />
        </header>

        <div className="grid gap-4 motion-safe:animate-pulse sm:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div
              key={i}
              className="rounded-card flex flex-col gap-2 border border-[var(--b-default)] bg-[var(--bg-2)] p-4"
            >
              <div className="h-6 w-12 rounded-md bg-[var(--bg-3)]" />
              <div className="h-2.5 w-20 rounded-full bg-[var(--bg-3)]" />
            </div>
          ))}
        </div>

        <div className="flex flex-col gap-4 motion-safe:animate-pulse">
          {Array.from({ length: 2 }).map((_, i) => (
            <div
              key={i}
              className="rounded-card-lg border border-[var(--b-default)] bg-[var(--bg-2)] p-5"
            >
              <div className="mb-3 h-3 w-32 rounded-full bg-[var(--bg-3)]" />
              <div className="mb-2 h-3 w-3/4 rounded-full bg-[var(--bg-3)]" />
              <div className="h-3 w-1/2 rounded-full bg-[var(--bg-3)]" />
            </div>
          ))}
        </div>
      </div>
    </main>
  );
}
