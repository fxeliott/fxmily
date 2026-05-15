# Runbook — Smoke test prod (V2 — gates per-jalon, V1 LIVE state)

> **Version** : V2 (V1.12 P4 refonte 2026-05-15). Supersède V1 (12 steps J10
> "première invitation prod" stale, ~50% surface non couverte post-J10).
>
> **Critère** : à chaque deploy non-trivial OU check up sain hebdo, valider que
> tous les jalons shippés (J0 → V1.12 P4) sont opérationnels en prod.

## Quand exécuter

- Après chaque **deploy non-trivial** (migration Prisma, refactor module
  critique, bump security-sensitive dep).
- **Hebdo lundi** par défaut (rapide ~15 min si tout vert, ~1h si gates
  rouges à investiguer).
- Avant tout **passage de cap membres** (10 → 30 → 100 → 1000).
- Après tout **incident sec** (audit slug suspect, Sentry spike, Cron Watch
  rouge > 6h).

## Pré-requis (état LIVE 2026-05-15, V1.12 P4)

L'app **est** en prod sur `https://app.fxmilyapp.com` depuis 2026-05-10. Les
items ci-dessous doivent rester vrais entre chaque smoke. Si l'un casse, le
gate concerné échoue.

- [ ] `/api/health` retourne 200 + JSON `{ status: 'ok', checks: { env: 'ok',
db: 'ok' } }`.
- [ ] `/api/cron/health` retourne 200 ou 503 (503 = au moins 1 cron amber/red ;
      investigate `/admin/system` puis `gh run list --workflow=cron-watch.yml`).
- [ ] `git log origin/main --oneline -5` cohérent avec l'image deployée (le
      `app_commit` injecté dans Sentry releases doit matcher le SHA actuel).
- [ ] `/etc/fxmily/web.env` (Hetzner, owner fxmily 0600) contient toutes les
      vars Zod-validées : `AUTH_SECRET` (≥32 chars), `AUTH_URL=https://app.fxmilyapp.com`,
      `AUTH_TRUST_HOST=true`, `DATABASE_URL`, `CRON_SECRET`, `ADMIN_BATCH_TOKEN`
      (≥32 chars, V1.7.2+), `RESEND_API_KEY`, `RESEND_FROM='Fxmily <noreply@fxmilyapp.com>'`,
      `WEEKLY_REPORT_RECIPIENT=eliot@fxmilyapp.com`, `VAPID_SUBJECT=mailto:eliot@fxmilyapp.com`,
      `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `NEXT_PUBLIC_SENTRY_DSN`,
      `SENTRY_DSN`, `MEMBER_LABEL_SALT` (V1.5+ pseudonymisation).
- [ ] `/etc/fxmily/cron.env` (owner fxmily 0600) contient `CRON_SECRET=...`
      identique à la GitHub Actions secret (cf. V1.6 Bug #5 catch — mismatch
      causait Cron Watch 401 depuis prod launch).
- [ ] `/etc/cron.d/fxmily-app` **sans CRLF** : `cat -A /etc/cron.d/fxmily-app
| grep -c '\^M$'` doit retourner `0` (cf. V1.6 Bug #2 catch — 60 CR avait
      silent-killed tous les crons pendant ~20h).
- [ ] `/etc/fxmily/Caddyfile` **sans CRLF** : idem (V1.6 Bug #3).
- [ ] Docker compose prod containers UP healthy : `docker compose -f
/opt/fxmily/docker-compose.prod.yml ps` → 3 services (web, postgres, caddy)
      tous `Up` `(healthy)`.

## Phase 0 — Pre-flight (5 min)

### 0.1 Healthcheck publics

```bash
curl -sI https://app.fxmilyapp.com/api/health | head -3
# HTTP/2 200

curl -s https://app.fxmilyapp.com/api/health | jq
# { "status": "ok", "checks": { "env": "ok", "db": "ok" } }

curl -sI https://app.fxmilyapp.com/api/cron/health | head -3
# HTTP/2 200 (overall=green) OR 503 (overall=amber/red, investigate)
```

### 0.2 Cron daemon health (Hetzner SSH)

```bash
ssh fxmily@<HETZNER_HOST>

# Cron daemon actually running (vs trompeuse "deployed" status) :
journalctl _COMM=cron --since '1h ago' | grep -c '(fxmily) CMD'
# Doit être >= 1 (au moins 1 cron a tourné cette heure — purge_audit_log
# tourne daily 04:00 UTC donc absent hors de cette fenêtre, voir crontab).

