# Jalon V2-Capacitor-iOS — Préparation App Store soumission

> **Statut** : Brief de préparation (Session S 2026-05-23). Synthèse Round 2 Session S audit `/maximum-mode` 4 sub-agents parallèles (CAP-1 architecture compat + CAP-2 Capacitor docs 2026 + CAP-3 Apple Developer Program 2026 + ASC + CAP-4 push V1 → APN refactor scope).
>
> **Session T 2026-05-23 (post-merge décisions tranchées Voie V2-A)** : 4 pré-requis blockers résolus via clarifications Eliot + méta-délégation carte blanche + due diligence sub-agent `a2c7cdf21c0ecf53b` (Apple Developer 2026 + push notifications stack 2026, 10 URLs sources primaires) :
>
> 1. ✅ Mac hardware OK (Eliot confirmé Session T)
> 2. ✅ Bundle ID `com.fxmily.app` validé (Session T)
> 3. ✅ Track Apple Developer = **Individual** default (Session T décision tranchée, voir §5.2 — caveat migration `transfer app` documenté)
> 4. ✅ Push channel iOS = **Direct APN HTTP/2** via `@parse/node-apn` + plugin Capacitor `@capacitor/push-notifications` natif (Session T décision tranchée, voir §6.4 — reverse drift CAP-2 sur plugin Firebase Messaging)
>
> Pré-requis restants Session T+ : iPhone physique smoke test (Session BB TestFlight) + Demo account `apple-review@fxmilyapp.com` provisioned (Session Y).
>
> **Session T+ 2026-05-23 (multi-platform pivot scope expansion)** : Eliot clarification post-Session T = "n'importe quel client android comme ios est pas de soucis... recevoir les notification comme une vraie application même téléphone éteint" → **scope V2 étendu iOS + Android simultané** (PAS DEFERRED V2.1+ comme brief Session S initial). Méta-délégation totale Eliot + due diligence sub-agent `a7d7d73cdda5b79a4` (Google Play Console + FCM HTTP v1 + plugin Capacitor Firebase Messaging Android + Android Studio prerequisites 2026, 10 URLs sources primaires) :
>
> 5. ✅ Scope V2 étendu = iOS + Android simultané (PAS deferred V2.1+) — voir §1 Périmètre mis à jour
> 6. ✅ Push channel Android = **Direct FCM HTTP v1** via `firebase-admin` Node + plugin Capacitor `@capacitor-firebase/messaging` (Session T+ décision tranchée, voir §6.5 nouvelle section)
> 7. ✅ Backend abstraction = `IPushProvider` interface + 3 implémentations (`LiveApnClient` iOS + `LiveFcmClient` Android + `LiveWebPushClient` Web V1 existant) = **triple-channel dispatcher fan-out** parallèle `Promise.allSettled` (voir §4.4 + §4.6)
> 8. ✅ Coût Google Play Console = **$25 USD one-time** (vs Apple $99/an récurrent) — voir §5.5 nouvelle section
> 9. ✅ Android Studio + Capacitor 8 Android : Mac PAS obligatoire (Windows 10+/Mac 12+/Linux supportés). Capacitor min API 24 + Play Store target API 35+ obligatoire depuis 2025-08-31
>
> Pré-requis Eliot Session T++ : Google Play Console enrollment $25 one-time + Android iPhone smoke test (Session BB beta cycle parallèle TestFlight + Internal Testing Google Play).
>
> **Décision Eliot** : Capacitor iOS + Apple Developer Program **$99/an APPROUVÉ** (Session S clarification).
>
> **Posture rappelée** : Fxmily app PRIVÉE/INTERNE (accès réservé membres formation Eliot post-inscription contrat amont). PAS vitrine grand public. Posture Mark Douglas stricte (0 conseil trade, exécution + psychologie seul). Système Lhedge INCONNU. EU AI Act §50(1) compliance résolu Session R.

## 1. Objectif

Transformer Fxmily PWA Next.js 16 + React 19 (V1.12 P4 LIVE prod Hetzner) en **app native iOS + Android cross-platform** soumise et publiée sur Apple App Store + Google Play Store, accessible aux membres formation Fxmily depuis iPhone OU Android via icône Home Screen native + push notifications natives APN/FCM (background telephone verrouillé inclus).

**Périmètre V2.x** (Session T+ multi-platform pivot) :

- iOS **+ Android** simultané V2 (cross-platform, PAS Android DEFERRED comme brief Session S initial)
- 1 build production Fxmily V1.x feature set actuel (PAS de nouvelles features Fxmily dans ce jalon)
- App icon + splash + push APN (iOS) + push FCM (Android) + 10 plugins MVP P0+P1 cross-platform
- Distribution App Store Connect (Apple) + Google Play Console (Android) en parallèle
- Web/PWA Fxmily V1 LIVE Hetzner conservé (3ème surface user) : navigateur PC/Mac/Linux + Android Chrome (PWA "Add to Home Screen") + iPhone Safari 16.4+ (PWA installée Web Push limité, fallback dégradé)

**Hors-scope explicite** :

- Multi-admin (DEFERRED Eliot)
- Stripe billing in-app (DEFERRED Eliot — cohorte payée hors-app Stripe externe Eliot direct)
- Capacitor Camera plugin (V2.1+ si upload photos trades)
- Local notifications (V2.1+)
- iPad / Android tablet optimization (V2.1+ — V2 phone form factor only)
- ~~Android Capacitor (V2.1+)~~ **MOVED IN-SCOPE V2 Session T+ multi-platform pivot**

## 2. Architecture cible (ARBITRAGE hardcore CAP-1 vs CAP-2)

**Décision finale** : **WebView shell `server.url: 'https://app.fxmilyapp.com'`** (pattern hybride CAP-1) PAS `output:'export'` static (CAP-2 default assumption).

**Justification** :

- 51 pages Server Components + 18 Server Actions + 20 API routes + 63 `force-dynamic` côté `apps/web` = **>100 surfaces serveur** SSR Hetzner [tool-output CAP-1 audit].
- Capacitor offre option officielle `server.url` top-level config (verbatim CAP-2 §4 confirme `server` dans liste config) qui pointe WebView vers URL distante = SSR Hetzner direct, tout marche (Server Components + Server Actions + API routes + middleware).
- Anti-recommandation refus : refactor 100% client-side fetching `output:'export'` = gaspillage massif effort (>40 endpoints à convertir) pour gain nul vu que WebView consomme déjà Server Actions via protocole RSC POST natif.

```text
┌──────────────────────────────────────┐
│  iPhone — App Capacitor "Fxmily"     │
│  (apps/mobile/ NEW workspace)        │
│  ─ WKWebView shell (capacitor 8)     │
│  ─ server.url = app.fxmilyapp.com    │
│  ─ iosScheme = 'https'               │
│  ─ APN push tokens registered        │
│  ─ Plugins MVP 10 (P0+P1)            │
└──────────────────┬───────────────────┘
                   │ HTTPS WebView load + REST API + cookies
                   ▼
┌──────────────────────────────────────┐
│  Backend Hetzner inchangé            │
│  apps/web Next.js 16 App Router      │
│  Auth.js v5 JWT (sameSite=none fix)  │
│  Prisma 7 + PostgreSQL 17            │
│  Cron Hetzner + dispatcher APN+web   │
│  R2 médias + Resend + Sentry         │
└──────────────────────────────────────┘
```

**Workspace structure proposée** :

- `apps/web/` — inchangé (SSR Hetzner full features, PWA web + Android Chrome browser)
- `apps/mobile/` — NEW Capacitor 8 workspace (iOS shell, capacitor.config.ts, ios/ Xcode project)
- `apps/track-record/` — inchangé (Cloudflare Pages vitrine publique, ne touche pas Capacitor)
- `packages/` — vide actuel, pourrait héberger composants UI shared web↔mobile si futur Android Capacitor

## 3. Stack technique Capacitor 2026

### 3.1 Versions obligatoires (deadline Apple 28 avril 2026 PASSÉE)

[tool-output CAP-2 §1] :

- **Capacitor 8** (released 8 décembre 2025) — version active, v7 maintenance jusqu'au 8 juin 2026 (3 semaines marge), v6 EOL juillet 2025
- **iOS deployment target** : iOS 15.0 minimum (iPhone 6s+ 2015+, acceptable couverture)
- **Xcode 26.0+** (deadline Apple 28 avril 2026 dépassée → mandatoire pour soumission)
- **macOS** : typiquement macOS Sequoia 15+ pour Xcode 26
- **Node.js 22+** requis (Fxmily déjà Node 22 LTS ✓)
- **SPM par défaut Capacitor 8** (CocoaPods en maintenance depuis août 2024)

### 3.2 Plugins MVP cross-platform iOS + Android — sélection définitive 11 P0+P1 (Session T+ multi-platform pivot)

[tool-output CAP-2 §8 + sub-agent A7D7 Session T+] :

