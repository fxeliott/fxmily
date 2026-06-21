'use client';

import { m, useMotionValue, useReducedMotion, useSpring } from 'framer-motion';
import type { PointerEvent, ReactNode } from 'react';

import { cn } from '@/lib/utils';

/**
 * Magnetic — DS-v3 reusable "pull-to-cursor" micro-interaction wrapper.
 *
 * Wraps a small interactive target (a CTA button, an icon) so it drifts
 * slightly toward the pointer while the mouse hovers over it, then springs
 * back to rest on leave. Compositor-only : we animate ONLY `x`/`y`
 * (translate) — no layout, no paint, no `transform: scale`. The
 * `<LazyMotion>` strict ancestor in the app shell forces the `m.*` alias
 * (bundle-safe).
 *
 * Motion spec (DS-v3) : the offset = pointer-distance-from-center ×
 * `strength`, fed through a spring (stiffness 200 / damping 15 / mass 0.5)
 * so the pull is smooth and the return is critically calm — premium and
 * subtle, never a bouncy gamified yank.
 *
 * Invariants :
 *  - Mouse only. `pointerType !== 'mouse'` is ignored so touch/pen taps
 *    never displace the target out from under a finger.
 *  - `useReducedMotion()` true → a plain `<div>` passthrough, zero magnetism
 *    (WCAG 2.3.3). No spring, no listeners.
 *  - Box-transparent : we don't impose a `display`; the caller's `className`
 *    owns layout so the wrapper can envelop a button without breaking its box.
 */
const SPRING = { stiffness: 200, damping: 15, mass: 0.5 } as const;

export interface MagneticProps {
  children: ReactNode;
  className?: string;
  /** Force d'attraction 0..1. Défaut 0.3. */
  strength?: number;
}

export function Magnetic({ children, className, strength = 0.3 }: MagneticProps) {
  const prefersReducedMotion = useReducedMotion();

  const x = useSpring(useMotionValue(0), SPRING);
  const y = useSpring(useMotionValue(0), SPRING);

  // AT users (and reduced-motion preference) get a static, listener-free
  // surface — never call hooks conditionally above this point.
  if (prefersReducedMotion) {
    return <div className={className}>{children}</div>;
  }

  const handlePointerMove = (e: PointerEvent<HTMLDivElement>) => {
    if (e.pointerType !== 'mouse') return;
    const rect = e.currentTarget.getBoundingClientRect();
    const offsetX = e.clientX - (rect.left + rect.width / 2);
    const offsetY = e.clientY - (rect.top + rect.height / 2);
    x.set(offsetX * strength);
    y.set(offsetY * strength);
  };

  const handlePointerLeave = () => {
    x.set(0);
    y.set(0);
  };

  return (
    <m.div
      className={cn(className)}
      style={{ x, y }}
      onPointerMove={handlePointerMove}
      onPointerLeave={handlePointerLeave}
    >
      {children}
    </m.div>
  );
}
