import { ArrowLeft, Compass } from 'lucide-react';

/**
 * Tour 16 — route-level loading skeleton for `/onboarding/*`.
 *
 * The landing (`/onboarding/interview`) is `force-dynamic` and awaits both
 * `auth()` and `getInterviewForUser` before deciding whether to render the hero
 * or redirect. On a slow connection that left the previous page frozen. This
 * segment-level skeleton mirrors the landing chrome (back link + eyebrow +
 * title + intro card) inside the `max-w-2xl` container so there is no CLS.
 * Pulse is `motion-safe` only ; no XP / streak (anti Black-Hat).
 */
export default function OnboardingLoading() {
  return (
    <main
      className="relative mx-auto flex min-h-dvh w-full max-w-2xl flex-col gap-6 px-4 py-8"
      aria-busy="true"
      aria-label="Chargement de l’onboarding"
    >
      <header className="flex flex-col gap-4">
        <span className="inline-flex w-fit items-center gap-1.5 text-[12px] text-[var(--t-3)]">
          <ArrowLeft className="h-3.5 w-3.5" strokeWidth={1.75} aria-hidden="true" />
          Tableau de bord
        </span>

        <div className="flex flex-col gap-1.5">
          <span className="t-eyebrow-lg inline-flex items-center gap-1.5 text-[var(--t-3)]">
            <Compass className="h-3.5 w-3.5" strokeWidth={2} aria-hidden="true" />
            Onboarding · Entretien profilage
          </span>
          <div className="h-8 w-72 rounded-full bg-[var(--bg-3)] sm:h-9" />
        </div>
      </header>

      <div className="flex flex-col gap-6 motion-safe:animate-pulse" role="presentation">
        <div className="rounded-card-lg flex flex-col gap-4 border border-[var(--b-default)] bg-[var(--bg-2)] p-5">
          <div className="h-3 w-full rounded-full bg-[var(--bg-3)]" />
          <div className="h-3 w-11/12 rounded-full bg-[var(--bg-3)]" />
          <div className="flex flex-col gap-2.5">
            {Array.from({ length: 3 }).map((_, i) => (
              <div
                key={i}
                className="rounded-control h-14 border border-[var(--b-default)] bg-[var(--bg-1)]"
              />
            ))}
          </div>
        </div>
        <div className="rounded-control h-12 bg-[var(--bg-3)]" />
      </div>
    </main>
  );
}
