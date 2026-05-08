import { z } from 'zod';

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
  RESEND_FROM: z.string().email().optional(),

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
  /// `claude-opus-4-7` au lieu de `claude-sonnet-4-6` = 5× le coût). La
  /// liste matche `PRICING_USD_PER_MTOK` (`lib/weekly-report/pricing.ts`).
  /// Étendre ici quand un nouveau modèle est ajouté à la pricing table.
  ANTHROPIC_MODEL: z
    .string()
    .refine(
      (v) => ['claude-sonnet-4-6', 'claude-haiku-4-5', 'claude-opus-4-7'].includes(v),
      'ANTHROPIC_MODEL doit être un modèle pricé (claude-sonnet-4-6, claude-haiku-4-5, claude-opus-4-7).',
    )
    .default('claude-sonnet-4-6'),
  /// Destinataire du digest hebdo IA admin. Defaults à `eliottpena34690@gmail.com`
  /// (email du compte Resend Eliot — seul recipient autorisé free-tier sans
  /// domain verify ; Resend retourne 403 sinon, vérifié live 2026-05-08).
  /// À élargir à `eliot@fxmily.com` quand `fxmily.com` domain verify Resend
  /// est fait (J10).
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
