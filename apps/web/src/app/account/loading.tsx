/**
 * Route-level loading skeleton for /account. The page is `force-dynamic` and
 * awaits `db.user.findUnique` before any markup, so on a slow connection the
 * previous page stayed frozen with no feedback (same convention as the 12 sibling
 * member routes). Mirrors the real max-w-5xl container + 3-card grid (no CLS) with
 * a calm motion-safe pulse. Root app/error.tsx already covers the error boundary.
 */
export default function AccountLoading() {
  return (
    <main className="relative bg-[var(--bg)]">
      <div
        className="relative mx-auto w-full max-w-5xl px-4 py-6 sm:py-10 lg:px-8"
        aria-busy="true"
        aria-live="polite"
        aria-label="Chargement de ton espace compte"
      >
        <header className="mb-6 motion-safe:animate-pulse">
          <div className="h-9 w-28 rounded-md bg-[var(--bg-3)]" />
          <div className="mt-4 h-3 w-24 rounded-full bg-[var(--bg-3)]" />
          <div className="mt-2 h-7 w-48 rounded-lg bg-[var(--bg-3)]" />
          <div className="mt-3 h-4 w-3/4 max-w-prose rounded-full bg-[var(--bg-3)]" />
        </header>
        <ul className="grid gap-4 motion-safe:animate-pulse sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <li
              key={i}
              className="rounded-card-lg h-full border border-[var(--b-default)] bg-[var(--bg-1)] p-5"
            >
              <div className="flex items-start gap-3">
                <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-[var(--bg-3)]" />
                <div className="min-w-0 flex-1">
                  <div className="h-4 w-24 rounded-full bg-[var(--bg-3)]" />
                  <div className="mt-2 h-3 w-full rounded-full bg-[var(--bg-3)]" />
                  <div className="mt-1.5 h-3 w-2/3 rounded-full bg-[var(--bg-3)]" />
                </div>
              </div>
            </li>
          ))}
        </ul>
      </div>
    </main>
  );
}
