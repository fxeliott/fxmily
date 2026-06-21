import { Sunrise } from 'lucide-react';

/**
 * S12 — surfaces the member's OWN morning intention back to them during the day
 * (dashboard) and at the head of the evening check-in.
 *
 * The morning wizard promises the intention "te ramène à ton plan dès qu'elle se
 * rappelle à toi" (StepIntention), but it was written then never re-shown —
 * write-only. This closes the day loop: morning (cadre) → evening (reflect).
 *
 * Read-only echo of a free-text field the member wrote himself. No score, no
 * judgment, no "did you hold it?" verdict — and zero market content (§2:
 * check-ins carry NO market content; the intention is a one-line mindset note).
 * Renders nothing when there is no intention for the day.
 */
export function MorningIntentionRecall({
  intention,
  context = 'day',
  className = '',
}: {
  intention: string | null | undefined;
  context?: 'day' | 'evening';
  className?: string;
}) {
  const text = intention?.trim();
  if (!text) return null;

  const label = context === 'evening' ? 'Ce matin, tu visais' : 'Ton intention du jour';

  return (
    <aside
      className={`rounded-card flex items-start gap-3 border border-[var(--b-acc)] bg-[var(--acc-dim)] p-4 ${className}`.trim()}
      aria-label={label}
    >
      <span
        aria-hidden="true"
        className="rounded-control mt-0.5 grid h-8 w-8 shrink-0 place-items-center border border-[var(--b-acc)] bg-[var(--bg-1)]/50 text-[var(--acc)]"
      >
        <Sunrise className="h-4 w-4" strokeWidth={1.75} />
      </span>
      <div className="flex min-w-0 flex-col gap-0.5">
        {/* S15 #25 — --acc-hi clears WCAG 1.4.3 AA on the --acc-dim aside fill. */}
        <span className="t-eyebrow text-[var(--acc-hi)]">{label}</span>
        <p className="t-body leading-[1.5] break-words text-[var(--t-1)]">«&nbsp;{text}&nbsp;»</p>
      </div>
    </aside>
  );
}
