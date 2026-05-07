'use client';

import { motion, useReducedMotion } from 'framer-motion';
import { Info } from 'lucide-react';

import { cn } from '@/lib/utils';

/**
 * Radial 0–100 gauge for behavioral scores (J6).
 *
 * SVG-native (no Tremor / Recharts) so we keep full control over the
 * design system tokens (lime/cyan/warn/bad), the entrance animation
 * (`stroke-dashoffset` interpolation), and bundle weight (~1KB gzipped).
 *
 * Posture:
 *   - score = null  → "Données insuffisantes" fallback (insufficient_data
 *                     branch from `lib/scoring/types.ts`).
 *   - score < 50    → tone "bad" (rouge — critique).
 *   - 50–69         → tone "warn" (orangé — à renforcer).
 *   - 70–84         → tone "cy" (cyan — solide).
 *   - 85+           → tone "acc" (lime — excellent).
 *
 * Mark Douglas alignment: the labels are framed around process execution
 * ("À renforcer", "Solide", "Excellent"), never market prediction.
 *
 * Accessibility:
 *   - `role="img"` + `aria-label` reads "Discipline : 78 sur 100, solide".
 *   - `aria-describedby` hooks the parent's sub-score breakdown so the SR
 *     can drill in.
 *   - `prefers-reduced-motion` short-circuits the entrance animation.
 */

interface ScoreGaugeProps {
  /** 0–100, or null when insufficient_data. */
  score: number | null;
  /** Dimension label. e.g. "Discipline". */
  label: string;
  /** Short caption under the score. e.g. "30 derniers jours". */
  hint?: string;
  /** Optional reason — surfaces a one-liner under the dimension when null. */
  reason?: 'no_trades' | 'no_computed_trades' | 'no_checkins' | 'window_short' | undefined;
  /** Allow callers to plug in a click target (e.g. open a sheet with parts breakdown). */
  onClick?: () => void;
  /** Optional id used by `aria-describedby`. */
  describedById?: string;
}

const REASON_TEXT: Record<NonNullable<ScoreGaugeProps['reason']>, string> = {
  no_trades: 'Pas encore de trades clôturés',
  no_computed_trades: 'Stop-loss manquants — clôture des trades pour activer',
  no_checkins: 'Pas encore de check-in renseigné',
  window_short: 'Encore quelques jours pour activer',
};

interface Tone {
  key: 'acc' | 'cy' | 'warn' | 'bad' | 'mute';
  stroke: string;
  glow: string;
  text: string;
  band: string;
}

function toneFor(score: number | null): Tone {
  if (score === null)
    return {
      key: 'mute',
      stroke: 'var(--b-default)',
      glow: 'transparent',
      text: 'text-[var(--t-3)]',
      band: '—',
    };
  if (score < 50)
    return {
      key: 'bad',
      stroke: 'var(--bad)',
      glow: 'var(--bad)',
      text: 'text-[var(--bad)]',
      band: 'Critique',
    };
  if (score < 70)
    return {
      key: 'warn',
      stroke: 'var(--warn)',
      glow: 'var(--warn)',
      text: 'text-[var(--warn)]',
      band: 'À renforcer',
    };
  if (score < 85)
    return {
      key: 'cy',
      stroke: 'var(--cy)',
      glow: 'var(--cy)',
      text: 'text-[var(--cy)]',
      band: 'Solide',
    };
  return {
    key: 'acc',
    stroke: 'var(--acc)',
    glow: 'var(--acc-glow)',
    text: 'text-[var(--acc)]',
    band: 'Excellent',
  };
}

const SIZE = 124;
const STROKE = 10;
const RADIUS = (SIZE - STROKE) / 2;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

