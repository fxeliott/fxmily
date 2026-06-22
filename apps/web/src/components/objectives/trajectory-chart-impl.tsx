'use client';

import { m, useReducedMotion } from 'framer-motion';
import { useId, useMemo } from 'react';
import {
  Area,
  CartesianGrid,
  ComposedChart,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

import type { TrajectoryProjection } from '@/lib/objectives/service';
import { useChartColors } from '@/lib/use-chart-colors';

/**
 * « Vers où je vais » — projection de la trajectoire discipline (jalon J4).
 *
 * Historique réel (ligne pleine) + projection vers la cible Maîtrise (ligne
 * pointillée) entourée d'une BANDE de prédiction qui s'élargit dans le temps
 * (fan chart) — jamais une promesse sèche. La cible 85 est une `ReferenceLine`.
 * Posture §2 : pas de P&L, aucune alarme, les jours non calculés ne sont jamais
 * comptés comme 0. Hex `C.*` (jamais `var()`) pour iOS WebView. Conteneur
 * `figure` à hauteur FIXE → `ResponsiveContainer` ne mesure jamais 0 (anti
 * warning Recharts `width(-1)/height(-1)` + anti-CLS).
 */

interface Row {
  date: string;
  label: string;
  hist: number | null;
  proj: number | null;
  band: [number, number] | null;
}

function frenchShort(iso: string): string {
  const [y, mo, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y!, mo! - 1, d!)).toLocaleDateString('fr-FR', {
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  });
}

interface TooltipPayloadItem {
  dataKey?: string | number;
  value?: number | number[];
  payload?: Row;
}

function TrajectoryTooltip({
  active,
  payload,
}: {
  active?: boolean;
  payload?: TooltipPayloadItem[];
}) {
  const C = useChartColors();
  if (!active || !payload || payload.length === 0) return null;
  const row = payload[0]?.payload;
  if (!row) return null;
  const value = row.hist ?? row.proj;
  if (value === null || value === undefined) return null;
  const isProjected = row.hist === null && row.proj !== null;
  return (
    <div
      className="rounded-control border border-[var(--b-default)] bg-[var(--bg-3)] px-2.5 py-1.5 text-[12px] shadow-lg"
      style={{ background: C.bg3 }}
    >
      <span className="text-[var(--t-3)]">{frenchShort(row.date)}</span>
      <span className="ml-2 font-semibold text-[var(--t-1)] tabular-nums">
        {Math.round(value)}/100
      </span>
      {isProjected ? <span className="ml-1.5 text-[var(--t-4)]">· projeté</span> : null}
    </div>
  );
}

