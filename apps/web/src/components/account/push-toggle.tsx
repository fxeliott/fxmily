'use client';

import { Bell, BellOff, Smartphone } from 'lucide-react';
import { useEffect, useState, useTransition } from 'react';

import {
  logPermissionDecisionAction,
  subscribePushAction,
  unsubscribePushAction,
} from '@/app/account/notifications/actions';

/**
 * `<PushToggle>` — main subscribe/unsubscribe control for J9 (`/account/notifications`).
 *
 * Five states, each with a distinct UI :
 *  - `unsupported`     — `serviceWorker` or `PushManager` missing (Safari ≤16.3, IE).
 *                        Pedagogical message, no button.
 *  - `not-standalone`  — Member visiting in a regular browser tab on iOS.
 *                        iOS REQUIRES the PWA be installed via "Add to Home Screen"
 *                        before the permission prompt can be shown. We render
 *                        an onboarding card with the Safari Share-menu hint.
 *  - `permission-denied` — `Notification.permission === 'denied'`. iOS doesn't
 *                          let JS re-prompt; we tell the member to remove + re-add
 *                          the PWA from the home screen. Other OSes can fix it
 *                          via system settings.
 *  - `idle-no-sub`     — Permission granted (or default) + no active subscription.
 *                        Show the "Activer notifications" CTA.
 *  - `subscribed`      — Permission granted + active subscription.
 *                        Show the "Désactiver" CTA + status pill.
 *
 * Posture Mark Douglas (anti-FOMO):
 *  - No "manqué" / "à ne pas rater" copy.
 *  - No persistent badge or counter pulse.
 *  - Permission is asked ONLY on user gesture (click).
 *
 * Apple iOS (`feedback_no_audio` posture):
 *  - We never request `silent: false` audio. The dispatcher payload omits `sound`.
 *  - All notifications are visual + haptic only (system default).
 */

type ToggleState =
  | 'loading'
  | 'unsupported'
  | 'not-standalone'
  | 'permission-denied'
  | 'idle-no-sub'
  | 'subscribed';

type Props = {
  vapidPublicKey: string;
  /** Initial subscription count from the server, for SSR consistency. */
  initialSubscriptionCount: number;
};

