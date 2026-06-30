import { afterEach, describe, expect, it, vi } from 'vitest';

/**
 * 2026-06-30 A-Z re-challenge — regression guard for the silently-dropped
 * evening `intentionKept` field. The wizard POSTs it, the schema/service/scoring
 * (discipline sub-score #13, weight 10) all consume it, but the Server Action's
 * `raw` object never extracted it from the FormData → it always persisted `null`
 * and the morning→evening intention loop was dead. These tests drive the REAL
 * `eveningCheckinSchema` (only the service + side-effects are mocked) and assert
 * the value reaches the service.
 *
 * Mock-before-import + NEXT_REDIRECT pattern: carbon copy of
 * `app/pre-trade/actions.test.ts`.
 */
const authMock = vi.fn();
const logAuditMock = vi.fn();
const submitEveningCheckinMock = vi.fn();
const submitMorningCheckinMock = vi.fn();
const revalidatePathMock = vi.fn();
const redirectMock = vi.fn((path: string) => {
  const err = new Error('NEXT_REDIRECT') as Error & { digest: string };
  err.digest = `NEXT_REDIRECT;replace;${path};303`;
  throw err;
});

class CheckinDateOutOfWindowError extends Error {}

vi.mock('@/auth', () => ({ auth: authMock }));
vi.mock('@/lib/auth/audit', () => ({ logAudit: logAuditMock }));
vi.mock('@/lib/checkin/service', () => ({
  submitEveningCheckin: submitEveningCheckinMock,
  submitMorningCheckin: submitMorningCheckinMock,
  CheckinDateOutOfWindowError,
}));
vi.mock('@/lib/observability', () => ({
  reportError: vi.fn(),
  reportWarning: vi.fn(),
}));
vi.mock('@/lib/cards/scheduler', () => ({ scheduleDouglasDispatch: vi.fn() }));
vi.mock('@/lib/scoring/scheduler', () => ({ scheduleScoreRecompute: vi.fn() }));
vi.mock('next/cache', () => ({ revalidatePath: revalidatePathMock }));
vi.mock('next/navigation', () => ({ redirect: redirectMock }));

const { submitEveningCheckinAction } = await import('./actions');

afterEach(() => {
  vi.clearAllMocks();
});

/** Today's UTC date — always inside the schema's [now − past, now + 1] window. */
const TODAY = new Date().toISOString().slice(0, 10);

const ACTIVE_SESSION = {
  user: { id: 'user_1', status: 'active' as const, timezone: 'Europe/Paris' },
};

const EVENING_ROW = {
  id: 'checkin_1',
  date: TODAY,
  moodScore: 6,
  stressScore: 4,
  planRespectedToday: true,
};

function eveningFormData(overrides: Record<string, string> = {}): FormData {
  const fd = new FormData();
  const base: Record<string, string> = {
    date: TODAY,
    planRespectedToday: 'true',
    hedgeRespectedToday: 'true',
    stressScore: '4',
    moodScore: '6',
    ...overrides,
  };
  for (const [k, v] of Object.entries(base)) fd.set(k, v);
  return fd;
}

/** The 2nd positional arg to `submitEveningCheckin` is the parsed input. */
function capturedInput(): { intentionKept: boolean | null } {
  const call = submitEveningCheckinMock.mock.calls[0];
  return call?.[1] as { intentionKept: boolean | null };
}

describe('submitEveningCheckinAction — intentionKept passthrough (#13 day-loop)', () => {
  it('forwards intentionKept=true to the service (regression: was silently dropped)', async () => {
    authMock.mockResolvedValueOnce(ACTIVE_SESSION);
    submitEveningCheckinMock.mockResolvedValueOnce(EVENING_ROW);

    await expect(
      submitEveningCheckinAction(null, eveningFormData({ intentionKept: 'true' })),
    ).rejects.toThrow('NEXT_REDIRECT');

    expect(submitEveningCheckinMock).toHaveBeenCalledTimes(1);
    expect(capturedInput().intentionKept).toBe(true);
  });

  it('forwards intentionKept=false (a calm effort signal, never punitive)', async () => {
    authMock.mockResolvedValueOnce(ACTIVE_SESSION);
    submitEveningCheckinMock.mockResolvedValueOnce(EVENING_ROW);

    await expect(
      submitEveningCheckinAction(null, eveningFormData({ intentionKept: 'false' })),
    ).rejects.toThrow('NEXT_REDIRECT');

    expect(capturedInput().intentionKept).toBe(false);
  });

  it('omitted intentionKept → null (never blocks the wizard)', async () => {
    authMock.mockResolvedValueOnce(ACTIVE_SESSION);
    submitEveningCheckinMock.mockResolvedValueOnce(EVENING_ROW);

    await expect(submitEveningCheckinAction(null, eveningFormData())).rejects.toThrow(
      'NEXT_REDIRECT',
    );

    expect(capturedInput().intentionKept).toBeNull();
  });
});
