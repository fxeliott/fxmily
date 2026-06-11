import type { ConstancyScoreView } from '@/lib/verification/constancy';

/**
 * S3 — constancy score card (`/verification`). Calm, anti-Black-Hat §33.2:
 * no red shaming, no streaks — three quiet bars + honest axis labels. Null
 * axes render « pas encore évaluable » (§33.6: no proof ⇒ no honesty verdict,
 * never a fake 100). Native markup only (mirror `ScoreBreakdown` 0-JS canon).
 */

const AXES: ReadonlyArray<{
  key: 'honesty' | 'regularity' | 'discipline';
  label: string;
  hint: string;
}> = [
  {
    key: 'honesty',
    label: 'Honnêteté',
    hint: 'Ton déclaré confronté à ton historique MT5 fourni',
  },
  {
    key: 'regularity',
    label: 'Régularité',
    hint: 'Tes check-ins remplis, jour après jour',
  },
  {
    key: 'discipline',
    label: 'Faire face',
    hint: 'Les écarts que tu as regardés en face (motif ou prise en compte)',
  },
];

const PERIOD_FMT = new Intl.DateTimeFormat('fr-FR', {
  day: 'numeric',
  month: 'short',
  timeZone: 'Europe/Paris',
});

export function ConstancyScoreCard({ score }: { score: ConstancyScoreView | null }) {
  if (!score) {
    return (
      <div className="rounded-card border border-dashed border-[var(--b-default)] bg-[var(--bg-1)] px-4 py-5">
        <span className="t-body text-[var(--t-3)]">
          Ton score de constance se construira avec tes premiers check-ins et tes premières preuves.
          Rien à rattraper — il commence quand tu commences.
        </span>
      </div>
    );
  }

  return (
    <div className="rounded-card flex flex-col gap-4 border border-[var(--b-default)] bg-[var(--bg-1)] p-4">
      <div className="flex items-baseline justify-between gap-3">
        <div className="flex flex-col gap-0.5">
          <span className="t-eyebrow text-[var(--t-3)]">Score de constance</span>
          <span className="t-cap text-[var(--t-4)]">
            Semaine du {PERIOD_FMT.format(score.periodStart)}
          </span>
        </div>
        <span className="f-mono text-[28px] font-bold text-[var(--t-1)] tabular-nums">
          {Math.round(score.value)}
          <span className="text-[14px] font-normal text-[var(--t-4)]">/100</span>
        </span>
      </div>

      <ul className="flex flex-col gap-2.5">
        {AXES.map((axis) => {
          const value = score.breakdown[axis.key];
          const pct = value === null ? null : Math.round(value);
          return (
            <li key={axis.key} className="flex flex-col gap-1">
              <div className="flex items-baseline justify-between gap-3">
                <span className="text-[12px] text-[var(--t-2)]">{axis.label}</span>
                <span className="f-mono text-[12px] text-[var(--t-3)] tabular-nums">
                  {pct === null ? 'pas encore évaluable' : `${pct}%`}
                </span>
              </div>
              <div
                role="img"
                aria-label={
                  pct === null ? `${axis.label} : pas encore évaluable` : `${axis.label} : ${pct}%`
                }
                className="rounded-pill h-1.5 overflow-hidden bg-[var(--bg-3)]"
              >
                {pct !== null ? (
                  <div
                    className="rounded-pill h-full bg-[var(--cy)]"
                    style={{ width: `${Math.max(2, pct)}%` }}
                  />
                ) : null}
              </div>
              <span className="t-foot text-[var(--t-4)]">{axis.hint}</span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