export function TrajectoryChart({ trajectory }: { trajectory: TrajectoryProjection }) {
  const C = useChartColors();
  const prefersReduced = useReducedMotion();
  const bandId = useId();
  const { history, projected, target, etaLabel, insufficient, trend } = trajectory;

  const rows = useMemo<Row[]>(() => {
    const histRows: Row[] = history.map((p) => ({
      date: p.date,
      label: frenchShort(p.date),
      hist: p.value,
      proj: null,
      band: null,
    }));
    if (projected.length > 0 && histRows.length > 0) {
      const last = histRows[histRows.length - 1]!;
      // Point de jonction : la projection démarre exactement où finit l'histoire.
      last.proj = last.hist;
      last.band = [last.hist as number, last.hist as number];
      for (const p of projected) {
        histRows.push({
          date: p.date,
          label: frenchShort(p.date),
          hist: null,
          proj: p.value,
          band: [p.lo, p.hi],
        });
      }
    }
    return histRows;
  }, [history, projected]);

  // Moins de 2 points → pas de courbe possible (carbone le garde de ScoreTrendChart).
  if (history.length < 2) {
    return (
      <figure className="rounded-card-lg flex h-[200px] flex-col items-center justify-center gap-2 border border-[var(--b-default)] bg-[var(--bg-1)] p-4 text-center">
        <span className="t-eyebrow">Ta trajectoire vers la Maîtrise</span>
        <figcaption className="t-cap max-w-[36ch] text-[var(--t-4)]">
          Ta courbe apparaît dès le 2ᵉ jour de scores. Un instantané est enregistré chaque nuit —
          reviens demain pour voir où tu vas.
        </figcaption>
      </figure>
    );
  }

  const trendLabel =
    trend === 'up' ? 'en progression' : trend === 'down' ? 'en repli léger' : 'stable';

  return (
    <m.div
      initial={prefersReduced ? false : { opacity: 0, y: 8 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: '-40px' }}
      transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
      className="rounded-card-lg flex flex-col gap-3 border border-[var(--b-default)] bg-[var(--bg-1)] p-4"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="t-eyebrow" id="trajectory-title">
            Ta trajectoire vers la Maîtrise
          </span>
          <span className="t-mono-cap text-[var(--t-4)]">
            {history.length} jours · {trendLabel}
          </span>
        </div>
        {etaLabel ? (
          <span className="rounded-full border border-[var(--b-acc)] bg-[var(--acc-dim)] px-2.5 py-0.5 text-[11px] font-medium text-[var(--acc-hi)]">
            {etaLabel}
          </span>
        ) : null}
      </div>

      <figure
        className="h-[240px] w-full"
        role="img"
        aria-labelledby="trajectory-title"
        aria-describedby="trajectory-summary"
      >
        <figcaption id="trajectory-summary" className="sr-only">
          Évolution du score de discipline sur {history.length} jours, tendance {trendLabel}.
          {projected.length > 0
            ? ` Projection vers la cible Maîtrise de ${target} sur 100${etaLabel ? `, ${etaLabel}` : ''}.`
            : ' Pas encore de projection — continue d’observer ta régularité.'}
        </figcaption>
        <ResponsiveContainer width="100%" height={240} debounce={1}>
          <ComposedChart data={rows} margin={{ top: 8, right: 10, left: -18, bottom: 0 }}>
            <defs>
              {/* S18 — theme-aware premium fan fill for the prediction band.
                  Hex (not var()) for iOS WebView; per-instance id via useId so
                  two trajectories never share a gradient. Mono-accent (--acc),
                  fades 0.18 → 0.03 so the uncertainty cone reads as a soft cool
                  haze, never a hard block. */}
              <linearGradient id={bandId} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={C.acc} stopOpacity={0.18} />
                <stop offset="100%" stopColor={C.acc} stopOpacity={0.03} />
              </linearGradient>
            </defs>
            <CartesianGrid stroke={C.bSubtle} strokeDasharray="3 3" vertical={false} />
            <XAxis
              dataKey="label"
              stroke={C.t4}
              tick={{ fontSize: 11, fill: C.t4 }}
              tickLine={false}
              axisLine={false}
              interval="preserveStartEnd"
              minTickGap={28}
            />
            <YAxis
              domain={[0, 100]}
              ticks={[0, 25, 50, 75, 100]}
              stroke={C.t4}
              tick={{ fontSize: 11, fill: C.t4 }}
              tickLine={false}
              axisLine={false}
              width={32}
            />
            <Tooltip
              content={<TrajectoryTooltip />}
              cursor={{ stroke: C.bStrong, strokeDasharray: '3 3' }}
            />
            <ReferenceLine
              y={target}
              stroke={C.acc}
              strokeDasharray="5 4"
              strokeOpacity={0.55}
              label={{
                value: `Maîtrise ${target}`,
                position: 'insideTopRight',
                fill: C.acc,
                fontSize: 10,
              }}
            />
            {/* Bande de prédiction (fan) — n'apparaît que sur la portion projetée. */}
            <Area
              type="monotone"
              dataKey="band"
              stroke="none"
              fill={`url(#${bandId})`}
              connectNulls
              dot={false}
              activeDot={false}
              isAnimationActive={!prefersReduced}
              animationDuration={700}
            />
            {/* Historique réel — ligne pleine accent. */}
            <Line
              type="monotone"
              dataKey="hist"
              stroke={C.acc}
              strokeWidth={2.5}
              dot={false}
              connectNulls
              isAnimationActive={!prefersReduced}
              animationDuration={900}
            />
            {/* Projection — ligne pointillée plus discrète. */}
            <Line
              type="monotone"
              dataKey="proj"
              stroke={C.acc}
              strokeWidth={2}
              strokeOpacity={0.6}
              strokeDasharray="5 5"
              dot={false}
              connectNulls
              isAnimationActive={!prefersReduced}
              animationDuration={900}
            />
          </ComposedChart>
        </ResponsiveContainer>
      </figure>

      <p className="t-cap text-[var(--t-4)]">
        {insufficient
          ? 'Projection disponible dès quelques jours de scores. Les jours non calculés ne sont jamais comptés comme 0.'
          : 'Estimation à partir de ton rythme récent — une tendance, pas une promesse. Aucun conseil de marché.'}
      </p>
    </m.div>
  );
}
