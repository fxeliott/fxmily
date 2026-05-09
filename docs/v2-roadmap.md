# V2 Roadmap — post-J10

> Préparé 2026-05-09 en clôture du Jalon 10. À relire ensemble une fois le
> smoke prod (Phase F du J10) validé sur `app.fxmilyapp.com`.

## V1 = ship

À ce stade :

- Code J0 → J10 mergé sur `main`.
- Stack prod (`app.fxmilyapp.com`, Hetzner CX22, Caddy, Postgres 17) opérationnelle.
- Cohorte cible 30 → 100 membres invités.
- Coût récurrent ~10-15€/mois (cf. SPEC §16).
- Pas d'audio nulle part. Pas de tracker. Pas d'API payante consommée par
  défaut (Anthropic Live activable manuellement).

Avant tout V2 : laisser tourner V1 quelques semaines, observer les vrais
patterns d'usage, écouter les retours des premiers membres réels.

## J10.5+ — Polish post-V1 (1-2 semaines, rolling)

> **Update 2026-05-09 — Phase P close-out.** Plusieurs items initialement
> listés ici ont été ramenés dans J10 par les Phases I → P. La liste
> ci-dessous reflète **uniquement** ce qui reste réellement ouvert post-V1.
> Voir `apps/web/CLAUDE.md` §J10 Phases L→P pour le détail des items
> promus.

**Items réellement ouverts post-V1** :

- **CSP nonces** — passer de `'unsafe-inline'` à un nonce-based strict CSP.
  Refactor `proxy.ts` (edge runtime) pour générer un nonce par requête +
  `headers()` côté layouts. Reclassé V2 post-Phase O (refactor non-trivial,
  pas urgent en l'absence d'XSS connue).
- **JWT `tokenVersion` révocation immédiate** — actuellement un user
  suspended/deleted garde un JWT valide jusqu'à `maxAge` 30j (la Phase P
  status gate global force re-login mais c'est une protection edge
  middleware uniquement). `tokenVersion: Int` sur `User` + comparaison
  dans le `session()` callback fait que logout/password-reset incrémente
  la version → tous les JWTs précédents invalidés instantanément.
- **Login rate-limit credential-stuffing** — `/api/auth/callback/credentials`
  - Server Action `signInAction` pas rate-limités. À ajouter
    `loginLimiter = new TokenBucketLimiter({ bucketSize: 5, refillRate:
1/60 })` keyé sur `email.toLowerCase()` ET `callerId(req)` AVANT le
    `signIn()` argon2 (~150 ms par check).
- **`auditLog` retention 90j** — table peut dominer write IOPS sur Hetzner
  CX22 (4 GB box) à >1000 membres × ~5 notifs/j × ~3 audit rows. Cron
  `cron.purge_audit_log` aligné sur `purge-deleted` pattern.
- **Service Worker offline strategy** — `public/sw.js` est push-only. Si
  on veut promettre "offline-first" PWA dans le marketing, ajouter un
  fetch handler avec workbox/strategy.
- **`listMemberTradesAsAdmin` cursor pagination** — `take: 100` cap silent
  data loss past 100 trades. OK pour V1 30-membres mais à câbler avant
  cohorte 100+.
- **Annual DR test** documenté + automatisé (RTO objectif < 24h).

**Items déjà livrés J10 Phases I → P** (ne plus les listr ici) :

- ✅ Atomic `requestAccountDeletion` + `cancelAccountDeletion` (Phase I + L).
- ✅ Per-user rate-limit `/api/account/data/export` (Phase I).
- ✅ `sentryTunnelLimiter` exporté + documenté (Phase I — wiring V2).
- ✅ Skip-link global `#main-content` (Phase I).
- ✅ `<Code>` component extracted (Phase I).
- ✅ `role="alert"` form error regions (Phase I).
- ✅ CookieBanner entry transition (Phase I).
- ✅ Hierarchy h2 legal pages (Phase I).
- ✅ EmptyState/ErrorState `headingLevel` prop (Phase P).
- ✅ Schemas sanitization bidi/zero-width auth+trade+annotation (Phase P).
- ✅ Auth status='active' gate global proxy (Phase P).
- ✅ `app/global-error.tsx` Next 16 root-layout catch (Phase P).

## V2 — features (selon priorité Eliot)

Trois directions possibles, pas mutuellement exclusives :

### A. Capacitor + App Store / Play Store

> SPEC §17 et §18.4 : Eliot voulait Capacitor V2 dès le départ pour avoir
> Fxmily dans les stores natifs.

- **Coût** : Apple Developer 99 €/an, Google Play 25 € one-shot.
- **Refactor** requis : `output: 'export'` Next.js (incompatible avec les
  Server Actions actuels — cf. SPEC §17 ⚠️). Options :
  1. **REST custom** pour les Server Actions → routes `/api/*` (rewrite
     ~30 endpoints, ~3-5 jours).
  2. **Trunk-based** : 2 builds (`web` standalone + `mobile` static export
     ciblant un subset des features). Plus de surface à maintenir mais
     préserve les Server Actions web.
