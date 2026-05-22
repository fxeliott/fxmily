'use client';

import { useMemo, useState } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import type { RawTrade } from '@/lib/metrics';

interface TradesTableProps {
  trades: readonly RawTrade[];
  initialVisible?: number;
  className?: string;
}

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
 * Trades table T1 minimal — hairlines 1px uniquement, pas de cards autour,
 * pas de filter tabs (ui-designer §10 : « tabs = visual noise pour minimal
 * premium »). 4 colonnes seulement (Date · Instrument · Risque · Résultat),
 * le sens long/short est implicite (badge discret), le statut Gain/Perte
 * passe en couleur du chiffre.
 *
 * Si l'utilisateur veut voir tous les 139 trades, bouton textuel discret
 * (link-style, pas pill CTA).
 */
export function TradesTable({ trades, initialVisible = 12, className = '' }: TradesTableProps) {
  const reduced = useReducedMotion();
  const [visible, setVisible] = useState(initialVisible);
  const sliced = useMemo(() => trades.slice(0, visible), [trades, visible]);
  const hasMore = trades.length > visible;
  const motionProps = reduced
    ? {}
    : { initial: { opacity: 0, y: 4 }, animate: { opacity: 1, y: 0 } };

  return (
    <div className={className} role="region" aria-label="Liste des trades">
      <div
        role="grid"
        aria-rowcount={trades.length + 1}
        className="border-t border-[var(--border)]"
      >
        {/* Header */}
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
              transition={{ duration: 0.35, delay: Math.min(idx * 0.015, 0.3), ease: 'easeOut' }}
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
                  <span className="t-micro ml-2 align-middle text-[var(--text-subtle)]">
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
      </div>

      {hasMore && (
        <div className="mt-6 flex items-center justify-between border-t border-[var(--border)] pt-5">
          <span className="t-micro">
            {Math.min(visible, trades.length)} sur {trades.length}
          </span>
          <button
            type="button"
            onClick={() => setVisible((v) => Math.min(v + 30, trades.length))}
            className="t-body text-[var(--text-muted)] transition-colors hover:text-[var(--text)]"
          >
            Voir plus →
          </button>
        </div>
      )}
    </div>
  );
}
