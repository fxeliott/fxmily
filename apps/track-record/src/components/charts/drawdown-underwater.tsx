'use client';

import { useMemo } from 'react';
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
} from 'recharts';
import { motion, useReducedMotion } from 'framer-motion';
import type { EquityPoint } from '@/lib/metrics';
import { formatPercent } from '@/lib/format';

interface DrawdownUnderwaterProps {
  data: readonly EquityPoint[];
  height?: number;
  /** Ordinal pivot historique/live — ReferenceLine verticale subtle. */
  pivotOrdinal?: number;
  className?: string;
  ariaCaption?: string;
}

/**
 * Drawdown underwater chart T2 — resilience visible.
 * Pattern Bridgewater : pertes affichées avec EXACTEMENT la même intensité
 * visuelle que les gains. Underwater = (cumPercent - peakCumPercent), ≤ 0.
 *
 * Palette T1 : `--negative` (#c87c7c desaturé) → JAMAIS le rouge flashy
 * Bootstrap #ef4444. Gradient fill subtle pour donner l'aspect "sous l'eau".
 */
export function DrawdownUnderwater({
  data,
  height = 220,
  pivotOrdinal,
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

  const figMotion = reduced ? {} : { initial: { opacity: 0, y: 8 }, animate: { opacity: 1, y: 0 } };
  return (
    <motion.figure
      role="img"
      aria-label={summary}
      {...figMotion}
      transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
      className={`relative m-0 ${className}`}
      style={{ height }}
    >
      <figcaption className="sr-only">{summary}</figcaption>
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={series} margin={{ top: 8, right: 12, bottom: 8, left: 4 }}>
          <defs>
            <linearGradient id="tr-dd-fill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#C87C7C" stopOpacity={0} />
              <stop offset="100%" stopColor="#C87C7C" stopOpacity={0.32} />
            </linearGradient>
          </defs>
          <XAxis
            dataKey="ordinal"
            type="number"
            domain={[
              'dataMin',
              pivotOrdinal !== undefined ? (dataMax: number) => dataMax + 8 : 'dataMax',
            ]}
            tick={{ fontSize: 11, fill: '#5A5A63' }}
            tickLine={false}
            axisLine={false}
            hide
          />
          <YAxis
            tick={{ fontSize: 11, fill: '#5A5A63' }}
            tickLine={false}
            axisLine={false}
            domain={[min * 1.1, 0]}
            tickFormatter={(v) => `${v}%`}
            width={48}
          />
          <ReferenceLine y={0} stroke="#1F1F23" strokeDasharray="0" />
          {pivotOrdinal !== undefined && (
            <ReferenceLine
              x={pivotOrdinal}
              stroke="#5B8DEF"
              strokeDasharray="3 4"
              strokeOpacity={0.55}
            />
          )}
          <Tooltip
            contentStyle={{
              background: '#17171B',
              border: '1px solid #1F1F23',
              borderRadius: 12,
              fontSize: 12,
              color: '#EDEDEF',
              boxShadow: 'none',
              padding: '8px 12px',
            }}
            labelStyle={{ color: '#8A8A93', fontWeight: 500, marginBottom: 2 }}
            itemStyle={{ color: '#C87C7C', padding: 0 }}
            cursor={{ stroke: '#2A2A30', strokeWidth: 1 }}
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
            stroke="#C87C7C"
            strokeWidth={1.5}
            fill="url(#tr-dd-fill)"
            isAnimationActive={!reduced}
            animationDuration={1300}
            animationEasing="ease-out"
            dot={false}
            activeDot={{ r: 4, fill: '#C87C7C', stroke: '#0A0A0B', strokeWidth: 2 }}
          />
        </AreaChart>
      </ResponsiveContainer>
    </motion.figure>
  );
}
