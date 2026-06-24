import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * V2 S2 — Server Action tests for `completeOnboardingAction`.
 *
 * The action is the LAST step of the access journey (CONTEXTE GLOBAL ›
 * Onboarding & accès, points 5-6): the acceptance link → profile creation →
 * auto-login → land on the GUIDED profiling interview, "c'est là que commence
 * l'accumulation de données". The single most regression-prone line is the
 * post-login destination: a 4th-pass fix changed it from `/dashboard` (an empty
 * dashboard) to `/onboarding/interview`. The symmetric login contract is pinned
 * (`login/actions.test.ts:116` asserts `redirectTo: '/dashboard'`) but this one
 * was NOT — so an accidental revert to `/dashboard` would have shipped green.
 * These tests lock the contract and the failure branches.
 *
 * Mocking strategy mirrors `login/actions.test.ts`: every collaborator is
 * mocked (`@/auth.signIn`, `@/lib/auth/onboarding.completeOnboarding`,
 * `next/headers`, `next/navigation.redirect`) so the action's OWN branching is
 * what we exercise. The real `onboardingSchema` is used (pure Zod) so the
 * happy-path input must actually validate.
 */

const signInMock = vi.fn<(...args: unknown[]) => unknown>();
const completeOnboardingMock = vi.fn<(...args: unknown[]) => unknown>();
const headersMock = vi.fn<(...args: unknown[]) => Promise<Headers>>();
const redirectMock = vi.fn<(url: string) => never>((url: string) => {
  // Mirror Next's `redirect`: throw a NEXT_REDIRECT-shaped error so callers
  // that don't expect a return value behave as in production.
  throw Object.assign(new Error('NEXT_REDIRECT'), { digest: `NEXT_REDIRECT;replace;${url}` });
});

vi.mock('@/auth', () => ({ signIn: signInMock }));
vi.mock('@/lib/auth/onboarding', () => ({ completeOnboarding: completeOnboardingMock }));
vi.mock('next/headers', () => ({ headers: headersMock }));
vi.mock('next/navigation', () => ({ redirect: redirectMock }));

const { completeOnboardingAction } = await import('./actions');

const VALID = {
  token: 'invitation-token-abcdef123456', // ≥ 20 chars
  firstName: 'Jean',
  lastName: 'Dupont',
  password: 'whatever12345', // ≥ 12, not in the denylist
  passwordConfirm: 'whatever12345',
  consentRgpd: 'true',
};

function makeForm(fields: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return fd;
}

beforeEach(() => {
  signInMock.mockReset();
  completeOnboardingMock.mockReset();
  headersMock.mockReset();
  redirectMock.mockClear();
  headersMock.mockResolvedValue(new Headers({ 'x-forwarded-for': '203.0.113.42' }));
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('completeOnboardingAction — happy path lands on the profiling interview', () => {
  // THE contract: after creating the account, sign the member in and send them
  // to /onboarding/interview (NOT /dashboard). signIn throws NEXT_REDIRECT to
  // navigate; the action must let that bubble. A revert to /dashboard — the bug
  // the 4th pass fixed — would fail this assertion.
  it('calls signIn with redirectTo "/onboarding/interview" and lets the redirect bubble', async () => {
    completeOnboardingMock.mockResolvedValueOnce({ ok: true, email: 'jean@example.com' });
    const redirectErr = Object.assign(new Error('NEXT_REDIRECT'), {
      digest: 'NEXT_REDIRECT;replace;/onboarding/interview',
    });
    signInMock.mockRejectedValueOnce(redirectErr);

    await expect(completeOnboardingAction(null, makeForm(VALID))).rejects.toBe(redirectErr);

    expect(signInMock).toHaveBeenCalledTimes(1);
    expect(signInMock).toHaveBeenCalledWith('credentials', {
      email: 'jean@example.com',
      password: 'whatever12345',
      redirectTo: '/onboarding/interview',
    });
    // The NEXT_REDIRECT bubbled — the catch fallback must NOT have fired.
    expect(redirectMock).not.toHaveBeenCalled();
  });
});

describe('completeOnboardingAction — token consumption failures', () => {
  // A failed token consumption (expired / already used / …) returns the reason
  // and must NEVER reach signIn (no session for a non-created account).
  it('returns { ok:false, error } and never signs in when completeOnboarding fails', async () => {
    completeOnboardingMock.mockResolvedValueOnce({ ok: false, reason: 'expired' });

    const result = await completeOnboardingAction(null, makeForm(VALID));

    expect(result).toEqual({ ok: false, error: 'expired' });
    expect(signInMock).not.toHaveBeenCalled();
    expect(redirectMock).not.toHaveBeenCalled();
  });
});

describe('completeOnboardingAction — auto-login failure fallback', () => {
  // If the account is created but signIn throws a NON-redirect error (rare env
  // mismatch / DB hiccup), the account exists — don't surface "unknown". Send
  // the member to /login with a success notice instead.
  it('redirects to /login?onboarding=success when signIn throws a non-redirect error', async () => {
    completeOnboardingMock.mockResolvedValueOnce({ ok: true, email: 'jean@example.com' });
    signInMock.mockRejectedValueOnce(new Error('credentials provider unavailable'));

    // The fallback `redirect()` throws its own NEXT_REDIRECT → the call rejects.
    await expect(completeOnboardingAction(null, makeForm(VALID))).rejects.toMatchObject({
      digest: 'NEXT_REDIRECT;replace;/login?onboarding=success',
    });

    expect(redirectMock).toHaveBeenCalledTimes(1);
    expect(redirectMock).toHaveBeenCalledWith('/login?onboarding=success');
  });
});

describe('completeOnboardingAction — invalid input', () => {
  // Malformed input is rejected BEFORE the token is consumed or any session is
  // created — no side effects.
  it("returns { error: 'invalid_input', fieldErrors } and touches nothing else", async () => {
    const result = await completeOnboardingAction(
      null,
      makeForm({ ...VALID, passwordConfirm: 'does-not-match' }),
    );

    expect(result.ok).toBe(false);
    expect(result.error).toBe('invalid_input');
    expect(result.fieldErrors?.passwordConfirm).toBeTruthy();
    expect(completeOnboardingMock).not.toHaveBeenCalled();
    expect(signInMock).not.toHaveBeenCalled();
  });
});
