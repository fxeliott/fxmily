'use client';

import { Clock, X } from 'lucide-react';
import Link from 'next/link';
import { useCallback, useState, useSyncExternalStore } from 'react';

import { Btn } from '@/components/ui/btn';
import { dismissKeyFor, isTimezoneMismatch, isValidIana } from '@/lib/account/timezone-mismatch';

/**
 * `<TimezoneMismatchNudge>` — discreet banner shown on the dashboard when the
 * browser's IANA timezone differs from the member's PROFILE timezone (Tour 15).
 *
 * Why: daily journeys anchor to the profile timezone (`User.timezone`), so a
 * member who travelled (or never set their zone) can see their days "tomber" on
 * the wrong civil day. This calmly points that out and links to the setting —
 * never a modal, never blocking.
 *
 * Hydration safety (repo lesson `reference_reduced-motion-hydration`):
 *  - the browser timezone is read via `useSyncExternalStore` whose SERVER
 *    snapshot is `null`, so the SSR render never computes a mismatch (no
 *    server/client divergence, no setState-in-effect cascade);
 *  - the JSX tree never branches on `useReducedMotion` — the rise is a
 *    `motion-safe:` CSS class only;
 *  - the dismiss flag is likewise read via `useSyncExternalStore` with an SSR
 *    snapshot of "dismissed", so nothing ships in the server markup, no flash.
 *
 * The dismiss key includes the ORDERED pair of zones, so dismissing the
 * "Europe/Paris vs Asia/Tokyo" nudge does NOT silence a later, genuinely
 * different mismatch (the member's situation changed → re-surface once).
 */
export function TimezoneMismatchNudge({
  profileTimezone,
}: {
  /** The member's `User.timezone` (IANA), the day-anchoring source of truth. */
  profileTimezone: string;
}): React.ReactElement | null {
  const [bump, setBump] = useState(0);

  // Browser timezone as an external-system read: the client snapshot resolves the
  // IANA zone, the SERVER snapshot is null (nothing renders server-side, and the
  // client rehydrates to the real value without a setState-in-effect cascade).
  // The zone is stable for the session, so `subscribe` never needs to fire.
  const browserTimezone = useSyncExternalStore<string | null>(
    noopSubscribe,
    readBrowserTimezone,
    () => null,
  );

  const mismatch = isTimezoneMismatch(profileTimezone, browserTimezone);

  // Storage key is per ordered pair so a resolved/changed situation re-surfaces.
  const storageKey = dismissKeyFor(profileTimezone, browserTimezone);

  const subscribe = useCallback(
    (onChange: () => void) => {
      const onStorage = (e: StorageEvent): void => {
        if (e.key === storageKey || e.key === null) onChange();
      };
      window.addEventListener('storage', onStorage);
      return () => window.removeEventListener('storage', onStorage);
    },
    [storageKey],
  );

  const dismissed = useSyncExternalStore<boolean>(
    subscribe,
    () => readDismissed(storageKey, bump),
    () => true, // SSR: treat as dismissed so nothing renders server-side.
  );

  if (!mismatch || dismissed) return null;

  const dismiss = (): void => {
    persistDismiss(storageKey);
    setBump((n) => n + 1);
  };

  return (
    <div
      role="region"
      aria-label="Fuseau horaire à vérifier"
      data-slot="tz-mismatch-nudge"
      className="motion-safe:animate-cookie-rise rounded-card flex items-start gap-3 border border-[var(--warn-edge)] bg-[var(--warn-dim)] p-4"
    >
      <span
        aria-hidden="true"
        className="rounded-control grid h-8 w-8 shrink-0 place-items-center border border-[var(--warn-edge)] bg-[var(--warn-dim)] text-[var(--warn)]"
      >
        <Clock className="h-4 w-4" strokeWidth={1.75} />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-[var(--t-1)]">
          Ton navigateur est sur le fuseau {browserTimezone}, ton profil sur {profileTimezone}.
        </p>
        <p className="mt-1 text-xs leading-relaxed text-[var(--t-2)]">
          Vérifie ton réglage pour que tes journées tombent juste.
        </p>
        <Link
          href="/account/timezone"
          className="mt-3 inline-flex items-center gap-1.5 text-[13px] font-medium text-[var(--acc-hi)] underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--acc)]"
        >
          Régler mon fuseau
        </Link>
      </div>
      <Btn
        kind="ghost"
        size="m"
        onClick={dismiss}
        aria-label="Fermer le rappel de fuseau horaire"
        className="-mr-1 h-11 w-11 shrink-0 px-0"
      >
        <X aria-hidden="true" className="h-4 w-4" />
      </Btn>
    </div>
  );
}

/** The browser timezone is stable for the session — no external change to watch. */
function noopSubscribe(): () => void {
  return () => {};
}

/** Client snapshot: the resolved IANA browser zone, or null when unavailable. */
function readBrowserTimezone(): string | null {
  try {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    return tz && isValidIana(tz) ? tz : null;
  } catch {
    // No Intl / unreadable — stay silent (never a false nudge).
    return null;
  }
}

/** Persist the per-pair dismiss flag; fail open (private mode / disabled storage). */
function persistDismiss(key: string | null): void {
  if (!key) return;
  try {
    window.localStorage.setItem(key, '1');
  } catch {
    /* fail open — in-session dismiss still works via the bump */
  }
}

/** Read the dismiss flag with bump-key stability across re-renders. */
function readDismissed(key: string | null, _bumpKey: number): boolean {
  if (typeof window === 'undefined' || !key) return true;
  try {
    return window.localStorage.getItem(key) === '1';
  } catch {
    // Storage unreadable — default to NOT dismissed so the nudge still shows.
    return false;
  }
}
