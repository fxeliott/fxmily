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

## Fichiers de référence

- `D:\Fxmily\SPEC.md` (source de vérité produit)
- `D:\Fxmily\apps\web\CLAUDE.md` (sections close-out J0 → J10)
- `D:\Fxmily\docs\runbook-hetzner-deploy.md` (provisioning + ops)
- `D:\Fxmily\docs\runbook-backup-restore.md` (DR procedures)
- `D:\Fxmily\docs\runbook-prod-smoke-test.md` (12-step smoke V1)
- `C:\Users\eliot\.claude\projects\D--Fxmily\memory\fxmily_project.md`
  (état projet avec timeline jalons)
