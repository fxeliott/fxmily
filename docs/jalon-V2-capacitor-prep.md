# Jalon V2-Capacitor-iOS — Préparation App Store soumission

> **Statut** : Brief de préparation (Session S 2026-05-23). Synthèse Round 2 Session S audit `/maximum-mode` 4 sub-agents parallèles (CAP-1 architecture compat + CAP-2 Capacitor docs 2026 + CAP-3 Apple Developer Program 2026 + ASC + CAP-4 push V1 → APN refactor scope).
>
> **Session T 2026-05-23 (post-merge décisions tranchées Voie V2-A)** : 4 pré-requis blockers résolus via clarifications Eliot + méta-délégation carte blanche + due diligence sub-agent `a2c7cdf21c0ecf53b` (Apple Developer 2026 + push notifications stack 2026, 10 URLs sources primaires) :
>
> 1. ✅ Mac hardware OK (Eliot confirmé Session T)
> 2. ✅ Bundle ID `com.fxmily.app` validé (Session T)
> 3. ✅ Track Apple Developer = **Individual** default (Session T décision tranchée, voir §5.2 — caveat migration `transfer app` documenté)
> 4. ✅ Push channel = **Direct APN HTTP/2** via `@parse/node-apn` + plugin Capacitor `@capacitor/push-notifications` natif (Session T décision tranchée, voir §6.4 — reverse drift CAP-2 sur plugin Firebase Messaging)
>
> Pré-requis restants Session T+ : iPhone physique smoke test (Session BB TestFlight) + Demo account `apple-review@fxmilyapp.com` provisioned (Session Y).
>
> **Décision Eliot** : Capacitor iOS + Apple Developer Program **$99/an APPROUVÉ** (Session S clarification).
>
> **Posture rappelée** : Fxmily app PRIVÉE/INTERNE (accès réservé membres formation Eliot post-inscription contrat amont). PAS vitrine grand public. Posture Mark Douglas stricte (0 conseil trade, exécution + psychologie seul). Système Lhedge INCONNU. EU AI Act §50(1) compliance résolu Session R.

## 1. Objectif

Transformer Fxmily PWA Next.js 16 + React 19 (V1.12 P4 LIVE prod Hetzner) en **app native iOS** soumise et publiée sur Apple App Store, accessible aux membres formation Fxmily depuis leur iPhone via icône Home Screen native + APN push notifications natives.

**Périmètre V2.x** :

- iOS uniquement V2 (Android Play Store DEFERRED — V2.1 ou V3)
- 1 build production Fxmily V1.x feature set actuel (PAS de nouvelles features Fxmily dans ce jalon)
- App icon + splash + push APN + 10 plugins MVP P0+P1
- Distribution App Store Connect (PAS Enterprise distribution)

**Hors-scope explicite** :

- Multi-admin (DEFERRED Eliot)
- Stripe billing in-app (DEFERRED Eliot — cohorte payée hors-app Stripe externe Eliot direct)
- Android Capacitor (V2.1+)
- Capacitor Camera plugin (V2.1+ si upload photos trades)
- Local notifications (V2.1+)

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

### 3.2 Plugins MVP iOS — sélection définitive 10 P0+P1

[tool-output CAP-2 §8] :

| #   | Plugin npm                                                                               | Usage Fxmily                                                             | Priorité |
| --- | ---------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ | -------- |
| 1   | `@capacitor/push-notifications` (officiel Capacitor 2026, Session T reverse drift CAP-2) | Push APN natif iOS — Direct APN HTTP/2 backend (Session T décision §6.4) | P0       |
| 2   | `@capacitor/preferences`                                                                 | Replace `localStorage` storage natif sécurisé                            | P0       |
| 3   | `@capacitor/app`                                                                         | Lifecycle resume/pause/deep links                                        | P0       |
| 4   | `@capacitor/status-bar`                                                                  | Style dark mode V1 Fxmily                                                | P1       |
| 5   | `@capacitor/splash-screen`                                                               | Splash native lancement app                                              | P1       |
| 6   | `@capacitor/network`                                                                     | Online/offline UX (mode déconnecté)                                      | P1       |
| 7   | `@capacitor/keyboard`                                                                    | Auto-scroll inputs (wizards REFLECT/TRACK)                               | P1       |
| 8   | `@capacitor/haptics`                                                                     | Feedback tactile REFLECT wizard validation                               | P1       |
| 9   | `@capacitor/browser`                                                                     | Liens externes (/legal/\* pages)                                         | P1       |
| 10  | `@capacitor/share`                                                                       | Partage natif debrief (WhatsApp/Telegram)                                | P1       |

