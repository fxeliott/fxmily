'use client';

import { useEffect, useRef, useState } from 'react';

import { cn } from '@/lib/utils';

interface SleepZonesBarProps {
  /** Hours of sleep currently entered. `null` when the field is empty. */
  hours: number | null;
}

/**
 * Pedagogical sleep-zones diagram for the morning wizard step Sommeil
 * (J5 audit UI BLOCKER B1 polish).
 *
 * Mirrors the J2 trade wizard's R:R ratio bar: a horizontal split bar
 * with semantic zones, a caret indicating where the user lands, and a
 * `threshold-pulse` cue when the entered value crosses a zone boundary.
 *
 * Posture (Mark Douglas anchor): a trader's cognitive bandwidth tracks
 * sleep quantity tightly (Walker, *Why We Sleep*, ch. 5; Steenbarger,
 * *Trading Psychology 2.0*). The "zone cible" 7-9h is the band where
 * decision-making, risk-acceptance, and emotional regulation peak. Below
 * 5h the trader operates at a measurable disadvantage. The bar makes that
 * trade-off visible *before* the user logs the trade — different from a
 * weekly retrospective.
 *
 * Zones (hours):
 *   [0, 5)   — dette (bad-dim), high cognitive cost
 *   [5, 6.5) — court (warn-dim), suboptimal
 *   [6.5, 9] — cible (acc-dim), peak band
 *   (9, 12]  — long (cy-dim), oversleep / depression risk
 *   >12      — clamped at 12 visually (still records actual)
 */

const ZONES = [
  { upper: 5, label: 'Dette', color: 'var(--bad)', bg: 'var(--bad-dim-2)' },
  { upper: 6.5, label: 'Court', color: 'var(--warn)', bg: 'var(--warn-dim-2)' },
  { upper: 9, label: 'Cible', color: 'var(--acc)', bg: 'var(--acc-dim)' },
  { upper: 12, label: 'Long', color: 'var(--cy)', bg: 'var(--cy-dim)' },
] as const;

const SCALE_MAX = 12;

function classify(h: number): (typeof ZONES)[number] {
  for (const z of ZONES) {
    if (h < z.upper) return z;
  }
  // h >= 12 — clamp to last zone.
  return ZONES[ZONES.length - 1]!;
}

function classifyLabel(h: number | null): string | null {
  if (h == null || Number.isNaN(h)) return null;
  return classify(h).label;
}

export function SleepZonesBar({ hours }: SleepZonesBarProps) {
  const value =
    hours == null || Number.isNaN(hours) ? null : Math.max(0, Math.min(SCALE_MAX, hours));
  const currentLabel = classifyLabel(hours);
  const lastLabelRef = useRef<string | null>(currentLabel);
  const [pulse, setPulse] = useState(false);

  useEffect(() => {
    if (currentLabel === lastLabelRef.current) return undefined;
    lastLabelRef.current = currentLabel;
    if (!currentLabel) return undefined;
    // Threshold pulse pattern (same as ScoreSlider): the setState lives in
    // the effect because the trigger is a derived value crossing a band
    // boundary, not a user event we can hook into directly.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setPulse(true);
    const t = setTimeout(() => setPulse(false), 600);
    return () => clearTimeout(t);
  }, [currentLabel]);

  // Caret position in % across the bar (0 → 12h).
  const caretPct = value === null ? null : (value / SCALE_MAX) * 100;
  const currentZone = value === null ? null : classify(value);

  return (
    <div className="flex flex-col gap-2.5" aria-hidden={value === null ? 'true' : undefined}>
      <div className="flex items-baseline justify-between">
        <span className="text-[12px] font-medium uppercase tracking-[0.10em] text-[var(--t-3)]">
          Zones de sommeil
        </span>
        {currentZone ? (
          <span
            className={cn(
              'font-mono text-[11px] font-semibold uppercase tabular-nums tracking-[0.08em]',
              pulse && 'threshold-pulse',
            )}
            style={{ color: currentZone.color }}
            aria-live="polite"
          >
            {currentZone.label}
          </span>
        ) : (
          <span className="font-mono text-[11px] tabular-nums text-[var(--t-3)]">—</span>
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
                className="hidden font-mono text-[10px] font-semibold uppercase tracking-[0.10em] sm:inline"
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

      {/* Tick scale: 0, 5, 6.5, 9, 12 */}
      <div className="relative h-2 font-mono text-[10px] tabular-nums text-[var(--t-3)]">
        {[0, 5, 6.5, 9, 12].map((t) => (
          <span
            key={t}
            className="absolute -translate-x-1/2"
            style={{ left: `${(t / SCALE_MAX) * 100}%` }}
          >
            {t}h
          </span>
        ))}
      </div>

      {/* Caption */}
      <p className="t-cap text-[var(--t-3)]">
        Cible <span className="font-mono tabular-nums text-[var(--t-2)]">6,5–9h</span> : la bande où
        ta clarté de décision et ta régulation émotionnelle culminent. Sous{' '}
        <span className="font-mono tabular-nums text-[var(--t-2)]">5h</span> tu trades avec un
        désavantage mesurable.
      </p>
    </div>
  );
}
