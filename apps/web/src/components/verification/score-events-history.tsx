import type { ScoreEventView } from '@/lib/verification/constancy';
import { cn } from '@/lib/utils';

/**
 * S4 (DOD3-T3-02) — « Pourquoi ton score bouge » : the last score events,
 * member-readable. The `ScoreEvent` schema promises the score « stays
 * explainable to the member » — this is the surface that keeps the promise.
 *
 * Calm, anti-Black-Hat §33.2: factual labels, no shaming red wall — a
 * negative delta renders in quiet mono text, an EXCUSED event is visibly
 * neutralized (the member sees that giving a reason worked). Native markup
 * only (0-JS canon, mirror `ConstancyScoreCard`).
 */

const REASON_LABEL: Record<ScoreEventView['reason'], string> = {
  filled: 'Suivi rempli',
  forgot_no_reason: 'Journée sans suivi, sans motif',
  reality_gap: 'Écart entre ton déclaré et ton historique réel',
  false_declaration: 'Trade déclaré sans contrepartie dans ton historique',
};

const DATE_FMT = new Intl.DateTimeFormat('fr-FR', {
  day: 'numeric',
  month: 'short',
  timeZone: 'Europe/Paris',
});

function formatDelta(delta: number): string {
  const rounded = Math.round(delta * 10) / 10;
  return `${rounded > 0 ? '+' : ''}${rounded}`;
}

export function ScoreEventsHistory({ events }: { events: readonly ScoreEventView[] }) {
  if (events.length === 0) return null;

  return (
    <div className="rounded-card flex flex-col gap-3 border border-[var(--b-default)] bg-[var(--bg-1)] p-4">
      <div className="flex flex-col gap-0.5">
        <span className="t-eyebrow text-[var(--t-3)]">Pourquoi ton score bouge</span>
        <span className="t-cap text-[var(--t-4)]">
          Les derniers événements pris en compte — un motif donné neutralise l&apos;événement.
        </span>
      </div>

      <ul className="flex flex-col">
        {events.map((event) => (
          <li
            key={event.id}
            className="flex items-baseline justify-between gap-3 border-t border-[var(--b-subtle)] py-2 first:border-t-0 first:pt-0 last:pb-0"
          >
            <span className="flex min-w-0 flex-col gap-0.5">
              <span
                className={cn(
                  'text-[12px] leading-[1.5]',
                  event.excused ? 'text-[var(--t-4)] line-through' : 'text-[var(--t-2)]',
                )}
              >
                {REASON_LABEL[event.reason]}
              </span>
              <span className="t-foot text-[var(--t-4)]">
                {DATE_FMT.format(event.createdAt)}
                {event.excused ? ' · excusé — motif donné ou levé par la réalité' : ''}
              </span>
            </span>
            <span
              className={cn(
                'f-mono shrink-0 text-[12px] tabular-nums',
                event.excused
                  ? 'text-[var(--t-4)] line-through'
                  : event.delta > 0
                    ? 'text-[var(--cy)]'
                    : 'text-[var(--t-3)]',
              )}
            >
              {formatDelta(event.delta)}
            </span>
          </li>
        ))}
      </ul>

      <p className="t-foot text-[var(--t-4)]">
        Donner un motif sur un écart, ou voir une preuve te donner raison, fait remonter ton score.
      </p>
    </div>
  );
}
