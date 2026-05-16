'use client';

import { domAnimation, LazyMotion } from 'framer-motion';

/**
 * Single global `LazyMotion` provider (perf — bundle size).
 *
 * Without `LazyMotion`, every `motion.*` pulls Framer Motion's full
 * feature set into the client bundle. With this provider + the `m.*`
 * component used app-wide instead of `motion.*`, only the lean
 * DOM-animation feature set ships.
 *
 * `domAnimation` (not `domMax`) is deliberate and sufficient: the app
 * uses gestures (`whileTap`), `AnimatePresence` (`mode="wait"`),
 * `variants`, `useReducedMotion`, and core motion-value hooks only —
 * there is ZERO `layout` / `layoutId` / `drag` / `Reorder` / `popLayout`
 * usage (verified by grep). `domMax` would only add layout + drag.
 *
 * `strict` makes any residual `motion.*` throw, so the bundle saving
 * cannot silently regress: CI Playwright renders every route, so a
 * missed `motion.*` fails the pipeline rather than quietly re-bloating.
 *
 * Mounted from the root layout (a Server Component) through this
 * `'use client'` boundary, wrapping all route content — the only place
 * `m.*` renders (the global FAB / footer / cookie banner use no Framer).
 * Synchronous `features` (no async import): the ~50% feature-bundle cut
 * is the win; deferring the remaining lean set off the critical path is
 * a separate optimization, intentionally not bundled here.
 */
export function MotionProvider({ children }: { children: React.ReactNode }) {
  return (
    <LazyMotion features={domAnimation} strict>
      {children}
    </LazyMotion>
  );
}
