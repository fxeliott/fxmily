'use client';

import { useEffect } from 'react';

/**
 * Client island that registers the Service Worker on mount (J9).
 *
 * Why a dedicated island (rather than register from `<PushToggle>`):
 * - The SW MUST be registered before the user clicks "Activate notifications",
 *   so `pushManager.subscribe()` finds an active registration.
 * - Mounting it once at the layout level keeps the registration global —
 *   the SW handles `notificationclick` even when the member is on
 *   `/dashboard` rather than `/account/notifications`.
 *
 * Idempotency: `register()` is a no-op if the SW is already registered, but
 * we set `updateViaCache: 'none'` so the browser revalidates `/sw.js` on every
 * navigation. Combined with the `Cache-Control: no-cache` header on `/sw.js`
 * (see `next.config.ts`), updates propagate within one tab refresh.
 *
 * Failure modes (Edge cases logged silently — never bubble to UI):
 * - Browser doesn't support SW (Safari ≤16.3, IE) → `'serviceWorker' in navigator`
 *   is false. We just skip; `<PushToggle>` renders the unsupported state.
 * - Registration throws (CSP issue, MIME type mismatch) → log to console; the
 *   member sees "Notifications désactivées" via `<PushToggle>` which polls
 *   `navigator.serviceWorker.ready` with a timeout.
 *
 * No audit log here: registration is an implicit consequence of visiting the
 * app, not an explicit member action. The audit happens at subscribe time.
 */
export function ServiceWorkerRegister(): null {
  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (!('serviceWorker' in navigator)) return;

    const controller = new AbortController();

    void navigator.serviceWorker
      .register('/sw.js', {
        scope: '/',
        updateViaCache: 'none',
      })
      .then((reg) => {
        if (controller.signal.aborted) return;
        // Force an `update()` check after registration — picks up new SW
        // versions deployed since last visit without waiting for the next
        // navigation.
        void reg.update().catch(() => undefined);
      })
      .catch((err) => {
        // Silent failure (with console for dev diagnostics). The push toggle
        // will detect the missing registration when the user clicks subscribe.
        console.warn('[sw] registration failed', err);
      });

    return () => controller.abort();
  }, []);

  return null;
}