# Crontab parse OK :
cat /etc/cron.d/fxmily-app
# Doit lister 8 lignes (J5 checkin + J6 scores + J7 douglas + J8 weekly
# + J9 dispatch + J10 purge × 3 + backup + cron-watch + V1.12 P1 caddy backup).

# CRON_SECRET sync GitHub ↔ Hetzner :
cat /etc/fxmily/cron.env | grep CRON_SECRET | cut -d= -f2- | head -c 16
gh secret list --repo fxeliott/fxmily | grep CRON_SECRET
# Les 16 premiers chars doivent matcher (cf. V1.6 Bug #5 audit).
```

### 0.3 Sentry observability

```bash
# Sentry dashboard `fxmily-web` :
# - Errors last 24h : pas de spike inattendu (>10 events nouveaux à investiguer).
# - Releases : SHA actuel listé + source maps uploaded.
# - reportWarning channel : 7 sites V1.6 polish actifs (push.dispatcher × 3,
#   douglas.scheduler, scoring.scheduler, weekly-report.{generate,email}).
```

## Phase 1 — Gates V1 backend (jalons J0 → J10 + V1.5 → V1.12)

### Gate J0-J1 — Auth (Auth.js v5)

- [ ] **Login admin** : `https://app.fxmilyapp.com/login` → email + mdp (rotaté
      post-J8 polish 2026-05-08) → redirect **`/dashboard`** (le runbook V1
      claimait `/admin`, FAUX — `signInAction` hardcode `redirectTo: '/dashboard'`
      cf. [`app/login/actions.ts`](../apps/web/src/app/login/actions.ts) +
      test [`actions.test.ts:118`](../apps/web/src/app/login/actions.test.ts)).
- [ ] **Login member** : compte test membre → redirect `/dashboard` aussi.
      L'admin accède aux pages admin via nav links (pas de page index `/admin`).
- [ ] **Onboarding** : invitation token consume → redirect `/dashboard` post
      mdp setup.
- [ ] **Audit row** : `SELECT * FROM audit_logs WHERE action='auth.login.success'
ORDER BY created_at DESC LIMIT 1` — userId présent, ipHash + userAgentHash
      sanitized.

### Gate J0-J1 — V1.12 P3 H1 sec auth (loginIpLimiter dans authorize())

Le bypass POST direct `/api/auth/callback/credentials` est désormais couvert
par IP rate-limit en plus du per-email bucket.

- [ ] **Simulate credential-stuffing rotation N emails 1 IP** (test sec en
      staging si possible, pas en prod) :
  ```bash
  # 10 emails différents depuis même IP → la 11e doit returner 401 silencieux
  # avec audit row kind:'ip' source:'authorize'.
  for i in $(seq 1 11); do
    curl -s -X POST https://app.fxmilyapp.com/api/auth/callback/credentials \
      -d "email=attacker${i}@evil.com&password=fakepw1234567" \
      -o /dev/null -w "%{http_code}\n"
  done
  ```
- [ ] **Audit check** :
  ```sql
  SELECT metadata->>'kind', metadata->>'source', COUNT(*)
  FROM audit_logs
  WHERE action='auth.login.rate_limited'
    AND created_at > NOW() - INTERVAL '10 minutes'
  GROUP BY 1, 2;
  -- Doit montrer : kind='ip' source='authorize' (V1.12 P3 path)
  ```
- [ ] **L1 Sentry warning fallback** : si `headers()` throw (régression Edge
      future), Sentry capture `reportWarning('auth.authorize',
'headers_unavailable_ip_limit_skipped', {...})`. Vérifier 0 occurrence
      dashboard last 7d (= path nominal).

### Gate J2 — Trading journal (Trade + uploads)

- [ ] **`/journal/new` wizard** : 6 steps mobile-first (Quand → Direction →
      Prix+Risk → R:R → Discipline → Capture). V1.5.1 a injecté `riskPct` au
      step 3 (après stopLossPrice) + `<TradeQualitySelector>` au TOP du step 4
      (Discipline). **Step count reste 6**.
- [ ] **Saisir 1 trade** : EURUSD long, plannedRR=2, riskPct=1.0, tradeQuality=A
      → "Confirmer" → redirect `/journal/<id>`.
