import { GraduationCap, ShieldCheck } from 'lucide-react';

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
 * no streak, no leaderboard, no red-on-pending. When a metric has too few
 * decided backtests we show "—" + a calm note rather than a misleading 0 %.
 */

function StatBlock({ label, value, hint }: { label: string; value: string; hint: string }) {
  return (
    <div className="flex min-w-[88px] flex-1 flex-col gap-1">
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
  } = stats;

  const winRate = decidedCount === 0 ? '—' : `${Math.round((winCount / decidedCount) * 100)} %`;

  const avgR = avgRNum == null ? '—' : `${avgRNum >= 0 ? '+' : ''}${avgRNum.toFixed(2)} R`;

  const systemRate =
    systemDecidedCount === 0
      ? '—'
      : `${Math.round((systemKeptCount / systemDecidedCount) * 100)} %`;

  // §33-1 "taux de complétude" — share of backtests run with an irreproachable
  // process (all four discipline-checklist items answered "respected"). A pure
  // discipline/completeness rate, never a P&L or market judgement (§21.5 +
  // garde-fou §2). "—" when there is no backtest yet (anti-Black-Hat: no
  // misleading 0 %); the denominator stays explicit in the hint.
  const processRate = total === 0 ? '—' : `${Math.round((checklistCleanCount / total) * 100)} %`;

  return (
    <section
      aria-label="Statistiques d'entraînement"
      className="rounded-card flex flex-wrap gap-x-6 gap-y-4 border border-[var(--b-default)] bg-[var(--bg-1)] p-4"
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
        label="Process complet"
        value={processRate}
        hint={
          total === 0
            ? 'checklist à remplir'
            : `checklist tenue sur ${total} backtest${total > 1 ? 's' : ''}`
        }
      />
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
}: {
  points: ReadonlyArray<TrainingEquityPoint>;
  /** Full-history backtest count (for the honest "sur les N affichés" framing). */
  total: number;
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
          <TrainingEquityChart points={points} />
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
