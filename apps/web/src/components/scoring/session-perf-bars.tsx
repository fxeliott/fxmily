import { HoverGlowLift } from '@/components/ui/hover-glow-lift';
import type { SessionPerf } from '@/lib/scoring/dashboard-data';
import { cn } from '@/lib/utils';

import { SampleSizeDisclaimer } from './sample-size-disclaimer';

/**
 * Per-session performance breakdown (J6, SPEC §7.5).
 *
 * Server Component, pure HTML/CSS. Each session shows the trade volume
 * (relative bar) + win-rate + avg R. The bar widths are normalized to the
 * busiest session = 100% width.
 */
interface SessionPerfBarsProps {
  sessions: ReadonlyArray<SessionPerf>;
}

/**
 * S4 DOD4-D1 — below this per-session sample, win-rate and avg R are noise
 * (a 100% win-rate over 2 trades reads as a signal; *Trading in the Zone*
 * says the opposite). The volume bar stays — a count is always factual.
 */
const MIN_SESSION_SAMPLE = 5;

export function SessionPerfBars({ sessions }: SessionPerfBarsProps) {
  const maxVolume = Math.max(1, ...sessions.map((s) => s.trades));
  const totalTrades = sessions.reduce((sum, s) => sum + s.trades, 0);

  return (
    <HoverGlowLift
      tone="acc"
      className="rounded-card-lg flex h-full flex-col gap-3 border border-[var(--b-default)] bg-[var(--bg-1)] p-4 transition-colors hover:border-[var(--b-acc)]"
    >
      <div className="flex items-center justify-between gap-2">
        <span className="t-eyebrow">Performance par session</span>
        <SampleSizeDisclaimer
          current={totalTrades}
          minimum={MIN_SESSION_SAMPLE * 2}
          unit="trades"
          context="UTC bands"
          variant="pill"
        />
      </div>
      <ul className="flex flex-col gap-2">
        {sessions.map((s) => {
          const volPct = (s.trades / maxVolume) * 100;
          return (
            <li key={s.session} className="flex flex-col gap-1">
              <div className="flex items-center justify-between text-[12px]">
                <span className="text-[var(--t-1)]">{s.label}</span>
                <span className="flex items-center gap-3">
                  <span className="t-mono-cap text-[var(--t-4)]">{s.trades} trades</span>
                  {s.trades < MIN_SESSION_SAMPLE ? (
                    // Insufficient sample — show « — » instead of a noise
                    // metric (mirror of EmotionPerfTable's honesty rule).
                    <>
                      <span className="t-mono-cap text-[var(--t-4)]">-</span>
                      <span className="f-mono w-14 text-right text-[12px] text-[var(--t-4)] tabular-nums">
                        -
                      </span>
                    </>
                  ) : (
                    <>
                      <span
                        className={cn(
                          't-mono-cap',
                          // Posture §2 — win-rate JAMAIS rouge (le membre observe, ne se
                          // fait pas punir ; un win-rate bas peut être sain avec un gros
                          // payoff R:R). Vert = renforcement positif autorisé ; sinon
                          // neutre. Aligné sur les cartes pre-trade (cf. dashboard).
                          s.winRate >= 0.55 ? 'text-[var(--ok)]' : 'text-[var(--t-3)]',
                        )}
                      >
                        {(s.winRate * 100).toFixed(0)}%
                      </span>
                      <span
                        className={cn(
                          'f-mono w-14 text-right text-[12px] tabular-nums',
                          s.avgR > 0
                            ? 'text-[var(--acc)]'
                            : s.avgR < 0
                              ? 'text-[var(--bad)]'
                              : 'text-[var(--t-3)]',
                        )}
                      >
                        {s.avgR > 0 ? '+' : ''}
                        {s.avgR.toFixed(2)}R
                      </span>
                    </>
                  )}
                </span>
              </div>
              <div className="rounded-pill h-1.5 overflow-hidden bg-[var(--bg-2)]">
                <div
                  className={cn(
                    'rounded-pill h-full w-full origin-left transition-transform',
                    // Posture §2 — un avgR positif n'est PAS un gain P&L (c'est un
                    // ratio de process) : on peut donc le styliser sur le spectre
                    // cool acc→cyan. Une perte reste rouge (grammaire finance),
                    // un avgR nul reste neutre.
                    s.avgR > 0
                      ? 'bg-gradient-to-r from-[var(--acc)] to-[var(--dv-3)]'
                      : s.avgR < 0
                        ? 'bg-[var(--bad)]'
                        : 'bg-[var(--t-4)]',
                  )}
                  style={{ transform: `scaleX(${Math.max(2, volPct) / 100})` }}
                  aria-hidden="true"
                />
              </div>
            </li>
          );
        })}
      </ul>
    </HoverGlowLift>
  );
}
