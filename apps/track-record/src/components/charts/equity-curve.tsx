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

interface EquityCurveProps {
  data: readonly EquityPoint[];
  height?: number;
  className?: string;
}

interface ChartDatum {
  ordinal: number;
  cumPercent: number;
  enteredAt: string;
}

const FR = new Intl.NumberFormat('fr-FR', {
  signDisplay: 'always',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/**
 * Courbe equity T1 ultra-minimal — UNE seule ligne fine, axes très light,
 * pas de gradient fill saturé, pas de glow filter. Le focal de la page est
 * le chiffre hero, pas le chart. Le chart confirme.
 *
 * Specs ui-designer §4 :
 *  - 1 ligne 1.5px en `--text` (off-white)
 *  - 1 point cardinal accent au dernier datapoint
 *  - Axes invisibles ou ultra-light (`--text-subtle`)
 *  - Pas de gradient fill multicouleur — gradient `--accent-soft` → transparent uniquement
 *  - Border-radius 16px, bg `--surface`, border 1px hairline
 */
export function EquityCurve({ data, height = 320, className = '' }: EquityCurveProps) {
  const reduced = useReducedMotion();
  const series: ChartDatum[] = useMemo(
    () =>
      data.map((p) => ({
        ordinal: p.ordinal,
        cumPercent: +p.cumPercent.toFixed(3),
        enteredAt: p.enteredAt.toISOString().slice(0, 10),
      })),
    [data],
  );

  const motionProps = reduced
    ? {}
    : { initial: { opacity: 0, y: 8 }, animate: { opacity: 1, y: 0 } };

  return (
    <motion.figure
      role="img"
      aria-label={`Performance cumulée sur ${series.length} trades`}
      {...motionProps}
      transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1], delay: 0.2 }}
      className={`m-0 overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-6 sm:p-8 ${className}`}
    >
      <div style={{ height }}>
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={series} margin={{ top: 12, right: 8, bottom: 4, left: 4 }}>
            <defs>
              <linearGradient id="tr-eq-fill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#5B8DEF" stopOpacity={0.12} />
                <stop offset="100%" stopColor="#5B8DEF" stopOpacity={0} />
              </linearGradient>
            </defs>
            <XAxis
              dataKey="ordinal"
              type="number"
              domain={['dataMin', 'dataMax']}
              tick={{ fontSize: 11, fill: '#5A5A63' }}
              tickLine={false}
              axisLine={false}
              hide
            />
            <YAxis
              tick={{ fontSize: 11, fill: '#5A5A63' }}
              tickLine={false}
              axisLine={false}
              tickFormatter={(v) => `${v}%`}
              width={48}
            />
            <ReferenceLine y={0} stroke="#1F1F23" strokeDasharray="0" />
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
              itemStyle={{ color: '#EDEDEF', padding: 0 }}
              cursor={{ stroke: '#2A2A30', strokeWidth: 1 }}
              formatter={(value) => [
                FR.format(typeof value === 'number' ? value : 0) + ' %',
                'Cumulé',
              ]}
              labelFormatter={(_label, payload) => {
                const first = Array.isArray(payload) && payload[0] ? payload[0].payload : undefined;
                return first?.enteredAt ?? '';
              }}
            />
            <Area
              type="monotone"
              dataKey="cumPercent"
              stroke="#EDEDEF"
              strokeWidth={1.5}
              fill="url(#tr-eq-fill)"
              isAnimationActive={!reduced}
              animationDuration={1400}
              animationEasing="ease-out"
              dot={false}
              activeDot={{ r: 4, fill: '#5B8DEF', stroke: '#0A0A0B', strokeWidth: 2 }}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </motion.figure>
  );
}
