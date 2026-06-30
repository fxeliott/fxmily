import { CalendarRange, GraduationCap, ShieldCheck } from 'lucide-react';

import { TrainingEquityChart, type TrainingEquityPoint } from './training-equity-card';

import type { TrainingTradeStats } from '@/lib/training/training-trade-service';

/**
 * Aggregate backtest stats for the `/training` landing (J-T2, SPEC §21).
 *
 * Fed a FULL-HISTORY SQL aggregate (`getTrainingTradeStatsForUser`) rather than
 * the rendered trade array, so the figures stay exact once the list is
 * cursor-paginated (S8 verification-layer fix).
 *
 * 🚨 These numbers are TRAINING-ONLY and never leave this surface
 * (statistical isolation §21.5). Posture (anti-Black-Hat / Mark Douglas):
 * no leaderboard, no red-on-pending; the day-streak (brief §269e / §182/§188) is
 * SOBER — a calm "N jours d'affilée", zero XP/badge/fanfare, no red on a break.
 * When a metric has too few decided backtests we show "—" + a calm note rather
 * than a misleading 0 %.
 *
 * Two bars, by design (mirror of the débrief's "Volume & régularité" vs the
 * quality families): `TrainingStatsBar` = practice RESULTS + discipline;
 * `TrainingRegularityBar` = §269 Enrichissement 1 EFFORT metrics (séances,
 * régularité, série, complétude des champs du journal). Both use a deterministic
 * responsive grid (never `flex-wrap`) so no lone block ever stretches across a
 * full row on intermediate tablet widths.
 */

function StatBlock({ label, value, hint }: { label: string; value: string; hint: string }) {
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <span className="t-eyebrow text-[var(--t-4)]">{label}</span>
      <span className="f-mono text-[20px] font-bold tracking-[-0.02em] text-[var(--t-1)] tabular-nums">
        {value}
      </span>
      <span className="t-cap text-[var(--t-4)]">{hint}</span>
    </div>
  );
}

export function TrainingStatsBar({ stats }: { stats: TrainingTradeStats }) {
  const {
    total,
    decidedCount,
    winCount,
    withRCount,
    avgR: avgRNum,
    systemDecidedCount,
    systemKeptCount,
    checklistCleanCount,
    checklistAnsweredCount,
  } = stats;

  const winRate = decidedCount === 0 ? '—' : `${Math.round((winCount / decidedCount) * 100)} %`;

  const avgR = avgRNum == null ? '—' : `${avgRNum >= 0 ? '+' : ''}${avgRNum.toFixed(2)} R`;

  const systemRate =
    systemDecidedCount === 0
      ? '—'
      : `${Math.round((systemKeptCount / systemDecidedCount) * 100)} %`;

  // §33-2 / §270 process-discipline checklist — share of the backtests where the
  // member ENGAGED the checklist that were run with an IRREPROACHABLE process
  // (all four items answered "respected"). A pure DISCIPLINE rate (act of
  // following the process), never a P&L or market judgement (§21.5 + garde-fou
  // §2). DISTINCT from the §269(d) "Journal rempli" completeness rate (which
  // counts field PRESENCE, not "respected") shown in the regularity bar — the
  // two were previously conflated under a "§33-1 taux de complétude" label.
  // Denominator = `checklistAnsweredCount` (≥1 item filled), NOT raw `total`:
  // legacy / untouched backtests (all four NULL after the ADD-only migration)
  // are excluded so they never drag the rate down (anti-Black-Hat — they aren't
  // a failure, just data we never asked for). "—" when nothing is filled yet;
  // the denominator stays explicit in the hint (mirrors `systemRate`).
  const processRate =
    checklistAnsweredCount === 0
      ? '—'
      : `${Math.round((checklistCleanCount / checklistAnsweredCount) * 100)} %`;

  return (
    <section
      aria-label="Statistiques d'entraînement"
      className="rounded-card grid grid-cols-2 gap-x-6 gap-y-4 border border-[var(--b-default)] bg-[var(--bg-1)] p-4 sm:grid-cols-3 md:grid-cols-5"
    >
      <StatBlock
        label="Backtests"
        value={String(total)}
        hint={total > 1 ? 'enregistrés' : 'enregistré'}
      />
      <StatBlock
        label="Win rate"
        value={winRate}
        hint={
          decidedCount === 0
            ? 'aucun résultat noté'
            : `sur ${decidedCount} décidé${decidedCount > 1 ? 's' : ''}`
        }
      />
      <StatBlock
        label="R moyen"
        value={avgR}
        hint={withRCount === 0 ? 'aucun R renseigné' : `sur ${withRCount}`}
      />
      <StatBlock
        label="Système tenu"
        value={systemRate}
        hint={systemDecidedCount === 0 ? 'non renseigné' : `sur ${systemDecidedCount}`}
      />
      <StatBlock
        label="Checklist tenue"
        value={processRate}
        hint={
          checklistAnsweredCount === 0
            ? 'checklist à remplir'
            : `sur ${checklistAnsweredCount} renseigné${checklistAnsweredCount > 1 ? 's' : ''}`
        }
      />
    </section>
  );
}

