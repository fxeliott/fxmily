/**
 * V1.9 TIER C — motion presets for the V1.8 `.v18-theme` REFLECT module.
 *
 * Single source of truth for Framer Motion `transition` values + Tailwind
 * `ease` strings so the wizard step transitions + step-progress bar +
 * hero animations stay coherent. V1.8 shipped with three slightly different
 * values inline (damping 28 vs 30, mass 0.6 vs 0.7) — TIER C item B3
 * consolidates them here without any visual change for the spring used in
 * `<WeeklyReviewWizard>` + `<ReflectionWizard>` (220/28/0.7 = canonical).
 *
 * The step-progress bar keeps its own slightly tighter spring (220/30/0.6)
 * exported here as `V18_SPRING_TIGHT` — that one is documented as
 * intentionally less bouncy so the progress fill feels "decisive" while
 * the wizard step transition feels "softer".
 */

import type { Transition } from 'framer-motion';

/**
 * Canonical wizard step transition. Used by `<WeeklyReviewWizard>` and
 * `<ReflectionWizard>` motion.div step containers.
 *
 * Tuning rationale (Q1 2026 audit) :
 *   - `stiffness: 220` lands between Apple HIG iOS animation defaults and
 *     Material Design "standard" curve — feels native on both platforms.
 *   - `damping: 28` over-damped so there's no visible bounce on step
 *     change (process-oriented module, no "snap" gamification).
 *   - `mass: 0.7` keeps the motion light — 1.0 felt sluggish on iPhone SE.
 */
export const V18_SPRING: Transition = {
  type: 'spring',
  stiffness: 220,
  damping: 28,
  mass: 0.7,
};

/**
 * Tighter spring for elements that should feel "decisive" rather than
 * "soft" — currently the step-progress bar fill. Marginally less damping
 * and lighter mass for snappier perceived progress.
 */
export const V18_SPRING_TIGHT: Transition = {
  type: 'spring',
  stiffness: 220,
  damping: 30,
  mass: 0.6,
};

/**
 * Easing string for SVG path-draw assists (used alongside Framer Motion's
 * `pathLength` animation in the hero illustrations). `cubic-bezier`
 * matches the design system's `--e-smooth` token.
 */
export const V18_EASE_DRAW = [0.22, 1, 0.36, 1] as const;
