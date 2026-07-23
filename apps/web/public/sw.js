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
 * Tour 15 — 4th responsibility: an OFFLINE navigation fallback. We pre-cache
 * `/offline` at install into a versioned Cache Storage bucket, drop stale
 * buckets at activate, and — for NAVIGATION requests only — serve the cached
 * `/offline` page when the network is unreachable (network-first).
 *
 * J8 (SCOPE 3) — 5th responsibility: an app-SHELL cache. At install we ALSO
 * pre-cache the manifest icons, and at runtime we serve immutable same-origin
 * assets (`/_next/static/*`, `/icon*`, `/apple-icon`, `/favicon.svg`) CACHE-FIRST
 * from a versioned runtime
 * bucket. Navigations stay network-first; the push handlers are untouched. See
 * the fetch handler for the production-build testing caveat.
 *
 * NEVER log push payload content — RGPD data minimization (SPEC §16).
 */

/* eslint-disable @typescript-eslint/no-unused-vars */
/* global self, clients, fetch, caches, Request */

const VERSION = 'fxmily-sw-v4-j8';

// Bumping VERSION rotates every bucket name below, so `activate` can delete any
// Cache Storage bucket that isn't part of the current version.
//  · CACHE_NAME    — the shell bucket, pre-cached at install (offline page + icons).
//  · RUNTIME_CACHE — filled on demand by the cache-first immutable-asset strategy.
const CACHE_NAME = `fxmily-shell-${VERSION}`;
const RUNTIME_CACHE = `fxmily-runtime-${VERSION}`;
const CURRENT_CACHES = [CACHE_NAME, RUNTIME_CACHE];

const OFFLINE_URL = '/offline';

// App-shell icon list: the manifest icons, so the installed PWA renders its
// identity even on a cold offline start. Cached per-URL via `Promise.allSettled`
// (not `addAll`) so one 404 / redeploy race never fails the whole install. The
// load-bearing OFFLINE_URL is cached separately (hard `cache.add`) in `install`.
const SHELL_ICON_URLS = [
  '/favicon.svg',
  '/icon',
  '/apple-icon',
  '/icon-192.png',
  '/icon-512.png',
  '/icon-maskable-192.png',
  '/icon-maskable-512.png',
];

// ── Install / activate ──────────────────────────────────────────────────────

