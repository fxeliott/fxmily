import { afterEach, describe, expect, it, vi } from 'vitest';

// Mock all module-level dependencies BEFORE importing the SUT.
// Pattern J5 `app/checkin/actions.test.ts` carbone.
const authMock = vi.fn();
const logAuditMock = vi.fn();
const createPreTradeCheckMock = vi.fn();
const revalidatePathMock = vi.fn();
const redirectMock = vi.fn((path: string) => {
  // Simulate Next.js `redirect()` semantics: throws NEXT_REDIRECT with a
  // `digest` shaped like `NEXT_REDIRECT;replace;<path>;303`.
  const err = new Error('NEXT_REDIRECT') as Error & { digest: string };
  err.digest = `NEXT_REDIRECT;replace;${path};303`;
  throw err;
});

vi.mock('@/auth', () => ({ auth: authMock }));
vi.mock('@/lib/auth/audit', () => ({ logAudit: logAuditMock }));
vi.mock('@/lib/pre-trade/service', () => ({
  createPreTradeCheck: createPreTradeCheckMock,
}));
vi.mock('next/cache', () => ({ revalidatePath: revalidatePathMock }));
vi.mock('next/navigation', () => ({ redirect: redirectMock }));

const { submitPreTradeCheckAction } = await import('./actions');

afterEach(() => {
  authMock.mockReset();
  logAuditMock.mockReset();
  createPreTradeCheckMock.mockReset();
  revalidatePathMock.mockReset();
  redirectMock.mockClear();
});

function makeFormData(fields: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return fd;
}

const ACTIVE_SESSION = {
  user: { id: 'user_1', status: 'active' as const, timezone: 'Europe/Paris' },
};

const FROZEN_ROW = {
  id: 'ptc_HAPPY',
  userId: 'user_1',
  createdAt: '2026-05-26T15:30:00.000Z',
  reasonToTrade: 'edge' as const,
  emotionLabel: 'calme' as const,
  planAlignment: true,
  stopLossPredefined: true,
  linkedTradeId: null,
};

describe('submitPreTradeCheckAction — auth gate (defence in depth)', () => {
  it('returns unauthorized when there is no session', async () => {
    authMock.mockResolvedValueOnce(null);

    const result = await submitPreTradeCheckAction(null, makeFormData({}));

    expect(result).toEqual({ ok: false, error: 'unauthorized' });
    expect(createPreTradeCheckMock).not.toHaveBeenCalled();
    expect(logAuditMock).not.toHaveBeenCalled();
    expect(redirectMock).not.toHaveBeenCalled();
  });

  it('returns unauthorized when session.user.status is not "active" (e.g. "pending")', async () => {
    authMock.mockResolvedValueOnce({
      user: { id: 'user_1', status: 'pending', timezone: 'Europe/Paris' },
    });

    const result = await submitPreTradeCheckAction(null, makeFormData({}));

    expect(result).toEqual({ ok: false, error: 'unauthorized' });
    expect(createPreTradeCheckMock).not.toHaveBeenCalled();
  });
});

describe('submitPreTradeCheckAction — Zod safeParse rejection', () => {
  it('returns invalid_input with fieldErrors when reasonToTrade is unknown', async () => {
    authMock.mockResolvedValueOnce(ACTIVE_SESSION);

    const fd = makeFormData({
      reasonToTrade: 'yolo', // outside enum
      emotionLabel: 'calme',
      planAlignment: 'on',
      stopLossPredefined: 'on',
    });

    const result = await submitPreTradeCheckAction(null, fd);

    expect(result.ok).toBe(false);
    expect(result.error).toBe('invalid_input');
    expect(result.fieldErrors).toBeDefined();
    expect(result.fieldErrors).toHaveProperty('reasonToTrade');
    expect(createPreTradeCheckMock).not.toHaveBeenCalled();
    expect(logAuditMock).not.toHaveBeenCalled();
    expect(redirectMock).not.toHaveBeenCalled();
  });

  it('returns invalid_input when emotionLabel is unknown (e.g. "neutre" outside Russell 2x2)', async () => {
    authMock.mockResolvedValueOnce(ACTIVE_SESSION);

    const fd = makeFormData({
      reasonToTrade: 'edge',
      emotionLabel: 'neutre',
      planAlignment: 'on',
      stopLossPredefined: 'on',
    });

    const result = await submitPreTradeCheckAction(null, fd);

    expect(result.ok).toBe(false);
    expect(result.error).toBe('invalid_input');
    expect(result.fieldErrors).toHaveProperty('emotionLabel');
  });
});

