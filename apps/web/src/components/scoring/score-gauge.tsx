'use client';

import { animate, m, useMotionValue, useReducedMotion, useTransform } from 'framer-motion';
import { Info, Sparkles } from 'lucide-react';
import { useEffect } from 'react';

import { Sparkline } from '@/components/ui/sparkline';
import { cn } from '@/lib/utils';

/**
 * Radial 0–100 gauge for behavioral scores (J6).
 *
 * SVG-native (no Tremor / Recharts) so we keep full control over the
 * design system tokens (blue/cyan/warn/bad), the entrance animation
 * (`stroke-dashoffset` interpolation), and bundle weight (~1KB gzipped).
 *
 * Posture:
 *   - score = null  → "Données insuffisantes" fallback (insufficient_data
 *                     branch from `lib/scoring/types.ts`).
 *   - score < 50    → tone "bad" (rouge — critique).
 *   - 50–69         → tone "warn" (orangé — à renforcer).
 *   - 70–84         → tone "cy" (cyan — solide).
 *   - 85+           → tone "acc" (blue — excellent).
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
  /** Optional 30-day micro-trend (nulls pre-filtered) for an inline sparkline. */
  trend?: number[];
  /**
   * Tour 15 — the member joined less than 30 days ago (see `lib/scoring/ramp-up`,
   * `RAMP_UP_DAYS`). When true, a
   * low score (< 50) is framed "En rodage" (calm accent) instead of "Critique"
   * (red), with an encouraging caption. Presentation-only; the score is unchanged.
   * Defaults to false so admin / non-member surfaces keep the true diagnostic tone.
   */
  rampUp?: boolean;
}

/** Tour 15 — encouraging caption shown under a gauge in its onboarding floor. */
const RAMP_UP_HINT = 'Ta constance se construit. Les 30 premiers jours posent la base.';

const REASON_TEXT: Record<NonNullable<ScoreGaugeProps['reason']>, string> = {
  no_trades: 'Pas encore de trades clôturés',
  no_computed_trades: 'Stop-loss manquants, clôture des trades pour activer',
  no_checkins: 'Pas encore de check-in renseigné',
  window_short: 'Encore quelques jours pour activer',
};

interface Tone {
  key: 'acc' | 'cy' | 'warn' | 'bad' | 'mute' | 'ramp';
  stroke: string;
  glow: string;
  text: string;
  band: string;
}

/**
 * Map a score to a display tone. `rampUp` (member joined < 30 days
 * ago) FLOORS the lowest band: a sub-50 score reads "En rodage" (neutral accent,
 * encouraging) rather than "Critique" (red). Only the bottom band changes — a
 * member already at "À renforcer"/"Solide"/"Excellent" keeps that tone, and the
 * numeric score is untouched (SPEC §2: we never punish, and never fake a level).
 */
function toneFor(score: number | null, rampUp = false): Tone {
  if (score === null)
    return {
      key: 'mute',
      stroke: 'var(--b-default)',
      glow: 'transparent',
      text: 'text-[var(--t-3)]',
      band: 'En attente',
    };
  if (score < 50) {
    if (rampUp)
      // Onboarding floor — calm accent, never the red "Critique". The copy under
      // the gauge (see `RAMP_UP_HINT`) explains the first 30 days build the base.
      return {
        key: 'ramp',
        stroke: 'var(--acc)',
        glow: 'var(--acc)',
        text: 'text-[var(--acc)]',
        band: 'En rodage',
      };
    return {
      key: 'bad',
      stroke: 'var(--bad)',
      glow: 'var(--bad)',
      text: 'text-[var(--bad)]',
      band: 'Critique',
    };
  }
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
    // `glow` feeds `background:` on the blurred halo div below. Must be a
    // COLOR, not the `--acc-glow` box-shadow token (that rendered nothing —
    // box-shadow syntax is invalid as a background → Excellent tier had no halo).
    glow: 'var(--acc)',
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
  trend,
  rampUp = false,
}: ScoreGaugeProps) {
  const tone = toneFor(score, rampUp);
  // The onboarding floor is only visible when it actually replaces a low band.
  const isRampUpFloor = tone.key === 'ramp';
  const prefersReducedMotion = useReducedMotion();

  // Premium count-up via Framer `useMotionValue` (J6.6 M3 fix). No setState
  // in effect — the motion value drives a `<m.span>` text node directly,
  // bypassing React state. Honors `prefers-reduced-motion` (jumps to target).
  const motionScore = useMotionValue(score === null || prefersReducedMotion ? (score ?? 0) : 0);
  const displayText = useTransform(motionScore, (v) => Math.round(v).toString());
  useEffect(() => {
    if (score === null) return;
    if (prefersReducedMotion) {
      motionScore.set(score);
      return;
    }
    const controls = animate(motionScore, score, {
      duration: 1.1,
      ease: [0.22, 1, 0.36, 1],
    });
    return () => controls.stop();
  }, [score, prefersReducedMotion, motionScore]);

  const isExcellent = score !== null && score >= 95;

  const targetOffset =
    score === null
      ? CIRCUMFERENCE
      : CIRCUMFERENCE - (Math.max(0, Math.min(100, score)) / 100) * CIRCUMFERENCE;

  const ariaLabel =
    score === null
      ? `${label} · données insuffisantes`
      : `${label} : ${score} sur 100, ${tone.band}`;

  const Wrapper: 'button' | 'div' = onClick ? 'button' : 'div';
  const wrapperProps = onClick
    ? {
        type: 'button' as const,
        onClick,
        'aria-label': `${ariaLabel} · voir le détail`,
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
            className={cn(
              'absolute inset-0 rounded-full blur-2xl',
              // Premium tier — score >= 95 glows brighter + steady pulse.
              isExcellent ? 'animate-pulse opacity-50' : 'opacity-30',
            )}
            style={{ background: tone.glow }}
            aria-hidden="true"
          />
        )}
        {/* Excellence sparkle — score >= 95 only. Subtle, not distracting. */}
        {isExcellent ? (
          <Sparkles
            className="absolute -top-1 -right-1 h-4 w-4 text-[var(--acc)]"
            strokeWidth={2}
            aria-hidden="true"
          />
        ) : null}
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
            <m.circle
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
            <span className="t-mono-cap text-[var(--t-4)]">non calculé</span>
          ) : (
            <>
              <m.span
                className={cn(
                  'f-mono text-[28px] font-semibold tracking-[-0.02em] tabular-nums',
                  tone.text,
                )}
              >
                {displayText}
              </m.span>
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
        {/* Tour 15 — onboarding floor caption. Calm, encouraging, never punitive:
            the first 30 days are for building the base, not for a red verdict. */}
        {isRampUpFloor ? (
          <span className="t-cap mt-1 max-w-[15rem] text-balance text-[var(--t-3)]">
            {RAMP_UP_HINT}
          </span>
        ) : null}
      </div>

      {/* Micro-tendance 30j (jalon 2b). Couleur DÉCOUPLÉE du ton de la jauge :
          toujours l'accent calme, JAMAIS rouge même si le score est bas — une
          série en repli s'observe, ne se punit pas (posture §2). Le primitif
          rend `null` sous 2 points (fallback silencieux, pas de trou trompeur). */}
      {score !== null && trend && trend.length >= 2 ? (
        <Sparkline
          data={trend}
          width={132}
          height={26}
          color="var(--acc)"
          strokeWidth={1.5}
          fill
          showLastDot
          ariaLabel={`Micro-tendance de ${label.toLowerCase()} sur ${trend.length} relevés`}
          className="mt-0.5"
        />
      ) : null}
    </Wrapper>
  );
}
