'use client';

import { Cookie, X } from 'lucide-react';
import Link from 'next/link';
import { useCallback, useState, useSyncExternalStore } from 'react';

import { Btn } from '@/components/ui/btn';

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
 */
export function CookieBanner(): React.ReactElement | null {
  // We keep a tiny piece of local state for the in-session dismiss-bump :
  // when the user clicks dismiss, `localStorage` is updated AND we re-read
  // the snapshot via the subscribe-callback so the banner unmounts without
  // round-tripping through a window event.
  const [bump, setBump] = useState(0);

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
      role="region"
      aria-label="Information cookies"
      className="fixed inset-x-3 bottom-[max(0.75rem,env(safe-area-inset-bottom))] z-40 mx-auto flex max-w-2xl items-start gap-3 rounded-2xl border border-[var(--b-default)] bg-[var(--bg-3)] p-4 shadow-[var(--sh-toast)] sm:p-5"
    >
      <span
        aria-hidden="true"
        className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-[var(--acc-dim)] text-[var(--acc-hi)]"
      >
        <Cookie className="h-4 w-4" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-[var(--t-1)]">
          Fxmily n&apos;utilise que des cookies techniques.
        </p>
        <p className="mt-1 text-xs leading-relaxed text-[var(--t-2)]">
          Aucun tracker, aucun pixel publicitaire, aucune analytics tierce. Juste un cookie de
          session pour que ton login tienne.{' '}
          <Link
            href="/legal/privacy"
            className="text-[var(--acc-hi)] underline underline-offset-2 hover:text-[var(--acc)]"
          >
            En savoir plus
          </Link>
          .
        </p>
        <Btn
          kind="primary"
          size="m"
          onClick={dismiss}
          className="mt-3"
          aria-label="J'ai compris, fermer la bannière"
        >
          J&apos;ai compris
        </Btn>
      </div>
      <Btn
        kind="ghost"
        size="m"
        onClick={dismiss}
        aria-label="Fermer la bannière cookies"
        className="-mr-1 h-11 w-11 shrink-0 px-0"
      >
        <X aria-hidden="true" className="h-4 w-4" />
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
