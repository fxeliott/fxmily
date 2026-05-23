'use client';

import { useMemo } from 'react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from 'recharts';
import { motion, useReducedMotion } from 'framer-motion';
import type { RBucket } from '@/lib/metrics';
import { formatCount } from '@/lib/format';

interface RDistributionProps {
  buckets: readonly RBucket[];
  height?: number;
  className?: string;
  ariaCaption?: string;
}

/**
 * R-multiple histogram T2 — drives expectancy intuition.
 *
 * Palette T1 desaturée :
 *  - Pertes : `--negative` (#c87c7c)
 *  - Gains : `--positive` (#7cb87c)
 *  - BE : `--text-subtle` (#5a5a63)
 */
export function RDistribution({
  buckets,
  height = 240,
  className = '',
  ariaCaption,
}: RDistributionProps) {
  const reduced = useReducedMotion();
  const series = useMemo(
    () =>
      buckets.map((b) => ({
        label: b.label,
        count: b.count,
        tone: b.tone,
        upper: b.upper,
      })),
    [buckets],
  );

  const summary = useMemo(() => {
    if (ariaCaption) return ariaCaption;
    if (!buckets.length) return 'Aucune donnée R-multiple';
    const losses = buckets.filter((b) => b.tone === 'loss').reduce((s, b) => s + b.count, 0);
    const gains = buckets.filter((b) => b.tone === 'gain').reduce((s, b) => s + b.count, 0);
    const top = [...buckets].sort((a, b) => b.count - a.count)[0];
    return (
      `Histogramme de distribution R-multiple par buckets de 0,5R. ` +
      `${gains} trades en gain, ${losses} trades en perte. ` +
      (top ? `Bucket le plus fréquent : ${top.label}R avec ${top.count} trades.` : '')
    );
  }, [buckets, ariaCaption]);

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
        <BarChart data={series} margin={{ top: 8, right: 12, bottom: 8, left: 4 }}>
          <XAxis
            dataKey="label"
            tick={{ fontSize: 11, fill: '#5A5A63' }}
            tickLine={false}
            axisLine={false}
            interval={1}
            tickFormatter={(v) => `${v}R`}
          />
          <YAxis
            tick={{ fontSize: 11, fill: '#5A5A63' }}
            tickLine={false}
            axisLine={false}
            width={36}
          />
          <Tooltip
            cursor={{ fill: 'rgba(91,141,239,0.06)' }}
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
            formatter={(v) => [formatCount(typeof v === 'number' ? v : 0), 'Trades']}
            labelFormatter={(label) => `Bucket ${label}R → ${(+label + 0.5).toFixed(1)}R`}
          />
          <Bar
            dataKey="count"
            isAnimationActive={!reduced}
            animationDuration={1100}
            animationEasing="ease-out"
            radius={[2, 2, 0, 0]}
          >
            {series.map((entry, i) => {
              const color =
                entry.tone === 'loss' ? '#C87C7C' : entry.tone === 'gain' ? '#7CB87C' : '#5A5A63';
              return <Cell key={`bar-${i}`} fill={color} />;
            })}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </motion.figure>
  );
}
