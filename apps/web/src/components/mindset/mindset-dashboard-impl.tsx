'use client';

import { m, useReducedMotion } from 'framer-motion';
import {
  Line,
  LineChart,
  PolarAngleAxis,
  PolarGrid,
  PolarRadiusAxis,
  Radar,
  RadarChart,
  ResponsiveContainer,
  Tooltip,
} from 'recharts';

import type { MindsetDimensionTrend, MindsetProfile } from '@/lib/mindset/profile';
import { useChartColors } from '@/lib/use-chart-colors';

/**
 * V1.5 — MindsetCheck premium dashboard (SPEC §27.4 — "ultra-visuel premium",
 * anti Black-Hat). DS-v2 NEUTRAL/lime — NEVER cyan (§21.7), NEVER `.v18-theme`
 * (REFLECT). Recharts gets HEX literals from `C`, NEVER `var()` (J6.6 WebView
 * iOS flat-black bug). Every chart carries a `<figcaption className="sr-only">`
 * textual equivalent (WCAG 2.2 AA — info never color-only).
 *
 * Honesty (SPEC §27.4): an absent / incomplete profile shows a CALM
 * pedagogical state, NEVER a fabricated 0 radar. Trends are intra-version
 * ONLY (§27.7 — the latest contiguous same-instrument-version segment) and a
 * week with no check is an honest GAP (null point, line broken — never
 * extrapolated). Strengths-based reading (Steenbarger canon §23): lead with
 * the point of leverage, frame the attention axis without shaming.
 */

interface MindsetDashboardProps {
  latestProfile: MindsetProfile | null;
  trend: readonly MindsetDimensionTrend[];
  /** Current instrument version — trends are only compared within it (§27.7). */
  instrumentVersion: number;
}

function isComplete(p: MindsetProfile): boolean {
  return p.overall !== null && p.dimensions.every((d) => d.score !== null);
}