- [ ] **DB row** :
  ```sql
  SELECT id, risk_pct, trade_quality, tags FROM trades
  ORDER BY created_at DESC LIMIT 1;
  -- risk_pct = 1.00 (Decimal(4,2) V1.5.1)
  -- trade_quality = 'A' (V1.5.1 enum nullable)
  -- tags = '{}' (V1.8 default, populated via /journal/[id]/close picker)
  ```
- [ ] **`/api/uploads`** : POST multipart JPEG/PNG/WebP ≤8 MiB OK. Magic-byte
      sniff rejette `.jpg` renommé `.png`. 9 MiB → 413.
- [ ] **Audit** : rows `trade.created` + `trade.screenshot.uploaded` (metadata
      = `{ kind, key, mime, size, adapter }`).

### Gate J5 — Daily checkin (matin + soir)

- [ ] **`/checkin/morning`** : wizard 5 steps (Sommeil → Routine → Corps →
      Mental → Intention) → submit → redirect `/checkin?slot=morning&done=1`.
- [ ] **`/checkin/evening`** : wizard 5 steps (Discipline → Hydratation →
      Stress → Mental → Réflexion).
- [ ] **DB rows** :
  ```sql
  SELECT slot, date FROM daily_checkins
  WHERE user_id = '<test-user-id>'
  ORDER BY date DESC, slot LIMIT 3;
  ```
- [ ] **Streak calcul** : `/dashboard` ou `/checkin` doit montrer streak
      correct (jours consécutifs avec ≥1 check-in matin OU soir, walking back
      depuis today). Vérifier que today **n'est PAS inclus** si pas encore
      filled (mercy infrastructure Yu-kai Chou).
- [ ] **Cron reminders** : `/api/cron/checkin-reminders` tourne `_/15 7-22 _

* \*`UTC. Audit row`cron.checkin_reminders.scan` daily.

### Gate J6 — Scoring 4-dim

- [ ] **`/dashboard`** : score widget rendu avec 4 gauges (discipline /
      emotional / consistency / engagement). Si <14 days history → pill
      "insufficient_data" + reason explicit.
- [ ] **Sample size disclaimer** : pill "X/30 jours" tone warn si <30.
- [ ] **Cron quotidien** :
  ```sql
  SELECT created_at, metadata FROM audit_logs
  WHERE action='cron.recompute_scores.scan'
  ORDER BY created_at DESC LIMIT 1;
  -- created_at < 24h ago, metadata = { computed, skipped, errors, ranAt }
  ```
- [ ] **Constants V1 validées Phase V/W** : `STDDEV_FULL_SCALE=4` dans
      `lib/scoring/emotional-stability.ts:94`, `EXPECTANCY_FULL_SCALE=1` dans
      `lib/scoring/consistency.ts:67`. ADR-002 propose `STDDEV=2.5` pour V2,
      pas V1.6 (cf. memory correction Round 12 session 2026-05-12).

### Gate J7 — Mark Douglas library

- [ ] **`/library`** : grid de 50 fiches (J7.8 ship 50/50). Filtres par
      catégorie (11 enum DouglasCategory) fonctionnent.
- [ ] **Trigger engine simulate** :
  ```bash
  # Crée 3 trades perdants consécutifs pour le test user, puis trigger cron :
  curl -fsS -X POST -H "X-Cron-Secret: $CRON_SECRET" \
    https://app.fxmilyapp.com/api/cron/dispatch-douglas
  # Audit row : `douglas.dispatched` avec metadata `{ cardSlug, triggeredBy }`.
  ```
- [ ] **`/library/sortir-du-tilt`** : hero + quote ≤30 mots (fair use FR L122-5) + paraphrase markdown sanitized via SafeMarkdown + 3 exercises.
- [ ] **Badge "1 nouvelle correction"** sur `/dashboard` si delivery unread.

### Gate J8 — Weekly report admin (V1.7.2 batch HTTP, **PAS** /api/cron/weekly-reports)

> **NOTE V1.7.2** : la route `/api/cron/weekly-reports` (J8 initial) a été
> remplacée par 2 endpoints admin HTTP `/api/admin/weekly-batch/{pull,persist}`.
> Le batch tourne désormais **localement** sur la machine d'Eliot via
> `claude --print` headless utilisant son abonnement Claude Max (cost
> marginal Anthropic API = 0€).

- [ ] **`/admin/reports`** : list rendu, pills MOCK/LIVE selon claudeModel,
      stats strip 4 cells (totalReports / totalCostEur / emailsDelivered /
      membersInLastWeek).
