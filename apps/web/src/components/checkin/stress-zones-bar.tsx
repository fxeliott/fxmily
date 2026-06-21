'use client';

import { useEffect, useRef, useState } from 'react';

import { cn } from '@/lib/utils';

/**
 * Pedagogical state-zones diagram for the check-in slider steps Stress and
 * Mental — the visual sibling of `SleepZonesBar`.
 *
 * It is a PURE MIRROR of the slider value already captured one row above (no
 * new field, no new schema, no action): a horizontal split bar with four
 * semantic zones, a caret showing where the entered 1–10 value lands, and a
 * `threshold-pulse` cue when the value crosses a zone boundary — exactly the
 * vocabulary the morning wizard already uses for Sommeil.
 *
 * Two reading directions (SPEC §2 posture, anti-Black-Hat — descriptive, never
 * "tu es mauvais") :
 *
 *   `direction="stress"`  — low = calm (ok/cy), high = tension (warn/bad).
 *     A high score is NOT a failure, just a signal worth seeing before the day
 *     closes (Steenbarger: the journal exists to surface state, not to grade).
 *
 *   `direction="clarity"` — low = brouillard (warn), high = clair (acc).
 *     The mood/mental slider where a higher band reads as more lucid headspace.
 *
 * The zone bands intentionally line up with the slider's own `describeAt`
 * labels (Très bas / Calme / Mesuré / Élevé · Difficile / Neutre / Bien / Clair)
 * so the diagram and the readout reinforce a single mental model.
 */

interface ZoneDef {
  /** Inclusive upper bound on the 1–10 scale. */
  upper: number;
  label: string;
  color: string;
  bg: string;
}

type ZoneDirection = 'stress' | 'clarity';

// Stress: rising = rising tension. Calm at the bottom is the "good" anchor, but
// the wording stays neutral — we colour, we don't scold.
const STRESS_ZONES: readonly ZoneDef[] = [
  { upper: 2, label: 'Très bas', color: 'var(--ok)', bg: 'var(--ok-dim-2)' },
  { upper: 4, label: 'Calme', color: 'var(--cy)', bg: 'var(--cy-dim)' },
  { upper: 6, label: 'Mesuré', color: 'var(--warn)', bg: 'var(--warn-dim-2)' },
  { upper: 10, label: 'Élevé', color: 'var(--bad)', bg: 'var(--bad-dim-2)' },
] as const;

// Clarity (mental/mood): rising = clearer headspace. Lower bands are "brouillard"
// but framed as a passing state, not a verdict.
const CLARITY_ZONES: readonly ZoneDef[] = [
  { upper: 3, label: 'Brouillard', color: 'var(--warn)', bg: 'var(--warn-dim-2)' },
  { upper: 5, label: 'Neutre', color: 'var(--t-2)', bg: 'var(--bg-2)' },
  { upper: 7, label: 'Posé', color: 'var(--cy)', bg: 'var(--cy-dim)' },
  { upper: 10, label: 'Clair', color: 'var(--acc)', bg: 'var(--acc-dim)' },
] as const;

const SCALE_MIN = 1;
const SCALE_MAX = 10;

function classify(zones: readonly ZoneDef[], v: number): ZoneDef {
  for (const z of zones) {
    if (v <= z.upper) return z;
  }
  return zones[zones.length - 1]!;
}

interface StressZonesBarProps {
  /** Current slider value, 1–10. */
  value: number;
  /** Reading direction — see component doc. */
  direction: ZoneDirection;
  /** Eyebrow above the bar (defaults per direction). */
  title?: string;
  /** Short pedagogical caption below the bar. */
  caption?: string;
}

const DEFAULT_TITLE: Record<ZoneDirection, string> = {
  stress: 'Zones de tension',
  clarity: 'Zones de clarté',
};

export function StressZonesBar({ value, direction, title, caption }: StressZonesBarProps) {
  const zones = direction === 'stress' ? STRESS_ZONES : CLARITY_ZONES;
  const clamped = Math.max(SCALE_MIN, Math.min(SCALE_MAX, value));
  const currentZone = classify(zones, clamped);
  const currentLabel = currentZone.label;

  const lastLabelRef = useRef<string | null>(currentLabel);
  const [pulse, setPulse] = useState(false);

  useEffect(() => {
    if (currentLabel === lastLabelRef.current) return undefined;
    lastLabelRef.current = currentLabel;
    // Threshold pulse on band crossing — same pattern as SleepZonesBar /
    // ScoreSlider. setState lives in the effect because the trigger is a
    // derived value crossing a boundary, not a user event.
    setPulse(true);
    const t = setTimeout(() => setPulse(false), 600);
    return () => clearTimeout(t);
  }, [currentLabel]);

  // Caret position in % across the bar. The scale runs 1 → 10, so map the
  // value onto [0,1] with (v-1)/9 to align with the slider's own fill maths.
  const caretPct = ((clamped - SCALE_MIN) / (SCALE_MAX - SCALE_MIN)) * 100;

  return (
    <div className="flex flex-col gap-2.5">
      <div className="flex items-baseline justify-between">
        <span className="t-eyebrow-lg text-[var(--t-3)]">{title ?? DEFAULT_TITLE[direction]}</span>
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
      </div>

      {/* Stacked zone bar — decorative mirror of the slider above it. */}
      <div
        aria-hidden="true"
        className="rounded-input relative flex h-7 overflow-hidden border border-[var(--b-default)]"
      >
        {zones.map((z, i) => {
          const lower = i === 0 ? SCALE_MIN : zones[i - 1]!.upper;
          const widthPct = ((z.upper - lower) / (SCALE_MAX - SCALE_MIN)) * 100;
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

        {/* Caret — compositor-only positioning via translateX, animated with the
            same transition the sleep bar uses for its caret. */}
        <div
          aria-hidden
          className="absolute top-0 h-full w-0.5 transition-[left] duration-150"
          style={{
            left: `${caretPct}%`,
            transform: 'translateX(-50%)',
            color: currentZone.color,
            background: 'currentColor',
            boxShadow: '0 0 8px -1px currentColor',
          }}
        />
      </div>

      {/* Tick scale: 1 / 5 / 10 — matches the slider's own tick labels. */}
      <div className="relative h-2 font-mono text-[10px] text-[var(--t-3)] tabular-nums">
        {[1, 5, 10].map((t) => (
          <span
            key={t}
            className="absolute -translate-x-1/2"
            style={{ left: `${((t - SCALE_MIN) / (SCALE_MAX - SCALE_MIN)) * 100}%` }}
          >
            {t}
          </span>
        ))}
      </div>

      {caption ? <p className="t-cap text-[var(--t-3)]">{caption}</p> : null}
    </div>
  );
}
