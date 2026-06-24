import { afterEach, describe, expect, it, vi } from 'vitest';
import { ZodError } from 'zod';

import { PROCESS_FIDELITY_V1 } from '@/lib/tracking/instruments/process-fidelity-v1';

/**
 * V2 S2 — `submitTrackingInstrumentAction` unit suite. Carbone of
 * `app/pre-trade/actions.test.ts` : mocks every module-level dependency BEFORE
 * importing the SUT, then exercises the auth gate, the SERVER-SIDE response
 * rebuild (the §2 / "server is the only authority" invariant), the PII-free
 * audit, the revalidate/redirect happy path, and every error branch.
 *
 * `resolveCurrentInstrument` is mocked to return the REAL frozen
 * process-fidelity instrument so the action rebuilds `responses` from genuine
 * question ids (boolean/likert/single_choice) — the test proves the real
 * coercion, not a toy stub.
 */

const authMock = vi.fn();
const logAuditMock = vi.fn();
const reportErrorMock = vi.fn();
const submitTrackingEntryMock = vi.fn();
const resolveCurrentInstrumentMock = vi.fn();
const revalidatePathMock = vi.fn();
const redirectMock = vi.fn((path: string) => {
  const err = new Error('NEXT_REDIRECT') as Error & { digest: string };
  err.digest = `NEXT_REDIRECT;replace;${path};303`;
  throw err;
});

vi.mock('@/auth', () => ({ auth: authMock }));
vi.mock('@/lib/auth/audit', () => ({ logAudit: logAuditMock }));
vi.mock('@/lib/observability', () => ({ reportError: reportErrorMock }));
vi.mock('@/lib/tracking/service', () => ({
  submitTrackingEntry: submitTrackingEntryMock,
  resolveCurrentInstrument: resolveCurrentInstrumentMock,
  UnknownInstrumentError: class UnknownInstrumentError extends Error {
    constructor(key: string, version: string) {
      super(`Unknown tracking instrument: ${key}@${version}`);
      this.name = 'UnknownInstrumentError';
    }
  },
}));
vi.mock('next/cache', () => ({ revalidatePath: revalidatePathMock }));
vi.mock('next/navigation', () => ({ redirect: redirectMock }));

const { submitTrackingInstrumentAction } = await import('./actions');
const { UnknownInstrumentError } = await import('@/lib/tracking/service');