- [ ] **Pull endpoint test** :
  ```bash
  curl -fsS -X POST -H "X-Admin-Token: $ADMIN_BATCH_TOKEN" \
    https://app.fxmilyapp.com/api/admin/weekly-batch/pull | jq '.snapshots | length'
  # Doit retourner le nombre de membres actifs (pseudonymized via pseudonymLabel V1.5.2).
  ```
- [ ] **Persist endpoint test** (avec mock results) :
  ```bash
  curl -fsS -X POST -H "X-Admin-Token: $ADMIN_BATCH_TOKEN" \
    -H "Content-Type: application/json" \
    -d '{"weekStart":"2026-05-11","results":[]}' \
    https://app.fxmilyapp.com/api/admin/weekly-batch/persist | jq
  # { persisted: 0, skipped: 0, errors: 0, total: 0 }
  ```
- [ ] **Rate-limit adminBatchLimiter** : burst >10 en <5min → 429 + Retry-After.
- [ ] **Bash script local** (Eliot side, Windows) :
  ```bash
  export FXMILY_ADMIN_TOKEN=<token from /etc/fxmily/web.env>
  bash ops/scripts/weekly-batch-local.sh --dry-run
  # Pull envelope → loop 60-120s jittered sleeps → persist 0 results.
  ```
- [ ] **Slash command Claude Code** : `/sunday-batch --dry-run` depuis Claude
      Code session sur D:/Fxmily (charge `.claude/commands/sunday-batch.md`).

### Gate J9 — Push notifications (V1.11 sw.js iOS 26 fallback inclus)

> **VISUAL SMOKE REQUIRED** : iPhone physique Safari 18.4+ obligatoire.

- [ ] **iPhone Safari** → `https://app.fxmilyapp.com` → login compte test.
- [ ] **Bouton Partage** → "Sur l'écran d'accueil" → lancer Fxmily depuis icône
      Home (mode standalone iOS PWA — iOS 26 défaut).
- [ ] **`/account/notifications`** → toggle "Activer les notifications" →
      permission iOS Autoriser.
- [ ] **DB row** :
  ```sql
  SELECT id, endpoint, last_seen_at FROM push_subscriptions
  WHERE user_id = '<test-user-id>'
  ORDER BY created_at DESC LIMIT 1;
  -- endpoint commence par https://web.push.apple.com/...
  ```
- [ ] **Trigger dispatch** :
  ```bash
  curl -fsS -X POST -H "X-Cron-Secret: $CRON_SECRET" \
    https://app.fxmilyapp.com/api/cron/dispatch-notifications | jq
  # { sent: 1, scanned: 1, recoveredStuck: 0 }
  ```
- [ ] **iPhone lock screen** : push reçu (titre + body cohérents avec
      douglas_card_delivered OU annotation_received OU weekly_report_ready).
- [ ] **V1.11 sw.js iOS fallback** : si `event.data?.json()` throw (subscription
      revoke iOS 26), display generic notification `fxmily-fallback` au lieu
      de silent drop. Tester via `chrome://serviceworker-internals/` desktop.

### Gate J10 — Production hardening (RGPD + Sentry + legal)

- [ ] **`/account/data`** : page liste sections + counts → bouton "Télécharger
      l'export JSON".
- [ ] **JSON download** : `fxmily-data-<id>-2026-MM-DD.json` arrive dans Downloads.
  ```bash
  jq '.user, .trades | length, .daily_checkins | length' < ~/Downloads/fxmily-data-*.json
  # match les counts du dashboard
  ```
- [ ] **Audit** : row `account.data.exported` rate-limited 3/15min per userId
      (V1.10.5 token bucket).
- [ ] **`/account/delete`** state machine :
  - Active → click "Supprimer mon compte" + tape "Tape ici" (anti-impulsivité
    V1.10 audit) → DB `User.deletedAt = now+24h`, status='active'.
  - Cron `purge_deleted` daily 03:00 UTC → après 24h, `status='deleted'` +
    pseudonymise data (materialised).
  - Après 30 jours materialised → hard-purge cascade.
- [ ] **`/legal/{privacy,terms,mentions}`** : 3 pages static render. hierarchy
      h2 visible (V1.10 ui-designer audit fix). Sticky last-updated badge.
- [ ] **Sentry test** : trigger forced error :
  ```bash
  # Ne PAS faire en prod sur user data. Utiliser staging ou error route dev.
  ```
