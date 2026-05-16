'use client';

import { useEffect, useRef, useState } from 'react';

import { cn } from '@/lib/utils';

interface CaffeineZonesBarProps {
  /** Cups of caffeine consumed today. `null` when the field is empty. */
  cups: number | null;
}

/**
 * Pedagogical caffeine-zones diagram for the TRACK Café wizard step
 * (V2.1.1 — carbon `<SleepZonesBar>` J5 canon).
 *
 * Posture (Mark Douglas anchor): caffeine has a ~6 h elimination half-life
 * (Bjorness & Greene, *Sleep Medicine Reviews* 13, 2009) — a coffee at 16 h
 * still leaves ~25 % of its dose circulating at 22 h, eroding the deep-sleep
 * that funds next-day decision clarity. Moderate intake sharpens vigilance ;
 * excessive intake pushes a trader past the top of the Yerkes-Dodson curve
 * into jitter and over-reactive risk-taking. The bar makes the quantity
 * trade-off visible *before* the log, not in a weekly retrospective — the
 * cut-off-6 h-before-sleep rule lives in the caption since timing, not just
 * count, is the lever.
 *
 * Zones (cups):
 *   [0, 2)   — légère (cy-dim), vigilance sans excès
 *   [2, 4)   — optimale (acc-dim), peak band
 *   [4, 6)   — élevée (warn-dim), surveille le timing
 *   [6, 10]  — excessive (bad-dim), anxiété + dette de sommeil probables
 *   >10      — clamped at 10 visually (still records actual)
 */

const ZONES = [
  { upper: 2, label: 'Légère', color: 'var(--cy)', bg: 'var(--cy-dim)' },
  { upper: 4, label: 'Optimale', color: 'var(--acc)', bg: 'var(--acc-dim)' },
  { upper: 6, label: 'Élevée', color: 'var(--warn)', bg: 'var(--warn-dim-2)' },
  { upper: 10, label: 'Excessive', color: 'var(--bad)', bg: 'var(--bad-dim-2)' },
] as const;

const SCALE_MAX = 10;

function classify(c: number): (typeof ZONES)[number] {
  for (const z of ZONES) {
    if (c < z.upper) return z;
  }
  // c >= 10 — clamp to last zone.
  return ZONES[ZONES.length - 1]!;
}

function classifyLabel(c: number | null): string | null {
  if (c == null || Number.isNaN(c)) return null;
  return classify(c).label;
}

export function CaffeineZonesBar({ cups }: CaffeineZonesBarProps) {
  const value = cups == null || Number.isNaN(cups) ? null : Math.max(0, Math.min(SCALE_MAX, cups));
  const currentLabel = classifyLabel(cups);
  const lastLabelRef = useRef<string | null>(currentLabel);
  const [pulse, setPulse] = useState(false);

  useEffect(() => {
    if (currentLabel === lastLabelRef.current) return undefined;
    lastLabelRef.current = currentLabel;
    if (!currentLabel) return undefined;
    // Threshold pulse pattern (same as ScoreSlider / SleepZonesBar): the
    // setState lives in the effect because the trigger is a derived value
    // crossing a band boundary, not a user event we can hook into directly.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setPulse(true);
    const t = setTimeout(() => setPulse(false), 600);
    return () => clearTimeout(t);
  }, [currentLabel]);

  const caretPct = value === null ? null : (value / SCALE_MAX) * 100;
  const currentZone = value === null ? null : classify(value);

  return (
    <div className="flex flex-col gap-3" aria-hidden={value === null ? 'true' : undefined}>
      <div className="flex items-baseline justify-between">
        <span className="text-[12px] font-medium tracking-[0.10em] text-[var(--t-3)] uppercase">
          Zones de caféine
        </span>
        {currentZone ? (
          <span
            className={cn(
              'font-mono text-[11px] font-semibold tracking-[0.08em] uppercase tabular-nums',
              pulse && 'threshold-pulse',
            )}
            style={{ color: currentZone.color }}
            aria-live="polite"
          >
            {currentZone.label}
          </span>
        ) : (
          <span className="font-mono text-[11px] text-[var(--t-3)] tabular-nums">—</span>
        )}
      </div>

      {/* Stacked zone bar */}
      <div className="rounded-input relative flex h-7 overflow-hidden border border-[var(--b-default)]">
        {ZONES.map((z, i) => {
          const lower = i === 0 ? 0 : ZONES[i - 1]!.upper;
          const widthPct = ((z.upper - lower) / SCALE_MAX) * 100;
          const isActive = currentZone === z;
          return (
            <div
              key={z.label}
              className={cn(
                'flex items-center justify-center transition-opacity duration-150',
                isActive ? 'opacity-100' : 'opacity-50',
              )}
              style={{
                width: `${widthPct}%`,
                background: z.bg,
                borderLeft: i === 0 ? 'none' : '1px dashed var(--b-default)',
              }}
            >
              <span
                className="hidden font-mono text-[10px] font-semibold tracking-[0.10em] uppercase sm:inline"
                style={{ color: z.color }}
              >
                {z.label}
              </span>
            </div>
          );
        })}

        {/* Caret */}
        {caretPct !== null ? (
          <div
            aria-hidden
            className="absolute top-0 h-full w-0.5 transition-[left] duration-150"
            style={{
              left: `${caretPct}%`,
              transform: 'translateX(-50%)',
              background: currentZone?.color ?? 'var(--t-1)',
              boxShadow: '0 0 8px -1px currentColor',
            }}
          />
        ) : null}
      </div>

      {/* Tick scale: 0, 2, 4, 6, 10 */}
      <div className="relative h-2 font-mono text-[10px] text-[var(--t-3)] tabular-nums">
        {[0, 2, 4, 6, 10].map((t) => (
          <span
            key={t}
            className="absolute -translate-x-1/2"
            style={{ left: `${(t / SCALE_MAX) * 100}%` }}
          >
            {t}
          </span>
        ))}
      </div>

      {/* Caption */}
      <p className="t-cap text-[var(--t-3)]">
        Demi-vie <span className="font-mono text-[var(--t-2)] tabular-nums">~6 h</span> : un café à
        16 h pèse encore sur ton sommeil à 22 h. Coupe{' '}
        <span className="font-mono text-[var(--t-2)] tabular-nums">6 h</span> avant le coucher — la
        clarté de demain se joue ici.
      </p>
    </div>
  );
}
