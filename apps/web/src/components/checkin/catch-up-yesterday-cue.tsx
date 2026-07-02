import { ArrowRight, Moon, RotateCcw, Sun } from 'lucide-react';
import Link from 'next/link';

import { Card } from '@/components/ui/card';
import { formatLocalDate } from '@/lib/checkin/timezone';

/**
 * F7 — hub cue « Rattraper hier ». When a member missed a slot yesterday, this
 * calmly offers to catch it up today WITH a justification (brief §F7). Renders
 * one link per missing slot, each carrying `?date=<yesterday>` so the wizard
 * opens in rattrapage mode.
 *
 * Anti-Black-Hat §31.2: gentle, opt-in ("tu peux"), never red / never a
 * countdown. A missed slot is an absence, not a failure. The parent only mounts
 * this when at least one slot is actually missing (see `getYesterdayBackfill`).
 */
export interface CatchUpYesterdayCueProps {
  /** Yesterday's local date (YYYY-MM-DD) — passed to the wizard as `?date=`. */
  date: string;
  morningMissing: boolean;
  eveningMissing: boolean;
}

export function CatchUpYesterdayCue({
  date,
  morningMissing,
  eveningMissing,
}: CatchUpYesterdayCueProps) {
  const both = morningMissing && eveningMissing;
  const label = both ? 'le matin et la soirée' : morningMissing ? 'le matin' : 'la soirée';

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
            Hier ({formatLocalDate(date)}), il te reste {label} à remplir. Tu peux le rattraper
            maintenant, avec une phrase pour expliquer.
          </p>
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        {morningMissing ? <CatchUpLink slot="morning" date={date} /> : null}
        {eveningMissing ? <CatchUpLink slot="evening" date={date} /> : null}
      </div>
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
