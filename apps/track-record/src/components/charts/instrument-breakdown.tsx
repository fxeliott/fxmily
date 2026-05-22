'use client';

import { motion, useReducedMotion } from 'framer-motion';
import type { InstrumentAggregate } from '@/lib/metrics';
import { formatCount, formatR, formatWinrate } from '@/lib/format';

interface InstrumentBreakdownProps {
  data: readonly InstrumentAggregate[];
  limit?: number;
}

/** Top-N instrument breakdown — bar horizontal style, tabular-nums + tone-coded. */
export function InstrumentBreakdown({ data, limit = 8 }: InstrumentBreakdownProps) {
  const reduced = useReducedMotion();
  const top = data.slice(0, limit);
  if (!top.length) return null;
  const maxCount = Math.max(...top.map((d) => d.count));

  return (
    <ul className="divide-y divide-[var(--tr-b-subtle)]">
      {top.map((d, idx) => {
        const pct = maxCount > 0 ? (d.count / maxCount) * 100 : 0;
        const isPositive = d.totalR > 0;
        const liMotion = reduced
          ? {}
          : { initial: { opacity: 0, x: -8 }, whileInView: { opacity: 1, x: 0 } };
        return (
          <motion.li
            key={d.instrument}
            {...liMotion}
            viewport={{ once: true, amount: 0.5 }}
            transition={{ duration: 0.4, delay: idx * 0.05, ease: [0.22, 1, 0.36, 1] }}
            className="relative flex items-center justify-between gap-4 px-4 py-3"
          >
            <div
              aria-hidden
              className="absolute inset-y-0 left-0 -z-10 rounded-r-sm"
              style={{
                width: `${pct}%`,
                background: isPositive
                  ? 'linear-gradient(90deg, rgba(62,174,32,0.06), rgba(62,174,32,0.14))'
                  : 'linear-gradient(90deg, rgba(244,107,125,0.06), rgba(244,107,125,0.12))',
                transition: 'width 0.5s ease-out',
              }}
            />
            <span
              className="font-mono text-[13px] font-semibold tracking-[0.04em] text-[var(--tr-t-1)] uppercase tabular-nums"
              style={{ letterSpacing: '0.04em' }}
            >
              {d.instrument}
            </span>
            <div className="flex items-center gap-5 font-mono text-[12px] tabular-nums">
              <span className="text-[var(--tr-t-3)]">{formatCount(d.count)} trades</span>
              <span className="text-[var(--tr-t-2)]">WR {formatWinrate(d.winrate)}</span>
              <span
                className="w-16 text-right font-semibold"
                style={{
                  color: isPositive
                    ? 'var(--tr-gain)'
                    : d.totalR < 0
                      ? 'var(--tr-loss)'
                      : 'var(--tr-t-3)',
                }}
              >
                {formatR(d.totalR)}
              </span>
            </div>
          </motion.li>
        );
      })}
    </ul>
  );
}
