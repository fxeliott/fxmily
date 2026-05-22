'use client';

import { motion, useReducedMotion } from 'framer-motion';
import type { MonthlyAggregate } from '@/lib/metrics';
import { formatPercent } from '@/lib/format';

interface MonthlyHeatmapProps {
  data: readonly MonthlyAggregate[];
  /** Optional verbatim source-of-truth values (ODS author monthly summaries). */
  odsSummaries?: readonly { month: number; label: string; percent: number }[];
  /** Year displayed in the SR-only aria-labels (defaults to current). */
  year?: number;
}

const MONTH_LABELS_LONG_FR = [
  'Janvier',
  'Février',
  'Mars',
  'Avril',
  'Mai',
  'Juin',
  'Juillet',
  'Août',
  'Septembre',
  'Octobre',
  'Novembre',
  'Décembre',
];

/**
 * Monthly heatmap — calendar grid (4 × 3) avec cellules tone-coded.
 *
 * Convention couleur :
 *   gain hue `#3EAE20` intensifiée selon ampleur (clamp [0, 60]%)
 *   loss hue `#F46B7D` intensifiée selon ampleur (clamp [-30, 0]%)
 *   BE / 0% : `--tr-t-3` muted
 *
 * Patterns sourcés research subagent 2026-05-21 (Bridgewater public reports,
 * Mercury accent dosage discipline).
 */
const MONTH_LABELS_SHORT_FR = [
  'Jan',
  'Fév',
  'Mar',
  'Avr',
  'Mai',
  'Juin',
  'Juil',
  'Août',
  'Sept',
  'Oct',
  'Nov',
  'Déc',
];

function colorForPercent(pct: number): {
  bg: string;
  border: string;
  tone: 'gain' | 'loss' | 'neutral';
} {
  if (pct === 0) {
    return { bg: 'rgba(140,153,173,0.08)', border: 'rgba(140,153,173,0.18)', tone: 'neutral' };
  }
  if (pct > 0) {
    const intensity = Math.min(1, pct / 60); // clamp at 60%
    const alpha = 0.15 + intensity * 0.55;
    return {
      bg: `rgba(62, 174, 32, ${alpha.toFixed(3)})`,
      border: `rgba(62, 174, 32, ${(alpha + 0.2).toFixed(3)})`,
      tone: 'gain',
    };
  }
  const intensity = Math.min(1, Math.abs(pct) / 30);
  const alpha = 0.18 + intensity * 0.5;
  return {
    bg: `rgba(244, 107, 125, ${alpha.toFixed(3)})`,
    border: `rgba(244, 107, 125, ${(alpha + 0.2).toFixed(3)})`,
    tone: 'loss',
  };
}

export function MonthlyHeatmap({ data, odsSummaries, year }: MonthlyHeatmapProps) {
  const reduced = useReducedMotion();
  // Use ODS verbatim if provided (source-of-truth), else derived aggregates.
  const byMonth = new Map<number, number>();
  if (odsSummaries) {
    for (const s of odsSummaries) byMonth.set(s.month, s.percent);
  } else {
    for (const a of data) byMonth.set(a.monthNum, a.totalPercent);
  }
  const cells: Array<{ monthNum: number; label: string; percent: number | null }> = [];
  for (let m = 1; m <= 12; m += 1) {
    cells.push({
      monthNum: m,
      label: MONTH_LABELS_SHORT_FR[m - 1]!,
      percent: byMonth.has(m) ? byMonth.get(m)! : null,
    });
  }

  return (
    <ul
      role="list"
      aria-label={`Performances mensuelles${year ? ' ' + year : ''}`}
      className="grid list-none grid-cols-4 gap-2.5 p-0 sm:gap-3"
    >
      {cells.map((c, idx) => {
        const longLabel = MONTH_LABELS_LONG_FR[c.monthNum - 1] ?? c.label ?? '?';
        if (c.percent === null) {
          return (
            <li
              key={c.monthNum}
              role="listitem"
              className="flex aspect-square flex-col items-center justify-center rounded-lg border border-dashed"
              style={{ borderColor: 'rgba(255,255,255,0.06)' }}
              aria-label={`${longLabel}${year ? ' ' + year : ''} : aucune donnée`}
            >
              <span
                aria-hidden
                className="text-[11px] tracking-[0.06em] text-[var(--tr-t-3)] uppercase opacity-60"
              >
                {c.label}
              </span>
              <span aria-hidden className="mt-1 text-[10px] text-[var(--tr-t-3)] opacity-50">
                N/A
              </span>
            </li>
          );
        }
        const colors = colorForPercent(c.percent);
        const ariaLabel = `${longLabel}${year ? ' ' + year : ''} : performance ${formatPercent(c.percent, { signed: true })}`;
        const cellMotion = reduced
          ? {}
          : {
              initial: { opacity: 0, scale: 0.94 },
              whileInView: { opacity: 1, scale: 1 },
              whileHover: { y: -2 },
            };
        return (
          <motion.li
            key={c.monthNum}
            role="listitem"
            {...cellMotion}
            viewport={{ once: true, amount: 0.4 }}
            transition={{ duration: 0.45, delay: idx * 0.04, ease: [0.22, 1, 0.36, 1] }}
            className="flex aspect-square cursor-default flex-col items-center justify-center rounded-lg border px-2"
            style={{ background: colors.bg, borderColor: colors.border }}
            aria-label={ariaLabel}
          >
            <span
              aria-hidden
              className="text-[10px] font-medium tracking-[0.08em] text-[var(--tr-t-3)] uppercase"
            >
              {c.label}
            </span>
            <span
              aria-hidden
              className="mt-1.5 font-mono text-[15px] leading-none font-semibold tabular-nums sm:text-base"
              style={{
                color:
                  colors.tone === 'loss'
                    ? '#FCA9B5'
                    : colors.tone === 'gain'
                      ? '#A4E6A1'
                      : 'var(--tr-t-2)',
              }}
            >
              {formatPercent(c.percent, { signed: true })}
            </span>
          </motion.li>
        );
      })}
    </ul>
  );
}
