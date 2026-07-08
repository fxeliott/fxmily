import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Session 5 §26 — calendar overdue safety-net (DoD#4 permanence).
 *
 * `scanOverdueCalendars` (candidate logic: active ∩ questionnaire>grace ∩
 * (no-calendar ∪ stale-calendar) — exact mirror of the batch DoD#1 filter) +
 * `runCalendarOverdueAlert` (alert vs quiet, all email outcomes)
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
  questionnaires: Array<{ userId: string; updatedAt: Date }>;
  calendars: Array<{ userId: string; generatedAt: Date }>;
}) {
  vi.mocked(db.user.findMany).mockResolvedValue(opts.activeIds.map((id) => ({ id })) as never);
  vi.mocked(db.weeklyScheduleQuestionnaire.findMany).mockResolvedValue(
    opts.questionnaires as never,
  );
  vi.mocked(db.adaptiveCalendar.findMany).mockResolvedValue(opts.calendars as never);
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
        { userId: 'u1', updatedAt: OLD }, // overdue: old + no calendar
        { userId: 'u2', updatedAt: OLD }, // not overdue: has a calendar
        { userId: 'u3', updatedAt: FRESH }, // not overdue: within grace
      ],
      calendars: [{ userId: 'u2', generatedAt: NOW }],
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
        { userId: 'u1', updatedAt: OLD },
        { userId: 'u9', updatedAt: OLD },
      ],
      calendars: [],
    });

    const scan = await scanOverdueCalendars({ now: NOW });
    expect(scan.overdueCount).toBe(1); // only u1
    expect(scan.questionnaireCount).toBe(2);
  });

  it('returns 0 overdue when every questionnaire already has a calendar', async () => {
    mockDb({
      activeIds: ['u1', 'u2'],
      questionnaires: [
        { userId: 'u1', updatedAt: OLD },
        { userId: 'u2', updatedAt: OLD },
      ],
      calendars: [
        { userId: 'u1', generatedAt: NOW },
        { userId: 'u2', generatedAt: NOW },
      ],
    });

    const scan = await scanOverdueCalendars({ now: NOW });
    expect(scan.overdueCount).toBe(0);
  });

  it('returns 0 overdue when all questionnaires are within the grace window', async () => {
    mockDb({
      activeIds: ['u1'],
      questionnaires: [{ userId: 'u1', updatedAt: FRESH }],
      calendars: [],
    });

    const scan = await scanOverdueCalendars({ now: NOW });
    expect(scan.overdueCount).toBe(0);
    expect(scan.questionnaireCount).toBe(1);
  });

  // Mirror of the batch DoD#1 STALE clause: a questionnaire RE-submitted after
  // the calendar was generated makes that calendar stale — the batch would
  // regenerate it, so the safety-net must count it once past the grace.
  it('counts a STALE calendar (re-submission after generation) as overdue', async () => {
    const generatedBefore = new Date(OLD.getTime() - 60 * 60 * 1000); // 1h before the re-submission
    mockDb({
      activeIds: ['u1'],
      questionnaires: [{ userId: 'u1', updatedAt: OLD }], // re-submitted > grace ago
      calendars: [{ userId: 'u1', generatedAt: generatedBefore }],
    });

    const scan = await scanOverdueCalendars({ now: NOW });
    expect(scan.overdueCount).toBe(1);
  });

  it('does NOT count a stale calendar while the re-submission is within grace', async () => {
    const generatedBefore = new Date(FRESH.getTime() - 60 * 60 * 1000);
    mockDb({
      activeIds: ['u1'],
      questionnaires: [{ userId: 'u1', updatedAt: FRESH }], // re-submitted 4h ago → grace
      calendars: [{ userId: 'u1', generatedAt: generatedBefore }],
    });

    const scan = await scanOverdueCalendars({ now: NOW });
    expect(scan.overdueCount).toBe(0);
  });

  it('does NOT count a calendar generated AT or AFTER the last re-submission (up to date)', async () => {
    mockDb({
      activeIds: ['u1', 'u2'],
      questionnaires: [
        { userId: 'u1', updatedAt: OLD },
        { userId: 'u2', updatedAt: OLD },
      ],
      calendars: [
        { userId: 'u1', generatedAt: OLD }, // exactly equal → up to date (strict >)
        { userId: 'u2', generatedAt: new Date(OLD.getTime() + 1000) }, // after → up to date
      ],
    });

    const scan = await scanOverdueCalendars({ now: NOW });
    expect(scan.overdueCount).toBe(0);
  });
});

describe('runCalendarOverdueAlert — notification', () => {
  it('overdue=0 → quiet scan audit, no email, no warning', async () => {
    mockDb({ activeIds: ['u1'], questionnaires: [], calendars: [] });

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
        { userId: 'u1', updatedAt: OLD },
        { userId: 'u2', updatedAt: OLD },
      ],
      calendars: [],
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
      questionnaires: [{ userId: 'u1', updatedAt: OLD }],
      calendars: [],
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
      questionnaires: [{ userId: 'u1', updatedAt: OLD }],
      calendars: [],
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
