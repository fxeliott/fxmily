import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * V1.12 P4 I1 — unit tests for `authorizeCredentials()`.
 *
 * Extracted from `auth.ts` inline-Credentials-provider callback at V1.12 P4
 * specifically to unlock `vi.mock()` of its dependencies — the previous
 * inline version pulled in the full `NextAuth({...})` config at module
 * top-level which made it untestable in isolation (security-auditor
 * V1.12 P3 finding I1).
 *
 * Coverage pinned :
 * - V1.12 P3 H1 sec — IP bucket trips via `/api/auth/callback/credentials`
 *   direct-POST path (was bypass before V1.12 P3 promoted the gate from
 *   the Server Action to the Credentials provider).
 * - V1.12 P4 L3 — both email-bucket AND ip-bucket audit rows carry
 *   `ip` (which `logAudit` hashes to top-level `ipHash` column for
 *   SHA-256 forensic correlation, no raw IP in DB).
 * - V1.12 P3 L1 — `headers()` failure falls open + emits
 *   `reportWarning('auth.authorize', ...)` so on-call detects future
 *   Edge-runtime regression (e.g. Auth.js v6 evolution).
 * - V1.10 sec hardening — `callerIdTrusted` reads END of XFF chain
 *   (Caddy-appended TCP-layer IP, non-spoofable post-V1.12 P1
 *   `header_up X-Forwarded-For {remote_host}` directive).
 *
 * Mocking strategy : we mock direct collaborators
 * (`next/headers`, `@/lib/auth/audit`, `@/lib/auth/password`,
 * `@/lib/observability`, the limiter singletons, `@/lib/db`) so the
 * function's branching logic is what we exercise, not the real Auth.js,
 * the real LRU map, or the real Prisma client. The real bucket math
 * has its own unit tests in `lib/rate-limit/token-bucket.test.ts`.
 *
 * `callerIdTrusted` is kept REAL so the IP-extraction logic is still
 * exercised end-to-end (tests pin a specific x-forwarded-for and
 * assert the IP key reaches the limiter + the audit row).
 */

// Typed mocks — without the type parameter, vitest narrows `mock.calls`
// to `never[]` under TS5+ + `noUncheckedIndexedAccess`, and assertions
// on call args would fail the type-check.
const headersMock = vi.fn<(...args: unknown[]) => Promise<Headers>>();
const loginEmailConsumeMock = vi.fn<(...args: unknown[]) => unknown>();
const loginIpConsumeMock = vi.fn<(...args: unknown[]) => unknown>();
const logAuditMock = vi.fn<(arg: unknown) => Promise<void>>(async () => undefined);
const reportWarningMock = vi.fn<(...args: unknown[]) => void>();
const verifyPasswordMock = vi.fn<(...args: unknown[]) => Promise<boolean>>();
const hashPasswordMock = vi.fn<(...args: unknown[]) => Promise<string>>();
const dbUserFindUniqueMock = vi.fn<(...args: unknown[]) => Promise<unknown>>();
const dbUserUpdateMock = vi.fn<(...args: unknown[]) => Promise<unknown>>();

vi.mock('next/headers', () => ({
  headers: headersMock,
}));

vi.mock('@/lib/auth/audit', () => ({
  logAudit: logAuditMock,
}));

vi.mock('@/lib/auth/password', () => ({
  verifyPassword: verifyPasswordMock,
  hashPassword: hashPasswordMock,
}));

vi.mock('@/lib/observability', () => ({
  reportWarning: reportWarningMock,
  // Other observability exports the SUT doesn't use — stub so any
  // transitive import doesn't blow up the module graph.
  reportError: vi.fn(),
  reportInfo: vi.fn(),
  reportBreadcrumb: vi.fn(),
}));

// Mock the two limiter singletons but keep `callerIdTrusted` real so the
// IP-extraction logic is still exercised end-to-end.
vi.mock('@/lib/rate-limit/token-bucket', async () => {
  const actual = await vi.importActual<typeof import('@/lib/rate-limit/token-bucket')>(
    '@/lib/rate-limit/token-bucket',
  );
  return {
    ...actual,
    loginEmailLimiter: { consume: loginEmailConsumeMock },
    loginIpLimiter: { consume: loginIpConsumeMock },
  };
});

