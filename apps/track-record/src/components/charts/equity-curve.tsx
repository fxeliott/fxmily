'use client';

import { useMemo } from 'react';
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ReferenceLine,
  ResponsiveContainer,
} from 'recharts';
import { motion, useReducedMotion } from 'framer-motion';
import type { EquityPoint } from '@/lib/metrics';
import { formatPercent } from '@/lib/format';

interface EquityCurveProps {
  data: readonly EquityPoint[];
  height?: number;
  className?: string;
  /** Optional ARIA caption read by SR. Auto-derived if absent. */
  ariaCaption?: string;
}

interface ChartDatum {
  ordinal: number;
  cumPercent: number;
  underwater: number;
  enteredAt: string;
}

/**
 * Equity curve — Recharts AreaChart bleu lumineux + glow + animated draw.
 * SVG `<defs>` natifs pour gradient stroke + glow filter (impossible côté Canvas
 * lightweight-charts → c'est pourquoi Recharts est notre choix pour T0.5).
 *
 * Sources : research subagents 2026-05-21
 *  - Stripe Connect dark colorPrimary `#0085FF` accent
 *  - Mercury soft glow (`box-shadow ≤ 0.30 alpha` discipline)
 *  - Tradezella / Stripe Dashboard pattern : drawdown shaded underneath curve.
 */
export function EquityCurve({ data, height = 360, className = '', ariaCaption }: EquityCurveProps) {
  const reduced = useReducedMotion();
  const series: ChartDatum[] = useMemo(
    () =>
      data.map((p) => ({
        ordinal: p.ordinal,
        cumPercent: +p.cumPercent.toFixed(3),
        underwater: +p.underwater.toFixed(3),
        enteredAt: p.enteredAt.toISOString().slice(0, 10),
      })),
    [data],
  );

  const summary = useMemo(() => {
    if (ariaCaption) return ariaCaption;
    if (!data.length) return 'Aucune donnée disponible';
    let peakV = -Infinity;
    let peakO = 0;
    let troughV = Infinity;
    let troughO = 0;
    for (const p of data) {
      if (p.cumPercent > peakV) {
        peakV = p.cumPercent;
        peakO = p.ordinal;
      }
      if (p.underwater < troughV) {
        troughV = p.underwater;
        troughO = p.ordinal;
      }
    }
    const last = data[data.length - 1]!;
    return (
      `Courbe d'équity cumulée sur ${data.length} trades. ` +
      `Pic à ${formatPercent(peakV, { signed: true })} au trade ${peakO}. ` +
      `Drawdown maximum ${formatPercent(troughV, { signed: true })} au trade ${troughO}. ` +
      `Cumulé final ${formatPercent(last.cumPercent, { signed: true })}.`
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
        <AreaChart data={series} margin={{ top: 12, right: 18, bottom: 8, left: -8 }}>
          <defs>
            <linearGradient id="tr-eq-fill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#0085FF" stopOpacity={0.35} />
              <stop offset="60%" stopColor="#0085FF" stopOpacity={0.08} />
              <stop offset="100%" stopColor="#0085FF" stopOpacity={0} />
            </linearGradient>
            <linearGradient id="tr-eq-stroke" x1="0" y1="0" x2="1" y2="0">
              <stop offset="0%" stopColor="#2596FF" />
              <stop offset="100%" stopColor="#0085FF" />
            </linearGradient>
            <filter id="tr-eq-glow" x="-20%" y="-20%" width="140%" height="140%">
              <feGaussianBlur stdDeviation="3.5" result="b" />
              <feMerge>
                <feMergeNode in="b" />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>
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
            label={{
              value: 'Trades chronologiques',
              position: 'insideBottom',
              offset: -4,
              fill: '#8C99AD',
              fontSize: 10,
              fontFamily: 'var(--tr-font-mono)',
            }}
          />
          <YAxis
            stroke="#8C99AD"
            tick={{ fontSize: 11, fontFamily: 'var(--tr-font-mono)', fill: '#8C99AD' }}
            tickLine={false}
            axisLine={false}
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
            labelStyle={{ color: '#8C99AD', fontWeight: 500 }}
            itemStyle={{ color: '#EDEDF3' }}
            formatter={(value, key) => {
              const num = typeof value === 'number' ? value : 0;
              if (key === 'cumPercent') return [formatPercent(num, { signed: true }), 'Cumulé'];
              return [num, key as string];
            }}
            labelFormatter={(_label, payload) => {
              const first = Array.isArray(payload) && payload[0] ? payload[0].payload : undefined;
              return first?.enteredAt ?? '';
            }}
          />
          <Area
            type="monotone"
            dataKey="cumPercent"
            stroke="url(#tr-eq-stroke)"
            strokeWidth={2.5}
            fill="url(#tr-eq-fill)"
            filter="url(#tr-eq-glow)"
            isAnimationActive={!reduced}
            animationDuration={1500}
            animationEasing="ease-out"
            dot={false}
            activeDot={{
              r: 5,
              fill: '#2596FF',
              stroke: '#FFFFFF',
              strokeWidth: 2,
              style: { filter: 'drop-shadow(0 0 6px rgba(0,133,255,0.6))' },
            }}
          />
        </AreaChart>
      </ResponsiveContainer>
    </motion.figure>
  );
}
