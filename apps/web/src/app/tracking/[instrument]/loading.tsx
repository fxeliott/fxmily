import { ArrowLeft, ClipboardList } from 'lucide-react';

/**
 * Tour 16 — route-level loading skeleton for `/tracking/[instrument]`.
 *
 * The page is `force-dynamic` and awaits `getTrackingEntry` (server-derived
 * occurrence + prefill) before the wizard renders. This mirrors the real header
 * chrome (back link + eyebrow + title + drawn rule) inside the `max-w-3xl`
 * container so there is no CLS, then a calm wizard placeholder. Pulse is
 * `motion-safe` only ; no score / streak / urgency (§31.2).
 */
export default function TrackingInstrumentLoading() {
  return (
    <main className="relative flex min-h-dvh w-full flex-col bg-[var(--bg)]">
      <div
        className="relative mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 px-4 py-8 sm:px-6"
        aria-busy="true"
        aria-label="Chargement de ton suivi"
      >
        <header className="flex flex-col gap-4">
          <span className="inline-flex w-fit items-center gap-1.5 text-[12px] text-[var(--t-3)]">
            <ArrowLeft className="h-3.5 w-3.5" strokeWidth={1.75} aria-hidden="true" />
            Mon tableau de bord
          </span>

          <div className="flex flex-col gap-1.5">
            <span className="t-eyebrow-lg inline-flex items-center gap-1.5 text-[var(--t-3)]">
              <ClipboardList className="h-3.5 w-3.5" strokeWidth={2} aria-hidden="true" />
              Suivi
            </span>
            <div className="h-8 w-56 rounded-full bg-[var(--bg-3)] sm:h-9" />
          </div>
          <div className="h-px w-full max-w-[220px] rounded-full bg-[var(--bg-3)]" />
        </header>

        <div className="flex flex-col gap-3 motion-safe:animate-pulse" role="presentation">
          <div className="rounded-card-lg h-[220px] border border-[var(--b-default)] bg-[var(--bg-2)]" />
          <div className="rounded-card h-12 border border-[var(--b-default)] bg-[var(--bg-2)]" />
        </div>
      </div>
    </main>
  );
}
