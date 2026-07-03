import 'server-only';

import { HoverGlowLift } from '@/components/ui/hover-glow-lift';
import { winRateWithBand, type WilsonInterval } from '@/lib/analytics';
import type {
  AnticipatedExitUnderPressure,
  ExitReasonPerfRow,
} from '@/lib/scoring/pattern-rhythms';
import { ANTICIPATED_EXIT_MIN_TO_SURFACE } from '@/lib/scoring/pattern-rhythms';
// Import-only reuse of the tour 10 FR labels (single source with the close form
// and the trade detail view). This module never edits `exit-reasons.ts`.
import { EXIT_REASON_LABELS } from '@/lib/trading/exit-reasons';
import type { TradeExitReasonSlug } from '@/lib/schemas/trade';

import { SampleSizeDisclaimer } from './sample-size-disclaimer';

/**
 * Tour 11, Finding 1 — nature-of-exit × outcome table, calqued on
 * `EmotionPerfTable` (same Wilson 95% band + « échantillon faible » disclaimer).
 *
 * `Trade.exitReason` is captured on every close since tour 10 but had NO member
 * aggregate: the only restitution was one line per trade + the 24h echo. Here we
 * make the durable crossing visible, including the most coachable derived signal
 * (« sorties anticipées sous pression » = `manual_before_target` with a negative
 * emotion recalled DURING the trade, the per-trade `fearExit` of `trade-echo.ts`).
 *
 * Posture §2 / §31.2 / Mark Douglas: a slug describes HOW the position ended,
 * never a fault (`sl_hit` is a normal cost). The « sous pression » line is a calm
 * 'watch' (ambre `--warn`), NEVER red — red stays reserved for trade outcomes.
 *
 * Server Component, pure presentation, no client JS.
 */

interface ExitReasonPerfTableProps {
  rows: ReadonlyArray<ExitReasonPerfRow>;
  anticipatedExit: AnticipatedExitUnderPressure;
  /** Total closed trades in the window — drives the section disclaimer. */
  totalTrades: number;
}

const PATTERN_MIN_TRADES = 30; // surface threshold (mirrors EmotionPerfTable)

function exitReasonLabel(slug: string): string {
  // `slug` comes from a validated enum column; fall back to the raw slug if a
  // future enum value ships before its label (defensive, never throws).
  return EXIT_REASON_LABELS[slug as TradeExitReasonSlug] ?? slug;
}

export function ExitReasonPerfTable({
  rows,
  anticipatedExit,
  totalTrades,
}: ExitReasonPerfTableProps) {
  // 5 slugs max exist (the enum has exactly 5); sort by volume, keep non-empty.
  const sorted = [...rows].filter((r) => r.trades > 0).sort((a, b) => b.trades - a.trades);

  // Derived pressure rate: only surfaced once the denominator is meaningful
  // (S26 null-passthrough + anti-noise). Calm 'watch', never a verdict.
  const showPressure = anticipatedExit.considered >= ANTICIPATED_EXIT_MIN_TO_SURFACE;
  const pressurePct =
    anticipatedExit.considered > 0
      ? Math.round((anticipatedExit.count / anticipatedExit.considered) * 100)
      : 0;

  return (
    <HoverGlowLift
      tone="acc"
      className="rounded-card-lg flex h-full flex-col gap-3 border border-[var(--b-default)] bg-[var(--bg-1)] p-4 transition-colors hover:border-[var(--b-acc)]"
    >
      <div className="flex items-center justify-between gap-2">
        <span className="t-eyebrow">Nature de sortie × résultat</span>
        <SampleSizeDisclaimer
          current={totalTrades}
          minimum={PATTERN_MIN_TRADES}
          unit="trades"
          context="Wilson 95%"
          variant="pill"
        />
      </div>
      {sorted.length === 0 ? (
        <p className="t-cap py-4 text-center text-[var(--t-4)]">
          Pas encore de trade clôturé avec une nature de sortie renseignée.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead>
              <tr className="t-mono-cap text-[var(--t-4)]">
                <th className="py-1.5">Sortie</th>
                <th className="py-1.5 text-right">n</th>
                <th className="py-1.5 text-right">Taux de réussite</th>
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
                      <span className="text-[12px] text-[var(--t-1)]">
                        {exitReasonLabel(r.slug)}
                      </span>
                    </td>
                    <td className="py-2 text-right">
                      <span className="t-mono-cap text-[var(--t-3)]">{r.trades}</span>
                    </td>
                    <td className="py-2 text-right">
                      <span className="f-mono text-[12px] text-[var(--t-1)] tabular-nums">
                        {(ci.point * 100).toFixed(0)}%
                      </span>
                    </td>
                    <td className="py-2 text-right">
                      <span
                        className={
                          'f-mono text-[11px] tabular-nums ' +
                          (ci.sufficientSample ? 'text-[var(--t-3)]' : 'text-[var(--warn-hi)]')
                        }
                      >
                        [{(ci.lower * 100).toFixed(0)}-{(ci.upper * 100).toFixed(0)}%]
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
                        {avgR === null
                          ? 'non calculé'
                          : `${avgR > 0 ? '+' : ''}${avgR.toFixed(2)}R`}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Derived signal — anticipated exits under pressure. Calm 'watch' (ambre),
          never red, never a countdown : a data point to observe, not a verdict. */}
      {showPressure && (
        <div
          role="status"
          className="rounded-control mt-1 flex items-start gap-2 border border-[var(--warn-edge)] bg-[var(--warn-dim)] px-3 py-2 text-[12px] leading-[1.4] text-[var(--t-2)]"
        >
          <span aria-hidden="true" className="mt-px text-[var(--warn-hi)]">
            •
          </span>
          <span>
            <span className="font-semibold text-[var(--t-1)]">
              Sorties anticipées sous pression :
            </span>{' '}
            {pressurePct}% de tes sorties avant l&apos;objectif ({anticipatedExit.count} sur{' '}
            {anticipatedExit.considered}) sont tombées pendant une émotion de tension. C&apos;est le
            geste à observer, pas le résultat.
          </span>
        </div>
      )}
    </HoverGlowLift>
  );
}
