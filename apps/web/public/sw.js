/**
 * Fxmily Service Worker (J9 — Web Push notifications).
 *
 * Plain JS (not TS) — Turbopack default in Next.js 16 doesn't compile SWs,
 * and Serwist (the next-pwa successor) is incompatible with Turbopack. We
 * keep this file hand-written so the build is identical in dev and prod.
 *
 * Three responsibilities:
 *
 * 1. **`push` event handler — DUAL payload (Apple declarative + classic)**
 *    Apple Safari 18.4+ (iOS 18.4+/macOS 15.5+) ships *Declarative Web Push*:
 *    if the payload looks like `{ "web_push": 8030, "notification": {...} }`,
 *    Safari renders it WITHOUT executing the SW JS. This is critical because
 *    Apple ITP wipes SW registrations after ~7 days of inactivity — the
 *    declarative path survives. On non-Safari browsers (Chrome, Firefox, edge,
 *    older Safari), this `push` handler runs and we manually parse the same
 *    JSON shape and call `showNotification()`.
 *
 *    Apple's "magic key" is `web_push: 8030` (RFC 8030). The dispatcher always
 *    sends that envelope; we read `data.notification` whichever browser we're
 *    on. Backwards-compat with the original (legacy) shape `{title, body, url}`
 *    is also handled in case a stale enqueued row predates this code.
 *
 * 2. **`notificationclick` event** — focus an existing tab if one matches the
 *    target URL, otherwise open a new window. Always closes the notification.
 *
 * 3. **`pushsubscriptionchange` event** — Firefox-spec auto-resubscribe.
 *    Chrome "effectively never fires" this event (per MDN), but Firefox does.
 *    On iOS Apple may not fire it either; iOS members re-subscribe at next
 *    PWA open via the `<PushToggle>` client island.
 *
 * Versioning: bump VERSION on changes that affect the install/activate flow
 * (clients claim or skip waiting). Browsers re-fetch sw.js on each navigation
 * (`updateViaCache: 'none'` in the registration), so updates propagate.
 *
 * NEVER log push payload content — RGPD data minimization (SPEC §16).
 */

/* eslint-disable @typescript-eslint/no-unused-vars */
/* global self, clients, fetch */

const VERSION = 'fxmily-sw-v1-j9';

// ── Install / activate ──────────────────────────────────────────────────────

