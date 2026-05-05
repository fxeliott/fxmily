import { z } from 'zod';

/**
 * Schéma de validation des variables d'environnement.
 * Au-delà de la sécurité, ça nous donne un type fort pour `env.*` dans tout le code.
 *
 * Les champs requis bloquent le démarrage si absents.
 * Les champs optionnels seront resserrés au fur et à mesure des jalons.
 */
const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),

  // Jalon 0
  DATABASE_URL: z.string().url('DATABASE_URL doit être une URL Postgres valide'),

  // Jalon 1 — Auth.js v5
  AUTH_SECRET: z
    .string()
    .min(32, 'AUTH_SECRET doit faire au moins 32 caractères (openssl rand -base64 32)'),
  AUTH_URL: z.string().url(),

  // Jalon 1+ — Resend
  RESEND_API_KEY: z.string().optional(),
  RESEND_FROM: z.string().email().optional(),

  // Jalon 1+ — Cloudflare R2
  R2_ACCOUNT_ID: z.string().optional(),
  R2_ACCESS_KEY_ID: z.string().optional(),
  R2_SECRET_ACCESS_KEY: z.string().optional(),
  R2_BUCKET: z.string().optional(),
  R2_PUBLIC_URL: z.string().url().optional(),

  // Jalon 8 — Anthropic
  ANTHROPIC_API_KEY: z.string().optional(),
  ANTHROPIC_MODEL: z.string().default('claude-sonnet-4-6'),

  // Jalon 9 — Web Push
  VAPID_PUBLIC_KEY: z.string().optional(),
  VAPID_PRIVATE_KEY: z.string().optional(),
  VAPID_SUBJECT: z.string().optional(),

  // Jalon 10 — Sentry
  SENTRY_DSN: z.string().url().optional(),
  SENTRY_AUTH_TOKEN: z.string().optional(),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error("❌ Variables d'environnement invalides :");
  for (const issue of parsed.error.issues) {
    console.error(`  - ${issue.path.join('.')}: ${issue.message}`);
  }
  throw new Error('Configuration invalide. Voir .env.example.');
}

export const env = parsed.data;
export type Env = z.infer<typeof envSchema>;