self.addEventListener('install', (event) => {
  // Activate the new SW immediately on install — no "waiting" phase. Pairs
  // with `clients.claim()` in `activate` so a freshly opened PWA gets the
  // new SW without an extra page reload.
  //
  // J8 — pre-cache the app shell (offline fallback + manifest icons).
  // `{ cache: 'reload' }` bypasses the HTTP cache so each entry is stored fresh.
  // The OFFLINE_URL is load-bearing (the fetch handler serves it on navigation
  // failure) so it is cached explicitly; the icons are best-effort via
  // `allSettled` (a single failed icon never blocks activation). Any fetch that
  // fails is caught below and still lets activation proceed — the fetch handler
  // degrades to a plain network passthrough on any individual cache miss.
  event.waitUntil(
    (async () => {
      try {
        const cache = await caches.open(CACHE_NAME);
        await cache.add(new Request(OFFLINE_URL, { cache: 'reload' }));
        await Promise.allSettled(
          SHELL_ICON_URLS.map((u) => cache.add(new Request(u, { cache: 'reload' }))),
        );
      } catch (_err) {
        /* shell not fully cached this time — non-fatal, see fetch handler */
      }
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener('activate', (event) => {
  // Drop stale offline caches from previous SW versions, then take control.
  event.waitUntil(
    (async () => {
      try {
        const keys = await caches.keys();
        await Promise.all(
          keys
            // Drop every Fxmily bucket that isn't part of the current VERSION —
            // this evicts the legacy `fxmily-offline-*` bucket AND any stale
            // shell/runtime bucket left by a previous version.
            .filter((key) => key.startsWith('fxmily-') && !CURRENT_CACHES.includes(key))
            .map((key) => caches.delete(key)),
        );
      } catch (_err) {
        /* cache enumeration failed — non-fatal, old buckets are harmless */
      }
      // Navigation preload: the browser issues the navigation request itself,
      // NATIVELY (same streaming/redirect semantics as no-SW), in parallel
      // with SW startup; the fetch handler then just hands that response
      // through. Without it, `fetch(request)` REPLAYS the navigation from
      // inside the SW — measurably different timing on streamed dev/HMR
      // responses (flaked twice on CI shard 2, 2026-07-06: page transiently
      // duplicated/hidden mid-hydration). Not supported everywhere → guarded.
      try {
        await self.registration.navigationPreload?.enable();
      } catch (_err) {
        /* preload unsupported — fetch handler falls back to fetch(request) */
      }
      await self.clients.claim();
    })(),
  );
});

// ── Fetch — offline navigation fallback ONLY ────────────────────────────────

/**
 * Two-strategy fetch handler (J8 SCOPE 3):
 *
 *   1. Immutable same-origin assets (`/_next/static/*` + `/icon*` + `/apple-icon`
 *      + `/favicon.svg`) → CACHE-FIRST
 *      from a versioned runtime bucket. These are content-hashed / VERSION-
 *      rotated, so a cached copy is always valid until VERSION bumps (which
 *      drops the whole runtime bucket). The shell paints instantly and survives
 *      offline.
 *   2. Top-level NAVIGATIONS → NETWORK-FIRST. On success we pass the live
 *      response straight through (no runtime caching of pages — content is
 *      dynamic and per-user; we never serve a stale/cross-account page). On a
 *      network failure (offline, DNS, timeout) we serve the pre-cached
 *      `/offline`.
 *
 * Everything else — non-GET, `/_next/image`, API calls, the push path — is
 * intentionally NOT intercepted: no `respondWith`, so the browser handles those
 * requests exactly as if this handler didn't exist.
 *
 * ⚠️ TEST THE CACHE-FIRST PATH IN A PRODUCTION BUILD, NOT `next dev`. In dev,
 * `/_next/static/*` is not content-hashed and Turbopack HMR streams module
 * updates over those paths — a cache-first SW would pin stale chunks and break
 * hot reload. Verify with `pnpm build && pnpm start`, then hard-refresh.
 */

// An asset is safe to cache-first only if it's same-origin AND under a path
// whose contents are immutable for the lifetime of this SW VERSION.
function isImmutableAsset(url) {
  if (url.origin !== self.location.origin) return false;
  return (
    url.pathname.startsWith('/_next/static/') ||
    url.pathname.startsWith('/icon') ||
    url.pathname.startsWith('/apple-icon') ||
    url.pathname === '/favicon.svg'
  );
}

// Cache-first: serve from ANY bucket (shell pre-cache or runtime), else fetch
// and populate the runtime bucket. Only clean 200 same-origin responses are
// stored (never a redirect/opaque/error). A network failure with no cached copy
// rejects naturally — there is no asset to invent.
async function cacheFirstAsset(request) {
  const cached = await caches.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (response && response.status === 200 && response.type === 'basic') {
    const cache = await caches.open(RUNTIME_CACHE);
    await cache.put(request, response.clone());
  }
  return response;
}

self.addEventListener('fetch', (event) => {
  const { request } = event;

  // 1) Immutable same-origin assets (GET only) → cache-first runtime cache.
  if (request.method === 'GET' && isImmutableAsset(new URL(request.url))) {
    event.respondWith(cacheFirstAsset(request));
    return;
  }

  // 2) Only handle real page navigations. `mode: 'navigate'` covers link clicks,
  // address-bar loads, and reloads; it excludes fetch()/XHR/asset subrequests.
  if (request.mode !== 'navigate') return;

  event.respondWith(
    (async () => {
      try {
        // Network-first: always try the live page (auth, fresh data) first.
        // Prefer the navigation-preload response — the BROWSER's own native
        // request, streamed exactly as if no SW existed. `fetch(request)` is
        // only the fallback for engines without preload support.
        const preloaded = await event.preloadResponse;
        if (preloaded) return preloaded;
        return await fetch(request);
      } catch (_err) {
        // Offline / unreachable — fall back to the cached offline page. If it
        // isn't cached (pre-cache failed at install), re-throw so the browser
        // shows its native offline error rather than a broken empty response.
        const cached = await caches.match(OFFLINE_URL);
        if (cached) return cached;
        throw _err;
      }
    })(),
  );
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
      appBadge:
        typeof json.notification.app_badge === 'number' ? json.notification.app_badge : null,
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
    // V1.11 — C10 silent drop fix (Round 4 sub-agent O finding).
    //
    // iOS Safari 18.4+ Declarative Web Push REQUIRES `showNotification()`
    // to be called for every `push` event. After ~3 missed calls in a
    // row, iOS revokes the subscription silently — the member loses
    // notifications without any signal (no audit row, no SDK error, no
    // UI hint). The previous `return` early triggered exactly that
    // failure mode.
    //
    // We render a silent generic fallback so iOS bookkeeping sees a
    // `showNotification` call, even when the payload arrives malformed.
    // `silent: true` keeps the member's device quiet (no sound, no
    // vibration) — the fallback is a contract-keeper with iOS, not a
    // user-facing notif. `tag: 'fxmily-fallback'` coalesces consecutive
    // misfires into a single OS slot.
    //
    // Trade-off vs the original "drop silently to protect trust" :
    // losing the subscription silently is the worse outcome. Document
    // for telemetry in V1.11.1 (POST `/api/account/push/sw-error` to
    // surface dispatcher payload bugs in admin observability).
    event.waitUntil(
      self.registration.showNotification('Fxmily', {
        body: 'Notification reçue (contenu indisponible)',
        tag: 'fxmily-fallback',
        silent: true,
        icon: '/favicon.svg',
        badge: '/favicon.svg',
        requireInteraction: false,
      }),
    );
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
