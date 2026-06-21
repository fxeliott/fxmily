import { Sparkles, TrendingUp } from 'lucide-react';

/**
 * WeeklyInsightCard (D) — a calm, deterministic weekly "aha" on the dashboard.
 *
 * SPEC §7.5 (scoring surfaces) + §2 + anti-Black-Hat. This is NOT an AI feature:
 * the insight is a pure, reproducible read of the member's OWN last-7-days
 * behavioral scores. Posture is non-negotiable:
 *
 *   - INTEGRITY: we never assert a trend on too thin a sample. Below
 *     `MIN_INSIGHT_DAYS` days carrying ANY scored dimension → a pedagogical
 *     empty state, NEVER a fabricated "score 0" or invented "+X%". Scores are
 *     `null` on days a dimension was `insufficient_data` — those nulls are
 *     filtered, never read as zero.
 *   - ANTI-BLACK-HAT: the copy is factual + descriptive + one Mark Douglas
 *     micro-encouragement. Never "tu as baissé, fais mieux", never guilt, never
 *     FOMO, never a countdown. A "down" week is reframed as a process reminder,
 *     never a verdict.
 *   - §2: behavioral process only (discipline / mood / consistency / engagement),
 *     zero market content.
 *
 * Server Component (static, no interactivity). The pure aggregator below is
 * DB-free and deterministic — it lives in this module (not in the `server-only`
 * `@/lib/scoring/service`) so it is unit-testable under Vitest without a DB.
 */

/**
 * Structural shape of one behavioral-score trend point. Mirrors
 * `BehavioralScoreTrendPoint` from `@/lib/scoring/service` (a `server-only`
 * module) WITHOUT importing it, so the pure aggregator stays DB-free and
 * testable. Every dimension is `null` on a day it was `insufficient_data`.
 */
export interface WeeklyScorePoint {
  /** Local-day anchor `YYYY-MM-DD`. */
  date: string;
  discipline: number | null;
  emotionalStability: number | null;
  consistency: number | null;
  engagement: number | null;
}

/** The four behavioral dimensions, in canonical UI order. */
type Dimension = 'discipline' | 'emotionalStability' | 'consistency' | 'engagement';

const DIMENSIONS: readonly Dimension[] = [
  'discipline',
  'emotionalStability',
  'consistency',
  'engagement',
];

/** French labels — identical to the radar / gauges (no divergent vocabulary). */
const DIMENSION_LABEL: Record<Dimension, string> = {
  discipline: 'Discipline',
  emotionalStability: 'Stabilité',
  consistency: 'Cohérence',
  engagement: 'Engagement',
};

/**
 * Minimum number of days (in the window) that must carry AT LEAST one scored
 * dimension before we surface any insight. Below this, the honest move is the
 * pedagogical empty state — a constat on 1–2 days would mislead. Deliberately
 * small (this is a 7-day window, scores accrue slowly early on) but non-zero.
 */
export const MIN_INSIGHT_DAYS = 3;

/**
 * Minimum non-null values a single dimension needs in EACH half of the window
 * for its trend (rising/steady) to be trustworthy. A trend computed from one
 * point per half is noise, not signal.
 */
const MIN_PER_HALF = 2;

/** A rounded delta below this (in score points) reads as "flat", not a trend. */
const RISING_EPSILON = 1;

export type WeeklyInsight =
  | { kind: 'insufficient'; daysWithData: number; minDays: number }
  | {
      kind: 'rising';
      dimension: Dimension;
      label: string;
      /** Positive, rounded score-point gain across the week (later − earlier half). */
      delta: number;
      /** Rounded weekly average for the highlighted dimension. */
      average: number;
    }
  | {
      kind: 'steady';
      dimension: Dimension;
      label: string;
      /** Rounded weekly average for the highlighted dimension. */
      average: number;
    };

const round = (n: number): number => Math.round(n);
const mean = (xs: number[]): number => xs.reduce((a, b) => a + b, 0) / xs.length;

/** Non-null score values for one dimension, in chronological order. */
function valuesFor(points: readonly WeeklyScorePoint[], dim: Dimension): number[] {
  const out: number[] = [];
  for (const p of points) {
    const v = p[dim];
    if (v !== null && Number.isFinite(v)) out.push(v);
  }
  return out;
}

/**
 * Pure, deterministic weekly insight from the member's OWN last-7-days scores.
 *
 * Algorithm (no IA, fully reproducible):
 *  1. Keep only the most recent 7 points; count days carrying ANY scored
 *     dimension. Below `MIN_INSIGHT_DAYS` → `insufficient` (honest empty state).
 *  2. For each dimension with ≥ `MIN_PER_HALF` non-null values in BOTH the
 *     earlier and later half, compute the delta (later avg − earlier avg).
 *  3. The dimension with the largest positive delta (≥ `RISING_EPSILON`, ties
 *     broken by canonical order) → a `rising` constat (a real, calm win).
 *  4. If nothing is meaningfully rising, highlight the dimension with the
 *     highest weekly average → a `steady` constat. Never a "down" verdict:
 *     a flat/declining week is surfaced as the member's current anchor, framed
 *     by Mark Douglas (process > outcome), never as a reprimand.
 *
 * `slice(-7)` is applied internally so the caller may pass the full history.
 */
