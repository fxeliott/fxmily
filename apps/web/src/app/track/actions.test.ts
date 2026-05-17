import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * V2.1 TRACK — Server Action tests for `submitHabitLogAction`.
 *
 * Critical logic surface (CLAUDE.md "tests pour la logique critique") :
 * auth gate + per-kind FormData → discriminated Zod parse + service
 * upsert + V1.12 P4 L3 ipHash audit + NEXT_REDIRECT contract. The wizard
 * UI itself is pure presentation (no test per CLAUDE.md "UI pure : pas
 * de tests").
 *
 * Mocking strategy carbone `app/login/actions.test.ts` : every collaborator
 * mocked (`@/auth`, `next/headers`, `next/navigation`, `next/cache`,
 * `@/lib/habit/service`, `@/lib/auth/audit`, `@/lib/observability`) so we
 * exercise the action's branching, not the real Auth.js / Prisma. The Zod
 * schema is kept REAL (it's pure, no IO) so the fieldErrors contract is
 * end-to-end exercised. `callerIdTrusted` kept REAL so IP extraction is
 * exercised.
 */

const authMock = vi.fn<(...args: unknown[]) => Promise<unknown>>();
const headersMock = vi.fn<(...args: unknown[]) => Promise<Headers>>();
const redirectMock = vi.fn<(url: string) => never>((url: string) => {
  // Next.js redirect() throws a NEXT_REDIRECT — replicate the contract so
  // tests can assert it bubbles (the action must NOT swallow it).
  const err = Object.assign(new Error('NEXT_REDIRECT'), {
    digest: `NEXT_REDIRECT;replace;${url}`,
  });
  throw err;
});
const revalidatePathMock = vi.fn<(path: string) => void>();
const upsertHabitLogMock = vi.fn<(...args: unknown[]) => Promise<unknown>>();
const logAuditMock = vi.fn<(arg: unknown) => Promise<void>>(async () => undefined);
const reportErrorMock = vi.fn<(...args: unknown[]) => void>();

vi.mock('@/auth', () => ({ auth: authMock }));
vi.mock('next/headers', () => ({ headers: headersMock }));
vi.mock('next/navigation', () => ({ redirect: redirectMock }));
vi.mock('next/cache', () => ({ revalidatePath: revalidatePathMock }));
vi.mock('@/lib/habit/service', () => ({ upsertHabitLog: upsertHabitLogMock }));
vi.mock('@/lib/auth/audit', () => ({ logAudit: logAuditMock }));
vi.mock('@/lib/observability', () => ({
  reportError: reportErrorMock,
  reportWarning: vi.fn(),
  reportInfo: vi.fn(),
  reportBreadcrumb: vi.fn(),
}));
vi.mock('@/lib/rate-limit/token-bucket', async () => {
  const actual = await vi.importActual<typeof import('@/lib/rate-limit/token-bucket')>(
    '@/lib/rate-limit/token-bucket',
  );
  return actual; // keep callerIdTrusted REAL
});

const { submitHabitLogAction } = await import('./actions');

function form(fields: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return fd;
}

const TODAY = new Date().toISOString().slice(0, 10);

beforeEach(() => {
  authMock.mockReset();
  headersMock.mockReset();
  redirectMock.mockClear();
  revalidatePathMock.mockReset();
  upsertHabitLogMock.mockReset();
  logAuditMock.mockClear();
  reportErrorMock.mockReset();

  headersMock.mockResolvedValue(new Headers({ 'x-forwarded-for': '198.51.100.7, 10.0.0.1' }));
  authMock.mockResolvedValue({ user: { id: 'usr_1', status: 'active' } });
  upsertHabitLogMock.mockResolvedValue({
    log: { id: 'h1', userId: 'usr_1', date: TODAY, kind: 'sleep' },
    wasNew: true,
  });
});

afterEach(() => {
  vi.useRealTimers();
});

describe('submitHabitLogAction — auth gate', () => {
  it('returns unauthorized when there is no session', async () => {
    authMock.mockResolvedValueOnce(null);
    const result = await submitHabitLogAction(
      null,
      form({ kind: 'sleep', date: TODAY, 'value.durationMin': '450' }),
    );
    expect(result).toEqual({ ok: false, error: 'unauthorized' });
    expect(upsertHabitLogMock).not.toHaveBeenCalled();
  });

  it('returns unauthorized when the user is not active (suspended JWT)', async () => {
    authMock.mockResolvedValueOnce({ user: { id: 'usr_1', status: 'suspended' } });
    const result = await submitHabitLogAction(
      null,
      form({ kind: 'sleep', date: TODAY, 'value.durationMin': '450' }),
    );
    expect(result).toEqual({ ok: false, error: 'unauthorized' });
    expect(upsertHabitLogMock).not.toHaveBeenCalled();
  });
});

describe('submitHabitLogAction — input validation', () => {
  it('returns invalid_input on an unknown kind (no builder branch)', async () => {
    const result = await submitHabitLogAction(
      null,
      form({ kind: 'alcohol', date: TODAY, 'value.durationMin': '60' }),
    );
    expect(result).toEqual({ ok: false, error: 'invalid_input' });
    expect(upsertHabitLogMock).not.toHaveBeenCalled();
  });

  it('returns invalid_input + fieldErrors when sleep durationMin is missing', async () => {
    const result = await submitHabitLogAction(
      null,
      form({ kind: 'sleep', date: TODAY }), // no value.durationMin → builder uses -1 → Zod min(0) fails
    );
    expect(result.ok).toBe(false);
    if (result.ok === false) {
      expect(result.error).toBe('invalid_input');
      expect(result.fieldErrors).toBeDefined();
    }
    expect(upsertHabitLogMock).not.toHaveBeenCalled();
  });

  it('returns invalid_input when the date is outside the [-14d,+1d] window', async () => {
    const result = await submitHabitLogAction(
      null,
      form({ kind: 'sleep', date: '2020-01-01', 'value.durationMin': '450' }),
    );
    expect(result.ok).toBe(false);
    if (result.ok === false) expect(result.error).toBe('invalid_input');
    expect(upsertHabitLogMock).not.toHaveBeenCalled();
  });
});

describe('submitHabitLogAction — happy path', () => {
  it('upserts + audits habit_log.upserted with ip propagated + redirects', async () => {
    await expect(
      submitHabitLogAction(
        null,
        form({
          kind: 'sleep',
          date: TODAY,
          'value.durationMin': '450',
          'value.quality': '8',
          notes: 'Réveil 3h',
        }),
      ),
    ).rejects.toMatchObject({ digest: `NEXT_REDIRECT;replace;/track?done=1&kind=sleep` });

    // Service called with the parsed discriminated union.
    expect(upsertHabitLogMock).toHaveBeenCalledTimes(1);
    expect(upsertHabitLogMock).toHaveBeenCalledWith('usr_1', {
      kind: 'sleep',
      date: TODAY,
      value: { durationMin: 450, quality: 8 },
      notes: 'Réveil 3h',
    });
    // V1.12 P4 L3 — `ip` propagated to logAudit (last-XFF entry, Caddy-trusted).
    expect(logAuditMock).toHaveBeenCalledWith({
      action: 'habit_log.upserted',
      userId: 'usr_1',
      ip: '10.0.0.1',
      metadata: { kind: 'sleep', wasNew: true, date: TODAY },
    });
    // Revalidate both surfaces.
    expect(revalidatePathMock).toHaveBeenCalledWith('/track');
    expect(revalidatePathMock).toHaveBeenCalledWith('/dashboard');
  });

  it('omits optional quality + notes when not provided (Zod .strict() respected)', async () => {
    await expect(
      submitHabitLogAction(null, form({ kind: 'sleep', date: TODAY, 'value.durationMin': '480' })),
    ).rejects.toMatchObject({ digest: expect.stringContaining('NEXT_REDIRECT') });

    expect(upsertHabitLogMock).toHaveBeenCalledWith('usr_1', {
      kind: 'sleep',
      date: TODAY,
      value: { durationMin: 480 },
    });
  });

  it('still redirects even if the audit write rejects (best-effort contract)', async () => {
    logAuditMock.mockRejectedValueOnce(new Error('audit DB down'));
    await expect(
      submitHabitLogAction(null, form({ kind: 'sleep', date: TODAY, 'value.durationMin': '420' })),
    ).rejects.toMatchObject({ digest: expect.stringContaining('NEXT_REDIRECT') });
    expect(upsertHabitLogMock).toHaveBeenCalledTimes(1);
  });

  it('falls open on headers() throw (ip null) but still upserts + audits', async () => {
    headersMock.mockRejectedValueOnce(new Error('headers unavailable'));
    await expect(
      submitHabitLogAction(null, form({ kind: 'sleep', date: TODAY, 'value.durationMin': '450' })),
    ).rejects.toMatchObject({ digest: expect.stringContaining('NEXT_REDIRECT') });
    expect(logAuditMock).toHaveBeenCalledWith({
      action: 'habit_log.upserted',
      userId: 'usr_1',
      ip: null,
      metadata: { kind: 'sleep', wasNew: true, date: TODAY },
    });
  });
});

describe('submitHabitLogAction — persistence failure', () => {
  it('returns persist_failed + reports the error when the service throws', async () => {
    upsertHabitLogMock.mockRejectedValueOnce(new Error('pg pool exhausted'));
    const result = await submitHabitLogAction(
      null,
      form({ kind: 'sleep', date: TODAY, 'value.durationMin': '450' }),
    );
    expect(result).toEqual({ ok: false, error: 'persist_failed' });
    expect(reportErrorMock).toHaveBeenCalledWith(
      'habit.upsert',
      expect.any(Error),
      expect.objectContaining({ userId: 'usr_1', kind: 'sleep' }),
    );
    // No redirect, no audit on the failure path.
    expect(redirectMock).not.toHaveBeenCalled();
    expect(logAuditMock).not.toHaveBeenCalled();
  });
});

describe('submitHabitLogAction — per-kind builders (V2.1.1)', () => {
  it('nutrition: parses mealsCount + optional quality enum + redirects', async () => {
    await expect(
      submitHabitLogAction(
        null,
        form({ kind: 'nutrition', date: TODAY, 'value.mealsCount': '3', 'value.quality': 'good' }),
      ),
    ).rejects.toMatchObject({ digest: `NEXT_REDIRECT;replace;/track?done=1&kind=nutrition` });
    expect(upsertHabitLogMock).toHaveBeenCalledWith('usr_1', {
      kind: 'nutrition',
      date: TODAY,
      value: { mealsCount: 3, quality: 'good' },
    });
  });

  it('nutrition: omits quality when not provided (Zod .strict() respected)', async () => {
    await expect(
      submitHabitLogAction(null, form({ kind: 'nutrition', date: TODAY, 'value.mealsCount': '2' })),
    ).rejects.toMatchObject({ digest: expect.stringContaining('NEXT_REDIRECT') });
    expect(upsertHabitLogMock).toHaveBeenCalledWith('usr_1', {
      kind: 'nutrition',
      date: TODAY,
      value: { mealsCount: 2 },
    });
  });

  it('nutrition: rejects an out-of-allowlist quality enum', async () => {
    const result = await submitHabitLogAction(
      null,
      form({ kind: 'nutrition', date: TODAY, 'value.mealsCount': '3', 'value.quality': 'amazing' }),
    );
    expect(result).toEqual(expect.objectContaining({ ok: false, error: 'invalid_input' }));
    expect(upsertHabitLogMock).not.toHaveBeenCalled();
  });

  it('caffeine: parses cups + optional HH:MM lastDrinkAtUtc + redirects', async () => {
    await expect(
      submitHabitLogAction(
        null,
        form({
          kind: 'caffeine',
          date: TODAY,
          'value.cups': '2',
          'value.lastDrinkAtUtc': '16:30',
        }),
      ),
    ).rejects.toMatchObject({ digest: `NEXT_REDIRECT;replace;/track?done=1&kind=caffeine` });
    expect(upsertHabitLogMock).toHaveBeenCalledWith('usr_1', {
      kind: 'caffeine',
      date: TODAY,
      value: { cups: 2, lastDrinkAtUtc: '16:30' },
    });
  });

  it('caffeine: rejects a malformed lastDrinkAtUtc (Zod HH:MM regex)', async () => {
    const result = await submitHabitLogAction(
      null,
      form({ kind: 'caffeine', date: TODAY, 'value.cups': '1', 'value.lastDrinkAtUtc': '25:99' }),
    );
    expect(result).toEqual(expect.objectContaining({ ok: false, error: 'invalid_input' }));
    expect(upsertHabitLogMock).not.toHaveBeenCalled();
  });

  it('sport: parses type + durationMin + optional intensityRating + redirects', async () => {
    await expect(
      submitHabitLogAction(
        null,
        form({
          kind: 'sport',
          date: TODAY,
          'value.type': 'cardio',
          'value.durationMin': '45',
          'value.intensityRating': '7',
        }),
      ),
    ).rejects.toMatchObject({ digest: `NEXT_REDIRECT;replace;/track?done=1&kind=sport` });
    expect(upsertHabitLogMock).toHaveBeenCalledWith('usr_1', {
      kind: 'sport',
      date: TODAY,
      value: { type: 'cardio', durationMin: 45, intensityRating: 7 },
    });
  });

  it('sport: returns invalid_input + fieldErrors when the required type is missing', async () => {
    const result = await submitHabitLogAction(
      null,
      form({ kind: 'sport', date: TODAY, 'value.durationMin': '30' }),
    );
    expect(result.ok).toBe(false);
    if (result.ok === false) {
      expect(result.error).toBe('invalid_input');
      expect(result.fieldErrors).toBeDefined();
    }
    expect(upsertHabitLogMock).not.toHaveBeenCalled();
  });

  it('meditation: parses durationMin + optional quality + redirects', async () => {
    await expect(
      submitHabitLogAction(
        null,
        form({
          kind: 'meditation',
          date: TODAY,
          'value.durationMin': '10',
          'value.quality': '8',
        }),
      ),
    ).rejects.toMatchObject({ digest: `NEXT_REDIRECT;replace;/track?done=1&kind=meditation` });
    expect(upsertHabitLogMock).toHaveBeenCalledWith('usr_1', {
      kind: 'meditation',
      date: TODAY,
      value: { durationMin: 10, quality: 8 },
    });
  });

  it('meditation: rejects a durationMin above the schema max (180)', async () => {
    const result = await submitHabitLogAction(
      null,
      form({ kind: 'meditation', date: TODAY, 'value.durationMin': '999' }),
    );
    expect(result).toEqual(expect.objectContaining({ ok: false, error: 'invalid_input' }));
    expect(upsertHabitLogMock).not.toHaveBeenCalled();
  });
});

describe('submitHabitLogAction — V1.9 R2 H1 timezone-authoritative window', () => {
  // Frozen instant: 2026-05-16T23:30Z. The Zod `dateField` refine (runs
  // first, UTC-anchored) treats UTC today = 2026-05-16 → its window is
  // [2026-05-02, 2026-05-17], so `2026-05-02` is exactly the −14d UTC
  // bound and PASSES Zod. The new action layer re-derives the member's
  // CIVIL window from `session.user.timezone`. Same date + same instant,
  // only the timezone differs → conclusively the tz-authoritative layer.
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-16T23:30:00Z'));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('closes the drift: rejects a Zod-valid date that is the 15th day back in the member CIVIL window (Paris default — unknown bucket)', async () => {
    // No `timezone` in the session → app default 'Europe/Paris' (CEST=+2):
    // civil today = 2026-05-17, window [2026-05-03, 2026-05-18]. 2026-05-02
    // is day-15 back → rejected by the new layer (Zod alone accepted it).
    const result = await submitHabitLogAction(
      null,
      form({ kind: 'sleep', date: '2026-05-02', 'value.durationMin': '450' }),
    );
    expect(result).toEqual({
      ok: false,
      error: 'invalid_input',
      fieldErrors: { date: [expect.stringContaining('hors fenêtre autorisée')] },
    });
    expect(upsertHabitLogMock).not.toHaveBeenCalled();
    expect(redirectMock).not.toHaveBeenCalled();
  });

  it('accepts the exact same Zod-valid date + instant when the member timezone makes it in-window (proves it is the tz layer, not a blanket Zod reject)', async () => {
    // timezone 'UTC' → civil today 2026-05-16, window [2026-05-02,
    // 2026-05-17]; 2026-05-02 is the inclusive −14d bound → accepted →
    // the action proceeds to the NEXT_REDIRECT contract.
    authMock.mockResolvedValue({ user: { id: 'usr_1', status: 'active', timezone: 'UTC' } });
    await expect(
      submitHabitLogAction(
        null,
        form({ kind: 'sleep', date: '2026-05-02', 'value.durationMin': '450' }),
      ),
    ).rejects.toMatchObject({ digest: 'NEXT_REDIRECT;replace;/track?done=1&kind=sleep' });
    expect(upsertHabitLogMock).toHaveBeenCalledTimes(1);
  });
});
