'use client';

import { useMemo, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import type { RawTrade } from '@/lib/metrics';
import { formatR, formatPercent, formatDateIso } from '@/lib/format';

interface TradesTableProps {
  trades: readonly RawTrade[];
  /** Initial visible count. The "Voir plus" button reveals 50 more at a time. */
  initialVisible?: number;
}

type FilterId = 'all' | 'wins' | 'losses' | 'be';

const FILTERS: { id: FilterId; label: string }[] = [
  { id: 'all', label: 'Tous' },
  { id: 'wins', label: 'Gains' },
  { id: 'losses', label: 'Pertes' },
  { id: 'be', label: 'Break-even' },
];

/**
 * Trades table — public, lecture seule.
 * - Filter pills with `layoutId` underline (FLIP — research motion subagent).
 * - Tabular-nums + monospace partout.
 * - Pertes affichées avec MÊME prégnance que gains (pattern Bridgewater).
 * - Bouton "Voir plus" stagger reveal, JAMAIS paginer (track record = défile).
 */
export function TradesTable({ trades, initialVisible = 25 }: TradesTableProps) {
  const reduced = useReducedMotion();
  const [filter, setFilter] = useState<FilterId>('all');
  const [visible, setVisible] = useState(initialVisible);

  const filtered = useMemo(() => {
    if (filter === 'all') return trades;
    return trades.filter((t) => {
      const r = t.resultR ?? 0;
      if (filter === 'wins') return r > 0;
      if (filter === 'losses') return r < 0;
      if (filter === 'be') return t.status === 'break_even' || r === 0;
      return true;
    });
  }, [trades, filter]);

  const counts = useMemo(() => {
    let wins = 0;
    let losses = 0;
    let be = 0;
    for (const t of trades) {
      const r = t.resultR ?? 0;
      if (t.status === 'break_even' || r === 0) be += 1;
      else if (r > 0) wins += 1;
      else if (r < 0) losses += 1;
    }
    return { wins, losses, be, all: trades.length };
  }, [trades]);

  const sliceVisible = filtered.slice(0, visible);
  const hasMore = filtered.length > visible;

  return (
    <div className="overflow-hidden rounded-xl border border-[var(--tr-b-default)] bg-[var(--tr-bg-1)]">
      {/* Filter toggle group — code-review a11y T2.1 fix : tabs ARIA pattern
       * requires roving tabindex + arrow keys + aria-controls. Toggle buttons
       * (role=group + aria-pressed) is the simpler conformant alternative. */}
      <div
        role="group"
        aria-label="Filtre par résultat"
        className="flex items-center gap-1 border-b border-[var(--tr-b-subtle)] px-4 sm:px-5"
      >
        {FILTERS.map((f) => {
          const active = filter === f.id;
          const count =
            f.id === 'all'
              ? counts.all
              : f.id === 'wins'
                ? counts.wins
                : f.id === 'losses'
                  ? counts.losses
                  : counts.be;
          return (
            <button
              key={f.id}
              type="button"
              aria-pressed={active}
              onClick={() => {
                setFilter(f.id);
                setVisible(initialVisible);
              }}
              className="relative px-3.5 py-3.5 text-[13px] font-medium tracking-tight transition-colors"
              style={{ color: active ? 'var(--tr-t-1)' : 'var(--tr-t-3)' }}
            >
              <span>{f.label}</span>
              <span aria-hidden className="ml-1.5 font-mono text-[11px] tabular-nums opacity-60">
                {count}
              </span>
              <span className="sr-only">
                {' '}
                ({count} {count > 1 ? 'trades' : 'trade'})
              </span>
              {active && (
                <motion.span
                  layoutId="tr-table-underline"
                  className="absolute inset-x-3.5 -bottom-px h-[2px] rounded-full"
                  style={{ background: 'var(--tr-acc)' }}
                  transition={{ type: 'spring', stiffness: 380, damping: 30 }}
                />
              )}
            </button>
          );
        })}
      </div>

      <div role="table" aria-label="Trades historiques">
        {/* Header — code-review a11y T3.1 fix : role="columnheader" on each span. */}
        <div
          role="row"
          className="hidden grid-cols-[64px_88px_1fr_88px_88px_88px_72px] gap-3 border-b border-[var(--tr-b-subtle)] bg-[var(--tr-bg)] px-5 py-2.5 text-[10px] font-medium tracking-[0.08em] text-[var(--tr-t-3)] uppercase sm:grid"
        >
          <span role="columnheader">#</span>
          <span role="columnheader">Date</span>
          <span role="columnheader">Instrument</span>
          <span role="columnheader" className="text-right">
            Risque
          </span>
          <span role="columnheader" className="text-right">
            R
          </span>
          <span role="columnheader" className="text-right">
            Résultat
          </span>
          <span role="columnheader" className="text-right">
            Statut
          </span>
        </div>

        <AnimatePresence initial={false} mode="popLayout">
          {sliceVisible.map((t, idx) => {
            const r = t.resultR ?? 0;
            const isBe = t.status === 'break_even' || r === 0;
            const isWin = !isBe && r > 0;
            const isLoss = !isBe && r < 0;
            const date = typeof t.enteredAt === 'string' ? new Date(t.enteredAt) : t.enteredAt;
            const rowMotion = reduced
              ? { initial: false as const }
              : {
                  initial: { opacity: 0, y: 6 },
                  exit: { opacity: 0, y: -6 },
                };
            return (
              <motion.div
                key={`${t.ordinal}-${t.instrument}-${idx}`}
                role="row"
                layout
                {...rowMotion}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
                className="grid grid-cols-2 gap-3 border-b border-[var(--tr-b-subtle)] px-5 py-3 text-[13px] transition-colors last:border-b-0 hover:bg-[var(--tr-bg-2)] sm:grid-cols-[64px_88px_1fr_88px_88px_88px_72px]"
              >
                <span role="cell" className="font-mono text-[var(--tr-t-3)] tabular-nums">
                  {t.ordinal}
                </span>
                <span
                  role="cell"
                  className="font-mono text-xs text-[var(--tr-t-2)] tabular-nums sm:text-[13px]"
                >
                  {formatDateIso(date)}
                </span>
                <span
                  role="cell"
                  className="col-span-2 font-mono font-semibold tracking-[0.04em] text-[var(--tr-t-1)] uppercase sm:col-span-1"
                >
                  {t.instrument}
                  {t.direction && (
                    <span
                      className="ml-2 inline-flex items-center rounded px-1.5 py-0.5 align-middle text-[10px] font-medium tracking-[0.06em] uppercase"
                      style={{
                        background:
                          t.direction === 'long' ? 'var(--tr-gain-bg)' : 'var(--tr-loss-bg)',
                        color: t.direction === 'long' ? 'var(--tr-gain)' : 'var(--tr-loss)',
                        border: `1px solid ${t.direction === 'long' ? 'var(--tr-gain-border)' : 'var(--tr-loss-border)'}`,
                      }}
                    >
                      {t.direction === 'long' ? '↗ Long' : '↘ Short'}
                    </span>
                  )}
                </span>
                <span
                  role="cell"
                  className="text-right font-mono text-[var(--tr-t-2)] tabular-nums"
                >
                  {t.riskPercent.toFixed(2)} %
                </span>
                <span
                  role="cell"
                  className={`text-right font-mono font-semibold tabular-nums ${
                    isLoss
                      ? 'text-[var(--tr-loss)]'
                      : isWin
                        ? 'text-[var(--tr-gain)]'
                        : 'text-[var(--tr-t-3)]'
                  }`}
                >
                  {formatR(r)}
                </span>
                <span
                  role="cell"
                  className={`text-right font-mono font-semibold tabular-nums ${
                    isLoss
                      ? 'text-[var(--tr-loss)]'
                      : isWin
                        ? 'text-[var(--tr-gain)]'
                        : 'text-[var(--tr-t-3)]'
                  }`}
                >
                  {t.resultPercent !== null
                    ? formatPercent(t.resultPercent, { signed: true })
                    : '—'}
                </span>
                <span
                  role="cell"
                  className="text-right text-[10px] font-medium tracking-[0.08em] text-[var(--tr-t-3)] uppercase"
                >
                  {isBe ? 'BE' : isWin ? 'Gain' : 'Perte'}
                </span>
              </motion.div>
            );
          })}
        </AnimatePresence>
      </div>

      {hasMore && (
        <div className="flex items-center justify-between border-t border-[var(--tr-b-subtle)] bg-[var(--tr-bg)] px-5 py-4">
          <span className="font-mono text-[12px] text-[var(--tr-t-3)] tabular-nums">
            {Math.min(visible, filtered.length)} / {filtered.length}
          </span>
          <button
            onClick={() => setVisible((v) => v + 50)}
            className="inline-flex h-9 items-center rounded-lg border border-[var(--tr-b-default)] bg-[var(--tr-bg-1)] px-4 text-[13px] font-medium text-[var(--tr-t-1)] transition hover:border-[color-mix(in_oklab,var(--tr-acc),transparent_50%)] hover:bg-[var(--tr-bg-2)]"
          >
            Voir 50 de plus
          </button>
        </div>
      )}
    </div>
  );
}