afterEach(() => {
  authMock.mockReset();
  logAuditMock.mockReset();
  reportErrorMock.mockReset();
  submitTrackingEntryMock.mockReset();
  resolveCurrentInstrumentMock.mockReset();
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

/** A fully-answered, valid process-fidelity submission as the wizard would post it. */
function fullForm(overrides: Record<string, string> = {}): FormData {
  return makeFormData({
    instrumentKey: 'process-fidelity',
    instrumentVersion: 'v1',
    occurrenceKey: '2026-W22',
    cut_20h: 'true',
    one_risk_trade_per_day: 'true',
    one_stop_per_day: 'false',
    stop_set_before_entry: 'true',
    risk_size_respected: 'true',
    breakeven_secured: 'false',
    prep_done_before_session: 'true',
    patience_anti_fomo: '4',
    no_revenge_after_loss: '3',
    felt_emotion: 'calm',
    confidenceLevel: '4',
    responseLatencyMs: '8200',
    ...overrides,
  });
}

const SUBMIT_OK = {
  entry: { occurrenceKey: '2026-W22' },
  wasNew: true,
};

describe('submitTrackingInstrumentAction — auth gate (defence in depth)', () => {
  it('returns unauthorized when there is no session', async () => {
    authMock.mockResolvedValueOnce(null);

    const result = await submitTrackingInstrumentAction(null, fullForm());

    expect(result).toEqual({ ok: false, error: 'unauthorized' });
    expect(resolveCurrentInstrumentMock).not.toHaveBeenCalled();
    expect(submitTrackingEntryMock).not.toHaveBeenCalled();
    expect(logAuditMock).not.toHaveBeenCalled();
    expect(redirectMock).not.toHaveBeenCalled();
  });

  it('returns unauthorized when session.user.status is not "active"', async () => {
    authMock.mockResolvedValueOnce({
      user: { id: 'user_1', status: 'pending', timezone: 'Europe/Paris' },
    });

    const result = await submitTrackingInstrumentAction(null, fullForm());

    expect(result).toEqual({ ok: false, error: 'unauthorized' });
    expect(submitTrackingEntryMock).not.toHaveBeenCalled();
  });
});

describe('submitTrackingInstrumentAction — unknown instrument slug', () => {
  it('returns unknown_instrument when the key resolves to nothing (stale link)', async () => {
    authMock.mockResolvedValueOnce(ACTIVE_SESSION);
    resolveCurrentInstrumentMock.mockReturnValueOnce(undefined);

    const result = await submitTrackingInstrumentAction(
      null,
      makeFormData({ instrumentKey: 'ghost' }),
    );

    expect(result).toEqual({ ok: false, error: 'unknown_instrument' });
    expect(submitTrackingEntryMock).not.toHaveBeenCalled();
    expect(logAuditMock).not.toHaveBeenCalled();
  });
});

describe('submitTrackingInstrumentAction — happy path (server-rebuilt responses)', () => {
  it('rebuilds responses by kind, persists, audits PII-free, revalidates 2 paths, redirects', async () => {
    authMock.mockResolvedValueOnce(ACTIVE_SESSION);
    resolveCurrentInstrumentMock.mockReturnValueOnce(PROCESS_FIDELITY_V1);
    submitTrackingEntryMock.mockResolvedValueOnce(SUBMIT_OK);

    await expect(submitTrackingInstrumentAction(null, fullForm())).rejects.toThrow('NEXT_REDIRECT');

    // Server rebuilt responses from the REAL instrument ids: booleans→bool,
    // likert→number, single_choice→string. confidence/latency lifted out.
    expect(submitTrackingEntryMock).toHaveBeenCalledTimes(1);
    expect(submitTrackingEntryMock).toHaveBeenCalledWith(
      'user_1',
      {
        instrumentKey: 'process-fidelity',
        instrumentVersion: 'v1',
        occurrenceKey: '2026-W22',
        responses: {
          cut_20h: true,
          one_risk_trade_per_day: true,
          one_stop_per_day: false,
          stop_set_before_entry: true,
          risk_size_respected: true,
          breakeven_secured: false,
          prep_done_before_session: true,
          patience_anti_fomo: 4,
          no_revenge_after_loss: 3,
          felt_emotion: 'calm',
        },
        confidenceLevel: 4,
        responseLatencyMs: 8200,
      },
      { timezone: 'Europe/Paris' },
    );

    // Audit is PII-FREE (§21.5/§2): ids + occurrence + axis + wasNew ONLY —
    // never the `responses` payload.
    expect(logAuditMock).toHaveBeenCalledTimes(1);
    expect(logAuditMock).toHaveBeenCalledWith({
      action: 'tracking_entry.submitted',
      userId: 'user_1',
      metadata: {
        instrumentKey: 'process-fidelity',
        instrumentVersion: 'v1',
        occurrenceKey: '2026-W22',
        axis: 'risk_discipline',
        wasNew: true,
      },
    });
    const auditArg = logAuditMock.mock.calls[0]![0] as { metadata: Record<string, unknown> };
    expect(auditArg.metadata).not.toHaveProperty('responses');

    expect(revalidatePathMock).toHaveBeenCalledWith('/tracking/process-fidelity');
    expect(revalidatePathMock).toHaveBeenCalledWith('/dashboard');
    expect(redirectMock).toHaveBeenCalledWith('/tracking/process-fidelity?done=1');
  });

  it('omits skipped optionals and never-finite confidence; drops a malformed boolean', async () => {
    authMock.mockResolvedValueOnce(ACTIVE_SESSION);
    resolveCurrentInstrumentMock.mockReturnValueOnce(PROCESS_FIDELITY_V1);
    submitTrackingEntryMock.mockResolvedValueOnce(SUBMIT_OK);

    const fd = fullForm();
    fd.delete('breakeven_secured'); // optional, skipped
    fd.delete('felt_emotion'); // optional, skipped
    fd.delete('confidenceLevel'); // wizard would enforce; action must tolerate
    fd.delete('responseLatencyMs');
    fd.set('cut_20h', 'maybe'); // malformed boolean → dropped

    await expect(submitTrackingInstrumentAction(null, fd)).rejects.toThrow('NEXT_REDIRECT');

    const [, raw] = submitTrackingEntryMock.mock.calls[0]! as [string, Record<string, unknown>];
    const responses = raw.responses as Record<string, unknown>;
    expect(responses).not.toHaveProperty('breakeven_secured');
    expect(responses).not.toHaveProperty('felt_emotion');
    expect(responses).not.toHaveProperty('cut_20h'); // malformed → absent
    expect(raw).not.toHaveProperty('confidenceLevel');
    expect(raw).not.toHaveProperty('responseLatencyMs');
  });
});

describe('submitTrackingInstrumentAction — error branches', () => {
  it('returns invalid_input with fieldErrors when the service throws a ZodError', async () => {
    authMock.mockResolvedValueOnce(ACTIVE_SESSION);
    resolveCurrentInstrumentMock.mockReturnValueOnce(PROCESS_FIDELITY_V1);
    submitTrackingEntryMock.mockRejectedValueOnce(
      new ZodError([
        {
          code: 'custom',
          path: ['responses', 'cut_20h'],
          message: 'Requis',
        },
      ]),
    );

    const result = await submitTrackingInstrumentAction(null, fullForm());

    expect(result.ok).toBe(false);
    expect(result.error).toBe('invalid_input');
    expect(result.fieldErrors).toHaveProperty('responses.cut_20h');
    expect(logAuditMock).not.toHaveBeenCalled();
    expect(redirectMock).not.toHaveBeenCalled();
  });

  it('returns unknown_instrument when the service throws UnknownInstrumentError', async () => {
    authMock.mockResolvedValueOnce(ACTIVE_SESSION);
    resolveCurrentInstrumentMock.mockReturnValueOnce(PROCESS_FIDELITY_V1);
    submitTrackingEntryMock.mockRejectedValueOnce(
      new UnknownInstrumentError('process-fidelity', 'v9'),
    );

    const result = await submitTrackingInstrumentAction(null, fullForm());

    expect(result).toEqual({ ok: false, error: 'unknown_instrument' });
    expect(logAuditMock).not.toHaveBeenCalled();
  });

  it('returns unknown on an unexpected service failure and does NOT audit/revalidate/redirect', async () => {
    authMock.mockResolvedValueOnce(ACTIVE_SESSION);
    resolveCurrentInstrumentMock.mockReturnValueOnce(PROCESS_FIDELITY_V1);
    submitTrackingEntryMock.mockRejectedValueOnce(
      Object.assign(new Error('connection lost'), { code: 'P1001' }),
    );

    const result = await submitTrackingInstrumentAction(null, fullForm());

    expect(result).toEqual({ ok: false, error: 'unknown' });
    expect(reportErrorMock).toHaveBeenCalledTimes(1);
    expect(logAuditMock).not.toHaveBeenCalled();
    expect(revalidatePathMock).not.toHaveBeenCalled();
    expect(redirectMock).not.toHaveBeenCalled();
  });
});
