'use client';

import { motion, useReducedMotion } from 'framer-motion';
import type { RawTrade } from '@/lib/metrics';
import { formatR, formatDateIso } from '@/lib/format';

interface ShowYourLossesProps {
  bestTrades: readonly RawTrade[];
  worstTrades: readonly RawTrade[];
}

/**
 * "Show your losses" honesty module T2 — pattern Bridgewater (radical transparency).
 * Affiche les 5 pires trades avec EXACTEMENT la même mise en avant que les 5 meilleurs.
 *
 * Anti-pattern combattu : pertes en opacity réduite, police plus petite.
 * Discipline : 2 colonnes parfaitement symétriques, mêmes proportions, mêmes tones.
 *
 * Adapté palette T1 : positive/negative desaturé, surface T1, hairline borders.
 */
export function ShowYourLosses({ bestTrades, worstTrades }: ShowYourLossesProps) {
  const reduced = useReducedMotion();

  return (
    <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
      <Column
        title="Pires trades"
        subtitle="Top 5 par R-multiple négatif"
        accent="loss"
        trades={worstTrades}
        reduced={!!reduced}
      />
      <Column
        title="Meilleurs trades"
        subtitle="Top 5 par R-multiple positif"
        accent="gain"
        trades={bestTrades}
        reduced={!!reduced}
      />
    </div>
  );
}

interface ColumnProps {
  title: string;
  subtitle: string;
  accent: 'gain' | 'loss';
  trades: readonly RawTrade[];
  reduced: boolean;
}

function Column({ title, subtitle, accent, trades, reduced }: ColumnProps) {
  const tone = accent === 'gain' ? 'var(--positive)' : 'var(--negative)';
  const sectionMotion = reduced
    ? {}
    : { initial: { opacity: 0, y: 12 }, animate: { opacity: 1, y: 0 } };
  return (
    <motion.section
      {...sectionMotion}
      transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
      className="overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--surface)]"
    >
      <div className="border-b border-[var(--border)] px-5 py-4">
        <div className="flex items-center gap-2.5">
          <span
            aria-hidden
            className="inline-block h-2 w-2 rounded-full"
            style={{ background: tone }}
          />
          <h3 className="t-body font-medium text-[var(--text)]">{title}</h3>
        </div>
        <p className="t-micro mt-1">{subtitle}</p>
      </div>
      <ul className="divide-y divide-[var(--border)]">
        {trades.map((t, idx) => {
          const r = t.resultR ?? 0;
          const date = typeof t.enteredAt === 'string' ? new Date(t.enteredAt) : t.enteredAt;
          const liMotion = reduced
            ? {}
            : {
                initial: { opacity: 0, x: accent === 'loss' ? -4 : 4 },
                animate: { opacity: 1, x: 0 },
              };
          return (
            <motion.li
              key={`${accent}-${t.ordinal}`}
              {...liMotion}
              transition={{ duration: 0.35, delay: idx * 0.05, ease: [0.22, 1, 0.36, 1] }}
              className="flex items-center justify-between gap-4 px-5 py-3"
            >
              <div className="flex min-w-0 items-center gap-3">
                <span className="num w-7 shrink-0 text-[11px] text-[var(--text-subtle)] tabular-nums">
                  #{t.ordinal}
                </span>
                <div className="min-w-0">
                  <div className="t-body truncate font-medium text-[var(--text)]">
                    {t.instrument}
                  </div>
                  <div className="num t-micro tabular-nums">{formatDateIso(date)}</div>
                </div>
              </div>
              <span className="num text-[15px] font-medium tabular-nums" style={{ color: tone }}>
                {formatR(r)}
              </span>
            </motion.li>
          );
        })}
        {trades.length === 0 && (
          <li className="t-micro px-5 py-6 italic">Aucun trade dans cette catégorie.</li>
        )}
      </ul>
    </motion.section>
  );
}
