import Link from 'next/link';

import { HoverGlowLift } from '@/components/ui/hover-glow-lift';
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
  timezone = 'Europe/Paris',
}: {
  trade: SerializedTrainingTrade;
  href: string;
  unseenAnnotationsCount?: number;
  timezone?: string;
}) {
  return (
    // S18 — identité CYAN training (§21.7) : lift spring + halo cyan au survol,
    // remplace le `hover:opacity-90` plat. Jamais le bleu CTA --acc ici
    // (non-confusabilité §21.5). HoverGlowLift gère reduced-motion + forced-colors.
    <HoverGlowLift tone="cy" className="rounded-card block">
      <Link
        href={href}
        className="rounded-card block focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--cy)]"
      >
        <TrainingTradeCard trade={trade} timezone={timezone} />
        {unseenAnnotationsCount > 0 ? (
          <div className="mt-1.5 flex justify-end">
            <Pill tone="cy" dot="live">
              {unseenAnnotationsCount} correction{unseenAnnotationsCount > 1 ? 's' : ''} non lue
              {unseenAnnotationsCount > 1 ? 's' : ''}
            </Pill>
          </div>
        ) : null}
      </Link>
    </HoverGlowLift>
  );
}
