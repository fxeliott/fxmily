'use client';

import { motion, useReducedMotion } from 'framer-motion';
import type { MonthlyAggregate } from '@/lib/metrics';

interface MonthlyHeatmapProps {
  data: readonly MonthlyAggregate[];
  odsSummaries?: readonly { month: number; label: string; percent: number }[];
  year?: number;
  /** Mois pivot (1..12). Les cellules >= pivotMonth sont marquées "live" avec
   *  un ring accent subtle. */
  pivotMonth?: number;
}

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
] as const;

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
] as const;

const FR_PCT = new Intl.NumberFormat('fr-FR', {
  signDisplay: 'always',
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
});

/**
 * Heatmap mensuel T1 ultra-minimal — drop des couleurs saturées (vert flashy
 * + rouge vif). Pivot vers échelle de surface neutre + texte tone-coded :
 *
 *  - Cellule : `--surface` base, fond `--accent-soft` modulé pour gains,
 *    fond `--negative-soft` modulé pour pertes (très désaturé)
 *  - Chiffre : `--positive` muted vert pour gain, `--negative` muted rouge
 *    pour perte, `--text-muted` pour 0 ou null
 *  - Hairline border 1px true-HEX (pas opacity)
 *  - Pas d'effet hover lift, juste opacity color shift
 *
 * Specs ui-designer §10 + Eliot doctrine "pertes même prégnance que gains"
 * → les pertes restent VISIBLES (couleur muted) mais sans saturation cheap.
 */
function tintFor(percent: number): { bg: string; text: string } {
  if (percent === 0) {
    return { bg: 'transparent', text: 'var(--text-muted)' };
  }
  if (percent > 0) {
    const intensity = Math.min(1, percent / 60);
    const alpha = 0.06 + intensity * 0.18;
    return { bg: `rgba(124, 184, 124, ${alpha.toFixed(3)})`, text: 'var(--positive)' };
  }
  const intensity = Math.min(1, Math.abs(percent) / 30);
  const alpha = 0.06 + intensity * 0.18;
  return { bg: `rgba(200, 124, 124, ${alpha.toFixed(3)})`, text: 'var(--negative)' };
}

export function MonthlyHeatmap({ data, odsSummaries, year, pivotMonth }: MonthlyHeatmapProps) {
  const reduced = useReducedMotion();
  const byMonth = new Map<number, number>();
  if (odsSummaries) {
    for (const s of odsSummaries) byMonth.set(s.month, s.percent);
  } else {
    for (const a of data) byMonth.set(a.monthNum, a.totalPercent);
  }
  const cells: Array<{
    monthNum: number;
    label: string;
    longLabel: string;
    percent: number | null;
  }> = [];
  for (let m = 1; m <= 12; m += 1) {
    cells.push({
      monthNum: m,
      label: MONTH_LABELS_SHORT_FR[m - 1]!,
      longLabel: MONTH_LABELS_LONG_FR[m - 1]!,
      percent: byMonth.has(m) ? byMonth.get(m)! : null,
    });
  }

  return (
    <ul
      role="list"
      aria-label={`Performance mensuelle${year ? ' ' + year : ''}`}
      className="m-0 grid list-none grid-cols-3 gap-2 p-0 sm:grid-cols-4 sm:gap-3 lg:grid-cols-6"
    >
      {cells.map((c, idx) => {
        const ariaYear = year ? ' ' + year : '';
        const isLive = pivotMonth !== undefined && c.monthNum >= pivotMonth;
        const liveRingClass = isLive ? 'ring-1 ring-[var(--accent-edge)] ring-offset-0' : '';
        if (c.percent === null) {
          return (
            <li
              key={c.monthNum}
              role="listitem"
              className={`relative flex aspect-square flex-col items-center justify-center rounded-xl border border-dashed border-[var(--border)] ${liveRingClass}`}
              aria-label={`${c.longLabel}${ariaYear} : pas de donnée${isLive ? ' (live)' : ''}`}
            >
              {isLive && (
                <span
                  aria-hidden
                  className="absolute top-2 right-2 h-1.5 w-1.5 rounded-full"
                  style={{ background: 'var(--accent)' }}
                />
              )}
              <span aria-hidden className="t-caption">
                {c.label}
              </span>
              <span aria-hidden className="num mt-1 text-[11px] text-[var(--text-subtle)]">
                —
              </span>
            </li>
          );
        }
        const tint = tintFor(c.percent);
        const ariaLabel = `${c.longLabel}${ariaYear} : ${FR_PCT.format(c.percent)} %${isLive ? ' (live)' : ''}`;
        const motionProps = reduced
          ? {}
          : {
              initial: { opacity: 0, y: 4 },
              animate: { opacity: 1, y: 0 },
            };
        return (
          <motion.li
            key={c.monthNum}
            role="listitem"
            {...motionProps}
            transition={{
              duration: 0.4,
              delay: idx * 0.04,
              ease: [0.22, 1, 0.36, 1],
            }}
            className={`relative flex aspect-square flex-col items-center justify-center rounded-xl border border-[var(--border)] ${liveRingClass}`}
            style={{ background: tint.bg }}
            aria-label={ariaLabel}
          >
            {isLive && (
              <span
                aria-hidden
                className="absolute top-2 right-2 h-1.5 w-1.5 rounded-full"
                style={{ background: 'var(--accent)' }}
              />
            )}
            <span aria-hidden className="t-caption">
              {c.label}
            </span>
            <span
              aria-hidden
              className="num mt-1.5 text-[15px] leading-none font-medium"
              style={{ color: tint.text }}
            >
              {FR_PCT.format(c.percent)} %
            </span>
          </motion.li>
        );
      })}
    </ul>
  );
}
