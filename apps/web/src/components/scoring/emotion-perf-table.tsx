import 'server-only';

import { emotionLabel } from '@/lib/trading/emotions';
import { winRateWithBand, type WilsonInterval } from '@/lib/analytics';

import { SampleSizeDisclaimer } from './sample-size-disclaimer';

/**
 * Pattern table — emotion-tag × outcome with Wilson 95% confidence band.
 *
 * Mark Douglas alignment: this table makes the FOMO trap visible WITHOUT
 * lying about small samples. Each row carries its Wilson interval + an
 * "échantillon faible" pill when n < 20 (UI threshold). Inputs are pre-
 * computed by the dashboard service from `Trade.emotionBefore`.
 *
 * Server Component (renders pre-aggregated data). Pure presentation, no
 * React state, no client JS.
 */

export interface EmotionPerfRow {
  /** Emotion tag slug (e.g. 'fomo', 'calm'). */
  slug: string;
  trades: number;
  wins: number;
  /** Sum of R over wins+losses (computed source only). */
  sumR: number;
  /** Number of trades that contributed to sumR. */
  rTrades: number;
}

interface EmotionPerfTableProps {
  rows: ReadonlyArray<EmotionPerfRow>;
  /** Total closed trades in the window — drives the section disclaimer. */
  totalTrades: number;
}

const PATTERN_MIN_TRADES = 30; // surface threshold

export function EmotionPerfTable({ rows, totalTrades }: EmotionPerfTableProps) {
  const sorted = [...rows].filter((r) => r.trades > 0).sort((a, b) => b.trades - a.trades);

  return (
    <div className="rounded-card-lg flex flex-col gap-3 border border-[var(--b-default)] bg-[var(--bg-1)] p-4">
      <div className="flex items-center justify-between gap-2">
        <span className="t-eyebrow">Émotion × outcome</span>
        <SampleSizeDisclaimer
          current={totalTrades}
          minimum={PATTERN_MIN_TRADES}
          unit="trades"
          context="Wilson 95% CI"
          variant="pill"
        />
      </div>
      {sorted.length === 0 ? (
        <p className="t-cap py-4 text-center text-[var(--t-4)]">
          Pas encore d&apos;émotion taguée sur des trades clôturés.
        </p>
      ) : (
        <table className="w-full text-left">
          <thead>
            <tr className="t-mono-cap text-[var(--t-4)]">
              <th className="py-1.5">Émotion</th>
              <th className="py-1.5 text-right">n</th>
              <th className="py-1.5 text-right">Win rate</th>
              <th className="py-1.5 text-right">Wilson 95%</th>
              <th className="py-1.5 text-right">Avg R</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((r) => {
              const ci: WilsonInterval = winRateWithBand(r.wins, r.trades);
              const avgR = r.rTrades > 0 ? r.sumR / r.rTrades : null;
              return (
                <tr key={r.slug} className="border-t border-[var(--b-subtle)]">
                  <td className="py-2">
                    <span className="text-[12px] text-[var(--t-1)]">{emotionLabel(r.slug)}</span>
                  </td>
                  <td className="py-2 text-right">
                    <span className="t-mono-cap text-[var(--t-3)]">{r.trades}</span>
                  </td>
                  <td className="py-2 text-right">
                    <span className="f-mono text-[12px] tabular-nums text-[var(--t-1)]">
                      {(ci.point * 100).toFixed(0)}%
                    </span>
                  </td>
                  <td className="py-2 text-right">
                    <span
                      className={
                        'f-mono text-[11px] tabular-nums ' +
                        (ci.sufficientSample ? 'text-[var(--t-3)]' : 'text-[var(--warn)]')
                      }
                    >
                      [{(ci.lower * 100).toFixed(0)}–{(ci.upper * 100).toFixed(0)}%]
                    </span>
                  </td>
                  <td className="py-2 text-right">
                    <span
                      className={
                        'f-mono text-[12px] tabular-nums ' +
                        (avgR === null
                          ? 'text-[var(--t-4)]'
                          : avgR > 0
                            ? 'text-[var(--acc)]'
                            : avgR < 0
                              ? 'text-[var(--bad)]'
                              : 'text-[var(--t-3)]')
                      }
                    >
                      {avgR === null ? '—' : `${avgR > 0 ? '+' : ''}${avgR.toFixed(2)}R`}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}
