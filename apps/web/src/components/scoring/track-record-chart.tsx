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

import { C } from '@/lib/theme-colors';
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
              // J6.6 H6 fix — touch target >= 32px height (WCAG 2.5.8 AA min 24).
              className={cn(
                'rounded-pill inline-flex min-h-[32px] items-center border px-3 py-1.5 text-[12px] font-medium transition-colors disabled:opacity-50',
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
          className={cn(
            'h-[260px] w-full transition-opacity',
            // J6.6 BLOCKER B2 fix — visible loading state during URL transition.
            pending && 'opacity-60',
          )}
          role="img"
          aria-labelledby="track-record-title"
          aria-describedby="track-record-summary"
          aria-busy={pending}
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
                {/* J6.6 BLOCKER B1 fix — hex literals instead of var(--token) so
                    Safari/iOS WebView resolves the gradient correctly. */}
                <linearGradient id="cumR-fill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={C.acc} stopOpacity={0.5} />
                  <stop offset="100%" stopColor={C.acc} stopOpacity={0} />
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
                minTickGap={24}
              />
              <YAxis
                stroke={C.t4}
                tick={{ fontSize: 11, fill: C.t4 }}
                tickLine={false}
                axisLine={false}
                width={40}
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
                stroke={C.acc}
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
