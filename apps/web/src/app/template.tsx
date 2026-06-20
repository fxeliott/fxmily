'use client';

import { m, useReducedMotion } from 'framer-motion';

import { V18_EASE_DRAW } from '@/components/v18/motion-presets';

/**
 * S12 — route enter transition (motion-quality gap: navigation was a hard DOM
 * swap on all 71 routes; only first-paint component entrances animated).
 *
 * In the App Router, `template.tsx` (unlike `layout.tsx`) re-mounts on EVERY
 * navigation, so a single file gives every route a calm unifying fade-in —
 * including the ~45 secondary routes that own no bespoke entrance animation.
 *
 * Design decisions (invariant-safe):
 *   - OPACITY-ONLY (no transform/y). A `transform` on this wrapper would create
 *     a containing block for `position: fixed` descendants AND could linger as
 *     a non-`none` transform at rest — risking the sticky CTA bars + portaled
 *     overlays. Opacity creates a stacking context only WHILE < 1 (never a
 *     containing block), and resolves to a clean `opacity: 1` at rest. Zero
 *     layout cost, compositor-only.
 *   - `useReducedMotion`: members who ask for reduced motion get the content
 *     instantly (no fade), honoring prefers-reduced-motion strictly.
 *   - CALM (180ms, ease-out): process-oriented posture §2 — no bouncy/gamified
 *     swoosh, just enough perceived liveliness to feel "vivante" on every move.
 *   - Layout-neutral wrapper: mirrors `#main-content`'s flex chain so the page
 *     `<main>` keeps the exact same flex parent it had before.
 *
 * Runs inside the global `LazyMotion` (MotionProvider) → `m.div` is valid.
 */
export default function RouteTransition({ children }: { children: React.ReactNode }) {
  const prefersReducedMotion = useReducedMotion();

  if (prefersReducedMotion) {
    return <div className="flex min-h-full flex-1 flex-col">{children}</div>;
  }

  return (
    <m.div
      className="flex min-h-full flex-1 flex-col"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.18, ease: V18_EASE_DRAW }}
    >
      {children}
    </m.div>
  );
}
