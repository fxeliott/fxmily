'use client';

import { useEffect, useId, useRef, useState } from 'react';

import { cn } from '@/lib/utils';

interface ScoreSliderProps {
  /** Current value 1–10. */
  value: number;
  onChange: (next: number) => void;
  label: string;
  /** Display label shown next to the value (e.g. "/10"). */
  unit?: string;
  /**
   * Mapping value → semantic word, e.g. for mood "Bof", "Calme", "Excellent".
   * Optional. The word is rendered visually AND injected into `aria-valuetext`
   * so screen-reader users hear "7 sur 10, Calme" instead of "7".
   */
  describeAt?: (value: number) => string;
  /** Helper text rendered below the slider. */
  hint?: string;
  /** Tone to colour the live readout. Default = `acc` (lime). */
  tone?: 'acc' | 'cy' | 'warn';
  disabled?: boolean | undefined;
  name: string;
  hintId?: string;
  error?: string | undefined;
}

/**
 * 1–10 slider used by the check-in wizards (mood, stress, sleep quality).
 *
 * J5 audit fixes (BLOCKER B1, B2 + UI H1, H2):
 *   - `aria-valuetext` reads "N sur 10, Word" so SR users hear the semantic
 *     band, not just the number (WCAG 4.1.2 + 1.3.1).
 *   - The custom thumb is `peer-focus-visible`-styled so the focus ring is
 *     visible even though the underlying `<input type="range">` is opacity-0
 *     (WCAG 2.4.7 — fix for a regression first introduced in the J2 trade
 *     wizard's R:R slider).
 *   - Track fill + thumb halo follow `tone` instead of being lime-hardcoded
 *     (UI H1 — was visually incoherent on `tone="warn"` for the stress slider).
 *   - `threshold-pulse` (defined in globals.css) fires when the semantic band
 *     changes (e.g. mood crossing from "Neutre" to "Calme") — keeps the
 *     visual feedback Mark Douglas would call "self-aware reinforcement"
 *     without spamming the SR.
 *
 * Native `<input type="range">` stays the source of truth: keyboard nav
 * (arrow keys, home/end, page up/down), touch dragging on mobile, and
 * accessibility tree all come for free from the browser.
 */
