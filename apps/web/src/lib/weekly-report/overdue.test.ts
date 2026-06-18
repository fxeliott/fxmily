import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * J8 weekly report permanence safety-net (4th twin of the §26 calendar / §25
 * monthly / S2 onboarding overdue nets).
 *
 * `scanOverdueWeeklyReports` (last-completed-full-week + grace + joinedAt floor +
 * missing-report count) and `runWeeklyReportOverdueAlert` (alert vs quiet, all
 * email outcomes) run REAL. `computePreviousFullWeekWindow` / `formatWeekRangeFr`
 * are pure → not mocked. db / audit / observability / email / env are mocked.
 */

const { envMock, sendMock } = vi.hoisted(() => ({
  envMock: { WEEKLY_REPORT_RECIPIENT: 'admin@fxmily.test' as string | undefined },
  sendMock: vi.fn<(...args: unknown[]) => Promise<{ id: string | null; delivered: boolean }>>(),
}));

vi.mock('@/lib/db', () => ({
  db: {
    user: { findMany: vi.fn() },
    weeklyReport: { findMany: vi.fn() },
  },
}));

vi.mock('@/lib/auth/audit', () => ({ logAudit: vi.fn() }));
vi.mock('@/lib/observability', () => ({ reportWarning: vi.fn() }));
vi.mock('@/lib/email/send', () => ({ sendWeeklyReportOverdueAlertEmail: sendMock }));
vi.mock('@/lib/env', () => ({ env: envMock }));

import { logAudit } from '@/lib/auth/audit';
import { db } from '@/lib/db';
import { reportWarning } from '@/lib/observability';

import { runWeeklyReportOverdueAlert, scanOverdueWeeklyReports } from './overdue';

// now = 2026-06-17 → last completed full week = 8 → 14 June 2026, past the 2d
// grace (grace threshold = weekEndUtc 2026-06-14T21:59:59.999Z + 2d).
const NOW = new Date('2026-06-17T10:00:00.000Z');
// now = 2026-06-15 (Mon) → same target week (8 → 14 June) but still INSIDE the
// 2d post-week-end grace (before 2026-06-16T21:59:59.999Z).
const WITHIN_GRACE = new Date('2026-06-15T10:00:00.000Z');

/**
 * `reportIds` = active members WITH a `WeeklyReport` row for the target week →
 * counted covered. The digest is admin-facing (no per-member delivery field),
 * so coverage is the simple EXISTENCE of the row.
 */
function mockDb(opts: { activeIds: string[]; reportIds: string[] }) {
  vi.mocked(db.user.findMany).mockResolvedValue(opts.activeIds.map((id) => ({ id })) as never);
  vi.mocked(db.weeklyReport.findMany).mockResolvedValue(
    opts.reportIds.map((userId) => ({ userId })) as never,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  envMock.WEEKLY_REPORT_RECIPIENT = 'admin@fxmily.test';
  sendMock.mockResolvedValue({ id: 'msg_1', delivered: true });
});

describe('scanOverdueWeeklyReports — candidate logic', () => {
  it('counts active members (joined ≤ week end) with no report for the completed week', async () => {
    mockDb({ activeIds: ['u1', 'u2'], reportIds: [] });

    const scan = await scanOverdueWeeklyReports({ now: NOW });

    expect(scan.weekStart).toBe('2026-06-08');
    expect(scan.weekRange).toMatch(/8 juin → 14 juin/i);
    expect(scan.withinGrace).toBe(false);
    expect(scan.overdueCount).toBe(2);
    expect(scan.expectedCount).toBe(2);
  });

  it('excludes members who already have a report for the week', async () => {
    mockDb({ activeIds: ['u1', 'u2'], reportIds: ['u1'] });
    const scan = await scanOverdueWeeklyReports({ now: NOW });
    expect(scan.overdueCount).toBe(1); // only u2
  });

  it('returns 0 overdue when every active member has a report row', async () => {
    mockDb({ activeIds: ['u1', 'u2'], reportIds: ['u1', 'u2'] });
    const scan = await scanOverdueWeeklyReports({ now: NOW });
    expect(scan.overdueCount).toBe(0);
  });

  it('detects overdue the moment a report row is missing (batch never ran)', async () => {
    mockDb({ activeIds: ['u1', 'u2', 'u3'], reportIds: [] });
    const scan = await scanOverdueWeeklyReports({ now: NOW });
    expect(scan.overdueCount).toBe(3);
    expect(scan.expectedCount).toBe(3);
  });

  it('returns 0 overdue while within the post-week-end grace window', async () => {
    mockDb({ activeIds: ['u1', 'u2'], reportIds: [] });
    const scan = await scanOverdueWeeklyReports({ now: WITHIN_GRACE });
    expect(scan.withinGrace).toBe(true);
    expect(scan.overdueCount).toBe(0);
    expect(scan.weekStart).toBe('2026-06-08'); // still reports the same week
  });

  it('floors the active-member query at joinedAt ≤ week end (no false overdue for recent joiners)', async () => {
    mockDb({ activeIds: ['u1'], reportIds: [] });
    await scanOverdueWeeklyReports({ now: NOW });

    const arg = vi.mocked(db.user.findMany).mock.calls[0]?.[0] as {
      where: { status: string; joinedAt: { lte: Date } };
    };
    expect(arg.where.status).toBe('active');
    expect(arg.where.joinedAt.lte).toBeInstanceOf(Date);
    // The floor is the END of the completed week (Sun 23:59:59.999 Paris), in UTC.
    expect(arg.where.joinedAt.lte.toISOString().slice(0, 7)).toBe('2026-06');
  });
});

