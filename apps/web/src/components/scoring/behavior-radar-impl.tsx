'use client';

import { m, useReducedMotion } from 'framer-motion';
import { useMemo } from 'react';
import {
  PolarAngleAxis,
  PolarGrid,
  PolarRadiusAxis,
  Radar,
  RadarChart,
  ResponsiveContainer,
  Tooltip,
} from 'recharts';

import type { BehavioralScoreTrendPoint, SerializedBehavioralScore } from '@/lib/scoring/service';
import { useChartColors } from '@/lib/use-chart-colors';

/**
 * « Ton profil comportemental » — radar des 4 dimensions (jalon 2, enrichissement).
 *
 * Une SEULE forme mémorisable (Discipline / Stabilité / Cohérence / Engagement)
 * plutôt que 4 jauges isolées : on voit d'un coup d'œil où le process est large
 * et où il se creuse. Calque fantôme « il y a ~30 j » pour lire la progression.
 *
 * Posture §2 / anti-Black-Hat (BLOQUANT) :
 *  - accent bleu uniquement, JAMAIS de rouge punitif ;
 *  - aucune dimension `null` n'est tracée comme 0 (anti-fabrication §33.5) — le
 *    radar n'apparaît que lorsque les 4 dimensions sont réellement calculées ;
 *  - zéro P&L, zéro conseil de marché.
 *
 * Hex `C.*` (jamais `var()`) pour le rendu SVG iOS WebView. Conteneur `figure`
 * à hauteur FIXE → `ResponsiveContainer` ne mesure jamais 0 (anti warning
 * Recharts `width(-1)` + anti-CLS). `role="img"` + résumé sr-only.
 */

const DIMS = [
  { key: 'discipline', label: 'Discipline' },
  { key: 'emotionalStability', label: 'Stabilité' },
  { key: 'consistency', label: 'Cohérence' },
  { key: 'engagement', label: 'Engagement' },
] as const;

type DimKey = (typeof DIMS)[number]['key'];

function allFour(p: {
  discipline: number | null;
  emotionalStability: number | null;
  consistency: number | null;
  engagement: number | null;
}): p is Record<DimKey, number> {
  return (
    p.discipline !== null &&
    p.emotionalStability !== null &&
    p.consistency !== null &&
    p.engagement !== null
  );
}

interface RadarRow {
  axis: string;
  value: number;
  prev: number | null;
}

interface BehaviorRadarTooltipPayload {
  dataKey?: string | number;
  value?: number;
  payload?: RadarRow;
}

function RadarTooltip({
  active,
  payload,
}: {
  active?: boolean;
  payload?: BehaviorRadarTooltipPayload[];
}) {
  const C = useChartColors();
  if (!active || !payload || payload.length === 0) return null;
  const row = payload[0]?.payload;
  if (!row) return null;
  return (
    <div
      className="rounded-control border border-[var(--b-default)] px-2.5 py-1.5 text-[12px] shadow-lg"
      style={{ background: C.bg3 }}
    >
      <span className="font-semibold text-[var(--t-1)]">{row.axis}</span>
      <span className="ml-2 text-[var(--t-1)] tabular-nums">{Math.round(row.value)}/100</span>
      {row.prev !== null ? (
        <span className="ml-1.5 text-[var(--t-4)] tabular-nums">
          (il y a ~30 j : {Math.round(row.prev)})
        </span>
      ) : null}
    </div>
  );
}