self.addEventListener('install', (event) => {
  // Activate the new SW immediately on install — no "waiting" phase. Pairs
  // with `clients.claim()` in `activate` so a freshly opened PWA gets the
  // new SW without an extra page reload.
  event.waitUntil(self.skipWaiting());
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

// ── Push handler — DUAL Apple declarative + classic ─────────────────────────

/**
 * Parse the push payload and return a normalized notification descriptor.
 * Returns null if the payload is unparseable (we drop the event silently —
 * Apple iOS revokes the subscription after 3 missed `showNotification()` calls,
 * but a malformed payload is so rare we accept the risk over showing a
 * placeholder "[error]" notif which would confuse the member).
 */
function parsePayload(eventData) {
  if (!eventData) return null;
  let json;
  try {
    json = eventData.json();
  } catch (_err) {
    return null;
  }

  // Apple declarative shape (RFC 8030 magic key + nested notification).
  if (json && typeof json === 'object' && json.web_push === 8030 && json.notification) {
    return {
      title: json.notification.title,
      body: json.notification.body,
      url: json.notification.navigate || '/dashboard',
      tag: json.tag || json.notification.tag || 'fxmily',
      id: json.id,
      type: json.type,
      lang: json.notification.lang || 'fr-FR',
      dir: json.notification.dir || 'ltr',
      silent: !!json.notification.silent,
      // Apple `app_badge` is rendered natively by the browser when declarative
      // path runs. On the SW path we attempt to set it via the Badging API
      // when supported (Chrome desktop + recent Edge). On Safari this is
      // already handled by the declarative branch — we won't reach here.
      appBadge: typeof json.notification.app_badge === 'number' ? json.notification.app_badge : null,
    };
  }

  // Legacy shape: { title, body, url, tag, type, id } at top level.
  if (json && typeof json === 'object' && typeof json.title === 'string') {
    return {
      title: json.title,
      body: json.body || '',
      url: json.url || '/dashboard',
      tag: json.tag || 'fxmily',
      id: json.id,
      type: json.type,
      lang: 'fr-FR',
      dir: 'ltr',
      silent: false,
      appBadge: null,
    };
  }

  return null;
}

self.addEventListener('push', (event) => {
  const notif = parsePayload(event.data);
  if (!notif || !notif.title) {
    // Nothing renderable — but we MUST still call waitUntil with *something*
    // visible on iOS 16.4+. We choose to silently drop here because parsing
    // errors are so rare (we control the dispatcher) and showing a fake
    // notification would harm trust. If we observe iOS subscription
    // revocations in the audit log, revisit this.
    return;
  }

  const options = {
    body: notif.body,
    icon: '/favicon.svg',
    badge: '/favicon.svg',
    tag: notif.tag, // coalescing per category — replaces older notif of same tag
    data: { url: notif.url, id: notif.id, type: notif.type },
    lang: notif.lang,
    dir: notif.dir,
    silent: notif.silent,
    // `requireInteraction: false` is the default — the OS auto-dismisses after
    // a few seconds. Mark Douglas posture: never sticky/persistent push.
    requireInteraction: false,
  };

  const promises = [self.registration.showNotification(notif.title, options)];

  // Best-effort badge update (Chrome desktop + Edge). Safari handles via
  // the declarative path. Firefox doesn't expose Badging API — skipped.
  if (notif.appBadge !== null && 'setAppBadge' in self.navigator) {
    promises.push(
      notif.appBadge > 0
        ? self.navigator.setAppBadge(notif.appBadge).catch(() => undefined)
        : self.navigator.clearAppBadge().catch(() => undefined),
    );
  }

  event.waitUntil(Promise.all(promises));
});

// ── Notification click — focus existing or open new ─────────────────────────

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const targetUrl = (event.notification.data && event.notification.data.url) || '/dashboard';

  event.waitUntil(
    (async () => {
      const allClients = await self.clients.matchAll({
        type: 'window',
        includeUncontrolled: true,
      });
      // Prefer focusing an existing tab on the same origin (and if possible,
      // the same path — but path-match is best-effort because the URL might
      // include a hash or query).
      for (const client of allClients) {
        try {
          const clientUrl = new URL(client.url);
          const targetParsed = new URL(targetUrl, self.location.origin);
          if (clientUrl.origin === targetParsed.origin) {
            await client.focus();
            // Navigate the focused tab to the target if it's not already there.
            if (clientUrl.pathname !== targetParsed.pathname && 'navigate' in client) {
              try {
                await client.navigate(targetParsed.toString());
              } catch (_err) {
                /* navigate is gated to same-origin SW-controlled clients only;
                 * a cross-context focus + miss is still a UX win. */
              }
            }
            return;
          }
        } catch (_err) {
          /* malformed URL — skip this client */
        }
      }
      // No matching client — open a new window.
      if (self.clients.openWindow) {
        await self.clients.openWindow(targetUrl);
      }
    })(),
  );
});

// ── Push subscription change — Firefox auto-resubscribe ─────────────────────

self.addEventListener('pushsubscriptionchange', (event) => {
  // Re-subscribe with the same applicationServerKey (VAPID public key) and
  // POST the new subscription to our backend so the row gets upserted.
  // Chrome rarely fires this; Firefox does on key rotation. iOS unreliable.
  event.waitUntil(
    (async () => {
      const oldKey =
        event.oldSubscription && event.oldSubscription.options
          ? event.oldSubscription.options.applicationServerKey
          : null;
      if (!oldKey) return;

      try {
        const newSub = await self.registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: oldKey,
        });
        await fetch('/api/account/push/resubscribe', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(newSub.toJSON()),
          credentials: 'include',
        });
      } catch (_err) {
        // Audit log is server-side only. Failed re-subscribe surfaces at next
        // PWA open when `<PushToggle>` checks `permission` + `subscription`.
      }
    })(),
  );
});