- [ ] **HSTS** : `curl -sI https://app.fxmilyapp.com | grep -i strict`
      retourne `Strict-Transport-Security: max-age=63072000; includeSubDomains;
preload`.
- [ ] **CSP Sentry tunnel** : `connect-src` inclut `https://*.sentry.io`. Le
      `proxy.ts` matcher exclut `/monitoring` (Phase O fix).

### Gate V1.5 — Trading calibration (`tradeQuality` + `riskPct` + `pseudonymLabel`)

- [ ] **Wizard `/journal/new` step 2** : NumericField `riskPct` après
      stopLossPrice. Decimal comma FR `'1,5'` accepté (V1.5.2 `z.preprocess`).
- [ ] **Wizard `/journal/new` step 4** : `<TradeQualitySelector>` AU TOP. 3
      cards A/B/C. Click toggle. Tooltips Steenbarger verbatim.
- [ ] **DB persistance** :
  ```sql
  SELECT risk_pct::text, trade_quality FROM trades
  WHERE id = '<last-created-id>';
  -- risk_pct = "1.50" (Decimal(4,2) round-trip), trade_quality = 'A'
  ```
- [ ] **Builder weekly report** : `WeeklySnapshot.pseudonymLabel` 8-char hex
      (V1.5.2 32-bit slice), section "Qualité d'exécution (V1.5 Steenbarger +
      Tharp)" surface dans le prompt Claude si data présente.
- [ ] **MEMBER_LABEL_SALT** prod env verify :
  ```bash
  ssh fxmily@<HOST> "cat /etc/fxmily/web.env | grep MEMBER_LABEL_SALT"
  # Doit être set (≥32 chars hex). Si absent → ré-identification triviale
  # (cf. V1.5.1 audit M1 finding).
  ```

### Gate V1.6 — Polish + bug catches (Sentry taxonomy + freq cap + Prisma pool)

- [ ] **`notification_queue.is_transactional`** column exists :
  ```sql
  \d notification_queue
  -- column "is_transactional" boolean not null default false
  -- index "notification_queue_user_recent_non_transactional_idx" partial
  ```
- [ ] **Email fallback freq cap** : `EMAIL_FALLBACK_CAP_PER_24H = 3` enforce.
      Si push perma-fail > 3 fois/24h pour 1 user, audit `notification.fallback.capped`.
- [ ] **Sentry observability** : 7 sites V1.6 polish wirés en `reportWarning`
      (push.dispatcher × 3, douglas.scheduler, scoring.scheduler,
      weekly-report.{generate,email}).
- [ ] **Prisma pool v6 defaults pin** : `lib/db.ts` exposé `max:10,
connectionTimeoutMillis:5000, idleTimeoutMillis:30000`. Pool saturé →
      throw après 5s (pas hang infini Prisma 7 default).
- [ ] **Cron daemon vivant** :
  ```sql
  SELECT COUNT(*) FROM audit_logs
  WHERE action LIKE 'cron.%'
    AND created_at > NOW() - INTERVAL '24h';
  -- Doit être >= 8 (8 crons + cron-watch).
  ```

### Gate V1.7.2 — Batch HTTP migration (Claude Code local Max)

Tests déjà décrits en Gate J8 ci-dessus. Note importante :

- [ ] **ADMIN_BATCH_TOKEN** rotation : si suspect compromis, generate
      `openssl rand -hex 32` → update `/etc/fxmily/web.env` → restart container
      web → update `FXMILY_ADMIN_TOKEN` env local Eliot.
- [ ] **Ban-risk** : `claude --print` headless **official binary uniquement**.
      OpenClaw / Roo / Goose / CLIProxyAPI **bannis** (Anthropic 14 jan + 4 avr
      2026 enforcement).

### Gate V1.8 — REFLECT module + crisis routing + prompt-injection defenses

- [ ] **`/review`** : landing avec Mirror hero SVG (M4=C metaphor). Si `?done=1`,
      banner "Ta revue est dans le miroir" calm reveal.
- [ ] **`/review/new`** : wizard 5 steps (4 mandatory + bestPractice optional
      Steenbarger reverse-journaling). Sticky bottom CTA bar
      `safe-area-inset-bottom`. Char counter tone muted → warn → bad.
- [ ] **`/reflect`** : landing avec ABCD hero SVG progressive blue gradient.
      Timeline 30 derniers reflections.
- [ ] **`/reflect/new`** : wizard 4 steps Ellis ABCD (Activating event →
      Beliefs → Consequences → Disputation).
