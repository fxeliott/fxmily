import { z } from 'zod';

import { DEFAULT_ANTHROPIC_MODEL, KNOWN_CLAUDE_MODEL_SLUGS } from './ai/models';

/**
 * Schéma de validation des variables d'environnement.
 * Au-delà de la sécurité, ça nous donne un type fort pour `env.*` dans tout le code.
 *
 * Les champs requis bloquent le démarrage si absents.
 * Les champs optionnels seront resserrés au fur et à mesure des jalons.
 *
 * IMPORTANT : ce module ne doit JAMAIS être importé côté client. Il lit
 * `process.env` qui contient des secrets serveur. L'import depuis un composant
 * `'use client'` ferait fuiter les valeurs dans le bundle.
 */

const isProd = process.env.NODE_ENV === 'production';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),

  // Jalon 0 — Database
  DATABASE_URL: z
    .string()
    .regex(/^postgres(ql)?:\/\//, 'DATABASE_URL doit commencer par postgres:// ou postgresql://'),

  /// Scalability hardening (2026-06-29 A-Z audit) — connection pool size +
  /// per-statement safety timeouts, all OPTIONAL with defaults that preserve
  /// the original hard-coded `db.ts` behaviour (max:10). Tunable per-deploy as
  /// the cohort grows (SPEC §10 : CX22 jusqu'à ~500 membres actifs) without a
  /// code change. `DATABASE_STATEMENT_TIMEOUT_MS` caps a runaway query so it
  /// can't pin a pool connection forever under load (pool-exhaustion → every
  /// other route hits `connectionTimeoutMillis`); `DATABASE_IDLE_IN_TX_TIMEOUT_MS`
  /// kills a transaction left open (lock holder). Set either to 0 to disable.
  DATABASE_POOL_MAX: z.coerce.number().int().positive().max(100).default(10),
  DATABASE_STATEMENT_TIMEOUT_MS: z.coerce.number().int().nonnegative().default(30_000),
  DATABASE_IDLE_IN_TX_TIMEOUT_MS: z.coerce.number().int().nonnegative().default(60_000),
  /// Dead-socket backstop + connection rotation (2026-06-29 A-Z deep audit).
  /// `DATABASE_QUERY_TIMEOUT_MS` is CLIENT-side : unlike `statement_timeout`
  /// (server-side — it needs a LIVE socket to deliver the cancel), it fires even
  /// when the TCP connection has silently died (NAT/firewall idle-reap, server
  /// OOM-kill, failover) and the backend will never answer. Without it a
  /// black-holed query pins its pool slot until the OS gives up (minutes), and a
  /// handful of those exhaust the pool → every other route hits
  /// `connectionTimeoutMillis` and 500s. Defaulted slightly ABOVE
  /// `statement_timeout` (35 s vs 30 s) so the server-side abort wins on a LIVE
  /// socket (cleaner Postgres error) and this only reaps a DEAD one. 0 = off.
  DATABASE_QUERY_TIMEOUT_MS: z.coerce.number().int().nonnegative().default(35_000),
  /// `DATABASE_MAX_LIFETIME_S` forces pool-connection rotation : evict any
  /// connection older than this regardless of idleness. Survives a silent DB
  /// failover / rolling restart (stale connections to a demoted primary get
  /// recycled instead of erroring on next use) and bounds the blast radius of a
  /// single leaked server-side session state. 1800 s (30 min) is conservative
  /// for an always-on container ; 0 = disabled (never rotate).
  DATABASE_MAX_LIFETIME_S: z.coerce.number().int().nonnegative().default(1_800),

  // Jalon 1 — Auth.js v5
  AUTH_SECRET: z
    .string()
    .min(32, 'AUTH_SECRET doit faire au moins 32 caractères (openssl rand -base64 32)'),
  AUTH_URL: z
    .string()
    .url()
    .refine(
      (v) => !isProd || v.startsWith('https://'),
      'AUTH_URL doit être en HTTPS en production',
    ),

  // Jalon 1+ — Resend
  RESEND_API_KEY: z.string().optional(),
  /// Resend `from` field. Accepts both addr-spec (`noreply@fxmilyapp.com`)
  /// and RFC 5322 name-addr (`Fxmily <noreply@fxmilyapp.com>`). The latter
  /// is what Resend ships in their quickstart and what most SaaS expect.
  /// Zod has no built-in for name-addr, so we extract the addr-spec and
  /// re-validate it. Display name guards :
  ///  - reject `"` (Resend 422 "Invalid `from` field")
  ///  - reject `?<letter>` sequences (Resend 451 "payload contain invalid
  ///    characters" — matches their RFC 2047 encoded-word filter)
  RESEND_FROM: z
    .string()
    .optional()
    .refine((v) => {
      if (v === undefined) return true;
      const trimmed = v.trim();
      const m = trimmed.match(/^(.+?)\s*<([^<>]+)>$/);
      // `m[1]` and `m[2]` are typed `string | undefined` under
      // `noUncheckedIndexedAccess` — fall back defensively even though
      // the regex guarantees both groups when `m` is non-null.
      const addrSpec = m?.[2]?.trim() ?? trimmed;
      const addrOk = z.string().email().safeParse(addrSpec).success;
      if (!addrOk) return false;
      if (m) {
        const display = m[1]?.trim() ?? '';
        if (/["]/.test(display)) return false;
        if (/\?[a-zA-Z]/.test(display)) return false;
      }
      return true;
    }, 'RESEND_FROM doit être un email valide ou "Display Name <email@domain>" (sans guillemets ni séquence ?<lettre>)'),

  // Jalon 1+ — Cloudflare R2
  R2_ACCOUNT_ID: z.string().optional(),
  R2_ACCESS_KEY_ID: z.string().optional(),
  R2_SECRET_ACCESS_KEY: z.string().optional(),
  R2_BUCKET: z.string().optional(),
  R2_PUBLIC_URL: z.string().url().optional(),

  // Jalon 2 — local upload root (used only when R2 is not configured).
  // Resolved relative to `process.cwd()` if non-absolute.
  UPLOADS_DIR: z.string().optional(),

  // Jalon 8 — Anthropic
  ANTHROPIC_API_KEY: z.string().optional(),
  /// Modèle Claude pour le rapport hebdo IA (J8). Allowlist refine pour
  /// bloquer un drift accidentel (typo dans l'env qui ferait facturer
  /// `claude-opus-4-7` au lieu de `claude-sonnet-4-6` = 5× le coût). La liste
  /// est désormais l'unique SSOT `lib/ai/models.ts` (`KNOWN_CLAUDE_MODEL_SLUGS`),
  /// elle-même tenue en parité avec l'allowlist bash et la pricing table par
  /// `models.parity.test.ts`. Ajouter un modèle = l'ajouter dans `models.ts`.
  ANTHROPIC_MODEL: z
    .string()
    .refine(
      (v) => KNOWN_CLAUDE_MODEL_SLUGS.includes(v),
      'ANTHROPIC_MODEL doit être un modèle pricé (claude-fable-5, claude-opus-4-8, claude-opus-4-7, claude-sonnet-4-6, claude-haiku-4-5).',
    )
    .default(DEFAULT_ANTHROPIC_MODEL),
  /// Destinataire du digest hebdo IA admin. **REQUIS** en runtime (Phase T
  /// security hardening 2026-05-09 — l'email perso hardcoded a été retiré
  /// du repo public). Tant que `fxmilyapp.com` n'est pas domain-verified
  /// Resend Console, set la valeur à l'email owner du compte Resend Eliott
  /// (free-tier limit). Une fois verify : `eliot@fxmilyapp.com` ou similaire.
  WEEKLY_REPORT_RECIPIENT: z.string().email().optional(),

  // Jalon 9 — Web Push (VAPID RFC 8292 keys + subject + client-exposed pubkey)
  /// Server-side VAPID public key (base64url, P-256 ECDSA, ~87 chars). Used to
  /// sign the JWT auth header sent to push services (FCM, APNs, Mozilla).
  /// Generate via `npx web-push generate-vapid-keys`. The same value lives in
  /// `NEXT_PUBLIC_VAPID_PUBLIC_KEY` for client-side `pushManager.subscribe()`.
  /// `optional()` because dev environments may not have it set yet ; the push
  /// dispatcher refuses to run without it (returns 503 like the cron pattern).
  VAPID_PUBLIC_KEY: z
    .string()
    .regex(/^[A-Za-z0-9_-]{70,120}$/, 'VAPID_PUBLIC_KEY base64url ~87 chars (P-256 ECDSA)')
    .optional(),
  /// Server-only VAPID private key (base64url, ~43 chars). Never expose to
  /// client. Pair MUST match `VAPID_PUBLIC_KEY` (regenerate both together).
  VAPID_PRIVATE_KEY: z
    .string()
    .regex(/^[A-Za-z0-9_-]{40,80}$/, 'VAPID_PRIVATE_KEY base64url ~43 chars')
    .optional(),
  /// Contact for push services to reach in case of issue (RFC 8292 §2.1).
  /// `mailto:` or `https://` — anything else fails Apple's strict validation.
  VAPID_SUBJECT: z
    .string()
    .refine(
      (v) => v.startsWith('mailto:') || v.startsWith('https://'),
      'VAPID_SUBJECT must start with mailto: or https://',
    )
    .optional(),
  /// Client-exposed VAPID public key (mirrors VAPID_PUBLIC_KEY). Required by
  /// `pushManager.subscribe({ applicationServerKey })` in the browser. Set in
  /// `.env` as `NEXT_PUBLIC_VAPID_PUBLIC_KEY=<same as VAPID_PUBLIC_KEY>`.
  NEXT_PUBLIC_VAPID_PUBLIC_KEY: z
    .string()
    .regex(/^[A-Za-z0-9_-]{70,120}$/, 'NEXT_PUBLIC_VAPID_PUBLIC_KEY base64url ~87 chars')
    .optional(),

  // Jalon 10 — Sentry
  /// Server-side DSN. The client mirror lives in `NEXT_PUBLIC_SENTRY_DSN` —
  /// they MUST point at the same project so frontend + backend errors land
  /// in one place. A J10 audit cross-var refine enforces this when set.
  SENTRY_DSN: z.string().url().optional(),
  /// CI-only token used by `sentry-cli sourcemaps upload` after a `main`
  /// build. Never deployed to runtime; the workflow injects it from
  /// GitHub secrets. `optional()` so local builds don't fail.
  SENTRY_AUTH_TOKEN: z.string().optional(),
  /// Client-exposed mirror of `SENTRY_DSN`. Required by the browser SDK
  /// to send errors/transactions back to the same project. Set to the
  /// same value as `SENTRY_DSN` in `.env`.
  NEXT_PUBLIC_SENTRY_DSN: z.string().url().optional(),

  // Jalon 5 — secret partagé avec le cron Hetzner pour `/api/cron/*`. Sans ça,
  // l'endpoint cron répond 503 (refuse de tourner sans authentification).
  CRON_SECRET: z.string().min(24, 'CRON_SECRET ≥ 24 chars (openssl rand -hex 24)').optional(),

  /// V1.7.2 — Token partagé entre la machine d'Eliott et `/api/admin/weekly-batch/*`.
  /// Sans ça, les endpoints admin batch répondent 503 (refuse-by-default).
  /// Génération : `openssl rand -hex 32` (64 chars). Provisionner sur Hetzner
  /// via append à `/etc/fxmily/web.env` (0600 owner fxmily) puis
  /// `docker compose -f docker-compose.prod.yml restart web`.
  /// SÉPARÉ de `CRON_SECRET` car l'admin batch est invoqué depuis le PC
  /// d'Eliott (compromis ≠ compromis serveur Hetzner). Rotation indépendante.
  ADMIN_BATCH_TOKEN: z
    .string()
    .min(32, 'ADMIN_BATCH_TOKEN ≥ 32 chars (openssl rand -hex 32)')
    .optional(),

  /// V1.4 §25 — Token partagé entre la machine d'Eliott et
  /// `/api/admin/monthly-batch/*` (débrief mensuel IA). Sans ça, les
  /// endpoints monthly batch répondent 503 (refuse-by-default, mirror
  /// ADMIN_BATCH_TOKEN). Génération : `openssl rand -hex 32` (64 chars).
  /// Provisionner sur Hetzner via append à `/etc/fxmily/web.env` (0600
  /// owner fxmily) puis `docker compose -f docker-compose.prod.yml restart web`.
  /// SÉPARÉ de `ADMIN_BATCH_TOKEN` (weekly) : cadence + compromis distincts,
  /// rotation indépendante (SPEC §25.2 — "Token séparé du weekly").
  MONTHLY_ADMIN_BATCH_TOKEN: z
    .string()
    .min(32, 'MONTHLY_ADMIN_BATCH_TOKEN ≥ 32 chars (openssl rand -hex 32)')
    .optional(),

  /// §26 — Token partagé entre la machine d'Eliott et
  /// `/api/admin/calendar-batch/*` (calendrier adaptatif, J-C2). Sans ça, les
  /// endpoints calendar batch répondent 503 (refuse-by-default, mirror
  /// ADMIN_BATCH_TOKEN / MONTHLY_ADMIN_BATCH_TOKEN). Génération :
  /// `openssl rand -hex 32` (64 chars). Provisionner sur Hetzner via append à
  /// `/etc/fxmily/web.env` (0600 owner fxmily) puis
  /// `docker compose -f docker-compose.prod.yml restart web`.
  /// SÉPARÉ des deux autres : cadence + compromis distincts, rotation
  /// indépendante (le calendrier est aussi déclenché depuis le PC d'Eliott).
  CALENDAR_ADMIN_BATCH_TOKEN: z
    .string()
    .min(32, 'CALENDAR_ADMIN_BATCH_TOKEN ≥ 32 chars (openssl rand -hex 32)')
    .optional(),

  /// S3 §33.4 — Token partagé entre la machine d'Eliott et
  /// `/api/admin/verification-batch/*` (5ᵉ pipeline vision MT5). Sans ça, les
  /// endpoints verification batch répondent 503 (refuse-by-default, mirror
  /// des trois autres tokens batch). Génération : `openssl rand -hex 32`
  /// (64 chars). Provisionner sur Hetzner via append à `/etc/fxmily/web.env`
  /// (0600 owner fxmily) puis `docker compose -f docker-compose.prod.yml
  /// restart web`. SÉPARÉ des trois autres : cette surface sert aussi les
  /// IMAGES de preuve (téléchargement par le script local) — compromis
  /// distinct, rotation indépendante.
  VERIFICATION_ADMIN_BATCH_TOKEN: z
    .string()
    .min(32, 'VERIFICATION_ADMIN_BATCH_TOKEN ≥ 32 chars (openssl rand -hex 32)')
    .optional(),

  /// V1.5 — Salt server-side pour la pseudonymisation `userId → memberLabel`
  /// dans `lib/weekly-report/builder.ts`. Sans salt, un attaquant qui connaît
  /// un cuid peut vérifier sa présence dans un export rapport hebdo en
  /// hashant 1 candidate (audit M1, security-auditor 2026-05-09).
  /// Optional en V1 (default empty string = behavior actuel, OK si rapports
  /// jamais exportés hors Eliott). REQUIS en prod si export externe envisagé.
  /// Génération : `openssl rand -hex 32` (64 chars). Ne JAMAIS rotater une
  /// fois la cohorte démarrée — perte de continuité des labels historiques.
  MEMBER_LABEL_SALT: z
    .string()
    .min(16, 'MEMBER_LABEL_SALT ≥ 16 chars (openssl rand -hex 32)')
    .optional(),
});

/**
 * Cross-var consistency refines (J9 audit E2 fix).
 *
 * VAPID server private/public keys must be deployed together — if either is
 * set, BOTH must be set. AND the client-exposed `NEXT_PUBLIC_VAPID_PUBLIC_KEY`
 * must mirror `VAPID_PUBLIC_KEY` exactly. This blocks a class of mistakes:
 *  - Setting only the private key (server attempts to sign without a matching
 *    pubkey → web-push errors at runtime).
 *  - Letting the page fall back to `env.VAPID_PUBLIC_KEY` server-side and
 *    leaking through SSR markup with a value that doesn't match the public
 *    mirror (subscriptions would silently fail).
 *  - Drift after a key rotation (forgetting to update the NEXT_PUBLIC mirror).
 */
export const envSchemaWithRefines = envSchema
  .refine(
    (e) =>
      (e.VAPID_PUBLIC_KEY === undefined && e.VAPID_PRIVATE_KEY === undefined) ||
      (e.VAPID_PUBLIC_KEY !== undefined && e.VAPID_PRIVATE_KEY !== undefined),
    {
      message: 'VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY must be deployed together (or both absent).',
      path: ['VAPID_PRIVATE_KEY'],
    },
  )
  .refine(
    (e) =>
      e.VAPID_PUBLIC_KEY === undefined ||
      (e.NEXT_PUBLIC_VAPID_PUBLIC_KEY !== undefined &&
        e.NEXT_PUBLIC_VAPID_PUBLIC_KEY === e.VAPID_PUBLIC_KEY),
    {
      message:
        'NEXT_PUBLIC_VAPID_PUBLIC_KEY must mirror VAPID_PUBLIC_KEY exactly (set both to the same base64url value).',
      path: ['NEXT_PUBLIC_VAPID_PUBLIC_KEY'],
    },
  )
  /**
   * J10 — Sentry DSN cross-var consistency. If the server DSN is set, the
   * client mirror MUST be set AND match. Mismatched DSNs would split errors
   * between two Sentry projects (confusing) or leak the wrong key into the
   * browser bundle (potentially exposing internal-only routes).
   */
  .refine(
    (e) =>
      e.SENTRY_DSN === undefined ||
      (e.NEXT_PUBLIC_SENTRY_DSN !== undefined && e.NEXT_PUBLIC_SENTRY_DSN === e.SENTRY_DSN),
    {
      message:
        'NEXT_PUBLIC_SENTRY_DSN must mirror SENTRY_DSN exactly (set both to the same DSN URL).',
      path: ['NEXT_PUBLIC_SENTRY_DSN'],
    },
  )
  /**
   * Jalon 5 hardening — `CRON_SECRET` est REQUIS en production.
   *
   * Le champ reste `optional()` (dev/test n'ont pas besoin d'authentifier les
   * crons), mais sans lui en prod TOUS les endpoints `/api/cron/*` répondent
   * 503 `cron_disabled` en silence : rappels, dispatch push, recompute et
   * purge RGPD meurent sans erreur visible. On préfère bloquer le boot.
   *
   * Détection prod via le même signal que le reste du fichier : soit
   * `NODE_ENV === 'production'`, soit `AUTH_URL` en HTTPS (cf. le refine
   * `AUTH_URL` plus haut). On dérive le signal de l'objet PARSÉ (pas du
   * `isProd` module-level) pour rester testable via `safeParse` synthétique.
   * La contrainte de longueur (`≥ 24 chars`) est déjà portée par le `.min(24)`
   * sur le champ — ici on garantit seulement la PRÉSENCE en prod.
   */
  .refine(
    (e) => {
      const inProd = e.NODE_ENV === 'production' || e.AUTH_URL.startsWith('https://');
      return !inProd || e.CRON_SECRET !== undefined;
    },
    {
      message:
        'CRON_SECRET est requis en production (sinon /api/cron/* répond 503 cron_disabled et les rappels/dispatch/recompute/purge RGPD sont morts en silence).',
      path: ['CRON_SECRET'],
    },
  )
  /**
   * RC#7 (2026-06-29 A-Z audit) — plancher du pool vs concurrence batch fixe.
   *
   * Les scans de vérification tournent à une concurrence codée en dur de 5
   * (`VERIFICATION_SCAN_CONCURRENCY`, lib/verification/batch-util.ts) et le
   * dispatcher push à 8 (`CONCURRENCY` dans lib/push/dispatcher.ts), chacun
   * justifié en commentaire par « bien en dessous du pool max (10) ». Cette
   * justification casse en silence si un opérateur descend `DATABASE_POOL_MAX`
   * sous la concurrence batch pour tenir un budget Postgres partagé (le scénario
   * de scaling que le hardening de db.ts a justement ajouté) : un chunk de N
   * membres réclame N connexions, les acquêtes en excès attendent
   * `connectionTimeoutMillis` (5s) puis THROW → échecs cron sporadiques sans
   * cause évidente. On bloque le boot plutôt que de laisser le foot-gun. Le
   * plancher (8) DOIT rester >= max(ces deux constantes) ; relever une constante
   * = relever ce plancher (gardé en littéral pour éviter un cycle d'import
   * env → db → env ; verrouillé contre la dérive par env-pool-floor.test.ts).
   */
  .refine((e) => e.DATABASE_POOL_MAX >= 8, {
    message:
      'DATABASE_POOL_MAX doit être >= 8 (concurrence batch fixe : push dispatcher=8, verification scan=5). En dessous, les chunks saturent le pool et les crons throw sur connectionTimeoutMillis.',
    path: ['DATABASE_POOL_MAX'],
  })
  /**
   * 2026-06-29 A-Z deep audit — lock the documented timeout invariant at boot.
   *
   * `db.ts` relies on the SERVER-side `statement_timeout` aborting a query on a
   * LIVE socket BEFORE the CLIENT-side `query_timeout` fires (the latter is only
   * the dead-socket backstop). That ordering holds iff
   * `query_timeout >= statement_timeout` whenever both are enabled. An operator
   * tuning these for a tighter Postgres budget could silently invert them and
   * make the client timeout cut healthy long queries before Postgres aborts them
   * cleanly. We block the boot instead. Either side at 0 = disabled = opt-out,
   * which passes (the operator explicitly chose a single-sided cap).
   */
  .refine(
    (e) =>
      e.DATABASE_QUERY_TIMEOUT_MS === 0 ||
      e.DATABASE_STATEMENT_TIMEOUT_MS === 0 ||
      e.DATABASE_QUERY_TIMEOUT_MS >= e.DATABASE_STATEMENT_TIMEOUT_MS,
    {
      message:
        'DATABASE_QUERY_TIMEOUT_MS (client-side, dead-socket backstop) doit être >= DATABASE_STATEMENT_TIMEOUT_MS (server-side) quand les deux sont actifs : sinon le timeout client coupe un query LIVE avant l’abort propre de Postgres.',
      path: ['DATABASE_QUERY_TIMEOUT_MS'],
    },
  );

const parsed = envSchemaWithRefines.safeParse(process.env);

if (!parsed.success) {
  console.error("❌ Variables d'environnement invalides :");
  for (const issue of parsed.error.issues) {
    console.error(`  - ${issue.path.join('.')}: ${issue.message}`);
  }
  throw new Error('Configuration invalide. Voir docs/env-template.md.');
}

export const env = parsed.data;
export type Env = z.infer<typeof envSchema>;