export function BehaviorRadar({
  score,
  history,
}: {
  score: SerializedBehavioralScore | null;
  history: BehavioralScoreTrendPoint[];
}) {
  const C = useChartColors();
  const prefersReduced = useReducedMotion();

  // Point de comparaison : le plus proche de « il y a ~30 j » AVANT la date du
  // snapshot courant, parmi les jours où les 4 dimensions sont calculées. Aucun
  // `Date.now()` (déterministe SSR/CSR) : l'ancre est la date du score.
  const comparison = useMemo(() => {
    if (!score || history.length === 0) return null;
    const anchorMs = Date.parse(score.date);
    const targetMs = anchorMs - 30 * 86_400_000;
    const full = history.filter((p) => Date.parse(p.date) < anchorMs && allFour(p));
    if (full.length === 0) return null;
    let best = full[0]!;
    let bestDiff = Math.abs(Date.parse(best.date) - targetMs);
    for (const p of full) {
      const diff = Math.abs(Date.parse(p.date) - targetMs);
      if (diff < bestDiff) {
        best = p;
        bestDiff = diff;
      }
    }
    return best as Record<DimKey, number> & { date: string };
  }, [score, history]);

  const today = score
    ? {
        discipline: score.disciplineScore,
        emotionalStability: score.emotionalStabilityScore,
        consistency: score.consistencyScore,
        engagement: score.engagementScore,
      }
    : null;

  const ready = today !== null && allFour(today);

  // État honnête : pas les 4 dimensions calculées → on n'invente pas de forme.
  if (!ready) {
    return (
      <figure className="rounded-card-lg flex h-[300px] flex-col items-center justify-center gap-2 border border-[var(--b-default)] bg-[var(--bg-1)] p-5 text-center">
        <span className="t-eyebrow">Ton profil comportemental</span>
        <figcaption className="t-cap max-w-[40ch] text-[var(--t-4)]">
          Ton radar s’affiche quand tes 4 dimensions sont calculées, quelques check-ins et trades
          clôturés suffisent. Une dimension sans donnée n’est jamais comptée comme 0.
        </figcaption>
      </figure>
    );
  }

  const rows: RadarRow[] = DIMS.map((d) => ({
    axis: d.label,
    value: today[d.key],
    prev: comparison ? comparison[d.key] : null,
  }));

  const hasComparison = comparison !== null;
  const cap = Math.round(rows.reduce((s, r) => s + r.value, 0) / rows.length);

  return (
    <m.figure
      initial={prefersReduced ? false : { opacity: 0, scale: 0.97 }}
      whileInView={{ opacity: 1, scale: 1 }}
      viewport={{ once: true, margin: '-40px' }}
      transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
      className="rounded-card-lg flex flex-col gap-3 border border-[var(--b-default)] bg-[var(--bg-1)] p-5"
      role="img"
      aria-label={`Radar comportemental : Discipline ${Math.round(rows[0]!.value)}, Stabilité ${Math.round(rows[1]!.value)}, Cohérence ${Math.round(rows[2]!.value)}, Engagement ${Math.round(rows[3]!.value)} sur 100. Équilibre moyen ${cap} sur 100.${hasComparison ? ' Comparé à il y a environ 30 jours.' : ''}`}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="t-eyebrow">Ton profil comportemental</span>
        <span className="t-mono-cap text-[var(--t-4)]">équilibre {cap}/100</span>
      </div>

      <div className="h-[260px] w-full" aria-hidden="true">
        <ResponsiveContainer width="100%" height={260} debounce={1}>
          <RadarChart
            data={rows}
            outerRadius="72%"
            margin={{ top: 8, right: 16, bottom: 8, left: 16 }}
          >
            <PolarGrid stroke={C.bStrong} />
            <PolarAngleAxis dataKey="axis" tick={{ fill: C.t2, fontSize: 12 }} tickLine={false} />
            <PolarRadiusAxis domain={[0, 100]} tick={false} axisLine={false} tickCount={5} />
            {hasComparison ? (
              <Radar
                name="il y a ~30 j"
                dataKey="prev"
                stroke={C.t4}
                strokeDasharray="4 4"
                strokeWidth={1.5}
                fill={C.t4}
                fillOpacity={0.05}
                isAnimationActive={!prefersReduced}
                animationDuration={700}
              />
            ) : null}
            <Radar
              name="Aujourd’hui"
              dataKey="value"
              stroke={C.acc}
              strokeWidth={2}
              fill={C.acc}
              fillOpacity={0.22}
              isAnimationActive={!prefersReduced}
              animationDuration={900}
            />
            <Tooltip content={<RadarTooltip />} />
          </RadarChart>
        </ResponsiveContainer>
      </div>

      {/* Légende honnête (les couleurs ne portent JAMAIS seules le sens — texte). */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
        <span className="inline-flex items-center gap-1.5 text-[12px] text-[var(--t-2)]">
          <span aria-hidden className="h-2 w-2 rounded-full bg-[var(--acc)]" />
          Aujourd’hui
        </span>
        {hasComparison ? (
          <span className="inline-flex items-center gap-1.5 text-[12px] text-[var(--t-4)]">
            <span aria-hidden className="h-0 w-3.5 border-t border-dashed border-[var(--t-4)]" />
            il y a ~30 j
          </span>
        ) : null}
      </div>

      <p className="t-cap text-[var(--t-4)]">
        Plus la forme est large et régulière, plus ton process est équilibré. C’est une lecture de
        ta discipline, jamais un conseil de marché.
      </p>
    </m.figure>
  );
}
