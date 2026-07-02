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
 *     instantly (duration 0), honoring prefers-reduced-motion strictly.
 *   - SINGLE TREE both branches (hydration invariant): the server never knows
 *     `prefers-reduced-motion` and always renders the animated branch, so a
 *     `if (reduced) return <div>` here diverges from the SSR HTML on every
 *     reduced-motion client. React 19 does NOT patch attribute mismatches —
 *     the serialized `style="opacity:0"` then sticks forever and the whole
 *     route stays invisible (caught by the F2 e2e trace, CI run 28584461967).
 *     Reduction therefore lives in `transition` (not serialized to HTML),
 *     never in the tree shape — this also keeps `useId` stable downstream.
 *   - CALM (180ms, ease-out): process-oriented posture §2 — no bouncy/gamified
 *     swoosh, just enough perceived liveliness to feel "vivante" on every move.
 *   - Layout-neutral wrapper: mirrors `#main-content`'s flex chain so the page
 *     `<main>` keeps the exact same flex parent it had before.
 *
 * Runs inside the global `LazyMotion` (MotionProvider) → `m.div` is valid.
 */
export default function RouteTransition({ children }: { children: React.ReactNode }) {
  const prefersReducedMotion = useReducedMotion();

  return (
    <m.div
      className="flex min-h-full flex-1 flex-col"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={prefersReducedMotion ? { duration: 0 } : { duration: 0.18, ease: V18_EASE_DRAW }}
    >
      {children}
    </m.div>
  );
}
