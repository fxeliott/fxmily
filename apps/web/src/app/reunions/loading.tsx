import { CalendarClock } from 'lucide-react';

/**
 * S12 — route-level loading skeleton for /reunions.
 *
 * `force-dynamic` + top-level `await listMeetingsForMember` froze the previous
 * page with no feedback on slow connections. Mirrors the real max-w-3xl container
 * + header chrome (no CLS) + a calm rate/list skeleton. Pulse motion-safe only.
 * No score / streak / urgency — anti-Black-Hat §31.2.
 */
export default function ReunionsLoading() {
  return (
    <main
      className="mx-auto flex min-h-dvh w-full max-w-3xl flex-col gap-6 px-4 py-8"
      aria-busy="true"
      aria-label="Chargement de tes réunions"
    >
      <header className="flex flex-col gap-4">
        <div className="flex flex-col gap-1.5">
          <span className="t-eyebrow-lg inline-flex items-center gap-1.5 text-[var(--t-3)]">
            <CalendarClock className="h-3.5 w-3.5" strokeWidth={2} aria-hidden="true" />
            Réunions Fxmily · Présence
          </span>
          <h1
            className="f-display text-[28px] leading-[1.05] font-medium tracking-[-0.02em] text-[var(--t-1)] sm:text-[32px]"
            style={{ fontFeatureSettings: '"ss01" 1' }}
          >
            Tes réunions
          </h1>
        </div>
      </header>

      <div className="rounded-card-lg border border-[var(--b-default)] bg-[var(--bg-2)] p-5 motion-safe:animate-pulse">
        <div className="mb-3 h-3 w-32 rounded-full bg-[var(--bg-3)]" />
        <div className="h-8 w-20 rounded-full bg-[var(--bg-3)]" />
      </div>
      <div className="flex flex-col gap-3 motion-safe:animate-pulse" role="presentation">
        {Array.from({ length: 4 }).map((_, i) => (
          <div
            key={i}
            className="rounded-card border border-[var(--b-default)] bg-[var(--bg-2)] p-4"
          >
            <div className="mb-2 h-3 w-40 rounded-full bg-[var(--bg-3)]" />
            <div className="h-3 w-2/3 rounded-full bg-[var(--bg-3)]" />
          </div>
        ))}
      </div>
    </main>
  );
}
