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
const getTrainingSessionMetaMock = vi.fn<(...args: unknown[]) => Promise<unknown>>();
const logAuditMock = vi.fn<(arg: unknown) => Promise<void>>(async () => undefined);
const replyToTrainingAnnotationAsMemberMock = vi.fn<(...args: unknown[]) => Promise<unknown>>();
const enqueueTrainingReplyNotificationMock = vi.fn<(...args: unknown[]) => Promise<unknown>>(
  async () => undefined,
);
const sendTrainingReplyReceivedEmailMock = vi.fn<(...args: unknown[]) => Promise<unknown>>(
  async () => ({ id: 'em_1', delivered: true }),
);

vi.mock('@/auth', () => ({ auth: authMock }));
vi.mock('next/navigation', () => ({ redirect: redirectMock }));
vi.mock('next/cache', () => ({ revalidatePath: revalidatePathMock }));
vi.mock('@/lib/training/training-trade-service', () => ({
  createTrainingTrade: createTrainingTradeMock,
}));
vi.mock('@/lib/training/training-session-service', () => ({
  getTrainingSessionMeta: getTrainingSessionMetaMock,
}));
vi.mock('@/lib/training/training-annotation-member-service', () => ({
  replyToTrainingAnnotationAsMember: replyToTrainingAnnotationAsMemberMock,
}));
vi.mock('@/lib/notifications/enqueue', () => ({
  enqueueTrainingReplyNotification: enqueueTrainingReplyNotificationMock,
}));
vi.mock('@/lib/email/send', () => ({
  sendTrainingReplyReceivedEmail: sendTrainingReplyReceivedEmailMock,
}));
vi.mock('@/lib/auth/audit', () => ({ logAudit: logAuditMock }));

const { createTrainingTradeAction, replyToTrainingAnnotationAction } = await import('./actions');

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
    // J1 — the TradingView link is now the required primary field; the
    // screenshot key stays legacy-optional (still provided here to keep the
    // BOLA-guard tests exercising a present key).
    tradingViewUrl: 'https://www.tradingview.com/x/NQe0OrXz/',
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
  getTrainingSessionMetaMock.mockReset();
  logAuditMock.mockClear();
  replyToTrainingAnnotationAsMemberMock.mockReset();
  enqueueTrainingReplyNotificationMock.mockClear();
  sendTrainingReplyReceivedEmailMock.mockClear();

  authMock.mockResolvedValue({ user: { id: MEMBER_ID, status: 'active' } });
  createTrainingTradeMock.mockResolvedValue({ id: 'tt_1' });
  // Default: any session id provided is owned by the member AND still open
  // (overridden per-test for the not-owned / ended cases).
  getTrainingSessionMetaMock.mockResolvedValue({
    id: 'clx0session0000000001',
    label: null,
    isEnded: false,
  });
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

  it('rejects an off-host tradingViewUrl at the Zod layer (F1)', async () => {
    const result = await createTrainingTradeAction(
      null,
      validForm({ tradingViewUrl: 'https://evil.example.com/x/abc/' }),
    );
    expect(result.ok).toBe(false);
    if (result.ok === false) {
      expect(result.error).toBe('invalid_input');
      expect(result.fieldErrors?.tradingViewUrl).toBeDefined();
    }
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
      // J1 — the required TradingView link passes straight through to the service.
      tradingViewUrl: 'https://www.tradingview.com/x/NQe0OrXz/',
      plannedRR: 2,
      outcome: null,
      resultR: null,
      systemRespected: true,
      lessonLearned: 'Entrée patiente, respect du plan.',
      enteredAt: expect.any(Date),
      // S8 — standalone backtest (no session field in the form) → null.
      sessionId: null,
    });

    // 🚨 §21.5 — audit metadata is ids/flags ONLY. Never the P&L / behavioural
    // payload. `inSession` is a boolean flag, not member content.
    expect(logAuditMock).toHaveBeenCalledTimes(1);
    expect(logAuditMock).toHaveBeenCalledWith({
      action: 'training_trade.created',
      userId: MEMBER_ID,
      metadata: { trainingTradeId: 'tt_1', inSession: false },
    });

    // 🚨 §21.5 — only the training surface is revalidated; the real edge is
    // never touched.
    expect(revalidatePathMock).toHaveBeenCalledWith('/training');
    expect(revalidatePathMock).not.toHaveBeenCalledWith('/journal');
    expect(revalidatePathMock).not.toHaveBeenCalledWith('/dashboard');

    // Redirect target is the training landing (standalone backtest).
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
    expect(Object.keys(auditArg.metadata).sort()).toEqual(['inSession', 'trainingTradeId']);
    expect(auditArg.metadata).not.toHaveProperty('resultR');
    expect(auditArg.metadata).not.toHaveProperty('outcome');
    expect(auditArg.metadata).not.toHaveProperty('lessonLearned');
    // The result still reaches the service (it belongs on the row, just not
    // in the audit trail).
    expect(createTrainingTradeMock).toHaveBeenCalledWith(
      expect.objectContaining({ outcome: 'win', resultR: 1.8 }),
    );
  });

  it('P3 — forces resultR to null when outcome is ABSENT (analysis-only backtest)', async () => {
    // The wizard clears resultR when « Aucun » is selected, but a stale
    // localStorage draft or a crafted request can still post a result without
    // an outcome. The server silently drops it (no rejection) so a backtest
    // card can never show « EN ATTENTE » and a « RÉSULTAT x R » at once.
    await expect(
      createTrainingTradeAction(null, validForm({ resultR: '2' })),
    ).rejects.toMatchObject({ digest: expect.stringContaining('NEXT_REDIRECT') });

    expect(createTrainingTradeMock).toHaveBeenCalledTimes(1);
    expect(createTrainingTradeMock).toHaveBeenCalledWith(
      expect.objectContaining({ outcome: null, resultR: null }),
    );
  });

  it('P3 — forces resultR to null when outcome is EMPTY (« Aucun » radio)', async () => {
    await expect(
      createTrainingTradeAction(null, validForm({ outcome: '', resultR: '-1.5' })),
    ).rejects.toMatchObject({ digest: expect.stringContaining('NEXT_REDIRECT') });

    expect(createTrainingTradeMock).toHaveBeenCalledWith(
      expect.objectContaining({ outcome: null, resultR: null }),
    );
  });

  it('P3 — keeps resultR when a real outcome is noted (guard must not over-clean)', async () => {
    await expect(
      createTrainingTradeAction(null, validForm({ outcome: 'loss', resultR: '-1' })),
    ).rejects.toMatchObject({ digest: expect.stringContaining('NEXT_REDIRECT') });

    expect(createTrainingTradeMock).toHaveBeenCalledWith(
      expect.objectContaining({ outcome: 'loss', resultR: -1 }),
    );
  });

  it('passes a valid TradingView link through to the service (F1)', async () => {
    const url = 'https://www.tradingview.com/x/NQe0OrXz/';
    await expect(
      createTrainingTradeAction(null, validForm({ tradingViewUrl: url })),
    ).rejects.toMatchObject({ digest: expect.stringContaining('NEXT_REDIRECT') });

    expect(createTrainingTradeMock).toHaveBeenCalledWith(
      expect.objectContaining({ tradingViewUrl: url }),
    );
    // §21.5 — the link is process metadata; it must NEVER reach the audit trail.
    const auditArg = logAuditMock.mock.calls[0]?.[0] as { metadata: Record<string, unknown> };
    expect(auditArg.metadata).not.toHaveProperty('tradingViewUrl');
  });
});

