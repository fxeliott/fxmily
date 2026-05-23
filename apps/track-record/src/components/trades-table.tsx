'use client';

import { useMemo, useState } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import type { RawTrade } from '@/lib/metrics';
import { cn } from '@/lib/utils';
import { LivePulse } from './live-pulse';

interface TradesTableProps {
  trades: readonly RawTrade[];
  initialVisible?: number;
  /** Optional pivot caption to insert as inline row after the last visible
   *  historical trade — only when mode === 'all' and the full historical
   *  set has been revealed. */
  pivotCaption?: string;
  pivotDate?: string;
  className?: string;
}

type FilterMode = 'all' | 'gains' | 'losses' | 'be';

const FR_PCT = new Intl.NumberFormat('fr-FR', {
  signDisplay: 'always',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const FR_DATE_SHORT = new Intl.DateTimeFormat('fr-FR', {
  day: '2-digit',
  month: 'short',
  year: '2-digit',
});

/**
 * Trades table T2 — hairlines + 4 filter buttons (Tous / Gains / Pertes / BE).
 *
 * Pattern WCAG 2.2 AA :
 *  - Filter buttons : `aria-pressed` au lieu de tabs (T2.1 finding ui-designer)
 *  - role="grid" + role="row" + role="cell" + role="columnheader"
 *  - 4 colonnes (Date · Instrument · Risque · Résultat), direction implicite
 *    via badge discret
 *  - "Voir plus →" link-style (pas pill CTA)
 */
export function TradesTable({
  trades,
  initialVisible = 12,
  pivotCaption,
  pivotDate,
  className = '',
}: TradesTableProps) {
  const reduced = useReducedMotion();
  const [mode, setMode] = useState<FilterMode>('all');
  const [visible, setVisible] = useState(initialVisible);

  const filtered = useMemo(() => {
    if (mode === 'all') return trades;
    return trades.filter((t) => {
      const r = t.resultR ?? 0;
      const isBe = t.status === 'break_even' || r === 0;
      if (mode === 'gains') return !isBe && r > 0;
      if (mode === 'losses') return !isBe && r < 0;
      if (mode === 'be') return isBe;
      return true;
    });
  }, [trades, mode]);

  const sliced = useMemo(() => filtered.slice(0, visible), [filtered, visible]);
  const hasMore = filtered.length > visible;

  const counts = useMemo(() => {
    let g = 0;
    let l = 0;
    let b = 0;
    for (const t of trades) {
      const r = t.resultR ?? 0;
      if (t.status === 'break_even' || r === 0) b += 1;
      else if (r > 0) g += 1;
      else l += 1;
    }
    return { all: trades.length, gains: g, losses: l, be: b };
  }, [trades]);

  const motionProps = reduced
    ? {}
    : { initial: { opacity: 0, y: 4 }, animate: { opacity: 1, y: 0 } };

  const filters: Array<{ key: FilterMode; label: string; count: number }> = [
    { key: 'all', label: 'Tous', count: counts.all },
    { key: 'gains', label: 'Gains', count: counts.gains },
    { key: 'losses', label: 'Pertes', count: counts.losses },
    { key: 'be', label: 'Break-even', count: counts.be },
  ];

  return (
    <div className={className} role="region" aria-label="Liste des trades">
      {/* Filter buttons row */}
      <div role="toolbar" aria-label="Filtrer les trades" className="mb-6 flex flex-wrap gap-2">
        {filters.map((f) => {
          const active = mode === f.key;
          return (
            <button
              key={f.key}
              type="button"
              aria-pressed={active}
              onClick={() => {
                setMode(f.key);
                setVisible(initialVisible);
              }}
              className={cn(
                't-caption inline-flex items-center gap-2 rounded-full border px-3.5 py-1.5 transition-colors',
                active
                  ? 'border-[var(--accent-edge)] bg-[var(--accent-soft)] text-[var(--accent)]'
                  : 'border-[var(--border)] bg-transparent text-[var(--text-muted)] hover:border-[var(--border-strong)] hover:text-[var(--text)]',
              )}
            >
              <span>{f.label}</span>
              <span
                className="num tabular-nums"
                style={{
                  color: active ? 'var(--accent)' : 'var(--text-subtle)',
                  fontFeatureSettings: '"tnum"',
                }}
              >
                {f.count}
              </span>
            </button>
          );
        })}
      </div>

      <div
        role="grid"
        aria-rowcount={filtered.length + 1}
        className="border-t border-[var(--border)]"
      >
        {/* Header (desktop only) */}
        <div
          role="row"
          className="t-caption hidden grid-cols-[80px_1fr_88px_88px] gap-4 py-3 text-[var(--text-subtle)] sm:grid"
        >
          <span role="columnheader">Date</span>
          <span role="columnheader">Instrument</span>
          <span role="columnheader" className="text-right">
            Risque
          </span>
          <span role="columnheader" className="text-right">
            Résultat
          </span>
        </div>

        {sliced.map((t, idx) => {
          const r = t.resultR ?? 0;
          const isBe = t.status === 'break_even' || r === 0;
          const isWin = !isBe && r > 0;
          const date = typeof t.enteredAt === 'string' ? new Date(t.enteredAt) : t.enteredAt;
          const resultColor = isBe
            ? 'var(--text-muted)'
            : isWin
              ? 'var(--positive)'
              : 'var(--negative)';
          return (
            <motion.div
              key={`${t.ordinal}-${idx}`}
              role="row"
              {...motionProps}
              transition={{
                duration: 0.35,
                delay: Math.min(idx * 0.015, 0.3),
                ease: 'easeOut',
              }}
              className="grid grid-cols-2 items-baseline gap-4 border-t border-[var(--border)] py-3 sm:grid-cols-[80px_1fr_88px_88px]"
            >
              <span role="cell" className="num t-body text-[var(--text-muted)] sm:text-[13px]">
                {FR_DATE_SHORT.format(date)}
              </span>
              <span
                role="cell"
                className="t-body col-span-1 font-medium tracking-tight text-[var(--text)] sm:col-span-1"
              >
                {t.instrument}
                {t.direction && (
                  <span
                    aria-label={t.direction === 'long' ? 'achat' : 'vente'}
                    className="t-micro ml-2 align-middle text-[var(--text-subtle)]"
                  >
                    {t.direction === 'long' ? '↗' : '↘'}
                  </span>
                )}
              </span>
              <span
                role="cell"
                className="num t-body text-right text-[var(--text-muted)] sm:text-[13px]"
              >
                {t.riskPercent.toFixed(2)} %
              </span>
              <span
                role="cell"
                className="num t-body text-right font-medium sm:text-[13px]"
                style={{ color: resultColor }}
              >
                {t.resultPercent !== null ? FR_PCT.format(t.resultPercent) + ' %' : '—'}
              </span>
            </motion.div>
          );
        })}

        {sliced.length === 0 && (
          <div role="row" className="border-t border-[var(--border)] py-8">
            <p className="t-body text-center text-[var(--text-muted)]">
              Aucun trade dans cette catégorie.
            </p>
          </div>
        )}

        {/* Pivot inline row — visible only when 'all' mode + fully revealed */}
        {pivotCaption &&
          mode === 'all' &&
          filtered.length === trades.length &&
          visible >= filtered.length && (
            <div
              role="row"
              className="relative my-6 border-t border-dashed border-[var(--accent-edge)] pt-6"
            >
              <span
                className="absolute top-0 left-1/2 -translate-x-1/2 -translate-y-1/2 bg-[var(--bg)] px-3"
                style={{ color: 'var(--accent)' }}
              >
                <span
                  className="t-caption inline-flex items-center gap-2"
                  style={{ fontSize: 9, letterSpacing: '0.16em' }}
                >
                  <LivePulse size={6} color="var(--accent)" />
                  PIVOT{pivotDate ? ` · ${pivotDate}` : ''}
                </span>
              </span>
              <p className="t-body mt-2 text-center text-[var(--text-muted)]">{pivotCaption}</p>
            </div>
          )}
      </div>

      {hasMore && (
        <div className="mt-6 flex items-center justify-between border-t border-[var(--border)] pt-5">
          <span className="t-micro">
            {Math.min(visible, filtered.length)} sur {filtered.length}
          </span>
          <button
            type="button"
            onClick={() => setVisible((v) => Math.min(v + 30, filtered.length))}
            className="t-body text-[var(--text-muted)] transition-colors hover:text-[var(--text)]"
          >
            Voir plus →
          </button>
        </div>
      )}
    </div>
  );
}
