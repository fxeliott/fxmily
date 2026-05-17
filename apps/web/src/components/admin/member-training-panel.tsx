import { GraduationCap } from 'lucide-react';
import Link from 'next/link';

import { TrainingTradeCard } from '@/components/training/training-trade-card';
import { Card } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import type { SerializedTrainingTrade } from '@/lib/training/training-trade-service';

/**
 * Backtests list for the admin member detail (J-T3 — carbon mirror of
 * `member-trades-list.tsx`). Each row links to
 * `/admin/members/[id]/training/[trainingTradeId]` — the admin-scoped
 * backtest detail that reuses the same `<TrainingTradeCard />` the member
 * sees (same data, same UX, different back link + annotation footer).
 *
 * 🚨 STATISTICAL ISOLATION (§21.5): consumes `SerializedTrainingTrade` only;
 * the link stays on the `/admin/members/[id]/training/*` surface — never a
 * real-edge `/trades/*` route. Premium DS-v2 reuse (TrainingTradeCard + the
 * shared `EmptyState`), not the legacy admin token set.
 */

/** Hoisted, timezone-pinned — must match `TrainingTradeCard`'s own date
 * format so the SR `aria-label` date never disagrees with the visible card
 * near midnight (member-local civil day, Europe/Paris). */
const DATE_FMT = new Intl.DateTimeFormat('fr-FR', {
  timeZone: 'Europe/Paris',
  day: '2-digit',
  month: 'short',
  year: 'numeric',
});

export function MemberTrainingPanel({
  memberId,
  trades,
}: {
  memberId: string;
  trades: SerializedTrainingTrade[];
}) {
  if (trades.length === 0) {
    return (
      <Card primary className="py-2">
        <EmptyState
          icon={GraduationCap}
          headline="Aucun backtest pour ce membre."
          lead="Les backtests apparaîtront ici dès qu'il aura utilisé le mode entraînement."
        />
      </Card>
    );
  }

  return (
    <ul className="flex flex-col gap-3">
      {trades.map((trade) => (
        <li key={trade.id}>
          <Link
            href={`/admin/members/${memberId}/training/${trade.id}`}
            aria-label={`Voir le backtest ${trade.pair} du ${DATE_FMT.format(new Date(trade.enteredAt))}`}
            className="rounded-card block transition-opacity hover:opacity-90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--cy)]"
          >
            <TrainingTradeCard trade={trade} />
          </Link>
        </li>
      ))}
    </ul>
  );
}