export function MindsetDashboard({
  latestProfile,
  trend,
  instrumentVersion,
}: MindsetDashboardProps) {
  const prefersReducedMotion = useReducedMotion();

  if (!latestProfile || !isComplete(latestProfile)) {
    return (
      <div
        className="rounded-card-lg border border-dashed border-[var(--b-strong)] p-6 text-center"
        data-slot="mindset-dashboard-empty"
      >
        <p className="t-eyebrow-lg text-[var(--t-3)]">Ton profil mental</p>
        <p className="t-body mt-2 text-[var(--t-2)]">
          Ton profil apparaîtra ici dès ta première auto-évaluation complète. Il n&apos;y a pas de
          bonne ni de mauvaise réponse — juste un instantané honnête, semaine après semaine.
        </p>
      </div>
    );
  }

  const scored = latestProfile.dimensions.filter(
    (d): d is typeof d & { score: number } => d.score !== null,
  );
  const strongest = scored.reduce((a, b) => (b.score > a.score ? b : a));
  const attention = scored.reduce((a, b) => (b.score < a.score ? b : a));

  return (
    <m.div
      initial={prefersReducedMotion ? false : { opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
      className="flex flex-col gap-4"
      data-slot="mindset-dashboard"
    >
      {/* Strengths-based structured reading — calm, no scoreboard. */}
      <section className="rounded-card-lg flex flex-col gap-3 border border-[var(--b-default)] bg-[var(--bg-1)] p-4">
        <div className="flex items-baseline justify-between gap-3">
          <span className="t-eyebrow-lg text-[var(--t-3)]">Lecture de la semaine</span>
          <span className="t-mono-cap text-[var(--t-4)]">
            profil global <span className="text-[var(--acc)]">{latestProfile.overall}/100</span>
          </span>
        </div>
        <p className="t-body text-[var(--t-2)]">
          <strong className="text-[var(--t-1)]">Point d&apos;appui :</strong> {strongest.label}{' '}
          <span className="font-mono text-[var(--t-3)]">({strongest.score}/100)</span>. C&apos;est
          la dimension sur laquelle t&apos;appuyer cette semaine.
        </p>
        <p className="t-body text-[var(--t-2)]">
          <strong className="text-[var(--t-1)]">Axe d&apos;attention :</strong> {attention.label}{' '}
          <span className="font-mono text-[var(--t-3)]">({attention.score}/100)</span> — non pas une
          faille, un endroit où un peu d&apos;attention rapporte le plus. Pas de jugement :
          c&apos;est un instantané, pas une note.
        </p>
      </section>

      <ProfileRadar dims={scored} prefersReducedMotion={!!prefersReducedMotion} />

      <DimensionTrends
        trend={trend}
        instrumentVersion={instrumentVersion}
        prefersReducedMotion={!!prefersReducedMotion}
      />
    </m.div>
  );
}

// ---------------------------------------------------------------------------
// Profile radar (6 dimensions, 0–100)
// ---------------------------------------------------------------------------

function ProfileRadar({
  dims,
  prefersReducedMotion,
}: {
  // Only complete dimensions (score is a real number) — the caller renders
  // this exclusively under `isComplete`. No `?? 0` ⇒ a "fake 0" axis is
  // structurally impossible (SPEC §27.4 honesty, even for a future caller).
  dims: readonly { readonly label: string; readonly score: number }[];
  prefersReducedMotion: boolean;
}) {
  const C = useChartColors();
  const data = dims.map((d) => ({
    dimension: d.label,
    score: d.score,
  }));
  const summary = dims.map((d) => `${d.label} ${d.score} sur 100`).join(', ');

  return (
    <section className="rounded-card-lg flex flex-col gap-3 border border-[var(--b-default)] bg-[var(--bg-1)] p-4">
      <span className="t-eyebrow-lg text-[var(--t-3)]" id="mindset-radar-title">
        Profil mental — 6 dimensions
      </span>
      <figure
        className="h-[300px] w-full"
        role="img"
        aria-labelledby="mindset-radar-title"
        aria-describedby="mindset-radar-summary"
      >
        <figcaption id="mindset-radar-summary" className="sr-only">
          Profil mental sur 6 dimensions, échelle 0 à 100 : {summary}.
        </figcaption>
        <ResponsiveContainer width="100%" height="100%">
          <RadarChart data={data} outerRadius="72%">
            {/* bStrong (0.22) not bSubtle (0.08): mirror the behavioral radar so
                the concentric rings + spider web read against the 0/25/50/75/100
                ticks. At 0.08 on --bg-1 the reference grid is near-invisible. */}
            <PolarGrid stroke={C.bStrong} />
            <PolarAngleAxis dataKey="dimension" tick={{ fontSize: 11, fill: C.t3 }} />
            <PolarRadiusAxis
              angle={90}
              domain={[0, 100]}
              tick={{ fontSize: 10, fill: C.t4 }}
              tickCount={5}
              axisLine={false}
            />
            <Radar
              dataKey="score"
              stroke={C.acc}
              strokeWidth={2}
              fill={C.acc}
              fillOpacity={0.22}
              isAnimationActive={!prefersReducedMotion}
              animationDuration={800}
            />
            <Tooltip
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
                return [Number.isFinite(v) ? `${v}/100` : '—', 'Score'];
              }}
            />
          </RadarChart>
        </ResponsiveContainer>
      </figure>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Per-dimension trend small-multiples (intra-version, honest gaps)
// ---------------------------------------------------------------------------

function addDaysIso(iso: string, days: number): string {
  const [y, m, d] = iso.split('-').map(Number) as [number, number, number];
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + days);
  return dt.toISOString().slice(0, 10);
}

/**
 * Build a DENSE weekly series (Mondays from first→last) for one dimension's
 * latest same-version segment, with `null` where there is no check that week.
 * `connectNulls={false}` then BREAKS the line at gaps — an honest "trou", never
 * an extrapolated straight line (SPEC §27.4). Pure.
 */
function densifyLatestSegment(
  trendForDim: MindsetDimensionTrend,
  instrumentVersion: number,
): { week: string; score: number | null }[] {
  // Latest contiguous same-version run that matches the current instrument
  // (§27.7 — never compare across versions).
  const segments = trendForDim.segments.filter(
    (seg) => seg.length > 0 && seg[0]!.version === instrumentVersion,
  );
  const seg = segments[segments.length - 1];
  if (!seg || seg.length === 0) return [];
  const byWeek = new Map(seg.map((p) => [p.weekStart, p.score]));
  const first = seg[0]!.weekStart;
  const last = seg[seg.length - 1]!.weekStart;
  const out: { week: string; score: number | null }[] = [];
  let cursor = first;
  // Hard cap (52 weeks) — defensive against a malformed range, never loops.
  for (let i = 0; i < 53 && cursor <= last; i += 1) {
    out.push({ week: cursor, score: byWeek.has(cursor) ? byWeek.get(cursor)! : null });
    cursor = addDaysIso(cursor, 7);
  }
  return out;
}

const FMT_TREND_DAY = new Intl.DateTimeFormat('fr-FR', {
  day: 'numeric',
  month: 'short',
  timeZone: 'UTC',
});

function DimensionTrends({
  trend,
  instrumentVersion,
  prefersReducedMotion,
}: {
  trend: readonly MindsetDimensionTrend[];
  instrumentVersion: number;
  prefersReducedMotion: boolean;
}) {
  const C = useChartColors();
  const dims = trend
    .map((t) => ({ trend: t, series: densifyLatestSegment(t, instrumentVersion) }))
    .filter((d) => d.series.length > 0);

  if (dims.length === 0) return null;

  const anyMultiPoint = dims.some((d) => d.series.filter((p) => p.score !== null).length >= 2);

  return (
    <section className="rounded-card-lg flex flex-col gap-3 border border-[var(--b-default)] bg-[var(--bg-1)] p-4">
      <div className="flex items-baseline justify-between gap-3">
        <span className="t-eyebrow-lg text-[var(--t-3)]">Tendance par dimension</span>
        <span className="t-cap text-[var(--t-4)]">
          version {instrumentVersion} de l&apos;instrument
        </span>
      </div>
      {!anyMultiPoint ? (
        <p className="t-cap text-[var(--t-3)]">
          La tendance se dessinera après quelques semaines. Une semaine sans auto-évaluation reste
          un trou honnête — jamais comblé artificiellement.
        </p>
      ) : null}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {dims.map(({ trend: t, series }) => {
          const valid = series.filter(
            (p): p is { week: string; score: number } => p.score !== null,
          );
          const titleId = `trend-${t.dimensionId}-title`;
          const descId = `trend-${t.dimensionId}-desc`;
          const last = valid[valid.length - 1];
          const first = valid[0];
          return (
            <div
              key={t.dimensionId}
              className="rounded-card flex flex-col gap-2 border border-[var(--b-default)] bg-[var(--bg-2)] p-3"
            >
              <div className="flex items-baseline justify-between gap-2">
                <span className="t-cap font-medium text-[var(--t-1)]" id={titleId}>
                  {t.label}
                </span>
                <span className="t-mono-cap text-[var(--t-3)]">
                  {last ? `${last.score}/100` : '—'}
                </span>
              </div>
              <figure
                className="h-[88px] w-full"
                role="img"
                aria-labelledby={titleId}
                aria-describedby={descId}
              >
                <figcaption id={descId} className="sr-only">
                  {valid.length < 2
                    ? `${t.label} : une seule mesure (${last?.score ?? '—'} sur 100) — pas encore de tendance.`
                    : `${t.label} : de ${first?.score ?? '—'} à ${last?.score ?? '—'} sur 100, sur ${valid.length} auto-évaluations. Les semaines manquantes ne sont pas extrapolées.`}
                </figcaption>
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={series} margin={{ top: 6, right: 6, left: -28, bottom: 0 }}>
                    <Line
                      type="monotone"
                      dataKey="score"
                      stroke={C.acc}
                      strokeWidth={2}
                      dot={{ r: 2, fill: C.acc }}
                      connectNulls={false}
                      isAnimationActive={!prefersReducedMotion}
                      animationDuration={700}
                    />
                    <Tooltip
                      contentStyle={{
                        background: C.bg3,
                        border: `1px solid ${C.bDefault}`,
                        borderRadius: 8,
                        fontSize: 12,
                      }}
                      labelStyle={{ color: C.t2 }}
                      itemStyle={{ color: C.t1 }}
                      labelFormatter={(label) => {
                        const s = String(label);
                        const [y, mo, d] = s.split('-').map(Number) as [number, number, number];
                        return Number.isFinite(y)
                          ? `Semaine du ${FMT_TREND_DAY.format(new Date(Date.UTC(y, mo - 1, d)))}`
                          : s;
                      }}
                      formatter={(value) => {
                        const v = typeof value === 'number' ? value : Number(value);
                        return [Number.isFinite(v) ? `${v}/100` : '—', t.label];
                      }}
                    />
                  </LineChart>
                </ResponsiveContainer>
              </figure>
            </div>
          );
        })}
      </div>
    </section>
  );
}
