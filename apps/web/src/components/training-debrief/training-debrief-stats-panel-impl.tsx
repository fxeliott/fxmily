'use client';

import { m, useReducedMotion } from 'framer-motion';
import { BookOpen, MessageSquare } from 'lucide-react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

import type { TrainingDebriefStats } from '@/lib/training-debrief/stats';
import { C } from '@/lib/theme-colors';
import { cn } from '@/lib/utils';

/**
 * V1.3 — TrainingDebrief process-stats panel (SPEC §23.3, read-only).
 *
 * Premium DS-v2 **cyan** visualisations, never bare numbers — but CALM by
 * construction (SPEC §23 invariant, anti Black-Hat / Yu-kai Chou): zero XP,
 * zero streak, zero badge, zero fanfare, muted-not-red, and an empty week
 * renders a pedagogical panel — NEVER a misleading "score 0" (§23.4/§21.4).
 *
 * §21.5: consumes ONLY the `TrainingDebriefStats` process families. There is
 * structurally no `resultR`/`outcome`/`plannedRR` to render.
 *
 * Charting choice (source-grounded, calm-first): Recharts where it is its
 * genuine sweet spot — the weekly volume distribution (bar) + the tri-state
 * respect proportion (stacked bar). Diversity / lessons render as refined
 * calm stat tiles; forcing Recharts on single scalars would be louder, not
 * more premium (same doctrine as the `habit-heatmap` calm canon).
 *
 * Hex colours via `C.*` (NEVER `var()` in SVG — iOS/Android WebView flat-
 * black bug, J6.6 canon). Cyan = `C.cy`.
 */

const WEEKDAYS_FR = ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim'] as const;

interface TrainingDebriefStatsPanelProps {
  stats: TrainingDebriefStats;
  /** Human FR week range, e.g. "11 mai → 17 mai". Optional caption. */
  weekRangeLabel?: string;
  className?: string;
}

