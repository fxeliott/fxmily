import Link from 'next/link';

import { Pill } from '@/components/ui/pill';
import type { SerializedTrainingTrade } from '@/lib/training/training-trade-service';

import { TrainingTradeCard } from './training-trade-card';

/**
 * Thin composition wrapper (J-T3): the J-T2 read-only `TrainingTradeCard`
 * stays pure presentation (no Link coupling); this adds the click-through to
 * the backtest detail + an unseen-corrections pill. Used by `/training` (the
 * member list). The pill is cyan — consistent with the training identity,
 * never the lime real-edge accent (non-confusability §21.5 / Mark Douglas).
 */
export function TrainingTradeCardLinkable({
  trade,
  href,
  unseenAnnotationsCount = 0,
}: {
  trade: SerializedTrainingTrade;
  href: string;
  unseenAnnotationsCount?: number;
}) {
  return (
    <Link
      href={href}
      className="rounded-card block transition-opacity hover:opacity-90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--cy)]"
    >
      <TrainingTradeCard trade={trade} />
      {unseenAnnotationsCount > 0 ? (
        <div className="mt-1.5 flex justify-end">
          <Pill tone="cy" dot="live">
            {unseenAnnotationsCount} correction{unseenAnnotationsCount > 1 ? 's' : ''} reçue
            {unseenAnnotationsCount > 1 ? 's' : ''}
          </Pill>
        </div>
      ) : null}
    </Link>
  );
}