vi.mock('@/lib/db', () => ({
  db: {
    user: {
      findUnique: dbUserFindUniqueMock,
      update: dbUserUpdateMock,
    },
  },
}));

const { authorizeCredentials, __resetDummyHashCacheForTests, DUMMY_PASSWORD_SENTINEL } =
  await import('./authorize-credentials');

beforeEach(() => {
  headersMock.mockReset();
  loginEmailConsumeMock.mockReset();
  loginIpConsumeMock.mockReset();
  logAuditMock.mockClear();
  reportWarningMock.mockReset();
  verifyPasswordMock.mockReset();
  hashPasswordMock.mockReset();
  dbUserFindUniqueMock.mockReset();
  dbUserUpdateMock.mockReset();

  // Clear the lazy-computed dummy hash cache so each test exercises the
  // `hashPassword` mock from a known state.
  __resetDummyHashCacheForTests();

  // Sensible defaults : real Headers carrying a stable Caddy-shaped XFF
  // (client public IP, then the trusted internal hop). `callerIdTrusted`
  // returns the LAST entry (V1.10 sec hardening — non-spoofable since
  // V1.12 P1 Caddyfile `header_up X-Forwarded-For {remote_host}`).
  headersMock.mockResolvedValue(new Headers({ 'x-forwarded-for': '198.51.100.7, 10.0.0.1' }));
  loginEmailConsumeMock.mockReturnValue({ allowed: true, remaining: 4, retryAfterMs: 0 });
  loginIpConsumeMock.mockReturnValue({ allowed: true, remaining: 9, retryAfterMs: 0 });
  hashPasswordMock.mockResolvedValue('$argon2id$v=19$m=19456,t=2,p=1$dummysalt$dummyhash');
  verifyPasswordMock.mockResolvedValue(false);
  dbUserFindUniqueMock.mockResolvedValue(null);
  dbUserUpdateMock.mockResolvedValue({ id: 'u1', lastSeenAt: new Date() });
});

describe('authorizeCredentials — Zod validation gate (V1.12 P3 ordering)', () => {
  // Why this matters : malformed payload must short-circuit BEFORE any
  // rate-limit consume() or DB query. Otherwise an attacker can deplete
  // a victim's bucket (or worse, run timing oracles) with garbage payloads.
  it('returns null on malformed input without touching limiters / headers / DB', async () => {
    const result = await authorizeCredentials({ email: 'not-an-email', password: '' });

    expect(result).toBeNull();
    expect(loginEmailConsumeMock).not.toHaveBeenCalled();
    expect(loginIpConsumeMock).not.toHaveBeenCalled();
    expect(headersMock).not.toHaveBeenCalled();
    expect(dbUserFindUniqueMock).not.toHaveBeenCalled();
    expect(logAuditMock).not.toHaveBeenCalled();
  });
});

describe('authorizeCredentials — IP rate-limit branch (V1.12 P3 H1 + V1.12 P4 L3)', () => {
  // Why this matters : the V1.12 P3 H1 fix promoted the IP bucket from
  // signInAction (Server Action) to authorize() (Credentials provider)
  // specifically to close the credential-stuffing bypass on
  // /api/auth/callback/credentials direct POSTs. We pin (a) IP key
  // extraction via callerIdTrusted (last-XFF), (b) the audit row tagged
  // kind='ip' source='authorize' (distinct from email bucket and from
  // signInAction path), (c) `ip` propagated to logAudit so the top-level
  // `ipHash` column gets populated (V1.12 P4 L3 forensic correlation).
  it('returns null + logs kind="ip" source="authorize" + ip propagated when IP bucket trips', async () => {
    loginIpConsumeMock.mockReturnValueOnce({ allowed: false, remaining: 0, retryAfterMs: 12500 });

    const result = await authorizeCredentials({
      email: 'eliot@fxmilyapp.com',
      password: 'whatever12345',
    });

    expect(result).toBeNull();
    // Last-XFF entry reaches the IP limiter (Caddy-trusted IP, V1.10).
    expect(loginIpConsumeMock).toHaveBeenCalledWith('10.0.0.1');
    // The audit row carries `ip` for hashing into `ipHash` column
    // (V1.12 P4 L3) + `source: 'authorize'` to distinguish from the
    // signInAction path.
    expect(logAuditMock).toHaveBeenCalledWith({
      action: 'auth.login.rate_limited',
      userId: null,
      ip: '10.0.0.1',
      metadata: {
        kind: 'ip',
        retryAfterMs: 12500,
        source: 'authorize',
      },
    });
    // V1.12 P3 H1 contract : no DB lookup once rate-limited (no
    // enumeration oracle, no timing leak, no wasted query).
    expect(dbUserFindUniqueMock).not.toHaveBeenCalled();
  });
});

