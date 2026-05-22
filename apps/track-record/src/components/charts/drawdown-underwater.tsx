'use client';

import { useMemo } from 'react';
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
  ReferenceLine,
} from 'recharts';
import { motion, useReducedMotion } from 'framer-motion';
import type { EquityPoint } from '@/lib/metrics';
import { formatPercent } from '@/lib/format';

interface DrawdownUnderwaterProps {
  data: readonly EquityPoint[];
  height?: number;
  className?: string;
  ariaCaption?: string;
}

/**
 * Drawdown underwater chart — shows resilience.
 * Per Bridgewater pattern : pertes affichées avec la même mise en avant que
 * les gains. Underwater = (cumPercent - peakCumPercent), always ≤ 0.
 * Filled in `--tr-loss` rouge softer (#F46B7D) avec gradient to transparent
 * — JAMAIS le rouge pur de Bootstrap.
 */
export function DrawdownUnderwater({
  data,
  height = 220,
  className = '',
  ariaCaption,
}: DrawdownUnderwaterProps) {
  const reduced = useReducedMotion();
  const series = useMemo(
    () =>
      data.map((p) => ({
        ordinal: p.ordinal,
        underwater: +p.underwater.toFixed(3),
        enteredAt: p.enteredAt.toISOString().slice(0, 10),
      })),
    [data],
  );
  const min = Math.min(...series.map((s) => s.underwater), 0);

  const summary = useMemo(() => {
    if (ariaCaption) return ariaCaption;
    if (!data.length) return 'Aucune donnée drawdown disponible';
    let troughV = Infinity;
    let troughO = 0;
    for (const p of data) {
      if (p.underwater < troughV) {
        troughV = p.underwater;
        troughO = p.ordinal;
      }
    }
    return (
      `Diagramme underwater du drawdown sur ${data.length} trades. ` +
      `Point bas ${formatPercent(troughV, { signed: true })} atteint au trade ${troughO}.`
    );
  }, [data, ariaCaption]);

  const figMotion = reduced
    ? {}
    : { initial: { opacity: 0, y: 12 }, whileInView: { opacity: 1, y: 0 } };
  return (
    <motion.figure
      role="img"
      aria-label={summary}
      {...figMotion}
      viewport={{ once: true, amount: 0.2 }}
      transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
      className={`relative m-0 ${className}`}
      style={{ height }}
    >
      <figcaption className="sr-only">{summary}</figcaption>
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={series} margin={{ top: 8, right: 18, bottom: 8, left: -8 }}>
          <defs>
            <linearGradient id="tr-dd-fill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#F46B7D" stopOpacity={0} />
              <stop offset="40%" stopColor="#F46B7D" stopOpacity={0.18} />
              <stop offset="100%" stopColor="#F46B7D" stopOpacity={0.45} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 6" stroke="rgba(255,255,255,0.04)" vertical={false} />
          <XAxis
            dataKey="ordinal"
            type="number"
            domain={['dataMin', 'dataMax']}
            stroke="#8C99AD"
            tick={{ fontSize: 11, fontFamily: 'var(--tr-font-mono)', fill: '#8C99AD' }}
            tickLine={false}
            axisLine={false}
          />
          <YAxis
            stroke="#8C99AD"
            tick={{ fontSize: 11, fontFamily: 'var(--tr-font-mono)', fill: '#8C99AD' }}
            tickLine={false}
            axisLine={false}
            domain={[min * 1.1, 0]}
            tickFormatter={(v) => `${v}%`}
            width={56}
          />
          <ReferenceLine y={0} stroke="rgba(255,255,255,0.18)" strokeDasharray="2 4" />
          <Tooltip
            contentStyle={{
              background: '#14171D',
              border: '1px solid #2B3039',
              borderRadius: '8px',
              fontSize: '12px',
              fontFamily: 'var(--tr-font-mono)',
              boxShadow: '0 24px 64px rgba(0,0,0,0.65)',
            }}
            labelStyle={{ color: '#8C99AD' }}
            itemStyle={{ color: '#F46B7D' }}
            formatter={(v) => [
              formatPercent(typeof v === 'number' ? v : 0, { signed: true }),
              'Drawdown',
            ]}
            labelFormatter={(_l, payload) => {
              const first = Array.isArray(payload) && payload[0] ? payload[0].payload : undefined;
              return first?.enteredAt ?? '';
            }}
          />
          <Area
            type="monotone"
            dataKey="underwater"
            stroke="#F46B7D"
            strokeWidth={1.8}
            fill="url(#tr-dd-fill)"
            isAnimationActive={!reduced}
            animationDuration={1300}
            animationEasing="ease-out"
            dot={false}
            activeDot={{ r: 4, fill: '#F46B7D', stroke: '#FFFFFF', strokeWidth: 2 }}
          />
        </AreaChart>
      </ResponsiveContainer>
    </motion.figure>
  );
}
