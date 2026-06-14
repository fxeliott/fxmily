import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * S8 Mode Entraînement — Server Action tests for the backtest-SESSION
 * container (`createTrainingSessionAction` / `endTrainingSessionAction`).
 *
 * Mocking carbone `app/training/actions.test.ts`: `@/auth`, `next/navigation`,
 * `next/cache`, the session service + audit are mocked so we exercise the
 * action's branching, not Auth.js / Prisma. `trainingSessionCreateSchema` is
 * kept REAL (pure, no IO) so the fieldErrors contract is end-to-end exercised.
 *
 * 🚨 STATISTICAL ISOLATION (§21.5) is asserted: the audit metadata carries
 * ids/flags ONLY (never the member's free text `label` / `notes`), and
 * `revalidatePath` is NEVER called with `/journal` or `/dashboard`.
 */

const authMock = vi.fn<(...args: unknown[]) => Promise<unknown>>();
const redirectMock = vi.fn<(url: string) => never>((url: string) => {
  const err = Object.assign(new Error('NEXT_REDIRECT'), {
    digest: `NEXT_REDIRECT;replace;${url}`,
  });
  throw err;
});
const revalidatePathMock = vi.fn<(path: string) => void>();
const createTrainingSessionMock = vi.fn<(...args: unknown[]) => Promise<unknown>>();
const endTrainingSessionMock = vi.fn<(...args: unknown[]) => Promise<boolean>>();
const logAuditMock = vi.fn<(arg: unknown) => Promise<void>>(async () => undefined);

vi.mock('@/auth', () => ({ auth: authMock }));
vi.mock('next/navigation', () => ({ redirect: redirectMock }));
vi.mock('next/cache', () => ({ revalidatePath: revalidatePathMock }));
vi.mock('@/lib/training/training-session-service', () => ({
  createTrainingSession: createTrainingSessionMock,
  endTrainingSession: endTrainingSessionMock,
}));
vi.mock('@/lib/auth/audit', () => ({ logAudit: logAuditMock }));

const { createTrainingSessionAction, endTrainingSessionAction } = await import('./actions');

const MEMBER_ID = 'clx0member01';

function form(fields: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return fd;
}

beforeEach(() => {
  authMock.mockReset();
  redirectMock.mockClear();
  revalidatePathMock.mockReset();
  createTrainingSessionMock.mockReset();
  endTrainingSessionMock.mockReset();
  logAuditMock.mockClear();

  authMock.mockResolvedValue({ user: { id: MEMBER_ID, status: 'active' } });
  createTrainingSessionMock.mockResolvedValue({ id: 'ts_1' });
  endTrainingSessionMock.mockResolvedValue(true);
});

describe('createTrainingSessionAction — auth gate', () => {
  it('returns unauthorized when there is no session', async () => {
    authMock.mockResolvedValueOnce(null);
    const result = await createTrainingSessionAction(null, form({ label: 'X' }));
    expect(result).toEqual({ ok: false, error: 'unauthorized' });
    expect(createTrainingSessionMock).not.toHaveBeenCalled();
  });

  it('returns unauthorized when the user is not active', async () => {
    authMock.mockResolvedValueOnce({ user: { id: MEMBER_ID, status: 'suspended' } });
    const result = await createTrainingSessionAction(null, form({ label: 'X' }));
    expect(result).toEqual({ ok: false, error: 'unauthorized' });
  });
});

describe('createTrainingSessionAction — input validation (real Zod)', () => {
  it('rejects an out-of-allowlist symbol', async () => {
    const result = await createTrainingSessionAction(null, form({ symbol: 'DOGEUSD' }));
    expect(result.ok).toBe(false);
    if (result.ok === false) {
      expect(result.error).toBe('invalid_input');
      expect(result.fieldErrors?.symbol).toBeDefined();
    }
    expect(createTrainingSessionMock).not.toHaveBeenCalled();
  });

  it('rejects a malformed timeframe', async () => {
    const result = await createTrainingSessionAction(null, form({ timeframe: 'way too long tf' }));
    expect(result.ok).toBe(false);
    if (result.ok === false) {
      expect(result.error).toBe('invalid_input');
      expect(result.fieldErrors?.timeframe).toBeDefined();
    }
  });

  it('accepts an all-empty form (every field is optional)', async () => {
    await expect(createTrainingSessionAction(null, form({}))).rejects.toMatchObject({
      digest: expect.stringContaining('NEXT_REDIRECT'),
    });
    expect(createTrainingSessionMock).toHaveBeenCalledWith({
      userId: MEMBER_ID,
      label: null,
      symbol: null,
      timeframe: null,
      notes: null,
    });
  });
});

describe('createTrainingSessionAction — happy path + statistical isolation', () => {
  it('creates, audits PII-free, revalidates ONLY /training, redirects to the new session', async () => {
    await expect(
      createTrainingSessionAction(
        null,
        form({
          label: 'Range GBPUSD janvier',
          symbol: 'gbpusd',
          timeframe: 'h1',
          notes: 'Replay du range.',
        }),
      ),
    ).rejects.toMatchObject({ digest: expect.stringContaining('NEXT_REDIRECT') });

    expect(createTrainingSessionMock).toHaveBeenCalledWith({
      userId: MEMBER_ID,
      label: 'Range GBPUSD janvier',
      symbol: 'GBPUSD', // uppercased by the schema
      timeframe: 'H1',
      notes: 'Replay du range.',
    });

    // 🚨 §21.5 — audit metadata carries ids/flags ONLY, never label/notes.
    const auditArg = logAuditMock.mock.calls[0]?.[0] as {
      action: string;
      metadata: Record<string, unknown>;
    };
    expect(auditArg.action).toBe('training_session.created');
    expect(Object.keys(auditArg.metadata).sort()).toEqual([
      'hasSymbol',
      'hasTimeframe',
      'trainingSessionId',
    ]);
    expect(auditArg.metadata).not.toHaveProperty('label');
    expect(auditArg.metadata).not.toHaveProperty('notes');

    expect(revalidatePathMock).toHaveBeenCalledWith('/training');
    expect(revalidatePathMock).not.toHaveBeenCalledWith('/journal');
    expect(revalidatePathMock).not.toHaveBeenCalledWith('/dashboard');

    expect(redirectMock.mock.calls[0]?.[0]).toBe('/training/sessions/ts_1');
  });

  it('returns unknown when the service throws (no audit, no redirect)', async () => {
    createTrainingSessionMock.mockRejectedValueOnce(new Error('pg down'));
    const result = await createTrainingSessionAction(null, form({ label: 'X' }));
    expect(result).toEqual({ ok: false, error: 'unknown' });
    expect(logAuditMock).not.toHaveBeenCalled();
    expect(redirectMock).not.toHaveBeenCalled();
  });
});

describe('endTrainingSessionAction', () => {
  it('returns unauthorized with no session', async () => {
    authMock.mockResolvedValueOnce(null);
    expect(await endTrainingSessionAction('ts_1')).toEqual({ ok: false, error: 'unauthorized' });
    expect(endTrainingSessionMock).not.toHaveBeenCalled();
  });

  it('ends an owned session, audits, revalidates both surfaces', async () => {
    const res = await endTrainingSessionAction('ts_1');
    expect(res).toEqual({ ok: true });
    expect(endTrainingSessionMock).toHaveBeenCalledWith('ts_1', MEMBER_ID, expect.any(Date));
    expect(logAuditMock).toHaveBeenCalledWith({
      action: 'training_session.ended',
      userId: MEMBER_ID,
      metadata: { trainingSessionId: 'ts_1' },
    });
    expect(revalidatePathMock).toHaveBeenCalledWith('/training');
    expect(revalidatePathMock).toHaveBeenCalledWith('/training/sessions/ts_1');
  });

  it('returns not_found when the service reports no matching row', async () => {
    endTrainingSessionMock.mockResolvedValueOnce(false);
    expect(await endTrainingSessionAction('nope')).toEqual({ ok: false, error: 'not_found' });
    expect(logAuditMock).not.toHaveBeenCalled();
  });
});
