'use server';

import { headers } from 'next/headers';
import { redirect } from 'next/navigation';

import { completePasswordReset } from '@/lib/auth/password-reset';
import { callerIdTrusted } from '@/lib/rate-limit/token-bucket';
import { resetPasswordSchema } from '@/lib/schemas/auth';

export interface ResetPasswordActionState {
  ok: boolean;
  error?: 'invalid_input' | 'invalid_token' | 'expired' | 'already_used' | 'inactive' | 'unknown';
  fieldErrors?: Partial<Record<'password' | 'passwordConfirm', string>>;
}

/**
 * Completes the "mot de passe oublié" flow (SPEC §7.1). UNAUTHENTICATED — the
 * single-use token IS the proof of identity.
 *
 * No rate-limit bucket here: `completePasswordReset` consumes the token
 * atomically (`usedAt = null` predicate), so a brute force would need to guess a
 * 192-bit token before the 30-min TTL — the token entropy is the throttle, not a
 * bucket. On success we DON'T auto-login: `tokenVersion` was just bumped (all
 * JWTs revoked) and a fresh deliberate login confirms the new password works.
 */
export async function resetPasswordAction(
  _prev: ResetPasswordActionState | null,
  formData: FormData,
): Promise<ResetPasswordActionState> {
  const parsed = resetPasswordSchema.safeParse({
    token: formData.get('token'),
    password: formData.get('password'),
    passwordConfirm: formData.get('passwordConfirm'),
  });
  if (!parsed.success) {
    const fieldErrors: NonNullable<ResetPasswordActionState['fieldErrors']> = {};
    for (const issue of parsed.error.issues) {
      const key = issue.path[0];
      if (key === 'password' || key === 'passwordConfirm') {
        fieldErrors[key] ??= issue.message;
      }
    }
    // A bad/short token (read from a tampered URL) has no field to attach to →
    // surface it as a top-level invalid_token rather than a silent no-op.
    if (Object.keys(fieldErrors).length === 0) {
      return { ok: false, error: 'invalid_token' };
    }
    return { ok: false, error: 'invalid_input', fieldErrors };
  }

  const reqHeaders = await headers();
  const ip = callerIdTrusted({ headers: reqHeaders });

  const result = await completePasswordReset({
    plainToken: parsed.data.token,
    password: parsed.data.password,
    ip,
    userAgent: reqHeaders.get('user-agent'),
  });

  if (!result.ok) {
    return { ok: false, error: result.reason };
  }

  // Land on /login with a success banner. `redirect()` throws NEXT_REDIRECT,
  // propagated by Next to perform the navigation — nothing runs after it.
  redirect('/login?reset=success');
}
