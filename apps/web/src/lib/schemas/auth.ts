import { z } from 'zod';

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
  .max(80, 'Trop long (80 caractères max).');

/** /login form (email + password). */
export const signInSchema = z.object({
  email: emailSchema,
  password: z.string({ message: 'Mot de passe requis.' }).min(1, 'Mot de passe requis.'),
});
export type SignInInput = z.infer<typeof signInSchema>;

/** /admin/invite form. */
export const inviteSchema = z.object({
  email: emailSchema,
});
export type InviteInput = z.infer<typeof inviteSchema>;

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
