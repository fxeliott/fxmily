import { ArrowLeft, ShieldCheck } from 'lucide-react';

/**
 * Tour 16 — route-level loading skeleton for `/pre-trade/*`.
 *
 * `/pre-trade/new` is `force-dynamic` and awaits `loadPreTradeCorrelationData`
 * (the per-reason mirror) before the wizard renders. On a slow connection that
 * left the previous page frozen with no feedback. This segment-level skeleton
 * covers the child route ; it mirrors the real header chrome (pause glyph +
 * eyebrow + title) inside the `max-w-3xl` container so there is no CLS, then a
 * calm wizard placeholder. Pulse is `motion-safe` only, no score / urgency.
 */
export default function PreTradeLoading() {
  return (
    <main className="relative flex min-h-dvh w-full flex-col bg-[var(--bg)]">
      <div
        className="relative mx-auto flex w-full max-w-3xl flex-col gap-6 px-4 py-8 sm:px-6"
        aria-busy="true"
        aria-label="Chargement de la pause pré-trade"
      >
        <header className="flex flex-col gap-4">
          <span className="inline-flex w-fit items-center gap-1.5 text-[12px] text-[var(--t-3)]">
            <ArrowLeft className="h-3.5 w-3.5" strokeWidth={1.75} aria-hidden="true" />
            Tableau de bord
          </span>

          <div className="flex items-start gap-4">
            <div
              className="mt-0.5 h-16 w-16 shrink-0 rounded-full bg-[var(--bg-3)] sm:h-20 sm:w-20"
              role="presentation"
            />
            <div className="flex min-w-0 flex-col gap-1.5">
              <span className="t-eyebrow-lg inline-flex items-center gap-1.5 text-[var(--t-3)]">
                <ShieldCheck className="h-3.5 w-3.5" strokeWidth={2} aria-hidden="true" />
                Pré-trade · Pause de discipline
              </span>
              <div className="h-8 w-64 rounded-full bg-[var(--bg-3)] sm:h-9" />
              <div className="mt-1 h-3 w-48 rounded-full bg-[var(--bg-3)]" />
            </div>
          </div>
        </header>

        <div className="flex flex-col gap-3 motion-safe:animate-pulse" role="presentation">
          <div className="rounded-card-lg h-[220px] border border-[var(--b-default)] bg-[var(--bg-2)]" />
          <div className="rounded-card h-12 border border-[var(--b-default)] bg-[var(--bg-2)]" />
        </div>
      </div>
    </main>
  );
}
