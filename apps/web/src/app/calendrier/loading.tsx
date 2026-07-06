import { CalendarRange } from 'lucide-react';

/**
 * §26 Calendrier adaptatif — route-level loading skeleton (S6 audit).
 *
 * `/calendrier` is `force-dynamic` and awaits `auth()` + a `Promise.all`
 * (questionnaire + calendar) at the top of the Server Component before any
 * markup renders. On a slow connection that left the previous page frozen with
 * no feedback (DoD §32(2) "sans friction"). This instant placeholder mirrors the
 * real header chrome + a calm card so the layout is stable (no CLS) and the
 * member always sees movement. Pulse is `motion-safe` only (prefers-reduced
 * -motion respected). No score / streak / urgency — anti-Black-Hat §31.2.
 */
export default function CalendrierLoading() {
  return (
    <main
      className="mx-auto flex min-h-dvh w-full max-w-3xl flex-col gap-6 px-4 py-8"
      aria-busy="true"
      aria-label="Chargement de ton calendrier"
    >
      <header className="flex flex-col gap-4">
        <span className="inline-flex w-fit items-center gap-1.5 text-[12px] text-[var(--t-3)]">
          Tableau de bord
        </span>
        <div className="flex flex-col gap-1.5">
          <span className="t-eyebrow-lg inline-flex items-center gap-1.5 text-[var(--t-3)]">
            <CalendarRange className="h-3.5 w-3.5" strokeWidth={2} aria-hidden="true" />
            Calendrier
          </span>
          <h1
            className="f-display text-[28px] leading-[1.05] font-medium tracking-[-0.02em] text-[var(--t-1)] sm:text-[32px]"
            style={{ fontFeatureSettings: '"ss01" 1' }}
          >
            Mon calendrier de la semaine
          </h1>
        </div>
        <p className="t-body leading-[1.6] text-[var(--t-2)]">
          Un plan calme de ton temps de pratique : sessions, entraînement, psychologie, réunions,
          repos.
        </p>
      </header>

      {/* Body placeholder — overview + week-view shape. */}
      <div className="flex flex-col gap-5" role="presentation">
        <div className="rounded-card-lg border border-[var(--b-default)] bg-[var(--bg-2)] p-5">
          <div className="flex flex-col gap-3 motion-safe:animate-pulse">
            <div className="h-3 w-32 rounded-full bg-[var(--bg-3)]" />
            <div className="h-4 w-full rounded-full bg-[var(--bg-3)]" />
            <div className="h-4 w-3/4 rounded-full bg-[var(--bg-3)]" />
          </div>
        </div>
        <div className="grid grid-cols-1 gap-3 motion-safe:animate-pulse sm:grid-cols-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <div
              key={i}
              className="rounded-card border border-[var(--b-default)] bg-[var(--bg-2)] p-4"
            >
              <div className="mb-3 h-3 w-20 rounded-full bg-[var(--bg-3)]" />
              <div className="mb-2 h-3 w-full rounded-full bg-[var(--bg-3)]" />
              <div className="h-3 w-2/3 rounded-full bg-[var(--bg-3)]" />
            </div>
          ))}
        </div>
      </div>
    </main>
  );
}