export function ScoreGauge({
  score,
  label,
  hint,
  reason,
  onClick,
  describedById,
}: ScoreGaugeProps) {
  const tone = toneFor(score);
  const prefersReducedMotion = useReducedMotion();

  // Score number is static — the visual sweep comes from the dashoffset
  // animation on the SVG arc (Framer Motion). Animating the digit-by-digit
  // count-up here would require setState-in-effect (lint regression in
  // React 19) and the user gets the same "growing dial" feeling from the
  // arc alone.
  const display = score ?? 0;

  const targetOffset =
    score === null
      ? CIRCUMFERENCE
      : CIRCUMFERENCE - (Math.max(0, Math.min(100, score)) / 100) * CIRCUMFERENCE;

  const ariaLabel =
    score === null
      ? `${label} — données insuffisantes`
      : `${label} : ${score} sur 100, ${tone.band}`;

  const Wrapper: 'button' | 'div' = onClick ? 'button' : 'div';
  const wrapperProps = onClick
    ? {
        type: 'button' as const,
        onClick,
        'aria-label': `${ariaLabel} — voir le détail`,
      }
    : { 'aria-label': ariaLabel, role: 'img' as const };

  return (
    <Wrapper
      {...(wrapperProps as Record<string, unknown>)}
      className={cn(
        'rounded-card-lg group relative flex flex-col items-center gap-2 border border-[var(--b-default)] bg-[var(--bg-1)] p-4 text-center transition-all',
        onClick &&
          'cursor-pointer hover:border-[var(--b-strong)] hover:bg-[var(--bg-2)] focus-visible:border-[var(--b-acc)]',
      )}
      aria-describedby={describedById}
    >
      {/* SVG dial */}
      <div className="relative grid place-items-center" style={{ width: SIZE, height: SIZE }}>
        {score !== null && (
          <div
            className="absolute inset-0 rounded-full opacity-30 blur-2xl"
            style={{ background: tone.glow }}
            aria-hidden="true"
          />
        )}
        <svg
          width={SIZE}
          height={SIZE}
          viewBox={`0 0 ${SIZE} ${SIZE}`}
          className="-rotate-90"
          aria-hidden="true"
        >
          {/* Track */}
          <circle
            cx={SIZE / 2}
            cy={SIZE / 2}
            r={RADIUS}
            stroke="var(--b-default)"
            strokeWidth={STROKE}
            fill="none"
          />
          {/* Progress */}
          {score !== null && (
            <motion.circle
              cx={SIZE / 2}
              cy={SIZE / 2}
              r={RADIUS}
              stroke={tone.stroke}
              strokeWidth={STROKE}
              fill="none"
              strokeLinecap="round"
              strokeDasharray={CIRCUMFERENCE}
              initial={
                prefersReducedMotion
                  ? { strokeDashoffset: targetOffset }
                  : { strokeDashoffset: CIRCUMFERENCE }
              }
              animate={{ strokeDashoffset: targetOffset }}
              transition={{ duration: prefersReducedMotion ? 0 : 1.1, ease: [0.22, 1, 0.36, 1] }}
            />
          )}
        </svg>
        {/* Center text overlay (un-rotated) */}
        <div className="absolute inset-0 flex flex-col items-center justify-center leading-none">
          {score === null ? (
            <span className="t-mono-cap text-[var(--t-4)]">N/A</span>
          ) : (
            <>
              <span
                className={cn(
                  'f-mono text-[28px] font-semibold tabular-nums tracking-[-0.02em]',
                  tone.text,
                )}
              >
                {display}
              </span>
              <span className="t-mono-cap mt-1 text-[var(--t-4)]">/ 100</span>
            </>
          )}
        </div>
      </div>

      <div className="flex flex-col items-center gap-0.5">
        <span className="t-eyebrow">{label}</span>
        <span className={cn('t-h3 leading-tight', tone.text)}>{tone.band}</span>
        {hint ? <span className="t-cap text-[var(--t-4)]">{hint}</span> : null}
        {score === null && reason ? (
          <span className="t-cap mt-1 inline-flex items-center gap-1 text-[var(--t-3)]">
            <Info className="h-3 w-3" strokeWidth={1.75} aria-hidden="true" />
            {REASON_TEXT[reason]}
          </span>
        ) : null}
      </div>
    </Wrapper>
  );
}