export function computeWeeklyInsight(history: readonly WeeklyScorePoint[]): WeeklyInsight {
  const points = history.slice(-7);

  const daysWithData = points.filter((p) =>
    DIMENSIONS.some((d) => p[d] !== null && Number.isFinite(p[d])),
  ).length;

  if (daysWithData < MIN_INSIGHT_DAYS) {
    return { kind: 'insufficient', daysWithData, minDays: MIN_INSIGHT_DAYS };
  }

  // Split chronologically; the later half is the more recent slice.
  const mid = Math.floor(points.length / 2);
  const earlier = points.slice(0, points.length - mid);
  const later = points.slice(points.length - mid);

  let best: { dim: Dimension; delta: number } | null = null;
  for (const dim of DIMENSIONS) {
    const e = valuesFor(earlier, dim);
    const l = valuesFor(later, dim);
    if (e.length < MIN_PER_HALF || l.length < MIN_PER_HALF) continue;
    const delta = mean(l) - mean(e);
    if (best === null || delta > best.delta) best = { dim, delta };
  }

  if (best !== null && round(best.delta) >= RISING_EPSILON) {
    const avg = valuesFor(points, best.dim);
    return {
      kind: 'rising',
      dimension: best.dim,
      label: DIMENSION_LABEL[best.dim],
      delta: round(best.delta),
      average: round(mean(avg)),
    };
  }

  // No meaningful rise → highlight the steadiest strength (highest weekly avg).
  let steady: { dim: Dimension; avg: number } | null = null;
  for (const dim of DIMENSIONS) {
    const vals = valuesFor(points, dim);
    if (vals.length === 0) continue;
    const avg = mean(vals);
    if (steady === null || avg > steady.avg) steady = { dim, avg };
  }

  // Defensive: daysWithData ≥ MIN_INSIGHT_DAYS guarantees at least one value,
  // but keep the type honest — fall back to the empty state rather than throw.
  if (steady === null) {
    return { kind: 'insufficient', daysWithData, minDays: MIN_INSIGHT_DAYS };
  }

  return {
    kind: 'steady',
    dimension: steady.dim,
    label: DIMENSION_LABEL[steady.dim],
    average: round(steady.avg),
  };
}

/**
 * WeeklyInsightCard — renders the deterministic weekly insight. Pure server
 * component: it computes the insight from the passed history and renders a calm
 * card. Mirrors `MonthlyDebriefWidget` styling (DS-v3 acc-dim glass tile).
 */
export function WeeklyInsightCard({
  history,
  className = '',
}: {
  history: readonly WeeklyScorePoint[];
  className?: string;
}) {
  const insight = computeWeeklyInsight(history);

  if (insight.kind === 'insufficient') {
    return (
      <aside
        className={`rounded-card flex items-start gap-3 border border-[var(--b-default)] bg-[var(--bg-1)] p-4 ${className}`.trim()}
        aria-label="Insight de la semaine"
      >
        <span
          aria-hidden="true"
          className="rounded-control mt-0.5 grid h-8 w-8 shrink-0 place-items-center border border-[var(--b-default)] bg-[var(--bg-2)] text-[var(--t-3)]"
        >
          <Sparkles className="h-4 w-4" strokeWidth={1.75} />
        </span>
        <div className="flex min-w-0 flex-col gap-0.5">
          <span className="t-eyebrow text-[var(--t-3)]">Insight de la semaine</span>
          <p className="t-body leading-[1.5] text-[var(--t-2)]">
            Encore quelques jours de check-ins et ton premier constat hebdo apparaîtra ici. Rien à
            forcer — chaque journée notée nourrit une lecture honnête de ta semaine.
          </p>
        </div>
      </aside>
    );
  }

  // Factual constat + a single Mark Douglas micro-encouragement. The "rising"
  // and "steady" branches are BOTH neutral/positive — there is no "down" branch
  // by design (anti-Black-Hat §2/§31.2: never a punitive verdict).
  const headline =
    insight.kind === 'rising'
      ? `${insight.label} en progression cette semaine`
      : `${insight.label}, ton point d'ancrage de la semaine`;

  const body =
    insight.kind === 'rising'
      ? `Sur tes 7 derniers jours, ta ${insight.label.toLowerCase()} gagne ${insight.delta} point${insight.delta > 1 ? 's' : ''} (moyenne ${insight.average}/100). Un trader gagnant, c'est d'abord une exécution répétée — continue à dérouler ton process.`
      : `Sur tes 7 derniers jours, ta ${insight.label.toLowerCase()} tient le mieux (moyenne ${insight.average}/100). C'est ton ancre du moment : la régularité du process compte plus que le résultat d'un trade isolé.`;

  return (
    <aside
      className={`rounded-card flex items-start gap-3 border border-[var(--b-acc)] bg-[var(--acc-dim)] p-4 ${className}`.trim()}
      aria-label="Insight de la semaine"
      data-slot="weekly-insight-card"
    >
      <span
        aria-hidden="true"
        className="rounded-control mt-0.5 grid h-8 w-8 shrink-0 place-items-center border border-[var(--b-acc-strong)] bg-[var(--acc)] text-[var(--acc-fg)]"
      >
        {insight.kind === 'rising' ? (
          <TrendingUp className="h-4 w-4" strokeWidth={1.75} />
        ) : (
          <Sparkles className="h-4 w-4" strokeWidth={1.75} />
        )}
      </span>
      <div className="flex min-w-0 flex-col gap-0.5">
        <span className="t-eyebrow text-[var(--acc-hi)]">Insight de la semaine</span>
        <p className="text-[15px] font-semibold text-[var(--t-1)]">{headline}</p>
        <p className="t-body leading-[1.5] text-[var(--t-2)]">{body}</p>
      </div>
    </aside>
  );
}
