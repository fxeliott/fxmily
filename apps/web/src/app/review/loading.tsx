/**
 * S12 — route-level loading skeleton for /review (weekly review, module REFLECT).
 *
 * `force-dynamic` + top-level `await` of the recent reviews froze the previous
 * page with no feedback on slow connections. Mirrors the real max-w-3xl container
 * + eyebrow (no CLS) + a calm title/list skeleton. Pulse motion-safe only.
 * No score / streak — anti-Black-Hat §31.2.
 */
export default function ReviewLoading() {
  return (
    <main
      className="relative mx-auto flex w-full max-w-3xl flex-col gap-8 px-4 py-8 sm:px-6 sm:py-12"
      aria-busy="true"
      aria-label="Chargement de tes revues"
    >
      <header className="flex flex-col gap-6">
        <div className="flex flex-col gap-3">
          <p className="t-eyebrow text-[var(--t-3)]">Module REFLECT</p>
          <div className="flex flex-col gap-2 motion-safe:animate-pulse">
            <div className="h-7 w-2/3 rounded-full bg-[var(--bg-3)]" />
            <div className="h-7 w-1/2 rounded-full bg-[var(--bg-3)]" />
          </div>
        </div>
      </header>

      <div className="flex flex-col gap-3 motion-safe:animate-pulse" role="presentation">
        {Array.from({ length: 4 }).map((_, i) => (
          <div
            key={i}
            className="rounded-card border border-[var(--b-default)] bg-[var(--bg-2)] p-4"
          >
            <div className="mb-2 h-3 w-28 rounded-full bg-[var(--bg-3)]" />
            <div className="h-3 w-3/4 rounded-full bg-[var(--bg-3)]" />
          </div>
        ))}
      </div>
    </main>
  );
}
