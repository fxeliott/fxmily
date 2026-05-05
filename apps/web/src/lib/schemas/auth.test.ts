import { describe, expect, it } from 'vitest';

import { inviteSchema, onboardingSchema, signInSchema } from './auth';

describe('signInSchema', () => {
  it('accepts a valid email + password', () => {
    const result = signInSchema.safeParse({
      email: 'eliot@fxmily.com',
      password: 'whatever',
    });
    expect(result.success).toBe(true);
  });

  it('lowercases and trims the email', () => {
    const parsed = signInSchema.parse({
      email: '  Eliot@Fxmily.COM ',
      password: 'whatever',
    });
    expect(parsed.email).toBe('eliot@fxmily.com');
  });

  it('rejects an invalid email', () => {
    const result = signInSchema.safeParse({
      email: 'not-an-email',
      password: 'whatever',
    });
    expect(result.success).toBe(false);
  });

  it('rejects an empty password', () => {
    const result = signInSchema.safeParse({
      email: 'eliot@fxmily.com',
      password: '',
    });
    expect(result.success).toBe(false);
  });
});

describe('inviteSchema', () => {
  it('accepts a valid email', () => {
    const result = inviteSchema.safeParse({ email: 'new@member.com' });
    expect(result.success).toBe(true);
  });

  it('rejects a missing email', () => {
    const result = inviteSchema.safeParse({});
    expect(result.success).toBe(false);
  });
});

describe('onboardingSchema', () => {
  const valid = {
    token: 'a'.repeat(32),
    firstName: 'Elie',
    lastName: 'Pena',
    password: 'a-strong-pw-12chars',
    passwordConfirm: 'a-strong-pw-12chars',
    consentRgpd: true as const,
  };

  it('accepts a fully valid onboarding payload', () => {
    expect(onboardingSchema.safeParse(valid).success).toBe(true);
  });

  it('rejects when passwords do not match', () => {
    const result = onboardingSchema.safeParse({
      ...valid,
      passwordConfirm: 'mismatched-password-12',
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      const paths = result.error.issues.map((i) => i.path.join('.'));
      expect(paths).toContain('passwordConfirm');
    }
  });

  it('rejects passwords shorter than 12 characters', () => {
    const result = onboardingSchema.safeParse({
      ...valid,
      password: 'short',
      passwordConfirm: 'short',
    });
    expect(result.success).toBe(false);
  });

  it('rejects when consentRgpd is false', () => {
    const result = onboardingSchema.safeParse({ ...valid, consentRgpd: false });
    expect(result.success).toBe(false);
  });

  it('rejects a token shorter than 20 characters', () => {
    const result = onboardingSchema.safeParse({ ...valid, token: 'too-short' });
    expect(result.success).toBe(false);
  });

  it('rejects a password from the common-passwords denylist', () => {
    // 'fxmilyfxmily' is 12 chars and explicitly listed in COMMON_PASSWORDS.
    const result = onboardingSchema.safeParse({
      ...valid,
      password: 'fxmilyfxmily',
      passwordConfirm: 'fxmilyfxmily',
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      const messages = result.error.issues.map((i) => i.message).join(' ');
      expect(messages).toMatch(/trop commun/i);
    }
  });

  it('accepts a non-trivial password not on the denylist', () => {
    const result = onboardingSchema.safeParse({
      ...valid,
      password: 'PassWord1234', // 12 chars, not in the denylist
      passwordConfirm: 'PassWord1234',
    });
    expect(result.success).toBe(true);
  });
});
