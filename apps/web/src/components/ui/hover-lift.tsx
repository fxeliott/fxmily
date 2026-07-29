'use client';

import { m } from 'framer-motion';
import type { ReactNode } from 'react';

/**
 * HoverLift — DS-v3 (J3) reusable spring micro-interaction wrapper.
 *
 * Wraps an interactive surface (a clickable `<Link>`/`<Card>`) in a
 * spring-driven hover lift + tap press. GPU-only transforms (scale +
 * translateY) — no layout, no paint thrash. The `<LazyMotion>` strict
 * ancestor in the app shell forces the `m.*` alias (bundle-safe).
 *
 * Motion spec (DS-v3) : spring stiffness 310 / damping 22, hover
 * scale 1.02 + y -2px, tap scale 0.98.
 *
 * ⚠️ REDUCED MOTION IS **NOT** HANDLED BY A BRANCH HERE — AND THAT IS THE FIX.
 *
 * This component used to strip the gestures with `useReducedMotion()`. It looked
 * safe: `whileHover` / `whileTap` are Framer props, they are not HTML
 * attributes, so a conditional spread "cannot" change the serialized markup.
 * It can, indirectly. Framer makes a `whileTap` element keyboard-reachable by
 * emitting `tabIndex={0}` when the caller did not set one. So:
 *
 *   server   → `useReducedMotion()` is null (the server cannot know the user
 *              preference) → gestures added → `tabindex="0"` in the HTML
 *   client   → the member asked for reduced motion → gestures dropped → no
 *              tabIndex
 *   React 19 → "some attributes of the server rendered HTML didn't match the
 *              client properties. This won't be patched up."
 *
 * Measured 2026-07-29 on `/calendrier`, where `NextStepRail` wraps its `<nav>`
 * in this component; the React diff named the attribute: `- tabindex="0"`.
 *
 * The reduction now lives where it belongs: `<MotionConfig reducedMotion="user">`
 * in `components/motion-provider.tsx` wraps the whole app and neutralises
 * transform animations (scale, y) for members who ask for it. That mechanism
 * runs identically on both sides, so it cannot desynchronise anything.
 *
 * `tabIndex={-1}` is explicit for two reasons: it pins the attribute so Framer
 * never invents one, and it keeps a purely DECORATIVE wrapper out of the tab
 * order (WCAG 2.4.3). The interactive child — the `<Link>` or `<button>` this
 * wraps — remains the tab stop, exactly as before.
 *
 * Premium-but-professional invariant : a calm 2px lift, never a
 * bounce-y gamified pop. No colour change, no shadow flash here —
 * the surface keeps its own hover affordance (border/shadow).
 */
const SPRING = { type: 'spring', stiffness: 310, damping: 22, mass: 0.7 } as const;

export interface HoverLiftProps {
  children: ReactNode;
  className?: string;
}

export function HoverLift({ children, className }: HoverLiftProps) {
  return (
    <m.div
      className={className}
      transition={SPRING}
      tabIndex={-1}
      whileHover={{ scale: 1.02, y: -2 }}
      whileTap={{ scale: 0.98 }}
    >
      {children}
    </m.div>
  );
}