describe('runWeeklyReportOverdueAlert — notification', () => {
  it('overdue=0 → quiet heartbeat audit, no email, no warning', async () => {
    mockDb({ activeIds: ['u1'], reportIds: ['u1'] });

    const result = await runWeeklyReportOverdueAlert({ now: NOW });

    expect(result.overdueCount).toBe(0);
    expect(result.emailOutcome).toBe('not_attempted');
    expect(sendMock).not.toHaveBeenCalled();
    expect(reportWarning).not.toHaveBeenCalled();
    expect(vi.mocked(logAudit)).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'cron.weekly_report_overdue.scan' }),
    );
  });

  it('heartbeat audit is emitted on EVERY run, even within grace (0 overdue)', async () => {
    mockDb({ activeIds: ['u1', 'u2'], reportIds: [] });

    const result = await runWeeklyReportOverdueAlert({ now: WITHIN_GRACE });

    expect(result.overdueCount).toBe(0);
    expect(result.withinGrace).toBe(true);
    expect(vi.mocked(logAudit)).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'cron.weekly_report_overdue.scan' }),
    );
  });

  it('overdue>0 + recipient + delivered → warning + email sent + alerted heartbeat', async () => {
    mockDb({ activeIds: ['u1', 'u2'], reportIds: [] });

    const result = await runWeeklyReportOverdueAlert({ now: NOW });

    expect(result.overdueCount).toBe(2);
    expect(result.emailOutcome).toBe('sent');
    expect(reportWarning).toHaveBeenCalledWith(
      'cron.weekly-report-overdue',
      'weekly_reports_overdue',
      expect.objectContaining({ overdueCount: 2 }),
    );
    expect(sendMock).toHaveBeenCalledWith(
      expect.objectContaining({ to: 'admin@fxmily.test', overdueCount: 2 }),
    );
    const scanRow = (
      vi.mocked(logAudit).mock.calls.map((c) => c[0]) as Array<{
        action: string;
        metadata: Record<string, unknown>;
      }>
    ).find((a) => a.action === 'cron.weekly_report_overdue.scan');
    expect(scanRow?.metadata.emailOutcome).toBe('sent');
    expect(scanRow?.metadata.alerted).toBe(true);
    expect(JSON.stringify(scanRow?.metadata)).not.toMatch(/@/); // PII-free
  });

  it('overdue>0 + no recipient → warning + heartbeat, email not attempted', async () => {
    envMock.WEEKLY_REPORT_RECIPIENT = undefined;
    mockDb({ activeIds: ['u1'], reportIds: [] });

    const result = await runWeeklyReportOverdueAlert({ now: NOW });

    expect(result.emailOutcome).toBe('not_attempted');
    expect(sendMock).not.toHaveBeenCalled();
    expect(reportWarning).toHaveBeenCalledWith(
      'cron.weekly-report-overdue',
      'weekly_reports_overdue',
      expect.anything(),
    );
  });

  it('overdue>0 + email throws → emailOutcome failed, alert still heartbeat-audited', async () => {
    sendMock.mockRejectedValue(new Error('Resend 500'));
    mockDb({ activeIds: ['u1'], reportIds: [] });

    const result = await runWeeklyReportOverdueAlert({ now: NOW });

    expect(result.emailOutcome).toBe('failed');
    expect(reportWarning).toHaveBeenCalledWith(
      'cron.weekly-report-overdue',
      'admin_email_failed',
      expect.anything(),
    );
    const scanRow = (
      vi.mocked(logAudit).mock.calls.map((c) => c[0]) as Array<{
        action: string;
        metadata: Record<string, unknown>;
      }>
    ).find((a) => a.action === 'cron.weekly_report_overdue.scan');
    expect(scanRow?.metadata.emailOutcome).toBe('failed');
  });
});
