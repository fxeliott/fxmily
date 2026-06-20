/**
 * S12 — route-level loading skeleton for /objectifs.
 *
 * `force-dynamic` + top-level `await getProcessObjectives` froze the previous page
 * with no feedback on slow connections. Mirrors the real header chrome + `--w-app`
 * container (no CLS) + a calm rings skeleton. Pulse motion-safe only. No
 * score / streak / urgency — anti-Black-Hat §31.2.
 */
export default function ObjectifsLoading() {
  return (
    <main className="relative flex min-h-dvh flex-col bg-[var(--bg)]">
      <div
        className="relative mx-auto flex w-full max-w-[var(--w-app)] flex-1 flex-col gap-6 px-4 pt-6 pb-[max(1.5rem,env(safe-area-inset-bottom))] lg:px-8 lg:pt-8 2xl:px-12"
        aria-busy="true"
        aria-label="Chargement de tes objectifs"
      >
        <header className="flex flex-col gap-2">
          <span className="t-eyebrow text-[var(--t-3)]">Ma progression</span>
          <h1
            className="f-display leading-[1.05] font-bold tracking-[-0.03em] text-[var(--t-1)]"
            style={{
              fontFeatureSettings: '"ss01" 1',
              fontSize: 'clamp(1.75rem, 1.45rem + 1.3vw, 2.25rem)',
            }}
          >
            Mes objectifs
          </h1>
          <div className="mt-1 h-3 w-3/4 max-w-[62ch] rounded-full bg-[var(--bg-3)] motion-safe:animate-pulse" />
        </header>

        <div className="grid grid-cols-1 gap-4 motion-safe:animate-pulse lg:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <div
              key={i}
              className="rounded-card-lg border border-[var(--b-default)] bg-[var(--bg-2)] p-5"
            >
              <div className="mx-auto mb-4 aspect-square w-28 rounded-full bg-[var(--bg-3)]" />
              <div className="mx-auto h-3 w-24 rounded-full bg-[var(--bg-3)]" />
            </div>
          ))}
        </div>
      </div>
    </main>
  );
}
