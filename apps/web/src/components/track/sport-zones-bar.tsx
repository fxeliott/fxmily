'use client';

import { useEffect, useRef, useState } from 'react';

import { cn } from '@/lib/utils';

interface SportZonesBarProps {
  /** Session duration in minutes. `null` when the field is empty. */
  durationMin: number | null;
}

/**
 * Pedagogical activity-zones diagram for the TRACK Sport wizard step
 * (V2.1.1 — carbon `<SleepZonesBar>` J5 canon).
 *
 * Posture (Mark Douglas anchor): the ACSM prescribes ≥150 min/week of
 * moderate-to-vigorous physical activity (FITT-VP framework, *ACSM's
 * Guidelines for Exercise Testing and Prescription*, 11th ed.) — roughly
 * 30 min × 5 days. Regularity, not single-session volume, is what
 * stabilises mood and emotional regulation across a trading week. A very
 * long one-off session over-reaches recovery and dents next-day decision
 * quality — the same trade-off sleep deprivation creates. The bar shows
 * where a session lands against the ACSM band *before* the log.
 *
 * Zones (minutes):
 *   [0, 15)   — léger (cy-dim), court mais ça compte
 *   [15, 45)  — cible (acc-dim), bande ACSM (~30 min/jour)
 *   [45, 90)  — soutenu (warn-dim), bon volume, surveille la récup
 *   [90, 120] — intense (bad-dim), sur-charge / récup compromise
 *   >120      — clamped at 120 visually (still records actual)
 */

const ZONES = [
  { upper: 15, label: 'Léger', color: 'var(--cy)', bg: 'var(--cy-dim)' },
  { upper: 45, label: 'Cible', color: 'var(--acc)', bg: 'var(--acc-dim)' },
  { upper: 90, label: 'Soutenu', color: 'var(--warn)', bg: 'var(--warn-dim-2)' },
  { upper: 120, label: 'Intense', color: 'var(--bad)', bg: 'var(--bad-dim-2)' },
] as const;

const SCALE_MAX = 120;

function classify(m: number): (typeof ZONES)[number] {
  for (const z of ZONES) {
    if (m < z.upper) return z;
  }
  // m >= 120 — clamp to last zone.
  return ZONES[ZONES.length - 1]!;
}

function classifyLabel(m: number | null): string | null {
  if (m == null || Number.isNaN(m)) return null;
  return classify(m).label;
}

export function SportZonesBar({ durationMin }: SportZonesBarProps) {
  const value =
    durationMin == null || Number.isNaN(durationMin)
      ? null
      : Math.max(0, Math.min(SCALE_MAX, durationMin));
  const currentLabel = classifyLabel(durationMin);
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
    <div className="flex flex-col gap-2.5" aria-hidden={value === null ? 'true' : undefined}>
      <div className="flex items-baseline justify-between">
        <span className="text-[12px] font-medium tracking-[0.10em] text-[var(--t-3)] uppercase">
          Zones d&apos;activité
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

      {/* Tick scale: 0, 15, 45, 90, 120 (minutes) */}
      <div className="relative h-2 font-mono text-[10px] text-[var(--t-3)] tabular-nums">
        {[0, 15, 45, 90, 120].map((t) => (
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
        Cible <span className="font-mono text-[var(--t-2)] tabular-nums">150 min/sem</span> (ACSM) :
        la régularité stabilise ton humeur sur la semaine, pas le volume d&apos;une séance. Au-delà
        de <span className="font-mono text-[var(--t-2)] tabular-nums">90 min</span>, surveille la
        récupération.
      </p>
    </div>
  );
}