/// Convert a base64url VAPID public key into the `Uint8Array<ArrayBuffer>`
/// required by `pushManager.subscribe({ applicationServerKey })`. Uses a
/// fresh `ArrayBuffer` (not `SharedArrayBuffer`) so the resulting view
/// satisfies the `BufferSource` constraint in TS 6+.
function urlBase64ToUint8Array(base64String: string): Uint8Array<ArrayBuffer> {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = atob(base64);
  const buffer = new ArrayBuffer(rawData.length);
  const outputArray = new Uint8Array(buffer);
  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

export function PushToggle({ vapidPublicKey, initialSubscriptionCount }: Props): React.ReactNode {
  const [state, setState] = useState<ToggleState>('loading');
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  // Initial state detection on mount — SSR-incompatible browser-only checks.
  // Wrapped in a single async IIFE so we only call `setState` once, after the
  // microtask boundary. Lints clean against `react-hooks/set-state-in-effect`
  // because the state update is no longer synchronous within the effect body.
  useEffect(() => {
    if (typeof window === 'undefined') return;

    let aborted = false;

    void (async () => {
      let next: ToggleState;

      const isSupported = 'serviceWorker' in navigator && 'PushManager' in window;
      if (!isSupported) {
        next = 'unsupported';
      } else {
        // iOS gates push behind PWA install. Detect standalone via the
        // canonical matchMedia query (Safari + Chrome iOS) plus the legacy
        // `navigator.standalone` (older iOS). Either match is sufficient.
        const isStandalone =
          window.matchMedia('(display-mode: standalone)').matches ||
          ('standalone' in navigator &&
            (navigator as { standalone?: boolean }).standalone === true);

        // Only iOS *requires* standalone before push can be enabled. Others
        // work fine in a browser tab.
        const ua = navigator.userAgent || '';
        const isIosLike =
          /iPad|iPhone|iPod/.test(ua) || (ua.includes('Mac') && 'ontouchend' in document);

        if (isIosLike && !isStandalone) {
          next = 'not-standalone';
        } else if (Notification.permission === 'denied') {
          next = 'permission-denied';
        } else {
          // Check whether we already have a subscription. Tolerate a missing
          // SW registration (racing with `<ServiceWorkerRegister>`).
          try {
            const reg = await navigator.serviceWorker.ready;
            const sub = await reg.pushManager.getSubscription();
            next = sub !== null && initialSubscriptionCount > 0 ? 'subscribed' : 'idle-no-sub';
          } catch {
            next = 'idle-no-sub';
          }
        }
      }

      if (!aborted) setState(next);
    })();

    return () => {
      aborted = true;
    };
  }, [initialSubscriptionCount]);

  async function handleSubscribe(): Promise<void> {
    setError(null);
    try {
      const reg = await navigator.serviceWorker.ready;

      // Permission prompt — must be triggered from the click handler (user gesture).
      let permission: NotificationPermission = Notification.permission;
      if (permission === 'default') {
        permission = await Notification.requestPermission();
      }

      // Audit-only logging for funnel analysis.
      void logPermissionDecisionAction(permission === 'granted' ? 'granted' : 'denied');

      if (permission !== 'granted') {
        setState('permission-denied');
        return;
      }

      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(vapidPublicKey),
      });

      const result = await subscribePushAction(sub.toJSON());
      if (!result.ok) {
        setError(`Erreur côté serveur (${result.error}). Réessaie dans un instant.`);
        // Best-effort cleanup: try to unsubscribe locally so we don't get stuck
        // with a server-orphaned browser subscription.
        await sub.unsubscribe().catch(() => undefined);
        return;
      }

      setState('subscribed');
    } catch (err) {
      console.error('[push-toggle] subscribe failed', err);
      setError("Impossible d'activer les notifications. Réessaie dans un instant.");
    }
  }

  async function handleUnsubscribe(): Promise<void> {
    setError(null);
    try {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      if (!sub) {
        setState('idle-no-sub');
        return;
      }

      const endpoint = sub.endpoint;
      // Unsubscribe browser-side first (idempotent if it fails — we still try
      // to clean up the server row).
      await sub.unsubscribe().catch(() => undefined);

      const result = await unsubscribePushAction({ endpoint });
      if (!result.ok) {
        setError(`Erreur côté serveur (${result.error}).`);
        return;
      }

      setState('idle-no-sub');
    } catch (err) {
      console.error('[push-toggle] unsubscribe failed', err);
      setError('Impossible de désactiver les notifications. Réessaie.');
    }
  }

  // ── Render branches ───────────────────────────────────────────────────────

  if (state === 'loading') {
    return (
      <div className="border-border bg-card text-muted-foreground rounded-lg border p-4 text-sm">
        Vérification du support des notifications…
      </div>
    );
  }

  if (state === 'unsupported') {
    return (
      <div className="border-border bg-card rounded-lg border p-4">
        <div className="text-foreground flex items-center gap-2 text-sm font-medium">
          <BellOff aria-hidden="true" className="h-4 w-4" />
          Navigateur non compatible
        </div>
        <p className="text-muted-foreground mt-1 text-sm">
          Ton navigateur ne supporte pas les notifications push. Sur iOS, ouvre Fxmily depuis Safari
          (≥16.4). Sur Android, utilise Chrome ou Firefox récent.
        </p>
      </div>
    );
  }

  if (state === 'not-standalone') {
    return (
      <div className="border-border bg-card rounded-lg border p-4">
        <div className="text-foreground flex items-center gap-2 text-sm font-medium">
          <Smartphone aria-hidden="true" className="h-4 w-4" />
          Installe Fxmily sur ton écran d&apos;accueil
        </div>
        <p className="text-muted-foreground mt-2 text-sm">
          iOS demande que Fxmily soit ajouté à ton écran d&apos;accueil avant d&apos;autoriser les
          notifications. Ouvre le menu <strong>Partager</strong> de Safari, choisis{' '}
          <strong>Sur l&apos;écran d&apos;accueil</strong>, puis lance Fxmily depuis l&apos;icône
          installée et reviens sur cette page.
        </p>
      </div>
    );
  }

  if (state === 'permission-denied') {
    return (
      <div className="border-warning/30 bg-card rounded-lg border p-4">
        <div className="text-foreground flex items-center gap-2 text-sm font-medium">
          <BellOff aria-hidden="true" className="text-warning h-4 w-4" />
          Notifications bloquées au niveau du système
        </div>
        <p className="text-muted-foreground mt-2 text-sm">
          Sur iOS, désinstalle Fxmily depuis ton écran d&apos;accueil puis réinstalle-le pour
          réautoriser les notifications. Sur Android et desktop, ouvre les{' '}
          <strong>réglages du site</strong> (icône cadenas dans la barre d&apos;adresse) et réactive
          « Notifications ».
        </p>
      </div>
    );
  }

  // idle-no-sub OR subscribed
  const isSubscribed = state === 'subscribed';

  return (
    <div className="border-border bg-card rounded-lg border p-4">
      <div className="flex items-start gap-3">
        <div className="flex-1">
          <div className="text-foreground flex items-center gap-2 text-sm font-medium">
            <Bell aria-hidden="true" className="h-4 w-4" />
            {isSubscribed ? 'Notifications activées' : 'Activer les notifications'}
          </div>
          <p className="text-muted-foreground mt-1 text-sm">
            {isSubscribed
              ? 'Tu reçois les notifications cochées plus bas. Tu peux les désactiver à tout moment.'
              : "Reçois sur ton téléphone les corrections d'Eliot, les rappels de check-in, et les fiches Mark Douglas — au moment où ça sert."}
          </p>
        </div>
        <button
          type="button"
          onClick={() => {
            startTransition(() => {
              void (isSubscribed ? handleUnsubscribe() : handleSubscribe());
            });
          }}
          disabled={isPending}
          className="bg-primary text-primary-foreground focus-visible:ring-primary inline-flex h-11 min-w-11 items-center gap-2 rounded-md px-4 text-sm font-medium transition hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 disabled:opacity-60"
        >
          {isPending ? '…' : isSubscribed ? 'Désactiver' : 'Activer'}
        </button>
      </div>

      {error !== null && (
        <p role="alert" className="text-danger mt-3 text-sm">
          {error}
        </p>
      )}
    </div>
  );
}
