import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Session 5 §26 — calendar overdue safety-net (DoD#4 permanence).
 *
 * `scanOverdueCalendars` (candidate logic: active ∩ questionnaire>grace ∩
 * no-calendar) + `runCalendarOverdueAlert` (alert vs quiet, all email outcomes)
 * run REAL. `parseLocalDate` + `./week` (currentParisWeekStart/formatWeekRangeFr)
 * are pure → not mocked. db / audit / observability / email / env are mocked.
 */

const { envMock, sendMock } = vi.hoisted(() => ({
  envMock: { WEEKLY_REPORT_RECIPIENT: 'admin@fxmily.test' as string | undefined },
  sendMock: vi.fn<(...args: unknown[]) => Promise<{ id: string | null; delivered: boolean }>>(),
}));

vi.mock('@/lib/db', () => ({
  db: {
    user: { findMany: vi.fn() },
    weeklyScheduleQuestionnaire: { findMany: vi.fn() },
    adaptiveCalendar: { findMany: vi.fn() },
  },
}));

vi.mock('@/lib/auth/audit', () => ({ logAudit: vi.fn() }));
vi.mock('@/lib/observability', () => ({ reportWarning: vi.fn() }));
vi.mock('@/lib/email/send', () => ({ sendCalendarOverdueAlertEmail: sendMock }));
vi.mock('@/lib/env', () => ({ env: envMock }));

import { logAudit } from '@/lib/auth/audit';
import { db } from '@/lib/db';
import { reportWarning } from '@/lib/observability';

import { runCalendarOverdueAlert, scanOverdueCalendars } from './overdue';

// now = Tue 2026-06-09 10:00 UTC (12:00 Paris) → current Paris week starts Mon 2026-06-08.
const NOW = new Date('2026-06-09T10:00:00.000Z');
const OLD = new Date('2026-06-08T00:00:00.000Z'); // ~34h before NOW → past the 18h grace
const FRESH = new Date('2026-06-09T06:00:00.000Z'); // ~4h before NOW → within grace

function mockDb(opts: {
  activeIds: string[];
  questionnaires: Array<{ userId: string; createdAt: Date }>;
  calendarIds: string[];
}) {
  vi.mocked(db.user.findMany).mockResolvedValue(opts.activeIds.map((id) => ({ id })) as never);
  vi.mocked(db.weeklyScheduleQuestionnaire.findMany).mockResolvedValue(
    opts.questionnaires as never,
  );
  vi.mocked(db.adaptiveCalendar.findMany).mockResolvedValue(
    opts.calendarIds.map((userId) => ({ userId })) as never,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  envMock.WEEKLY_REPORT_RECIPIENT = 'admin@fxmily.test';
  sendMock.mockResolvedValue({ id: 'msg_1', delivered: true });
});

describe('scanOverdueCalendars — candidate logic', () => {
  it('counts only active members with a >grace questionnaire and no calendar', async () => {
    mockDb({
      activeIds: ['u1', 'u2', 'u3'],
      questionnaires: [
        { userId: 'u1', createdAt: OLD }, // overdue: old + no calendar
        { userId: 'u2', createdAt: OLD }, // not overdue: has a calendar
        { userId: 'u3', createdAt: FRESH }, // not overdue: within grace
      ],
      calendarIds: ['u2'],
    });

    const scan = await scanOverdueCalendars({ now: NOW });

    expect(scan.weekStart).toBe('2026-06-08');
    expect(scan.overdueCount).toBe(1);
    expect(scan.questionnaireCount).toBe(3);
    expect(scan.weekRange).toContain('juin');
  });

  it('excludes questionnaires whose user is no longer active (forged/inactive)', async () => {
    mockDb({
      activeIds: ['u1'], // u9 absent from the active set
      questionnaires: [
        { userId: 'u1', createdAt: OLD },
        { userId: 'u9', createdAt: OLD },
      ],
      calendarIds: [],
    });

    const scan = await scanOverdueCalendars({ now: NOW });
    expect(scan.overdueCount).toBe(1); // only u1
    expect(scan.questionnaireCount).toBe(2);
  });

  it('returns 0 overdue when every questionnaire already has a calendar', async () => {
    mockDb({
      activeIds: ['u1', 'u2'],
      questionnaires: [
        { userId: 'u1', createdAt: OLD },
        { userId: 'u2', createdAt: OLD },
      ],
      calendarIds: ['u1', 'u2'],
    });

    const scan = await scanOverdueCalendars({ now: NOW });
    expect(scan.overdueCount).toBe(0);
  });

  it('returns 0 overdue when all questionnaires are within the grace window', async () => {
    mockDb({
      activeIds: ['u1'],
      questionnaires: [{ userId: 'u1', createdAt: FRESH }],
      calendarIds: [],
    });

    const scan = await scanOverdueCalendars({ now: NOW });
    expect(scan.overdueCount).toBe(0);
    expect(scan.questionnaireCount).toBe(1);
  });
});

describe('runCalendarOverdueAlert — notification', () => {
  it('overdue=0 → quiet scan audit, no email, no warning', async () => {
    mockDb({ activeIds: ['u1'], questionnaires: [], calendarIds: [] });

    const result = await runCalendarOverdueAlert({ now: NOW });

    expect(result.overdueCount).toBe(0);
    expect(result.emailOutcome).toBe('not_attempted');
    expect(sendMock).not.toHaveBeenCalled();
    expect(reportWarning).not.toHaveBeenCalled();
    expect(vi.mocked(logAudit)).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'cron.calendar_overdue.scan' }),
    );
  });

  it('overdue>0 + recipient + delivered → warning + email sent + alerted audit', async () => {
    mockDb({
      activeIds: ['u1', 'u2'],
      questionnaires: [
        { userId: 'u1', createdAt: OLD },
        { userId: 'u2', createdAt: OLD },
      ],
      calendarIds: [],
    });

    const result = await runCalendarOverdueAlert({ now: NOW });

    expect(result.overdueCount).toBe(2);
    expect(result.emailOutcome).toBe('sent');
    expect(reportWarning).toHaveBeenCalledWith(
      'cron.calendar-overdue',
      'calendars_overdue',
      expect.objectContaining({ overdueCount: 2 }),
    );
    expect(sendMock).toHaveBeenCalledWith(
      expect.objectContaining({ to: 'admin@fxmily.test', overdueCount: 2, questionnaireCount: 2 }),
    );
    const auditCalls = vi.mocked(logAudit).mock.calls.map((c) => c[0]) as Array<{
      action: string;
      metadata: Record<string, unknown>;
    }>;
    const scanRow = auditCalls.find((a) => a.action === 'cron.calendar_overdue.scan');
    expect(scanRow?.metadata.emailOutcome).toBe('sent');
    expect(scanRow?.metadata.alerted).toBe(true);
    // PII-free audit (no email address in metadata).
    expect(JSON.stringify(scanRow?.metadata)).not.toMatch(/@/);
  });

  it('overdue>0 + no recipient configured → warning + audit, email not attempted', async () => {
    envMock.WEEKLY_REPORT_RECIPIENT = undefined;
    mockDb({
      activeIds: ['u1'],
      questionnaires: [{ userId: 'u1', createdAt: OLD }],
      calendarIds: [],
    });

    const result = await runCalendarOverdueAlert({ now: NOW });

    expect(result.emailOutcome).toBe('not_attempted');
    expect(sendMock).not.toHaveBeenCalled();
    expect(reportWarning).toHaveBeenCalledWith(
      'cron.calendar-overdue',
      'calendars_overdue',
      expect.anything(),
    );
  });

  it('overdue>0 + email throws → emailOutcome failed, alert still audited', async () => {
    sendMock.mockRejectedValue(new Error('Resend 500'));
    mockDb({
      activeIds: ['u1'],
      questionnaires: [{ userId: 'u1', createdAt: OLD }],
      calendarIds: [],
    });

    const result = await runCalendarOverdueAlert({ now: NOW });

    expect(result.emailOutcome).toBe('failed');
    expect(reportWarning).toHaveBeenCalledWith(
      'cron.calendar-overdue',
      'admin_email_failed',
      expect.anything(),
    );
    const auditCalls = vi.mocked(logAudit).mock.calls.map((c) => c[0]) as Array<{
      action: string;
      metadata: Record<string, unknown>;
    }>;
    const scanRow = auditCalls.find((a) => a.action === 'cron.calendar_overdue.scan');
    expect(scanRow?.metadata.emailOutcome).toBe('failed');
    expect(scanRow?.metadata.alerted).toBe(true);
  });
});