describe('submitPreTradeCheckAction — FormData boolean coercion (J5 footgun guard)', () => {
  it('coerces "on" (HTML checked checkbox) to true and absent fields to false', async () => {
    authMock.mockResolvedValueOnce(ACTIVE_SESSION);
    createPreTradeCheckMock.mockResolvedValueOnce({
      ...FROZEN_ROW,
      planAlignment: true,
      stopLossPredefined: false,
    });

    // planAlignment present as 'on' (checked), stopLossPredefined ABSENT
    // (unchecked checkboxes are NOT submitted in standard HTML form posts).
    const fd = makeFormData({
      reasonToTrade: 'edge',
      emotionLabel: 'calme',
      planAlignment: 'on',
    });

    await expect(submitPreTradeCheckAction(null, fd)).rejects.toThrow('NEXT_REDIRECT');

    expect(createPreTradeCheckMock).toHaveBeenCalledWith('user_1', {
      reasonToTrade: 'edge',
      emotionLabel: 'calme',
      planAlignment: true,
      stopLossPredefined: false,
    });
  });

  it('coerces literal "false" string to JS false (NOT the Boolean("false") === true footgun)', async () => {
    authMock.mockResolvedValueOnce(ACTIVE_SESSION);
    createPreTradeCheckMock.mockResolvedValueOnce({
      ...FROZEN_ROW,
      reasonToTrade: 'fomo',
      emotionLabel: 'excite',
      planAlignment: false,
      stopLossPredefined: false,
    });

    const fd = makeFormData({
      reasonToTrade: 'fomo',
      emotionLabel: 'excite',
      planAlignment: 'false',
      stopLossPredefined: 'false',
    });

    await expect(submitPreTradeCheckAction(null, fd)).rejects.toThrow('NEXT_REDIRECT');

    expect(createPreTradeCheckMock).toHaveBeenCalledWith('user_1', {
      reasonToTrade: 'fomo',
      emotionLabel: 'excite',
      planAlignment: false,
      stopLossPredefined: false,
    });
  });
});

describe('submitPreTradeCheckAction — happy path (persist + audit + revalidate + redirect)', () => {
  it('persists, audits PII-free with linkedTradeId:null placeholder, revalidates 2 paths, redirects', async () => {
    authMock.mockResolvedValueOnce(ACTIVE_SESSION);
    createPreTradeCheckMock.mockResolvedValueOnce(FROZEN_ROW);

    const fd = makeFormData({
      reasonToTrade: 'edge',
      emotionLabel: 'calme',
      planAlignment: 'on',
      stopLossPredefined: 'on',
    });

    await expect(submitPreTradeCheckAction(null, fd)).rejects.toThrow('NEXT_REDIRECT');

    expect(createPreTradeCheckMock).toHaveBeenCalledTimes(1);
    expect(createPreTradeCheckMock).toHaveBeenCalledWith('user_1', {
      reasonToTrade: 'edge',
      emotionLabel: 'calme',
      planAlignment: true,
      stopLossPredefined: true,
    });

    expect(logAuditMock).toHaveBeenCalledTimes(1);
    expect(logAuditMock).toHaveBeenCalledWith({
      action: 'pre_trade_check.created',
      userId: 'user_1',
      metadata: {
        checkId: 'ptc_HAPPY',
        reasonToTrade: 'edge',
        emotionLabel: 'calme',
        planAlignment: true,
        stopLossPredefined: true,
        linkedTradeId: null,
      },
    });

    expect(revalidatePathMock).toHaveBeenCalledWith('/dashboard');
    expect(revalidatePathMock).toHaveBeenCalledTimes(1);
    // V2.3.1 nit cleanup : `/pre-trade/new` revalidate retiré (page
    // `force-dynamic`, revalidate était un dead call).
    expect(revalidatePathMock).not.toHaveBeenCalledWith('/pre-trade/new');

    expect(redirectMock).toHaveBeenCalledWith('/dashboard?done=pre-trade');
  });
});

describe('submitPreTradeCheckAction — service failure', () => {
  it('returns unknown when createPreTradeCheck throws and does NOT audit / revalidate / redirect', async () => {
    authMock.mockResolvedValueOnce(ACTIVE_SESSION);
    createPreTradeCheckMock.mockRejectedValueOnce(
      Object.assign(new Error('connection lost'), { code: 'P1001' }),
    );
    const consoleErrSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const fd = makeFormData({
      reasonToTrade: 'edge',
      emotionLabel: 'calme',
      planAlignment: 'on',
      stopLossPredefined: 'on',
    });

    const result = await submitPreTradeCheckAction(null, fd);

    expect(result).toEqual({ ok: false, error: 'unknown' });
    expect(logAuditMock).not.toHaveBeenCalled();
    expect(revalidatePathMock).not.toHaveBeenCalled();
    expect(redirectMock).not.toHaveBeenCalled();

    consoleErrSpy.mockRestore();
  });
});
