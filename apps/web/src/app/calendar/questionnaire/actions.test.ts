import { afterEach, describe, expect, it, vi } from 'vitest';

// Mock all module-level dependencies BEFORE importing the SUT.
// Pattern `app/pre-trade/actions.test.ts` carbone. The pure modules
// (`@/lib/calendar/week`, `@/lib/schemas/...`, `@/lib/calendar/instrument-v1`)
// run for real so the FormData reconstruction + coerceBool + Zod parse are
// genuinely exercised; only the server-only service / sinks are mocked.
const authMock = vi.fn();
const logAuditMock = vi.fn();
const submitQuestionnaireMock = vi.fn();
const reportErrorMock = vi.fn();
const revalidatePathMock = vi.fn();
const redirectMock = vi.fn((path: string) => {
  const err = new Error('NEXT_REDIRECT') as Error & { digest: string };
  err.digest = `NEXT_REDIRECT;replace;${path};303`;
  throw err;
});

vi.mock('@/auth', () => ({ auth: authMock }));
vi.mock('@/lib/auth/audit', () => ({ logAudit: logAuditMock }));
vi.mock('@/lib/calendar/service', () => ({
  submitWeeklyScheduleQuestionnaire: submitQuestionnaireMock,
}));
vi.mock('@/lib/observability', () => ({ reportError: reportErrorMock }));
vi.mock('next/cache', () => ({ revalidatePath: revalidatePathMock }));
vi.mock('next/navigation', () => ({ redirect: redirectMock }));

const { submitCalendarQuestionnaireAction } = await import('./actions');
const { currentParisWeekStart } = await import('@/lib/calendar/week');
const { CALENDAR_SLOTS, CALENDAR_WEEKDAYS, CALENDAR_WEEKEND_DAYS } =
  await import('@/lib/calendar/instrument-v1');

afterEach(() => {
  authMock.mockReset();
  logAuditMock.mockReset();
  submitQuestionnaireMock.mockReset();
  reportErrorMock.mockReset();
  revalidatePathMock.mockReset();
  redirectMock.mockClear();
});

const ACTIVE_SESSION = {
  user: { id: 'user_1', status: 'active' as const, timezone: 'Europe/Paris' },
};

/** A fully-valid field map. `weekStart` is intentionally bogus to prove the
 *  action ignores the client value and recomputes server-side. */
function fullFields(overrides: Record<string, string> = {}): Record<string, string> {
  const base: Record<string, string> = {
    weekStart: '2000-01-01', // bogus — must be ignored (server authority)
    instrumentVersion: '1',
    profile: 'salarie',
    sessionGoal: '3',
    sleep: 'standard',
    energyPeak: 'morning',
    meetingCommitment: 'occasional',
    practiceFocus: 'balanced',
    constraint: 'none',
  };
  for (const day of CALENDAR_WEEKDAYS) {
    for (const slot of CALENDAR_SLOTS) base[`weekday.${day}.${slot}`] = 'false';
  }
  for (const day of CALENDAR_WEEKEND_DAYS) {
    for (const slot of CALENDAR_SLOTS) base[`weekend.${day}.${slot}`] = 'false';
  }
  // Mark a few available slots.
  base['weekday.monday.morning'] = 'true';
  base['weekday.friday.evening'] = 'on';
  return { ...base, ...overrides };
}

function makeFormData(fields: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return fd;
}

function frozenResult(weekStart: string) {
  return {
    questionnaire: {
      id: 'wsq_1',
      userId: 'user_1',
      weekStart,
      instrumentVersion: 1,
      energyPeakSlot: 'morning' as const,
      responses: {},
      createdAt: '2026-06-01T00:00:00.000Z',
      updatedAt: '2026-06-01T00:00:00.000Z',
    },
    wasNew: true,
  };
}

