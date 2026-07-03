import { HoverGlowLift } from '@/components/ui/hover-glow-lift';
import { HOURLY_MIN_SAMPLE, type HourlyPerf } from '@/lib/scoring/pattern-rhythms';
import { cn } from '@/lib/utils';

import { SampleSizeDisclaimer } from './sample-size-disclaimer';

/**
 * Entry-time rhythm — finer granularity than `SessionPerfBars` (SPEC §7.5).
 *
 * Buckets the member's trades into 4 readable Paris-wall-clock bands
 * (Nuit / Matin / Après-midi / Soir) and shows, per band, the trade volume
 * (relative bar) + win-rate + avg R. Bar widths normalize to the busiest
 * band = 100 %.
 *
 * Server Component, pure HTML/CSS (mirror of `SessionPerfBars`). Posture §2 /
 * Mark Douglas: below `HOURLY_MIN_SAMPLE` we suppress win-rate / avg R and
 * mark the band "échantillon faible" — a 100 % win-rate over 1 trade reads as
 * a signal; *Trading in the Zone* says the opposite. The volume count always
 * stays — a count is always factual.
 */
interface HourlyRhythmProps {
  hours: ReadonlyArray<HourlyPerf>;
}

export function HourlyRhythm({ hours }: HourlyRhythmProps) {
  const maxVolume = Math.max(1, ...hours.map((h) => h.trades));
  const totalTrades = hours.reduce((sum, h) => sum + h.trades, 0);

  return (
    <HoverGlowLift
      tone="acc"
      className="rounded-card-lg flex h-full flex-col gap-3 border border-[var(--b-default)] bg-[var(--bg-1)] p-4 transition-colors hover:border-[var(--b-acc)]"
    >
      <div className="flex items-center justify-between gap-2">
        <span className="t-eyebrow">Tes rythmes (heure d’entrée)</span>
        <SampleSizeDisclaimer
          current={totalTrades}
          minimum={HOURLY_MIN_SAMPLE * 2}
          unit="trades"
          context="heure Paris"
          variant="pill"
        />
      </div>
      <ul className="flex flex-col gap-2">
        {hours.map((h) => {
          const volPct = (h.trades / maxVolume) * 100;
          const thin = h.trades < HOURLY_MIN_SAMPLE;
          return (
            <li key={h.slot} className="flex flex-col gap-1">
              <div className="flex items-center justify-between gap-2 text-[12px]">
                <span className="text-[var(--t-1)]">{h.label}</span>
                <span className="flex items-center gap-3">
                  <span className="t-mono-cap text-[var(--t-4)]">{h.trades} trades</span>
                  {thin ? (
                    // Insufficient sample — show « — » instead of a noise metric
                    // (mirror of SessionPerfBars / EmotionPerfTable honesty rule).
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
                          // Posture §2 — win-rate JAMAIS rouge. Vert = renforcement
                          // positif autorisé ; sinon neutre.
                          h.winRate >= 0.55 ? 'text-[var(--ok)]' : 'text-[var(--t-3)]',
                        )}
                      >
                        {(h.winRate * 100).toFixed(0)}%
                      </span>
                      <span
                        className={cn(
                          'f-mono w-14 text-right text-[12px] tabular-nums',
                          h.avgR > 0
                            ? 'text-[var(--acc)]'
                            : h.avgR < 0
                              ? 'text-[var(--bad)]'
                              : 'text-[var(--t-3)]',
                        )}
                      >
                        {h.avgR > 0 ? '+' : ''}
                        {h.avgR.toFixed(2)}R
                      </span>
                    </>
                  )}
                </span>
              </div>
              <div className="rounded-pill h-1.5 overflow-hidden bg-[var(--bg-2)]">
                <div
                  className={cn(
                    'rounded-pill h-full w-full origin-left transition-transform',
                    // Posture §2 — avgR positif = ratio de process (pas un P&L) :
                    // dégradé cool acc→cyan. Perte rouge, neutre si nul.
                    h.avgR > 0
                      ? 'bg-gradient-to-r from-[var(--acc)] to-[var(--dv-3)]'
                      : h.avgR < 0
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