| #   | Plugin npm                                                                                                                 | Usage Fxmily                                                                   | Priorité | Plateforme    |
| --- | -------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ | -------- | ------------- |
| 1   | `@capacitor/push-notifications` (officiel Capacitor 2026, Session T reverse drift CAP-2)                                   | Push APN natif iOS — Direct APN HTTP/2 backend (Session T décision §6.4)       | P0       | iOS only      |
| 1b  | `@capacitor-firebase/messaging` (Capawesome community plugin Capacitor 8 supporté, release 2026-03-31, Session T+ Android) | Push FCM natif Android — Direct FCM HTTP v1 backend (Session T+ décision §6.5) | P0       | Android only  |
| 2   | `@capacitor/preferences`                                                                                                   | Replace `localStorage` storage natif sécurisé                                  | P0       | iOS + Android |
| 3   | `@capacitor/app`                                                                                                           | Lifecycle resume/pause/deep links                                              | P0       | iOS + Android |
| 4   | `@capacitor/status-bar`                                                                                                    | Style dark mode V1 Fxmily                                                      | P1       | iOS + Android |
| 5   | `@capacitor/splash-screen`                                                                                                 | Splash native lancement app                                                    | P1       | iOS + Android |
| 6   | `@capacitor/network`                                                                                                       | Online/offline UX (mode déconnecté)                                            | P1       | iOS + Android |
| 7   | `@capacitor/keyboard`                                                                                                      | Auto-scroll inputs (wizards REFLECT/TRACK)                                     | P1       | iOS + Android |
| 8   | `@capacitor/haptics`                                                                                                       | Feedback tactile REFLECT wizard validation                                     | P1       | iOS + Android |
| 9   | `@capacitor/browser`                                                                                                       | Liens externes (/legal/\* pages)                                               | P1       | iOS + Android |
| 10  | `@capacitor/share`                                                                                                         | Partage natif debrief (WhatsApp/Telegram)                                      | P1       | iOS + Android |

**Note Session T due diligence sub-agent `a2c7cdf21c0ecf53b` — reverse drift CAP-2** : Capacitor docs officielles 2026 listent toujours `@capacitor/push-notifications` comme guide officiel verbatim [capacitorjs.com/docs/guides/push-notifications-firebase] (PAS phasing out). `@capacitor-firebase/messaging` reste **alternative valide** pour Android (PAS pour iOS).

**Note Session T+ multi-platform pivot sub-agent `a7d7d73cdda5b79a4`** : scope V2 étendu Android simultané iOS. Architecture Option D = best-of-breed per-platform :

- **iOS** : plugin natif `@capacitor/push-notifications` + backend `@parse/node-apn` Direct APN HTTP/2 (Session T décision §6.4 conservée — 0 sub-processor Google côté iOS bundle)
- **Android** : plugin community `@capacitor-firebase/messaging` (Capawesome team, Capacitor 8 supporté, release 2026-03-31 active maintenance) + backend `firebase-admin` Node 22+ Direct FCM HTTP v1 (Session T+ décision §6.5 nouvelle section — Firebase obligatoire Android car FCM = seul transport push Android natif)
- **Web V1 LIVE** : `web-push` lib backend Hetzner V1 inchangé (3ème channel parallèle pour PC/Mac/Linux navigateur + Android Chrome PWA + iPhone Safari 16.4+ PWA installée — voir §4.6 dispatcher triple-channel)

Backend abstraction `IPushProvider` factory + 3 implémentations (`LiveApnClient` + `LiveFcmClient` + `LiveWebPushClient`) dispatcher fan-out `Promise.allSettled` parallèle. Refactor V2.1+ futur (ex: ajout WhatsApp/SMS) = ajouter 4ème driver sans toucher fan-out logic.

Plugins P2-P3 (`@capacitor/camera`, `@capacitor/local-notifications`, `@capacitor/filesystem`) DEFERRED V2.1+ post-PMF mobile.

### 3.3 `capacitor.config.ts` proposé

```typescript
import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.fxmily.app',
  appName: 'Fxmily',
  webDir: 'apps/web/out', // unused car server.url override
  loggingBehavior: 'production',
  backgroundColor: '#07090f', // DS-v2 deep-space V1
  server: {
    url: 'https://app.fxmilyapp.com',
    iosScheme: 'https',
    androidScheme: 'https',
    cleartext: false,
  },
  ios: {
    scheme: 'Fxmily',
    contentInset: 'always', // safe-area handling Notch/Dynamic Island
    backgroundColor: '#07090f',
    allowsLinkPreview: false,
    scrollEnabled: true,
  },
  android: {
    // Session T+ multi-platform pivot — Android block ajouté
    buildOptions: {
      keystorePath: 'release.keystore', // configured Session U V2-B via Android Studio
      keystoreAlias: 'fxmily-release',
    },
    backgroundColor: '#07090f',
    allowMixedContent: false,
    captureInput: true, // soft keyboard handling wizards REFLECT/TRACK
    webContentsDebuggingEnabled: false, // production
  },
  plugins: {
    PushNotifications: {
      // iOS plugin officiel Capacitor natif
      presentationOptions: ['badge', 'sound', 'alert', 'banner', 'list'],
    },
    FirebaseMessaging: {
      // Android Capawesome @capacitor-firebase/messaging — Session T+
      presentationOptions: ['badge', 'sound', 'alert'],
    },
    SplashScreen: {
      launchShowDuration: 1500,
      backgroundColor: '#07090f',
      showSpinner: false,
    },
    StatusBar: {
      style: 'DARK',
      backgroundColor: '#07090f',
    },
  },
};

export default config;
```

## 4. Refactor `apps/web` côté backend — 6 fichiers ≤5 LOC

[tool-output CAP-1 §10 + §11] — Effort réel **~2-4 jours** apps/web côté pour préparer compat WebView shell :

### 4.1 Cookies Auth.js v5 — SameSite override (CRITIQUE)

**Fichier** : `apps/web/src/auth.config.ts` (**106 LOC total**, ligne 103 = `trustHost: true`, ligne 104 = closing `} satisfies NextAuthConfig`). **Aucune config `cookies` actuelle dans `authConfig`** → c'est un **AJOUT** (pas override d'existing).

**Problème** : default Auth.js v5 = `SameSite=lax` implicit, casse WebView cross-origin si scheme `capacitor://`. Avec `iosScheme:'https'` + `server.url = app.fxmilyapp.com`, WebView origin = `https://app.fxmilyapp.com` (same as Hetzner) → cookies `lax` fonctionnent en théorie.

**Mitigation defense-in-depth** : AJOUTER bloc `cookies:` AVANT `} satisfies NextAuthConfig` (~10 LOC) pour blindage maximal `SameSite=none secure partitioned` :

```typescript
// auth.config.ts : ajout AVANT line 104 `} satisfies NextAuthConfig`
export const authConfig = {
  // ... existing (providers, callbacks, trustHost: true)
  cookies: {
    sessionToken: {
      options: {
        httpOnly: true,
        sameSite: 'none', // était 'lax' implicit default Auth.js v5
        secure: true,
        partitioned: true, // Chrome 121+ + Safari 18+ CHIPS standard
      },
    },
  },
} satisfies NextAuthConfig;
```

### 4.2 CSP `connect-src` étendu (optionnel)

**Fichier** : `apps/web/next.config.ts:16-37` CSP definition.

Si `iosScheme:'https'` (recommandé) → CSP actuel `default-src 'self'` + `connect-src 'self' https://*.sentry.io` INCHANGÉ.

Si scheme `capacitor://` finalement utilisé pour debug → ajouter `capacitor://localhost` à `default-src` et `connect-src` (~3 LOC).

### 4.3 Schema Prisma : ajout modèle `ApnDeviceToken` (pattern isolation §21.5)

**Fichier** : `apps/web/prisma/schema.prisma` + nouvelle migration `2026XXXXXXXXXX_v2_capacitor_apn_device_tokens`.

[tool-output CAP-4 §8] — **Décision architecturale** : modèle séparé `ApnDeviceToken` distinct (NOT colonne `platform` ajoutée à `PushSubscription`). Mirror pattern §21.5 isolation. Plus propre statistiquement à 30-100 membres :

```prisma
/// V2 — Capacitor iOS APN device tokens. Distinct table from PushSubscription
/// (web-push endpoints) to keep query patterns + audit + retention rules clean
/// per channel (mirror pattern §21.5 isolation).
model ApnDeviceToken {
  id          String   @id @default(cuid())
  userId      String   @map("user_id")
  user        User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  deviceToken String   @map("device_token") @db.Text  // 64 hex chars APN device token
  bundleId    String   @map("bundle_id")               // 'com.fxmily.app' (vs sandbox dev)
  environment String   @default("production")          // 'sandbox' | 'production'
  appVersion  String?  @map("app_version")             // Capacitor build version
  iosVersion  String?  @map("ios_version")
  lastSeenAt  DateTime @map("last_seen_at") @db.Timestamptz
  createdAt   DateTime @default(now()) @map("created_at") @db.Timestamptz
  updatedAt   DateTime @updatedAt @map("updated_at") @db.Timestamptz

  @@unique([userId, deviceToken])
  @@index([userId])
  @@index([lastSeenAt])
  @@map("apn_device_tokens")
}
```

Migration sera **ADD-only** (nouveau table, 0 modif existing) → rollback recipe simple `DROP TABLE apn_device_tokens` (carbone pattern runbook-hetzner-deploy.md §15 V2.1 admin_notes).

### 4.4 Services push : abstraction `IPushProvider` + 3 drivers (Session T+ multi-platform pivot)

**Architecture** : interface unifiée `IPushProvider` + 3 implémentations active simultanées (iOS APN + Android FCM + Web V1).

**Fichier 1** : `apps/web/src/lib/push/push-provider.ts` (~30 LOC NEW interface) :

```typescript
// Session T+ abstraction unified push channel backend
export type PushPlatform = 'web' | 'apn' | 'fcm';

export interface IPushProvider {
  platform: PushPlatform;
  send(target: string, payload: PushPayload): Promise<PushSendResult>;
}

export interface PushPayload {
  title: string;
  body: string;
  data?: Record<string, string>;
  badge?: number;
  sound?: string;
}

export interface PushSendResult {
  ok: boolean;
  errorCode?: 'BadDeviceToken' | 'Unregistered' | 'TooManyRequests' | 'InvalidToken' | 'Other';
  errorMessage?: string;
}
```

**Fichier 2** : `apps/web/src/lib/push/apn-push-client.ts` (~200 LOC iOS Session T décision) :

