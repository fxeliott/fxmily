import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * V1.3 / S8 verif-layer — Server Action tests for `submitTrainingDebriefAction`
 * (SPEC §23). This action carried critical, previously-untested logic: auth
 * gate, crisis routing (detectCrisis → audit + reportError/reportWarning),
 * prompt-injection pre-classifier, upsert + PII-free audit, and the §21.5
 * isolation contract (`revalidatePath('/training/debrief')` ONLY — NEVER
 * `/dashboard` or `/journal`, the dangerous copy-paste Block F warns about).
 *
 * The blocking anti-leak Block F only greps the SOURCE for that string; this
 * suite pins the behaviour at RUNTIME so a refactor that changes the token or
 * adds a real-edge revalidate is caught. Mock everything but keep
 * `trainingDebriefSchema` REAL so the fieldErrors contract is exercised
 * end-to-end (mirror `app/training/actions.test.ts`).
 */

const authMock = vi.fn<(...args: unknown[]) => Promise<unknown>>();
const redirectMock = vi.fn<(url: string) => never>((url: string) => {
  const err = Object.assign(new Error('NEXT_REDIRECT'), {
    digest: `NEXT_REDIRECT;replace;${url}`,
  });
  throw err;
});
const revalidatePathMock = vi.fn<(path: string) => void>();
const submitTrainingDebriefMock = vi.fn<(...args: unknown[]) => Promise<unknown>>();
const logAuditMock = vi.fn<(arg: unknown) => Promise<void>>(async () => undefined);
const detectCrisisMock = vi.fn<(corpus: string) => unknown>();
const detectInjectionMock = vi.fn<(corpus: string) => unknown>();
const reportErrorMock = vi.fn();
const reportWarningMock = vi.fn();

vi.mock('@/auth', () => ({ auth: authMock }));
vi.mock('next/navigation', () => ({ redirect: redirectMock }));
vi.mock('next/cache', () => ({ revalidatePath: revalidatePathMock }));
vi.mock('@/lib/training-debrief/service', () => ({
  submitTrainingDebrief: submitTrainingDebriefMock,
}));
vi.mock('@/lib/auth/audit', () => ({ logAudit: logAuditMock }));
vi.mock('@/lib/safety/crisis-detection', () => ({ detectCrisis: detectCrisisMock }));
vi.mock('@/lib/ai/injection-detector', () => ({ detectInjection: detectInjectionMock }));
vi.mock('@/lib/observability', () => ({
  reportError: reportErrorMock,
  reportWarning: reportWarningMock,
}));

const { submitTrainingDebriefAction } = await import('./actions');

/** Monday of the current UTC week — always a Monday inside the schema's
 * `[-35d, +7d]` Europe/Paris window (Paris ≥ UTC, so this is ≤ today). */
function thisMondayIso(): string {
  const now = new Date();
  const diff = (now.getUTCDay() + 6) % 7; // 0 if Monday … 6 if Sunday
  const monday = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - diff),
  );
  return monday.toISOString().slice(0, 10);
}

const WEEK_START = thisMondayIso();
const USER_ID = 'clx0member01';

function form(fields: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return fd;
}

function validForm(overrides: Record<string, string> = {}): FormData {
  return form({
    weekStart: WEEK_START,
    processStrengthOne: 'Patience sur les entrées, attente du retest propre.',
    processStrengthTwo: 'Journalisation systématique de chaque backtest joué.',
    microAdjustment: 'Limiter le replay à 10 setups par séance la semaine prochaine.',
    transversalLesson: "La discipline du process prime sur le résultat d'un backtest.",
    ...overrides,
  });
}

beforeEach(() => {
  authMock.mockReset();
  redirectMock.mockClear();
  revalidatePathMock.mockReset();
  submitTrainingDebriefMock.mockReset();
  logAuditMock.mockClear();
  detectCrisisMock.mockReset();
  detectInjectionMock.mockReset();
  reportErrorMock.mockReset();
  reportWarningMock.mockReset();

  authMock.mockResolvedValue({ user: { id: USER_ID, status: 'active' } });
  submitTrainingDebriefMock.mockResolvedValue({
    debrief: { id: 'td_1', weekStart: WEEK_START },
    wasNew: true,
  });
  detectCrisisMock.mockReturnValue({ level: 'none', matches: [] });
  detectInjectionMock.mockReturnValue({ suspected: false, matchedLabels: [] });
});

describe('submitTrainingDebriefAction — auth gate', () => {
  it('returns unauthorized with no session', async () => {
    authMock.mockResolvedValueOnce(null);
    expect(await submitTrainingDebriefAction(null, validForm())).toEqual({
      ok: false,
      error: 'unauthorized',
    });
    expect(submitTrainingDebriefMock).not.toHaveBeenCalled();
  });

  it('returns unauthorized when the user is not active', async () => {
    authMock.mockResolvedValueOnce({ user: { id: USER_ID, status: 'suspended' } });
    expect(await submitTrainingDebriefAction(null, validForm())).toEqual({
      ok: false,
      error: 'unauthorized',
    });
    expect(submitTrainingDebriefMock).not.toHaveBeenCalled();
  });
});

