'use client';

import { Smartphone, X } from 'lucide-react';
import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';

import { Btn } from '@/components/ui/btn';

const STORAGE_KEY = 'fxmily.a2hs.dismissed';

/**
 * `BeforeInstallPromptEvent` — non-standard, Chromium-only. Typed locally
 * because lib.dom.d.ts doesn't ship it.
 */
interface BeforeInstallPromptEvent extends Event {
  readonly platforms: string[];
  prompt: () => Promise<void>;
  readonly userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
}

/**
 * `<A2HSHint>` — discreet "Add to Home Screen" install hint (Tour 15 PWA).
 *
 * Mounted once on the member dashboard. It renders NOTHING until the browser
 * fires `beforeinstallprompt` (Chromium: Android Chrome, desktop Chrome/Edge).
 * That gate is the whole design:
 *  - iOS Safari never fires the event, so nothing shows there (Apple's A2HS is
 *    a manual Share-sheet flow; a nag banner would be noise). Per brief we do
 *    NOT ship an iOS-specific banner — the app stays quiet on that platform.
 *  - Already-installed PWAs (`display-mode: standalone`) never see it either.
 *  - Once dismissed (or once the native prompt is shown), the flag persists in
 *    localStorage so the hint appears at most once. Never blocking, never modal.
 *
 * Placement (Tour 16): a full-width bottom banner on mobile (its natural home),
 * but from `sm` up it tucks into the bottom-RIGHT corner as a discreet card so
 * it never spans a 1440px desktop viewport where a centred full-bleed toast is
 * intrusive.
 *
 * Hydration safety (repo lesson `reference_reduced-motion-hydration`): the JSX
 * tree never branches on `useReducedMotion`; the rise animation is a
 * `motion-safe:` CSS class only. The dismiss flag is read via
 * `useSyncExternalStore` (SSR snapshot = dismissed) so nothing ships in the
 * server markup and there's no hydration flash. The deferred prompt lives in
 * plain `useState` populated by an event listener.
 */
export function A2HSHint(): React.ReactElement | null {
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [bump, setBump] = useState(0);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    const onBeforeInstall = (event: Event): void => {
      // Suppress Chrome's default mini-infobar; we present our own calm hint.
      event.preventDefault();
      setDeferredPrompt(event as BeforeInstallPromptEvent);
    };
    const onInstalled = (): void => {
      // App was installed (via our button or the browser menu) — retire the hint.
      persistDismiss();
      setDeferredPrompt(null);
      setBump((n) => n + 1);
    };

    window.addEventListener('beforeinstallprompt', onBeforeInstall);
    window.addEventListener('appinstalled', onInstalled);
    return () => {
      window.removeEventListener('beforeinstallprompt', onBeforeInstall);
      window.removeEventListener('appinstalled', onInstalled);
    };
  }, []);

  const subscribe = useCallback((onChange: () => void) => {
    const onStorage = (e: StorageEvent): void => {
      if (e.key === STORAGE_KEY || e.key === null) onChange();
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  const dismissed = useSyncExternalStore<boolean>(
    subscribe,
    () => readDismissed(bump),
    () => true, // SSR: treat as dismissed so nothing renders server-side.
  );

  const dismiss = (): void => {
    persistDismiss();
    setBump((n) => n + 1);
  };

  const install = async (): Promise<void> => {
    if (!deferredPrompt) return;
    // Hide the hint immediately; the native prompt takes over.
    persistDismiss();
    setBump((n) => n + 1);
    try {
      await deferredPrompt.prompt();
      await deferredPrompt.userChoice;
    } catch {
      // Prompt can only be called once; a throw here is non-fatal — the flag
      // is already persisted so we won't re-nag.
    } finally {
      setDeferredPrompt(null);
    }
  };

  // Show only when we actually have a captured prompt AND it isn't dismissed.
  if (dismissed || !deferredPrompt) return null;

  return (
    <div
      role="region"
      aria-label="Installer l'application"
      data-slot="a2hs-hint"
      className="motion-safe:animate-cookie-rise fixed inset-x-3 bottom-[max(0.75rem,env(safe-area-inset-bottom))] z-40 mx-auto flex max-w-md items-start gap-3 rounded-2xl border border-[var(--b-default)] bg-[var(--bg-3)] p-4 shadow-[var(--sh-toast)] sm:inset-x-auto sm:right-4 sm:bottom-4 sm:mx-0 sm:max-w-sm sm:p-5"
    >
      <span
        aria-hidden="true"
        className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-[var(--acc-dim)] text-[var(--acc-hi)]"
      >
        <Smartphone className="h-4 w-4" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-[var(--t-1)]">Installe Fxmily sur ton écran.</p>
        <p className="mt-1 text-xs leading-relaxed text-[var(--t-2)]">
          Un accès direct, plein écran, sans passer par le navigateur. Tu peux toujours désinstaller
          quand tu veux.
        </p>
        <Btn
          kind="primary"
          size="m"
          onClick={() => void install()}
          className="mt-3"
          aria-label="Installer l'application Fxmily"
        >
          Installer l&apos;app
        </Btn>
      </div>
      <Btn
        kind="ghost"
        size="m"
        onClick={dismiss}
        aria-label="Fermer le hint d'installation"
        className="-mr-1 h-11 w-11 shrink-0 px-0"
      >
        <X aria-hidden="true" className="h-4 w-4" />
      </Btn>
    </div>
  );
}

/** Persist the dismiss flag; fail open (private mode / disabled storage). */
function persistDismiss(): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, '1');
  } catch {
    /* fail open — in-session dismiss still works via the bump */
  }
}

/** Read the dismiss flag with bump-key stability across re-renders. */
function readDismissed(_bumpKey: number): boolean {
  if (typeof window === 'undefined') return true;
  try {
    return window.localStorage.getItem(STORAGE_KEY) === '1';
  } catch {
    // Storage unreadable — default to NOT dismissed so a supported browser
    // still gets the (one-time, event-gated) hint.
    return false;
  }
}