describe('submitCalendarQuestionnaireAction — auth gate', () => {
  it('returns unauthorized when there is no session', async () => {
    authMock.mockResolvedValueOnce(null);

    const result = await submitCalendarQuestionnaireAction(null, makeFormData(fullFields()));

    expect(result).toEqual({ ok: false, error: 'unauthorized' });
    expect(submitQuestionnaireMock).not.toHaveBeenCalled();
    expect(logAuditMock).not.toHaveBeenCalled();
    expect(redirectMock).not.toHaveBeenCalled();
  });

  it('returns unauthorized when status is not "active"', async () => {
    authMock.mockResolvedValueOnce({
      user: { id: 'user_1', status: 'suspended', timezone: 'Europe/Paris' },
    });

    const result = await submitCalendarQuestionnaireAction(null, makeFormData(fullFields()));

    expect(result).toEqual({ ok: false, error: 'unauthorized' });
    expect(submitQuestionnaireMock).not.toHaveBeenCalled();
  });
});

describe('submitCalendarQuestionnaireAction — Zod safeParse rejection', () => {
  it('returns invalid_input with fieldErrors when profile is empty', async () => {
    authMock.mockResolvedValueOnce(ACTIVE_SESSION);

    const result = await submitCalendarQuestionnaireAction(
      null,
      makeFormData(fullFields({ profile: '' })),
    );

    expect(result.ok).toBe(false);
    expect(result.error).toBe('invalid_input');
    expect(result.fieldErrors).toHaveProperty('responses.profile');
    expect(submitQuestionnaireMock).not.toHaveBeenCalled();
    expect(redirectMock).not.toHaveBeenCalled();
  });

  it('returns invalid_input when sessionGoal is empty (NaN out of 1..7)', async () => {
    authMock.mockResolvedValueOnce(ACTIVE_SESSION);

    const result = await submitCalendarQuestionnaireAction(
      null,
      makeFormData(fullFields({ sessionGoal: '' })),
    );

    expect(result.ok).toBe(false);
    expect(result.error).toBe('invalid_input');
    expect(result.fieldErrors).toHaveProperty('responses.sessionGoal');
  });

  it('returns invalid_input when sessionGoal is out of range (8 > max 7)', async () => {
    authMock.mockResolvedValueOnce(ACTIVE_SESSION);

    const result = await submitCalendarQuestionnaireAction(
      null,
      makeFormData(fullFields({ sessionGoal: '8' })),
    );

    expect(result.ok).toBe(false);
    expect(result.error).toBe('invalid_input');
  });

  it('returns invalid_input when an enum value is unknown', async () => {
    authMock.mockResolvedValueOnce(ACTIVE_SESSION);

    const result = await submitCalendarQuestionnaireAction(
      null,
      makeFormData(fullFields({ practiceFocus: 'yolo' })),
    );

    expect(result.ok).toBe(false);
    expect(result.error).toBe('invalid_input');
    expect(result.fieldErrors).toHaveProperty('responses.practiceFocus');
  });
});

describe('submitCalendarQuestionnaireAction — FormData boolean coercion (footgun guard)', () => {
  it('coerces "true"/"on" → true and "false"/absent → false (NOT Boolean("false") === true)', async () => {
    const serverWeek = currentParisWeekStart();
    authMock.mockResolvedValueOnce(ACTIVE_SESSION);
    submitQuestionnaireMock.mockResolvedValueOnce(frozenResult(serverWeek));

    // monday.morning='true', friday.evening='on' → true ; everything else 'false'.
    // tuesday.morning omitted entirely → null → false.
    const fields = fullFields();
    delete fields['weekday.tuesday.morning'];
    const fd = makeFormData(fields);

    await expect(submitCalendarQuestionnaireAction(null, fd)).rejects.toThrow('NEXT_REDIRECT');

    const [, input] = submitQuestionnaireMock.mock.calls[0]!;
    expect(input.responses.weekdayAvailability.monday.morning).toBe(true);
    expect(input.responses.weekdayAvailability.monday.afternoon).toBe(false);
    expect(input.responses.weekdayAvailability.friday.evening).toBe(true);
    expect(input.responses.weekdayAvailability.tuesday.morning).toBe(false);
    expect(input.responses.weekendAvailability.sunday.evening).toBe(false);
  });
});