- [ ] **`/journal/[id]/close`** : `<TradeTagsPicker>` 8 LESSOR + Steenbarger
      slugs. Cap 3 tags Zod + UX. `discipline-high` rendu `--ok` (vert
      strengths-based, pas `--acc` blue).
- [ ] **DB persistance** :
  ```sql
  SELECT id, week_start FROM weekly_reviews ORDER BY created_at DESC LIMIT 1;
  SELECT id, date FROM reflection_entries ORDER BY created_at DESC LIMIT 1;
  SELECT tags FROM trades WHERE id='<closed-trade-id>';
  -- tags = '{"loss-aversion","revenge-trade"}' (max 3 array)
  ```
- [ ] **Audit slugs V1.8** : `weekly_review.submitted` +
      `reflection.submitted` carry `crisisLevel?` + `injectionSuspected` +
      `injectionLabels` metadata PII-free.
- [ ] **Crisis routing FR (3 sites)** :
  1. `/review` action — corpus 5 textareas → `detectCrisis` HIGH/MEDIUM →
     **persist quand même** (Q4=A diverges from V1.7.1) → audit + Sentry
     escalate + redirect `?crisis=high`.
  2. `/reflect` action — idem corpus 4 ABCD.
  3. V1.7.2 `batch.ts:410` — output Claude → detect → **SKIP persist**
     (diverges from review/reflect because admin output, not member text).
- [ ] **Crisis banner FR resources** :
  - `tel:3114` (numéro national 24/7)
  - `tel:0972394050` SOS Amitié
  - `tel:0145394000` Suicide Écoute
  - Border `0.85` alpha + bg `0.22` (V1.8 a11y fix 1.4.11 Non-text Contrast).
- [ ] **Prompt-injection detector** : `lib/ai/injection-detector.ts` 9
      patterns canoniques. Si match, audit metadata `injectionSuspected: true` + `injectionLabels`. **Never blocks** — FP must not eat member text.
- [ ] **AI banner EU AI Act 50(1)** : ACTIVE sur 2 sites :
  - `/admin/reports/[id]` page (inline above Synthèse section).
  - `weekly-digest.tsx` template inline HTML (email digest).
  - Copy : "Généré par IA — pas substitut coaching humain. Aucun conseil
    de trade." Deadline conformité **2 août 2026**, pénalité **€15M ou 3%
    CA Article 99(4)** (vérifié source primaire 2026-05-12).

### Gate V1.9 — Polish a11y + Recharts dashboard

- [ ] **Wizards V1.8 char counter** : tone passe muted → warn → bad sur
      contrast WCAG AA `--t-2` (V1.9 fix H1 borderline).
- [ ] **Heading H2 wizards** : `tabIndex={-1}` + `outline-none` (V1.9 fix H3
      pour SR clavier).
- [ ] **TradeTagsPicker tooltips** : `aria-describedby` pattern APG (V1.9 fix
      H4 versus aria-live verbosity).
- [ ] **Dashboard charts** : Recharts (Tremor abandoné pivot J6.6) render
      track-record + R-distribution + emotion-perf table.

### Gate V2.0 — TRACK module (HabitLog backend-only)

> **V2.0 backend-only ship**. Frontend wizards V2.1+ pending Eliot M4/M5/M6
> décisions (V2-MASTER §16-§18).

- [ ] **DB schema** :
  ```sql
  \d habit_logs
  -- columns: id, user_id, date (Date), kind (HabitKind enum 5 valeurs),
  -- value (JSONB), notes (Text?), created_at, updated_at
  -- unique (user_id, date, kind)
  -- indexes (user_id, date DESC) + (user_id, kind, date DESC)
  ```
- [ ] **Enum HabitKind** : 5 valeurs (sleep, nutrition, caffeine, sport,
      meditation).
- [ ] **Server Action `submitHabitLogAction`** : signature
      `(prev, formData) => ActionState`. Pas de wizard UI V2.0 — caller direct
      via tests Vitest OU futur wizard V2.1.
- [ ] **Audit slugs declared** : `habit_log.upserted` + `habit_log.deleted`
      dans union (pre-declared anti-regression, pas wired V2.0).

### Gate V1.10 — Sec hardening (M1 callerIdTrusted + M3 userIdSchema.max(40))

