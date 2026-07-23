'use client';

import { X } from 'lucide-react';
import Link from 'next/link';
import { useSyncExternalStore } from 'react';

import { btnVariants } from '@/components/ui/btn';
import { cn } from '@/lib/utils';
import { detectPlatform, isStandalone } from '@/lib/pwa/platform';

/**
 * `<IOSInstallHint>` — a calm, non-modal banner nudging iOS Safari users to
 * install Fxmily.
 *
 * It appears ONLY when:
 * - the platform is iOS **and** the browser is Safari (Chrome/Firefox/etc. on
 *   iOS can't run the Share-sheet "Add to Home Screen" flow), and
 * - the app is not already running standalone, and
 * - the member has not dismissed it (persisted in `localStorage`).
 *
 * iOS never fires `beforeinstallprompt`, so `<A2hsHint>` renders nothing there —
 * this component fills that gap. It only points to `/install`; the actual
 * step-by-step lives on that page.
 *
 * Hydration-safe: the server snapshot is "dismissed", so the component renders
 * nothing on the server and on the first client paint (no flash, no mismatch).
 * After hydration it re-reads `localStorage` and the real platform. Same
 * `useSyncExternalStore` discipline as `<A2hsHint>`.
 */

const STORAGE_KEY = 'fxmily.ios-a2hs.dismissed';

const listeners = new Set<() => void>();

function emitChange() {
  for (const listener of listeners) listener();
}

function subscribe(onChange: () => void): () => void {
  listeners.add(onChange);
  const onStorage = (event: StorageEvent) => {
    if (event.key === STORAGE_KEY || event.key === null) onChange();
  };
  window.addEventListener('storage', onStorage);
  return () => {
    listeners.delete(onChange);
    window.removeEventListener('storage', onStorage);
  };
}

/** Client snapshot: true if dismissed. Fails open (false = NOT dismissed) on error. */
function getSnapshot(): boolean {
  if (typeof window === 'undefined') return true;
  try {
    return window.localStorage.getItem(STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

/** Server (and first-hydration) snapshot: treat as dismissed so nothing renders. */
function getServerSnapshot(): boolean {
  return true;
}

function persistDismiss(): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, '1');
  } catch {
    // Storage unavailable (private mode / blocked) — dismiss for this view only.
  }
  emitChange();
}

/** iOS Safari specifically — excludes Chrome (CriOS), Firefox (FxiOS), Edge, Opera on iOS. */
function isIosSafari(): boolean {
  if (typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent;
  // Pass maxTouchPoints so an iPadOS Safari masquerading as a "Macintosh" UA is
  // still classified as iOS (see platform.ts) — otherwise this hint would never
  // reach exactly the desktop-mode iPad users it is meant for.
  if (detectPlatform(ua, navigator.maxTouchPoints) !== 'ios') return false;
  return /safari/i.test(ua) && !/crios|fxios|edgios|opt\//i.test(ua);
}

export function IOSInstallHint() {
  const dismissed = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  if (dismissed || !isIosSafari() || isStandalone()) return null;

  return (
    <div
      role="region"
      aria-label="Installer Fxmily sur iPhone"
      data-slot="ios-install-hint"
      className="motion-safe:animate-cookie-rise rounded-card-lg fixed inset-x-3 bottom-[max(0.75rem,env(safe-area-inset-bottom))] z-40 mx-auto flex max-w-md items-center gap-3 border border-[var(--b-default)] bg-[var(--bg-1)] px-4 py-3 shadow-[var(--sh-toast)]"
    >
      <span
        aria-hidden="true"
        className="grid h-9 w-9 shrink-0 place-items-center rounded-[10px] bg-[var(--acc)] text-[15px] font-bold text-[var(--acc-fg)]"
      >
        f
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-[13px] font-medium text-[var(--t-1)]">
          Ajoute Fxmily à ton écran d&apos;accueil
        </p>
        <p className="t-cap mt-0.5 text-[var(--t-3)]">
          Ouverture en plein écran, en un geste depuis Safari.
        </p>
      </div>
      <Link
        href="/install"
        className={cn(btnVariants({ kind: 'primary', size: 's' }), 'shrink-0')}
        onClick={persistDismiss}
      >
        Voir
      </Link>
      <button
        type="button"
        onClick={persistDismiss}
        aria-label="Fermer"
        className="rounded-control grid h-11 w-11 shrink-0 place-items-center text-[var(--t-3)] transition-colors hover:text-[var(--t-1)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--acc)]"
      >
        <X className="h-4 w-4" strokeWidth={1.75} aria-hidden />
      </button>
    </div>
  );
}
