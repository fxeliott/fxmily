import Link from 'next/link';

import { formatMonthLabelFr } from '@/lib/monthly-debrief/format';
import type { SerializedMonthlyDebrief } from '@/lib/monthly-debrief/types';

/**
 * V1.4 — `/debrief-mensuel` landing timeline (SPEC §25.4, member, read-only).
 *
 * Calm month cards linking to `?id=` to switch the read view. The timeline
 * is a recul mirror, not a scoreboard: no streak, no score, no gamification
 * (SPEC §25 anti Black-Hat invariant). Server Component.
 *
 * Each row is a real navigation (the synthesis is read on the same page,
 * `?id=` selecting which month) — UNLIKE the training-debrief timeline
 * which had no detail route (§23.6). Here the member reads the full AI
 * synthesis, so the row IS the entry point.
 *
 * V1.9 TIER F perf — `Intl.DateTimeFormat` hoisted at module level so the
 * (≤24) rows don't each instantiate one.
 */

const FMT_GENERATED_AT_FR = new Intl.DateTimeFormat('fr-FR', {
  day: '2-digit',
  month: 'short',
  year: 'numeric',
});

export function MonthlyDebriefTimeline({
  debriefs,
  selectedId,
}: {
  debriefs: readonly SerializedMonthlyDebrief[];
  selectedId?: string | undefined;
}) {
  if (debriefs.length === 0) {
    return (
      <div
        className="rounded-card-lg border border-dashed border-[var(--b-strong)] p-6 text-center"
        data-empty="true"
      >
        <p className="t-body text-[var(--t-2)]">
          Ton premier débrief mensuel arrivera au début du mois prochain. Il fait le point sur ta
          progression — pas un score, un recul.
        </p>
      </div>
    );
  }

  return (
    <ul className="flex flex-col gap-2.5" data-slot="monthly-debrief-timeline">
      {debriefs.map((d) => {
        const isSelected = d.id === selectedId;
        return (
          <li key={d.id}>
            <Link
              href={`/debrief-mensuel?id=${d.id}`}
              aria-current={isSelected ? 'true' : undefined}
              className={`rounded-card block border bg-[var(--bg-1)] p-4 transition-colors focus-visible:ring-2 focus-visible:ring-[var(--acc)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--bg)] focus-visible:outline-none ${
                isSelected
                  ? 'border-[var(--b-acc)]'
                  : 'border-[var(--b-default)] hover:border-[var(--b-strong)]'
              }`}
            >
              <header className="flex items-baseline justify-between gap-3">
                <p className="t-eyebrow-lg text-[var(--t-2)]">{formatMonthLabelFr(d.monthStart)}</p>
                <p className="t-cap font-mono text-[var(--t-3)]">
                  {FMT_GENERATED_AT_FR.format(new Date(d.generatedAt))}
                </p>
              </header>
              <p className="t-body mt-2 line-clamp-2 text-[var(--t-2)]">{d.progressionNarrative}</p>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