```typescript
class LiveApnClient implements IPushProvider {
  platform = 'apn' as const;
  // HTTP/2 direct APN endpoint via @parse/node-apn v8.1.0 (Session T sub-agent A2C7 confirmé active 2026)
  // JWT signing avec .p8 + Key ID + Team ID (auto-renew ~20-60min)
  // Endpoints : api.sandbox.push.apple.com (TestFlight) | api.push.apple.com (prod)
  // Payload format : {aps:{alert:{title,body},badge,sound}, custom_keys}
  // Error taxonomy : BadDeviceToken | Unregistered | TooManyRequests | other
  // 0 sub-processor Google (cohérent Privacy Manifest Apple)
}

class MockApnClient implements IPushProvider { platform = 'apn' as const; /* V1 default */ }

export function createApnClient(): IPushProvider {
  return env.APN_AUTH_KEY_P8 && env.APN_KEY_ID && env.APN_TEAM_ID
    ? new LiveApnClient(...)
    : new MockApnClient();
}
```

**Fichier 3** : `apps/web/src/lib/push/fcm-push-client.ts` (~200 LOC Android Session T+ décision) :

```typescript
import { initializeApp, cert } from 'firebase-admin/app';
import { getMessaging } from 'firebase-admin/messaging';

class LiveFcmClient implements IPushProvider {
  platform = 'fcm' as const;
  // Firebase Admin SDK Node 22+ via firebase-admin npm (Session T+ sub-agent A7D7 confirmé active 2026, FCM no-cost Spark + Blaze)
  // Direct FCM HTTP v1 API (PAS legacy FCM HTTP EOL juin 2024)
  // Service account JSON via env.FIREBASE_SERVICE_ACCOUNT_JSON (Firebase Console → Settings → Service accounts → Generate New Private Key)
  // Payload format FCM v1 : {message:{token, notification:{title,body}, android:{notification:{icon,sound,priority}}, data}}
  // Error taxonomy : registration-token-not-registered | invalid-argument | quota-exceeded | other
  // Sub-processor Google obligatoire Android (FCM = seul transport push Android natif) — déclaré Privacy Policy Fxmily + Google Play Data Safety form
}

class MockFcmClient implements IPushProvider { platform = 'fcm' as const; /* V1 default */ }

export function createFcmClient(): IPushProvider {
  return env.FIREBASE_SERVICE_ACCOUNT_JSON && env.FIREBASE_PROJECT_ID
    ? new LiveFcmClient(...)
    : new MockFcmClient();
}
```

**Fichier 4** : `apps/web/src/lib/push/web-push-client.ts` (existing V1 LIVE) — adapter pour implémenter `IPushProvider` interface :

```typescript
class LiveWebPushClient implements IPushProvider {
  platform = 'web' as const;
  // web-push lib V1 existante (PWA Service Worker + VAPID keys)
  // Inchangé V1 LIVE, juste adapter signature send() → IPushProvider
}
```

**Schema Prisma** : ajouter modèle `FcmDeviceToken` parallèle à `ApnDeviceToken` (§4.3) — mirror pattern §21.5 isolation Android :

```prisma
/// V2 Session T+ — Capacitor Android FCM device tokens. Distinct table from
/// ApnDeviceToken (iOS) + PushSubscription (web-push) for clean query patterns.
model FcmDeviceToken {
  id            String   @id @default(cuid())
  userId        String   @map("user_id")
  user          User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  fcmToken      String   @map("fcm_token") @db.Text  // FCM registration token (variable length)
  packageName   String   @map("package_name")         // 'com.fxmily.app' (Android package = iOS Bundle ID)
  appVersion    String?  @map("app_version")          // Capacitor build version
  androidVersion String? @map("android_version")
  lastSeenAt    DateTime @map("last_seen_at") @db.Timestamptz
  createdAt     DateTime @default(now()) @map("created_at") @db.Timestamptz
  updatedAt     DateTime @updatedAt @map("updated_at") @db.Timestamptz

  @@unique([userId, fcmToken])
  @@index([userId])
  @@index([lastSeenAt])
  @@map("fcm_device_tokens")
}
```

Migration sera **ADD-only** (nouveau table parallèle à `apn_device_tokens` Session T) → rollback recipe simple `DROP TABLE fcm_device_tokens`.

### 4.5 Service push : `lib/push/service.ts` (ajout `listDispatchableApnTokensForUser`)

**Fichier** : `apps/web/src/lib/push/service.ts` (~30 LOC ajout)

```typescript
export async function listDispatchableApnTokensForUser(
  userId: string,
): Promise<ApnDeviceTokenRaw[]> {
  return await db.apnDeviceToken.findMany({
    where: { userId },
    select: { id: true, deviceToken: true, bundleId: true, environment: true },
  });
}
```

### 4.6 Dispatcher triple-channel : `lib/push/dispatcher.ts` (modifs ~30 LOC — Session T+ multi-platform pivot)

**Fichier** : `apps/web/src/lib/push/dispatcher.ts:387-405` fan-out étendu **triple-channel** (Web + APN + FCM).

Pattern triple-channel coexistence (NOT migration full APN/FCM) :