describe('createTrainingTradeAction — F2 enteredAt interpreted in the member SET timezone', () => {
  // The wizard posts the RAW `datetime-local` wall-clock (no offset). The action
  // re-interprets it in `session.user.timezone` server-side (memberWallClock →
  // localWallClockToUtc), so the stored instant is correct even when the member's
  // DEVICE clock is in another zone. This is the symmetric mirror of the journal.
  it('converts a bare wall-clock in a member NY timezone (EDT = UTC-4) to the right UTC instant', async () => {
    authMock.mockResolvedValue({
      user: { id: MEMBER_ID, status: 'active', timezone: 'America/New_York' },
    });
    // 14:30 wall-clock on 2026-05-06 in New York (DST, UTC-4) → 18:30Z.
    await expect(
      createTrainingTradeAction(null, validForm({ enteredAt: '2026-05-06T14:30' })),
    ).rejects.toMatchObject({ digest: expect.stringContaining('NEXT_REDIRECT') });

    const arg = createTrainingTradeMock.mock.calls[0]?.[0] as { enteredAt: Date };
    expect(arg.enteredAt.toISOString()).toBe('2026-05-06T18:30:00.000Z');
  });

  it('interprets the SAME wall-clock differently for a Paris member (CEST = UTC+2 → 12:30Z)', async () => {
    authMock.mockResolvedValue({
      user: { id: MEMBER_ID, status: 'active', timezone: 'Europe/Paris' },
    });
    await expect(
      createTrainingTradeAction(null, validForm({ enteredAt: '2026-05-06T14:30' })),
    ).rejects.toMatchObject({ digest: expect.stringContaining('NEXT_REDIRECT') });

    const arg = createTrainingTradeMock.mock.calls[0]?.[0] as { enteredAt: Date };
    expect(arg.enteredAt.toISOString()).toBe('2026-05-06T12:30:00.000Z');
  });

  it('falls back to Europe/Paris when the session carries no timezone', async () => {
    // beforeEach default session has no `timezone` field → Paris fallback.
    await expect(
      createTrainingTradeAction(null, validForm({ enteredAt: '2026-05-06T14:30' })),
    ).rejects.toMatchObject({ digest: expect.stringContaining('NEXT_REDIRECT') });

    const arg = createTrainingTradeMock.mock.calls[0]?.[0] as { enteredAt: Date };
    expect(arg.enteredAt.toISOString()).toBe('2026-05-06T12:30:00.000Z');
  });

  it('still accepts an already-absolute ISO instant (Z suffix) unchanged', async () => {
    authMock.mockResolvedValue({
      user: { id: MEMBER_ID, status: 'active', timezone: 'America/New_York' },
    });
    await expect(
      createTrainingTradeAction(null, validForm({ enteredAt: '2026-05-06T18:30:00.000Z' })),
    ).rejects.toMatchObject({ digest: expect.stringContaining('NEXT_REDIRECT') });

    const arg = createTrainingTradeMock.mock.calls[0]?.[0] as { enteredAt: Date };
    expect(arg.enteredAt.toISOString()).toBe('2026-05-06T18:30:00.000Z');
  });
});

