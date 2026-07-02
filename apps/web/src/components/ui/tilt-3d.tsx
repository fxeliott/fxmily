'use client';

import { m, useMotionValue, useReducedMotion, useSpring, useTransform } from 'framer-motion';
import type { PointerEvent, ReactNode } from 'react';

import { cn } from '@/lib/utils';

/**
 * Tilt3D — DS-v3 reusable 3D pointer-tilt wrapper.
 *
 * Wraps a surface (a `<Card>`/feature tile) so it gently tilts in 3D
 * space toward the cursor — a premium "card floating in space" depth
 * cue. The outer `<div>` owns the `perspective` and captures pointer
 * events; the inner `<m.div>` only ever animates `rotateX`/`rotateY`
 * (transform 3D) — compositor-only, zero layout, zero paint. The
 * `<LazyMotion>` strict ancestor in the app shell forces the `m.*`
 * alias (bundle-safe).
 *
 * Motion spec : spring stiffness 220 / damping 20 / mass 0.6 drives a
 * smooth follow + fluid return-to-rest. Tilt is clamped to ~8deg max
 * — subtle, never the kitsch over-rotated parallax. Optional
 * `hoverScale` (>1) adds a faint lift on hover; left at 1.0 it's a no-op.
 *
 * Invariants :
 *  - Compositor-only : ONLY rotateX/rotateY (+ optional scale) animate.
 *    Never touch layout/paint properties.
 *  - Coarse pointers (touch/pen) are ignored — `pointerType !== 'mouse'`
 *    short-circuits onPointerMove so a finger never tilts the card.
 *  - `useReducedMotion()` true → flat surface (WCAG 2.3.3): the pointer
 *    handlers short-circuit so rotateX/rotateY never leave 0deg and the
 *    hover scale is dropped. The TREE stays identical to the animated
 *    branch — a structural `if (reduced) return <div>` diverges from the
 *    SSR HTML (the server never knows the preference) and React 19 never
 *    patches hydration mismatches, shifting every downstream `useId`
 *    (caught by the F2 e2e trace, CI run 28584461967). Handlers and
 *    springs are not serialized, so guarding them is hydration-safe.
 *  - Premium-but-professional : max ~8deg, calm spring — depth, not a toy.
 */
const SPRING = { stiffness: 220, damping: 20, mass: 0.6 } as const;

export interface Tilt3DProps {
  children: ReactNode;
  className?: string;
  /** Inclinaison max en degrés. Défaut 8. */
  maxDeg?: number;
  /** Léger grossissement au survol. Défaut 1.0 (désactivé). */
  hoverScale?: number;
}

export function Tilt3D({ children, className, maxDeg = 8, hoverScale = 1.0 }: Tilt3DProps) {
  const prefersReducedMotion = useReducedMotion();

  // -0.5..0.5 normalized cursor position within the card; spring-smoothed.
  const px = useMotionValue(0);
  const py = useMotionValue(0);
  const rotateY = useSpring(
    useTransform(px, (v) => v * maxDeg * 2),
    SPRING,
  );
  const rotateX = useSpring(
    useTransform(py, (v) => -v * maxDeg * 2),
    SPRING,
  );

  const handlePointerMove = (e: PointerEvent<HTMLDivElement>) => {
    // Reduced-motion → static surface (WCAG 2.3.3): the values stay at rest.
    if (prefersReducedMotion) return;
    // Ignore coarse pointers (touch/pen) — only a real mouse tilts the card.
    if (e.pointerType !== 'mouse') return;
    const rect = e.currentTarget.getBoundingClientRect();
    px.set((e.clientX - rect.left) / rect.width - 0.5);
    py.set((e.clientY - rect.top) / rect.height - 0.5);
  };

  const handlePointerLeave = () => {
    // Reset to rest — the spring animates the fluid return.
    px.set(0);
    py.set(0);
  };

  return (
    <div
      className={cn(className)}
      style={{ perspective: 900 }}
      onPointerMove={handlePointerMove}
      onPointerLeave={handlePointerLeave}
    >
      <m.div
        style={{ rotateX, rotateY, transformStyle: 'preserve-3d' }}
        {...(hoverScale > 1 && !prefersReducedMotion ? { whileHover: { scale: hoverScale } } : {})}
      >
        {children}
      </m.div>
    </div>
  );
}