describe('submitCalendarQuestionnaireAction — weekStart server authority', () => {
  it('ignores the bogus client weekStart and uses currentParisWeekStart()', async () => {
    const serverWeek = currentParisWeekStart();
    authMock.mockResolvedValueOnce(ACTIVE_SESSION);
    submitQuestionnaireMock.mockResolvedValueOnce(frozenResult(serverWeek));

    await expect(
      submitCalendarQuestionnaireAction(
        null,
        makeFormData(fullFields({ weekStart: '2000-01-01' })),
      ),
    ).rejects.toThrow('NEXT_REDIRECT');

    const [uid, input] = submitQuestionnaireMock.mock.calls[0]!;
    expect(uid).toBe('user_1');
    expect(input.weekStart).toBe(serverWeek);
    expect(input.weekStart).not.toBe('2000-01-01');
  });
});

describe('submitCalendarQuestionnaireAction — happy path', () => {
  it('persists, audits PII-free, revalidates /calendrier + /dashboard, redirects to /calendrier', async () => {
    const serverWeek = currentParisWeekStart();
    authMock.mockResolvedValueOnce(ACTIVE_SESSION);
    submitQuestionnaireMock.mockResolvedValueOnce(frozenResult(serverWeek));

    await expect(
      submitCalendarQuestionnaireAction(null, makeFormData(fullFields())),
    ).rejects.toThrow('NEXT_REDIRECT');

    expect(submitQuestionnaireMock).toHaveBeenCalledTimes(1);
    const [, input] = submitQuestionnaireMock.mock.calls[0]!;
    expect(input.responses.profile).toBe('salarie');
    expect(input.responses.sessionGoal).toBe(3);
    expect(input.responses.constraint).toBe('none');

    expect(logAuditMock).toHaveBeenCalledTimes(1);
    expect(logAuditMock).toHaveBeenCalledWith({
      action: 'calendar.questionnaire.submitted',
      userId: 'user_1',
      metadata: { weekStart: serverWeek, instrumentVersion: 1, wasNew: true },
    });

    expect(revalidatePathMock).toHaveBeenCalledWith('/calendrier');
    expect(revalidatePathMock).toHaveBeenCalledWith('/dashboard');
    expect(redirectMock).toHaveBeenCalledWith('/calendrier?done=questionnaire');
  });

  it('defaults an empty constraint to "none" (schema default, not a rejection)', async () => {
    const serverWeek = currentParisWeekStart();
    authMock.mockResolvedValueOnce(ACTIVE_SESSION);
    submitQuestionnaireMock.mockResolvedValueOnce(frozenResult(serverWeek));

    await expect(
      submitCalendarQuestionnaireAction(null, makeFormData(fullFields({ constraint: '' }))),
    ).rejects.toThrow('NEXT_REDIRECT');

    const [, input] = submitQuestionnaireMock.mock.calls[0]!;
    expect(input.responses.constraint).toBe('none');
  });
});

describe('submitCalendarQuestionnaireAction — service failure', () => {
  it('returns unknown when the service throws, and does NOT audit / revalidate / redirect', async () => {
    authMock.mockResolvedValueOnce(ACTIVE_SESSION);
    submitQuestionnaireMock.mockRejectedValueOnce(
      Object.assign(new Error('connection lost'), { code: 'P1001' }),
    );

    const result = await submitCalendarQuestionnaireAction(null, makeFormData(fullFields()));

    expect(result).toEqual({ ok: false, error: 'unknown' });
    expect(reportErrorMock).toHaveBeenCalledTimes(1);
    expect(logAuditMock).not.toHaveBeenCalled();
    expect(revalidatePathMock).not.toHaveBeenCalled();
    expect(redirectMock).not.toHaveBeenCalled();
  });
});