describe('authorizeCredentials — email rate-limit branch (V1.12 P4 L3 ipHash on email row)', () => {
  // Why this matters : V1.12 P4 L3 specifically targets the email-bucket
  // audit row, which BEFORE this fix had no `ip` propagation because the
  // V1.12 P3 H1 fix only fetched `ip` inside the IP-bucket branch.
  // Now `ip` is extracted at the TOP of authorize() and propagated to
  // BOTH audit rows. Pin that contract here.
  it('returns null + logs kind="email" + ip propagated when email bucket trips', async () => {
    loginEmailConsumeMock.mockReturnValueOnce({
      allowed: false,
      remaining: 0,
      retryAfterMs: 30000,
    });

    const result = await authorizeCredentials({
      email: 'eliot@fxmilyapp.com',
      password: 'whatever12345',
    });

    expect(result).toBeNull();
    expect(logAuditMock).toHaveBeenCalledWith({
      action: 'auth.login.rate_limited',
      userId: null,
      ip: '10.0.0.1', // V1.12 P4 L3 — ipHash on email-bucket audit row
      metadata: {
        kind: 'email',
        retryAfterMs: 30000,
        source: 'authorize',
      },
    });
    // IP bucket NOT consulted — email tripped first, short-circuit.
    expect(loginIpConsumeMock).not.toHaveBeenCalled();
    expect(dbUserFindUniqueMock).not.toHaveBeenCalled();
  });
});

describe('authorizeCredentials — headers() failure (V1.12 P3 L1 fail-open + Sentry warning)', () => {
  // Why this matters : `headers()` is expected to be available in the
  // Auth.js v5 Route Handler context, but a future Auth.js evolution
  // (e.g. edge-runtime promotion) could break that assumption silently.
  // The V1.12 P3 L1 fix added a defensive try-catch + Sentry warning so
  // we DETECT the regression (vs degrading to no-IP-limit silently).
  // Behaviour : fail-open on the IP limiter (email bucket still hard-
  // enforces, signInAction Server Action still enforces IP).
  it('falls open with reportWarning when headers() throws, email path still gates', async () => {
    headersMock.mockRejectedValueOnce(new Error('headers unavailable'));

    const result = await authorizeCredentials({
      email: 'eliot@fxmilyapp.com',
      password: 'whatever12345',
    });

    // Sentry warning surfaces the regression to on-call.
    expect(reportWarningMock).toHaveBeenCalledWith(
      'auth.authorize',
      'headers_unavailable_ip_limit_skipped',
      { errorName: 'Error' },
    );
    // IP limiter NOT consulted because ip is null (fail-open).
    expect(loginIpConsumeMock).not.toHaveBeenCalled();
    // Email limiter STILL consulted (the only remaining gate in this branch).
    expect(loginEmailConsumeMock).toHaveBeenCalledWith('eliot@fxmilyapp.com');
    // No user in DB → null return from the user-lookup path (we mock
    // findUnique returning null by default).
    expect(result).toBeNull();
  });
});

