import Link from 'next/link';

import { Pill } from '@/components/ui/pill';
import type { SerializedTrainingTrade } from '@/lib/training/training-trade-service';

import { TrainingTradeCard } from './training-trade-card';

/**
 * Thin composition wrapper (J-T3): the J-T2 read-only `TrainingTradeCard`
 * stays pure presentation (no Link coupling); this adds the click-through to
 * the backtest detail + an unseen-corrections pill. Used by `/training` (the
 * member list) and the session detail. The pill is cyan — consistent with the
 * training identity, never the shared blue `--acc` CTA accent (non-confusability
 * §21.5 / Mark Douglas). The label says "non lue(s)" because the count is the
 * UNSEEN tally (`countUnseenTrainingAnnotationsByTrainingTrade`, WHERE
 * seenByMemberAt null) — the pill disappears once the member opens the backtest,
 * mirroring the J4 "nouvelle correction" framing (read corrections live on the
 * detail under "Corrections reçues").
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
            {unseenAnnotationsCount} correction{unseenAnnotationsCount > 1 ? 's' : ''} non lue
            {unseenAnnotationsCount > 1 ? 's' : ''}
          </Pill>
        </div>
      ) : null}
    </Link>
  );
}
