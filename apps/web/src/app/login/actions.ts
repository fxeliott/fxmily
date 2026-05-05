'use server';

import { AuthError } from 'next-auth';

import { signIn } from '@/auth';
import { signInSchema } from '@/lib/schemas/auth';

export interface SignInActionState {
  ok: boolean;
  error?: 'invalid_credentials' | 'invalid_input' | 'unknown';
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
