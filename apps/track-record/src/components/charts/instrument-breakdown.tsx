'use client';

import { motion, useReducedMotion } from 'framer-motion';
import type { InstrumentAggregate } from '@/lib/metrics';
import { formatCount, formatR, formatWinrate } from '@/lib/format';

interface InstrumentBreakdownProps {
  data: readonly InstrumentAggregate[];
  limit?: number;
}

/**
 * Top-N instrument breakdown T2 — bar horizontale style.
 * Palette T1 desaturée : positive/negative muted, hairline borders.
 */
export function InstrumentBreakdown({ data, limit = 8 }: InstrumentBreakdownProps) {
  const reduced = useReducedMotion();
  const top = data.slice(0, limit);
  if (!top.length) return null;
  const maxCount = Math.max(...top.map((d) => d.count));

  return (
    <ul className="divide-y divide-[var(--border)]">
      {top.map((d, idx) => {
        const pct = maxCount > 0 ? (d.count / maxCount) * 100 : 0;
        const isPositive = d.totalR > 0;
        const liMotion = reduced
          ? {}
          : { initial: { opacity: 0, x: -6 }, animate: { opacity: 1, x: 0 } };
        const barColor = isPositive
          ? 'rgba(124, 184, 124, 0.10)'
          : d.totalR < 0
            ? 'rgba(200, 124, 124, 0.10)'
            : 'rgba(91, 141, 239, 0.06)';
        const textColor = isPositive
          ? 'var(--positive)'
          : d.totalR < 0
            ? 'var(--negative)'
            : 'var(--text-subtle)';
        return (
          <motion.li
            key={d.instrument}
            {...liMotion}
            transition={{ duration: 0.4, delay: idx * 0.04, ease: [0.22, 1, 0.36, 1] }}
            className="relative flex items-center justify-between gap-4 px-4 py-3"
          >
            <div
              aria-hidden
              className="absolute inset-y-0 left-0 -z-10 rounded-r-sm"
              style={{
                width: `${pct}%`,
                background: barColor,
                transition: 'width 0.5s ease-out',
              }}
            />
            <span className="t-body font-medium tracking-tight text-[var(--text)]">
              {d.instrument}
            </span>
            <div className="num flex items-center gap-5 text-[12px] tabular-nums">
              <span className="text-[var(--text-subtle)]">{formatCount(d.count)} trades</span>
              <span className="text-[var(--text-muted)]">WR {formatWinrate(d.winrate)}</span>
              <span className="w-16 text-right font-medium" style={{ color: textColor }}>
                {formatR(d.totalR)}
              </span>
            </div>
          </motion.li>
        );
      })}
    </ul>
  );
}