describe('authorizeCredentials — happy path (constant-time + sanitized result)', () => {
  // Why this matters : on a valid credentials match, we must return the
  // canonical user shape that auth.config.ts callbacks expect (id, email,
  // name, image, role, status, timezone). Name composition trims +
  // collapses empty parts. lastSeenAt update is fire-and-forget (best-
  // effort, must NOT block return).
  it('returns sanitized user shape + audits success path + best-effort lastSeenAt update', async () => {
    dbUserFindUniqueMock.mockResolvedValueOnce({
      id: 'usr_cabc123',
      email: 'eliot@fxmilyapp.com',
      firstName: 'Eliot',
      lastName: 'Pena',
      image: null,
      passwordHash: '$argon2id$v=19$m=19456,t=2,p=1$realsalt$realhash',
      role: 'admin',
      status: 'active',
      timezone: 'Europe/Paris',
    });
    verifyPasswordMock.mockResolvedValueOnce(true);

    const result = await authorizeCredentials({
      email: 'eliot@fxmilyapp.com',
      password: 'realPwd123abcDEF',
    });

    expect(result).toEqual({
      id: 'usr_cabc123',
      email: 'eliot@fxmilyapp.com',
      // First + last name joined with a single space (registration Zod
      // schema sanitises individual fields, so the join contract is just
      // `[first, last].filter(Boolean).join(' ').trim()` — no internal
      // whitespace collapse, which is by design and matches V1 prod data).
      name: 'Eliot Pena',
      image: null,
      role: 'admin',
      status: 'active',
      timezone: 'Europe/Paris',
    });
    // lastSeenAt bump (fire-and-forget — the .catch() in the SUT must
    // swallow rejections without flipping the result to null).
    expect(dbUserUpdateMock).toHaveBeenCalledWith({
      where: { id: 'usr_cabc123' },
      data: { lastSeenAt: expect.any(Date) },
    });
    // Real password verified against the real (mocked) hash, NOT against
    // the dummy hash (which is only used in the no-user / no-password
    // branch for timing-defense parity).
    expect(verifyPasswordMock).toHaveBeenCalledWith(
      'realPwd123abcDEF',
      '$argon2id$v=19$m=19456,t=2,p=1$realsalt$realhash',
    );
    // No rate_limited / failure audit row on the success path. The
    // success row is emitted by Auth.js v5 `events.signIn` hook in
    // `auth.ts`, NOT inside authorize() — so this test pins that the
    // authorize() body itself does NOT log success.
    const auditCalls = logAuditMock.mock.calls.map(
      (call) => (call[0] as { action: string }).action,
    );
    expect(auditCalls).not.toContain('auth.login.success');
  });

  // Why this matters : the constant-time defense runs argon2 verify
  // against a dummy hash even when the user doesn't exist. Without it,
  // a fast-return on missing email creates an enumeration oracle
  // (~150ms diff for a real user). Pin that the dummy code path actually
  // calls verifyPassword (and that lastSeenAt is NOT bumped on null user).
  it('runs argon2 verify against dummy hash when user is missing (timing-defense)', async () => {
    dbUserFindUniqueMock.mockResolvedValueOnce(null);

    const result = await authorizeCredentials({
      email: 'nonexistent@fxmilyapp.com',
      password: 'whatever12345',
    });

    expect(result).toBeNull();
    // Dummy hash computed via the real hashPassword path (memoized
    // module-state, reset between tests). Import the same const from
    // the SUT to avoid magic-string drift (V1.12 P4 I1 audit L1).
    expect(hashPasswordMock).toHaveBeenCalledWith(DUMMY_PASSWORD_SENTINEL);
    // verifyPassword called against the dummy hash returned by the mock.
    expect(verifyPasswordMock).toHaveBeenCalledWith(
      'whatever12345',
      '$argon2id$v=19$m=19456,t=2,p=1$dummysalt$dummyhash',
    );
    // No lastSeenAt update on missing-user branch.
    expect(dbUserUpdateMock).not.toHaveBeenCalled();
    // Audit logs the failure WITHOUT userId (no enumeration leak — we
    // deliberately don't tie a failed login to a known account ID).
    // V1.12 P4 I1 (audit M2 fix) — `ip` propagated to failure rows too
    // so `ipHash` column populates for forensic correlation on
    // brute-force attempts that stay under the rate-limit threshold.
    expect(logAuditMock).toHaveBeenCalledWith({
      action: 'auth.login.failure',
      userId: null,
      ip: '10.0.0.1',
      metadata: { reason: 'unknown_or_no_password' },
    });
  });
});

