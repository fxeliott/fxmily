import Link from 'next/link';

import { btnVariants } from '@/components/ui/btn';
import { HoverLift } from '@/components/ui/hover-lift';
import { Pill } from '@/components/ui/pill';
import { SESSION_LABEL } from '@/lib/trading/sessions';
import type { SerializedTrade } from '@/lib/trades/service';
import { cn } from '@/lib/utils';

const DATETIME_FMT = new Intl.DateTimeFormat('fr-FR', {
  day: '2-digit',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit',
});

const NUMBER_FMT = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 5 });

interface MemberTradesListProps {
  memberId: string;
  trades: SerializedTrade[];
  /** Cursor pagination — id of the next page, or null on the last page. */
  nextCursor?: string | null;
  /** The cursor that produced THIS page (undefined on page 1). */
  cursor?: string | undefined;
  /** Member's total trade count (open + closed) — kills the truncation illusion. */
  total?: number;
}

/** Build the admin trades-tab href, optionally carrying a pagination cursor.
 *  The cursor is always a real Prisma id we emitted (`nextCursor`); forged
 *  values are rejected upstream by `parseCursor` on the page. */
function adminTradesHref(memberId: string, cursor?: string | null): string {
  const params = new URLSearchParams({ tab: 'trades' });
  if (cursor) params.set('cursor', cursor);
  return `/admin/members/${memberId}?${params.toString()}`;
}

/**
 * Trades list for the admin member detail (J3, SPEC §7.7 — cursor-paginated S7).
 *
 * Each row links to `/admin/members/[id]/trades/[tradeId]` — the admin-scoped
 * detail page that uses the same `<TradeDetailView />` as the member-side
 * `/journal/[id]`. Same data, same UX, just a different back link and
 * (J4) annotation footer.
 *
 * S7: the list pages through the member's FULL history (mirror of `/journal`)
 * so the admin can reach EVERY trade to comment it. The footer carries the
 * "Voir les trades plus anciens" cursor link + a total so the admin never
 * mistakes a truncated page for the whole history.
 */
export function MemberTradesList({
  memberId,
  trades,
  nextCursor = null,
  cursor,
  total,
}: MemberTradesListProps) {
  if (trades.length === 0) {
    // Stale cursor (a trade was deleted since the link was rendered) — calm
    // dead-end, never the "this member has no trades" copy.
    if (cursor) {
      return (
        <div className="rounded-card flex flex-col items-center gap-2 border border-[var(--b-default)] bg-[var(--bg-1)] px-6 py-10 text-center">
          <p className="text-sm text-[var(--t-1)]">Fin de la liste.</p>
          <Link
            href={adminTradesHref(memberId)}
            className="text-xs text-[var(--acc-hi)] underline hover:text-[var(--acc)]"
          >
            Revenir au début
          </Link>
        </div>
      );
    }
    return (
      <div className="rounded-card flex flex-col items-center gap-2 border border-[var(--b-default)] bg-[var(--bg-1)] px-6 py-10 text-center">
        <p className="text-sm text-[var(--t-1)]">Ce membre n&apos;a encore loggué aucun trade.</p>
        <p className="t-cap text-[var(--t-3)]">
          Les trades apparaîtront ici dès qu&apos;il aura utilisé le journal.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <ul className="flex flex-col gap-2">
        {trades.map((trade) => {
          const realized = trade.realizedR ? Number(trade.realizedR) : null;
          const tone =
            realized === null
              ? 'text-[var(--t-3)]'
              : realized > 0
                ? 'text-[var(--ok)]'
                : realized < 0
                  ? 'text-[var(--bad)]'
                  : 'text-[var(--t-3)]';
          return (
            <li key={trade.id}>
              <HoverLift className="block">
                <Link
                  href={`/admin/members/${memberId}/trades/${trade.id}`}
                  className="rounded-card flex flex-col gap-2 border border-[var(--b-default)] bg-[var(--bg-1)] p-3 shadow-[var(--sh-card)] transition-colors hover:border-[var(--b-acc)] hover:bg-[var(--bg-2)] sm:flex-row sm:items-center sm:justify-between"
                  aria-label={`Voir le trade ${trade.pair} ${trade.direction}`}
                >
                  <div className="flex min-w-0 items-center gap-3">
                    <span className="f-mono text-sm font-semibold text-[var(--t-1)]">
                      {trade.pair}
                    </span>
                    <Pill tone={trade.direction === 'long' ? 'ok' : 'bad'}>
                      {trade.direction === 'long' ? 'Long' : 'Short'}
                    </Pill>
                    {!trade.isClosed ? (
                      <Pill tone="warn" dot="live">
                        Ouvert
                      </Pill>
                    ) : null}
                    <span className="t-cap truncate text-[var(--t-3)]">
                      {DATETIME_FMT.format(new Date(trade.enteredAt))} ·{' '}
                      {SESSION_LABEL[trade.session]}
                    </span>
                  </div>

                  <div className="flex items-center gap-4 text-xs">
                    <span className="f-mono text-[var(--t-3)] tabular-nums">
                      {NUMBER_FMT.format(Number(trade.entryPrice))}
                    </span>
                    {realized !== null ? (
                      <span className={['f-mono font-semibold tabular-nums', tone].join(' ')}>
                        {realized > 0 ? '+' : ''}
                        {realized.toFixed(2)}R
                      </span>
                    ) : (
                      <span className="text-[var(--t-3)]">-</span>
                    )}
                  </div>
                </Link>
              </HoverLift>
            </li>
          );
        })}
      </ul>

      {/* Pagination + total — mirror of /journal, kills the truncation illusion. */}
      <footer className="flex flex-col items-center gap-3 border-t border-[var(--b-subtle)] pt-4">
        {nextCursor ? (
          <Link
            href={adminTradesHref(memberId, nextCursor)}
            prefetch={false}
            className={cn(btnVariants({ kind: 'ghost', size: 'm' }))}
          >
            Voir les trades plus anciens
          </Link>
        ) : null}
        <p className="t-foot text-center text-[var(--t-4)]">
          Affichage de {trades.length} trade{trades.length > 1 ? 's' : ''}
          {typeof total === 'number' ? (
            <>
              {' '}
              · <span className="font-mono tabular-nums">{total} au total</span>
            </>
          ) : null}
          {cursor ? (
            <>
              {' · '}
              <Link href={adminTradesHref(memberId)} className="underline hover:text-[var(--t-2)]">
                revenir au début
              </Link>
            </>
          ) : null}
        </p>
      </footer>
    </div>
  );
}
