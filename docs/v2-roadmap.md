# V2 Roadmap — post-V2.3 + extensions analytics+correlation SHIPPED

> Préparé 2026-05-09 en clôture du Jalon 10. Resynchronisé 2026-05-21 post-Sprint 1
> (audit V1.5 pré-V2 fermé, séquence §21.6 close, V2.1.6 LIVE prod).
> **Resynchronisé 2026-05-27 post-pipeline EE→II SHIPPED** (V2.3 base + V2.3.1
> hardening + V2.3.2 nits + Session GG E2E + Session HH analytics + Session II
> correlation = différenciateur Fxmily LIVE prod commit `4dd8616`).
>
> - V2.3 + extensions LIVE prod + pipeline auto-pilote DD→MM **6/10 SHIPPED**.
>   La section "V1 + V2 = ship" liste désormais V1 + V2 SHIPPED. Les items "ouverts post-V1"
>   sont annotés du statut actuel (LIVE / partial / ouvert).

## V1 + V2.x = ship (état 2026-05-27)

À ce stade :

- Code J0 → J10 + V1.5 → V1.12 + V2.0 → V2.1.6 + V2.2 + séquence §21.6 (3 jalons LIVE
  - 1 placeholder UI) + **T5 admin track-record split-out (#172) + V2.3 pre-trade
    circuit breaker ADR-003 (#178) + V2.3.1 hardening 3-fix (#179) + V2.3.2 nits
    cleanup (#181) + Session GG E2E `/pre-trade/new` (#182) + Session HH pre-trade
    analytics 30j (#184 backend + #185 frontend) + Session II pre-trade × outcome
    correlation différenciateur Fxmily (#186 backend + #187 frontend LIVE prod
    `4dd8616`)** mergé sur `main`.
- Stack prod (`app.fxmilyapp.com`, Hetzner CX22, Caddy, Postgres 17) opérationnelle,
  derniers deploys Hetzner SUCCESS (Session II frontend 2026-05-27T08:15:35Z).
- Cohorte cible 30 → 100 membres invités.
- Coût récurrent ~10-15€/mois (cf. SPEC §16).
- Pas d'audio nulle part. Pas de tracker. **Aucune API Anthropic payante consommée** :
  V1.7.2 a pivoté en batch local Claude Max only (canon dur §25.7 / SPEC :1237).
- **Vitest baseline 1547/1547 verts** (post-pipeline EE→II, 95 files) ; **Playwright
  19 specs E2E** (auth-gate + 4 happy-path J5/J6/V1.5/V2.3) ; cron-watch hourly green.
- Audit qualité V1.5 pré-V2 fermé (Sprint 1, 3 TIER 1 résolus : brace-expansion CVE-2026-45149 #141,
  Recharts dynamic split #142, Dependabot TIER 1 batch #119/#120/#122).
- **Pipeline auto-pilote Sessions DD→MM** : **6/10 SHIPPED** (DD #179 hardening + EE #180
  drift resync + FF #181 nits cleanup + GG #182 E2E `/pre-trade/new` + HH #184+#185
  pre-trade analytics 30j + II #186+#187 correlation différenciateur Fxmily LIVE prod).
  **4 restantes** : JJ (Mark Douglas card auto-delivery trigger — 5 `fomo` 7d → fiche
  peur-de-rater) → KK (EmptyState DS adoption `/review` + `/reflect`) → LL (admin
  tab `/admin/members/[id]?tab=pre-trade` vue pseudonymisée) → MM (JWT `tokenVersion`
  Int + Auth.js session callback révocation immédiate).
- **Décisions d'âme M1-M10** : 10/10 closed verbatim Eliot 2026-05-27 — M4/M5/M6
  LIVRÉS V1.7-V1.8 ; **M3** (interview profilage IA deep + chacun à son profil) +
  **M8** (promesse 12 sem = tracker max data via QCM/tests récurrents auto-rapport,
  Mark Douglas psycho only) = **directives neuves à implémenter pipeline futur** ;
  M1/M2/M7/M9/M10 = out-of-scope app (interne, projet Scale séparé).

Avant tout V2 stratégique (Capacitor / Stripe / multi-admin) : finir pipeline DD→MM
(JJ/KK/LL/MM) + câbler M3 onboarding interview IA + M8 axes 3+4 (formation + market
analysis tracking). Observer les vrais patterns d'usage (distribution `reasonToTrade`
30j post-Session HH + correlation per-reason post-Session II), écouter les retours
des premiers membres réels.

## J10.5+ — Polish post-V1 (rolling)

> **Update 2026-05-22 (Session N audit drift resync) — post-Sprint 1 + V1.12 P3.**
> La liste ci-dessous reflète ce qui reste ouvert post-V1.12 P4. Plusieurs items
> initialement listés 2026-05-09 ont été partiellement ou totalement livrés en
> V1.6 Phase R / V1.10 / V1.11 / V1.12. Session N audit (4 sub-agents parallèles
> tool-confirmed grep) a reclassé 2 items ✅ LIVRÉ COMPLET : login rate-limit
> credential-stuffing (V1.12 P3, email + IP côtés câblés) + auditLog retention 90j
> (V1.6 Phase R, code + cron route + crontab Hetzner). Voir `apps/web/CLAUDE.md`
> § V1.6 Phase R / V1.10 sec hardening / V1.11 5-phase batch / V1.12 P1-P4 pour
> les détails livrés.

**Items réellement ouverts post-V2.1.6** :

- **CSP nonces** — passer de `'unsafe-inline'` à un nonce-based strict CSP.
  Refactor `proxy.ts` (edge runtime) pour générer un nonce par requête +
  `headers()` côté layouts. Reclassé V2 (refactor non-trivial, pas urgent
  en l'absence d'XSS connue). **Statut 2026-05-21 : ouvert.**
- **JWT `tokenVersion` révocation immédiate** — actuellement un user
  suspended/deleted garde un JWT valide jusqu'à `maxAge` 30j (la Phase P
  status gate global force re-login mais c'est une protection edge
  middleware uniquement). `tokenVersion: Int` sur `User` + comparaison
  dans le `session()` callback fait que logout/password-reset incrémente
  la version → tous les JWTs précédents invalidés instantanément.
  **Statut 2026-05-21 : ouvert.**
- **Login rate-limit credential-stuffing** — ✅ **LIVRÉ COMPLET V1.12 P3.**
  Double-key câblé dans `authorize()` AVANT `signIn()` argon2 (~150 ms par check) :
  `loginEmailLimiter.consume(email.toLowerCase())`
  (`apps/web/src/lib/auth/authorize-credentials.ts:135`) + `loginIpLimiter.consume(ip)`
  (ibid `:155`). Closes bypass POST direct `/api/auth/callback/credentials`.
  Cf. `apps/web/CLAUDE.md` §V1.12 P3. **Statut 2026-05-22 : LIVE prod (email + IP
  côtés tous deux fermés, reclassé Session N audit).**
- **`auditLog` retention 90j** — ✅ **LIVRÉ V1.6 Phase R (2026-05-09).**
  `apps/web/src/lib/audit/cleanup.ts` (`RETENTION_DAYS=90`, batch 5000, two-step
  find→deleteMany) ; cron HTTP `/api/cron/purge-audit-log` (SHA-256 +
  `timingSafeEqual` CWE-208 + token bucket + audit row `cron.purge_audit_log.scan`) ;
  crontab Hetzner `0 4 * * * fxmily /usr/local/bin/fxmily-cron purge-audit-log`
  (`ops/cron/crontab.fxmily:59`, daily 04:00 UTC, 1h après purge-deleted) ;
  9e expectation `getCronHealthReport`. **Statut 2026-05-22 : LIVE prod (reclassé
  Session N audit, table dimensionnement OK <1000 membres actuel).**
- **Service Worker offline strategy** — `public/sw.js` est push-only. Si
  on veut promettre "offline-first" PWA dans le marketing, ajouter un
  fetch handler avec workbox/strategy. V1.11 a juste fixé le fallback iOS
  subscription revoke (`apps/web/CLAUDE.md` §V1.11). **Statut 2026-05-21 :
  ouvert (offline-first non câblé).**
- **`listMemberTradesAsAdmin` cursor pagination** — `take: 100` cap silent
  data loss past 100 trades. OK pour V1 30-membres mais à câbler avant
  cohorte 100+. **Statut 2026-05-21 : ouvert.**
- **Annual DR test** — runbook `runbook-backup-restore.md` §6 documente le
  workflow manuel (~30 min/an, RTO objectif <24h). Automatisation reste à câbler.
  **Statut 2026-05-21 : runbook docs ✓, exécution annuelle ouverte.**
- **ESLint 9→10 — blocked-upstream Q2 2026.** Dependabot PR
  [#6](https://github.com/fxeliott/fxmily/pull/6) bloquée par
  `eslint-plugin-react@7.37.5` incompat ESLint 10 API
  (`context.getFilename()` retirée). Upstream fix
  [`jsx-eslint/eslint-plugin-react#3979`](https://github.com/jsx-eslint/eslint-plugin-react/pull/3979)
  OPEN avec requested changes (bloqué dep externe
  [`import-js/eslint-plugin-import#3230`](https://github.com/import-js/eslint-plugin-import/issues/3230)).
  Aucune EOL annoncée pour ESLint 9, 0 CVE bloquant. CI breakage empirique
  confirmé (run `26221562493` job `Lint, type-check, build` FAILURE
  2026-05-21). **Statut 2026-05-22 : ouvert, label `blocked-upstream`,
  monitoring `eslint-plugin-react@8.x` release.**

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

## V2 déjà LIVRÉ post-V1 (chronologique, état 2026-05-21)

Les jalons V2 suivants sont LIVE prod sur `app.fxmilyapp.com` (deploy auto Hetzner sur push main non-docs). Ne sont **PAS** des candidats roadmap mais l'état actuel des features V2 déployées :

- **V2.0 HabitLog backend** (2026-05-14) — Prisma `HabitLog` 5 kinds
  `sleep/nutrition/caffeine/sport/meditation` + service + 32 tests.
- **V2.1.0 / V2.1.1 TRACK frontend + wizards** (2026-05-15, PR #93 / #94) — landing
  `/track` + 5 wizards habit.
- **V2.1.2 DS 4-pt grid** (2026-05-16, PR #98) — dette `T3-3` repo-wide flag
  ui-designer.
- **V2.1.3 Habit×Trade correlation** (2026-05-16, PR #97) — pairing
  `localDateOf(enteredAt, 'Europe/Paris')` (jour décision), filter
  `realizedRSource='computed'`, pas d'IC sur `r` (Wilson = CI proportion, pas
  Pearson), tier `confidence: low|adequate`.
- **V2.1.4 Log express FAB** (2026-05-16, PR #100) — FAB dashboard global,
  `habit-kinds.ts` SoT 5 piliers (PAS de `useSession`/`SessionProvider`, vérifié
  correct par Grep + code-reviewer).
- **V2.1.5 TrackHero premium** (2026-05-15/16, PR #95/#96) — design premium TrackHero.
- **V2.1.6 Placeholder formation** (2026-05-20, PR #140) — slot UI "À venir"
  séquence §21.6 jalon #4 (suivi-formation/cursus build complet via `/spec` dédié
  ultérieur).
- **V2.2 correlation 5-kinds** (2026-05-16, PR #102) — 5 types corrélation
  habit×trade.

Séquence §21.6 (4 jalons verrouillés 2026-05-18) :

| #   | Nom                                                      | SPEC                       | Statut                | PR                                    |
| --- | -------------------------------------------------------- | -------------------------- | --------------------- | ------------------------------------- |
| 1   | Débrief Training dédié                                   | §23 (V1.3)                 | LIVE 2026-05-18       | #131 + #132 (`f48cde4`)               |
| 2   | Débrief Mensuel IA                                       | §25 (V1.4)                 | LIVE 2026-05-19       | #134 + #135 (`3603954`)               |
| 3   | QCM athlète Mindset (zéro IA, instrument figé versionné) | §27 (V1.5)                 | LIVE 2026-05-19       | #136 + #137 (`82723d8`)               |
| 4   | Suivi-formation/cursus                                   | À cadrer `/spec` ultérieur | PLACEHOLDER UI V2.1.6 | #140 (placeholder) + #139 (defer doc) |

## V2 stratégique — features candidates (selon priorité Eliot)

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

### 🚨 P0 — RGPD Anthropic Claude API : décision avant la 1ère cohorte payante

**Source** : deep-research subagent RGPD 2026-05-09 (CNIL + Légifrance + AMF + Anthropic GDPR docs).

**Constat** : Anthropic API directe = transferts US par défaut. Le rapport hebdo IA
(Sonnet 4.6) envoie le `WeeklySnapshot` du membre — counters anonymisés via
`memberLabel` (V1.5 commit `52d4671`) MAIS journal excerpts + emotion tags
restent dans le payload.

**Choix V2 (à trancher avant 1er rapport prod incluant données membres)** :

- **Option A — API directe US** : conserver `@anthropic-ai/sdk` actuel
  - DPA Anthropic effective 1er janvier 2026 + SCCs incluses + ISO 42001/SOC 2.
    **Action obligatoire** : documenter un TIA (Transfer Impact Assessment) +
    minimisation explicite (pseudonymisation déjà faite via memberLabel).
- **Option B — AWS Bedrock Frankfurt EU** : route Anthropic Claude via Bedrock
  EU. Avantage : résidence EU stricte, pas de TIA US à documenter. Inconvénient :
  coût plus élevé (~+30 %) + refactor `lib/weekly-report/claude-client.ts`
  pour passer par AWS SDK + `@aws-sdk/client-bedrock-runtime`.

**Recommandation** : **Option A pour V1**, escalader Option B en V2 si la
cohorte dépasse 100 membres ou si CNIL inspecte. La pseudonymisation V1.5
(`memberLabel`) couvre déjà la minimisation requise par l'Art. 28 GDPR.

### 🚨 P0 — Politique de Confidentialité Art. 13 RGPD

Page `/legal/privacy` à finaliser AVANT 1ère invitation cohorte payante. Doit
inclure :

- Finalités du traitement (suivi comportemental + coaching psychologique).
- Bases légales (contrat de formation = exécution).
- Durées de rétention par catégorie (auth = durée relation, comptabilité = 10
  ans Code commerce, prospects = 3 ans dernier contact actif — CNIL délib.
  n°2021-130).
- Sous-traitants listés : Anthropic (rapport IA), Resend (email), Cloudflare
  R2 (stockage médias), Sentry (monitoring), Hetzner (hébergement).
- Droits RGPD (accès, rectification, effacement, portabilité, opposition).
- Contact DPO (à nommer si cohorte > 250 membres ou traitement à grande échelle).

### 🟢 Hors scope confirmé (recherche RGPD 2026-05-09)

- **AML6 + DAC8** : 🟢 hors scope tant que Fxmily reste service éducatif sans
  paiement crypto direct.
- **MiFID II** : 🟢 hors scope — Fxmily ne fournit aucun service d'investissement
  au sens Annexe I (pas de réception/transmission/exécution d'ordres).
- **DSA VLOP** : 🟢 hors scope — seuil 45M MAU UE, Fxmily ~1000 membres max V2.

### ⚠️ Loi influenceurs 2023 / décret 30 mars 2026 (CPF)

Si promo externe de Fxmily via finfluenceur :

- Contrat écrit obligatoire dès **1 000 € HT** (décret 28 nov 2025, en vigueur
  1er janv 2026).
- Si formation **financée CPF** ET promue via influenceur → mention "financement
  public" 90 % durée + 7 % espace écran + lien hypertexte (décret n°2026-233
  du 30 mars 2026).
- Si Fxmily auto-financée par membres uniquement → ce volet ne s'applique
  pas.

### Citation Mark Douglas L122-5 CPI

Pas de seuil quantitatif fixe en jurisprudence FR récente (2024-2026 — la Cour
apprécie _in concreto_). Règle de prudence Fxmily : ≤30 mots/citation +
finalité pédagogique explicite + attribution complète :
_Mark Douglas, Trading in the Zone, Prentice Hall Press (Penguin Publishing
Group), 2000_. Escalade avocat PI recommandée avant batch publications
commerciales régulières.

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
`fxmily-prod`.

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
`EXPECTANCY_FULL_SCALE=1`, `PF_FULL_SCALE=3`, `DD_FULL_SCALE=15`). Les sources
Tharp + Steenbarger sont qualitatives, pas mesurées.

→ **Décision V1 capturée dans [ADR-001](decisions/ADR-001-scoring-constants-pragmatic-heuristics.md)**
(Accepted 2026-05-09). Les constantes sont des heuristiques pragmatiques.

→ **Proposition V2 capturée dans [ADR-002](decisions/ADR-002-v2-calibration-prop-firm-empirical.md)**
(Proposed 2026-05-09). Recommandations prop-firm empirique 2024-2026 : `STDDEV 4→2.5`,
`EXPECTANCY 1 R keep`, `PF 3→2.5`, `DD 15→10 R`. À accepter en V2 après observation
de la cohorte V1 ≥30 membres × ≥3 mois (trigger : si 80%+ cohorte <30 ou >70 sur
une dimension, recalibration).

### iOS Web Push fragility — fallback email §18.2 confirmé optimal

**2026 update** : pas de silent push, pas de Background Sync / Periodic /
Background Fetch sur iOS. `event.waitUntil(showNotification)` obligatoire
(Fxmily ✅ ligne 151 sw.js). Permission denied → réinstall PWA only.

→ Le fallback email Resend après 3 attempts (J9 round 3) reste la bonne
stratégie. **Reclassé V2.x** (V1.5 LIVE depuis 2026-05-09, candidate
historique non-livrée) : ajouter monitoring delivery rate (audit row
`notification.delivery_rate.snapshot` chaque semaine) pour détecter les
unsub silencieux. Statut 2026-05-21 : ouvert, faible priorité tant que
cohorte <100 membres.

---

## Fichiers de référence

- `D:\Fxmily\SPEC.md` (source de vérité produit)
- `D:\Fxmily\apps\web\CLAUDE.md` (sections close-out J0 → J10)
- `D:\Fxmily\docs\decisions\ADR-001-scoring-constants-pragmatic-heuristics.md`
- `D:\Fxmily\docs\archive\jalon-V1.5-prep.md` (briefing post-merge J10)
- `D:\Fxmily\docs\runbook-hetzner-deploy.md` (provisioning + ops)
- `D:\Fxmily\docs\runbook-backup-restore.md` (DR procedures)
- `D:\Fxmily\docs\runbook-prod-smoke-test.md` (12-step smoke V1)
- `C:\Users\eliot\.claude\projects\D--Fxmily\memory\fxmily_project.md`
  (état projet avec timeline jalons)
- `C:\Users\eliot\.claude\projects\D--Fxmily\memory\fxmily_session_2026-05-09_smoke_prep_consolidated.md`
  (consolidé fin J10 + 8 verdicts recherche web 2026)
