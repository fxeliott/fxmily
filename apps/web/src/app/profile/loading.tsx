import { ArrowLeft, Compass } from 'lucide-react';

/**
 * Route-level loading skeleton for `/profile`.
 *
 * `force-dynamic` + top-level `await Promise.all([getInterviewForUser,
 * getProfileForUser])` froze the previous page with no feedback on slow
 * connections. Mirrors the real header chrome + `max-w-3xl` container (no CLS)
 * + a calm card skeleton. Pulse is `motion-safe` only. No score / streak /
 * countdown — anti-Black-Hat §2 / §31.2 (Mark Douglas, descriptif jamais
 * anxiogène).
 */
export default function ProfileLoading() {
  return (
    <main className="relative flex min-h-dvh w-full flex-col bg-[var(--bg)]">
      <div
        className="relative mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 px-4 py-8"
        aria-busy="true"
        aria-label="Chargement de ton profil"
      >
        <header className="flex flex-col gap-4">
          <span className="inline-flex w-fit items-center gap-1.5 text-[12px] text-[var(--t-3)]">
            <ArrowLeft className="h-3.5 w-3.5" strokeWidth={1.75} aria-hidden="true" />
            Tableau de bord
          </span>
          <div className="flex flex-col gap-1.5">
            <span className="t-eyebrow-lg inline-flex items-center gap-1.5 text-[var(--t-3)]">
              <Compass className="h-3.5 w-3.5" strokeWidth={2} aria-hidden="true" />
              Mon profil
            </span>
            <h1 className="t-h1 text-[var(--t-1)]">Ton profil de trader.</h1>
          </div>
        </header>

        {/* Synthèse card skeleton */}
        <div className="rounded-card-lg border border-[var(--b-default)] bg-[var(--bg-2)] p-6 motion-safe:animate-pulse">
          <div className="mb-4 h-4 w-28 rounded-full bg-[var(--bg-3)]" />
          <div className="flex flex-col gap-2">
            <div className="h-3 w-full rounded-full bg-[var(--bg-3)]" />
            <div className="h-3 w-11/12 rounded-full bg-[var(--bg-3)]" />
            <div className="h-3 w-3/4 rounded-full bg-[var(--bg-3)]" />
          </div>
        </div>

        {/* Axes prioritaires card skeleton */}
        <div className="rounded-card-lg border border-[var(--b-default)] bg-[var(--bg-2)] p-6 motion-safe:animate-pulse">
          <div className="mb-4 flex items-center gap-3">
            <div className="rounded-pill h-9 w-9 shrink-0 bg-[var(--bg-3)]" />
            <div className="h-4 w-32 rounded-full bg-[var(--bg-3)]" />
          </div>
          <div className="flex flex-col gap-2.5">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="flex items-center gap-3">
                <div className="rounded-pill h-6 w-6 shrink-0 bg-[var(--bg-3)]" />
                <div className="h-3 w-2/3 rounded-full bg-[var(--bg-3)]" />
              </div>
            ))}
          </div>
        </div>
      </div>
    </main>
  );
}
