import { CalendarRange } from 'lucide-react';

/**
 * V1.4 §25.4 — `/debrief-mensuel` route-level loading skeleton (S6 audit).
 *
 * The page is `force-dynamic` and awaits `auth()` + the recent-debriefs read
 * before any markup. This instant placeholder mirrors the header chrome + a
 * reader-shaped card so the delivery stays "sans friction" (DoD §32(2)) on a
 * slow connection, with a stable layout (no CLS). Pulse is `motion-safe` only.
 * Calm Mark Douglas tone — no score, no fanfare (anti-Black-Hat §25.2).
 */
export default function MonthlyDebriefLoading() {
  return (
    <main
      className="mx-auto flex min-h-dvh w-full max-w-3xl flex-col gap-6 px-4 py-8"
      aria-busy="true"
      aria-label="Chargement de ton débrief mensuel"
    >
      <header className="flex flex-col gap-4">
        <span className="inline-flex w-fit items-center gap-1.5 text-[12px] text-[var(--t-3)]">
          Tableau de bord
        </span>
        <div className="flex flex-col gap-1.5">
          <span className="t-eyebrow-lg inline-flex items-center gap-1.5 text-[var(--t-3)]">
            <CalendarRange className="h-3.5 w-3.5" strokeWidth={2} aria-hidden="true" />
            Débrief mensuel
          </span>
          <h1
            className="f-display text-[28px] leading-[1.05] font-medium tracking-[-0.02em] text-[var(--t-1)] sm:text-[32px]"
            style={{ fontFeatureSettings: '"ss01" 1' }}
          >
            Mon débrief mensuel
          </h1>
        </div>
        <p className="t-body leading-[1.6] text-[var(--t-2)]">
          Une synthèse de ton mois écoulé : progression, trading réel et pratique
          d&apos;entraînement, pour prendre du recul.
        </p>
      </header>

      {/* Reader-shaped placeholder. */}
      <div
        className="rounded-card-lg border border-[var(--b-default)] bg-[var(--bg-2)] p-6"
        role="presentation"
      >
        <div className="flex flex-col gap-3 motion-safe:animate-pulse">
          <div className="h-5 w-40 rounded-full bg-[var(--bg-3)]" />
          <div className="mt-2 h-3 w-full rounded-full bg-[var(--bg-3)]" />
          <div className="h-3 w-full rounded-full bg-[var(--bg-3)]" />
          <div className="h-3 w-5/6 rounded-full bg-[var(--bg-3)]" />
          <div className="mt-4 h-3 w-full rounded-full bg-[var(--bg-3)]" />
          <div className="h-3 w-2/3 rounded-full bg-[var(--bg-3)]" />
        </div>
      </div>
    </main>
  );
}