- User installé app native iPhone + app native Android + navigateur PC = 3 endpoints (1 web + 1 apn + 1 fcm) = 3 notifications (1 par device, comportement attendu UX cross-platform)
- User PWA Android Chrome only = 1 endpoint web (pas d'app native installée encore)
- User PWA iPhone Safari only = 1 endpoint web (fallback dégradé iOS 16.4+, moins fiable que APN natif)
- Logic dispatcher : `Promise.allSettled([web fan-out, apn fan-out, fcm fan-out])` parallèle
- Audit `push.notification.sent` carry `platform: 'web' | 'apn' | 'fcm'` metadata

```typescript
// dispatcher.ts:387 (approximatif Session T+)
const [webResults, apnResults, fcmResults] = await Promise.allSettled([
  Promise.allSettled(webSubscriptions.map((sub) => webClient.send(sub.endpoint, webPayload))),
  Promise.allSettled(apnTokens.map((t) => apnClient.send(t.deviceToken, apnPayload))),
  Promise.allSettled(fcmTokens.map((t) => fcmClient.send(t.fcmToken, fcmPayload))),
]);
```

Payload mapping per-platform : `buildPayload` switch 3 branches :

- **Web** : `{web_push:8030, notification:{title,body,icon,badge}, data}` (VAPID + Service Worker)
- **APN** : `{aps:{alert:{title,body},badge,sound}, type, id}` (Apple format)
- **FCM v1** : `{message:{token, notification:{title,body}, android:{notification:{icon,sound,priority:'high'}}, data}}` (Google format)

### 4.7 Env vars APN + FCM (Session T+ multi-platform pivot)

**Fichier** : `apps/web/src/lib/env.ts:107-132` ajouts (~25 LOC iOS + ~15 LOC Android = ~40 LOC) :

```typescript
// iOS APN (Session T décision §6.4) :
APN_AUTH_KEY_P8: z.string().regex(/^[A-Za-z0-9+/=\s]+$/).optional()
  .describe('Base64-encoded .p8 APN auth key from Apple Developer'),
APN_KEY_ID: z.string().regex(/^[A-Z0-9]{10}$/).optional()
  .describe('10-char alphanumeric APN Key ID'),
APN_TEAM_ID: z.string().regex(/^[A-Z0-9]{10}$/).optional()
  .describe('10-char Apple Developer Team ID'),
APN_BUNDLE_ID: z.string().regex(/^[a-z]+\.[a-z]+\.[a-z]+$/).optional()
  .describe('Reverse-DNS bundle ID e.g. com.fxmily.app'),
APN_ENVIRONMENT: z.enum(['sandbox', 'production']).default('production'),

// Android FCM (Session T+ décision §6.5 — Firebase Admin SDK Node) :
FIREBASE_SERVICE_ACCOUNT_JSON: z.string().min(100).optional()
  .describe('Base64 OR raw JSON of Firebase service account key (Firebase Console → Settings → Service accounts → Generate New Private Key)'),
FIREBASE_PROJECT_ID: z.string().regex(/^[a-z0-9-]+$/).optional()
  .describe('Firebase project ID (matches firebase.google.com/project/{id} URL)'),
FCM_ENVIRONMENT: z.enum(['development', 'production']).default('production'),
```

Cross-var refine `env.ts:204-224` (carbone V1.9 hardening E2 pattern) :

- Tous les 4 (`P8`/`KEY_ID`/`TEAM_ID`/`BUNDLE_ID`) déployés ensemble OU absents
- Si `APN_ENVIRONMENT='production'` → tous required

### 4.8 Nouvelle route API : `/api/account/push/register-apn-token`

**Fichier** : `apps/web/src/app/api/account/push/register-apn-token/route.ts` (~80 LOC)

Mirror pattern `/api/account/push/resubscribe/route.ts` :

- POST gate session active (`auth()`)
- Zod schema `{ deviceToken: string regex /^[0-9a-fA-F]{64}$/, appVersion?, iosVersion? }`
- Upsert `ApnDeviceToken` unique `(userId, deviceToken)`
- `callerIdTrusted(req)` rate-limit + audit log `push.apn.registered` per-user

### 4.9 Fix bug latent `mindset_check_ready` (BONUS Quick win)

[tool-output CAP-4 §3] — Bug latent identifié :

- `lib/schemas/push-subscription.ts:108-117` `NOTIFICATION_TYPES` runtime = **7 slugs** (manque `mindset_check_ready`)
- `lib/push/preferences.ts:33-41` map defaults = **7 slugs** (manque `mindset_check_ready`)
- Mais enum schema `NotificationType` (`schema.prisma:115-124`) = **8 slugs** (incl. `mindset_check_ready` V1.5 §27 PR #137 LIVE)
- Code enqueue (`lib/notifications/enqueue.ts` + `lib/mindset/reminders.ts`) référence le slug → fallback comportement preferences default-true broken potentiel

**Fix** : ajouter `mindset_check_ready` aux 2 maps runtime (~4 LOC). Inclure dans jalon V2-C ou Voie sec/perf TIER 1 indépendant.

## 5. Apple Developer Program enrollment

[tool-output CAP-3] :

### 5.1 Coût + paiement

- **$99 USD / €99 EUR par an** (Individual ou Organization, tarif identique)
- Auto-renew annuel sur méthode de paiement Apple ID (Visa/MC/Amex)
- France : TVA incluse selon Apple France
- **Variante Enterprise $299/an NON applicable Fxmily** (distribution interne employés MDM seulement)

### 5.2 Décision blocker : Individual vs Organization

| Track            | Avantages                                                                                    | Inconvénients                                                                                                                           |
| ---------------- | -------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| **Individual**   | Rapide ($99 + 24-48h théorique, 1-4 sem réaliste 2026), pas de DUNS, SIRET non requis France | **Seller name = nom légal Eliot** ("Eliot Pena") visible publiquement sur App Store                                                     |
| **Organization** | Seller name = "Fxmily" brand consistency                                                     | DUNS Number requis (gratuit, 5-15j ouvrés France), legal entity status requis, site web public requis, **PAS de DBAs/fictitious names** |

**Recommandation V1 Fxmily** : Track **Individual** suggéré pour démarrage rapide. Si Eliot veut "Fxmily" seller name à terme → migration Organization (changement seller name post-publication = process Apple lourd → **trancher AVANT 1ère submission**).

#### Décision tranchée Session T 2026-05-23 (méta-délégation Eliot carte blanche + due diligence sub-agent `a2c7cdf21c0ecf53b` 5 URLs sources primaires Apple 2026) :

**Track choisi V1 = Individual $99/an** (seller name = "Eliot Pena" nom légal personne physique visible publiquement sur App Store).

Rationale hardcore :

1. **App PRIVÉE/INTERNE** (accès réservé membres formation post-inscription contrat amont) ⇒ seller name visibility = concern mineur (membres connaissent déjà Eliot personnellement, posture Mark Douglas privacy-first cohérente)
2. **Auto-entrepreneur / EI fréquent formateurs France** ⇒ pas d'entité légale "Fxmily" SAS/SARL confirmée (Apple n'accepte **PAS de DBA/fictitious names** verbatim [developer.apple.com/programs/enroll/] — Organization track impossible sans entité légale au nom "Fxmily")
3. **Speed enrollment** : Individual 1-4 sem réaliste 2026 (vs Org +5-30j DUNS France ouvrés + 14j replication internationale = jusqu'à 6-7 sem worst case)
4. **Trader discipline "start lean iterate"** : Individual $99/an = pas de surcoût difference vs Org $99/an, lance dev Capacitor V2-B plus vite
5. **Sunk cost minimal** : si Eliot crée plus tard entité Fxmily SAS/SARL → migration via `transfer app` Apple possible (App garde reviews/ratings/Bundle ID)

**Caveat critique migration `transfer app` Individual → Organization** [developer.apple.com/help/app-store-connect/transfer-an-app/app-transfer-criteria/] :

- App-Specific Shared Secret + nouveaux provisioning profiles requis post-transfer
- Transfert expire à **60 jours** (urgence si initiated)
- **Deux Account Holders requis** (sender Individual + receiver Organization, donc Eliot doit créer Organization account séparé puis initiate transfer)
- Apple n'expose **PAS de procédure "convert account" publique** — il faut contacter Apple support OR utiliser mécanisme transfer app
- Downtime exact transfer = `[TBD 2026]` non quantifié sources primaires consultées

**Réversibilité** : décision tranchée AVANT 1ère submission App Store (Session CC V2-J). Si Eliot crée entité Fxmily SAS/SARL entre Session T et Session BB TestFlight beta → re-évaluation possible carbone scar O1 decision tree (révision avant publication = process Apple plus simple que post-publication).

### 5.3 Processing time réel 2026 (drift vs Apple official)

[tool-output CAP-3 §4] :

- Apple official : 24-48h
- **Réalité 2026** : **3-5j à 1-4 semaines** typique
- **Cas pathologiques** : stuck "Being Processed" 2-7+ semaines sans communication
- Trigger fréquent : mismatch légal name (typo, ordre, accent) → demande pièce d'identité +3-7j

**Recommandation** : enroll **EN PARALLÈLE** avec dev Capacitor (sunk cost $99). Budget tampon 2-4 semaines.

### 5.4 France/EU specifics

- SIRET **non requis** Individual track (particulier OK)
- DUNS France gratuit via Dun & Bradstreet (~5-15j ouvrés)
- Adresse postale obligatoire (P.O. boxes refusées)
- 2FA Apple ID activé requis

### 5.5 Google Play Console enrollment (Session T+ multi-platform pivot — Android scope ADDED V2)

[tool-output sub-agent A7D7 Session T+ — 4 sujets validés sources primaires 2026] :

**Coût + paiement** :

- **$25 USD one-time** (PAS récurrent annuel comme Apple $99/an) verbatim [support.google.com/googleplay/android-developer/answer/6112435]
- Paiement carte Visa/MC une seule fois à enrollment
- Pas d'auto-renew, account permanent à vie tant que pas violation policies

**Account types** :

- **Personal** (= Individual Apple équivalent) — recommandé Fxmily V1 carbone décision Apple Track Individual §5.2 Session T (cohérence cross-platform)
- **Organization** disponible si Eliot crée entité légale "Fxmily" SAS/SARL plus tard
- ID gov verification mandatoire depuis 2023-11-13 (gov ID requis Personal accounts) — workflow parallèle Apple ID verification

**Délai validation 2026** : `[TBD 2026]` — sub-agent A7D7 n'a pas trouvé timeframe précis verbatim. Source Google mentionne "validation delays may occur" sans chiffres. Anecdotal réaliste : 2-7j ouvrés (vs Apple 1-4 sem).

**France SIRET / DUNS** : `[TBD 2026]` — Google n'utilise PAS DUNS comme Apple. Sub-agent A7D7 n'a pas trouvé verbatim si SIRET requis Organization France. ID gov suffit typiquement Personal France.

**Pre-requis Eliot manuel** post-décision V2 multi-platform :

1. Compte Google personnel (Gmail OK)
2. Carte bancaire $25 USD
3. Pièce d'identité gov FR scan (passeport/CNI) — workflow ID verification 2023-11-13+
4. Adresse postale (P.O. boxes potentiellement refusées comme Apple)

**Caveat critique** "Android developer verification" 2024-2026 : Google a renforcé programme distinct du Play Console fee ([support.google.com/android/answer/14138318]). Vérifier avant enrollment — nouvelles règles 2025-2026 peuvent ajouter friction Personal account France.

#### Décision tranchée Session T+ 2026-05-23 (méta-délégation Eliot carte blanche + due diligence sub-agent `a7d7d73cdda5b79a4` 4 URLs Google Play Console sources primaires 2026) :

**Track Google Play V1 = Personal $25 USD one-time** (cohérence Apple Track Individual §5.2 Session T + lean start trader discipline). Migration Organization plus tard possible si Eliot crée entité légale.

## 6. APNs `.p8` authentication key (iOS only)

[tool-output CAP-3 §8 + CAP-2 §9] :

### 6.1 Génération workflow

1. Apple Developer portal → Certificates, Identifiers & Profiles → **Keys** (sidebar)
2. Bouton `+` → "Apple Push Notifications service (APNs)" → checkbox enabled
3. Nommer la key (ex: `"Fxmily APNs Production"`)
4. Continue → Generate → **Download `.p8` file**
5. ⚠️ **`.p8` downloadable une seule fois.** Si perdu → révoquer + recréer
6. Noter :
   - **Key ID** (10 chars alphanumériques)
   - **Team ID** (10 chars, différent du Key ID, visible top-right Developer account)
   - **Bundle ID** associé (`com.fxmily.app`)

### 6.2 Caractéristiques

- `.p8` ne **n'expire JAMAIS** + cross-apps même Developer account
- Limit : **2 APNs keys actives max par team** (suffisant Fxmily)
- Sandbox vs production endpoints : `api.sandbox.push.apple.com` TestFlight, `api.push.apple.com` App Store
- 10-15 min propagation Apple après création

### 6.3 Backend Fxmily import

Stockage sécurisé `.p8` :

- Encode base64 → env var prod `APN_AUTH_KEY_P8`
- **JAMAIS commit** `.p8` raw au git
- Env vars supplémentaires : `APN_KEY_ID`, `APN_TEAM_ID`, `APN_BUNDLE_ID`, `APN_ENVIRONMENT`

### 6.4 Firebase Cloud Messaging proxy (alternative non retenue Session T)

Si choix `@capacitor-firebase/messaging` (recommandation CAP-2 initiale) :

- Firebase Console → Project Settings → Cloud Messaging → APNs Authentication Key
- Upload `.p8` + Key ID + Team ID dans Firebase
- Firebase route Apple → FCM → device (proxy unified Android+iOS futur)
- Backend Fxmily peut envoyer via FCM API (HTTPS POST) au lieu de signer JWT APN directement

**Trade-off** : Firebase proxy = simplifie unified push V2.1 Android, MAIS ajoute dépendance Firebase (privacy nutrition labels + sub-processor à déclarer Apple + tiers à mentionner privacy policy).

#### Décision tranchée Session T 2026-05-23 (méta-délégation Eliot carte blanche + due diligence sub-agent `a2c7cdf21c0ecf53b` 5 URLs sources primaires Capacitor + Apple Privacy Manifests + npm 2026) :

**Push channel V2 iOS = Direct APN HTTP/2** via lib backend Node.js **`@parse/node-apn`** (v8.1.0 publiée 12 avril 2026, 80k-110k weekly downloads, repo non archivé [github.com/parse-community/node-apn]). Plugin Capacitor côté device = **`@capacitor/push-notifications`** natif (cohérent §3.2 reverse drift CAP-2).

Rationale hardcore :

1. **App PRIVÉE/INTERNE + posture data minimization** ⇒ 0 sub-processor Google Firebase préférable (RGPD app privée = data exposure surface réduite)
2. **Privacy Manifest Apple ENFORCED depuis 1ᵉʳ mai 2024 (ITMS-91053)** [developer.apple.com/documentation/bundleresources/adding-a-privacy-manifest-to-your-app-or-third-party-sdk] ⇒ FCM = sub-processor obligatoire à déclarer Privacy Nutrition Labels App Store + DPA Google. Direct APN = **aucun tiers ajouté**, données restent Apple↔Hetzner direct
3. **FCM requiert quand même upload `.p8` APN key côté Firebase Console** [firebase.google.com/docs/cloud-messaging/ios/client] ⇒ FCM = **couche intermédiaire sans gain iOS-only**, double overhead config + sub-processor
4. **Capacitor docs officielles 2026** [capacitorjs.com/docs/guides/push-notifications-firebase] listent `@capacitor/push-notifications` comme guide officiel verbatim — Firebase Messaging est alternative pour Android+iOS unifié, pas obligatoire iOS-only
5. **Lib backend `@parse/node-apn` active 2026** : JWT signing automatique (renew ~20-60min), HTTP/2 endpoint natif, BadDeviceToken/Unregistered taxonomy claire — préféré à signing manuel JWT custom

**Caveat critique Android V2.1+ futur** : Direct APN choix iOS V2 = refactor obligatoire vers FCM lorsque Android V2.1 implémenté (Android n'a **PAS** d'équivalent APN direct, doit passer par FCM). **Mitigation Session V V2-C** : design abstraction `PushProvider` (interface `IApnClient` factory déjà extensible §4.4) côté backend pour découpler `lib/push/dispatcher.ts` du driver concret. Refactor V2.1 = ajouter `LiveFcmClient implements IPushProvider` parallèle, swap Android dispatcher path. Effort estimé refactor V2.1 = ~1-2j si abstraction propre Session V vs ~4-5j si tight coupling APN-only.

**Caveat sub-processor scope app PRIVÉE/INTERNE** [synthèse sub-agent A2C7] : _"moins de membres = moins d'exposition GDPR, mais statut privé ne dispense PAS des Privacy Manifests App Store ni du DPA sub-processor si FCM choisi → Direct APN reste préférable pour minimiser surface contractuelle Google."_

**Latence comparée APN direct vs FCM proxy 2026** : `[TBD 2026]` non chiffrée dans sources primaires consultées sub-agent A2C7 — Direct APN théoriquement plus rapide (1 hop Apple↔Hetzner vs 2 hops Apple↔FCM↔Hetzner) mais magnitude exacte invérifiable.

### 6.5 Firebase Cloud Messaging Direct FCM HTTP v1 (Android only — Session T+ multi-platform pivot)

[tool-output sub-agent A7D7 Session T+ — 4 sujets Firebase Admin SDK + FCM HTTP v1 + plugin Capacitor Firebase Messaging + Android Studio 2026] :

**Architecture choisie Android** : `firebase-admin` npm Node 22+ backend Hetzner → Direct FCM HTTP v1 API → device Android (plugin Capacitor `@capacitor-firebase/messaging` côté device gère registration FCM token + notification handling).

**FCM HTTP v1 API status 2026** :

- **Seul API actuel 2026** (legacy FCM HTTP API EOL juin 2024 verbatim, URL legacy retourne 404 maintenant — preuve migration terminée)
- Cité comme méthode active sur [firebase.google.com/docs/cloud-messaging]
- Authentication = service account JSON (PAS legacy server key API)

**Firebase Admin SDK Node.js setup workflow** :

1. Firebase Console → créer project Firebase "fxmily-mobile" (gratuit Spark plan)
2. Settings → Service accounts → "Generate New Private Key" → télécharge JSON
3. Backend Hetzner : `npm install firebase-admin --save` (Node 22+ recommandé verbatim [firebase.google.com/docs/admin/setup])
4. Encode JSON → env var prod `FIREBASE_SERVICE_ACCOUNT_JSON` (base64 OU raw JSON quoted)
5. JAMAIS commit JSON service account raw au git (carbone .p8 APN handling §6.3)

**Coût FCM 2026** : **gratuit illimité** sur Spark plan (no-cost) ET Blaze plan verbatim [firebase.google.com/pricing] "Cloud Messaging (FCM) - No-cost". Pas de tier paywall même volume élevé.

**Plugin Capacitor Android `@capacitor-firebase/messaging`** (Capawesome community team) :

- **Actif 2026** : monorepo `github.com/capawesome-team/capacitor-firebase`, dernière release **2026-03-31**
- Capacitor 8 supporté explicitement
- Setup Android : `google-services.json` Firebase Console → placé dans dir `apps/mobile/android/app/`
- Icon push : `AndroidManifest.xml` notification icon (white pixels / transparent bg, PAS app icon)
- Token registration : `FirebaseMessaging.getToken()` côté plugin → POST `/api/account/push/register-fcm-token` backend
- Auto-init désactivable via `firebase_messaging_auto_init_enabled=false` metadata (utile contrôle granulaire opt-in)

**Privacy iOS impact** : `firebase-admin` côté Node.js backend Hetzner = PAS dans bundle iOS = **pas de declaration Privacy Manifest iOS requise** (sub-processor Google côté backend = mention privacy policy Fxmily seulement, PAS manifest plist app).

**Privacy Android Google Play Data Safety form** : déclarer Firebase comme sub-processor + types données partagées (FCM device tokens + payload notification content) — workflow Google Play Console Data Safety form (équivalent Privacy Nutrition Labels Apple).

#### Décision tranchée Session T+ 2026-05-23 (méta-délégation Eliot carte blanche + due diligence sub-agent `a7d7d73cdda5b79a4` 4 URLs Firebase + Capacitor + Android sources primaires 2026) :

**Push channel V2 Android = Direct FCM HTTP v1** via lib backend Node.js **`firebase-admin`** Node 22+. Plugin Capacitor côté device = **`@capacitor-firebase/messaging`** Capawesome (cohérent §3.2 plugin row 1b).

Rationale hardcore Option D best-of-breed per-platform (vs FCM proxy unified iOS+Android) :

1. **Android FCM obligatoire** ⇒ Firebase = seul transport push Android natif (pas d'équivalent APN direct côté Android). Sub-processor Google **inévitable** pour Android quel que soit le choix
2. **iOS reste pur 0 sub-processor Google** ⇒ Direct APN HTTP/2 iOS conservé (§6.4 Session T décision), Firebase ABSENT bundle iOS = Privacy Manifest Apple plus simple
3. **Backend abstraction `IPushProvider`** ⇒ 3 drivers parallèles (APN + FCM + Web Push) → triple-channel dispatcher fan-out `Promise.allSettled` (§4.6) → architecture propre + extensible V2.1+ (ex: ajout 4ème driver WhatsApp/SMS sans refactor)
4. **Cost zero** ⇒ FCM no-cost Spark + Blaze (Google paie infra push Android)
5. **Plugin Capawesome actif** ⇒ release 2026-03-31, Capacitor 8 supporté, maintenance community confirmée

**Caveat critique workflow plugin Capacitor `MainActivity.kt`** : modifications spécifiques (register plugin) PAS visibles README packages/messaging sub-agent A7D7 — workflow standard Capacitor 8 attendu mais non cité verbatim. À confirmer Session U V2-B setup.

**Caveat target SDK Android Play Store** : "New apps and app updates must target Android 15 (API level 35) or higher" depuis **2025-08-31** [developer.android.com/google/play/requirements/target-sdk]. Capacitor 8 min API 24 (Android 7) couvre 99% market — OK.

## 7. TestFlight beta (verbatim CAP-3 §10)

- **100 internal testers** (membres team ASC Account Holder/Admin/App Manager/Developer/Marketing) — PAS de review, accès immédiat post-upload (~10-30min processing)
- **10000 external testers** invités email/lien public — **1ère build review TestFlight ~24-48h**, builds suivants auto-approuvés sauf changement majeur
- **30 devices max** par tester (multi-device coverage)
- **100 builds max** par app
- **Beta build expiration 90 jours** après upload → re-build + re-upload requis ensuite
- **TestFlight gratuit** inclus Developer Program

**Workflow Fxmily V1 mobile** :

1. Internal testers : Eliot + 1-2 collaborateurs trader test (1ère build sans review)
2. External group cohorte formation 5-10 membres : 1ère build TestFlight review + itérations 2-4 sem
3. Production submission App Store quand UX stable

## 8. App Store Connect submission assets

[tool-output CAP-3 §11] :

### 8.1 SDK requirement (DEADLINE PASSÉE)

> **"Effective April 28, 2026, iOS and iPadOS apps must be built with iOS & iPadOS 26 SDK or later."**

⚠️ Xcode 26+ requis OBLIGATOIRE. Capacitor 8 compat iOS 26 SDK confirmé [tool-output CAP-2 §1].

### 8.2 Assets

| Asset                               | Spec 2026                                   | Notes                                               |
| ----------------------------------- | ------------------------------------------- | --------------------------------------------------- |
| **App icon**                        | 1024×1024 PNG, sans alpha, RGB              | Apple standard                                      |
| **Screenshots iPhone 6.9" PRIMARY** | **1320×2868 px** (iPhone 17 Pro Max)        | Apple auto-scale autres tailles si soumis 6.9" only |
| Screenshots iPhone 6.7" fallback    | 1290×2796 px                                | optionnel                                           |
| Screenshots iPhone 6.3"             | 1206×2622 px (iPhone 17 / 17 Pro)           | optionnel                                           |
| Format                              | PNG ou JPEG, RGB, no alpha, max 8-10 MB/img |                                                     |
| Quantité                            | 3 min, **10 max** par localization          | Fxmily V1 = 6-8 screenshots recommandé              |
| App previews vidéos                 | optionnel, jusqu'à 3 par localization       | DEFERRED V2.1                                       |
| App name                            | **30 chars max**                            | "Fxmily" (6 chars)                                  |
| Subtitle                            | 30 chars max                                | ex "Suivi trading discipline" (24 chars)            |
| Promotional text                    | 170 chars max                               | modifiable post-review                              |
| Description                         | **4000 chars max**                          |                                                     |
| Keywords                            | **100 chars max** comma-separated           |                                                     |

### 8.3 Privacy Nutrition Labels (CRITIQUE 2026)

Déclarer TOUTE data collectée par l'app + plugins Capacitor + SDK tiers :

- **Contact Info** : email (Auth.js)
- **User Content** : journal trades, check-ins, mindset QCM, REFLECT debriefs, monthly debriefs IA
- **Identifiers** : device tokens APN, user IDs (pseudonymized)
- **Usage Data** : analytics si activé
- **Diagnostics** : Sentry crash reports
- **Third parties** : Sentry, Resend, Cloudflare R2, Anthropic Claude API, Firebase (si messaging)

**Rejection trigger Guideline 5.1.1** si inexact. Aligner avec SPEC §5 + `/legal/privacy` publique.

### 8.4 Privacy Manifests `PrivacyInfo.xcprivacy` (OBLIGATOIRE 2026)

Fichier dans app + dans chaque SDK tiers de la liste "privacy-impacting" Apple. Déclare APIs sensibles utilisées (UserDefaults, FileTimestamp, SystemBootTime, DiskSpace) + raisons. **Rejection commune 2026 si manquant**.

Audit exhaustif SDK tiers requis :

- Sentry SDK (manifest fourni officiellement ?)
- Capacitor plugins (Firebase, push, network, etc. — chacun manifest ?)
- Hetzner/Resend/R2 = backend, pas SDK iOS direct
- Anthropic Claude = backend Hetzner pas SDK iOS

### 8.5 Age rating

Questionnaire ASC → calcule rating. Fxmily probable **12+ ou 17+** (références trading/finance, contenu Mark Douglas psychologie discipline).

### 8.6 Category

- Primary : **Finance** (probable) OR Productivity OR Lifestyle
- Secondary : Health & Fitness ? (mindset wellness angle)

**Note positionnement critique** : éviter "trading platform" / "forex" / "CFD" / "investment platform" dans description → utiliser "**trading discipline tracker**", "**mindset journal**", "**behavioral tracking**" → réduit risque misclassification fintech regulated (Guideline 5.1.1(ix) + 3.2.1(viii) + 3.2.2(viii)).

### 8.7 Pricing tier

**Free V1** : Fxmily cohorte fermée auth-gated, pas paywall App Store. EU DMA impact NUL (pas IAP digital goods).

Si freemium futur V2+ : IAP StoreKit obligatoire (commission EU 20% via DMA Small Business Program <$1M = 15%).

## 9. 3 Caveats CRITIQUES Fxmily pré-submission

[tool-output CAP-3 §13 + §17] — 88% rejections selon Adapty research :

### 9.1 Account deletion in-app (Guideline 5.1.1(v))

> "If your app supports account creation, you must also offer **account deletion within the app**."

**Action** : vérifier état actuel Fxmily. Probable `/account/settings` ou `/account/delete` LIVE J10 Phase A (cf. audit Round 1 sub-agent E mention `/account/delete` LIVE). Si présent côté web `apps/web` → WebView Capacitor le servira automatiquement.

**Validation préalable submission** : tester flow account deletion depuis Capacitor app → backend `lib/account/deletion.ts` state machine (soft-delete 24h grace → materialized → hard-purge 30d).

### 9.2 Demo account + Notes for Review (Guideline 2.1)

> "Include demo account info (and turn on your back-end service!) if your app includes a login."

**Action** : créer `apple-review@fxmily.app` (ou `apple-review@fxmilyapp.com`) avec données mock populated :

- 1 trade débrief
- 1 mindset check QCM
- 1 monthly debrief mock
- 1 weekly report mock
- Push subscription factice OK

**App Review Notes** : "Access restricted to Fxmily trading formation members. Demo account provided has full access for review purposes. Demo credentials below."

### 9.3 Positionnement App Store strict non-fintech

> Guideline 5.1.1(ix) Highly regulated industries : "Apps that provide services in highly regulated fields (banking, financial services...) should be submitted by a legal entity that provides the services."
>
> Guideline 3.2.1(viii) : "Apps used for financial trading, investing, or money management should be submitted by the financial institution performing such services and must have necessary licensing."
>
> Guideline 3.2.2(viii) : "Apps that facilitate trading in contracts for difference (CFDs) or other derivatives (FOREX) must be properly licensed."

**Mitigation Fxmily** :

- Fxmily NE FAIT PAS trading/investing/money management direct (pas de market data, pas d'execution ordres, pas de portfolio tracking €/USD)
- Description App Store stricte : **"Behavioral tracker + mindset journal for trading students. NOT a trading platform. NOT financial advice."**
- Cohérent SPEC §2 posture Mark Douglas (0 conseil trade)
- Cohérent posture Eliot Session S clarification : app interne post-formation, légalité couverte amont par contrat formation

## 10. EU DMA 2026 impact

[tool-output CAP-3 §14] :

- DMA en vigueur depuis 7 mars 2024, Apple gatekeeper
- Janvier 2026 : Apple single business model EU (CTC remplace CTF)
- IAP commission EU : **20% total** (vs 30% historique)
- Small Business Program <$1M/an = **15%**
- Alternative app stores EU autorisés (AltStore, Epic Games EU) — pas applicable Fxmily
- External payment links autorisés (StoreKit External Purchase Link Entitlement) — 5% CTC si utilisé

**Impact Fxmily V1 mobile** : **NUL** (free app, pas IAP, cohorte payée hors-app via Stripe Eliot direct ≠ IAP digital goods réglementé Apple).

**Impact Fxmily V2 si freemium IAP futur** : 20% (15% si <$1M/an Small Business Program).

## 11. Coût total année 1 cross-platform Apple + Google (Session T+ multi-platform pivot)

| Poste                                                 | Coût USD             | Coût EUR (~)         | Récurrence         |
| ----------------------------------------------------- | -------------------- | -------------------- | ------------------ |
| Apple Developer Program (Individual)                  | $99                  | €99                  | annuel récurrent   |
| Google Play Console (Personal)                        | **$25**              | **€25**              | **ONE-TIME à vie** |
| DUNS Number Apple (si Organization migration)         | $0 (gratuit)         | €0                   | one-time           |
| Firebase project + FCM (Cloud Messaging)              | **$0 (no-cost)**     | €0                   | gratuit illimité   |
| Apple Sign in (optional)                              | $0                   | €0                   | -                  |
| Certificats + provisioning Apple (inclus Developer)   | $0                   | €0                   | -                  |
| Android signing keys (`release.keystore` local)       | $0                   | €0                   | -                  |
| TestFlight (inclus Apple Developer)                   | $0                   | €0                   | -                  |
| Google Play Internal Testing (inclus Play Console)    | $0                   | €0                   | -                  |
| App Store Connect API (inclus Apple)                  | $0                   | €0                   | -                  |
| Google Play Developer API (inclus Play Console)       | $0                   | €0                   | -                  |
| Push Notifications APNs (inclus Apple)                | $0                   | €0                   | -                  |
| Push Notifications FCM (gratuit illimité Spark/Blaze) | $0                   | €0                   | -                  |
| iCloud / CloudKit (Fxmily n'utilise pas)              | $0                   | €0                   | -                  |
| Xcode Cloud 25h/mois (Fxmily peut s'en passer)        | $0                   | €0                   | -                  |
| **Total année 1 cross-platform iOS + Android**        | **$124 ($99 + $25)** | **€124 (€99 + €25)** | mixed              |
| **Total années suivantes (récurrent)**                | **$99/an**           | **€99/an**           | Apple only         |

**Hardware prerequisite Session T+** :

- **iOS build** : REQUIERT macOS + Xcode local — ✅ **Mac OK Eliot confirmé Session T** (0 surcoût hardware)
- **Android build** : Windows 10+/macOS 12+/Linux supportés [developer.android.com/studio] — Mac OK Eliot ⇒ same machine pour les 2 dev (économie ressources). Sub-agent A7D7 confirme **Mac NON obligatoire** pour Android dev (vs Apple requires Mac uniquement).
- Si pas de Mac (alternative scenario) : MacBook M2/M3 minimum (~€1100-1500) OU cloud Mac service (MacInCloud ~$30/mois = ~€330/an, MacStadium ~$80/mois = ~€880/an) — couvre les 2 plateformes

## 12. Calendar réaliste séquence multi-jalons §18.4 (Session T+ multi-platform pivot)

Estimation totale **10-14 semaines calendaires** cross-platform iOS + Android (extension de 8-11 sem iOS-only Session S original) :

- Best case enrollment Apple 48h + Google Play 2j + 0 rejection : **7-8 semaines**
- Realistic 2026 enrollment Apple 2-4 sem + Google Play 1 sem + 1 rejection cycle fintech lane Apple : **10-14 semaines**
- Worst case Apple enrollment stuck + 2 rejections + Google Play rejection : **14-20 semaines**

### Séquence Sessions §18.4 atomic (10 jalons proposés — Session T+ étendu Android)

| Session | Jalon                                                                                                                                                                                                              | Effort                                 | Type                                  |
| ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------- | ------------------------------------- |
| **T**   | V2-A Enrollment Apple Developer + bundle ID design + Mac check Eliot                                                                                                                                               | 1-2h                                   | Ops + checks ✓ DONE                   |
| **T+**  | V2-A+ Multi-platform pivot + Google Play Console scope + push channel triple-stack Option D + abstraction PushProvider                                                                                             | 1-2h                                   | Ops docs (re-tranche) ✓ THIS PR       |
| **U**   | V2-B Capacitor 8 setup **iOS + Android workspace** (`apps/mobile/` + cap init + cap add ios + cap add android + sync test simu iOS + emulator Android)                                                             | **2-3j** (était 1-2j iOS only)         | Code (workspace setup cross-platform) |
| **V**   | V2-C APN `.p8` + FCM service account + backend triple-channel dispatcher + nouvelles routes (register-apn-token + register-fcm-token) + schema migration (ApnDeviceToken + FcmDeviceToken)                         | **3-4j** (était 2-3j iOS only)         | Code multi-fichiers                   |
| **W**   | V2-D Plugins MVP cross-platform integration (iOS @capacitor/push-notifications + Android @capacitor-firebase/messaging + 9 partagés) + safe-area iOS + status bar + splash + Android notification icon             | **2-3j** (était 1-2j iOS only)         | Code                                  |
| **X**   | V2-E Auth.js cookies SameSite=none override + cross-validation Capacitor flow iOS + Android WebView                                                                                                                | 0.5j                                   | Code (peu d'impact Android vs iOS)    |
| **Y**   | V2-F Account deletion in-app verify (iOS Apple req + Android Google Play req équivalent) + demo accounts (`apple-review@fxmilyapp.com` + `google-play-review@fxmilyapp.com`) provisioned                           | **1-1.5j** (était 0.5-1j iOS only)     | Code + setup                          |
| **Z**   | V2-G App Store assets (icon 1024 + screenshots iPhone 6.9" 1320×2868) **+ Google Play assets** (icon 512×512 + feature graphic 1024×500 + screenshots Android phone) + metadata cross-platform                     | **2-3j** (était 1-2j iOS only)         | Design + content                      |
| **AA**  | V2-H Privacy Manifests Apple audit SDK tiers + Privacy Nutrition Labels ASC **+ Google Play Data Safety form** (Firebase sub-processor déclaré + types données)                                                    | **2-3j** (était 1-2j iOS only)         | Audit + docs                          |
| **BB**  | V2-I TestFlight beta cycle (internal Eliot + external 5-10 membres formation) **+ Google Play Internal Testing parallèle** (Closed Testing track 5-10 testers)                                                     | 3-7j calendaires (parallèle)           | Ops + iterations                      |
| **CC**  | V2-J App Store submission Notes for Review + suivi Apple review fintech lane (5-10j) **+ Google Play Production submission** + suivi Google review (typically 1-3j vs Apple 5-10j) + buffer rejection les 2 stores | 7-21j calendaires (parallèle 2 stores) | Ops + submission                      |

### Activités parallèles dev/enrollments multi-platform

Pendant attente enrollments Apple (1-4 sem) + Google Play (2-7j) :

- Sessions U/V/W/X dev backend + Capacitor wrapper local **iOS + Android simultané** (Mac peut builder les 2)
- Session Y account deletion + demo accounts (iOS + Android)
- Session Z assets preparation **2 stores parallèle** (Eliot a la designer skill / un graphiste pour produire les 2 sets distincts ?)
- Session AA Privacy Manifests Apple + Google Play Data Safety form parallèle
- Au reçu enrollment Apple OK → Bundle ID + APN key + TestFlight upload
- Au reçu Google Play Console OK → Package name + service account JSON Firebase + Internal Testing upload

**Note Session T+ scar reproductible** : Sessions U..CC = chacune ~1-2j effort additionnel pour ajout Android (cross-platform parallélisable la plupart, Capacitor 8 supporte les 2 dans même workspace). Total +4-5 semaines vs iOS-only séquence Session S/T originale. ROI : 1 codebase = 2 app stores = 2× addressable user base.

## 13. Risks Fxmily-spécifiques (10 tabulés)

[tool-output CAP-3 §17 + CAP-1 §11] :

| Risk                                                                     | Probabilité                   | Impact                                 | Mitigation                                                                                                                |
| ------------------------------------------------------------------------ | ----------------------------- | -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| Enrollment stuck >2 sem                                                  | Moyenne 2026 trend            | Bloque tout iOS                        | Enroll EARLY parallèle dev. Backup plan : web PWA stable V1.                                                              |
| Misclassification fintech / Org required                                 | Moyenne                       | Rejection + Org migration              | Description App Store strict non-fintech (cf. §9.3)                                                                       |
| Account deletion absente                                                 | Élevée si non-checké          | Rejection 5.1.1(v)                     | Implémenter + tester avant submission (cf. §9.1)                                                                          |
| Demo account manquant                                                    | Moyenne                       | Rejection 2.1                          | Demo user provisioned + Notes for Review (cf. §9.2)                                                                       |
| AI disclosure tier compliance                                            | Faible (carbone Session R OK) | Rejection 5.1.2(i)                     | `/legal/ai-disclosure` LIVE post-Session R + Monthly Debrief disclosed                                                    |
| iOS 26 SDK incompat Capacitor                                            | TBD                           | Bloque submission 28 avril 2026+       | Capacitor 8 confirmé compat 26 SDK                                                                                        |
| Eliot pas Mac hardware                                                   | TBD info Eliot                | Bloque Capacitor iOS build local       | MacBook achat OR cloud Mac service                                                                                        |
| DUNS delay si Org                                                        | Moyenne                       | +5-15j enrollment                      | Individual track preferred V1                                                                                             |
| Cookie SameSite=lax cross-origin WebView                                 | Faible avec iosScheme:'https' | Auth broken WebView                    | Override SameSite=none secure partitioned (§4.1)                                                                          |
| Privacy Manifests SDK tiers manquants                                    | Moyenne 2026 trend rejection  | Rejection commune                      | Audit exhaustif chaque SDK + Capacitor plugin (§8.4)                                                                      |
| Seller name "Eliot Pena" vs "Fxmily" brand                               | Élevée si Individual          | UX brand inconsistency                 | Trancher Individual vs Org AVANT 1ère submission                                                                          |
| **Android Studio version compat** (Session T+)                           | Faible 2026 trend             | Bloque Android build local             | Panda 4 (2025.3.4 Patch 1) stable, Mac OK supporté (Mac NON obligatoire)                                                  |
| **Target API 35 Android Play Store** (Session T+)                        | Élevée hors Capacitor 8       | Bloque submission depuis 2025-08-31    | Capacitor 8 confirmé compat API 35+ (min API 24 = 99% market)                                                             |
| **Google Play Personal verification** (Session T+)                       | Moyenne 2026 trend            | Délai enrollment +5-15j                | ID gov verification mandatoire depuis 2023-11-13 — préparer scan passeport/CNI                                            |
| **Plugin Capacitor Firebase Messaging MainActivity.kt** (Session T+)     | Faible                        | Setup Android push broken              | Workflow Capacitor 8 standard, à confirmer Session U V2-B setup (caveat sub-agent A7D7)                                   |
| **FCM service account JSON leak** (Session T+)                           | Faible                        | Auth FCM compromis backend             | Env var prod `FIREBASE_SERVICE_ACCOUNT_JSON` base64, JAMAIS commit git, audit Hetzner SSH                                 |
| **Privacy Policy Fxmily missing Firebase sub-processor** (Session T+)    | Moyenne                       | Rejection Google Play Data Safety form | Update `/legal/privacy` page V2 : Firebase Cloud Messaging listed sub-processor (carbone Session R AI disclosure pattern) |
| **DUNS / SIRET / Android developer verification 2024-2026** (Session T+) | TBD France                    | Délai enrollment Personal Android      | `[TBD 2026]` sub-agent A7D7 non précisé — vérifier support.google.com/android/answer/14138318 avant enrollment Eliot      |

## 14. Pré-requis blockers Eliot AVANT démarrage

[Récap actionnable post-Session T+ multi-platform pivot 2026-05-23] :

**iOS (Apple)** :

1. ✅ **Capacitor approuvé $99/an** (Session S clarification)
2. ✅ **Mac hardware OK** (Eliot confirmé Session T — Xcode 26 installable App Store gratuit, **même machine pour Android dev** ⇒ 0 surcoût matériel additionnel multi-platform pivot)
3. ✅ **Track Apple Developer = Individual** default (Session T décision tranchée §5.2)
4. ✅ **Bundle ID `com.fxmily.app`** validé (Session T, reverse-DNS standard)
5. ⚠️ **iPhone physique** smoke test APN sandbox — push ne fonctionne PAS sur simulateur, requis Session BB TestFlight beta cycle (à confirmer Eliot d'ici Session BB)
6. ✅ **Push channel iOS = Direct APN HTTP/2** via `@parse/node-apn` + plugin Capacitor `@capacitor/push-notifications` natif (Session T décision tranchée §6.4)
7. ⚠️ **Demo account credentials Apple** : `apple-review@fxmilyapp.com` + password généré + données mock provisioned (Session Y, post-enrollment Apple)

**Android (Google) — Session T+ multi-platform pivot** :

8. ✅ **Scope V2 étendu Android simultané** (Session T+ Eliot clarification "n'importe quel client android comme ios est pas de soucis... téléphone éteint avec notif sur page d'accueil") — PAS DEFERRED V2.1+ comme brief Session S initial
9. ⚠️ **Google Play Console enrollment Personal $25 USD one-time** (à enroll Eliot post-Session T+ via [play.google.com/console](https://play.google.com/console)) — pièce d'identité gov FR scan requis (ID verification mandatoire depuis 2023-11-13)
10. ✅ **Push channel Android = Direct FCM HTTP v1** via `firebase-admin` Node 22+ + plugin Capacitor `@capacitor-firebase/messaging` Capawesome (Session T+ décision tranchée §6.5)
11. ⚠️ **Android Studio Panda 4 (2025.3.4 Patch 1)** installable sur Mac Eliot (Mac OK supporté, PAS Mac obligatoire — Windows 10+/Linux aussi OK) — à installer Session U V2-B setup
12. ⚠️ **Firebase project + service account JSON** à créer post-enrollment Google Play (Firebase Console gratuit → Settings → Service accounts → Generate New Private Key)
13. ⚠️ **Android device physique smoke test FCM** (Session BB Google Play Internal Testing parallèle TestFlight — Android emulator AVD aussi possible pour smoke test FCM contrairement à iOS APN)
14. ⚠️ **Demo account credentials Google** : `google-play-review@fxmilyapp.com` + password généré + données mock provisioned (Session Y équivalent Apple, post-enrollment Google Play)
15. ⚠️ **Privacy Policy Fxmily mise à jour** : ajouter Firebase Cloud Messaging comme sub-processor déclaré (carbone pattern Session R AI disclosure `/legal/ai-disclosure` + nouveau `/legal/privacy` update Session AA V2-H)

**Pré-requis externes Eliot manuel post-Session T+** (1-4 sem Apple + 2-7j Google parallèle dev Capacitor) :

- Enrollment Apple Developer Program Individual track via `developer.apple.com/programs/enroll/` (~10 min UI Apple ID + 2FA + pièce d'identité ID gov FR passeport/CNI)
- **Enrollment Google Play Console Personal $25 one-time** via `play.google.com/console` (~10 min Google account + 2FA + ID gov scan post-2023-11-13)
- Budget tampon enrollment 2-4 semaines Apple (réalité 2026 vs 24-48h Apple official) + 2-7j Google Play (`[TBD 2026]` exact)
- Sessions U..CC parallélisables pendant attente enrollments (dev Capacitor V2-B iOS + Android workspace + V2-C APN + FCM dispatcher triple-channel + V2-D plugins + V2-E auth cookies + V2-F account deletion 2 demo accounts + V2-G assets 2 stores + V2-H Privacy Manifests + Data Safety form parallèles)

## 15. État actuel post-Sessions R+0.5 (#148) + R+0.75 (#151) MERGED par Eliot

**Update Session R+0.5 2026-05-23T12:42:11Z** : PR #148 humaine `feat/track-record-T0` Eliot **MERGED** mergeCommit `fa68ed7fe706d748c5ad0a4f4fe2bddbff2bcea6`. `apps/track-record/` sub-app vitrine Cloudflare Pages + migration Prisma `20260521172000_track_record_public_trades` appliquée + PublicTrade + PublicTradePartial Prisma models LIVE main.

**Update Session R+0.75 2026-05-23T14:49:49+0200** : PR #151 humaine `feat/track-record-admin-T5` Eliot **MERGED** mergeCommit `1670a1b2ac90dde83e3e4569736e4ded9e6b8260` (auto-retargeté `main` post-#148, CI re-tournée passée, Eliot a mergé pendant rédaction brief Capacitor Session S). `apps/web/src/app/admin/track-record/*` + `lib/admin/public-trade-{math,service}.ts` + tests Vitest + audit slugs LIVE main.

**Origin/main HEAD CURRENT post-Session R+0.75** : **`1670a1b`** (NOT `fa68ed7` ni `92d139f`).

**Déploiements Voie CODE cumulatifs cohorte J/K/L/R/R+0.5/R+0.75** :

- J #117 setup-python : 2:55
- K #118 codeql-action : 2:30
- L #116 upload-artifact : 3:02
- R #155 (mine, AI disclosure) : 2:53
- R+0.5 #148 (Eliot, track-record-T0 + Prisma migration) : **5:05** (migration applique en plus)
- R+0.75 #151 (Eliot, T5 admin CRUD, 0 Prisma migration) : à vérifier durée [TBD]

**Scar R3 cohorte étendue range 2:30-5:05+** (6 déploiements V2 maintenant).

**Impact Capacitor V2** :

- `apps/track-record/` reste Cloudflare Pages static export distinct de l'app principale, ne touche pas Capacitor V2
- `apps/web/src/app/admin/track-record/*` LIVE main : surface admin Eliot, accessible via WebView Capacitor automatiquement (Server Components Hetzner)
- Capacitor V2 cible **uniquement `apps/web` SSR Hetzner**, monorepo Turborepo OK pour parallèle
- **0 impact architecture WebView shell** (server.url load `app.fxmilyapp.com` = surface complète admin + member)

## 16. Refs

- **CAP-1 architecture compat** : pattern WebView shell `server.url` arbitré vs CAP-2 static export. Compat HIGH ≥90%.
- **CAP-2 Capacitor docs 2026** : Capacitor 8 + deadline Xcode 26 (28 avril 2026 passée) + plugin `@capacitor-firebase/messaging` recommandé (vs legacy `@capacitor/push-notifications`) — **Session T reverse drift** : sub-agent A2C7 confirme `@capacitor/push-notifications` toujours guide officiel Capacitor 2026 [capacitorjs.com/docs/guides/push-notifications-firebase], PAS phasing out (cf. §3.2 + §6.4 décisions tranchées Session T)
- **CAP-3 Apple Developer Program 2026** : $99/€99 + Individual vs Org + enrollment 1-4 sem 2026 réaliste + TestFlight + assets 2026 (icon 1024 + screenshots 1320×2868 iPhone 6.9") + Privacy Nutrition Labels + 3 caveats critiques
- **CAP-4 push V1 + APN refactor** : mono-channel Web Push pur → dual-channel coexistence + modèle séparé `ApnDeviceToken` (pattern §21.5 isolation) + factory IApnClient HTTP/2 direct + bug latent `mindset_check_ready` à fixer
- **Posture Mark Douglas SPEC §2** : 0 conseil trade, exécution + psychologie seul. Système Lhedge INCONNU.
- **Eliot clarification Session S** : app interne PRIVÉE accès réservé membres formation post-inscription contrat amont. PAS vitrine grand public. Légalité formation gérée en amont. Multi-admin DEFERRED. Stripe DEFERRED. Capacitor iOS $99/an APPROUVÉ.
- **Session R canon EU AI Act §50(1) compliance** : Monthly Debrief IA disclosure résolu PR #155 `92d139f` 2026-05-23T12:02:02Z.
- **Sub-agents transcripts** : `a536d99efbdc39825` (CAP-1) + `a38757fa15c453598` (CAP-2) + `af3d2c71b184417c8` (CAP-3) + `a652edca36d0c5458` (CAP-4) — output_files NON lus carbone instruction système.
- **Session T 2026-05-23 due diligence sub-agent** : `a2c7cdf21c0ecf53b` — verdict Apple Developer Individual vs Organization + push channel Direct APN HTTP/2 vs FCM proxy. 10 URLs sources primaires consultées (developer.apple.com/programs/enroll + transfer-an-app + Privacy Manifests + capacitorjs.com/docs + firebase.google.com/docs + github.com/parse-community/node-apn + npmjs.com/@parse/node-apn). 2 caveats `[TBD 2026]` calibrated refusal (downtime transfer app exact + latence APN direct vs FCM chiffrée).
- **Session T clarifications Eliot** : Mac OK + Bundle ID `com.fxmily.app` validés directs ; Track Apple Developer + Push channel = méta-délégation totale "carte blanche, exploite tes capacités" → Claude tranche hardcore self-challenge → Individual + Direct APN HTTP/2 (rationale §5.2 + §6.4).
- **Session T+ 2026-05-23 due diligence sub-agent** : `a7d7d73cdda5b79a4` — verdict Google Play Console + FCM HTTP v1 + plugin Capacitor Firebase Messaging Android + Android Studio prerequisites 2026. 10 URLs sources primaires consultées (support.google.com/googleplay/android-developer + firebase.google.com/docs + firebase.google.com/pricing + github.com/capawesome-team/capacitor-firebase + developer.android.com/studio + developer.android.com/google/play/requirements/target-sdk). 2 caveats `[TBD 2026]` calibrated refusal (DUNS/SIRET France Google enrollment + délai validation Google Play exact).
- **Session T+ clarifications Eliot multi-platform pivot** : "n'importe quel client android comme ios est pas de soucis et surtout puisse ouvrir l'app que ça soit sur internet ou vrai app le mieux pour lui et surtout recevoir les notification comme une vraie application même téléphone éteint avec notif sur page d'accueil etc" = scope V2 étendu Android simultané iOS (PAS DEFERRED V2.1+ comme brief Session S initial). Méta-délégation totale "carte blanche exploite tes capacités" → Claude tranche hardcore self-challenge re-décision push channel = Option D best-of-breed Direct APN iOS + Direct FCM Android + abstraction PushProvider backend.
- **Sources primaires Android 2026 (sub-agent A7D7, 10 URLs)** : `support.google.com/googleplay/android-developer/answer/6112435` ($25 one-time) + `support.google.com/android/answer/14138318` (Android developer verification 2024-2026) + `firebase.google.com/docs/cloud-messaging` (FCM HTTP v1 actuel) + `firebase.google.com/docs/admin/setup` (Firebase Admin SDK Node 22+) + `firebase.google.com/pricing` (FCM no-cost) + `github.com/capawesome-team/capacitor-firebase` (plugin actif release 2026-03-31) + `github.com/capawesome-team/capacitor-firebase/tree/main/packages/messaging` + `developer.android.com/studio` (Panda 4 Mac/Windows/Linux) + `developer.android.com/studio/install` (system requirements) + `developer.android.com/google/play/requirements/target-sdk` (API 35 obligatoire 2025-08-31+)
