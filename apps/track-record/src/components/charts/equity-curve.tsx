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
  ReferenceArea,
  ReferenceDot,
} from 'recharts';
import { motion, useReducedMotion } from 'framer-motion';
import type { EquityPoint } from '@/lib/metrics';

interface EquityCurveProps {
  data: readonly EquityPoint[];
  height?: number;
  /** Ordinal at which historical period ends and live period begins.
   *  Affiche une ReferenceLine verticale subtle. */
  pivotOrdinal?: number;
  className?: string;
}

interface ChartDatum {
  ordinal: number;
  cumPercent: number;
  enteredAt: string;
}

/** SVG-native pulse for last data point — pattern Gaurav Gupta.
 *  Pas de React re-renders : SMIL <animate> directement off-thread. */
function LastPointPulse(props: { cx?: number | undefined; cy?: number | undefined }) {
  const { cx = 0, cy = 0 } = props;
  return (
    <g>
      <circle cx={cx} cy={cy} r={4} fill="#5B8DEF" stroke="#0A0A0B" strokeWidth={1.5} />
      <circle cx={cx} cy={cy} r={4} fill="#5B8DEF" opacity={0.5}>
        <animate attributeName="r" from="4" to="14" dur="2s" repeatCount="indefinite" />
        <animate attributeName="opacity" from="0.5" to="0" dur="2s" repeatCount="indefinite" />
      </circle>
    </g>
  );
}

const FR = new Intl.NumberFormat('fr-FR', {
  signDisplay: 'always',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/**
 * Courbe equity T3 — signature lumineuse bleue + pivot ReferenceLine subtle.
 *
 * Evolutions vs T2 :
 *  - Optional `pivotOrdinal` prop → ReferenceLine verticale dashed accent à
 *    l'ordinal donné (marque la frontière historique/live)
 *  - Custom label "PIVOT" 10px tracked au-dessus de la ReferenceLine
 *  - Glow filter feGaussianBlur sur le stroke (signature lumineuse)
 *  - Gradient fill bleu signature 0.22 → 0
 */
export function EquityCurve({
  data,
  height = 360,
  pivotOrdinal,
  className = '',
}: EquityCurveProps) {
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
          <AreaChart data={series} margin={{ top: 24, right: 8, bottom: 4, left: 4 }}>
            <defs>
              <linearGradient id="tr-eq-fill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#5B8DEF" stopOpacity={0.22} />
                <stop offset="60%" stopColor="#5B8DEF" stopOpacity={0.05} />
                <stop offset="100%" stopColor="#5B8DEF" stopOpacity={0} />
              </linearGradient>
              <filter id="tr-eq-glow" x="-20%" y="-20%" width="140%" height="140%">
                <feGaussianBlur stdDeviation="3.5" result="blur" />
                <feMerge>
                  <feMergeNode in="blur" />
                  <feMergeNode in="SourceGraphic" />
                </feMerge>
              </filter>
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
              tickFormatter={(v) => `${v}%`}
              width={48}
            />
            <ReferenceLine y={0} stroke="#1F1F23" strokeDasharray="0" />
            {pivotOrdinal !== undefined && series.length > 0 && (
              <>
                {/* ReferenceArea : post-pivot territoire teinté bleu très subtil */}
                <ReferenceArea
                  x1={pivotOrdinal}
                  x2={series[series.length - 1]!.ordinal + 8}
                  fill="#5B8DEF"
                  fillOpacity={0.05}
                  ifOverflow="extendDomain"
                />
                <ReferenceLine
                  x={pivotOrdinal}
                  stroke="#5B8DEF"
                  strokeDasharray="3 4"
                  strokeOpacity={0.55}
                  label={{
                    value: 'PIVOT',
                    position: 'top',
                    fill: '#5B8DEF',
                    fontSize: 9,
                    fontWeight: 600,
                    letterSpacing: '0.12em',
                    offset: 6,
                  }}
                />
              </>
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
              stroke="#5B8DEF"
              strokeWidth={1.75}
              fill="url(#tr-eq-fill)"
              filter="url(#tr-eq-glow)"
              isAnimationActive={!reduced}
              animationDuration={1600}
              animationEasing="ease-out"
              dot={false}
              activeDot={{ r: 5, fill: '#5B8DEF', stroke: '#0A0A0B', strokeWidth: 2 }}
            />
            {/* Pulse on the last data point — SVG-native, no React re-renders */}
            {series.length > 0 && !reduced && (
              <ReferenceDot
                x={series[series.length - 1]!.ordinal}
                y={series[series.length - 1]!.cumPercent}
                shape={(props) => <LastPointPulse cx={props.cx} cy={props.cy} />}
                ifOverflow="extendDomain"
              />
            )}
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </motion.figure>
  );
}
