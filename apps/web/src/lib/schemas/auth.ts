import { z } from 'zod';

import { containsBidiOrZeroWidth, safeFreeText } from '@/lib/text/safe';

/**
 * Shared validation schemas for the authentication & invitation flows.
 *
 * These run on both the client (RHF + zodResolver) and the server (route handlers,
 * Auth.js authorize callback). Keeping a single source of truth avoids drift.
 *
 * Per SPEC §7.1 the user submits email + password on /login and supplies first/last
 * name + password during onboarding (after consuming an invitation token).
 */

const emailSchema = z
  .string({ message: 'Email requis.' })
  .trim()
  .toLowerCase()
  .max(254, 'Email trop long.') // RFC 5321 cap — bounds an unauthenticated input (defense-in-depth)
  .refine((s) => !containsBidiOrZeroWidth(s), 'Caractères de contrôle interdits.')
  .email('Email invalide.');

/**
 * Password rules (SPEC §9.2 — argon2id).
 * - 12 characters minimum to provide a healthy entropy floor.
 * - Reject the most common leak-list passwords via a denylist; we keep the list
 *   tiny here on purpose, the heavy lifting is left to argon2id + rate limiting.
 */
const COMMON_PASSWORDS = new Set([
  'password',
  'password1',
  '123456789012',
  'qwertyuiop12',
  'azertyuiop12',
  'fxmilyfxmily',
]);

const passwordSchema = z
  .string({ message: 'Mot de passe requis.' })
  .min(12, 'Le mot de passe doit faire au moins 12 caractères.')
  .max(256, 'Mot de passe trop long.')
  .refine(
    (v) => !COMMON_PASSWORDS.has(v.toLowerCase()),
    'Ce mot de passe est trop commun, choisis-en un autre.',
  );

const nameSchema = z
  .string({ message: 'Champ requis.' })
  .trim()
  .min(1, 'Champ requis.')
  .max(80, 'Trop long (80 caractères max).')
  .refine((s) => !containsBidiOrZeroWidth(s), 'Caractères de contrôle interdits.')
  .transform(safeFreeText);

/** /login form (email + password).
 *
 * `.max(256)` defense-in-depth against DoS via argon2id worker pool saturation
 * (CWE-400/770). Without this cap, `authorizeCredentials` would call
 * `verifyPassword(rawInput, hash)` on a multi-MB string — argon2id at
 * `memoryCost=19MiB + timeCost=2 + parallelism=1` pre-processes the entire
 * input before constant-time compare, exploding latency from ~150ms (12 chars)
 * to several hundred ms per request. Combined with login rate limits 10
 * burst/IP and 5/email (V1.12 P3), an attacker rotating ~10+ IPs can still
 * saturate the single-node CX22 worker thread. Cap at 256 chars matches the
 * `passwordSchema` (line ~40) used at onboarding — passwords above this
 * length would already have been rejected at account creation, so this
 * cap never affects a legitimate login flow. Safe-Parse fails fast BEFORE
 * any DB hit or rate-limit bucket consume (`authorize-credentials.ts:109-110`).
 */
export const signInSchema = z.object({
  email: emailSchema,
  password: z
    .string({ message: 'Mot de passe requis.' })
    .min(1, 'Mot de passe requis.')
    .max(256, 'Mot de passe trop long.'),
});
export type SignInInput = z.infer<typeof signInSchema>;

/** /admin/invite form. */
export const inviteSchema = z.object({
  email: emailSchema,
});
export type InviteInput = z.infer<typeof inviteSchema>;

/**
 * Public `/rejoindre` self-service access request (V2.5 — front door).
 *
 * Reuses `nameSchema` (safeFreeText + bidi/zero-width refine = Trojan-Source
 * canon Fxmily — these names are rendered back to the admin and could one day
 * feed an LLM prompt) and `emailSchema` (trim + lowercase + bidi refine). The
 * form is submitted UNAUTHENTICATED, so `.strict()` rejects any extra field a
 * crafted request might smuggle in.
 */
export const accessRequestSchema = z
  .object({
    firstName: nameSchema,
    lastName: nameSchema,
    email: emailSchema,
  })
  .strict();
export type AccessRequestInput = z.infer<typeof accessRequestSchema>;

/**
 * /onboarding/welcome form.
 * `token` is read from the URL `?token=…` and submitted with the form, but the
 * server is the one validating it against the DB (the client schema only checks
 * shape, not freshness or uniqueness).
 */
export const onboardingSchema = z
  .object({
    token: z
      .string({ message: 'Lien invalide.' })
      .min(20, 'Lien invalide.')
      .max(128, 'Lien invalide.'),
    firstName: nameSchema,
    lastName: nameSchema,
    password: passwordSchema,
    passwordConfirm: z.string(),
    consentRgpd: z.literal(true, {
      message: 'Tu dois accepter la politique de confidentialité pour continuer.',
    }),
  })
  .refine((d) => d.password === d.passwordConfirm, {
    message: 'Les mots de passe ne correspondent pas.',
    path: ['passwordConfirm'],
  });
export type OnboardingInput = z.infer<typeof onboardingSchema>;

/** Magic-link request form (forgot password). */
export const magicLinkSchema = z.object({
  email: emailSchema,
});
export type MagicLinkInput = z.infer<typeof magicLinkSchema>;