**Note Session T due diligence sub-agent `a2c7cdf21c0ecf53b` — reverse drift CAP-2** : Capacitor docs officielles 2026 listent toujours `@capacitor/push-notifications` comme guide officiel verbatim [capacitorjs.com/docs/guides/push-notifications-firebase] (PAS phasing out). `@capacitor-firebase/messaging` reste **alternative valide** pour proxy FCM unifié Android+iOS futur (Android V2.1+ refactor), MAIS non obligatoire 2026. **Décision Session T** : `@capacitor/push-notifications` natif iOS V2 (couplé Direct APN HTTP/2 backend §6.4) pour minimisation sub-processors Google + Privacy Manifest Apple (cohérent app PRIVÉE/INTERNE + posture data minimization). Refactor Android V2.1+ devra introduire abstraction `PushProvider` côté backend pour découpler.

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
  plugins: {
    PushNotifications: {
      presentationOptions: ['badge', 'sound', 'alert', 'banner', 'list'],
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

### 4.4 Service push : `lib/push/apn-push-client.ts` (NEW)

**Fichier** : `apps/web/src/lib/push/apn-push-client.ts` (~200 LOC).

Interface `IApnClient` parallèle à `IWebPushClient` factory (pattern déjà extensible `web-push-client.ts:77-83`) :

```typescript
export interface IApnClient {
  send(token: string, payload: ApnPayload): Promise<ApnSendResult>;
}

class LiveApnClient implements IApnClient {
  // HTTP/2 direct APN endpoint (moderne 2026 préféré à node-apn abandonware)
  // JWT signing avec .p8 + Key ID + Team ID
  // Endpoints : api.sandbox.push.apple.com (TestFlight) | api.push.apple.com (prod)
  // Payload format : {aps:{alert:{title,body},badge,sound}, custom_keys}
  // Error taxonomy : BadDeviceToken | Unregistered | TooManyRequests | other
}

class MockApnClient implements IApnClient { /* V1 default deterministe */ }

export function createApnClient(): IApnClient {
  return env.APN_AUTH_KEY_P8 && env.APN_KEY_ID && env.APN_TEAM_ID
    ? new LiveApnClient(...)
    : new MockApnClient();
}
```

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

### 4.6 Dispatcher dual-channel : `lib/push/dispatcher.ts` (modifs ~20 LOC)

**Fichier** : `apps/web/src/lib/push/dispatcher.ts:387-405` fan-out étendu.

Pattern dual-channel coexistence (NOT migration full APN) :

- User installé Capacitor app + browser desktop = 2 endpoints (1 web + 1 apn) = 2 notifications (1 par device, comportement attendu UX)
- Logic dispatcher : `Promise.allSettled([web fan-out, apn fan-out])` parallèle
- Audit `push.notification.sent` carry `platform: 'web' | 'apn'` metadata

```typescript
// dispatcher.ts:387 (approximatif)
const [webResults, apnResults] = await Promise.allSettled([
  Promise.allSettled(webSubscriptions.map((sub) => webClient.send(sub.endpoint, webPayload))),
  Promise.allSettled(apnTokens.map((t) => apnClient.send(t.deviceToken, apnPayload))),
]);
```

Payload mapping per-platform : `buildPayload` switch ajouter branche APN format `{aps:{alert:{title,body},badge,sound}, type, id}` vs web `{web_push:8030, notification:{...}}`.

### 4.7 Env vars APN

**Fichier** : `apps/web/src/lib/env.ts:107-132` ajouts (~15 LOC) :

```typescript
APN_AUTH_KEY_P8: z.string().regex(/^[A-Za-z0-9+/=\s]+$/).optional()
  .describe('Base64-encoded .p8 APN auth key from Apple Developer'),
APN_KEY_ID: z.string().regex(/^[A-Z0-9]{10}$/).optional()
  .describe('10-char alphanumeric APN Key ID'),
APN_TEAM_ID: z.string().regex(/^[A-Z0-9]{10}$/).optional()
  .describe('10-char Apple Developer Team ID'),
APN_BUNDLE_ID: z.string().regex(/^[a-z]+\.[a-z]+\.[a-z]+$/).optional()
  .describe('Reverse-DNS bundle ID e.g. com.fxmily.app'),
APN_ENVIRONMENT: z.enum(['sandbox', 'production']).default('production'),
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

## 6. APNs `.p8` authentication key

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

## 11. Coût total année 1 Apple

| Poste                                                 | Coût USD     | Coût EUR (~) |
| ----------------------------------------------------- | ------------ | ------------ |
| Apple Developer Program (Individual OR Org)           | $99          | €99          |
| DUNS Number (si Organization)                         | $0 (gratuit) | €0           |
| Apple Sign in (optional)                              | $0           | €0           |
| Certificats + provisioning (inclus Developer Program) | $0           | €0           |
| TestFlight (inclus)                                   | $0           | €0           |
| App Store Connect API (inclus)                        | $0           | €0           |
| Push Notifications APNs (inclus)                      | $0           | €0           |
| iCloud / CloudKit (Fxmily n'utilise pas)              | $0           | €0           |
| Xcode Cloud 25h/mois (Fxmily peut s'en passer)        | $0           | €0           |
| **Total Apple année 1**                               | **$99**      | **€99**      |

**Hardware prerequisite TBD Eliot** : Capacitor iOS build **REQUIERT macOS + Xcode local**.

- Si Eliot a un Mac existant : 0 surcoût hardware
- Si pas de Mac : MacBook M2/M3 minimum (~€1100-1500) OU cloud Mac service (MacInCloud ~$30/mois = ~€330/an, MacStadium ~$80/mois = ~€880/an)

**Décision** : **vérifier auprès d'Eliot** s'il a un Mac avant Session T setup.

## 12. Calendar réaliste séquence multi-jalons §18.4

Estimation totale **8-11 semaines calendaires** (CAP-3 §16 + CAP-2 §15 arbitré WebView shell pattern) :

- Best case enrollment 48h + 0 rejection : **5-6 semaines**
- Realistic 2026 enrollment 2-4 sem + 1 rejection cycle fintech lane : **8-11 semaines**
- Worst case enrollment stuck + 2 rejections : **12-16 semaines**

### Séquence Sessions §18.4 atomic (10 jalons proposés)

| Session | Jalon                                                                                                         | Effort            | Type                   |
| ------- | ------------------------------------------------------------------------------------------------------------- | ----------------- | ---------------------- |
| **T**   | V2-A Enrollment Apple Developer + bundle ID design + Mac check Eliot                                          | 1-2h              | Ops + checks           |
| **U**   | V2-B Capacitor 8 setup minimal (`apps/mobile/` workspace + cap init + ios add + sync test simu)               | 1-2j              | Code (workspace setup) |
| **V**   | V2-C APN `.p8` génération + backend dispatcher dual-channel + nouvelle route + schema migration               | 2-3j              | Code multi-fichiers    |
| **W**   | V2-D Plugins 10 MVP integration + safe-area + status bar + splash polish iOS                                  | 1-2j              | Code                   |
| **X**   | V2-E Auth.js cookies SameSite=none override + cross-validation Capacitor flow                                 | 0.5j              | Code                   |
| **Y**   | V2-F Account deletion in-app verify + demo account `apple-review@fxmilyapp.com` provisioned                   | 0.5-1j            | Code + setup           |
| **Z**   | V2-G App Store assets (icon 1024×1024 + screenshots 1320×2868 6 unités + metadata)                            | 1-2j              | Design + content       |
| **AA**  | V2-H Privacy Manifests audit SDK tiers (Sentry + Firebase + Capacitor plugins) + Privacy Nutrition Labels ASC | 1-2j              | Audit + docs           |
| **BB**  | V2-I TestFlight beta cycle (internal 1-2 testers + external 5-10 membres formation)                           | 3-7j calendaires  | Ops + iterations       |
| **CC**  | V2-J App Store submission Notes for Review + suivi Apple review fintech lane (5-10j) + buffer rejection       | 7-21j calendaires | Ops + submission       |

### Activités parallèles dev/enrollment

Pendant attente enrollment Apple (1-4 sem) :

- Sessions U/V/W/X dev backend + Capacitor wrapper local
- Session Y account deletion + demo account
- Session Z assets preparation
- Session AA Privacy Manifests audit
- Au reçu enrollment OK → Bundle ID + APN key + TestFlight upload

## 13. Risks Fxmily-spécifiques (10 tabulés)

[tool-output CAP-3 §17 + CAP-1 §11] :

| Risk                                       | Probabilité                   | Impact                           | Mitigation                                                             |
| ------------------------------------------ | ----------------------------- | -------------------------------- | ---------------------------------------------------------------------- |
| Enrollment stuck >2 sem                    | Moyenne 2026 trend            | Bloque tout iOS                  | Enroll EARLY parallèle dev. Backup plan : web PWA stable V1.           |
| Misclassification fintech / Org required   | Moyenne                       | Rejection + Org migration        | Description App Store strict non-fintech (cf. §9.3)                    |
| Account deletion absente                   | Élevée si non-checké          | Rejection 5.1.1(v)               | Implémenter + tester avant submission (cf. §9.1)                       |
| Demo account manquant                      | Moyenne                       | Rejection 2.1                    | Demo user provisioned + Notes for Review (cf. §9.2)                    |
| AI disclosure tier compliance              | Faible (carbone Session R OK) | Rejection 5.1.2(i)               | `/legal/ai-disclosure` LIVE post-Session R + Monthly Debrief disclosed |
| iOS 26 SDK incompat Capacitor              | TBD                           | Bloque submission 28 avril 2026+ | Capacitor 8 confirmé compat 26 SDK                                     |
| Eliot pas Mac hardware                     | TBD info Eliot                | Bloque Capacitor iOS build local | MacBook achat OR cloud Mac service                                     |
| DUNS delay si Org                          | Moyenne                       | +5-15j enrollment                | Individual track preferred V1                                          |
| Cookie SameSite=lax cross-origin WebView   | Faible avec iosScheme:'https' | Auth broken WebView              | Override SameSite=none secure partitioned (§4.1)                       |
| Privacy Manifests SDK tiers manquants      | Moyenne 2026 trend rejection  | Rejection commune                | Audit exhaustif chaque SDK + Capacitor plugin (§8.4)                   |
| Seller name "Eliot Pena" vs "Fxmily" brand | Élevée si Individual          | UX brand inconsistency           | Trancher Individual vs Org AVANT 1ère submission                       |

## 14. Pré-requis blockers Eliot AVANT démarrage

[Récap actionnable post-Session T 2026-05-23] :

1. ✅ **Capacitor approuvé $99/an** (Session S clarification)
2. ✅ **Mac hardware OK** (Eliot confirmé Session T — pas de surcoût hardware, Xcode 26 installable App Store gratuit)
3. ✅ **Track Apple Developer = Individual** default (Session T décision tranchée §5.2, méta-délégation Eliot carte blanche + sub-agent due diligence) — caveat migration `transfer app` documenté §5.2
4. ✅ **Bundle ID `com.fxmily.app`** validé (Session T, reverse-DNS standard)
5. ⚠️ **iPhone physique** smoke test APN sandbox — push ne fonctionne PAS sur simulateur, requis Session BB TestFlight beta cycle (à confirmer Eliot d'ici Session BB)
6. ✅ **Push channel = Direct APN HTTP/2** via `@parse/node-apn` + plugin Capacitor `@capacitor/push-notifications` natif (Session T décision tranchée §6.4 — reverse drift CAP-2 sur plugin Firebase Messaging)
7. ⚠️ **Demo account credentials** : `apple-review@fxmilyapp.com` + password généré + données mock provisioned (Session Y, post-enrollment Apple)

**Pré-requis externes Eliot manuel post-Session T** (1-4 sem parallèle dev Capacitor) :

- Enrollment Apple Developer Program Individual track via `developer.apple.com/programs/enroll/` (~10 min UI Apple ID + 2FA + pièce d'identité ID gov FR passeport/CNI)
- Budget tampon enrollment 2-4 semaines (réalité 2026 vs 24-48h Apple official)
- Sessions U..CC parallélisables pendant attente enrollment (dev Capacitor V2-B setup + V2-C APN dispatcher + V2-D plugins + V2-E auth cookies + V2-F account deletion + V2-G assets + V2-H Privacy Manifests audit)

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
