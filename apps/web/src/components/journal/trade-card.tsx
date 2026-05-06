import { Check, ChevronRight, MessageSquare, TrendingDown, TrendingUp, X } from 'lucide-react';
import Link from 'next/link';

import { Card } from '@/components/ui/card';
import { Pill } from '@/components/ui/pill';
import type { SerializedTrade } from '@/lib/trades/service';
import { SESSION_LABEL } from '@/lib/trading/sessions';
import { cn } from '@/lib/utils';

interface TradeCardProps {
  trade: SerializedTrade;
  /** J4 — number of admin annotations the member hasn't opened yet. Drives
   * the "Nouvelle correction" pill in the top row. Pass 0 (default) to hide. */
  unseenAnnotationsCount?: number;
}

const NUMBER_FMT = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 5 });
const DATETIME_FMT = new Intl.DateTimeFormat('fr-FR', {
  day: '2-digit',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit',
});

const OUTCOME_LABEL: Record<NonNullable<SerializedTrade['outcome']>, string> = {
  win: 'GAIN',
  loss: 'PERTE',
  break_even: 'BE',
};

const OUTCOME_TONE: Record<NonNullable<SerializedTrade['outcome']>, 'ok' | 'bad' | 'mute'> = {
  win: 'ok',
  loss: 'bad',
  break_even: 'mute',
};

/**
 * TradeCard — row dense premium pour `/journal` liste + admin member trades.
 *
 * Structure 3-cell : barre status couleur (left edge) + content + R-réalisé.
 * Hover row-hover (slide-in lime 2px left edge, 120ms). Card interactive.
 *
 * Sémantique long=ok (vert) / short=bad (rouge) préservée. Lime reste signal
 * système (CTAs, accents), pas signal financier. R-réalisé en JetBrains Mono
 * tabular-nums avec drop-shadow lime/red selon outcome.
 */
