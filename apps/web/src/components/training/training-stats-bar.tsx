import type { SerializedTrainingTrade } from '@/lib/training/training-trade-service';

/**
 * Aggregate backtest stats for the `/training` landing (J-T2, SPEC §21).
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

export function TrainingStatsBar({ trades }: { trades: SerializedTrainingTrade[] }) {
  const total = trades.length;

  const decided = trades.filter((t) => t.outcome === 'win' || t.outcome === 'loss');
  const wins = decided.filter((t) => t.outcome === 'win').length;
  const winRate = decided.length === 0 ? '—' : `${Math.round((wins / decided.length) * 100)} %`;

  const withR = trades
    .map((t) => (t.resultR == null ? null : Number(t.resultR)))
    .filter((r): r is number => r != null && Number.isFinite(r));
  const avgRNum = withR.length === 0 ? null : withR.reduce((a, b) => a + b, 0) / withR.length;
  const avgR = avgRNum == null ? '—' : `${avgRNum >= 0 ? '+' : ''}${avgRNum.toFixed(2)} R`;

  const systemDecided = trades.filter((t) => t.systemRespected != null);
  const systemKept = systemDecided.filter((t) => t.systemRespected === true).length;
  const systemRate =
    systemDecided.length === 0 ? '—' : `${Math.round((systemKept / systemDecided.length) * 100)} %`;

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
          decided.length === 0
            ? 'aucun résultat noté'
            : `sur ${decided.length} décidé${decided.length > 1 ? 's' : ''}`
        }
      />
      <StatBlock
        label="R moyen"
        value={avgR}
        hint={withR.length === 0 ? 'aucun R renseigné' : `sur ${withR.length}`}
      />
      <StatBlock
        label="Système tenu"
        value={systemRate}
        hint={systemDecided.length === 0 ? 'non renseigné' : `sur ${systemDecided.length}`}
      />
    </section>
  );
}