- [ ] **11 sites `callerIdTrusted`** (vs legacy `callerId`) :
  ```bash
  ssh fxmily@<HOST> "docker exec fxmily-web grep -rn 'callerId' /app | grep -v callerIdTrusted | wc -l"
  # Doit être 0 (tous migrés V1.10 PR #76).
  ```
- [ ] **V1.12 P1 Caddyfile XFF propagate** (test si Eliot SSH steps done) :
  ```bash
  curl -sI -H "X-Forwarded-For: 1.2.3.4" https://app.fxmilyapp.com/api/health
  # Le audit_logs row health.scan callerId DOIT montrer la real IP, PAS 1.2.3.4
  # (la dernière entrée XFF est l'IP TCP-layer Caddy ajoutée par P1 directive).
  ```
- [ ] **userIdSchema.max(40)** : `/api/admin/weekly-batch/persist` rejette
      payload avec `userId` > 40 chars.

### Gate V1.11 — Sentry symmetric URL scrub + sw.js iOS fallback + README/SECURITY refonte

- [ ] **Sentry URL scrub symmetric** : trigger une erreur avec
      `?token=secret123&password=fake` dans l'URL → Sentry dashboard event
      `query_string` ET `url` doivent être strippés.
- [ ] **sw.js fallback** : déjà testé Gate J9 ci-dessus.
- [ ] **README + SECURITY** : `https://github.com/fxeliott/fxmily` README
      montre roadmap V1 LIVE + Mark Douglas posture. SECURITY couvre V1
      surface (20 tables Prisma + 9 crons + RGPD).

### Gate V1.12 P1 — Caddyfile XFF + caddy_data weekly backup

- [ ] **XFF directive propagée** : `ssh fxmily@<HOST> "cat /etc/fxmily/Caddyfile
| grep -A1 'header_up'"` → doit montrer `header_up X-Forwarded-For
{remote_host}` (test fait Gate V1.10 ci-dessus).
- [ ] **Caddy backup weekly** :
  ```bash
  ssh fxmily@<HOST>
  ls -la /etc/fxmily/backups/caddy-*.tar.gz.gpg | head -3
  # Au moins 1 fichier daté <8 jours (cron Sunday 06:30 UTC).
  ```
