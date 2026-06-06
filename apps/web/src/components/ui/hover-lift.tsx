'use client';

import { m, useReducedMotion } from 'framer-motion';
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
 * scale 1.02 + y -2px, tap scale 0.98. `useReducedMotion()` strips
 * every gesture so AT users get a static surface (WCAG 2.3.3).
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
  const prefersReducedMotion = useReducedMotion();

  return (
    <m.div
      className={className}
      transition={SPRING}
      {...(prefersReducedMotion
        ? {}
        : { whileHover: { scale: 1.02, y: -2 }, whileTap: { scale: 0.98 } })}
    >
      {children}
    </m.div>
  );
}
