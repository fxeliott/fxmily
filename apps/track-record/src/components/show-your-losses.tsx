'use client';

import { motion, useReducedMotion } from 'framer-motion';
import type { RawTrade } from '@/lib/metrics';
import { formatR, formatDateIso } from '@/lib/format';

interface ShowYourLossesProps {
  bestTrades: readonly RawTrade[];
  worstTrades: readonly RawTrade[];
}

/**
 * "Show your losses" honesty module — affiche les 5 pires trades avec la même
 * mise en avant que les 5 meilleurs. Pattern Bridgewater (radical transparency).
 *
 * Anti-pattern combattu : pertes en opacité réduite, taille de police plus petite.
 * Discipline ici : 2 colonnes parfaitement symétriques, mêmes proportions.
 */
export function ShowYourLosses({ bestTrades, worstTrades }: ShowYourLossesProps) {
  const reduced = useReducedMotion();

  return (
    <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
      <Column
        title="Pires trades"
        subtitle="Affichés avec la même prégnance que les meilleurs"
        accent="loss"
        trades={worstTrades}
        reduced={!!reduced}
      />
      <Column
        title="Meilleurs trades"
        subtitle="Conviction haute, exécution propre"
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
  const tone = accent === 'gain' ? 'var(--tr-gain)' : 'var(--tr-loss)';
  const sectionMotion = reduced
    ? {}
    : { initial: { opacity: 0, y: 12 }, whileInView: { opacity: 1, y: 0 } };
  return (
    <motion.section
      {...sectionMotion}
      viewport={{ once: true, amount: 0.3 }}
      transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
      className="overflow-hidden rounded-xl border border-[var(--tr-b-default)] bg-[var(--tr-bg-1)]"
    >
      <div className="border-b border-[var(--tr-b-subtle)] px-5 py-4">
        <div className="flex items-center gap-2">
          <span
            aria-hidden
            className="inline-block h-2 w-2 rounded-full"
            style={{ background: tone, boxShadow: `0 0 8px ${tone}` }}
          />
          <h3 className="text-base font-semibold tracking-tight text-[var(--tr-t-1)]">{title}</h3>
        </div>
        <p className="mt-1 text-xs text-[var(--tr-t-3)]">{subtitle}</p>
      </div>
      <ul className="divide-y divide-[var(--tr-b-subtle)]">
        {trades.map((t, idx) => {
          const r = t.resultR ?? 0;
          const date = typeof t.enteredAt === 'string' ? new Date(t.enteredAt) : t.enteredAt;
          const liMotion = reduced
            ? {}
            : {
                initial: { opacity: 0, x: accent === 'loss' ? -6 : 6 },
                whileInView: { opacity: 1, x: 0 },
              };
          return (
            <motion.li
              key={`${accent}-${t.ordinal}`}
              {...liMotion}
              viewport={{ once: true, amount: 0.5 }}
              transition={{ duration: 0.35, delay: idx * 0.06, ease: [0.22, 1, 0.36, 1] }}
              className="flex items-center justify-between gap-4 px-5 py-3"
            >
              <div className="flex min-w-0 items-center gap-3">
                <span className="w-7 shrink-0 font-mono text-[11px] text-[var(--tr-t-3)] tabular-nums">
                  #{t.ordinal}
                </span>
                <div className="min-w-0">
                  <div className="truncate font-mono text-[13px] font-semibold tracking-[0.04em] text-[var(--tr-t-1)] uppercase">
                    {t.instrument}
                  </div>
                  <div className="mt-0.5 font-mono text-[11px] text-[var(--tr-t-3)] tabular-nums">
                    {formatDateIso(date)}
                  </div>
                </div>
              </div>
              <span
                className="font-mono text-base font-semibold tracking-tight tabular-nums"
                style={{ color: tone }}
              >
                {formatR(r)}
              </span>
            </motion.li>
          );
        })}
        {trades.length === 0 && (
          <li className="px-5 py-6 text-xs text-[var(--tr-t-3)] italic">
            Aucun trade dans cette catégorie.
          </li>
        )}
      </ul>
    </motion.section>
  );
}
