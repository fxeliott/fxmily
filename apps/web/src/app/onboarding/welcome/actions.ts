'use server';

import { headers } from 'next/headers';

import { onboardingSchema } from '@/lib/schemas/auth';
import { completeOnboarding } from '@/lib/auth/onboarding';
import { signIn } from '@/auth';

export interface OnboardingActionState {
  ok: boolean;
  error?:
    | 'invalid_input'
    | 'invalid_token'
    | 'expired'
    | 'already_used'
    | 'email_taken'
    | 'unknown';
  fieldErrors?: Partial<
    Record<'firstName' | 'lastName' | 'password' | 'passwordConfirm' | 'consentRgpd', string>
  >;
}

export async function completeOnboardingAction(
  _prev: OnboardingActionState | null,
  formData: FormData,
): Promise<OnboardingActionState> {
  const raw = {
    token: formData.get('token'),
    firstName: formData.get('firstName'),
    lastName: formData.get('lastName'),
    password: formData.get('password'),
    passwordConfirm: formData.get('passwordConfirm'),
    consentRgpd: formData.get('consentRgpd') === 'on' || formData.get('consentRgpd') === 'true',
  };

  const parsed = onboardingSchema.safeParse(raw);
  if (!parsed.success) {
    const fieldErrors: NonNullable<OnboardingActionState['fieldErrors']> = {};
    for (const issue of parsed.error.issues) {
      const key = issue.path[0];
      if (
        key === 'firstName' ||
        key === 'lastName' ||
        key === 'password' ||
        key === 'passwordConfirm' ||
        key === 'consentRgpd'
      ) {
        fieldErrors[key] ??= issue.message;
      }
    }
    return { ok: false, error: 'invalid_input', fieldErrors };
  }

  const headerList = await headers();
  const ip =
    headerList.get('x-forwarded-for')?.split(',')[0]?.trim() ?? headerList.get('x-real-ip') ?? null;
  const userAgent = headerList.get('user-agent');

  const result = await completeOnboarding({
    plainToken: parsed.data.token,
    firstName: parsed.data.firstName,
    lastName: parsed.data.lastName,
    password: parsed.data.password,
    consentRgpdAt: new Date(),
    ip,
    userAgent,
  });

  if (!result.ok) {
    return { ok: false, error: result.reason };
  }

  // Auto-login the freshly-created user.
  try {
    await signIn('credentials', {
      email: result.email,
      password: parsed.data.password,
      redirectTo: '/dashboard',
    });
    return { ok: true };
  } catch (err) {
    if (
      err &&
      typeof err === 'object' &&
      'digest' in err &&
      typeof (err as { digest?: unknown }).digest === 'string' &&
      (err as { digest: string }).digest.startsWith('NEXT_REDIRECT')
    ) {
      throw err;
    }
    // Onboarding succeeded but auto-login failed — surface a soft error,
    // the user can still log in manually.
    return { ok: false, error: 'unknown' };
  }
}
