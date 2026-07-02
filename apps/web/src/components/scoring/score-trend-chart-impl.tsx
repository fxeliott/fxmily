'use client';

import { m, useReducedMotion } from 'framer-motion';
import { useMemo } from 'react';
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

import type { BehavioralScoreTrendPoint } from '@/lib/scoring/service';
import { useChartColors } from '@/lib/use-chart-colors';

/**
 * Session 3 §28/§21 — behavioral-score trend (the 4 dimensions over time).
 *
 * The dashboard already shows TODAY's gauges; this answers "est-ce que je
 * progresse ?" — the §28 "suivre sa progression" intent, served from the
 * member's OWN persisted scores (no AI, no admin report, posture §2 safe).
 *
 * Recharts hex literals (`C.*`, never `var()`) for iOS WebView. Nulls
 * (insufficient_data days) are bridged so a sparse early history still reads
 * as a trajectory — the value is "not computed", never a fabricated 0, and the
 * tooltip only shows real points. Anti Black-Hat: neutral multi-line, no
 * good/bad coloring of a dimension, no fanfare.
 */

/**
 * S18 — neutral cool palette only. These 4 dimensions are PROCESS metrics, not
 * gain/loss, so they must NOT borrow the finance grammar (ok=green / warn=amber).
 * We map them to the cool spectrum trio + one desaturated neutral, keeping a
 * clear luminance ladder so the lines stay distinguishable for colour-blind
 * readers (bright blue → indigo → bright cyan → muted neutral). `colorKey` is a
 * key of the theme-aware set so colours flip in light mode (resolved at render
 * via useChartColors).
 */
const DIMENSIONS = [
  { key: 'discipline', label: 'Discipline', colorKey: 'acc' },
  { key: 'emotionalStability', label: 'Stabilité', colorKey: 'cy' },
  { key: 'consistency', label: 'Cohérence', colorKey: 'acc2' },
  { key: 'engagement', label: 'Engagement', colorKey: 't2' },
] as const;

function frenchShort(isoDate: string): string {
  // `YYYY-MM-DD` → "j mois" (parse as UTC to avoid TZ drift on the date-only).
  const [y, mo, d] = isoDate.split('-').map(Number);
  return new Date(Date.UTC(y!, mo! - 1, d!)).toLocaleDateString('fr-FR', {
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  });
}

export function ScoreTrendChart({ data }: { data: ReadonlyArray<BehavioralScoreTrendPoint> }) {
  const C = useChartColors();
  const prefersReducedMotion = useReducedMotion();

  const formatted = useMemo(() => data.map((p) => ({ ...p, label: frenchShort(p.date) })), [data]);

  // Need ≥2 snapshots to draw any trajectory — until then it's just today's
  // gauges (the cron persists one snapshot/day, so the line fills in over days).
  if (formatted.length < 2) {
    return (
      <div className="rounded-card-lg flex flex-col gap-3 border border-[var(--b-default)] bg-[var(--bg-1)] p-4">
        <span className="t-eyebrow">Évolution de tes scores</span>
        <div className="grid h-[200px] place-items-center text-center text-[var(--t-4)]">
          <span className="t-cap max-w-[34ch]">
            Ta courbe de progression apparaîtra dès le 2ᵉ jour de scores. Un instantané est
            enregistré chaque nuit. Reviens demain pour voir ta trajectoire.
          </span>
        </div>
      </div>
    );
  }

  const last = formatted[formatted.length - 1]!;

  return (
    <m.div
      initial={prefersReducedMotion ? false : { opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
      className="rounded-card-lg flex flex-col gap-3 border border-[var(--b-default)] bg-[var(--bg-1)] p-4"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="t-eyebrow" id="score-trend-title">
            Évolution de tes scores
          </span>
          <span className="t-mono-cap text-[var(--t-4)]">{formatted.length} jours</span>
        </div>
        {/* Legend — also the SR-readable mapping of colour → dimension. */}
        <ul className="flex flex-wrap items-center gap-x-3 gap-y-1">
          {DIMENSIONS.map((dim) => (
            <li key={dim.key} className="inline-flex items-center gap-1.5">
              <span
                className="inline-block h-2 w-2 rounded-full"
                style={{ backgroundColor: C[dim.colorKey] }}
                aria-hidden="true"
              />
              <span className="t-mono-cap text-[var(--t-3)]">{dim.label}</span>
            </li>
          ))}
        </ul>
      </div>

      <figure
        className="h-[220px] w-full"
        role="img"
        aria-labelledby="score-trend-title"
        aria-describedby="score-trend-summary"
      >
        <figcaption id="score-trend-summary" className="sr-only">
          Évolution des 4 scores comportementaux sur {formatted.length} jours. Derniers scores :
          Discipline {last.discipline ?? 'non calculé'}, Stabilité{' '}
          {last.emotionalStability ?? 'non calculé'}, Cohérence {last.consistency ?? 'non calculé'},
          Engagement {last.engagement ?? 'non calculé'} sur 100.
        </figcaption>
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={formatted} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
            <CartesianGrid stroke={C.bSubtle} strokeDasharray="3 3" vertical={false} />
            <XAxis
              dataKey="label"
              stroke={C.t4}
              tick={{ fontSize: 11, fill: C.t4 }}
              tickLine={false}
              axisLine={false}
              interval="preserveStartEnd"
              minTickGap={24}
            />
            <YAxis
              domain={[0, 100]}
              stroke={C.t4}
              tick={{ fontSize: 11, fill: C.t4 }}
              tickLine={false}
              axisLine={false}
              width={32}
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
                return [Number.isFinite(v) ? `${v}/100` : '—', String(name)];
              }}
            />
            {DIMENSIONS.map((dim) => (
              <Line
                key={dim.key}
                type="monotone"
                dataKey={dim.key}
                name={dim.label}
                stroke={C[dim.colorKey]}
                strokeWidth={2}
                dot={false}
                connectNulls
                isAnimationActive={!prefersReducedMotion}
                animationDuration={900}
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </figure>

      <p className="t-cap text-[var(--t-4)]">
        Un instantané par nuit. Les jours sans données suffisantes sont reliés (jamais comptés comme
        0). Aucun conseil de marché, uniquement ton comportement.
      </p>
    </m.div>
  );
}
