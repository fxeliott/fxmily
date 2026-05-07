'use client';

import { motion, useReducedMotion } from 'framer-motion';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';

import type { RDistributionBucket } from '@/lib/scoring/dashboard-data';

/**
 * Histogram of R-multiples grouped in 0.5R buckets, clipped to [-3R, +3R+].
 *
 * Wins are coloured lime (`--acc`), losses red (`--bad`). The shape gives
 * an immediate visual answer to "do my winners run further than my losers
 * usually do?" — payoff ratio in one glance, complementing the numeric
 * `<ExpectancyCard />`.
 */
interface RDistributionProps {
  buckets: ReadonlyArray<RDistributionBucket>;
}

export function RDistribution({ buckets }: RDistributionProps) {
  const prefersReducedMotion = useReducedMotion();
  const data = buckets.map((b) => ({
    label: b.label,
    count: b.count,
    fill: b.from < 0 ? 'var(--bad)' : b.from < 0.001 ? 'var(--t-4)' : 'var(--acc)',
  }));

  const total = buckets.reduce((s, b) => s + b.count, 0);

  return (
    <motion.div
      initial={prefersReducedMotion ? false : { opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
      className="rounded-card-lg flex flex-col gap-2 border border-[var(--b-default)] bg-[var(--bg-1)] p-4"
    >
      <div className="flex items-center justify-between gap-2">
        <span className="t-eyebrow" id="r-dist-title">
          Distribution R
        </span>
        <span className="t-mono-cap text-[var(--t-4)]">{total} trades</span>
      </div>
      {total === 0 ? (
        <div className="grid h-[200px] place-items-center text-[var(--t-4)]">
          <span className="t-cap">Pas encore de trades clôturés.</span>
        </div>
      ) : (
        <figure
          className="h-[200px] w-full"
          role="img"
          aria-labelledby="r-dist-title"
          aria-describedby="r-dist-summary"
        >
          {/* SR-only summary — closes A11y audit B1 */}
          <figcaption id="r-dist-summary" className="sr-only">
            Histogramme des R-multiples sur {total} trades clôturés (source computed seulement).
            Buckets de 0.5R de -3R à +3R+.
            {data
              .filter((b) => b.count > 0)
              .map((b) => `${b.label}: ${b.count} trades`)
              .join(', ')}
            .
          </figcaption>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data} margin={{ top: 4, right: 0, left: -24, bottom: 0 }}>
              <CartesianGrid stroke="var(--b-subtle)" strokeDasharray="3 3" vertical={false} />
              <XAxis
                dataKey="label"
                stroke="var(--t-4)"
                tick={{ fontSize: 9, fill: 'var(--t-4)' }}
                tickLine={false}
                axisLine={false}
                interval={1}
              />
              <YAxis
                stroke="var(--t-4)"
                tick={{ fontSize: 10, fill: 'var(--t-4)' }}
                tickLine={false}
                axisLine={false}
                width={32}
                allowDecimals={false}
              />
              <Tooltip
                cursor={{ fill: 'var(--bg-2)' }}
                contentStyle={{
                  background: 'var(--bg-2)',
                  border: '1px solid var(--b-default)',
                  borderRadius: 8,
                  fontSize: 11,
                }}
                labelStyle={{ color: 'var(--t-3)' }}
                formatter={(value) => {
                  const v = typeof value === 'number' ? value : Number(value);
                  return [`${Number.isFinite(v) ? v : 0} trades`, ''];
                }}
              />
              <Bar
                dataKey="count"
                radius={[3, 3, 0, 0]}
                isAnimationActive={!prefersReducedMotion}
                animationDuration={900}
              />
            </BarChart>
          </ResponsiveContainer>
        </figure>
      )}
    </motion.div>
  );
}
