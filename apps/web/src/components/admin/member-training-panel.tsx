import { GraduationCap } from 'lucide-react';
import Link from 'next/link';

import { TrainingTradeCard } from '@/components/training/training-trade-card';
import { btnVariants } from '@/components/ui/btn';
import { Card } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { Pill } from '@/components/ui/pill';
import type { SerializedTrainingTrade } from '@/lib/training/training-trade-service';
import { cn } from '@/lib/utils';

/**
 * Backtests list for the admin member detail (J-T3 — carbon mirror of
 * `member-trades-list.tsx`, cursor-paginated S7). Each row links to
 * `/admin/members/[id]/training/[trainingTradeId]` — the admin-scoped
 * backtest detail that reuses the same `<TrainingTradeCard />` the member
 * sees (same data, same UX, different back link + annotation footer).
 *
 * S7: the list pages through the member's FULL backtest history (mirror of
 * `member-trades-list`) so the admin can reach EVERY backtest to correct it.
 * The footer carries the "Voir les backtests plus anciens" cursor link + a
 * total so a truncated page is never mistaken for the whole history.
 *
 * 🚨 STATISTICAL ISOLATION (§21.5): consumes `SerializedTrainingTrade` only;
 * the link stays on the `/admin/members/[id]/training/*` surface — never a
 * real-edge `/trades/*` route, and the pagination links carry `tab=training`.
 * Premium DS-v2 reuse (TrainingTradeCard + the shared `EmptyState`), cyan
 * `--cy` accent so the admin never confuses it with the real-trade list.
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

/** Build the admin training-tab href, optionally carrying a pagination cursor.
 *  The cursor is always a real Prisma id we emitted (`nextCursor`); forged
 *  values are rejected upstream by `parseCursor` on the page. */
function adminTrainingHref(memberId: string, cursor?: string | null): string {
  const params = new URLSearchParams({ tab: 'training' });
  if (cursor) params.set('cursor', cursor);
  return `/admin/members/${memberId}?${params.toString()}`;
}

export function MemberTrainingPanel({
  memberId,
  trades,
  correctionsCount,
  nextCursor = null,
  cursor,
  total,
}: {
  memberId: string;
  trades: SerializedTrainingTrade[];
  /** trainingTradeId → total corrections (S8 audit d2). Absent key = 0 → the
   * backtest still needs a correction ("À corriger"). */
  correctionsCount?: Map<string, number> | undefined;
  /** Cursor pagination — id of the next page, or null on the last page. */
  nextCursor?: string | null;
  /** The cursor that produced THIS page (undefined on page 1). */
  cursor?: string | undefined;
  /** Member's total backtest count — kills the truncation illusion. */
  total?: number;
}) {
  if (trades.length === 0) {
    // Stale cursor (a backtest was deleted since the link was rendered) — calm
    // dead-end, never the "this member has no backtest" copy.
    if (cursor) {
      return (
        <Card primary className="flex flex-col items-center gap-2 py-10 text-center">
          <p className="text-sm text-[var(--t-1)]">Fin de la liste.</p>
          <Link
            href={adminTrainingHref(memberId)}
            className="text-xs text-[var(--cy)] underline hover:opacity-80"
          >
            Revenir au début
          </Link>
        </Card>
      );
    }
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
    <div className="flex flex-col gap-4">
      <ul className="flex flex-col gap-3">
        {trades.map((trade) => {
          const corrections = correctionsCount?.get(trade.id) ?? 0;
          return (
            <li key={trade.id}>
              <Link
                href={`/admin/members/${memberId}/training/${trade.id}`}
                aria-label={`Corriger le backtest ${trade.pair} du ${DATE_FMT.format(new Date(trade.enteredAt))} · ${
                  corrections === 0
                    ? 'aucune correction'
                    : `${corrections} correction${corrections > 1 ? 's' : ''}`
                }`}
                className="rounded-card block transition-opacity hover:opacity-90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--cy)]"
              >
                <TrainingTradeCard trade={trade} />
                {correctionsCount ? (
                  <div className="mt-1.5 flex justify-end">
                    {corrections === 0 ? (
                      <Pill tone="warn" dot>
                        À corriger
                      </Pill>
                    ) : (
                      <Pill tone="cy">
                        {corrections} correction{corrections > 1 ? 's' : ''}
                      </Pill>
                    )}
                  </div>
                ) : null}
              </Link>
            </li>
          );
        })}
      </ul>

      {/* Pagination + total — mirror of the real-trade list, kills the
          truncation illusion so the admin knows EVERY backtest is reachable. */}
      <footer className="flex flex-col items-center gap-3 border-t border-[var(--b-subtle)] pt-4">
        {nextCursor ? (
          <Link
            href={adminTrainingHref(memberId, nextCursor)}
            prefetch={false}
            className={cn(btnVariants({ kind: 'ghost', size: 'm' }))}
          >
            Voir les backtests plus anciens
          </Link>
        ) : null}
        <p className="t-foot text-center text-[var(--t-4)]">
          Affichage de {trades.length} backtest{trades.length > 1 ? 's' : ''}
          {typeof total === 'number' ? (
            <>
              {' '}
              · <span className="font-mono tabular-nums">{total} au total</span>
            </>
          ) : null}
          {cursor ? (
            <>
              {' · '}
              <Link
                href={adminTrainingHref(memberId)}
                className="underline hover:text-[var(--t-2)]"
              >
                revenir au début
              </Link>
            </>
          ) : null}
        </p>
      </footer>
    </div>
  );
}
