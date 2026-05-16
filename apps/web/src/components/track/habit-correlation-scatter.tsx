'use client';

import { motion, useReducedMotion } from 'framer-motion';
import { useMemo } from 'react';
import {
  CartesianGrid,
  ReferenceLine,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

import { C } from '@/lib/theme-colors';

/**
 * Habit × R scatter — V2.1.3.
 *
 * Mark Douglas honesty: we show the *cloud of points*, not a fitted trend
 * line. A regression line on a weak / small-n relationship over-implies
 * predictive power (the exact dishonesty this feature avoids). The only
 * line drawn is the factual break-even at R = 0 — descriptive, not
 * inferential. The member reads the spread themselves.
 *
 * Recharts colors come from the `C` hex constants, NOT `var(--token)`:
 * Recharts injects the value straight into an SVG attribute and several
 * iOS / Android WebViews don't resolve `fill="var(--x)"` (J6.6
 * ui-designer BLOCKER B1 — flat-black charts on iOS otherwise).
 *
 * SC 1.1.1: Recharts' SVG has no text alternative even with
 * `accessibilityLayer` (default-on in v3). We add the canonical
 * `<figure role="img">` + sr-only `<figcaption>` summary the rest of the
 * dashboard uses (carbon `track-record-chart.tsx`).
 */

export interface ScatterPoint {
  /** Habit scalar (e.g. sleep hours). */
  x: number;
  /** Realized R for that day's trade. */
  y: number;
  /** Paris-local date `YYYY-MM-DD` (tooltip only). */
  date: string;
}

interface HabitCorrelationScatterProps {
  points: readonly ScatterPoint[];
  /** Axis label incl. unit, e.g. "Sommeil (h)". */
  xLabel: string;
  /** Plain-language summary for the sr-only caption (no raw r as headline). */
  summary: string;
}

export function HabitCorrelationScatter({ points, xLabel, summary }: HabitCorrelationScatterProps) {
  const prefersReducedMotion = useReducedMotion();

  const data = useMemo(
    () => points.map((p) => ({ x: p.x, y: Number(p.y.toFixed(2)), date: p.date })),
    [points],
  );

  return (
    <motion.div
      initial={prefersReducedMotion ? false : { opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
    >
      <figure
        className="h-[240px] w-full"
        role="img"
        aria-label="Nuage de points : habitude (axe X) vs R réalisé (axe Y)"
        aria-describedby="habit-corr-summary"
      >
        <figcaption id="habit-corr-summary" className="sr-only">
          {summary}
        </figcaption>
        <ResponsiveContainer width="100%" height="100%">
          <ScatterChart margin={{ top: 8, right: 12, left: -12, bottom: 4 }}>
            <CartesianGrid stroke={C.bSubtle} strokeDasharray="3 3" />
            <XAxis
              type="number"
              dataKey="x"
              name={xLabel}
              stroke={C.t4}
              tick={{ fontSize: 11, fill: C.t4 }}
              tickLine={false}
              axisLine={false}
              domain={[
                (min: number) => min - Math.max(0.5, Math.abs(min) * 0.05),
                (max: number) => max + Math.max(0.5, Math.abs(max) * 0.05),
              ]}
              label={{
                value: xLabel,
                position: 'insideBottom',
                offset: -2,
                fontSize: 11,
                fill: C.t4,
              }}
            />
            <YAxis
              type="number"
              dataKey="y"
              name="R réalisé"
              stroke={C.t4}
              tick={{ fontSize: 11, fill: C.t4 }}
              tickLine={false}
              axisLine={false}
              width={40}
              domain={[
                (min: number) => Math.floor(Math.min(0, min)),
                (max: number) => Math.ceil(Math.max(0, max)),
              ]}
            />
            {/* Factual break-even — NOT a trend line. */}
            <ReferenceLine y={0} stroke={C.bStrong} strokeDasharray="4 4" />
            <Tooltip
              cursor={{ stroke: C.bStrong, strokeDasharray: '3 3' }}
              contentStyle={{
                background: C.bg3,
                border: `1px solid ${C.bDefault}`,
                borderRadius: 8,
                fontSize: 12,
              }}
              labelStyle={{ color: C.t2 }}
              itemStyle={{ color: C.t1 }}
              formatter={(value, name) => {
                const v = typeof value === 'number' ? value : Number(value);
                if (!Number.isFinite(v)) return ['—', String(name)];
                return name === 'y' ? [`${v >= 0 ? '+' : ''}${v} R`, 'R réalisé'] : [v, xLabel];
              }}
              labelFormatter={(_label, payload) => {
                const d = payload?.[0]?.payload as { date?: string } | undefined;
                return d?.date ?? '';
              }}
            />
            <Scatter
              data={data}
              fill={C.acc}
              fillOpacity={0.7}
              stroke={C.acc}
              strokeOpacity={0.9}
              isAnimationActive={!prefersReducedMotion}
              animationDuration={700}
            />
          </ScatterChart>
        </ResponsiveContainer>
      </figure>
    </motion.div>
  );
}
