import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * J-T2 Mode Entraînement (SPEC §21) — Server Action tests for
 * `createTrainingTradeAction`.
 *
 * Critical logic surface (CLAUDE.md "tests pour la logique critique") :
 * auth gate + FormData → Zod re-parse + nullable bridge + BOLA + service
 * create + PII-free audit + revalidate isolation + NEXT_REDIRECT contract.
 * The wizard UI is pure presentation (no test per CLAUDE.md "UI pure : pas
 * de tests").
 *
 * Mocking strategy carbone `app/track/actions.test.ts` : `@/auth`,
 * `next/navigation`, `next/cache`, `@/lib/training/training-trade-service`,
 * `@/lib/auth/audit` mocked so we exercise the action's branching, not the
 * real Auth.js / Prisma. `trainingTradeCreateSchema` is kept REAL (pure, no
 * IO) so the fieldErrors contract is end-to-end exercised, and
 * `trainingKeyBelongsTo` is kept REAL so the BOLA gate is genuinely tested.
 *
 * 🚨 STATISTICAL ISOLATION (§21.5) is asserted explicitly: the audit
 * metadata carries ONLY `{ trainingTradeId }` (never resultR/outcome/lesson)
 * and `revalidatePath` is NEVER called with `/journal` or `/dashboard`.
 */

const authMock = vi.fn<(...args: unknown[]) => Promise<unknown>>();
const redirectMock = vi.fn<(url: string) => never>((url: string) => {
  const err = Object.assign(new Error('NEXT_REDIRECT'), {
    digest: `NEXT_REDIRECT;replace;${url}`,
  });
  throw err;
});
const revalidatePathMock = vi.fn<(path: string) => void>();
const createTrainingTradeMock = vi.fn<(...args: unknown[]) => Promise<unknown>>();
const logAuditMock = vi.fn<(arg: unknown) => Promise<void>>(async () => undefined);

vi.mock('@/auth', () => ({ auth: authMock }));
vi.mock('next/navigation', () => ({ redirect: redirectMock }));
vi.mock('next/cache', () => ({ revalidatePath: revalidatePathMock }));
vi.mock('@/lib/training/training-trade-service', () => ({
  createTrainingTrade: createTrainingTradeMock,
}));
vi.mock('@/lib/auth/audit', () => ({ logAudit: logAuditMock }));

const { createTrainingTradeAction } = await import('./actions');

const MEMBER_ID = 'clx0member01';
// A valid `training/{userId}/{nanoid32}.{ext}` key whose userId === MEMBER_ID
// (passes the Zod TRAINING_KEY_PATTERN AND the trainingKeyBelongsTo BOLA).
const OWN_KEY = `training/${MEMBER_ID}/cccccccccccccccccccccccccccccccc.png`;
// Same shape, different owner — passes Zod, fails the BOLA gate.
const FOREIGN_KEY = 'training/clx0other099/dddddddddddddddddddddddddddddddd.png';
const ENTERED_AT = new Date(Date.now() - 60_000).toISOString();

function form(fields: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return fd;
}

function validForm(overrides: Record<string, string> = {}): FormData {
  return form({
    pair: 'EURUSD',
    entryScreenshotKey: OWN_KEY,
    plannedRR: '2',
    systemRespected: 'true',
    lessonLearned: 'Entrée patiente, respect du plan.',
    enteredAt: ENTERED_AT,
    ...overrides,
  });
}

beforeEach(() => {
  authMock.mockReset();
  redirectMock.mockClear();
  revalidatePathMock.mockReset();
  createTrainingTradeMock.mockReset();
  logAuditMock.mockClear();

  authMock.mockResolvedValue({ user: { id: MEMBER_ID, status: 'active' } });
  createTrainingTradeMock.mockResolvedValue({ id: 'tt_1' });
});

afterEach(() => {
  vi.useRealTimers();
});

describe('createTrainingTradeAction — auth gate', () => {
  it('returns unauthorized when there is no session', async () => {
    authMock.mockResolvedValueOnce(null);
    const result = await createTrainingTradeAction(null, validForm());
    expect(result).toEqual({ ok: false, error: 'unauthorized' });
    expect(createTrainingTradeMock).not.toHaveBeenCalled();
  });

  it('returns unauthorized when the user is not active (suspended JWT)', async () => {
    authMock.mockResolvedValueOnce({ user: { id: MEMBER_ID, status: 'suspended' } });
    const result = await createTrainingTradeAction(null, validForm());
    expect(result).toEqual({ ok: false, error: 'unauthorized' });
    expect(createTrainingTradeMock).not.toHaveBeenCalled();
  });
});

describe('createTrainingTradeAction — input validation (real Zod)', () => {
  it('returns invalid_input + fieldErrors when pair is missing', async () => {
    const result = await createTrainingTradeAction(null, validForm({ pair: '' }));
    expect(result.ok).toBe(false);
    if (result.ok === false) {
      expect(result.error).toBe('invalid_input');
      expect(result.fieldErrors).toBeDefined();
      expect(result.fieldErrors?.pair).toBeDefined();
    }
    expect(createTrainingTradeMock).not.toHaveBeenCalled();
  });

  it('returns invalid_input + fieldErrors when lessonLearned is empty', async () => {
    const result = await createTrainingTradeAction(null, validForm({ lessonLearned: '' }));
    expect(result.ok).toBe(false);
    if (result.ok === false) {
      expect(result.error).toBe('invalid_input');
      expect(result.fieldErrors?.lessonLearned).toBeDefined();
    }
    expect(createTrainingTradeMock).not.toHaveBeenCalled();
  });

  it('rejects a non-training-prefixed screenshot key at the Zod layer', async () => {
    const result = await createTrainingTradeAction(
      null,
      validForm({ entryScreenshotKey: 'trades/clx0member01/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.png' }),
    );
    expect(result.ok).toBe(false);
    if (result.ok === false) expect(result.error).toBe('invalid_input');
    expect(createTrainingTradeMock).not.toHaveBeenCalled();
  });
});

describe('createTrainingTradeAction — BOLA (real trainingKeyBelongsTo)', () => {
  it('rejects a Zod-valid training key whose userId is NOT the session user', async () => {
    // FOREIGN_KEY is a perfectly-shaped training key (passes Zod) but its
    // path-owner segment is a different member → the BOLA gate must reject
    // it so a member cannot attach another member's upload to their backtest.
    const result = await createTrainingTradeAction(
      null,
      validForm({ entryScreenshotKey: FOREIGN_KEY }),
    );
    expect(result.ok).toBe(false);
    if (result.ok === false) {
      expect(result.error).toBe('invalid_input');
      expect(result.fieldErrors?.entryScreenshotKey).toBeDefined();
    }
    expect(createTrainingTradeMock).not.toHaveBeenCalled();
  });
});

describe('createTrainingTradeAction — happy path + statistical isolation', () => {
  it('creates with the nullable bridge, audits PII-free, revalidates ONLY /training, redirects', async () => {
    await expect(createTrainingTradeAction(null, validForm())).rejects.toMatchObject({
      digest: expect.stringContaining('NEXT_REDIRECT'),
    });

    // Service called once with outcome/resultR bridged to null (omitted in
    // the form) and systemRespected transformed true.
    expect(createTrainingTradeMock).toHaveBeenCalledTimes(1);
    expect(createTrainingTradeMock).toHaveBeenCalledWith({
      userId: MEMBER_ID,
      pair: 'EURUSD',
      entryScreenshotKey: OWN_KEY,
      plannedRR: 2,
      outcome: null,
      resultR: null,
      systemRespected: true,
      lessonLearned: 'Entrée patiente, respect du plan.',
      enteredAt: expect.any(Date),
    });

    // 🚨 §21.5 — audit metadata is EXACTLY { trainingTradeId }. Never the
    // P&L / behavioural payload.
    expect(logAuditMock).toHaveBeenCalledTimes(1);
    expect(logAuditMock).toHaveBeenCalledWith({
      action: 'training_trade.created',
      userId: MEMBER_ID,
      metadata: { trainingTradeId: 'tt_1' },
    });

    // 🚨 §21.5 — only the training surface is revalidated; the real edge is
    // never touched.
    expect(revalidatePathMock).toHaveBeenCalledWith('/training');
    expect(revalidatePathMock).not.toHaveBeenCalledWith('/journal');
    expect(revalidatePathMock).not.toHaveBeenCalledWith('/dashboard');

    // Redirect target is the training landing.
    const thrown = redirectMock.mock.calls[0]?.[0];
    expect(thrown).toBe('/training');
  });

  it('does NOT leak resultR/outcome/lessonLearned into the audit metadata even when provided', async () => {
    await expect(
      createTrainingTradeAction(
        null,
        validForm({ outcome: 'win', resultR: '1.8', lessonLearned: 'Secret backtest P&L note.' }),
      ),
    ).rejects.toMatchObject({ digest: expect.stringContaining('NEXT_REDIRECT') });

    const auditArg = logAuditMock.mock.calls[0]?.[0] as { metadata: Record<string, unknown> };
    expect(Object.keys(auditArg.metadata)).toEqual(['trainingTradeId']);
    expect(auditArg.metadata).not.toHaveProperty('resultR');
    expect(auditArg.metadata).not.toHaveProperty('outcome');
    expect(auditArg.metadata).not.toHaveProperty('lessonLearned');
    // The result still reaches the service (it belongs on the row, just not
    // in the audit trail).
    expect(createTrainingTradeMock).toHaveBeenCalledWith(
      expect.objectContaining({ outcome: 'win', resultR: 1.8 }),
    );
  });
});

describe('createTrainingTradeAction — persistence failure', () => {
  it('returns unknown and never audits/redirects when the service throws', async () => {
    createTrainingTradeMock.mockRejectedValueOnce(new Error('pg pool exhausted'));
    const result = await createTrainingTradeAction(null, validForm());
    expect(result).toEqual({ ok: false, error: 'unknown' });
    expect(logAuditMock).not.toHaveBeenCalled();
    expect(redirectMock).not.toHaveBeenCalled();
    expect(revalidatePathMock).not.toHaveBeenCalled();
  });
});
