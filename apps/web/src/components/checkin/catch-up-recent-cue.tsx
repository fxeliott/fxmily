import { ArrowRight, Moon, RotateCcw, Sun } from 'lucide-react';
import Link from 'next/link';

import { Card } from '@/components/ui/card';
import type { RecentBackfillDay } from '@/lib/checkin/service';
import { formatLocalDate } from '@/lib/checkin/timezone';

/**
 * Tour 15 — hub cue « Rattrapage », multi-day evolution of the yesterday-only
 * `CatchUpYesterdayCue`. When a member missed a slot on one or more recent
 * EXPECTED days, this calmly lists each day (newest first) with a catch-up link
 * per missing slot, each carrying `?date=<day>` so the wizard opens in
 * rattrapage mode.
 *
 * Anti-Black-Hat §31.2: gentle, opt-in ("tu peux"), never red / never a
 * countdown. A missed day is an absence, not a failure. Off days are already
 * filtered out upstream (`getRecentBackfillDays`), so a rest never appears here.
 * The parent only mounts this when the list is non-empty.
 */
export interface CatchUpRecentCueProps {
  /** Recent expected days with a missing slot, newest first (see `getRecentBackfillDays`). */
  days: RecentBackfillDay[];
}

export function CatchUpRecentCue({ days }: CatchUpRecentCueProps) {
  if (days.length === 0) return null;

  const single = days.length === 1;

  return (
    <Card className="flex flex-col gap-3 p-5">
      <div className="flex items-start gap-2.5">
        <span
          aria-hidden
          className="rounded-control grid h-8 w-8 shrink-0 place-items-center border border-[var(--cy-edge)] bg-[var(--cy-dim)] text-[var(--cy)]"
        >
          <RotateCcw className="h-4 w-4" strokeWidth={1.75} />
        </span>
        <div className="flex flex-col gap-1">
          <span className="t-eyebrow">Rattrapage</span>
          <p className="t-body text-[var(--t-2)]">
            {single
              ? 'Il te reste un jour à compléter. Tu peux le rattraper maintenant, avec une phrase pour expliquer.'
              : `Il te reste ${days.length} jours à compléter. Tu peux les rattraper maintenant, avec une phrase pour expliquer.`}
          </p>
        </div>
      </div>

      <ul className="flex flex-col gap-3">
        {days.map((day) => (
          <li key={day.date} className="flex flex-col gap-1.5">
            <span className="t-cap text-[var(--t-3)]">{formatLocalDate(day.date)}</span>
            <div className="flex flex-wrap gap-2">
              {day.morningMissing ? <CatchUpLink slot="morning" date={day.date} /> : null}
              {day.eveningMissing ? <CatchUpLink slot="evening" date={day.date} /> : null}
            </div>
          </li>
        ))}
      </ul>
    </Card>
  );
}

function CatchUpLink({ slot, date }: { slot: 'morning' | 'evening'; date: string }) {
  const isMorning = slot === 'morning';
  const Icon = isMorning ? Sun : Moon;
  const href = `/checkin/${slot}?date=${date}` as const;
  const label = isMorning ? 'Rattraper le matin' : 'Rattraper la soirée';

  return (
    <Link
      href={href}
      className="rounded-control inline-flex items-center gap-1.5 border border-[var(--b-acc)] bg-[var(--acc-dim)] px-3 py-1.5 text-[13px] font-medium text-[var(--acc-hi)] transition-colors hover:bg-[var(--acc-dim-2)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--acc)]"
    >
      <Icon className="h-3.5 w-3.5" strokeWidth={1.75} />
      {label}
      <ArrowRight className="h-3.5 w-3.5" strokeWidth={1.75} />
    </Link>
  );
}
