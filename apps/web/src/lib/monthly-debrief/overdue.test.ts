import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Session 5 §25 — monthly debrief permanence safety-net (DoD#2).
 *
 * `scanOverdueMonthlyDebriefs` (last-completed-month + grace + joinedAt floor +
 * missing-debrief count) and `runMonthlyDebriefOverdueAlert` (alert vs quiet,
 * all email outcomes) run REAL. `computeMonthWindow` / `formatMonthLabelFr` are
 * pure → not mocked. db / audit / observability / email / env are mocked.
 */

const { envMock, sendMock } = vi.hoisted(() => ({
  envMock: { WEEKLY_REPORT_RECIPIENT: 'admin@fxmily.test' as string | undefined },
  sendMock: vi.fn<(...args: unknown[]) => Promise<{ id: string | null; delivered: boolean }>>(),
}));

vi.mock('@/lib/db', () => ({
  db: {
    user: { findMany: vi.fn() },
    monthlyDebrief: { findMany: vi.fn() },
  },
}));

vi.mock('@/lib/auth/audit', () => ({ logAudit: vi.fn() }));
vi.mock('@/lib/observability', () => ({ reportWarning: vi.fn() }));
vi.mock('@/lib/email/send', () => ({ sendMonthlyDebriefOverdueAlertEmail: sendMock }));
vi.mock('@/lib/env', () => ({ env: envMock }));

import { logAudit } from '@/lib/auth/audit';
import { db } from '@/lib/db';
import { reportWarning } from '@/lib/observability';

import { runMonthlyDebriefOverdueAlert, scanOverdueMonthlyDebriefs } from './overdue';

// now = 2026-06-09 → last completed civil month = MAY 2026 (past the 4d grace).
const NOW = new Date('2026-06-09T10:00:00.000Z');
// now = 2026-06-02 → still within the 4d post-month-end grace for May.
const WITHIN_GRACE = new Date('2026-06-02T10:00:00.000Z');

function mockDb(opts: { activeIds: string[]; debriefIds: string[] }) {
  vi.mocked(db.user.findMany).mockResolvedValue(opts.activeIds.map((id) => ({ id })) as never);
  vi.mocked(db.monthlyDebrief.findMany).mockResolvedValue(
    opts.debriefIds.map((userId) => ({ userId })) as never,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  envMock.WEEKLY_REPORT_RECIPIENT = 'admin@fxmily.test';
  sendMock.mockResolvedValue({ id: 'msg_1', delivered: true });
});

describe('scanOverdueMonthlyDebriefs — candidate logic', () => {
  it('counts active members (joined ≤ month end) with no debrief for the completed month', async () => {
    mockDb({ activeIds: ['u1', 'u2'], debriefIds: [] });

    const scan = await scanOverdueMonthlyDebriefs({ now: NOW });

    expect(scan.monthStart).toBe('2026-05-01');
    expect(scan.monthLabel).toMatch(/mai 2026/i);
    expect(scan.withinGrace).toBe(false);
    expect(scan.overdueCount).toBe(2);
    expect(scan.expectedCount).toBe(2);
  });

  it('excludes members who already have a debrief for the month', async () => {
    mockDb({ activeIds: ['u1', 'u2'], debriefIds: ['u1'] });
    const scan = await scanOverdueMonthlyDebriefs({ now: NOW });
    expect(scan.overdueCount).toBe(1); // only u2
  });

  it('returns 0 overdue when every active member has a debrief', async () => {
    mockDb({ activeIds: ['u1', 'u2'], debriefIds: ['u1', 'u2'] });
    const scan = await scanOverdueMonthlyDebriefs({ now: NOW });
    expect(scan.overdueCount).toBe(0);
  });

  it('returns 0 overdue while within the post-month-end grace window', async () => {
    mockDb({ activeIds: ['u1', 'u2'], debriefIds: [] });
    const scan = await scanOverdueMonthlyDebriefs({ now: WITHIN_GRACE });
    expect(scan.withinGrace).toBe(true);
    expect(scan.overdueCount).toBe(0);
    expect(scan.monthStart).toBe('2026-05-01'); // still reports May
  });

  it('floors the active-member query at joinedAt ≤ month end (no false overdue for recent joiners)', async () => {
    mockDb({ activeIds: ['u1'], debriefIds: [] });
    await scanOverdueMonthlyDebriefs({ now: NOW });

    const arg = vi.mocked(db.user.findMany).mock.calls[0]?.[0] as {
      where: { status: string; joinedAt: { lte: Date } };
    };
    expect(arg.where.status).toBe('active');
    expect(arg.where.joinedAt.lte).toBeInstanceOf(Date);
    // The floor is the END of May (the completed month), in UTC.
    expect(arg.where.joinedAt.lte.toISOString().slice(0, 7)).toBe('2026-05');
  });
});

describe('runMonthlyDebriefOverdueAlert — notification', () => {
  it('overdue=0 → quiet heartbeat audit, no email, no warning', async () => {
    mockDb({ activeIds: ['u1'], debriefIds: ['u1'] });

    const result = await runMonthlyDebriefOverdueAlert({ now: NOW });

    expect(result.overdueCount).toBe(0);
    expect(result.emailOutcome).toBe('not_attempted');
    expect(sendMock).not.toHaveBeenCalled();
    expect(reportWarning).not.toHaveBeenCalled();
    expect(vi.mocked(logAudit)).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'cron.monthly_debrief_overdue.scan' }),
    );
  });

  it('overdue>0 + recipient + delivered → warning + email sent + alerted heartbeat', async () => {
    mockDb({ activeIds: ['u1', 'u2'], debriefIds: [] });

    const result = await runMonthlyDebriefOverdueAlert({ now: NOW });

    expect(result.overdueCount).toBe(2);
    expect(result.emailOutcome).toBe('sent');
    expect(reportWarning).toHaveBeenCalledWith(
      'cron.monthly-debrief-overdue',
      'monthly_debriefs_overdue',
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
    ).find((a) => a.action === 'cron.monthly_debrief_overdue.scan');
    expect(scanRow?.metadata.emailOutcome).toBe('sent');
    expect(scanRow?.metadata.alerted).toBe(true);
    expect(JSON.stringify(scanRow?.metadata)).not.toMatch(/@/); // PII-free
  });

  it('overdue>0 + no recipient → warning + heartbeat, email not attempted', async () => {
    envMock.WEEKLY_REPORT_RECIPIENT = undefined;
    mockDb({ activeIds: ['u1'], debriefIds: [] });

    const result = await runMonthlyDebriefOverdueAlert({ now: NOW });

    expect(result.emailOutcome).toBe('not_attempted');
    expect(sendMock).not.toHaveBeenCalled();
    expect(reportWarning).toHaveBeenCalledWith(
      'cron.monthly-debrief-overdue',
      'monthly_debriefs_overdue',
      expect.anything(),
    );
  });

  it('overdue>0 + email throws → emailOutcome failed, alert still heartbeat-audited', async () => {
    sendMock.mockRejectedValue(new Error('Resend 500'));
    mockDb({ activeIds: ['u1'], debriefIds: [] });

    const result = await runMonthlyDebriefOverdueAlert({ now: NOW });

    expect(result.emailOutcome).toBe('failed');
    expect(reportWarning).toHaveBeenCalledWith(
      'cron.monthly-debrief-overdue',
      'admin_email_failed',
      expect.anything(),
    );
    const scanRow = (
      vi.mocked(logAudit).mock.calls.map((c) => c[0]) as Array<{
        action: string;
        metadata: Record<string, unknown>;
      }>
    ).find((a) => a.action === 'cron.monthly_debrief_overdue.scan');
    expect(scanRow?.metadata.emailOutcome).toBe('failed');
  });
});