export function TrainingDebriefStatsPanel({
  stats,
  weekRangeLabel,
  className,
}: TrainingDebriefStatsPanelProps) {
  const prefersReducedMotion = useReducedMotion();
  const { volume, systemRespect, diversity, lessons } = stats;
  const empty = volume.backtestCount === 0;

  const respectTotal =
    systemRespect.respected + systemRespect.notRespected + systemRespect.unspecified;

  const barData = WEEKDAYS_FR.map((d, i) => ({ day: d, count: volume.perWeekday[i] ?? 0 }));

  return (
    <m.div
      initial={prefersReducedMotion ? false : { opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
      data-slot="training-debrief-stats"
      className={cn(
        'rounded-card-lg flex flex-col gap-5 border border-[var(--b-default)] bg-[var(--bg-1)] p-4 sm:p-5',
        className,
      )}
    >
      <div className="flex items-baseline justify-between gap-3">
        <span className="t-eyebrow inline-flex items-center gap-1.5 text-[var(--cy)]">
          Stats de pratique
        </span>
        {weekRangeLabel ? (
          <span className="t-mono-cap text-[var(--t-4)]">{weekRangeLabel}</span>
        ) : null}
      </div>

      {empty ? (
        <div
          data-slot="training-debrief-stats-empty"
          className="rounded-control border border-[var(--cy-edge-soft)] bg-[var(--cy-dim)] px-4 py-3"
        >
          <p className="t-body text-[var(--t-1)]">0 backtest cette semaine.</p>
          <p className="t-cap mt-1 text-[var(--t-2)]">
            Le débrief reste utile : prendre du recul même sans pratique, c&apos;est aussi une
            donnée. Aucun score — <em>anything can happen</em>, le geste prime.
          </p>
        </div>
      ) : (
        <>
          {/* ── Famille 1 — Volume & régularité ───────────────────────── */}
          <section className="flex flex-col gap-2">
            <h3 className="t-h3 text-[var(--t-1)]">Volume &amp; régularité</h3>
            <figure
              className="h-[150px] w-full"
              role="img"
              aria-labelledby="td-vol-title"
              aria-describedby="td-vol-summary"
            >
              <span id="td-vol-title" className="sr-only">
                Répartition des backtests par jour de la semaine
              </span>
              <figcaption id="td-vol-summary" className="sr-only">
                {volume.backtestCount} backtest{volume.backtestCount > 1 ? 's' : ''} sur la semaine,{' '}
                {volume.distinctDays} jour{volume.distinctDays > 1 ? 's' : ''} distinct
                {volume.distinctDays > 1 ? 's' : ''} pratiqué
                {volume.distinctDays > 1 ? 's' : ''}, plus long écart sans pratique{' '}
                {volume.longestGapDays} jour{volume.longestGapDays > 1 ? 's' : ''}.
                {barData.map((b) => ` ${b.day}: ${b.count}.`).join('')}
              </figcaption>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={barData} margin={{ top: 4, right: 0, left: -28, bottom: 0 }}>
                  <CartesianGrid stroke={C.bSubtle} strokeDasharray="3 3" vertical={false} />
                  <XAxis
                    dataKey="day"
                    stroke={C.t4}
                    tick={{ fontSize: 11, fill: C.t4 }}
                    tickLine={false}
                    axisLine={false}
                  />
                  <YAxis
                    stroke={C.t4}
                    tick={{ fontSize: 11, fill: C.t4 }}
                    tickLine={false}
                    axisLine={false}
                    width={32}
                    allowDecimals={false}
                  />
                  <Tooltip
                    cursor={{ fill: C.bg2 }}
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
                      const n = Number.isFinite(v) ? v : 0;
                      return [`${n} backtest${n > 1 ? 's' : ''}`, ''];
                    }}
                  />
                  <Bar
                    dataKey="count"
                    radius={[3, 3, 0, 0]}
                    isAnimationActive={!prefersReducedMotion}
                    animationDuration={700}
                  >
                    {barData.map((entry) => (
                      <Cell key={entry.day} fill={entry.count > 0 ? C.cy : C.bg3} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </figure>
            <p className="t-cap text-[var(--t-2)]">
              <strong className="text-[var(--t-1)]">{volume.backtestCount}</strong> backtest
              {volume.backtestCount > 1 ? 's' : ''} ·{' '}
              <strong className="text-[var(--t-1)]">{volume.distinctDays}</strong>/7 jours pratiqués
              · plus long écart{' '}
              <strong className="text-[var(--t-1)]">{volume.longestGapDays}</strong> j
            </p>
          </section>

          {/* ── Famille 2 — Respect du système ────────────────────────── */}
          <section className="flex flex-col gap-2">
            <h3 className="t-h3 text-[var(--t-1)]">Respect du système</h3>
            <figure
              className="h-[120px] w-full"
              role="img"
              aria-labelledby="td-sys-title"
              aria-describedby="td-sys-summary"
            >
              <span id="td-sys-title" className="sr-only">
                Répartition du respect du système sur les backtests de la semaine
              </span>
              <figcaption id="td-sys-summary" className="sr-only">
                Respecté : {systemRespect.respected}. Non respecté : {systemRespect.notRespected}.
                Non renseigné : {systemRespect.unspecified}. Sur {respectTotal} backtest
                {respectTotal > 1 ? 's' : ''}.
              </figcaption>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  layout="vertical"
                  data={[
                    {
                      name: 'Système',
                      respecté: systemRespect.respected,
                      'non respecté': systemRespect.notRespected,
                      'non renseigné': systemRespect.unspecified,
                    },
                  ]}
                  margin={{ top: 4, right: 8, left: 8, bottom: 0 }}
                  barCategoryGap={0}
                >
                  <XAxis type="number" hide allowDecimals={false} />
                  <YAxis type="category" dataKey="name" hide />
                  <Tooltip
                    cursor={{ fill: C.bg2 }}
                    contentStyle={{
                      background: C.bg3,
                      border: `1px solid ${C.bDefault}`,
                      borderRadius: 8,
                      fontSize: 12,
                    }}
                    labelStyle={{ color: C.t2 }}
                    itemStyle={{ color: C.t1 }}
                  />
                  <Bar
                    dataKey="respecté"
                    stackId="s"
                    fill={C.cy}
                    radius={[4, 0, 0, 4]}
                    isAnimationActive={!prefersReducedMotion}
                    animationDuration={700}
                  />
                  <Bar
                    dataKey="non respecté"
                    stackId="s"
                    fill={C.warn}
                    isAnimationActive={!prefersReducedMotion}
                    animationDuration={700}
                  />
                  <Bar
                    dataKey="non renseigné"
                    stackId="s"
                    fill={C.t4}
                    radius={[0, 4, 4, 0]}
                    isAnimationActive={!prefersReducedMotion}
                    animationDuration={700}
                  />
                </BarChart>
              </ResponsiveContainer>
            </figure>
            <ul className="flex flex-wrap gap-x-4 gap-y-1">
              {(
                [
                  ['Respecté', systemRespect.respected, C.cy],
                  ['Non respecté', systemRespect.notRespected, C.warn],
                  ['Non renseigné', systemRespect.unspecified, C.t4],
                ] as const
              ).map(([label, n, color]) => (
                <li
                  key={label}
                  className="t-cap inline-flex items-center gap-1.5 text-[var(--t-2)]"
                >
                  <span
                    aria-hidden="true"
                    className="inline-block h-2.5 w-2.5 rounded-[3px]"
                    style={{ background: color }}
                  />
                  {label} <span className="font-mono text-[var(--t-1)]">{n}</span>
                </li>
              ))}
            </ul>
          </section>

          {/* ── Famille 3 — Diversité de pratique ─────────────────────── */}
          <section className="flex flex-col gap-2">
            <h3 className="t-h3 text-[var(--t-1)]">Diversité de pratique</h3>
            <div className="flex items-baseline gap-3">
              <span className="f-mono text-[28px] leading-none font-semibold tracking-[-0.02em] text-[var(--t-1)] tabular-nums">
                {diversity.distinctPairs}
              </span>
              <span className="t-cap text-[var(--t-2)]">
                paire{diversity.distinctPairs > 1 ? 's' : ''} distincte
                {diversity.distinctPairs > 1 ? 's' : ''} travaillée
                {diversity.distinctPairs > 1 ? 's' : ''} cette semaine
              </span>
            </div>
            <div aria-hidden="true" className="flex flex-wrap gap-1.5">
              {Array.from({ length: Math.min(diversity.distinctPairs, 12) }).map((_, i) => (
                <span
                  key={i}
                  className="inline-block h-1.5 w-6 rounded-full"
                  style={{ background: C.cy, opacity: 0.55 }}
                />
              ))}
            </div>
          </section>

          {/* ── Famille 4 — Leçons & corrections ──────────────────────── */}
          <section className="flex flex-col gap-2">
            <h3 className="t-h3 text-[var(--t-1)]">Leçons &amp; corrections</h3>
            <div className="grid grid-cols-2 gap-3">
              <StatTile
                icon={<BookOpen className="h-4 w-4" strokeWidth={2} aria-hidden="true" />}
                value={lessons.lessonsCount}
                label={`leçon${lessons.lessonsCount > 1 ? 's' : ''} notée${lessons.lessonsCount > 1 ? 's' : ''}`}
              />
              <StatTile
                icon={<MessageSquare className="h-4 w-4" strokeWidth={2} aria-hidden="true" />}
                value={lessons.annotationsCount}
                label={`correction${lessons.annotationsCount > 1 ? 's' : ''} reçue${lessons.annotationsCount > 1 ? 's' : ''}`}
              />
            </div>
          </section>
        </>
      )}
    </m.div>
  );
}

function StatTile({ icon, value, label }: { icon: React.ReactNode; value: number; label: string }) {
  return (
    <div className="rounded-control flex flex-col gap-1 border border-[var(--b-default)] bg-[var(--bg-2)] px-3.5 py-3">
      <span className="text-[var(--cy)]">{icon}</span>
      <span className="f-mono text-[22px] leading-none font-semibold tracking-[-0.02em] text-[var(--t-1)] tabular-nums">
        {value}
      </span>
      <span className="t-cap text-[var(--t-2)]">{label}</span>
    </div>
  );
}
