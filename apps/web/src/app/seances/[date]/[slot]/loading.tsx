/**
 * Route-level loading skeleton for /seances/[date]/[slot] (force-dynamic).
 * Mirrors the real reading column + 16:9 replay block (no CLS). Pulse motion-safe.
 */
export default function SeanceLoading() {
  return (
    <main
      className="mx-auto flex min-h-dvh w-full max-w-4xl flex-col gap-6 px-4 py-8 lg:px-8"
      aria-busy="true"
      aria-label="Chargement de la séance"
    >
      <header className="flex flex-col gap-3 motion-safe:animate-pulse">
        <div className="h-3 w-24 rounded-full bg-[var(--bg-3)]" />
        <div className="h-7 w-3/4 rounded-lg bg-[var(--bg-3)]" />
        <div className="h-3 w-40 rounded-full bg-[var(--bg-3)]" />
      </header>
      <div className="rounded-card aspect-video w-full bg-[var(--bg-2)] motion-safe:animate-pulse" />
      <div className="flex flex-col gap-2.5 motion-safe:animate-pulse">
        {Array.from({ length: 3 }).map((_, i) => (
          <div
            key={i}
            className="rounded-card h-16 border border-[var(--b-default)] bg-[var(--bg-2)]"
          />
        ))}
      </div>
    </main>
  );
}