- **Stores reviewers** vont demander : politique de confidentialité (✓ J10),
  CGU (✓ J10), comptes de test, screenshots, vidéo demo.
- **Push iOS Capacitor** : différent du Web Push J9 (APNs natif via Capacitor
  Push plugin). Refactor du dispatcher requis.

Effort estimé : **3-4 semaines** dont 1 semaine APN/Capacitor.

### B. Stripe billing (formation in-app)

> SPEC v1.0 §11 : Eliot envisageait formation gratuite V1, payante V2.

- **Coût Stripe** : 1.4 % + 0.25 € par transaction EU (CB), 2.9 % + 0.25 €
  hors EU.
- **Modèles** : abonnement mensuel (récurrent) ou one-shot (formation
  packagée). Eliot tranchera.
- **Schéma** : table `Subscription` + relation `User` ; webhooks
  `checkout.session.completed`, `customer.subscription.updated`,
  `invoice.paid`, `customer.subscription.deleted`.
- **Gating** : middleware sur les routes `/journal/*`, `/checkin/*`,
  `/library/*` selon `user.subscription.status`.
- **Email** : factures via Stripe (pas Resend), notification expiration via
  Resend (pattern J4 carbone).
- **RGPD** : Stripe est sous-traitant — ajouter à `/legal/privacy` §5.

Effort estimé : **2 semaines** + 1 semaine de smoke + tests réels TVA EU.

### C. Multi-admin (Eliot + co-coachs)

> SPEC v1.0 §6.9 : un seul admin V1 (Eliot). V2 si la formation grandit.

- **Schéma** : `User.role` enum élargi (`admin` → `admin` + `coach` +
  `super_admin`).
- **Permissions** : `coach` voit ses membres assignés, `admin` voit tout,
  `super_admin` (Eliot) gère les rôles.
- **Audit** : rotation `admin.role.changed` action.
- **Invitation flow** : actuel ne distingue pas role — étendre.

Effort estimé : **1-1.5 semaine**.

## Décisions à trancher avec Eliot post-V1

1. **Quel V2 prioritaire** — A (Capacitor stores), B (Stripe), C (multi-admin) ?
2. **Métriques V1 à observer** avant V2 — engagement quotidien, rétention 30j,
   trades/jour, fiches Mark Douglas vues, score moyen progression, plaintes /
   demandes RGPD, erreurs Sentry, latence cron weekly-reports.
3. **Tarif éventuel** si Stripe V2 — à valider avec la base actuelle.
4. **Publication App Store** — décider en fonction de la traction (30 →
   100 membres réels, pas hypothétiques).
5. **Multi-coach** — décider si la formation Fxmily évolue vers une
   co-équipe.

## Non-scope V2 (raisons documentées)

- **Read-replicas Postgres** : à 1000+ membres seulement.
- **WAF Cloudflare proxy** : à activer si traffic public ou attaque ciblée
  observée. Pas par défaut (HSTS preload + double-TLS = casse-tête).
- **Multi-region deploy** : Hetzner UE seul suffit V2. Considérer si UE
  → US/Asia members > 30 % de la cohorte.
- **Audio coaching** : ❌ refus permanent (préférence Eliot stricte —
  memory `feedback_no_audio`).
- **Ads** : ❌ jamais — posture éducative cohorte fermée (SPEC §2).
- **Public landing marketing** : peut venir mais hors-scope V2 backend.

## Process de release V2

1. **`/clear`** + nouvelle session sur le **bon jalon** (pas tout-en-un).
2. **`/spec`** ou audit incrémental du SPEC.md → v1.2 puis v1.3.
3. **Audit canon** post-implementation (5 subagents parallèles) — pattern
   Fxmily depuis J5.
4. **Migration test DR** avant release publique.
5. **PR — rebase merge** pour préserver commits granulaires.

## Findings recherche web 2026-05-09 (deep-research subagent)

> Subagent recherche web parallèle au close-out J10 Phase ω. 8 verdicts
> sourcés. À intégrer aux décisions V2 quand pertinent.

### Stack patches (pas d'action V2, juste tracking)

- **Next.js 16.2.6** — patché 12 advisories 16.2.4 → 16.2.5 (mai 2026)
  incluant CVE-2025-66478 RCE (CVSS 10.0, App Router) et CVE-2026-23864
  DoS (CVSS 7.5). Fxmily à jour. Surveiller blog mensuel
  <https://nextjs.org/blog>.
- **React 19.2.6** — CVE-2026-23864 DoS RSC patché. Fxmily à jour.
- **Prisma 7.8.0** — bug Postgres 17 P1010 SSL connu. Workaround :
  `ssl: { rejectUnauthorized: false }` ou `NODE_EXTRA_CA_CERTS`. À tester
  explicit en smoke prod (Hetzner local socket = peut-être OK sans SSL).

### Auth.js v5 → migration Better Auth (V2 Q3 2026)

