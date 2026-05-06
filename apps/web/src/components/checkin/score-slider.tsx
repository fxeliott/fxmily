'use client';

import { useId } from 'react';

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
   * Optional. Use `null` for the default numeric-only readout.
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
 * Shares the visual language of the trade wizard's R:R slider but simplified:
 * fixed 1–10 range, integer step, lime track. Native `<input type="range">`
 * stays the source of truth so keyboard nav (arrow keys, home/end) and
 * accessibility come for free.
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

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-baseline justify-between">
        <label
          htmlFor={id}
          className="text-[12px] font-medium uppercase tracking-[0.10em] text-[var(--t-3)]"
        >
          {label}
        </label>
        <span className="font-mono text-[11px] tabular-nums text-[var(--t-4)]">
          <span className={cn('font-semibold tabular-nums', valColor)}>{value}</span>
          {unit}
          {describeAt ? (
            <span className="ml-2 normal-case text-[var(--t-3)]">{describeAt(value)}</span>
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
            boxShadow: '0 0 10px -2px oklch(0.879 0.231 130 / 0.45)',
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
        {/* Native input on top, opacity 0 for accessibility */}
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
          className="absolute inset-0 w-full cursor-grab opacity-0 active:cursor-grabbing disabled:cursor-not-allowed"
        />
        {/* Custom thumb */}
        <div
          aria-hidden
          className="pointer-events-none absolute top-1/2 h-5 w-5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-[var(--bg)] bg-[var(--acc)] transition-shadow"
          style={{
            left: `${pct}%`,
            boxShadow: '0 0 0 4px oklch(0.879 0.231 130 / 0.18), 0 2px 4px oklch(0 0 0 / 0.4)',
            transition: 'left 80ms cubic-bezier(0.4,0,0.2,1)',
          }}
        />
      </div>

      {/* Tick labels: 1 / 5 / 10 */}
      <div className="flex justify-between font-mono text-[10px] tabular-nums text-[var(--t-4)]">
        <span>1</span>
        <span>5</span>
        <span>10</span>
      </div>

      {error ? (
        <p id={errorId} role="alert" className="text-[11px] text-[var(--bad)]">
          {error}
        </p>
      ) : hint ? (
        <p className="t-cap text-[var(--t-4)]">{hint}</p>
      ) : null}
    </div>
  );
}
