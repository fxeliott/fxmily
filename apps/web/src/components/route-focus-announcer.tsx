'use client';

import { usePathname } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';

/**
 * S15 #23 — SPA route focus management + announcement (WCAG 2.4.3 Focus Order,
 * 4.1.3 Status Messages).
 *
 * App Router navigations are a client DOM swap: keyboard/screen-reader users who
 * move via the sidebar, ⌘K palette or bottom-nav lost their focus to `<body>` on
 * every page, and nothing announced the new page. The team already masters the
 * pattern at the STEP level (`trade-form-wizard.tsx:356` focuses the heading via
 * a tabIndex=-1 ref) but never applied it at the ROUTE level — this closes that.
 *
 * Mounted in the ROOT layout (NOT template.tsx) on purpose: layout persists
 * across navigations, so `usePathname()` changes are observed without the
 * component remounting (a template-mounted version would remount every nav and
 * its first-mount guard would always be true → never announce).
 *
 * Invariant-safe:
 *   - SKIP the first mount: on the very first page load the skip-link owns focus
 *     management (WCAG 2.4.1); stealing focus to #main-content there would defeat
 *     it. We only act from the 2nd pathname onward.
 *   - focus({ preventScroll: true }): Next already scrolls to top on navigation;
 *     preventScroll avoids a double-scroll fight. #main-content is tabIndex=-1
 *     (layout.tsx:113), so this never adds a tab stop and shows no mouse ring.
 *   - Read after paint (rAF), mirroring the wizard's focus-after-paint timing,
 *     so document.title (set by Next per-route metadata) is the fresh page title.
 *   - Purely additive: zero visual output (sr-only live region), zero backend,
 *     zero impact on posture §2.
 */
export function RouteFocusAnnouncer() {
  const pathname = usePathname();
  const [message, setMessage] = useState('');
  const isFirstRender = useRef(true);

  useEffect(() => {
    if (isFirstRender.current) {
      isFirstRender.current = false;
      return;
    }

    const raf = requestAnimationFrame(() => {
      document.getElementById('main-content')?.focus({ preventScroll: true });
      // "Tableau de bord — Fxmily" → "Tableau de bord". The template suffix is
      // stripped so the announcement is just the page name.
      const title = document.title.replace(/\s*—\s*Fxmily\s*$/, '').trim();
      setMessage(title || 'Page chargée');
    });

    return () => cancelAnimationFrame(raf);
  }, [pathname]);

  return (
    <div aria-live="polite" role="status" className="sr-only">
      {message}
    </div>
  );
}
