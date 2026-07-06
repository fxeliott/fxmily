import { ArrowLeft, BookOpen } from 'lucide-react';

/**
 * Tour 16 — route-level loading skeleton for `/guide`.
 *
 * `/guide` is member-gated and awaits `auth()` before any markup. On a slow
 * connection that left the previous page frozen with no feedback. Mirrors the
 * real chrome (back link + hero glass + a couple of pillar tiles) inside the
 * `max-w-5xl` container so there is no CLS. Pulse is `motion-safe` only.
 */
export default function GuideLoading() {
  return (
    <main className="relative flex min-h-dvh w-full flex-col bg-[var(--bg)]">
      <div
        className="relative mx-auto flex w-full max-w-5xl flex-1 flex-col gap-6 px-4 pt-6 pb-[max(2rem,env(safe-area-inset-bottom))] lg:px-8 lg:pt-8"
        aria-busy="true"
        aria-label="Chargement du guide"
      >
        <span className="inline-flex w-fit items-center gap-1.5 text-[12px] text-[var(--t-3)]">
          <ArrowLeft className="h-3.5 w-3.5" strokeWidth={1.75} aria-hidden="true" />
          Tableau de bord
        </span>

        <div className="flex flex-col gap-6 motion-safe:animate-pulse" role="presentation">
          {/* Hero glass */}
          <div className="rounded-card-lg flex flex-col gap-3 border border-[var(--b-default)] bg-[var(--bg-1)] p-6 sm:p-7 lg:p-8">
            <span className="t-eyebrow-lg inline-flex items-center gap-1.5 text-[var(--t-3)]">
              <BookOpen className="h-3.5 w-3.5" strokeWidth={2} aria-hidden="true" />
              Guide d’utilisation
            </span>
            <div className="h-9 w-72 rounded-full bg-[var(--bg-3)] sm:h-10" />
            <div className="h-3 w-full max-w-[52ch] rounded-full bg-[var(--bg-3)]" />
            <div className="h-3 w-4/5 max-w-[46ch] rounded-full bg-[var(--bg-3)]" />
          </div>

          {/* Pillar grid */}
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {Array.from({ length: 3 }).map((_, i) => (
              <div
                key={i}
                className="rounded-card-lg h-[280px] border border-[var(--b-default)] bg-[var(--bg-1)]"
              />
            ))}
          </div>
        </div>
      </div>
    </main>
  );
}
