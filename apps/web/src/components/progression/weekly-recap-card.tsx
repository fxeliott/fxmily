import { CalendarRange, Flame, ListChecks, NotebookPen, ShieldCheck } from 'lucide-react';

import { InfoDot } from '@/components/ui/info-dot';
import { Card } from '@/components/ui/card';

/**
 * WeeklyRecapCard (S14) — "Ta semaine en chiffres".
 *
 * The first MEMBER-FACING surface that shows a CHIFFRÉ week-vs-week recap.
 * Until now the only numeric "vs semaine -1" comparison lived in the
 * coach/admin email (`weekly-digest.tsx`, prose written by Claude). This card
 * brings that operational signal to the member's retrospective page, computed
 * PURELY from the SAME aggregation that feeds the email (`buildWeeklySnapshot`
 * → `WeeklySnapshot.counters`) — no new heavy query, no new table.
 *
 * Posture is non-negotiable (SPEC §2 + anti-Black-Hat §31.2):
 *
 *   - INTEGRITY: a delta is only ever shown when BOTH weeks carry real,
 *     measured data for that metric. A `null` rate (nobody answered) is
 *     NEVER read as `0 %`; a metric whose previous week is absent shows the
 *     current value WITHOUT a fabricated delta. We never invent a trend on a
 *     single day of data — `hasEnoughData` gates the whole card.
 *   - ANTI-BLACK-HAT: a delta ramp is GREEN (`--ok`) when the metric rose and
 *     NEUTRAL GREY (`--t-3`) when it fell or stayed flat — there is NO red,
 *     NO punitive branch, NO "tu as baissé". A down week is surfaced calmly as
 *     a neutral fact, framed by process > outcome (Mark Douglas).
 *   - §2: behavioral process only (trades count, plan respect, streak,
 *     journaling) — zero market content, zero P&L, zero advice.
 *
 * The pure aggregator (`computeWeeklyRecap`) is DB-free and deterministic so it
 * is unit-testable under Vitest without a DB — it takes two already-serialized
 * counter snapshots (this week + last week) and returns the recap rows.
 */

// =============================================================================
// Pure types + aggregator (DB-free, unit-testable)
// =============================================================================

/**
 * The minimal slice of `WeeklySnapshot.counters` this card needs. Mirrors the
 * builder output WITHOUT importing the `server-only` schema, so the pure
 * aggregator stays testable. `null` rates mean "nobody answered" (honest empty
 * state) and must NEVER be coerced to 0.
 */
export interface WeeklyRecapCounters {
  /** Total trades entered in the week (count). */
  tradesTotal: number;
  /** Closed-trade plan-respect rate in [0,1], or `null` when no closed trade. */
  planRespectRate: number | null;
  /** Distinct days with at least one check-in (the week's streak proxy). */
  streakDays: number;
  /** Evening check-ins filled — the surface where journaling happens (count). */
  eveningCheckinsCount: number;
}

/** Stable identifiers for the four recap metrics, in canonical render order. */
export type WeeklyRecapMetricKey = 'trades' | 'planRespect' | 'streak' | 'journal';

/**
 * One rendered metric. `delta` is `null` when no trustworthy comparison is
 * possible (previous week absent, OR either side is a `null` rate). `direction`
 * drives the (calm) colour ramp: `up` → green, `flat`/`down` → neutral grey.
 * There is deliberately NO punitive state.
 */
export interface WeeklyRecapMetric {
  key: WeeklyRecapMetricKey;
  label: string;
  /** Formatted current value, e.g. "8", "75 %", "5 j". */
  display: string;
  /** Signed delta vs last week (already rounded), or `null` if not comparable. */
  delta: number | null;
  /** Formatted delta with unit + sign, e.g. "+2", "−10 pts", or `null`. */
  deltaDisplay: string | null;
  direction: 'up' | 'flat' | 'down' | 'none';
}

export type WeeklyRecap =
  | { kind: 'insufficient' }
  | { kind: 'recap'; metrics: WeeklyRecapMetric[]; hasPreviousWeek: boolean };

/**
 * A week is "real enough" to surface a recap once the member showed ANY
 * activity: at least one trade OR at least one check-in day. Below that, a "0"
 * everywhere would be a misleading non-event — we show the pedagogical empty
 * state instead. Deliberately low (a single active day is a legitimate recap of
 * "this week you did X once") but strictly above the all-zero non-event.
 */
function isActiveWeek(c: WeeklyRecapCounters): boolean {
  return c.tradesTotal > 0 || c.streakDays > 0 || c.eveningCheckinsCount > 0;
}

const round = (n: number): number => Math.round(n);

/** A delta whose magnitude rounds below this reads as "flat", not a move. */
const FLAT_EPSILON = 0;

/**
 * Build a count metric (trades, streak, journals). The delta is the raw count
 * difference, only when a previous week exists. Counts are never `null`, so the
 * only reason to omit a delta is the absence of a comparable previous week.
 */
