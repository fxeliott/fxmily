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
  } = stats;

  const winRate = decidedCount === 0 ? '—' : `${Math.round((winCount / decidedCount) * 100)} %`;

  const avgR = avgRNum == null ? '—' : `${avgRNum >= 0 ? '+' : ''}${avgRNum.toFixed(2)} R`;

  const systemRate =
    systemDecidedCount === 0
      ? '—'
      : `${Math.round((systemKeptCount / systemDecidedCount) * 100)} %`;

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
    </section>
  );
}
