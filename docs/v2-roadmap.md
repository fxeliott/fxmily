# V2 Roadmap — post-J10

> Préparé 2026-05-09 en clôture du Jalon 10. À relire ensemble une fois le
> smoke prod (Phase F du J10) validé sur `app.fxmily.com`.

## V1 = ship

À ce stade :

- Code J0 → J10 mergé sur `main`.
- Stack prod (`app.fxmily.com`, Hetzner CX22, Caddy, Postgres 17) opérationnelle.
- Cohorte cible 30 → 100 membres invités.
- Coût récurrent ~10-15€/mois (cf. SPEC §16).
- Pas d'audio nulle part. Pas de tracker. Pas d'API payante consommée par
  défaut (Anthropic Live activable manuellement).

Avant tout V2 : laisser tourner V1 quelques semaines, observer les vrais
patterns d'usage, écouter les retours des premiers membres réels.

## J10.5+ — Polish post-V1 (1-2 semaines, rolling)

Items reclassés des audits J10 (Phase G) qui ne bloquaient pas SPEC §15 J10
mais valent la peine d'être traités avant que la cohorte grandisse :

- **Rate-limit `/api/account/data/export`** par userId (token bucket per
  user) — anti-spam DB load à 1000+ membres.
- **Rate-limit `/monitoring` Sentry tunnel** — DoS du quota free 5000
  errors/mois.
- **Atomic update `requestAccountDeletion`** (`UPDATE WHERE deletedAt IS
NULL` au lieu de `findUnique` + `update` séparés) — race-free.
- **Skip-link global** `<a href="#main">` + `id="main"` sur `<main>` —
  WCAG 2.4.1.
- **`<Code>` component** extracted (3 endroits dupliquent les mêmes classes).
- **`role="alert"`** au lieu de `role="status"` pour les error regions
  (assertive plus appropriée).
- **CookieBanner transition** d'apparition (opacity 200ms `--e-smooth`).
- **CSP nonces** — passer de `'unsafe-inline'` à un nonce-based strict CSP.
  Refactor `proxy.ts` pour générer un nonce par requête + `headers()` côté
  layouts.
- **Annual DR test** documenté + automatisé (RTO objectif < 24h).

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
