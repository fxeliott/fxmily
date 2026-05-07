import { Activity, ArrowDownRight, ArrowUpRight, Sigma } from 'lucide-react';

import { Pill } from '@/components/ui/pill';
import type { ExpectancyResult } from '@/lib/analytics';

import { SampleSizeDisclaimer } from './sample-size-disclaimer';

/**
 * Numeric cell strip for expectancy / profit factor / win rate / payoff.
 *
 * Server Component — pure presentation over the `ExpectancyResult` shape.
 */
interface ExpectancyCardProps {
  expectancy: ExpectancyResult;
}

function fmtR(value: number | null): string {
  if (value === null) return '—';
  const sign = value > 0 ? '+' : '';
  return `${sign}${value.toFixed(2)}R`;
}

function fmtPct(value: number): string {
  return `${(value * 100).toFixed(0)}%`;
}

function fmtPF(value: number | null): string {
  if (value === null) return '—';
  if (value >= 999) return '∞';
  return value.toFixed(2);
}

export function ExpectancyCard({ expectancy }: ExpectancyCardProps) {
  const e = expectancy;
  const isInsufficient = e.expectancyR === null;
  const expectancyTone =
    e.expectancyR === null
      ? 'text-[var(--t-3)]'
      : e.expectancyR > 0
        ? 'text-[var(--acc)]'
        : 'text-[var(--bad)]';

  return (
    <div className="rounded-card-lg flex flex-col gap-3 border border-[var(--b-default)] bg-[var(--bg-1)] p-4">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Sigma className="h-3.5 w-3.5 text-[var(--t-3)]" strokeWidth={1.75} aria-hidden="true" />
          <span className="t-eyebrow">Edge mathématique</span>
        </div>
        <SampleSizeDisclaimer
          current={e.sampleSize.closedTrades}
          minimum={20}
          unit="trades"
          variant="pill"
        />
      </div>

      {isInsufficient ? (
        <p className="t-cap text-[var(--t-3)]">
          {e.reason === 'no_computed_trades'
            ? "Renseigne le stop-loss à l'ouverture pour activer le calcul d'expectancy précis."
            : 'Pas encore de trades clôturés sur la fenêtre.'}
        </p>
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Metric
            label="Expectancy"
            value={fmtR(e.expectancyR)}
            tone={expectancyTone}
            hint="par trade"
            icon={
              e.expectancyR! > 0 ? (
                <ArrowUpRight className="h-3 w-3" strokeWidth={1.75} aria-hidden="true" />
              ) : (
                <ArrowDownRight className="h-3 w-3" strokeWidth={1.75} aria-hidden="true" />
              )
            }
          />
          <Metric
            label="Profit factor"
            value={fmtPF(e.profitFactor)}
            tone={
              (e.profitFactor ?? 0) > 1.5
                ? 'text-[var(--acc)]'
                : (e.profitFactor ?? 0) > 1
                  ? 'text-[var(--ok)]'
                  : 'text-[var(--bad)]'
            }
            hint="gross win / gross loss"
          />
          <Metric
            label="Win rate"
            value={fmtPct(e.winRate)}
            hint={`${e.sampleSize.closedTrades} trades`}
            tone="text-[var(--t-1)]"
          />
          <Metric
            label="Payoff R:R"
            value={e.payoffRatio === null ? '—' : `1:${e.payoffRatio.toFixed(2)}`}
            hint="avg win / avg loss"
            tone="text-[var(--t-1)]"
          />
        </div>
      )}

      {e.sampleSize.estimatedTrades > 0 ? (
        <div className="flex items-center gap-2">
          <Pill tone="cy">EXCLU</Pill>
          <span className="t-cap text-[var(--t-4)]">
            {e.sampleSize.estimatedTrades} trade{e.sampleSize.estimatedTrades > 1 ? 's' : ''} estimé
            {e.sampleSize.estimatedTrades > 1 ? 's' : ''} hors expectancy (stop-loss manquant).
          </span>
        </div>
      ) : null}
    </div>
  );
}

function Metric({
  label,
  value,
  hint,
  tone,
  icon,
}: {
  label: string;
  value: string;
  hint?: string;
  tone: string;
  icon?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1">
      <span className="t-mono-cap text-[var(--t-4)]">{label}</span>
      <span
        className={`f-mono inline-flex items-center gap-1 text-[20px] font-semibold tabular-nums leading-none tracking-[-0.02em] ${tone}`}
      >
        {icon}
        {value}
      </span>
      {hint ? <span className="t-cap text-[var(--t-4)]">{hint}</span> : null}
    </div>
  );
}

export function DrawdownStreaksCard({
  drawdown,
  observedMaxLoss,
  observedMaxWin,
}: {
  drawdown: { maxDrawdownR: number; inDrawdown: boolean; currentDrawdownR: number };
  observedMaxLoss: number;
  observedMaxWin: number;
}) {
  const inDD = drawdown.inDrawdown;
  return (
    <div className="rounded-card-lg flex flex-col gap-3 border border-[var(--b-default)] bg-[var(--bg-1)] p-4">
      <div className="flex items-center gap-2">
        <Activity className="h-3.5 w-3.5 text-[var(--t-3)]" strokeWidth={1.75} aria-hidden="true" />
        <span className="t-eyebrow">Survie & variance</span>
      </div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <Metric
          label="Max DD"
          value={`${drawdown.maxDrawdownR.toFixed(2)}R`}
          hint="peak → trough"
          tone={
            drawdown.maxDrawdownR < 5
              ? 'text-[var(--ok)]'
              : drawdown.maxDrawdownR < 10
                ? 'text-[var(--warn)]'
                : 'text-[var(--bad)]'
          }
        />
        <Metric
          label="DD courant"
          value={`${drawdown.currentDrawdownR.toFixed(2)}R`}
          hint={inDD ? 'sous le pic' : 'au pic'}
          tone={inDD ? 'text-[var(--warn)]' : 'text-[var(--ok)]'}
        />
        <Metric
          label="Pertes consécutives"
          value={String(observedMaxLoss)}
          hint={`max win streak : ${observedMaxWin}`}
          tone={observedMaxLoss > 5 ? 'text-[var(--warn)]' : 'text-[var(--t-1)]'}
        />
      </div>
    </div>
  );
}
