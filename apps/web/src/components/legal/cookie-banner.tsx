'use client';

import { Cookie } from 'lucide-react';
import Link from 'next/link';
import { useCallback, useRef, useState, useSyncExternalStore } from 'react';

import { Btn } from '@/components/ui/btn';
import { useBottomSlotReservation } from '@/components/ui/use-bottom-slot-reservation';

const STORAGE_KEY = 'fxmily.cookie.dismissed';

/**
 * `<CookieBanner>` — info-only banner mounted globally from `app/layout.tsx`.
 *
 * Posture (SPEC §16) : Fxmily n'utilise QUE des cookies techniques (auth.js
 * JWT). Pas de tracker tiers, pas de pixel pub, pas d'analytics. Donc pas de
 * "consent management" RGPD obligatoire — uniquement de la transparence
 * opt-out factuelle.
 *
 * State strategy : `useSyncExternalStore` for hydration-safe access to
 * `localStorage` (React 19 idiom that avoids the
 * `react-hooks/set-state-in-effect` lint rule). The server snapshot returns
 * `'hidden'` so the banner never ships in the SSR markup, eliminating the
 * hydration-mismatch flash that a useEffect-based approach would cause.
 *
 * J10 Phase G hardening :
 *   - DS v2 `<Btn>` for the primary action (44px touch, hatch-disabled,
 *     hover lift, focus ring) instead of an ad-hoc `<button>` (UI designer
 *     T2-3 + a11y B3 touch target).
 *   - Body copy bumped from `--t-3` to `--t-2` so contrast on `--bg-3`
 *     clears WCAG 1.4.3 AA at the 12px size (a11y B5).
 *   - `--sh-toast` shadow token instead of magic rgba (UI designer T2-1).
 *
 * 2026-08-05 — proportionality. The banner used to be a 212px stacked card:
 * a third of an iPhone SE screen for a notice that says "we set no trackers".
 * It is now ONE row (icon · two short lines · one action), which is both the
 * honest weight for the message and what makes the height reservation below
 * affordable on a 667px viewport. Two changes make it fit:
 *   - the second sentence moved to the linked privacy page (it repeated the
 *     title), and
 *   - the ghost "✕" is gone: it did exactly what "J'ai compris" does, and two
 *     controls with one behaviour cost 44px of width on mobile for nothing.
 */
export function CookieBanner(): React.ReactElement | null {
  // We keep a tiny piece of local state for the in-session dismiss-bump :
  // when the user clicks dismiss, `localStorage` is updated AND we re-read
  // the snapshot via the subscribe-callback so the banner unmounts without
  // round-tripping through a window event.
  const [bump, setBump] = useState(0);
  const bannerRef = useRef<HTMLDivElement | null>(null);

  const subscribe = useCallback((onChange: () => void) => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === STORAGE_KEY || e.key === null) onChange();
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  const status = useSyncExternalStore<'visible' | 'hidden'>(
    subscribe,
    () => readVisibility(bump),
    // SSR : always render hidden (the banner is purely opt-out information,
    // not a consent gate, so deferring to the post-hydration paint is fine).
    () => 'hidden',
  );

  // Reserve the band this banner occupies instead of painting over the page.
  // Measured, not hardcoded — see the hook for the production defect that
  // justifies it. Hooks run before the early return, as the rules require.
  useBottomSlotReservation(bannerRef, status === 'visible', 'cookie-banner');

  if (status !== 'visible') return null;

  const dismiss = (): void => {
    try {
      window.localStorage.setItem(STORAGE_KEY, '1');
    } catch {
      // Private browsing / quota / disabled storage — fail open. The
      // dismiss won't persist across reloads, but the immediate hide
      // works because of the bump below.
    }
    setBump((n) => n + 1);
  };

  return (
    <div
      ref={bannerRef}
      role="region"
      aria-label="Information cookies"
      data-slot="cookie-banner"
      // `motion-safe:animate-cookie-rise` triggers a 200 ms slide+fade-in
      // from below on first paint. `motion-safe` honours `prefers-reduced-
      // motion` (WCAG 2.3.3). Keyframe defined in globals.css.
      //
      // `data-slot="cookie-banner"` is load-bearing TWICE: globals.css `:has()`
      // rules arbitrate this shared bottom slot against the Log-Express FAB, the
      // desktop sidebar and the mobile bottom-nav (§243 "aucun chevauchement —
      // ni module sur module"), AND the same attribute is what makes the page
      // reserve this banner's height rather than let it occlude the content.
      className="motion-safe:animate-cookie-rise fixed inset-x-3 bottom-[max(0.75rem,env(safe-area-inset-bottom))] z-40 mx-auto flex max-w-2xl items-center gap-3 rounded-2xl border border-[var(--b-default)] bg-[var(--bg-3)] p-3 shadow-[var(--sh-toast)] sm:gap-4 sm:p-4"
    >
      {/* Hidden below `sm`: at 375px those 36px of decoration cost a full line
          of wrapped text, and the icon carries no information the copy doesn't. */}
      <span
        aria-hidden="true"
        className="hidden h-9 w-9 shrink-0 place-items-center rounded-full bg-[var(--acc-dim)] text-[var(--acc-hi)] sm:grid"
      >
        <Cookie className="h-4 w-4" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-[13px] font-medium text-[var(--t-1)] sm:text-sm">
          Cookies techniques uniquement.
        </p>
        <p className="mt-0.5 text-xs leading-relaxed text-[var(--t-2)]">
          Aucun tracker, aucune analytics tierce.{' '}
          {/* WCAG 2.2 SC 2.5.8 exempts a target "in a sentence or otherwise
              constrained by the line-height of non-target text" — which is
              exactly this link. Enlarging it to 24px would add a line to the
              banner, i.e. take back screen from the content it must not cover. */}
          <Link
            href="/legal/privacy"
            className="text-[var(--acc-hi)] underline underline-offset-2 hover:text-[var(--acc)]"
          >
            En savoir plus
          </Link>
          .
        </p>
      </div>
      <Btn
        kind="primary"
        size="m"
        onClick={dismiss}
        className="shrink-0"
        aria-label="J'ai compris, fermer la bannière cookies"
      >
        J&apos;ai compris
      </Btn>
    </div>
  );
}

/** Read the dismiss flag with bump-key stability across re-renders. */
function readVisibility(_bumpKey: number): 'visible' | 'hidden' {
  if (typeof window === 'undefined') return 'hidden';
  try {
    return window.localStorage.getItem(STORAGE_KEY) === '1' ? 'hidden' : 'visible';
  } catch {
    return 'visible';
  }
}