describe('submitTrainingDebriefAction — input validation (real Zod)', () => {
  it('returns invalid_input + fieldErrors when weekStart is not a Monday', async () => {
    // Tuesday of the current week — passes the regex but fails the Monday refine.
    const tuesday = new Date(`${WEEK_START}T00:00:00.000Z`);
    tuesday.setUTCDate(tuesday.getUTCDate() + 1);
    const result = await submitTrainingDebriefAction(
      null,
      validForm({ weekStart: tuesday.toISOString().slice(0, 10) }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe('invalid_input');
      expect(result.fieldErrors?.weekStart).toBeDefined();
    }
    expect(submitTrainingDebriefMock).not.toHaveBeenCalled();
  });

  it('returns invalid_input when a free-text field is below the min length', async () => {
    const result = await submitTrainingDebriefAction(null, validForm({ microAdjustment: 'court' }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe('invalid_input');
    expect(submitTrainingDebriefMock).not.toHaveBeenCalled();
  });
});

describe('submitTrainingDebriefAction — happy path + §21.5 isolation', () => {
  it('persists, audits PII-free, revalidates ONLY /training/debrief, redirects with done=1', async () => {
    await expect(submitTrainingDebriefAction(null, validForm())).rejects.toMatchObject({
      digest: expect.stringContaining('NEXT_REDIRECT'),
    });

    expect(submitTrainingDebriefMock).toHaveBeenCalledTimes(1);
    expect(submitTrainingDebriefMock).toHaveBeenCalledWith(USER_ID, expect.any(Object));

    // Audit metadata = ids/flags ONLY, never the raw debrief free-text.
    expect(logAuditMock).toHaveBeenCalledTimes(1);
    const auditArg = logAuditMock.mock.calls[0]?.[0] as {
      action: string;
      metadata: Record<string, unknown>;
    };
    expect(auditArg.action).toBe('training_debrief.submitted');
    expect(auditArg.metadata).not.toHaveProperty('processStrengthOne');
    expect(auditArg.metadata).not.toHaveProperty('transversalLesson');
    expect(auditArg.metadata).toMatchObject({ debriefId: 'td_1', wasNew: true });

    // 🚨 §21.5 — the debrief revalidates ONLY its own surface. NEVER the edge.
    expect(revalidatePathMock).toHaveBeenCalledWith('/training/debrief');
    expect(revalidatePathMock).not.toHaveBeenCalledWith('/dashboard');
    expect(revalidatePathMock).not.toHaveBeenCalledWith('/journal');

    const target = redirectMock.mock.calls[0]?.[0] as string;
    expect(target).toContain('/training/debrief?');
    expect(target).toContain('done=1');
    expect(target).not.toContain('crisis=');
  });
});

describe('submitTrainingDebriefAction — crisis routing', () => {
  it('high crisis → second crisis audit + reportError + crisis=high in the redirect', async () => {
    detectCrisisMock.mockReturnValue({ level: 'high', matches: [{ label: 'self_harm' }] });

    await expect(submitTrainingDebriefAction(null, validForm())).rejects.toMatchObject({
      digest: expect.stringContaining('NEXT_REDIRECT'),
    });

    const actions = logAuditMock.mock.calls.map((c) => (c[0] as { action: string }).action);
    expect(actions).toEqual(['training_debrief.submitted', 'training_debrief.crisis_detected']);
    expect(reportErrorMock).toHaveBeenCalledTimes(1);
    expect(reportWarningMock).not.toHaveBeenCalled();
    const target = redirectMock.mock.calls[0]?.[0] as string;
    expect(target).toContain('crisis=high');
  });

  it('medium crisis → crisis audit + reportWarning (not reportError)', async () => {
    detectCrisisMock.mockReturnValue({ level: 'medium', matches: [{ label: 'distress' }] });

    await expect(submitTrainingDebriefAction(null, validForm())).rejects.toMatchObject({
      digest: expect.stringContaining('NEXT_REDIRECT'),
    });

    const actions = logAuditMock.mock.calls.map((c) => (c[0] as { action: string }).action);
    expect(actions).toContain('training_debrief.crisis_detected');
    expect(reportWarningMock).toHaveBeenCalled();
    expect(reportErrorMock).not.toHaveBeenCalled();
    const target = redirectMock.mock.calls[0]?.[0] as string;
    expect(target).toContain('crisis=medium');
  });
});

describe('submitTrainingDebriefAction — injection + persistence failure', () => {
  it('suspected injection → reportWarning + injectionLabels in the audit metadata', async () => {
    detectInjectionMock.mockReturnValue({ suspected: true, matchedLabels: ['ignore_previous'] });

    await expect(submitTrainingDebriefAction(null, validForm())).rejects.toMatchObject({
      digest: expect.stringContaining('NEXT_REDIRECT'),
    });

    const auditArg = logAuditMock.mock.calls[0]?.[0] as { metadata: Record<string, unknown> };
    expect(auditArg.metadata.injectionSuspected).toBe(true);
    expect(auditArg.metadata.injectionLabels).toEqual(['ignore_previous']);
    expect(reportWarningMock).toHaveBeenCalledWith(
      'training_debrief.injection',
      'prompt_injection_suspected',
      expect.any(Object),
    );
  });

  it('service throw → error:unknown, reportError, no audit, no redirect, no revalidate', async () => {
    submitTrainingDebriefMock.mockRejectedValueOnce(new Error('pg pool exhausted'));
    const result = await submitTrainingDebriefAction(null, validForm());
    expect(result).toEqual({ ok: false, error: 'unknown' });
    expect(reportErrorMock).toHaveBeenCalledWith('training_debrief.create', expect.any(Error), {
      userId: USER_ID,
    });
    expect(logAuditMock).not.toHaveBeenCalled();
    expect(redirectMock).not.toHaveBeenCalled();
    expect(revalidatePathMock).not.toHaveBeenCalled();
  });
});