function countMetric(
  key: WeeklyRecapMetricKey,
  label: string,
  current: number,
  previous: number | null,
  unit: '' | ' j',
): WeeklyRecapMetric {
  const display = `${current}${unit}`;
  if (previous === null) {
    return { key, label, display, delta: null, deltaDisplay: null, direction: 'none' };
  }
  const delta = current - previous;
  return {
    key,
    label,
    display,
    delta,
    deltaDisplay: formatSignedDelta(delta, unit.trim()),
    direction: directionOf(delta),
  };
}

/**
 * Build the plan-respect RATE metric. Both sides may be `null` ("nobody had a
 * closed trade that week" → no measured rate). A delta is shown ONLY when BOTH
 * weeks carry a real measured rate — otherwise we surface the current value (or
 * an honest "—") with no fabricated delta.
 */
function rateMetric(current: number | null, previous: number | null): WeeklyRecapMetric {
  const display = current === null ? '—' : `${round(current * 100)} %`;
  if (current === null || previous === null) {
    return {
      key: 'planRespect',
      label: 'Plan respecté',
      display,
      delta: null,
      deltaDisplay: null,
      direction: 'none',
    };
  }
  // Delta in percentage POINTS (not relative %), the same unit the email uses
  // ("75 % vs 65 %" → +10 pts).
  const delta = round(current * 100) - round(previous * 100);
  return {
    key: 'planRespect',
    label: 'Plan respecté',
    display,
    delta,
    deltaDisplay: formatSignedDelta(delta, 'pts'),
    direction: directionOf(delta),
  };
}

function directionOf(delta: number): WeeklyRecapMetric['direction'] {
  if (delta > FLAT_EPSILON) return 'up';
  if (delta < -FLAT_EPSILON) return 'down';
  return 'flat';
}

function formatSignedDelta(delta: number, unit: string): string {
  // Use a real minus sign (U+2212) for negatives so the ramp reads cleanly and
  // never looks like a hyphenated range. Zero is rendered as a calm "=".
  const u = unit ? ` ${unit}` : '';
  if (delta === 0) return `=${u}`.trimEnd();
  if (delta > 0) return `+${delta}${u}`;
  return `−${Math.abs(delta)}${u}`;
}

/**
 * Pure, deterministic week-vs-week recap from the member's OWN counters.
 *
 * Algorithm (no IA, fully reproducible):
 *  1. If THIS week shows no activity at all → `insufficient` (honest empty
 *     state). A recap of all-zeros is a misleading non-event.
 *  2. Build the four metrics. Each carries a delta ONLY when the previous week
 *     is present AND (for rates) both sides are measured (`!== null`). A `null`
 *     rate is never coerced to 0; an absent previous week yields a value with
 *     no delta (never a fabricated "+X").
 *  3. Direction drives a CALM colour ramp downstream: `up` → green, anything
 *     else → neutral grey. There is no red / no punitive branch by design.
 *
 * `previous` is `null` on a member's very first reported week (or when the
 * previous-week slice could not be loaded) — the card then shows current values
 * with zero invented deltas.
 */
export function computeWeeklyRecap(
  current: WeeklyRecapCounters,
  previous: WeeklyRecapCounters | null,
): WeeklyRecap {
  if (!isActiveWeek(current)) {
    return { kind: 'insufficient' };
  }

  const metrics: WeeklyRecapMetric[] = [
    countMetric('trades', 'Trades pris', current.tradesTotal, previous?.tradesTotal ?? null, ''),
    rateMetric(current.planRespectRate, previous?.planRespectRate ?? null),
    countMetric(
      'streak',
      'Jours de check-in',
      current.streakDays,
      previous?.streakDays ?? null,
      ' j',
    ),
    countMetric(
      'journal',
      'Journaux du soir',
      current.eveningCheckinsCount,
      previous?.eveningCheckinsCount ?? null,
      '',
    ),
  ];

  return { kind: 'recap', metrics, hasPreviousWeek: previous !== null };
}

// =============================================================================
// Presentation
// =============================================================================

const METRIC_ICON: Record<WeeklyRecapMetricKey, typeof ListChecks> = {
  trades: ListChecks,
  planRespect: ShieldCheck,
  streak: Flame,
  journal: NotebookPen,
};

const METRIC_TIP: Record<WeeklyRecapMetricKey, string> = {
  trades:
    'Nombre de trades enregistrés cette semaine. Un compte, jamais un objectif : trader moins peut être la bonne semaine.',
  planRespect:
    'Part de tes trades clôturés où tu as respecté ton plan. Le delta est en points de pourcentage vs la semaine précédente.',
  streak: 'Nombre de jours distincts où tu as fait au moins un check-in cette semaine.',
  journal:
    'Nombre de journaux du soir remplis cette semaine — le moment où tu poses des mots sur ton exécution.',
};

