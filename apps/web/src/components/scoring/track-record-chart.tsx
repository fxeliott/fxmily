'use client';

import { motion, useReducedMotion } from 'framer-motion';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useMemo, useTransition } from 'react';
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

import { cn } from '@/lib/utils';

import type { RangeKey } from '@/lib/scoring/dashboard-data';

/**
 * Equity-curve chart (R-multiple cumulative) for the dashboard.
 *
 * Mark Douglas alignment: the chart is *outcome-as-process*, not
 * "predict the future". Excluded R sources (estimated) are surfaced via
 * a small badge so the member sees that some rows were filtered.
 *
 * Recharts wrappers, not Tremor — full control over the design system
 * tokens (lime/cyan area gradients) and tighter bundle.
 */

interface EquityChartProps {
  data: ReadonlyArray<{ ts: string; cumR: number; drawdownFromPeak: number }>;
  /** Number of estimated trades excluded — shown as a footnote. */
  estimatedExcluded: number;
  /** Currently-selected range. */
  range: RangeKey;
}

const RANGE_LABELS: Record<RangeKey, string> = {
  '7d': '7j',
  '30d': '30j',
  '3m': '3m',
  '6m': '6m',
  all: 'Tout',
};

const RANGE_ORDER: RangeKey[] = ['7d', '30d', '3m', '6m', 'all'];

export function TrackRecordChart({ data, estimatedExcluded, range }: EquityChartProps) {
  const prefersReducedMotion = useReducedMotion();
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [pending, startTransition] = useTransition();

  const setRange = (next: RangeKey) => {
    const sp = new URLSearchParams(params.toString());
    sp.set('range', next);
    startTransition(() => {
      router.push(`${pathname}?${sp.toString()}`, { scroll: false });
    });
  };

  const formatted = useMemo(
    () =>
      data.map((p, i) => ({
        idx: i,
        date: new Date(p.ts).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' }),
        cumR: Number(p.cumR.toFixed(2)),
        dd: Number((-p.drawdownFromPeak).toFixed(2)), // negative for visual cue
      })),
    [data],
  );

  return (
    <motion.div
      initial={prefersReducedMotion ? false : { opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
      className="rounded-card-lg flex flex-col gap-3 border border-[var(--b-default)] bg-[var(--bg-1)] p-4"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="t-eyebrow" id="track-record-title">
            Track record
          </span>
          <span className="t-mono-cap text-[var(--t-4)]">R cumulé</span>
        </div>
        {/* Plain group of buttons — not an ARIA tablist (the panel is the chart
            itself, and we don't ship the full APG keyboard pattern Home/End/
            Arrows + roving tabindex + aria-controls. A11y audit B2 fix). */}
        <div role="group" aria-label="Plage temporelle" className="flex items-center gap-2">
          {RANGE_ORDER.map((r) => (
            <button
              key={r}
              type="button"
              aria-pressed={range === r}
              onClick={() => setRange(r)}
              disabled={pending && range !== r}
              className={cn(
                'rounded-pill border px-2.5 py-1 text-[11px] font-medium transition-colors',
                range === r
                  ? 'border-[var(--b-acc-strong)] bg-[var(--acc-dim)] text-[var(--acc)]'
                  : 'border-[var(--b-default)] text-[var(--t-3)] hover:border-[var(--b-strong)] hover:text-[var(--t-1)]',
              )}
            >
              {RANGE_LABELS[r]}
            </button>
          ))}
        </div>
      </div>

      {formatted.length === 0 ? (
        <div className="grid h-[260px] place-items-center text-[var(--t-4)]">
          <span className="t-cap">Pas encore de trades clôturés sur cette plage.</span>
        </div>
      ) : (
        <figure
          className="h-[260px] w-full"
          role="img"
          aria-labelledby="track-record-title"
          aria-describedby="track-record-summary"
        >
          {/* SR-only summary — closes A11y audit B1 (Recharts SVG without text alt) */}
          <figcaption id="track-record-summary" className="sr-only">
            Courbe de R cumulé sur {formatted.length} trades. Départ{' '}
            {formatted[0]?.cumR.toFixed(2) ?? '0'} R, arrivée{' '}
            {formatted[formatted.length - 1]?.cumR.toFixed(2) ?? '0'} R.
            {estimatedExcluded > 0 ? ` ${estimatedExcluded} trade(s) sans stop-loss exclu(s).` : ''}
          </figcaption>
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={formatted} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
              <defs>
                <linearGradient id="cumR-fill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="var(--acc)" stopOpacity={0.5} />
                  <stop offset="100%" stopColor="var(--acc)" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid stroke="var(--b-subtle)" strokeDasharray="3 3" vertical={false} />
              <XAxis
                dataKey="date"
                stroke="var(--t-4)"
                tick={{ fontSize: 10, fill: 'var(--t-4)' }}
                tickLine={false}
                axisLine={false}
                interval="preserveStartEnd"
                minTickGap={24}
              />
              <YAxis
                stroke="var(--t-4)"
                tick={{ fontSize: 10, fill: 'var(--t-4)' }}
                tickLine={false}
                axisLine={false}
                width={40}
              />
              <Tooltip
                cursor={{ stroke: 'var(--b-strong)', strokeDasharray: '3 3' }}
                contentStyle={{
                  background: 'var(--bg-2)',
                  border: '1px solid var(--b-default)',
                  borderRadius: 8,
                  fontSize: 11,
                }}
                labelStyle={{ color: 'var(--t-3)' }}
                formatter={(value, name) => {
                  const v = typeof value === 'number' ? value : Number(value);
                  if (!Number.isFinite(v)) return ['—', String(name)];
                  return name === 'cumR'
                    ? [`${v >= 0 ? '+' : ''}${v.toFixed(2)} R`, 'R cumulé']
                    : [v.toFixed(2), 'DD'];
                }}
              />
              <Area
                type="monotone"
                dataKey="cumR"
                stroke="var(--acc)"
                strokeWidth={2}
                fill="url(#cumR-fill)"
                isAnimationActive={!prefersReducedMotion}
                animationDuration={900}
              />
            </AreaChart>
          </ResponsiveContainer>
        </figure>
      )}

      {estimatedExcluded > 0 ? (
        <p className="t-cap text-[var(--t-4)]">
          {estimatedExcluded} trade{estimatedExcluded > 1 ? 's' : ''} sans stop-loss exclu
          {estimatedExcluded > 1 ? 's' : ''} de la courbe (R réalisé estimé, non fiable pour la
          précision).
        </p>
      ) : null}
    </motion.div>
  );
}
