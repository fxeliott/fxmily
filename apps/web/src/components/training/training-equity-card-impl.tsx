'use client';

import { useReducedMotion } from 'framer-motion';
import { useMemo } from 'react';
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

import { C } from '@/lib/theme-colors';

/**
 * Cumulative respect-système curve for the `/training` landing (S13 dataviz).
 *
 * 🚨 STATISTICAL ISOLATION (SPEC §21.5): this chart NEVER reads
 * `resultR` / `outcome` of a backtest. It plots the *count of backtests
 * where the member kept their own system* (`systemRespected === true`),
 * accumulated in chronological order. That is the discipline signal the
 * Mode Entraînement is allowed to surface — the practice of the geste,
 * not the P&L of the geste. No new server query: every point is derived
 * from the `enteredAt` / `systemRespected` fields already on the rows the
 * page rendered.
 *
 * Posture (anti-Black-Hat / Mark Douglas): the curve only ever rises or
 * stays flat (a cumulative count), so a "bad" day is a plateau, never a
 * red drop. We measure the build-up of discipline, calmly.
 *
 * Recharts AreaChart, cyan tone (§21.7 training surface). Tokens come from
 * the hex mirror (`C`) so the SVG gradient resolves on iOS WebView.
 */

export interface TrainingEquityPoint {
  /** ISO date the backtest was entered. */
  enteredAt: string;
  /** Member's own answer to "did I respect my system?", or null if unset. */
  systemRespected: boolean | null;
}

export function TrainingEquityCardChart({
  points,
}: {
  points: ReadonlyArray<TrainingEquityPoint>;
}) {
  const prefersReducedMotion = useReducedMotion();

  const formatted = useMemo(() => {
    // Oldest → newest so the curve reads left-to-right like a real timeline.
    const ordered = [...points].sort(
      (a, b) => new Date(a.enteredAt).getTime() - new Date(b.enteredAt).getTime(),
    );
    // Cumulative count of "système tenu", computed without a mutated closure
    // var (react-hooks/immutability): each point's running total is the count
    // of kept-system rows up to and including its index.
    return ordered.map((p, i) => ({
      idx: i + 1,
      date: new Date(p.enteredAt).toLocaleDateString('fr-FR', {
        day: 'numeric',
        month: 'short',
      }),
      kept: ordered
        .slice(0, i + 1)
        .reduce((acc, q) => acc + (q.systemRespected === true ? 1 : 0), 0),
    }));
  }, [points]);

  const last = formatted[formatted.length - 1];

  return (
    <figure
      className="h-[200px] w-full"
      role="img"
      aria-labelledby="training-equity-title"
      aria-describedby="training-equity-summary"
    >
      <figcaption id="training-equity-summary" className="sr-only">
        Progression du système tenu sur tes {formatted.length} derniers backtests :{' '}
        {last?.kept ?? 0} fois ton système respecté, cumulé dans le temps.
      </figcaption>
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={formatted} margin={{ top: 8, right: 8, left: -20, bottom: 0 }}>
          <defs>
            <linearGradient id="training-kept-fill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={C.cy} stopOpacity={0.45} />
              <stop offset="100%" stopColor={C.cy} stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid stroke={C.bSubtle} strokeDasharray="3 3" vertical={false} />
          <XAxis
            dataKey="date"
            stroke={C.t4}
            tick={{ fontSize: 11, fill: C.t4 }}
            tickLine={false}
            axisLine={false}
            interval="preserveStartEnd"
            minTickGap={28}
          />
          <YAxis
            stroke={C.t4}
            tick={{ fontSize: 11, fill: C.t4 }}
            tickLine={false}
            axisLine={false}
            width={36}
            allowDecimals={false}
          />
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
            formatter={(value) => {
              const v = typeof value === 'number' ? value : Number(value);
              if (!Number.isFinite(v)) return ['—', 'Système tenu'];
              return [`${v} fois`, 'Système tenu (cumulé)'];
            }}
          />
          <Area
            type="monotone"
            dataKey="kept"
            stroke={C.cy}
            strokeWidth={2}
            fill="url(#training-kept-fill)"
            isAnimationActive={!prefersReducedMotion}
            animationDuration={900}
            dot={false}
          />
        </AreaChart>
      </ResponsiveContainer>
    </figure>
  );
}
