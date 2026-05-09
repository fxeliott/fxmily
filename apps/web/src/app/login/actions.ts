'use server';

import { headers } from 'next/headers';
import { AuthError } from 'next-auth';

import { signIn } from '@/auth';
import { logAudit } from '@/lib/auth/audit';
import { callerId, loginEmailLimiter, loginIpLimiter } from '@/lib/rate-limit/token-bucket';
import { signInSchema } from '@/lib/schemas/auth';

export interface SignInActionState {
  ok: boolean;
  error?: 'invalid_credentials' | 'invalid_input' | 'rate_limited' | 'unknown';
  retryAfterSec?: number;
  fieldErrors?: Partial<Record<'email' | 'password', string>>;
}

export async function signInAction(
  _prev: SignInActionState | null,
  formData: FormData,
): Promise<SignInActionState> {
  const raw = {
    email: formData.get('email'),
    password: formData.get('password'),
  };

  const parsed = signInSchema.safeParse(raw);
  if (!parsed.success) {
    const fieldErrors: NonNullable<SignInActionState['fieldErrors']> = {};
    for (const issue of parsed.error.issues) {
      const key = issue.path[0];
      if (key === 'email' || key === 'password') {
        fieldErrors[key] ??= issue.message;
      }
    }
    return { ok: false, error: 'invalid_input', fieldErrors };
  }

  // Phase T security promotion (2026-05-09) — credential-stuffing defense.
  // Two-bucket rate-limit : per-email (5 burst, 1/min) AND per-IP
  // (10 burst, 1/min). Either trip → 429-style error. Don't reveal WHICH
  // bucket was hit (anti-enumeration). The argon2id verify in
  // `auth.ts:authorize` costs ~150ms, so 10 attempts/min is far above any
  // legit human and well below an 8-card-distributed dictionary attack.
  const reqHeaders = await headers();
  const ip = callerId({ headers: reqHeaders });
  const emailKey = parsed.data.email.toLowerCase();
  const emailDecision = loginEmailLimiter.consume(emailKey);
  const ipDecision = loginIpLimiter.consume(ip);
  if (!emailDecision.allowed || !ipDecision.allowed) {
    const retryAfterMs = Math.max(emailDecision.retryAfterMs, ipDecision.retryAfterMs);
    await logAudit({
      action: 'auth.login.rate_limited',
      metadata: {
        kind:
          !emailDecision.allowed && !ipDecision.allowed
            ? 'both'
            : !emailDecision.allowed
              ? 'email'
              : 'ip',
        retryAfterMs,
      },
    }).catch(() => undefined);
    return {
      ok: false,
      error: 'rate_limited',
      retryAfterSec: Math.ceil(retryAfterMs / 1000),
    };
  }

  try {
    await signIn('credentials', {
      email: parsed.data.email,
      password: parsed.data.password,
      redirectTo: '/dashboard',
    });
    // signIn() throws a NEXT_REDIRECT to navigate; we never reach this line.
    return { ok: true };
  } catch (err) {
    // The `redirect()` thrown by `signIn` MUST be re-thrown so Next can handle
    // the navigation. Auth.js wraps it in a special internal error type — the
    // public-safe heuristic is to re-throw any error whose digest starts with
    // 'NEXT_REDIRECT'.
    if (
      err &&
      typeof err === 'object' &&
      'digest' in err &&
      typeof (err as { digest?: unknown }).digest === 'string' &&
      (err as { digest: string }).digest.startsWith('NEXT_REDIRECT')
    ) {
      throw err;
    }
    if (err instanceof AuthError) {
      return { ok: false, error: 'invalid_credentials' };
    }
    return { ok: false, error: 'unknown' };
  }
}