/**
 * §269 Enrichissement 1 — practice EFFORT metrics, separate from the results
 * bar above. Séances (§269a), régularité dans le temps (§269c), série de jours
 * (§269e), taux de complétude des champs du journal (§269d). All §21.5-safe
 * (count/recency/presence only, never a P&L) and SOBER (§188): no XP, no badge,
 * no red on a broken streak — a calm "—" empty state instead.
 */
export function TrainingRegularityBar({
  stats,
  sessionCount,
}: {
  stats: TrainingTradeStats;
  /** Number of backtest sessions (passed by the page — already loaded there). */
  sessionCount: number;
}) {
  const { activeDays30, currentDayStreak, longestDayStreak, fieldCompletionRate } = stats;

  const streakValue = currentDayStreak === 0 ? '—' : String(currentDayStreak);
  const streakHint =
    currentDayStreak === 0
      ? longestDayStreak > 0
        ? `record ${longestDayStreak} j`
        : 'jours consécutifs'
      : `jour${currentDayStreak > 1 ? 's' : ''} d'affilée${
          longestDayStreak > currentDayStreak ? ` · record ${longestDayStreak}` : ''
        }`;

  const fillValue =
    fieldCompletionRate == null ? '—' : `${Math.round(fieldCompletionRate * 100)} %`;

  return (
    <section
      aria-label="Régularité de la pratique"
      className="rounded-card flex flex-col gap-3 border border-[var(--b-default)] bg-[var(--bg-1)] p-4"
    >
      <div className="flex items-center gap-2">
        <CalendarRange className="h-4 w-4 text-[var(--cy)]" strokeWidth={1.75} aria-hidden="true" />
        <span className="t-eyebrow text-[var(--t-3)]">Régularité de la pratique</span>
      </div>
      <div className="grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-4">
        <StatBlock label="Séances" value={String(sessionCount)} hint="de backtest" />
        <StatBlock label="Régularité" value={`${activeDays30} j`} hint="actifs sur 30 j" />
        <StatBlock label="Série" value={streakValue} hint={streakHint} />
        <StatBlock
          label="Journal rempli"
          value={fillValue}
          hint={fieldCompletionRate == null ? 'aucun backtest' : 'champs renseignés'}
        />
      </div>
    </section>
  );
}

/**
 * TrainingEquityCard — a cyan AreaChart of the cumulative "système tenu" over
 * the visible backtests (S13 dataviz), sitting next to `TrainingStatsBar`.
 *
 * 🚨 §21.5 isolation: this is NOT a P&L / R equity curve. It plots the running
 * count of backtests where the member kept their own system — a discipline
 * signal, not a result. `points` is derived from the `enteredAt` /
 * `systemRespected` fields already on the rows the page rendered: zero new
 * query, zero `resultR`/`outcome` read.
 *
 * Edge (< 3 points): a calm pedagogical state instead of a misleading 2-dot
 * line (anti-Black-Hat — the absence of data is framed as "keep practising",
 * never as a failure).
 */
export function TrainingEquityCard({
  points,
  total,
  timezone,
}: {
  points: ReadonlyArray<TrainingEquityPoint>;
  /** Full-history backtest count (for the honest "sur les N affichés" framing). */
  total: number;
  /** F2 — member IANA timezone, threaded to the curve's day-axis labels. */
  timezone: string;
}) {
  const keptTotal = points.reduce((n, p) => n + (p.systemRespected === true ? 1 : 0), 0);
  const enough = points.length >= 3;

  return (
    <section
      aria-labelledby="training-equity-title"
      className="rounded-card flex flex-col gap-3 border border-[var(--cy-edge-soft)] bg-[var(--bg-1)] p-4"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <ShieldCheck className="h-4 w-4 text-[var(--cy)]" strokeWidth={1.75} aria-hidden="true" />
          <span className="t-eyebrow text-[var(--t-3)]" id="training-equity-title">
            Discipline cumulée
          </span>
        </div>
        <span className="t-mono-cap text-[var(--t-4)]">système tenu</span>
      </div>

      {enough ? (
        <>
          <TrainingEquityChart points={points} timezone={timezone} />
          <p className="t-cap text-[var(--t-4)]">
            Nombre de fois où tu as tenu ton système, cumulé sur tes {points.length} derniers
            backtests
            {total > points.length ? ` (sur ${total})` : ''}. Pas de P&amp;L : on mesure la
            répétition du geste propre.
          </p>
        </>
      ) : (
        <div className="rounded-control flex flex-col items-center gap-2 border border-dashed border-[var(--cy-edge-soft)] bg-[var(--cy-dim)] px-4 py-6 text-center">
          <GraduationCap
            className="h-5 w-5 text-[var(--cy)]"
            strokeWidth={1.75}
            aria-hidden="true"
          />
          <p className="t-cap text-[var(--t-2)]">
            Ta courbe de discipline apparaîtra après{' '}
            <strong className="text-[var(--t-1)] tabular-nums">3</strong> backtests.
          </p>
          <p className="t-foot text-[var(--t-4)]">
            {points.length === 0
              ? 'Note ton premier backtest pour démarrer.'
              : `${points.length} sur 3 · système tenu ${keptTotal} fois jusqu'ici.`}
          </p>
        </div>
      )}
    </section>
  );
}
