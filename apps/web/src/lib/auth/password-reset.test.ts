/**
 * Password-reset service tests (Prisma-mocked) — SPEC §7.1 "mot de passe
 * oublié". Covers the full token lifecycle against a small in-memory Prisma
 * stand-in, so the SHA-256 hashed token produced by `createPasswordResetToken`
 * is actually consumed by `completePasswordReset`:
 *
 *   create token (hashed, prior tokens purged)
 *     → findResetTokenByToken round-trips a fresh token
 *     → completePasswordReset rotates passwordHash + bumps tokenVersion
 *     → idempotent: re-consuming the SAME token fails already_used (no 2nd bump)
 *     → expired / unknown token rejected
 *     → suspended user → token burned, reason inactive, password NOT changed
 *
 * Mocking style mirrors `onboarding.test.ts` (mock `@/lib/db`,
 * `@/lib/auth/audit`, `@/lib/auth/password`); the token hashing + the consume
 * branching stay REAL so we test the actual security contract.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

interface ResetTokenRow {
  id: string;
  userId: string;
  tokenHash: string;
  expiresAt: Date;
  usedAt: Date | null;
}
interface UserRow {
  id: string;
  email: string;
  firstName: string | null;
  status: string;
  passwordHash: string;
  tokenVersion: number;
}

const store = vi.hoisted(() => {
  return {
    tokens: [] as ResetTokenRow[],
    users: [] as UserRow[],
    tokenSeq: 0,
  };
});

function buildDbApi(s: typeof store) {
  const api = {
    passwordResetToken: {
      create: vi.fn(async ({ data }: { data: Omit<ResetTokenRow, 'id' | 'usedAt'> }) => {
        const row: ResetTokenRow = { id: `prt-${++s.tokenSeq}`, usedAt: null, ...data };
        s.tokens.push(row);
        return { id: row.id };
      }),
      deleteMany: vi.fn(async ({ where }: { where: { userId: string } }) => {
        const before = s.tokens.length;
        s.tokens = s.tokens.filter((t) => t.userId !== where.userId);
        return { count: before - s.tokens.length };
      }),
      findUnique: vi.fn(async ({ where }: { where: { tokenHash?: string; id?: string } }) => {
        const found = s.tokens.find(
          (t) =>
            (where.tokenHash !== undefined && t.tokenHash === where.tokenHash) ||
            (where.id !== undefined && t.id === where.id),
        );
        return found ? { ...found } : null;
      }),
      updateMany: vi.fn(
        async ({
          where,
          data,
        }: {
          where: { id: string; usedAt: null; expiresAt: { gt: Date } };
          data: { usedAt: Date };
        }) => {
          const row = s.tokens.find(
            (t) =>
              t.id === where.id &&
              t.usedAt === null &&
              t.expiresAt.getTime() > where.expiresAt.gt.getTime(),
          );
          if (!row) return { count: 0 };
          row.usedAt = data.usedAt;
          return { count: 1 };
        },
      ),
    },
    user: {
      updateMany: vi.fn(
        async ({
          where,
          data,
        }: {
          where: { id: string; status: string };
          data: { passwordHash: string; tokenVersion: { increment: number } };
        }) => {
          const row = s.users.find((u) => u.id === where.id && u.status === where.status);
          if (!row) return { count: 0 };
          row.passwordHash = data.passwordHash;
          row.tokenVersion += data.tokenVersion.increment;
          return { count: 1 };
        },
      ),
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) => {
        const found = s.users.find((u) => u.id === where.id);
        return found ? { email: found.email, firstName: found.firstName } : null;
      }),
    },
    $transaction: vi.fn(async (cb: (tx: typeof api) => Promise<unknown>) => cb(api)),
  };
  return api;
}

vi.mock('@/lib/db', () => ({ db: buildDbApi(store) }));
vi.mock('@/lib/auth/audit', () => ({ logAudit: vi.fn(async () => undefined) }));
vi.mock('@/lib/auth/password', () => ({
  hashPassword: vi.fn(async (pw: string) => `hashed:${pw}`),
}));
// The OWASP "password changed" confirmation is a best-effort side-effect of a
// successful reset — mock the sender so we assert it fires (and ONLY on success)
// without touching Resend, and the observability sink so a forced throw is
// swallowed into a warning rather than the test.
vi.mock('@/lib/email/send', () => ({
  sendPasswordChangedEmail: vi.fn(async () => ({ id: 'em-1', delivered: true })),
}));
vi.mock('@/lib/observability', () => ({
  reportWarning: vi.fn(() => undefined),
  reportError: vi.fn(() => undefined),
}));

import { db } from '@/lib/db';
import { sendPasswordChangedEmail } from '@/lib/email/send';
import { reportWarning } from '@/lib/observability';

import {
  PASSWORD_RESET_TTL_MS,
  completePasswordReset,
  createPasswordResetToken,
  findResetTokenByToken,
  generateResetToken,
  hashResetToken,
} from './password-reset';

const NEW_PASSWORD = 'Brand-New-Pwd!2026';

function seedUser(overrides: Partial<UserRow> = {}): UserRow {
  const row: UserRow = {
    id: 'user-1',
    email: 'alice@fxmily.local',
    firstName: 'Alice',
    status: 'active',
    passwordHash: 'hashed:old-password',
    tokenVersion: 3,
    ...overrides,
  };
  store.users.push(row);
  return row;
}

beforeEach(() => {
  store.tokens = [];
  store.users = [];
  store.tokenSeq = 0;
  vi.clearAllMocks();
});

describe('generateResetToken', () => {
  it('produces a 32-character URL-safe token', () => {
    const token = generateResetToken();
    expect(token).toHaveLength(32);
    expect(token).toMatch(/^[A-Za-z0-9_-]{32}$/);
  });

  it('produces unique tokens across many calls', () => {
    const tokens = new Set<string>();
    for (let i = 0; i < 200; i++) tokens.add(generateResetToken());
    expect(tokens.size).toBe(200);
  });
});

describe('hashResetToken', () => {
  it('returns a 64-character lowercase hex string (SHA-256)', () => {
    expect(hashResetToken('any-input')).toMatch(/^[0-9a-f]{64}$/);
  });

  it('is deterministic and avalanche-sensitive', () => {
    expect(hashResetToken('alpha')).toBe(hashResetToken('alpha'));
    expect(hashResetToken('alpha')).not.toBe(hashResetToken('alphb'));
  });
});

describe('PASSWORD_RESET_TTL_MS', () => {
  it('is exactly 30 minutes', () => {
    expect(PASSWORD_RESET_TTL_MS).toBe(30 * 60 * 1000);
  });
});

describe('createPasswordResetToken', () => {
  it('stores ONLY the hash (never the plain token) and returns the plain token', async () => {
    seedUser();
    const { plainToken, expiresAt } = await createPasswordResetToken('user-1');

    expect(store.tokens).toHaveLength(1);
    expect(store.tokens[0]!.tokenHash).toBe(hashResetToken(plainToken));
    expect(store.tokens[0]!.tokenHash).not.toBe(plainToken);
    expect(expiresAt.getTime()).toBeGreaterThan(Date.now());
  });

  it('purges prior tokens so at most one row ever exists per user', async () => {
    seedUser();
    await createPasswordResetToken('user-1');
    await createPasswordResetToken('user-1');
    await createPasswordResetToken('user-1');

    const mine = store.tokens.filter((t) => t.userId === 'user-1');
    expect(mine).toHaveLength(1);
  });

  it('honours a custom TTL', async () => {
    seedUser();
    const before = Date.now();
    const { expiresAt } = await createPasswordResetToken('user-1', 1000);
    expect(expiresAt.getTime()).toBeGreaterThanOrEqual(before + 1000 - 50);
    expect(expiresAt.getTime()).toBeLessThanOrEqual(Date.now() + 1000 + 50);
  });
});

describe('findResetTokenByToken', () => {
  it('round-trips a fresh valid token', async () => {
    seedUser();
    const { plainToken } = await createPasswordResetToken('user-1');
    const lookup = await findResetTokenByToken(plainToken);
    expect(lookup.ok).toBe(true);
    if (!lookup.ok) throw new Error('expected ok');
    expect(lookup.token.userId).toBe('user-1');
  });

  it('reports unknown for a token that was never issued', async () => {
    const lookup = await findResetTokenByToken('never-issued-token-00000000000000');
    expect(lookup.ok).toBe(false);
    if (lookup.ok) throw new Error('expected err');
    expect(lookup.reason).toBe('unknown');
  });

  it('reports expired for a past-TTL token', async () => {
    seedUser();
    const { plainToken } = await createPasswordResetToken('user-1', -1000);
    const lookup = await findResetTokenByToken(plainToken);
    expect(lookup.ok).toBe(false);
    if (lookup.ok) throw new Error('expected err');
    expect(lookup.reason).toBe('expired');
  });

  it('reports already_used after consumption', async () => {
    seedUser();
    const { plainToken } = await createPasswordResetToken('user-1');
    await completePasswordReset({ plainToken, password: NEW_PASSWORD });
    const lookup = await findResetTokenByToken(plainToken);
    expect(lookup.ok).toBe(false);
    if (lookup.ok) throw new Error('expected err');
    expect(lookup.reason).toBe('already_used');
  });
});

describe('completePasswordReset', () => {
  it('rotates the password hash and bumps tokenVersion (revokes all JWTs)', async () => {
    const user = seedUser({ tokenVersion: 3 });
    const { plainToken } = await createPasswordResetToken('user-1');

    const result = await completePasswordReset({ plainToken, password: NEW_PASSWORD });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected success');
    expect(result.userId).toBe('user-1');
    expect(user.passwordHash).toBe(`hashed:${NEW_PASSWORD}`);
    expect(user.tokenVersion).toBe(4); // 3 → 4
    expect(store.tokens[0]!.usedAt).not.toBeNull();
  });

  it('is idempotent: re-consuming the SAME token fails already_used with no 2nd bump', async () => {
    const user = seedUser({ tokenVersion: 3 });
    const { plainToken } = await createPasswordResetToken('user-1');

    const first = await completePasswordReset({ plainToken, password: NEW_PASSWORD });
    expect(first.ok).toBe(true);
    expect(user.tokenVersion).toBe(4);

    const second = await completePasswordReset({ plainToken, password: 'Another-Pwd!2026' });
    expect(second.ok).toBe(false);
    if (second.ok) throw new Error('expected failure');
    expect(second.reason).toBe('already_used');
    expect(user.tokenVersion).toBe(4); // unchanged
    expect(user.passwordHash).toBe(`hashed:${NEW_PASSWORD}`); // unchanged
  });

  it('rejects an unknown token (invalid_token), changing nothing', async () => {
    const user = seedUser();
    const result = await completePasswordReset({
      plainToken: 'never-issued-token-00000000000000',
      password: NEW_PASSWORD,
    });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected failure');
    expect(result.reason).toBe('invalid_token');
    expect(user.passwordHash).toBe('hashed:old-password');
  });

  it('rejects an expired token (expired), changing nothing', async () => {
    const user = seedUser();
    const { plainToken } = await createPasswordResetToken('user-1', -1000);
    const result = await completePasswordReset({ plainToken, password: NEW_PASSWORD });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected failure');
    expect(result.reason).toBe('expired');
    expect(user.passwordHash).toBe('hashed:old-password');
  });

  it('burns the token but refuses a suspended user (inactive), password unchanged', async () => {
    const user = seedUser({ status: 'suspended' });
    const { plainToken } = await createPasswordResetToken('user-1');

    const result = await completePasswordReset({ plainToken, password: NEW_PASSWORD });

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected failure');
    expect(result.reason).toBe('inactive');
    expect(user.passwordHash).toBe('hashed:old-password'); // NOT rotated
    expect(user.tokenVersion).toBe(3); // NOT bumped
    expect(store.tokens[0]!.usedAt).not.toBeNull(); // token still consumed (burned)
  });
});

describe('completePasswordReset — "password changed" confirmation (OWASP)', () => {
  it('sends the confirmation email to the member on a SUCCESSFUL reset', async () => {
    seedUser({ email: 'bob@fxmily.local', firstName: 'Bob' });
    const { plainToken } = await createPasswordResetToken('user-1');

    const result = await completePasswordReset({ plainToken, password: NEW_PASSWORD });

    expect(result.ok).toBe(true);
    expect(sendPasswordChangedEmail).toHaveBeenCalledTimes(1);
    expect(sendPasswordChangedEmail).toHaveBeenCalledWith({
      to: 'bob@fxmily.local',
      firstName: 'Bob',
    });
  });

  it('does NOT send on an unknown token (no reset happened)', async () => {
    seedUser();
    await completePasswordReset({
      plainToken: 'never-issued-token-00000000000000',
      password: NEW_PASSWORD,
    });
    expect(sendPasswordChangedEmail).not.toHaveBeenCalled();
  });

  it('does NOT send on an expired token', async () => {
    seedUser();
    const { plainToken } = await createPasswordResetToken('user-1', -1000);
    await completePasswordReset({ plainToken, password: NEW_PASSWORD });
    expect(sendPasswordChangedEmail).not.toHaveBeenCalled();
  });

  it('does NOT send when the member is suspended (token burned, password unchanged)', async () => {
    seedUser({ status: 'suspended' });
    const { plainToken } = await createPasswordResetToken('user-1');
    await completePasswordReset({ plainToken, password: NEW_PASSWORD });
    expect(sendPasswordChangedEmail).not.toHaveBeenCalled();
  });

  it('does NOT re-send on an idempotent second consume of the same token', async () => {
    seedUser();
    const { plainToken } = await createPasswordResetToken('user-1');

    await completePasswordReset({ plainToken, password: NEW_PASSWORD });
    await completePasswordReset({ plainToken, password: 'Another-Pwd!2026' });

    expect(sendPasswordChangedEmail).toHaveBeenCalledTimes(1); // first success only
  });

  it('a notify failure NEVER undoes the reset — result stays ok, warning is reported', async () => {
    const user = seedUser({ tokenVersion: 3 });
    const { plainToken } = await createPasswordResetToken('user-1');
    vi.mocked(sendPasswordChangedEmail).mockRejectedValueOnce(new Error('resend down'));

    const result = await completePasswordReset({ plainToken, password: NEW_PASSWORD });

    // The password is already rotated + JWTs revoked: a notify hiccup must not
    // flip the outcome to a failure.
    expect(result.ok).toBe(true);
    expect(user.passwordHash).toBe(`hashed:${NEW_PASSWORD}`);
    expect(user.tokenVersion).toBe(4);
    expect(reportWarning).toHaveBeenCalledWith(
      'password_reset.complete',
      'notify_email_failed',
      expect.objectContaining({ error: expect.stringContaining('resend down') }),
    );
  });

  it('forwards a null firstName verbatim (template falls back to a generic heading)', async () => {
    seedUser({ email: 'nameless@fxmily.local', firstName: null });
    const { plainToken } = await createPasswordResetToken('user-1');

    const result = await completePasswordReset({ plainToken, password: NEW_PASSWORD });

    expect(result.ok).toBe(true);
    expect(sendPasswordChangedEmail).toHaveBeenCalledWith({
      to: 'nameless@fxmily.local',
      firstName: null,
    });
  });

  it('if the user vanished between reset and notify, swallows it: no email, reset still ok', async () => {
    const user = seedUser({ tokenVersion: 3 });
    const { plainToken } = await createPasswordResetToken('user-1');
    // Defensive branch (`if (!user) return`): the post-reset read returns null
    // (e.g. a concurrent hard-delete). The reset is already committed.
    vi.mocked(db.user.findUnique).mockResolvedValueOnce(null);

    const result = await completePasswordReset({ plainToken, password: NEW_PASSWORD });

    expect(result.ok).toBe(true);
    expect(user.passwordHash).toBe(`hashed:${NEW_PASSWORD}`);
    expect(user.tokenVersion).toBe(4);
    expect(sendPasswordChangedEmail).not.toHaveBeenCalled();
    expect(reportWarning).not.toHaveBeenCalled(); // a missing row is NOT an error
  });
});