- [ ] **R2 mirror caddy/** :
  ```bash
  aws s3 ls s3://fxmily-backups/caddy/ --profile fxmily-backup
  # Au moins 1 objet récent (Cloudflare R2 cross-region).
  ```

### Gate V1.12 P2 — Zizmor CI SARIF + sec hardening

- [ ] **`.github/workflows/zizmor.yml`** présent + tourne sur push main + PRs.
- [ ] **Code Scanning** :
      `https://github.com/fxeliott/fxmily/security/code-scanning?query=tool%3Azizmor`
      → 0 finding **medium+** (info-level template-injection FP acceptable).
- [ ] **`persist-credentials: false`** sur 5 checkout actions (ci, codeql,
      deploy, e2e, zizmor).
- [ ] **deploy.yml permissions hierarchy** : workflow-level minimal `contents:
read`, job-level `build-and-push` reçoit `packages: write` + `id-token:
write`.

### Gate V1.12 P3 — H1 sec authorize() loginIpLimiter

Déjà testé Gate J0-J1 ci-dessus.

### Gate V1.12 P4 — TIER A1 pinact SHA pinning + zizmor hard-gate

- [ ] **19 GitHub Actions SHA-pinned** :
  ```bash
  grep -Erc 'uses:\s+[^@]+@v[0-9]+\s*$' .github/workflows/ | grep -v ':0$'
  # Doit retourner 0 fichier matching (tous SHA pinned avec # vN comment).
  ```
- [ ] **Zizmor hard-gate `--min-severity medium`** : le step `Run zizmor —
hard-gate (medium+)` dans `.github/workflows/zizmor.yml` exits 0 sur les
      3 info-level `template-injection` actuels (FP owner-controlled vars/
      outputs). Workflow run SUCCESS sur main.
- [ ] **Dependabot tracking SHAs** : Dependabot github-actions ecosystem
      configuré dans `.github/dependabot.yml`. Le commentaire `# vN` permet
      les bump SHA in-place automatiques.

## Phase 2 — Gates RGPD + crisis FR + IA transparency

### RGPD self-service

Déjà testé Gate J10 ci-dessus.

### Crisis FR

Déjà testé Gate V1.8 ci-dessus. Récap des 3 ressources canonical :

- **3114** — numéro national de prévention du suicide (24h/24, 7j/7).
- **09 72 39 40 50** — SOS Amitié.
- **01 45 39 40 00** — Suicide Écoute.

### EU AI Act Article 50(1) transparency

Déjà testé Gate V1.8 ci-dessus. Récap canonique :

- Banner ACTIVE sur **2 sites admin/email** : `/admin/reports/[id]` + email
  digest. Pas member-facing V1.8 (REFLECT input-only, pas chatbot member-side).
- Deadline conformité **2 août 2026**.
- Pénalité **€15M ou 3% CA mondial Article 99(4)** (NB : la mémoire pré-existante
  affirmait €35M/7% — FAUX, c'est Article 5 prohibited practices).

## Phase 3 — Audit slugs canonical sweep

Verifier que tous les audit slugs canonical sont émis cohérent :

```sql
SELECT action, COUNT(*) FROM audit_logs
WHERE created_at > NOW() - INTERVAL '7 days'
GROUP BY action
ORDER BY 2 DESC;
```

Attendu (selon activité 7j) :

- `auth.login.success` / `auth.login.failure` / `auth.login.rate_limited`
- `cron.{checkin_reminders,recompute_scores,dispatch_douglas,
weekly_reports,dispatch_notifications,purge_deleted,purge_push_subscriptions,
purge_audit_log,health}.scan`
- `trade.{created,closed,deleted,screenshot.uploaded}`
- `checkin.{morning,evening}.submitted`
- `weekly_review.submitted` (V1.8)
- `reflection.submitted` (V1.8)
- `douglas.{dispatched,delivery.{seen,dismissed,helpful,bulk_seen},favorite.{added,removed}}`
- `weekly_report.{generated,email.{sent,failed,skipped,capped},batch.{pulled,persisted,skipped,invalid_output,persist_failed,crisis_detected}}`
- `notification.{enqueued,dispatched,fallback.{emailed,capped}}`
- `account.{data.exported,deletion.{requested,cancelled,materialised,purged}}`
- `admin.{members.listed,member.viewed,trade.viewed,annotation.{created,deleted,media.uploaded},system.viewed,weekly_report.viewed,cards.{published,unpublished,deleted}}`
- `ops.migration.rolled_back` (si rollback fait — sinon absent)
- `invitation.{created,consumed}` + `onboarding.completed`

**Anti-regression** : si un slug attendu est ABSENT alors que le feature est
exercé en prod, c'est probablement un bug d'audit silencieux (cf. V1.6 Bug #4
slug mismatch catch). Investigate.

## Done ?

Si toutes les gates passent :

- ✅ V1 LIVE prod sain end-to-end (J0 → V1.12 P4).
- Logger dans `MEMORY.md` (scope D--Fxmily) le snapshot smoke (`fxmily_session_<date>_smoke_v2.md`).
- Pas d'action correctrice nécessaire.

Si une gate échoue :

- Documenter dans memory `<date>_smoke_v2_FAIL_<gate>.md`.
- Trader stop-loss : si > 3 gates rouges, investigate root cause (probablement
  un commit récent main HEAD à revert).
- Fix atomic + re-smoke la gate concernée.

## Rollback (si bug bloquant)

Cf. [`runbook-hetzner-deploy.md`](runbook-hetzner-deploy.md) :

- §11 V1.5 (rollback Trade.tradeQuality + riskPct).
- §12 V1.6 (rollback notification_queue.is_transactional).
- §13 V1.8 (rollback weekly_reviews + reflection_entries + trades.tags — **data-loss risk**).
- §14 V2.0 (rollback habit_logs + HabitKind).

Pattern transversal : pg_dump atomique → docker stop → BEGIN/COMMIT → DELETE
FROM \_prisma_migrations → re-deploy pre-migration image → audit
`ops.migration.rolled_back` honest.

## Pickup smoke V2 next session

```
Reprise Fxmily smoke prod V2 hebdo. /clear consommé. Lis
docs/runbook-prod-smoke-test.md + MEMORY.md scope D--Fxmily.

État LIVE 2026-05-15 (post-V1.12 P4) :
- main HEAD `23e81a1`
- Vitest 1001/1001
- 8 crons + cron-watch UP healthy

Exécuter Phase 0 (pre-flight ~5 min) puis Phase 1 gates per-jalon J0 → V1.12 P4.
Si gates 100% vertes : memory checkpoint `fxmily_session_<date>_smoke_v2_ok.md`.
Si red : documenter + investigate + atomic fix + re-smoke gate.
```
