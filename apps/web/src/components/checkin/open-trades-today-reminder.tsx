import { ArrowRight, TimerReset } from 'lucide-react';
import Link from 'next/link';

import { Card } from '@/components/ui/card';

/**
 * Tour 15 — evening check-out reminder: trades ENTERED today (member local day)
 * still open. A position opened this morning is normally still running at the
 * evening bilan; this gently reminds the member to close it in the journal once
 * it is actually done — never a verdict, never red (blue "process" tone, like
 * the hub's `OpenTradesReminder`).
 *
 * Distinct from the 72 h stale-open safety net: this is a same-day, "don't
 * forget to log the close" nudge. The parent only mounts it when `count > 0`
 * (see `getOpenTradesEnteredToday`), so it renders nothing otherwise.
 */
export function OpenTradesTodayReminder({ count }: { count: number }) {
  if (count <= 0) return null;

  const plural = count > 1;

  return (
    <Card className="flex items-start gap-3 p-4">
      <span
        aria-hidden
        className="rounded-control grid h-8 w-8 shrink-0 place-items-center border border-[var(--b-acc)] bg-[var(--acc-dim)] text-[var(--acc-hi)]"
      >
        <TimerReset className="h-4 w-4" strokeWidth={1.75} />
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <p className="t-body text-[var(--t-2)]">
          Tu as {count} trade{plural ? 's' : ''} encore ouvert{plural ? 's' : ''}. Pense à{' '}
          {plural ? 'les' : 'le'} clôturer dans ton journal quand{' '}
          {plural ? 'ils seront fermés' : 'il sera fermé'}.
        </p>
        <Link
          href="/journal"
          className="inline-flex w-fit items-center gap-1.5 text-[13px] font-medium text-[var(--acc-hi)] underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--acc)]"
        >
          Ouvrir mon journal
          <ArrowRight className="h-3.5 w-3.5" strokeWidth={1.75} />
        </Link>
      </div>
    </Card>
  );
}
