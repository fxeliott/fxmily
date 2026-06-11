'use client';

import { useRouter } from 'next/navigation';
import { useEffect } from 'react';

/**
 * S4 DOD1-04 — the « Nouveau trade » CTA on /dashboard advertises a `N`
 * keyboard shortcut (`<Kbd>N</Kbd>`); this invisible client component makes
 * the promise real. Renders nothing.
 *
 * Defensive guards — the shortcut must NEVER fire while the member types or
 * navigates a dialog:
 *  - any modifier held (avoid clobbering browser/OS combos),
 *  - focus inside an input / textarea / select / contenteditable,
 *  - focus inside an open dialog (Radix Sheet/Dialog — e.g. the Log-Express
 *    FAB sheet traps focus on buttons, not inputs).
 */
export function JournalShortcut(): null {
  const router = useRouter();

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'n' && event.key !== 'N') return;
      if (event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return;
      if (event.defaultPrevented || event.isComposing) return;
      const target = event.target;
      if (target instanceof HTMLElement) {
        if (
          target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.tagName === 'SELECT' ||
          target.isContentEditable ||
          target.closest('[role="dialog"]') !== null
        ) {
          return;
        }
      }
      router.push('/journal/new');
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [router]);

  return null;
}