**Fact** : Auth.js a rejoint Better Auth en septembre 2025 ([annonce
GitHub #13252](https://github.com/nextauthjs/next-auth/discussions/13252)).
Le maintainer principal Balázs Orbán a quitté en janvier 2025. Auth.js v5
reste en beta indéfiniment, patchs sécurité uniquement.

**Décision V1** : pin sur `5.0.0-beta.31` (ou la beta la plus récente).
Pas de migration urgente — l'API v5 est stable suffisamment pour Fxmily
V1.

**Décision V2 (Q3 2026)** : évaluer migration Better Auth. Avantages :

- Maintainer actif, releases stables.
- Architecture plug-in plus moderne (vs callbacks Auth.js).
- Better TypeScript inference.

Inconvénients :

- Migration script Auth.js → Better Auth pas trivial (sessions DB,
  argon2 hash compatible, Prisma adapter différent).
- Risque de re-écriture de `auth.config.ts` + `auth.ts` complets.

**Effort estimé migration V2** : ~1 semaine (refactor auth + tests E2E

- smoke prod).

### Bugsink — alternative self-hosted à Sentry cloud (V2 candidate)

**Sentry self-hosted écarté pour CX22** : minimum 8 GB RAM (Postgres + Redis

- Kafka + ClickHouse + Relay) — incompatible avec un CX22 partagé.

**Alternative léger 2026** : [Bugsink](https://www.bugsink.com/) — single
Docker container, SDK Sentry-compatible (drop-in replacement
`@sentry/nextjs`), peut **réutiliser le Postgres 17 existant** sur
`hetzner-dieu`.

**Décision V2 candidate** : si on veut sortir de Sentry cloud (RGPD strict
ou quota free 5000 events/mois dépassé), migrer vers Bugsink. Effort
estimé : ~4h (provisioner Bugsink container + reverse proxy Caddy +
update `SENTRY_DSN` env). Le code applicatif ne change pas.

**Alternatives considérées** :

- [GlitchTip](https://glitchtip.com) — comparable à Bugsink, Django stack.
- [SigNoz](https://signoz.io) — OTel-native + traces distribuées
  (over-kill pour Fxmily V2, V3 si scale).
- [PostHog free tier](https://posthog.com) — 100k errors/mo, zero-ops
  alternative cloud (mais vendor lock).

**Sources** : [Security Boulevard 2026](https://securityboulevard.com/2026/04/best-sentry-alternatives-for-error-tracking-and-monitoring-2026/) · [SigNoz alternatives 2026](https://signoz.io/comparisons/sentry-alternatives/)

### Apple Declarative Web Push — bonus iOS 26

**Confirmation 2026** : iOS 26 ouvre les sites Home Screen en standalone
**par défaut**, même sans manifest. Fxmily aura donc une UX améliorée pour
les nouveaux users sur iOS 26+. Pas d'action requise — déjà géré par
`detectStandalone()` côté client.

**Sources** : [WWDC25 Session 235 — Declarative Web Push](https://developer.apple.com/videos/play/wwdc2025/235/) · [MobiLoud PWA iOS 2026](https://www.mobiloud.com/blog/progressive-web-apps-ios)

### Calibration scoring — pas d'empirique 2024-2026

**Recherche web confirme** : aucun papier peer-reviewed 2024-2026 ne
valide les constantes scoring Fxmily (`STDDEV_FULL_SCALE=4`,
`EXPECTANCY_FULL_SCALE=1`, etc.). Les sources Tharp + Steenbarger sont
qualitatives, pas mesurées.

→ **Décision capturée dans [ADR-001](decisions/ADR-001-scoring-constants-pragmatic-heuristics.md)**.
Les constantes sont des heuristiques pragmatiques, à recalibrer post-cohorte
(30+ membres × 3+ mois).

### iOS Web Push fragility — fallback email §18.2 confirmé optimal

**2026 update** : pas de silent push, pas de Background Sync / Periodic /
Background Fetch sur iOS. `event.waitUntil(showNotification)` obligatoire
(Fxmily ✅ ligne 151 sw.js). Permission denied → réinstall PWA only.

→ Le fallback email Resend après 3 attempts (J9 round 3) reste la bonne
stratégie. **V1.5 candidate** : ajouter monitoring delivery rate
(audit row `notification.delivery_rate.snapshot` chaque semaine) pour
détecter les unsub silencieux.

---

## Fichiers de référence

- `D:\Fxmily\SPEC.md` (source de vérité produit)
- `D:\Fxmily\apps\web\CLAUDE.md` (sections close-out J0 → J10)
- `D:\Fxmily\docs\decisions\ADR-001-scoring-constants-pragmatic-heuristics.md`
- `D:\Fxmily\docs\jalon-V1.5-prep.md` (briefing post-merge J10)
- `D:\Fxmily\docs\runbook-hetzner-deploy.md` (provisioning + ops)
- `D:\Fxmily\docs\runbook-backup-restore.md` (DR procedures)
- `D:\Fxmily\docs\runbook-prod-smoke-test.md` (12-step smoke V1)
- `C:\Users\eliot\.claude\projects\D--Fxmily\memory\fxmily_project.md`
  (état projet avec timeline jalons)
- `C:\Users\eliot\.claude\projects\D--Fxmily\memory\fxmily_session_2026-05-09_smoke_prep_consolidated.md`
  (consolidé fin J10 + 8 verdicts recherche web 2026)
