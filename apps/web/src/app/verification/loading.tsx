import { ArrowLeft, ScanSearch } from 'lucide-react';

/**
 * S20 — route-level loading skeleton for /verification.
 *
 * `force-dynamic` + a top-level `Promise.all` of 5 verification queries (with no
 * internal Suspense) blocked the whole body, freezing the previous page on slow
 * connections. Mirrors the real header chrome + `--w-app` container (no CLS) with
 * a calm hero + cards skeleton, cyan tone (§33.2). Pulse motion-safe only. No
 * score / streak — anti-Black-Hat §31.2.
 */
export default function VerificationLoading() {
  return (
    <main className="relative flex min-h-dvh w-full flex-col bg-[var(--bg)]">
      <div
        className="relative mx-auto flex w-full max-w-[var(--w-app)] flex-1 flex-col gap-6 px-4 py-8 lg:px-8 2xl:px-12"
        aria-busy="true"
        aria-live="polite"
        aria-label="Chargement de ta vérification"
      >
        <header className="flex flex-col gap-4">
          <span className="inline-flex w-fit items-center gap-1.5 text-[12px] text-[var(--t-3)]">
            <ArrowLeft className="h-3.5 w-3.5" strokeWidth={1.75} aria-hidden="true" />
            Tableau de bord
          </span>
          <div className="flex flex-col gap-1.5">
            <span className="t-eyebrow-lg inline-flex items-center gap-1.5 text-[var(--t-3)]">
              <ScanSearch className="h-3.5 w-3.5" strokeWidth={2} aria-hidden="true" />
              Vérification
            </span>
            <h1
              className="f-display text-[28px] leading-[1.05] font-medium tracking-[-0.02em] text-[var(--t-1)] sm:text-[32px]"
              style={{ fontFeatureSettings: '"ss01" 1' }}
            >
              Ta réalité de trading
            </h1>
          </div>
        </header>

        <div className="grid grid-cols-1 gap-3 motion-safe:animate-pulse sm:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <div
              key={i}
              className="rounded-card-lg border border-[var(--b-default)] bg-[var(--bg-2)] p-5"
            >
              <div className="mb-3 h-3 w-24 rounded-full bg-[var(--bg-3)]" />
              <div className="mb-2 h-8 w-20 rounded-lg bg-[var(--bg-3)]" />
              <div className="h-3 w-3/4 rounded-full bg-[var(--bg-3)]" />
            </div>
          ))}
        </div>
      </div>
    </main>
  );
}
