import { Check, Minus, X } from 'lucide-react';

import { Card } from '@/components/ui/card';
import { Pill } from '@/components/ui/pill';
import type { SerializedTrainingTrade } from '@/lib/training/training-trade-service';

/**
 * Read-only backtest row for the `/training` list (J-T2, SPEC §21).
 *
 * No edit / delete here — corrections are admin-only and land in J-T3
 * (`TrainingAnnotation`). Pure presentation, DS-v2 tokens. The result is
 * shown for the member's own review only; it never feeds the real edge
 * (statistical isolation §21.5 — enforced upstream by the data layer).
 */

const DATE_FMT = new Intl.DateTimeFormat('fr-FR', {
  timeZone: 'Europe/Paris',
  day: '2-digit',
  month: 'short',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
});

const OUTCOME_LABEL: Record<string, string> = {
  win: 'Gagnant',
  loss: 'Perdant',
  break_even: 'Break-even',
};

export function TrainingTradeCard({ trade }: { trade: SerializedTrainingTrade }) {
  const outcomeTone = trade.outcome === 'win' ? 'ok' : trade.outcome === 'loss' ? 'bad' : 'cy';

  return (
    <Card className="flex flex-col gap-3 p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex flex-col gap-0.5">
          <span className="f-mono text-[15px] font-semibold tracking-[0.04em] text-[var(--t-1)]">
            {trade.pair}
          </span>
          <span className="t-cap text-[var(--t-4)] tabular-nums">
            {DATE_FMT.format(new Date(trade.enteredAt))}
          </span>
        </div>
        {trade.outcome ? (
          <Pill tone={outcomeTone}>{OUTCOME_LABEL[trade.outcome] ?? trade.outcome}</Pill>
        ) : (
          <Pill tone="mute">En attente</Pill>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-x-5 gap-y-2 border-t border-[var(--b-subtle)] pt-3">
        <Metric label="R:R prévu" value={`1:${Number(trade.plannedRR).toFixed(2)}`} />
        <Metric
          label="Résultat"
          value={
            trade.resultR == null
              ? '—'
              : `${Number(trade.resultR) >= 0 ? '+' : ''}${Number(trade.resultR).toFixed(2)} R`
          }
          tone={trade.resultR == null ? undefined : Number(trade.resultR) >= 0 ? 'ok' : 'bad'}
        />
        <div className="flex flex-col gap-0.5">
          <span className="t-eyebrow text-[var(--t-4)]">Système</span>
          <span className="inline-flex items-center gap-1 text-[13px] font-medium">
            {trade.systemRespected === true ? (
              <>
                <Check className="h-3.5 w-3.5 text-[var(--ok)]" strokeWidth={2.25} />
                <span className="text-[var(--ok)]">Respecté</span>
              </>
            ) : trade.systemRespected === false ? (
              <>
                <X className="h-3.5 w-3.5 text-[var(--bad)]" strokeWidth={2.25} />
                <span className="text-[var(--bad)]">Non respecté</span>
              </>
            ) : (
              <>
                <Minus className="h-3.5 w-3.5 text-[var(--t-4)]" strokeWidth={2.25} />
                <span className="text-[var(--t-4)]">N/A</span>
              </>
            )}
          </span>
        </div>
      </div>

      <div className="flex flex-col gap-1 border-t border-[var(--b-subtle)] pt-3">
        <span className="t-eyebrow text-[var(--t-4)]">Leçon tirée</span>
        <p className="t-body line-clamp-3 text-[var(--t-2)]">{trade.lessonLearned}</p>
      </div>
    </Card>
  );
}

function Metric({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: 'ok' | 'bad' | undefined;
}) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="t-eyebrow text-[var(--t-4)]">{label}</span>
      <span
        className={
          'f-mono text-[14px] font-semibold tabular-nums ' +
          (tone === 'ok'
            ? 'text-[var(--ok)]'
            : tone === 'bad'
              ? 'text-[var(--bad)]'
              : 'text-[var(--t-1)]')
        }
      >
        {value}
      </span>
    </div>
  );
}