describe('createTrainingTradeAction — S8 session attach (ownership + open-state)', () => {
  const SESSION_ID = 'clx0session0000000001';

  it('attaches an OWNED+OPEN session, audits inSession:true, revalidates + redirects to the session', async () => {
    getTrainingSessionMetaMock.mockResolvedValue({ id: SESSION_ID, label: 'X', isEnded: false });

    await expect(
      createTrainingTradeAction(null, validForm({ sessionId: SESSION_ID })),
    ).rejects.toMatchObject({ digest: expect.stringContaining('NEXT_REDIRECT') });

    expect(getTrainingSessionMetaMock).toHaveBeenCalledWith(SESSION_ID, MEMBER_ID);
    expect(createTrainingTradeMock).toHaveBeenCalledWith(
      expect.objectContaining({ sessionId: SESSION_ID }),
    );
    expect(logAuditMock).toHaveBeenCalledWith({
      action: 'training_trade.created',
      userId: MEMBER_ID,
      metadata: { trainingTradeId: 'tt_1', inSession: true },
    });
    expect(revalidatePathMock).toHaveBeenCalledWith(`/training/sessions/${SESSION_ID}`);
    expect(redirectMock.mock.calls[0]?.[0]).toBe(`/training/sessions/${SESSION_ID}`);
  });

  it('rejects a session id NOT owned by the member (BOLA, meta=null) — no create, no redirect', async () => {
    getTrainingSessionMetaMock.mockResolvedValue(null);

    const result = await createTrainingTradeAction(null, validForm({ sessionId: SESSION_ID }));
    expect(result.ok).toBe(false);
    if (result.ok === false) {
      expect(result.error).toBe('invalid_input');
      expect(result.fieldErrors?.sessionId).toBeDefined();
    }
    expect(createTrainingTradeMock).not.toHaveBeenCalled();
    expect(redirectMock).not.toHaveBeenCalled();
  });

  it('rejects an ENDED session (consistency with /training/new) — no create, no redirect', async () => {
    getTrainingSessionMetaMock.mockResolvedValue({ id: SESSION_ID, label: 'X', isEnded: true });

    const result = await createTrainingTradeAction(null, validForm({ sessionId: SESSION_ID }));
    expect(result.ok).toBe(false);
    if (result.ok === false) {
      expect(result.error).toBe('invalid_input');
      expect(result.fieldErrors?.sessionId).toBeDefined();
    }
    expect(createTrainingTradeMock).not.toHaveBeenCalled();
    expect(redirectMock).not.toHaveBeenCalled();
  });

  it('rejects a malformed session id at the Zod layer before any ownership read', async () => {
    const result = await createTrainingTradeAction(null, validForm({ sessionId: 'nope!!' }));
    expect(result.ok).toBe(false);
    if (result.ok === false) expect(result.error).toBe('invalid_input');
    expect(getTrainingSessionMetaMock).not.toHaveBeenCalled();
    expect(createTrainingTradeMock).not.toHaveBeenCalled();
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

// =============================================================================
// S8 V2 §32-4 — member reply to a correction (notify-once + immediate email)
// =============================================================================

const ANN_ID = 'clx0annotation0001';
const TT_ID = 'clx0trainingtrade1';
const ADMIN_ID = 'clx0admin00000001';
const ADMIN_EMAIL = 'eliott@fxmily.test';

function replyForm(reply = 'Compris, je travaille la patience.'): FormData {
  return form({ trainingAnnotationId: ANN_ID, reply });
}

describe('replyToTrainingAnnotationAction — auth + isolation', () => {
  it('returns unauthorized when there is no active session', async () => {
    authMock.mockResolvedValueOnce(null);
    const result = await replyToTrainingAnnotationAction(null, replyForm());
    expect(result).toEqual({ ok: false, error: 'unauthorized' });
    expect(replyToTrainingAnnotationAsMemberMock).not.toHaveBeenCalled();
    expect(sendTrainingReplyReceivedEmailMock).not.toHaveBeenCalled();
  });

  it('returns invalid_input on an empty reply (Zod), never touching the service', async () => {
    const result = await replyToTrainingAnnotationAction(null, replyForm('   '));
    expect(result.ok).toBe(false);
    if (result.ok === false) expect(result.error).toBe('invalid_input');
    expect(replyToTrainingAnnotationAsMemberMock).not.toHaveBeenCalled();
    expect(sendTrainingReplyReceivedEmailMock).not.toHaveBeenCalled();
  });

  it('returns not_found when the service resolves null (foreign/deleted), no notify, no email', async () => {
    replyToTrainingAnnotationAsMemberMock.mockResolvedValueOnce(null);
    const result = await replyToTrainingAnnotationAction(null, replyForm());
    expect(result).toEqual({ ok: false, error: 'not_found' });
    expect(enqueueTrainingReplyNotificationMock).not.toHaveBeenCalled();
    expect(sendTrainingReplyReceivedEmailMock).not.toHaveBeenCalled();
  });
});

describe('replyToTrainingAnnotationAction — first reply fires push + immediate email', () => {
  it('enqueues the push AND sends the admin email exactly once on the first reply', async () => {
    replyToTrainingAnnotationAsMemberMock.mockResolvedValueOnce({
      trainingTradeId: TT_ID,
      adminId: ADMIN_ID,
      adminEmail: ADMIN_EMAIL,
      adminFirstName: 'Eliott',
      memberId: MEMBER_ID,
      isFirstReply: true,
    });

    const result = await replyToTrainingAnnotationAction(null, replyForm());

    expect(result.ok).toBe(true);
    expect(enqueueTrainingReplyNotificationMock).toHaveBeenCalledTimes(1);
    expect(enqueueTrainingReplyNotificationMock).toHaveBeenCalledWith(ADMIN_ID, {
      trainingAnnotationId: ANN_ID,
      trainingTradeId: TT_ID,
      memberId: MEMBER_ID,
    });
    expect(sendTrainingReplyReceivedEmailMock).toHaveBeenCalledTimes(1);
    expect(sendTrainingReplyReceivedEmailMock).toHaveBeenCalledWith({
      to: ADMIN_EMAIL,
      recipientFirstName: 'Eliott',
      memberId: MEMBER_ID,
      trainingTradeId: TT_ID,
    });
  });

  it('🚨 §21.5 — revalidates ONLY training surfaces, never /journal or /dashboard', async () => {
    replyToTrainingAnnotationAsMemberMock.mockResolvedValueOnce({
      trainingTradeId: TT_ID,
      adminId: ADMIN_ID,
      adminEmail: ADMIN_EMAIL,
      adminFirstName: null,
      memberId: MEMBER_ID,
      isFirstReply: true,
    });

    await replyToTrainingAnnotationAction(null, replyForm());

    const paths = revalidatePathMock.mock.calls.map((c) => c[0]);
    expect(paths).toContain(`/training/${TT_ID}`);
    expect(paths).toContain(`/admin/members/${MEMBER_ID}/training/${TT_ID}`);
    expect(paths.some((p) => p.startsWith('/journal') || p.startsWith('/dashboard'))).toBe(false);
  });
});

describe('replyToTrainingAnnotationAction — an edit must not re-ping the admin', () => {
  it('skips BOTH the push enqueue and the email when isFirstReply is false', async () => {
    replyToTrainingAnnotationAsMemberMock.mockResolvedValueOnce({
      trainingTradeId: TT_ID,
      adminId: ADMIN_ID,
      adminEmail: ADMIN_EMAIL,
      adminFirstName: 'Eliott',
      memberId: MEMBER_ID,
      isFirstReply: false,
    });

    const result = await replyToTrainingAnnotationAction(null, replyForm('Je corrige ma réponse.'));

    expect(result.ok).toBe(true);
    expect(enqueueTrainingReplyNotificationMock).not.toHaveBeenCalled();
    expect(sendTrainingReplyReceivedEmailMock).not.toHaveBeenCalled();
  });
});