export function ScoreSlider({
  value,
  onChange,
  label,
  unit = '/10',
  describeAt,
  hint,
  tone = 'acc',
  disabled,
  name,
  hintId,
  error,
}: ScoreSliderProps) {
  const id = useId();
  const errorId = error ? `${id}-error` : undefined;
  const describedBy = [hintId, errorId].filter(Boolean).join(' ') || undefined;
  const pct = ((value - 1) / 9) * 100;
  const semanticBand = describeAt ? describeAt(value) : null;
  const valueText = semanticBand ? `${value} sur 10, ${semanticBand}` : `${value} sur 10`;

  // Threshold pulse on semantic-band transition (e.g. "Bof" → "Neutre").
  // Tracked via ref so we don't re-render the slider on every band change.
  const lastBandRef = useRef(semanticBand);
  const [pulse, setPulse] = useState(false);
  useEffect(() => {
    if (semanticBand !== lastBandRef.current) {
      lastBandRef.current = semanticBand;
      setPulse(true);
      const t = setTimeout(() => setPulse(false), 600);
      return () => clearTimeout(t);
    }
    return undefined;
  }, [semanticBand]);

  const valColor =
    tone === 'warn'
      ? 'text-[var(--warn)]'
      : tone === 'cy'
        ? 'text-[var(--cy)]'
        : 'text-[var(--acc)]';

  const fillStyle =
    tone === 'warn'
      ? 'linear-gradient(90deg, var(--ok) 0%, var(--warn) 70%, var(--bad) 100%)'
      : tone === 'cy'
        ? 'linear-gradient(90deg, var(--cy) 0%, var(--acc) 100%)'
        : 'linear-gradient(90deg, var(--cy) 0%, var(--acc) 80%)';

  // Tone-aware glow / thumb halo (replaces hardcoded lime values from pre-J5-fix).
  const trackGlow =
    tone === 'warn'
      ? '0 0 10px -2px oklch(0.834 0.158 80 / 0.45)'
      : tone === 'cy'
        ? '0 0 10px -2px oklch(0.789 0.139 217 / 0.45)'
        : '0 0 10px -2px oklch(0.879 0.231 130 / 0.45)';

  const thumbBg =
    tone === 'warn' ? 'bg-[var(--warn)]' : tone === 'cy' ? 'bg-[var(--cy)]' : 'bg-[var(--acc)]';

  const thumbHalo =
    tone === 'warn'
      ? '0 0 0 4px oklch(0.834 0.158 80 / 0.18), 0 2px 4px oklch(0 0 0 / 0.4)'
      : tone === 'cy'
        ? '0 0 0 4px oklch(0.789 0.139 217 / 0.18), 0 2px 4px oklch(0 0 0 / 0.4)'
        : '0 0 0 4px oklch(0.879 0.231 130 / 0.18), 0 2px 4px oklch(0 0 0 / 0.4)';

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-baseline justify-between">
        <label
          htmlFor={id}
          className="text-[12px] font-medium uppercase tracking-[0.10em] text-[var(--t-3)]"
        >
          {label}
        </label>
        {/* Visual readout — NOT aria-live (the slider's own aria-valuetext
            handles SR announcement, double-channel would be noise). */}
        <span className="font-mono text-[11px] tabular-nums text-[var(--t-3)]">
          <span className={cn('font-semibold tabular-nums', valColor, pulse && 'threshold-pulse')}>
            {value}
          </span>
          {unit}
          {semanticBand ? (
            <span className={cn('ml-2 normal-case', pulse ? valColor : 'text-[var(--t-3)]')}>
              {semanticBand}
            </span>
          ) : null}
        </span>
      </div>

      <div className="relative h-6">
        {/* Track background */}
        <div
          aria-hidden
          className="rounded-pill absolute left-0 right-0 top-1/2 h-1.5 -translate-y-1/2 border border-[var(--b-subtle)] bg-[var(--bg-2)]"
        />
        {/* Track filled gradient */}
        <div
          aria-hidden
          className="rounded-pill absolute left-0 top-1/2 h-1.5 -translate-y-1/2"
          style={{
            width: `${pct}%`,
            background: fillStyle,
            boxShadow: trackGlow,
            transition: 'width 80ms cubic-bezier(0.4,0,0.2,1)',
          }}
        />
        {/* Tick marks (visible at every integer) */}
        {Array.from({ length: 10 }).map((_, i) => (
          <div
            key={i}
            aria-hidden
            className="absolute top-1/2 h-3 w-px -translate-y-1/2 bg-[var(--b-strong)]"
            style={{ left: `${(i / 9) * 100}%` }}
          />
        ))}
        {/* Native range input — `peer` lets the custom thumb mirror its focus state. */}
        <input
          id={id}
          name={name}
          type="range"
          min={1}
          max={10}
          step={1}
          value={value}
          onChange={(e) => onChange(Number(e.target.value))}
          disabled={disabled}
          aria-describedby={describedBy}
          aria-invalid={error ? 'true' : undefined}
          aria-valuetext={valueText}
          className="peer absolute inset-0 w-full cursor-grab opacity-0 active:cursor-grabbing disabled:cursor-not-allowed"
        />
        {/* Custom thumb — picks up focus state from the peer input.
            Touch target 24×24 (WCAG 2.5.8 AA): the visible thumb is 20×20 but
            the underlying input.range covers the full bar. Arrow/Home/End
            keyboard control comes from the native <input>. */}
        <div
          aria-hidden
          className={cn(
            'pointer-events-none absolute top-1/2 h-5 w-5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-[var(--bg)] transition-shadow',
            thumbBg,
            'peer-focus-visible:ring-2 peer-focus-visible:ring-[var(--acc)] peer-focus-visible:ring-offset-2 peer-focus-visible:ring-offset-[var(--bg)]',
          )}
          style={{
            left: `${pct}%`,
            boxShadow: thumbHalo,
            transition: 'left 80ms cubic-bezier(0.4,0,0.2,1)',
          }}
        />
      </div>

      {/* Tick labels: 1 / 5 / 10 (decoratifs, --t-3 instead of --t-4 for AA contrast). */}
      <div className="flex justify-between font-mono text-[10px] tabular-nums text-[var(--t-3)]">
        <span>1</span>
        <span>5</span>
        <span>10</span>
      </div>

      {error ? (
        <p id={errorId} role="alert" className="text-[11px] text-[var(--bad)]">
          {error}
        </p>
      ) : hint ? (
        <p className="t-cap text-[var(--t-3)]">{hint}</p>
      ) : null}
    </div>
  );
}