/**
 * Calm delta pill. Up → green ramp (`--ok`); flat / down / no-comparison →
 * neutral grey (`--t-3`). NEVER red, NEVER a punitive treatment (anti-Black-Hat
 * §31.2). A down week is a neutral fact, not a verdict.
 */
function DeltaPill({ metric }: { metric: WeeklyRecapMetric }) {
  if (metric.delta === null || metric.deltaDisplay === null) {
    return null;
  }
  const isUp = metric.direction === 'up';
  return (
    <span
      className={
        isUp
          ? 'rounded-control inline-flex items-center bg-[var(--ok-dim)] px-1.5 py-0.5 text-[11px] font-semibold text-[var(--ok)] tabular-nums'
          : 'rounded-control inline-flex items-center bg-[var(--bg-2)] px-1.5 py-0.5 text-[11px] font-semibold text-[var(--t-3)] tabular-nums'
      }
      title={`Variation vs la semaine précédente : ${metric.deltaDisplay}`}
    >
      {metric.deltaDisplay}
      <span className="sr-only"> vs semaine précédente</span>
    </span>
  );
}

/**
 * WeeklyRecapCard — renders the deterministic week-vs-week recap. Pure
 * (no interactivity beyond the InfoDot popovers), mobile-first, 0 overflow at
 * 375px (2-col grid that stays comfortable, values use tabular-nums so deltas
 * align). Reduced-motion safe (no animation introduced here).
 */
export function WeeklyRecapCard({
  current,
  previous,
  className = '',
}: {
  current: WeeklyRecapCounters;
  previous: WeeklyRecapCounters | null;
  className?: string;
}) {
  const recap = computeWeeklyRecap(current, previous);

  if (recap.kind === 'insufficient') {
    return (
      <Card className={`p-5 ${className}`.trim()} aria-label="Ta semaine en chiffres">
        <div className="flex items-start gap-3">
          <span
            aria-hidden="true"
            className="rounded-control mt-0.5 grid h-8 w-8 shrink-0 place-items-center border border-[var(--b-default)] bg-[var(--bg-2)] text-[var(--t-3)]"
          >
            <CalendarRange className="h-4 w-4" strokeWidth={1.75} />
          </span>
          <div className="flex min-w-0 flex-col gap-0.5">
            <span className="t-eyebrow text-[var(--t-3)]">Ta semaine en chiffres</span>
            <p className="t-body leading-[1.5] text-[var(--t-2)]">
              Dès tes premiers trades ou check-ins de la semaine, ton récap chiffré apparaîtra ici —
              avec l’écart calme par rapport à la semaine d’avant. Rien à forcer&nbsp;: chaque
              journée notée nourrit une lecture honnête.
            </p>
          </div>
        </div>
      </Card>
    );
  }

  return (
    <Card
      className={`p-5 ${className}`.trim()}
      aria-label="Ta semaine en chiffres"
      data-slot="weekly-recap-card"
    >
      <header className="mb-4 flex items-center gap-2">
        <CalendarRange
          className="h-3.5 w-3.5 text-[var(--t-3)]"
          strokeWidth={1.75}
          aria-hidden="true"
        />
        <h2 className="t-eyebrow text-[var(--t-3)]">Ta semaine en chiffres</h2>
      </header>

      <dl className="grid grid-cols-2 gap-3">
        {recap.metrics.map((metric) => {
          const Icon = METRIC_ICON[metric.key];
          return (
            <div
              key={metric.key}
              className="rounded-card flex min-w-0 flex-col gap-1.5 border border-[var(--b-default)] bg-[var(--bg-2)] p-3 transition-colors hover:border-[var(--b-acc)]"
              data-metric={metric.key}
            >
              <dt className="flex items-center gap-1.5">
                <Icon
                  className="h-3.5 w-3.5 shrink-0 text-[var(--t-3)]"
                  strokeWidth={1.75}
                  aria-hidden="true"
                />
                <span className="t-cap min-w-0 truncate text-[var(--t-3)]">{metric.label}</span>
                <InfoDot label={metric.label} tip={METRIC_TIP[metric.key]} />
              </dt>
              <dd className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                <span className="f-display text-[22px] leading-none font-bold tracking-[-0.02em] text-[var(--t-1)] tabular-nums">
                  {metric.display}
                </span>
                <DeltaPill metric={metric} />
              </dd>
            </div>
          );
        })}
      </dl>

      <p className="t-cap mt-4 leading-[1.5] text-[var(--t-3)]">
        {recap.hasPreviousWeek
          ? 'Écart calculé vs la semaine précédente. Un repère, pas un verdict — la régularité du process compte plus qu’un chiffre isolé.'
          : 'Première semaine mesurée : l’écart vs la semaine d’avant apparaîtra dès la semaine prochaine.'}
      </p>
    </Card>
  );
}