describe('authorizeCredentials — inactive user (V1.12 P4 I1 audit M3 coverage)', () => {
  // Why this matters : a suspended / deleted user must NEVER pass auth
  // even with the correct password. Pin the audit row carries the user
  // status + userId (we KNOW who the account is at this point — no
  // enumeration concern, the password check was structurally not
  // needed for the branch) + `ip` for forensic correlation (V1.12 P4 I1
  // M2 fix). Also pin that `verifyPassword` is NEVER reached on this
  // branch — the inactive guard must short-circuit before the argon2
  // path to avoid burning ~150ms CPU on suspended accounts.
  it('returns null + audits reason="inactive" + ip propagated when user.status !== "active"', async () => {
    dbUserFindUniqueMock.mockResolvedValueOnce({
      id: 'usr_suspended_42',
      email: 'suspended@fxmilyapp.com',
      firstName: 'Suspended',
      lastName: 'User',
      image: null,
      passwordHash: '$argon2id$v=19$m=19456,t=2,p=1$realsalt$realhash',
      role: 'member',
      status: 'suspended', // <-- the guard tripper
      timezone: 'Europe/Paris',
    });

    const result = await authorizeCredentials({
      email: 'suspended@fxmilyapp.com',
      password: 'realPwd123abcDEF',
    });

    expect(result).toBeNull();
    expect(logAuditMock).toHaveBeenCalledWith({
      action: 'auth.login.failure',
      userId: 'usr_suspended_42',
      ip: '10.0.0.1',
      metadata: { reason: 'inactive', status: 'suspended' },
    });
    // The status guard short-circuits before the argon2 path : neither
    // verifyPassword nor lastSeenAt run. Avoids burning CPU on
    // suspended accounts.
    expect(verifyPasswordMock).not.toHaveBeenCalled();
    expect(dbUserUpdateMock).not.toHaveBeenCalled();
  });
});

describe('authorizeCredentials — bad password (V1.12 P4 I1 audit M3 coverage)', () => {
  // Why this matters : when a valid user exists but the password fails
  // verify, audit the failure with `userId` (we KNOW the account at this
  // point — the attacker already proved the email exists by reaching
  // this branch, so logging the userId is not an enumeration leak vs
  // the unknown_or_no_password branch) + `ip` for forensic correlation
  // (V1.12 P4 I1 M2 fix). Forensic query unlocked :
  //   SELECT ip_hash, COUNT(*) FROM audit_logs
  //   WHERE action='auth.login.failure'
  //     AND metadata->>'reason'='bad_password'
  //     AND user_id = '<target_user_id>'
  //   GROUP BY ip_hash;
  // → catches distributed brute-force on a single account.
  it('returns null + audits reason="bad_password" + ip propagated when verifyPassword fails', async () => {
    dbUserFindUniqueMock.mockResolvedValueOnce({
      id: 'usr_legit_99',
      email: 'legit@fxmilyapp.com',
      firstName: 'Legit',
      lastName: 'Member',
      image: null,
      passwordHash: '$argon2id$v=19$m=19456,t=2,p=1$realsalt$realhash',
      role: 'member',
      status: 'active',
      timezone: 'Europe/Paris',
    });
    verifyPasswordMock.mockResolvedValueOnce(false); // <-- the verify rejects

    const result = await authorizeCredentials({
      email: 'legit@fxmilyapp.com',
      password: 'wrong-guess-123',
    });

    expect(result).toBeNull();
    // verifyPassword IS called (we need to know the password is wrong
    // before the audit row fires — constant-time path).
    expect(verifyPasswordMock).toHaveBeenCalledWith(
      'wrong-guess-123',
      '$argon2id$v=19$m=19456,t=2,p=1$realsalt$realhash',
    );
    expect(logAuditMock).toHaveBeenCalledWith({
      action: 'auth.login.failure',
      userId: 'usr_legit_99',
      ip: '10.0.0.1',
      metadata: { reason: 'bad_password' },
    });
    // lastSeenAt NOT updated on bad password (the login failed).
    expect(dbUserUpdateMock).not.toHaveBeenCalled();
  });
});
