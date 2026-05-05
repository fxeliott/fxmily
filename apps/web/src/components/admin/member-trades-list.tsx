import Link from 'next/link';

import { SESSION_LABEL } from '@/lib/trading/sessions';
import type { SerializedTrade } from '@/lib/trades/service';

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
}

/**
 * Trades list for the admin member detail (J3, SPEC §7.7).
 *
 * Each row links to `/admin/members/[id]/trades/[tradeId]` — the admin-scoped
 * detail page that uses the same `<TradeDetailView />` as the member-side
 * `/journal/[id]`. Same data, same UX, just a different back link and
 * (J4) annotation footer.
 */
export function MemberTradesList({ memberId, trades }: MemberTradesListProps) {
  if (trades.length === 0) {
    return (
      <div className="bg-card flex flex-col items-center gap-2 rounded-lg border border-[var(--border)] px-6 py-10 text-center">
        <p className="text-foreground text-sm">Ce membre n&apos;a encore loggué aucun trade.</p>
        <p className="text-muted text-xs">
          Les trades apparaîtront ici dès qu&apos;il aura utilisé le journal.
        </p>
      </div>
    );
  }

  return (
    <ul className="flex flex-col gap-2">
      {trades.map((trade) => {
        const realized = trade.realizedR ? Number(trade.realizedR) : null;
        const tone =
          realized === null
            ? 'text-muted'
            : realized > 0
              ? 'text-success'
              : realized < 0
                ? 'text-danger'
                : 'text-muted';
        return (
          <li key={trade.id}>
            <Link
              href={`/admin/members/${memberId}/trades/${trade.id}`}
              className="bg-card hover:border-accent focus-visible:outline-accent flex flex-col gap-2 rounded-lg border border-[var(--border)] p-3 transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 sm:flex-row sm:items-center sm:justify-between"
              aria-label={`Voir le trade ${trade.pair} ${trade.direction}`}
            >
              <div className="flex min-w-0 items-center gap-3">
                <span className="text-foreground font-mono text-sm font-semibold">
                  {trade.pair}
                </span>
                <span
                  className={[
                    'inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-medium',
                    trade.direction === 'long'
                      ? 'border-success/40 text-success'
                      : 'border-danger/40 text-danger',
                  ].join(' ')}
                >
                  {trade.direction === 'long' ? 'Long' : 'Short'}
                </span>
                {!trade.isClosed ? (
                  <span className="border-warning/40 text-warning inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-medium">
                    Ouvert
                  </span>
                ) : null}
                <span className="text-muted truncate text-xs">
                  {DATETIME_FMT.format(new Date(trade.enteredAt))} · {SESSION_LABEL[trade.session]}
                </span>
              </div>

              <div className="flex items-center gap-4 text-xs">
                <span className="text-muted font-mono tabular-nums">
                  {NUMBER_FMT.format(Number(trade.entryPrice))}
                </span>
                {realized !== null ? (
                  <span className={['font-mono font-semibold tabular-nums', tone].join(' ')}>
                    {realized > 0 ? '+' : ''}
                    {realized.toFixed(2)}R
                  </span>
                ) : (
                  <span className="text-muted">—</span>
                )}
              </div>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
