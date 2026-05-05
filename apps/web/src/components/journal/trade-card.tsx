import Link from 'next/link';

import type { SerializedTrade } from '@/lib/trades/service';
import { SESSION_LABEL } from '@/lib/trading/sessions';

interface TradeCardProps {
  trade: SerializedTrade;
}

const NUMBER_FMT = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 5 });
const DATETIME_FMT = new Intl.DateTimeFormat('fr-FR', {
  day: '2-digit',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit',
});

const OUTCOME_LABEL: Record<NonNullable<SerializedTrade['outcome']>, string> = {
  win: 'Gain',
  loss: 'Perte',
  break_even: 'BE',
};

const OUTCOME_TONE: Record<NonNullable<SerializedTrade['outcome']>, string> = {
  win: 'border-success/30 bg-success/10 text-success',
  loss: 'border-danger/30 bg-danger/10 text-danger',
  break_even: 'border-[var(--border)] bg-secondary/40 text-muted',
};

export function TradeCard({ trade }: TradeCardProps) {
  const isClosed = trade.isClosed;
  const realizedRNumber = trade.realizedR ? Number(trade.realizedR) : null;
  return (
    <Link
      href={`/journal/${trade.id}`}
      className="bg-card hover:border-accent focus-visible:outline-accent group flex flex-col gap-3 rounded-lg border border-[var(--border)] p-4 transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
      aria-label={`Trade ${trade.pair} ${trade.direction} du ${DATETIME_FMT.format(new Date(trade.enteredAt))}`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex flex-col gap-0.5">
          <div className="flex items-center gap-2">
            <span className="text-foreground font-mono text-base font-semibold tracking-wide">
              {trade.pair}
            </span>
            <span
              className={[
                'inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium',
                trade.direction === 'long'
                  ? 'border-success/40 text-success'
                  : 'border-danger/40 text-danger',
              ].join(' ')}
            >
              {trade.direction === 'long' ? 'Long' : 'Short'}
            </span>
            {!isClosed ? (
              <span className="border-warning/40 text-warning inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium">
                Ouvert
              </span>
            ) : null}
          </div>
          <span className="text-muted text-xs">
            {DATETIME_FMT.format(new Date(trade.enteredAt))} · {SESSION_LABEL[trade.session]}
          </span>
        </div>

        {isClosed && trade.outcome ? (
          <div className="flex flex-col items-end gap-1 text-right">
            <span
              className={[
                'inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium',
                OUTCOME_TONE[trade.outcome],
              ].join(' ')}
            >
              {OUTCOME_LABEL[trade.outcome]}
            </span>
            {realizedRNumber !== null ? (
              <span
                className={[
                  'font-mono text-base font-semibold tabular-nums',
                  realizedRNumber > 0
                    ? 'text-success'
                    : realizedRNumber < 0
                      ? 'text-danger'
                      : 'text-muted',
                ].join(' ')}
              >
                {realizedRNumber > 0 ? '+' : ''}
                {realizedRNumber.toFixed(2)}R
              </span>
            ) : null}
            {trade.realizedRSource === 'estimated' ? (
              <span className="text-muted text-[10px] uppercase tracking-wider">Estimé</span>
            ) : null}
          </div>
        ) : null}
      </div>

      <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs sm:grid-cols-4">
        <div className="flex min-w-0 flex-col">
          <dt className="text-muted">Entrée</dt>
          <dd className="text-foreground truncate font-mono tabular-nums">
            {NUMBER_FMT.format(Number(trade.entryPrice))}
          </dd>
        </div>
        <div className="flex min-w-0 flex-col">
          <dt className="text-muted">Lot</dt>
          <dd className="text-foreground truncate font-mono tabular-nums">
            {NUMBER_FMT.format(Number(trade.lotSize))}
          </dd>
        </div>
        <div className="flex min-w-0 flex-col">
          <dt className="text-muted">R:R prévu</dt>
          <dd className="text-foreground truncate font-mono tabular-nums">
            {Number(trade.plannedRR).toFixed(2)}
          </dd>
        </div>
        <div className="flex flex-col">
          <dt className="text-muted">Plan</dt>
          <dd
            className={trade.planRespected ? 'text-success' : 'text-danger'}
            aria-label={trade.planRespected ? 'Plan respecté' : 'Plan non respecté'}
          >
            <span aria-hidden="true">{trade.planRespected ? '✓' : '✗'}</span>
          </dd>
        </div>
      </dl>
    </Link>
  );
}