export function TradeCard({ trade, unseenAnnotationsCount = 0 }: TradeCardProps) {
  const isClosed = trade.isClosed;
  const realizedRNumber = trade.realizedR ? Number(trade.realizedR) : null;
  const isWin = realizedRNumber !== null && realizedRNumber > 0;
  const isLoss = realizedRNumber !== null && realizedRNumber < 0;
  const hasUnseen = unseenAnnotationsCount > 0;

  const statusBarColor = isClosed
    ? isWin
      ? 'bg-[var(--ok)]'
      : isLoss
        ? 'bg-[var(--bad)]'
        : 'bg-[var(--t-4)]'
    : 'bg-[var(--warn)]';

  return (
    <Link
      href={`/journal/${trade.id}`}
      aria-label={`Trade ${trade.pair} ${trade.direction} du ${DATETIME_FMT.format(new Date(trade.enteredAt))}`}
      className="block"
    >
      <Card interactive className="row-hover relative overflow-hidden p-0">
        <div className="grid grid-cols-[3px_1fr_auto] items-stretch gap-0">
          {/* Status bar left edge */}
          <div
            aria-hidden
            className={cn('h-full w-[3px]', statusBarColor, !isClosed && 'live-dot')}
          />

          {/* Main content */}
          <div className="flex min-w-0 flex-col gap-2.5 p-4">
            {/* Top row : pair + direction + open pill */}
            <div className="flex flex-wrap items-center gap-2">
              <span className="f-mono text-[15px] font-semibold tracking-[0.01em] text-[var(--t-1)]">
                {trade.pair}
              </span>
              <Pill tone={trade.direction === 'long' ? 'ok' : 'bad'}>
                {trade.direction === 'long' ? (
                  <TrendingUp className="h-2.5 w-2.5" strokeWidth={2} />
                ) : (
                  <TrendingDown className="h-2.5 w-2.5" strokeWidth={2} />
                )}
                {trade.direction === 'long' ? 'LONG' : 'SHORT'}
              </Pill>
              {!isClosed ? (
                <Pill tone="warn" dot="live">
                  EN COURS
                </Pill>
              ) : null}
              {isClosed && trade.outcome ? (
                <Pill tone={OUTCOME_TONE[trade.outcome]}>{OUTCOME_LABEL[trade.outcome]}</Pill>
              ) : null}
              {hasUnseen ? (
                <Pill tone="acc" dot="live">
                  <MessageSquare className="h-2.5 w-2.5" strokeWidth={2} />
                  {unseenAnnotationsCount === 1
                    ? '1 nouvelle correction'
                    : `${unseenAnnotationsCount} nouvelles corrections`}
                </Pill>
              ) : null}
            </div>

            {/* Meta row : timestamp + session */}
            <span className="font-mono text-[11px] tabular-nums text-[var(--t-3)]">
              {DATETIME_FMT.format(new Date(trade.enteredAt))}
              <span className="mx-1.5 text-[var(--t-4)]">·</span>
              {SESSION_LABEL[trade.session]}
            </span>

            {/* Stats grid 4-col */}
            <dl className="grid grid-cols-2 gap-x-4 gap-y-1 pt-1 text-[11px] sm:grid-cols-4">
              <Stat label="Entrée" value={NUMBER_FMT.format(Number(trade.entryPrice))} mono />
              <Stat label="Lot" value={NUMBER_FMT.format(Number(trade.lotSize))} mono />
              <Stat label="R:R prévu" value={Number(trade.plannedRR).toFixed(2)} mono />
              <Stat
                label="Plan"
                value={
                  <span
                    className={cn(
                      'inline-flex items-center gap-1',
                      trade.planRespected ? 'text-[var(--ok)]' : 'text-[var(--bad)]',
                    )}
                    aria-label={trade.planRespected ? 'Plan respecté' : 'Plan non respecté'}
                  >
                    {trade.planRespected ? (
                      <Check className="h-3 w-3" strokeWidth={2.5} />
                    ) : (
                      <X className="h-3 w-3" strokeWidth={2.5} />
                    )}
                    {trade.planRespected ? 'OK' : 'rompu'}
                  </span>
                }
              />
            </dl>
          </div>

          {/* R réalisé hero (right cell) */}
          <div className="flex shrink-0 flex-col items-end justify-center gap-1 px-4 py-4 sm:min-w-[110px]">
            {isClosed && realizedRNumber !== null ? (
              <>
                <span
                  className={cn(
                    'f-mono text-[20px] font-semibold tabular-nums leading-none tracking-[-0.02em]',
                    isWin ? 'text-[var(--ok)]' : isLoss ? 'text-[var(--bad)]' : 'text-[var(--t-3)]',
                  )}
                  style={
                    isWin
                      ? {
                          filter: 'drop-shadow(0 0 8px oklch(0.804 0.181 145 / 0.32))',
                        }
                      : isLoss
                        ? {
                            filter: 'drop-shadow(0 0 8px oklch(0.7 0.165 22 / 0.28))',
                          }
                        : undefined
                  }
                >
                  {realizedRNumber > 0 ? '+' : ''}
                  {realizedRNumber.toFixed(2)}R
                </span>
                {trade.realizedRSource === 'estimated' ? (
                  <span className="t-mono-cap text-[var(--t-4)]">estimé</span>
                ) : null}
              </>
            ) : (
              <span className="f-mono text-[16px] font-medium leading-none text-[var(--t-4)]">
                —
              </span>
            )}
            <ChevronRight
              className="mt-1 h-3.5 w-3.5 text-[var(--t-4)] transition-colors group-hover:text-[var(--t-2)]"
              strokeWidth={1.75}
            />
          </div>
        </div>
      </Card>
    </Link>
  );
}

function Stat({ label, value, mono }: { label: string; value: React.ReactNode; mono?: boolean }) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      <dt className="t-mono-cap text-[var(--t-4)]">{label}</dt>
      <dd className={cn('truncate text-[13px] text-[var(--t-1)]', mono && 'f-mono tabular-nums')}>
        {value}
      </dd>
    </div>
  );
}
