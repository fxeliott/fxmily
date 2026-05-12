# Jalon 9 — Notifications push (Web Push VAPID + Service Worker + iOS PWA)

> Préparation rédigée 2026-05-08 (post-J8 Phase B+ livré, PR #30 ouverte). À démarrer dans une nouvelle session avec `/clear` (SPEC §18.4 non-négociable).

## 1. Critère SPEC §15 J9 "Done quand" (verbatim)

> "Un membre active ses notifs, reçoit les pushes prévus, peut les désactiver par catégorie."

Concrètement, à la fin de J9, le smoke test live `scripts/smoke-test-j9.ts` doit prouver :

1. VAPID keys générées + stockées en `apps/web/.env` (Eliot manual edit).
2. Membre installe Fxmily Home Screen (iOS/Android) → page `/account/notifications` détecte standalone.
3. Membre tap "Activer notifications" → permission browser prompt → POST `/api/account/push/subscribe` → row `PushSubscription` créée.
4. Annotation admin créée → enqueue `NotificationQueue` row → cron `*/2 * * * *` UTC déclenche dispatcher → `web-push` envoie payload chiffré → membre reçoit notification lock screen.
5. Membre tap notification → ouvre `/journal/[id]` → `seenByMemberAt` mis à jour.
6. Membre va `/account/notifications` → toggle off "Annotations" → 2e annotation NE déclenche PAS de push (preference filter actif).

## 2. BLOCKER critique 2026 — Apple Declarative Web Push (Safari 18.4+)

**Source vérifiée** : [WebKit Blog — Meet Declarative Web Push](https://webkit.org/blog/16535/meet-declarative-web-push/) + [Safari 18.4 features](https://webkit.org/blog/16574/webkit-features-in-safari-18-4/) (mai 2025).

Safari 18.4 (iOS/iPadOS 18.4) + Safari 18.5 (macOS 15.5) introduisent **Declarative Web Push** — payload JSON `web_push` rendu DIRECTEMENT par le navigateur, sans Service Worker JS execution. Backwards-compatible : un browser qui ne supporte pas tombe sur le path SW classique.

**Impact J9 Fxmily** :

- Le `dispatcher.ts` doit produire un payload **dual** :
  - Path SW classique (`web_push.notification` event handler) pour browsers anciens.
  - Path déclaratif (`{ "web_push": { "notification": { "title": "...", "body": "...", "navigate": "..." } } }`) pour Safari 18.4+.
- **Pourquoi critique** : Apple ITP supprime les Service Workers si le site n'est pas visité depuis 7-30 jours (variable). Sans path déclaratif, les notifs casseraient silencieusement. Le path déclaratif fonctionne MÊME SANS SW.

Format payload Fxmily proposé :

```json
{
  "web_push": {
    "notification": {
      "title": "Nouvelle correction sur EURUSD",
      "body": "Eliot a annoté ton trade — ouvre pour voir.",
      "navigate": "https://app.fxmily.com/journal/clx0trade1",
      "silent": false,
      "app_badge": 1
    }
  },
  "type": "annotation_received",
  "id": "noti_abc123"
}
```

Le `type` + `id` extras permettent au SW classique de matcher l'event sur la bonne logique côté JS si présent.

## 3. iOS PWA Web Push fragility 2026 (cross-source synthèse)

| Aspect                          | État vérifié 2026                                 | Source                                                                                                                                      |
| ------------------------------- | ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| Min iOS version                 | iOS 16.4+ (mars 2023)                             | [Apple developer docs](https://developer.apple.com/documentation/usernotifications/sending-web-push-notifications-in-web-apps-and-browsers) |
| Declarative push                | Safari 18.4+ (iOS 18.4 / macOS 15.5)              | WebKit Blog 16535                                                                                                                           |
| Default standalone              | iOS 26 (rentrée 2025)                             | [magicbell PWA limits 2026](https://www.magicbell.com/blog/pwa-ios-limitations-safari-support-complete-guide)                               |
| Cross-browser iOS               | Safari + Chrome iOS + Edge iOS depuis iOS 16.4+   | magicbell 2026                                                                                                                              |
| `pushsubscriptionchange` Chrome | "effectively assumed never fires"                 | [MDN](https://developer.mozilla.org/en-US/docs/Web/API/ServiceWorkerGlobalScope/pushsubscriptionchange_event)                               |
| Silent push iOS                 | **NON supporté**                                  | magicbell 2026                                                                                                                              |
| Background wake iOS             | **NON supporté**                                  | idem                                                                                                                                        |
| Permission denied recovery iOS  | **désinstaller + réinstaller PWA** (pas d'API JS) | magicbell 2026                                                                                                                              |

**Implications UX `/account/notifications`** :

- **Détection contextuelle** : `window.matchMedia('(display-mode: standalone)').matches` — si false → afficher onboarding "Ajoute Fxmily à ton écran d'accueil" (capture vidéo Safari Share menu).
- **Permission flow** : NE PAS auto-prompt. Bouton "Activer notifications" trigger `Notification.requestPermission()` sur user gesture explicit.
- **Fail mode** : si `permission === 'denied'` → afficher message FR "Pour réactiver les notifications iOS, désinstalle Fxmily de ton écran d'accueil puis réinstalle." (apple-specific, contournement impossible côté JS).
- **Detection Notification API absente** (browser old / non-PWA) → onboard différent.

## 4. Fallback email mandatory (SPEC §18.2)

SPEC line 847 stipule : "iOS push notifications bug PWA : tests réels dès le J9, fallback email si échec persistant."

**Stratégie Fxmily** : si une `NotificationQueue` row passe à `failed` après max 3 attempts (exponential backoff), basculer vers Resend email avec template carbone J4 (`AnnotationReceivedEmail` + variantes par `NotificationType`).

Audit row `notification.fallback.emailed` à ajouter pour traçabilité.

## 5. Stack & lib choisies

### `web-push` Node lib (npmjs)

**État 2026** : version 3.6.7, dernière publication "2 years ago". Mature mais à valider via context7 avant install. RFC 8030/8292 stables — la lib n'a probablement pas besoin de nouvelle release.

```bash
pnpm --filter @fxmily/web add web-push
pnpm --filter @fxmily/web add -D @types/web-push
```

**Signatures vérifiées** ([npm](https://www.npmjs.com/package/web-push) + [GitHub web-push-libs](https://github.com/web-push-libs/web-push)) :

```ts
import webpush from 'web-push';

// Génération initiale (1×, hors session Claude)
const keys = webpush.generateVAPIDKeys();
// { publicKey: 'BNc...', privateKey: 'tA9...' } base64url

// Bootstrap au boot (lib/push/web-push-client.ts)
webpush.setVapidDetails(
  env.VAPID_SUBJECT, // mailto:eliot@fxmilyapp.com
  env.VAPID_PUBLIC_KEY,
  env.VAPID_PRIVATE_KEY,
);

// Send
await webpush.sendNotification(
  pushSubscription, // { endpoint, keys: { p256dh, auth } }
  JSON.stringify(payload),
  {
    TTL: 3600, // seconds — 1h pour reminder, 24h pour annotation
    urgency: 'normal', // 'very-low' | 'low' | 'normal' | 'high' (jamais 'high' Fxmily)
    topic: `checkin-${dateStr}`, // ≤32 chars URL-safe (coalescing)
    contentEncoding: 'aes128gcm', // RFC 8291 moderne (par défaut depuis 3.x)
    timeout: 5000,
  },
);
```

### Service Worker manifest Next.js 16

**Décision Fxmily** : **manual setup** (option 1 du research).

**Raison** : Serwist (successeur next-pwa) requires Webpack ; Next.js 16 default = Turbopack. Splitter dev/build pour Serwist n'a de sens que si on veut le offline cache complet. Pour V1 J9 on n'a besoin que du SW pour Push API + click-through navigation. Offline caching → J9.5+ avec Serwist optionnel.

Fichiers à créer :

- `apps/web/src/app/manifest.ts` (Next.js 16 native, `MetadataRoute.Manifest`)
- `apps/web/public/sw.js` (manual JS, served as `/sw.js`)
- `apps/web/public/icons/icon-192.png` + `icon-512.png` (à générer avec logo Fxmily)

### Encryption + payload limits

- **Payload max** ≤ 4 KB après chiffrement (limite Apple stricter que GCM/Mozilla). Pour Fxmily : payload minimal `{ type, id, title, body, url, app_badge }` ; détails fetch côté SW au click handler.
- **TTL recommandation par catégorie** :
  - `annotation_received` → 86400 (24h)
  - `checkin_morning_reminder` → 3600 (1h, passé 9:00 = noise)
  - `checkin_evening_reminder` → 3600
  - `douglas_card_delivered` → 21600 (6h, fiche tilt après 3 pertes perd pertinence)
  - `weekly_report_ready` (J8 future hook) → 21600
- **Urgency RFC 8030** :
  - `annotation_received` → `normal`
  - `checkin_*_reminder` → `low` (pas critique, économise batterie iOS)
  - `douglas_card_delivered` → `normal`
  - **JAMAIS `high`** Fxmily — réservé incoming-call/2FA. Anti-FOMO posture Mark Douglas.
- **Topic header** (coalescing) :
  - `topic: 'checkin-${date}'` → evening reminder replace morning si pas vu
  - `topic: 'douglas-${cardSlug}'` → 2 dispatch même fiche même jour coalesce

## 6. UX trading 2026 anti-spam (alignement Mark Douglas)

**Sources** : [OneSignal 2026](https://onesignal.com/blog/onesignal-guide-push-notification-best-practices-2026/), [Appbot 2026](https://appbot.co/blog/app-push-notifications-2026-best-practices/), [Reteno 2026](https://reteno.com/blog/push-notification-best-practices-ultimate-guide-for-2026).

**Principes critiques Fxmily** :

1. **Granular preference center** : `/account/notifications` expose 1 toggle par catégorie. Stocker dans table `NotificationPreference(userId, type, enabled DEFAULT true)` PK composite `(userId, type)`. Audit par toggle (`push.preference.toggled`).
2. **Anti-FOMO strict** :
   - **JAMAIS push "opportunité de trade"** — interdit posture Fxmily.
   - **JAMAIS copy anxiogène** : "Tu rates ce setup !" → INTERDIT.
   - Tone consistant Mark Douglas : "1 correction reçue sur ton trade EURUSD" (factuel), pas "Erreur détectée !" (anxiogène).
3. **Send-time fixe V1** (cron windows) : 7:30/20:30 local checkin reminders, 6h cadence Douglas. Optimization send-time = J9.5+.
4. **Chrome anti-spam policy 2026** : auto-revoke si engagement low. Ratio `notification.dispatched`/`notification.clicked` à audit, signal de spam si <5%.

## 7. Architecture J9 — Phases

### Phase A — Foundation DB + Zod + Env

**Migration `j9_push_subscription`** :

```prisma
model PushSubscription {
  id           String   @id @default(cuid())
  userId       String   @map("user_id")
  user         User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  endpoint     String   @db.Text
  p256dhKey    String   @map("p256dh_key")
  authKey      String   @map("auth_key")
  userAgent    String?  @map("user_agent") @db.Text
  lastSeenAt   DateTime @default(now()) @map("last_seen_at")
  createdAt    DateTime @default(now()) @map("created_at")

  @@unique([userId, endpoint])
  @@index([userId])
  @@index([lastSeenAt])
  @@map("push_subscriptions")
}

model NotificationPreference {
  userId    String   @map("user_id")
  user      User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  type      NotificationType
  enabled   Boolean  @default(true)
  updatedAt DateTime @updatedAt @map("updated_at")

  @@id([userId, type])
  @@map("notification_preferences")
}
```

**Migration `j9_notification_dispatch`** (extend `NotificationQueue`) :

```sql
ALTER TABLE notification_queue
  ADD COLUMN attempts INT NOT NULL DEFAULT 0,
  ADD COLUMN last_error_code TEXT,
  ADD COLUMN next_attempt_at TIMESTAMPTZ,
  ADD COLUMN dispatched_at TIMESTAMPTZ;
CREATE INDEX notification_queue_pending_dispatch_idx
  ON notification_queue (status, next_attempt_at)
  WHERE status IN ('pending', 'dispatching');
```

**Env Zod** (`apps/web/src/lib/env.ts`) :

```ts
VAPID_PUBLIC_KEY: z.string().min(70).max(120).optional(),
VAPID_PRIVATE_KEY: z.string().min(40).max(80).optional(),
VAPID_SUBJECT: z.string().refine((v) => v.startsWith('mailto:') || v.startsWith('https://')).optional(),
```

**AuditAction étendu** (`lib/auth/audit.ts`) :

```
| 'push.subscription.created'
| 'push.subscription.updated'
| 'push.subscription.deleted'
| 'push.permission.granted'
| 'push.permission.denied'
| 'push.preference.toggled'
| 'notification.dispatched'
| 'notification.dispatch.failed'
| 'notification.dispatch.skipped'
| 'notification.fallback.emailed'
| 'cron.dispatch_notifications.scan'
```

**Schemas Zod** (`lib/schemas/push-subscription.ts`) — input from browser :

```ts
export const pushSubscriptionInputSchema = z.object({
  endpoint: z.string().url().max(2048),
  keys: z.object({
    p256dh: z.string().regex(/^[A-Za-z0-9_-]{80,100}$/, 'p256dh base64url'),
    auth: z.string().regex(/^[A-Za-z0-9_-]{20,30}$/, 'auth base64url'),
  }),
});
```

**Tests TDD foundation** : ~25 Vitest sur les schemas + types.

### Phase B — Service Worker + manifest + client subscribe flow

**Files créés** :

- `apps/web/src/app/manifest.ts` — `MetadataRoute.Manifest` avec `display: 'standalone'`, icons 192/512, `theme_color` lime DS-v2, `background_color` deep space.
- `apps/web/public/sw.js` — handlers `push`, `notificationclick`, `pushsubscriptionchange` (auto-resubscribe Firefox-style).
- `apps/web/src/app/account/notifications/page.tsx` — Server Component avec `searchParams.feature` detection.
- `apps/web/src/components/account/push-toggle.tsx` — Client component, subscribe/unsubscribe + permission UI.
- `apps/web/src/components/account/preferences-grid.tsx` — Client, 5 toggles par `NotificationType`.
- `apps/web/src/app/account/notifications/actions.ts` — Server Action `subscribePushAction(input)` + `togglePreferenceAction(type, enabled)` + `unsubscribePushAction(endpoint)`.

**Sw.js minimal** :

```js
self.addEventListener('push', (event) => {
  if (!event.data) return;
  const data = event.data.json();
  const notif = data.web_push?.notification ?? data.notification ?? data;
  event.waitUntil(
    self.registration.showNotification(notif.title, {
      body: notif.body,
      icon: '/icons/icon-192.png',
      badge: '/icons/badge-96.png',
      data: { url: notif.navigate ?? data.url ?? '/dashboard', id: data.id },
      tag: data.type, // coalescing par catégorie
    }),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = event.notification.data?.url ?? '/dashboard';
  event.waitUntil(
    clients.matchAll({ type: 'window' }).then((clientList) => {
      for (const client of clientList) {
        if (client.url === url && 'focus' in client) return client.focus();
      }
      if (clients.openWindow) return clients.openWindow(url);
    }),
  );
});

self.addEventListener('pushsubscriptionchange', (event) => {
  // Auto-resubscribe pattern Firefox-spec
  event.waitUntil(
    self.registration.pushManager
      .subscribe({
        userVisibleOnly: true,
        applicationServerKey: event.oldSubscription?.options.applicationServerKey,
      })
      .then((sub) =>
        fetch('/api/account/push/subscribe', {
          method: 'POST',
          body: JSON.stringify(sub.toJSON()),
          headers: { 'Content-Type': 'application/json' },
        }),
      ),
  );
});
```

### Phase C — Dispatcher worker + cron

**Pattern fire-and-cron** (cohérent avec J5/J6/J7/J8) plutôt que long-running Node worker.

- `lib/push/web-push-client.ts` — wrapper sur `web-push` lib avec injection VAPID + factory pattern (mock `MockPushClient` pour tests).
- `lib/push/dispatcher.ts` — pure-functions `buildPayload(notification)` + `classifyError(statusCode)` + `nextAttemptDelay(attempts)` + side-effect `dispatchOne(row)`.
- `lib/push/preferences.ts` — `getEffectivePreferences(userId)` (default true si row absente).
- `app/api/cron/dispatch-notifications/route.ts` — pattern carbone J8 weekly-reports.

**Atomic claim pattern (race-safe entre cron runs)** :

```ts
const claimed = await db.notificationQueue.updateMany({
  where: { id, status: 'pending' },
  data: { status: 'dispatching', attempts: { increment: 1 } },
});
if (claimed.count === 0) return; // someone else got it
// ... web-push send ...
await db.notificationQueue.update({
  where: { id },
  data:
    status === 'success'
      ? { status: 'sent', dispatchedAt: new Date() }
      : { status: 'pending', nextAttemptAt: backoffDate, lastErrorCode: code },
});
```

**Wiring prod attendu** :

```
*/2 * * * *  curl -fsS -X POST -H "X-Cron-Secret: $CRON_SECRET" \
             https://app.fxmily.com/api/cron/dispatch-notifications
```

### Phase D — Tests + smoke live

- 30+ Vitest TDD sur dispatcher (payload builder, retry logic, error classification, preference filter, idempotency claim).
- Playwright `serviceWorkers: 'allow'` + auth gates `/account/notifications` (401 + redirect login) + cron route (carbone J5/J6/J7/J8).
- `scripts/smoke-test-j9.ts` carbone J7/J8 :
  - VAPID generate (in script, écrit `.env.smoke` ?) ou pré-set fixture.
  - Seed user + subscribe via real browser headless (Playwright launches Chromium).
  - Enqueue annotation `notification.enqueued`.
  - Fetch cron `/api/cron/dispatch-notifications` avec `X-Cron-Secret`.
  - Assert audit trail (`notification.dispatched` row + queue.status='sent').
  - Manual iOS test sur iPhone Eliot (mandatory).

### Phase E — Audit-driven hardening (canon J5/J7/J8)

4-5 subagents parallèles : code-reviewer + security-auditor + accessibility-reviewer + ui-designer + fxmily-content-checker.

**Cibles security-auditor critiques J9** :

- VAPID JWT signing : `aud` claim correct (= origin du `endpoint`), `exp` ≤ 24h.
- Payload encryption AES-128-GCM par lib (pas custom).
- `auth` secret par subscription (rotation = re-subscribe).
- Endpoint enumeration risk : ne JAMAIS exposer `GET /api/account/push/subscriptions`.
- Logging payload en clair INTERDIT (PII potentielle).

## 8. Privacy + RGPD (SPEC §16)

**Push subscription endpoint = quasi PII** (identifie navigateur/appareil unique).

**Best practices J9** :

1. **Consent explicite** : permission browser prompt = consent légal, mais audit row `push.subscription.consented` avec timestamp + UA.
2. **Cascade User delete** : `PushSubscription.userId` → cascade User (déjà fait dans schema proposé).
3. **Logging payload en clair = INTERDIT** : audit metadata = `{ notificationId, type, attempts }` mais JAMAIS `payload.content`.
4. **Subscription révoquée 410 Gone** → DELETE immédiat la row (pas soft-delete).
5. **Cleanup périodique** : cron `0 5 * * 0` UTC → DELETE subscriptions inactives (`lastSeenAt < now - 90j`).
6. **Endpoint enumeration risk** : `/account/notifications` retourne uniquement `{ count, lastSeenAt }`, pas les endpoints en clair.
7. **DPA** : FCM/APNs sont push services natifs des navigateurs — pas un sub-processor au sens GDPR Art. 28. Pas de DPA Fxmily à signer. À noter dans `docs/privacy-policy.md` (J10).

## 9. Pré-requis Eliot avant smoke test J9

| Item                                  | Action                                                                                                                                 | Quand                          |
| ------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------ |
| **VAPID keys générées**               | `npx web-push generate-vapid-keys` (1×)                                                                                                | Avant Phase B                  |
| **VAPID dans `apps/web/.env`**        | `VAPID_PUBLIC_KEY=...`, `VAPID_PRIVATE_KEY=...`, `VAPID_SUBJECT=mailto:eliot@fxmilyapp.com` (Eliot manual edit hors Claude, deny rule) | Avant Phase B                  |
| **Logo Fxmily 192×192 + 512×512 PNG** | Si pas déjà créé Sprint #1 design                                                                                                      | Avant Phase B (manifest icons) |
| **iPhone test physique**              | Pour valider iOS push real device (mandatory critère SPEC §15)                                                                         | Avant Phase E close            |
| **HTTPS prod ou tunnel ngrok dev**    | iOS Web Push exige HTTPS strict, localhost OK pour Chrome desktop seulement                                                            | Avant manual iOS test          |

## 10. Vérifications via context7 en début de session J9

| Item                                            | Outil                                                                                                                                 | Pourquoi                                                                                                                      |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `web-push@3.6.7` API stable + non-deprecated    | MCP `context7` (`web-push`)                                                                                                           | WebSearch pas confirmé release récente — context7 valide signature `sendNotification(sub, payload, opts)` + `setVapidDetails` |
| Next.js 16 `manifest.ts` exact return type      | MCP `context7` (`next.js`)                                                                                                            | Confirmer `MetadataRoute.Manifest` signature                                                                                  |
| Playwright 1.59.1 `serviceWorkers: 'allow'`     | MCP `context7` (`playwright`)                                                                                                         | WebSearch dit "default 'allow' en 2026" mais à confirmer                                                                      |
| Apple `web.push.apple.com` audience claim VAPID | [Apple dev docs](https://developer.apple.com/documentation/usernotifications/sending-web-push-notifications-in-web-apps-and-browsers) | Format exact `aud` claim — probablement `https://web.push.apple.com`                                                          |

## 11. Pickup prompt J9 (à coller dans nouvelle session après `/clear`)

```
Implémente le Jalon 9 du SPEC à `D:\Fxmily\SPEC.md` — Notifications push complètes
(VAPID + Service Worker + /account/notifications + worker dispatcher).

Lis dans cet ordre :
1. SPEC §15 J9 critères + §7.9 enqueue model + §16 RGPD
2. apps/web/CLAUDE.md sections J5 (NotificationQueue + cron pattern) +
   J7 (cron pattern carbone) + J8 (close-out post-PR #30)
3. docs/jalon-9-prep.md — briefing complet 11 sections (Apple Declarative
   Web Push BLOCKER, web-push lib, manifest manuel, dispatcher cron, tests)
4. memory MEMORY.md + fxmily_project.md (état J8 + frustrations Eliot)

Done quand SPEC §15 J9 : un membre active ses notifs, reçoit les pushes
prévus (annotation, checkin reminder, fiche Douglas, weekly report J8 ready
hook), peut les désactiver par catégorie.

Stack vérifiée 2026-05-08 :
- web-push@3.6.7 Node lib (RFC 8030/8292 stable, à valider via context7)
- Next.js 16 native manifest.ts (MetadataRoute.Manifest)
- Service Worker manual setup (Serwist incompatible Turbopack default)
- Apple Declarative Web Push (Safari 18.4+) BLOCKER → payload dual SW + déclaratif
- iOS PWA Home Screen mandatory + permission user-gesture only
- Fallback email Resend si push failed × 3 attempts (SPEC §18.2)

Phase A : DB migrations (PushSubscription + NotificationPreference + extend
  NotificationQueue) + Zod schemas + env VAPID + AuditAction +11 actions +
  ~25 tests TDD.
Phase B : SW manuel + manifest + /account/notifications page + push-toggle +
  preferences-grid + Server Actions subscribe/unsubscribe/togglePreference.
Phase C : lib/push/{web-push-client,dispatcher,preferences}.ts +
  /api/cron/dispatch-notifications (pattern carbone J5/J6/J7/J8) + atomic
  claim pattern race-safe.
Phase D : 30+ Vitest TDD + Playwright auth gates + smoke-test-j9.ts carbone.
Phase E : Audit-driven hardening 4-5 subagents (security-auditor critique
  sur VAPID JWT + ITP wipe + payload encryption + endpoint enumeration).
Phase F : Update apps/web/CLAUDE.md + memory + briefing J10.

Pattern hybride atomic : back + front + tests + commits + push branche
`claude/j9-web-push-notifications` dans cette session.

Mantra long activé : pleine puissance, autonomie totale, perfection absolue,
control PC OK, anti-hallucination, smoke test live obligatoire, fxmily
content checker pour copy push posture Mark Douglas.

Pré-requis Eliot AVANT smoke live :
1. `npx web-push generate-vapid-keys` 1× → coller dans apps/web/.env
   (VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT) hors Claude (deny rule)
2. Logo Fxmily 192px + 512px PNG dans apps/web/public/icons/ (si pas
   déjà fourni Sprint #1)
3. iPhone test physique pour valider iOS push real-device (critère SPEC §15)
```

## 12. Non-scope J9 (à reporter J9.5+ ou J10)

- Send-time optimization ML par membre.
- Offline cache complet PWA (Serwist setup).
- iOS push notification badging API avancée (badge count cumulatif).
- Push grouping cross-categorie (1 notif "X corrections + Y reminders").
- Quiet hours par membre (déjà 1 toggle par catégorie suffit V1).
- Test E2E iOS Safari Playwright (limité par WebKit project — manual test sur device suffit V1).

## 13. Sources canoniques (à re-vérifier en début de session J9)

- [RFC 8030 — Generic Event Delivery Using HTTP Push](https://www.rfc-editor.org/rfc/rfc8030)
- [RFC 8292 — VAPID](https://datatracker.ietf.org/doc/html/rfc8292)
- [WebKit — Meet Declarative Web Push](https://webkit.org/blog/16535/meet-declarative-web-push/)
- [Apple Developer — Sending web push notifications](https://developer.apple.com/documentation/usernotifications/sending-web-push-notifications-in-web-apps-and-browsers)
- [Magicbell — PWA iOS Limitations 2026](https://www.magicbell.com/blog/pwa-ios-limitations-safari-support-complete-guide)
- [npm web-push](https://www.npmjs.com/package/web-push)
- [Next.js — Progressive Web Apps guide](https://nextjs.org/docs/app/guides/progressive-web-apps)
- [Playwright — Service Workers](https://playwright.dev/docs/service-workers)
- [OneSignal — Push Best Practices 2026](https://onesignal.com/blog/onesignal-guide-push-notification-best-practices-2026/)
- [iZooto — Push Notifications GDPR](https://izooto.com/blog/web-push-notifications-gdpr)

---

**Fin du briefing J9** — préparé 2026-05-08, à valider context7 + WebSearch fresh en début de session J9 (l'écosystème Web Push évolue vite, especially Safari/iOS).

---

## CLOSE-OUT (2026-05-08, fin de session J9)

J9 livré end-to-end **dans la session du briefing même**, sur la branche `claude/j9-web-push-notifications` (PR #33). Pattern carbone J5/J6/J7/J8 + 5-subagent audit-driven hardening en 3 rounds successifs.

### 5 commits cumulés ([PR #33](https://github.com/fxeliott/fxmily/pull/33))

| Commit    | Phase                                                                   | Diff      |
| --------- | ----------------------------------------------------------------------- | --------- |
| `3d8a93c` | feat(j9): foundation + UI + dispatcher + cron + smoke ALL GREEN         | +3589/-42 |
| `6348ad7` | perf(j9): audit-driven hardening 6 BLOCKERs + 4 HIGH closed             | +249/-37  |
| `dd65b7d` | docs(j9): close-out CLAUDE.md scoped + briefing J10 update              | +101/-1   |
| `eacbb29` | perf(j9): round 2 hardening — endpoint allowlist + VAPID cross-var      | +108/-6   |
| `abdf43a` | perf(j9): round 3 hardening — email fallback + env tests + smoke step 8 | +559/-50  |

### Quality gate finale

- type-check exit 0 · lint exit 0 (max-warnings=0)
- **Vitest 631/631 verts** (+86 vs J8 baseline 545)
- Build prod Turbopack OK · Migration `20260508180000_j9_push_subscription` appliquée live (18 tables)
- Smoke live `scripts/smoke-test-j9.ts` 9/9 steps ALL GREEN (mock client path)
- **CI GitHub Actions 3/3 verts** sur les 3 rounds (Analyze + CodeQL + Lint/type/build)

### Score audit-driven hardening cumulé J9

- **6 BLOCKERs** closed in-session (round 1) — content + a11y + code/sec
- **4 HIGH** closed in-session (round 1)
- **2 TIER 2** ramenés round 2 (endpoint allowlist anti-SSRF + VAPID cross-var refine E2)
- **3 TIER 2** ramenés round 3 (email fallback SPEC §18.2 + env TDD 9 tests + smoke step 8 stuck recovery DB-side)
- **Apple Touch Icon** vérifié déjà câblé (J0/J1 layout.tsx:35)

**Total : 15 fixes audit-driven** in-session sans empiéter sur J9.5/J10.

### SPEC §15 J9 critère "Done quand" — ✅ validé

> "Un membre active ses notifs, reçoit les pushes prévus, peut les désactiver par catégorie."

End-to-end via mock client path :

- ✅ Activation : `<PushToggle>` 5 states + permission user-gesture + 5 categories de notif
- ✅ Pushes prévus : dispatcher atomic claim + retry budget 3 + Apple Declarative dual payload (`web_push: 8030`)
- ✅ Désactiver par catégorie : `<PreferencesGrid>` 5 toggles avec audit + `getEffectivePreferences` default-on
- ✅ **Bonus SPEC §18.2** : email fallback after 3 attempts wired (template + send helper + dispatcher integration)

### Reclassé J9.5+ (UI polish premium DS-v2)

- Aurora hero + halo Bell + h-rise H1 (focal premium, carbone J7 reader).
- AnimatePresence transitions 5 states `<PushToggle>` (slide-fade y:4).
- Skeleton shimmer loading state (`.skel h-20 w-full`).
- `<Btn kind={isSubscribed ? 'danger' : 'primary'}>` + `<Pill tone="mute">` empty state cohérence DS.
- `<TrendCard>`-style sparkline 7j notifications reçues.
- Apple Touch Icon 192/512/96 PNG dédiés (current = 1920×1080 `logo.png` accepté Apple, polish optionnel).
- Dispatcher 5-by-5 parallel batch (carbone weekly-reports) si scan > 5 min Caddy timeout.

### Reclassé J10 prod

- Hetzner crontab `*/2 * * * *` UTC `dispatch-notifications`.
- M5 RGPD : cron `0 5 * * 0` purge subscriptions `lastSeenAt < now - 90d`.
- M1 sécurité : endpoint URL allowlist déjà partiellement faite (round 2). Étendre Edge mobile si besoin.
- Sentry capture `lib/push/dispatcher.ts:dispatchOne` catch + cron route.
- Live VAPID test iPhone Safari 18.4+ real-device (HTTPS exigé iOS, ngrok ou prod app.fxmily.com).

### Activation Live VAPID

Zéro action requise — VAPID keys déjà dans `apps/web/.env` (J8 polish session). Factory `getWebPushClient()` switch automatique Mock → Live au prochain restart si les 3 vars VAPID + NEXT_PUBLIC mirror sont set (cf. `lib/env.ts` cross-var refine round 2).

### Pickup prompt J10 (à coller post-`/clear`)

```
Implémente le Jalon 10 du SPEC à `D:\Fxmily\SPEC.md` — Prod hardening complet
(RGPD pages legal + Sentry + Hetzner deploy + domaine + 1ère invitation prod).

Lis dans cet ordre :
1. SPEC §15 J10 critère + §16 RGPD + §17 décisions
2. apps/web/CLAUDE.md sections J0→J9 close-out (full historical context)
3. docs/jalon-10-prep.md — briefing complet 12 sections (mise à jour J9 livré)
4. docs/jalon-9-prep.md → CLOSE-OUT pour les items J9 reclassés J10
5. docs/runbook-cron-recompute-scores.md (carbone Hetzner cron pattern)
6. memory MEMORY.md + fxmily_project.md (état J9 final + frustrations Eliot)

Done quand SPEC §15 J10 : l'app est en prod sur app.fxmily.com, Eliot peut
s'inviter et tester end-to-end (J0→J9 happy-path validé real-device incluant
iPhone Web Push).

Stack J10 vérifiée 2026-05-08 :
- Hetzner Cloud CX22 (Falkenstein UE) Ubuntu 24.04 LTS
- Docker Compose + Caddy + Let's Encrypt + cron systemd (6 routes incl J9)
- Cloudflare Registrar fxmily.com + DNS + Resend domain verify
- @sentry/nextjs (client + server + edge) + source maps CI upload
- pg_dump quotidien + R2 cross-région (US east) cross-encrypted GPG

Phase A : RGPD pages legal + cookie banner + export JSON + soft-delete +
  cron purge 30j users + cron purge 90j subscriptions (J9 reclassé) +
  4 nouveaux AuditAction + safeFreeText sanitization 100% audit.
Phase B : Sentry integration (wizard + breadcrumbs lib/scoring + lib/cards
  + lib/weekly-report + lib/push + cron catches) + source maps CI upload.
Phase C : Docker production image + docker-compose.prod.yml + Caddyfile +
  /etc/fxmily/cron.env + wrapper /usr/local/bin/fxmily-cron + backup wrapper
  pg_dump + R2 GPG encryption + Hetzner crontab 6 routes.
Phase D : Cloudflare Registrar achat fxmily.com + DNS A/MX/SPF/DKIM/DMARC +
  Resend domain verify + update env worktree + prod (recipient widening).
Phase E : GitHub Actions deploy workflow + Hetzner SSH push + smoke prod.
Phase F : Eliot 1ère invitation end-to-end checklist 12 steps incluant
  J9 push iPhone real-device test (HTTPS via prod app.fxmily.com) +
  bug-fix any blocker found.
Phase G : Audit-driven hardening 5 subagents parallèles (canon J5/J7/J8/J9)
  + smoke prod live + final commit close-out.
Phase H : Update apps/web/CLAUDE.md J10 + memory + briefing J11 si V2 ouvre.

Pattern hybride atomic : back + ops + commits + push branche
`claude/j10-prod-deploy` dans cette session.

Mantra long activé : pleine puissance, autonomie totale, perfection absolue,
control PC OK, anti-hallucination, smoke prod live obligatoire.

Pré-requis Eliot AVANT smoke prod :
1. Hetzner CX22 provisioning + SSH key (cf. SPEC §6.3)
2. Cloudflare Registrar achat fxmily.com (~10€/an, vérifier dispo)
3. Resend domain verify (3 TXT records DNS Cloudflare → Resend Console,
   propagation 24h)
4. Sentry compte + DSN
5. iPhone physique pour J9 push real-device test
6. Mdp admin rotaté (déjà fait J8 polish)
```
