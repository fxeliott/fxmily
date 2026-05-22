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
 * R-multiple histogram — drives expectancy intuition.
 * Pertes en `--tr-loss`, gains en `--tr-gain`, BE bucket muted.
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

  const figMotion = reduced
    ? {}
    : { initial: { opacity: 0, y: 12 }, whileInView: { opacity: 1, y: 0 } };
  return (
    <motion.figure
      role="img"
      aria-label={summary}
      {...figMotion}
      viewport={{ once: true, amount: 0.3 }}
      transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
      className={`relative m-0 ${className}`}
      style={{ height }}
    >
      <figcaption className="sr-only">{summary}</figcaption>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={series} margin={{ top: 8, right: 18, bottom: 8, left: -8 }}>
          <XAxis
            dataKey="label"
            stroke="#8C99AD"
            tick={{ fontSize: 11, fontFamily: 'var(--tr-font-mono)', fill: '#8C99AD' }}
            tickLine={false}
            axisLine={false}
            interval={1}
            tickFormatter={(v) => `${v}R`}
          />
          <YAxis
            stroke="#8C99AD"
            tick={{ fontSize: 11, fontFamily: 'var(--tr-font-mono)', fill: '#8C99AD' }}
            tickLine={false}
            axisLine={false}
            width={36}
          />
          <Tooltip
            cursor={{ fill: 'rgba(0,133,255,0.06)' }}
            contentStyle={{
              background: '#14171D',
              border: '1px solid #2B3039',
              borderRadius: '8px',
              fontSize: '12px',
              fontFamily: 'var(--tr-font-mono)',
              boxShadow: '0 24px 64px rgba(0,0,0,0.65)',
            }}
            labelStyle={{ color: '#8C99AD' }}
            itemStyle={{ color: '#EDEDF3' }}
            formatter={(v) => [formatCount(typeof v === 'number' ? v : 0), 'Trades']}
            labelFormatter={(label) => `Bucket ${label}R → ${(+label + 0.5).toFixed(1)}R`}
          />
          <Bar
            dataKey="count"
            isAnimationActive={!reduced}
            animationDuration={1100}
            animationEasing="ease-out"
            radius={[3, 3, 0, 0]}
          >
            {series.map((entry, i) => {
              const color =
                entry.tone === 'loss' ? '#F46B7D' : entry.tone === 'gain' ? '#3EAE20' : '#8C99AD';
              return <Cell key={`bar-${i}`} fill={color} />;
            })}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </motion.figure>
  );
}
