import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * J2 — suppression list unit tests (item 9 : "transitions bounce").
 *
 * `db` is fully mocked; we assert the pure transformation (email normalisation)
 * and the exact upsert payload the webhook relies on to mark an address as
 * hard-bounced / complained. No Postgres, no network.
 */

const { findUniqueMock, upsertMock } = vi.hoisted(() => ({
  findUniqueMock: vi.fn(),
  upsertMock: vi.fn(),
}));

vi.mock('@/lib/db', () => ({
  db: { emailSuppression: { findUnique: findUniqueMock, upsert: upsertMock } },
}));

import { isEmailSuppressed, normalizeEmail, upsertSuppression } from './suppression';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('normalizeEmail', () => {
  it('trims surrounding whitespace and lowercases', () => {
    expect(normalizeEmail('  User@Bounce.COM  ')).toBe('user@bounce.com');
  });

  it('is idempotent on an already-normalised address', () => {
    expect(normalizeEmail('a@b.com')).toBe('a@b.com');
  });
});

describe('isEmailSuppressed', () => {
  it('returns false when no suppression row exists', async () => {
    findUniqueMock.mockResolvedValue(null);

    await expect(isEmailSuppressed('a@b.com')).resolves.toBe(false);
  });

  it('returns true when a suppression row exists', async () => {
    findUniqueMock.mockResolvedValue({ email: 'a@b.com' });

    await expect(isEmailSuppressed('a@b.com')).resolves.toBe(true);
  });

  it('looks up the NORMALISED address (mixed case in → lowercase query)', async () => {
    findUniqueMock.mockResolvedValue(null);

    await isEmailSuppressed('  A@B.COM ');

    expect(findUniqueMock).toHaveBeenCalledWith({
      where: { email: 'a@b.com' },
      select: { email: true },
    });
  });
});

describe('upsertSuppression', () => {
  it('normalises the email and writes the reason on both create and update', async () => {
    upsertMock.mockResolvedValue({});

    await upsertSuppression({
      email: '  Hard@Bounce.COM ',
      reason: 'hard_bounce',
      bounceType: 'Permanent',
      bounceSubType: 'General',
      resendEmailId: 'eid_1',
      userId: 'usr_1',
    });

    const arg = upsertMock.mock.calls[0]?.[0];
    expect(arg?.where).toEqual({ email: 'hard@bounce.com' });
    expect(arg?.create).toMatchObject({
      email: 'hard@bounce.com',
      reason: 'hard_bounce',
      bounceType: 'Permanent',
      bounceSubType: 'General',
      resendEmailId: 'eid_1',
      userId: 'usr_1',
    });
    // create and update carry the same reason/metadata (idempotent re-delivery).
    expect(arg?.update).toMatchObject({ reason: 'hard_bounce' });
  });

  it('coerces optional metadata to null (complaint without bounce details)', async () => {
    upsertMock.mockResolvedValue({});

    await upsertSuppression({ email: 'spam@y.com', reason: 'complaint' });

    const arg = upsertMock.mock.calls[0]?.[0];
    expect(arg?.create).toMatchObject({
      email: 'spam@y.com',
      reason: 'complaint',
      bounceType: null,
      bounceSubType: null,
      resendEmailId: null,
      userId: null,
    });
  });
});
