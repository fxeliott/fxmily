import { Target } from 'lucide-react';

/**
 * S15 — surfaces the member's OWN focus from their LAST weekly review back to
 * them at the head of the new review, closing the week-level intention loop.
 *
 * Carbon of `morning-intention-recall.tsx` (the day-level loop), one tier up:
 * the morning intention closes the DAY (morning → evening); this closes the
 * WEEK (last Sunday's `nextWeekFocus` → this Sunday's review). The wizard
 * collects `nextWeekFocus` every Sunday but never re-shows the previous one —
 * write-only, so the focus was set then forgotten (audit S15 #15, high sev).
 *
 * Read-only echo of a free-text field the member wrote himself. No score, no
 * judgment, no "did you achieve it?" verdict — same Douglas-safe posture as the
 * day-loop recall (`morning-intention-recall.tsx:11-13`). Process > outcome:
 * the recall reframes the review as a continuous loop, not a throwaway journal.
 * Renders nothing when there is no previous focus.
 *
 * Eyebrow uses `--acc-hi` (not `--acc`) so the 10px label clears WCAG 1.4.3 AA
 * on the `--acc-dim` fill (S15 #25 — `--acc` is ~3.15:1 on tinted surfaces).
 */
export function WeeklyFocusRecall({
  focus,
  className = '',
}: {
  focus: string | null | undefined;
  className?: string;
}) {
  const text = focus?.trim();
  if (!text) return null;

  const label = 'La semaine dernière, tu visais';

  return (
    <aside
      className={`rounded-card flex items-start gap-3 border border-[var(--b-acc)] bg-[var(--acc-dim)] p-4 ${className}`.trim()}
      aria-label={label}
    >
      <span
        aria-hidden="true"
        className="rounded-control mt-0.5 grid h-8 w-8 shrink-0 place-items-center border border-[var(--b-acc)] bg-[var(--bg-1)]/50 text-[var(--acc-hi)]"
      >
        <Target className="h-4 w-4" strokeWidth={1.75} />
      </span>
      <div className="flex min-w-0 flex-col gap-0.5">
        <span className="t-eyebrow text-[var(--acc-hi)]">{label}</span>
        <p className="t-body leading-[1.5] break-words text-[var(--t-1)]">«&nbsp;{text}&nbsp;»</p>
      </div>
    </aside>
  );
}
