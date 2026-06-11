import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * S2 — onboarding profile permanence safety-net (3rd twin of the §26 calendar
 * / §25 monthly nets).
 *
 * `scanOverdueOnboardingProfiles` (per-interview 24h grace + oldest tracking)
 * and `runOnboardingProfileOverdueAlert` (alert vs quiet, all email outcomes)
 * run REAL. db / audit / observability / email / env are mocked. The
 * completed-only / active-user / no-profile candidate logic lives in the
 * Prisma where-clause → pinned by shape assertion (mirror of the monthly
 * test's joinedAt-floor pin).
 */

const { envMock, sendMock } = vi.hoisted(() => ({
  envMock: { WEEKLY_REPORT_RECIPIENT: 'admin@fxmily.test' as string | undefined },
  sendMock: vi.fn<(...args: unknown[]) => Promise<{ id: string | null; delivered: boolean }>>(),
}));

vi.mock('@/lib/db', () => ({
  db: {
    onboardingInterview: { findMany: vi.fn() },
  },
}));

vi.mock('@/lib/auth/audit', () => ({ logAudit: vi.fn() }));
vi.mock('@/lib/observability', () => ({ reportWarning: vi.fn() }));
vi.mock('@/lib/email/send', () => ({ sendOnboardingProfileOverdueAlertEmail: sendMock }));
vi.mock('@/lib/env', () => ({ env: envMock }));

import { logAudit } from '@/lib/auth/audit';
import { db } from '@/lib/db';
import { reportWarning } from '@/lib/observability';

import { runOnboardingProfileOverdueAlert, scanOverdueOnboardingProfiles } from './overdue';

const NOW = new Date('2026-06-11T10:00:00.000Z');
// Completed 49h before NOW → well past the 24h promise.
const OVERDUE_OLD = '2026-06-09T09:00:00.000Z';
// Completed 30h before NOW → past the 24h promise.
const OVERDUE_RECENT = '2026-06-10T04:00:00.000Z';
// Completed 14h before NOW → still inside the 24h promise window.
const WITHIN_GRACE = '2026-06-10T20:00:00.000Z';
// Completed EXACTLY 24h before NOW → the promise just expired → overdue (≤).
const EXACT_BOUNDARY = '2026-06-10T10:00:00.000Z';

/**
 * The scan reads `{ completedAt }` rows only (profile-less completed
 * interviews of active members — that filtering is DB-side, see the
 * where-clause pin below). The mock therefore only models timestamps.
 */
function mockDb(completedAts: string[]) {
  vi.mocked(db.onboardingInterview.findMany).mockResolvedValue(
    completedAts.map((iso) => ({ completedAt: new Date(iso) })) as never,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  envMock.WEEKLY_REPORT_RECIPIENT = 'admin@fxmily.test';
  sendMock.mockResolvedValue({ id: 'msg_1', delivered: true });
});

describe('scanOverdueOnboardingProfiles — candidate logic', () => {
  it('counts profile-less interviews completed more than 24h ago', async () => {
    mockDb([OVERDUE_OLD, OVERDUE_RECENT]);

    const scan = await scanOverdueOnboardingProfiles({ now: NOW });

    expect(scan.overdueCount).toBe(2);
    expect(scan.withinGrace).toBe(false);
    expect(scan.oldestCompletedAt).toBe(OVERDUE_OLD);
  });

  it('returns 0 + withinGrace while every pending interview is under 24h', async () => {
    mockDb([WITHIN_GRACE]);

    const scan = await scanOverdueOnboardingProfiles({ now: NOW });

    expect(scan.overdueCount).toBe(0);
    expect(scan.withinGrace).toBe(true);
    expect(scan.oldestCompletedAt).toBeNull();
  });

  it('grace boundary: an interview completed EXACTLY 24h ago is overdue (promise expired)', async () => {
    mockDb([EXACT_BOUNDARY]);

    const scan = await scanOverdueOnboardingProfiles({ now: NOW });

    expect(scan.overdueCount).toBe(1);
    expect(scan.withinGrace).toBe(false);
  });

  it('mixes per-interview windows: only the past-24h ones are counted', async () => {
    mockDb([OVERDUE_OLD, WITHIN_GRACE]);

    const scan = await scanOverdueOnboardingProfiles({ now: NOW });

    expect(scan.overdueCount).toBe(1); // only the 49h-old one
    expect(scan.withinGrace).toBe(false); // an overdue exists → not calm
    expect(scan.oldestCompletedAt).toBe(OVERDUE_OLD);
  });

  it('returns 0 overdue + withinGrace=false when nothing is pending at all', async () => {
    mockDb([]);

    const scan = await scanOverdueOnboardingProfiles({ now: NOW });

    expect(scan.overdueCount).toBe(0);
    expect(scan.withinGrace).toBe(false);
    expect(scan.oldestCompletedAt).toBeNull();
  });

  it('delegates completed/active-user/no-profile filtering to the where-clause (PII-free select)', async () => {
    // « profile existant → non compté » and « user inactif → non compté » are
    // enforced DB-side by the relation filters — pin their exact shape so a
    // silent where-clause regression (e.g. dropping `profile: { is: null }`)
    // fails here instead of paging every member with a profile.
    mockDb([]);
    await scanOverdueOnboardingProfiles({ now: NOW });

    const arg = vi.mocked(db.onboardingInterview.findMany).mock.calls[0]?.[0] as {
      where: Record<string, unknown>;
      select: Record<string, unknown>;
    };
    expect(arg.where.status).toBe('completed');
    expect(arg.where.completedAt).toEqual({ not: null });
    expect(arg.where.user).toEqual({ status: 'active' });
    expect(arg.where.profile).toEqual({ is: null });
    // PII-free by construction : the scan only ever reads the timestamp.
    expect(arg.select).toEqual({ completedAt: true });
  });
});

describe('runOnboardingProfileOverdueAlert — notification', () => {
  it('overdue=0 → quiet heartbeat audit, no email, no warning', async () => {
    mockDb([WITHIN_GRACE]);

    const result = await runOnboardingProfileOverdueAlert({ now: NOW });

    expect(result.overdueCount).toBe(0);
    expect(result.emailOutcome).toBe('not_attempted');
    expect(sendMock).not.toHaveBeenCalled();
    expect(reportWarning).not.toHaveBeenCalled();
    expect(vi.mocked(logAudit)).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'cron.onboarding_profile_overdue.scan' }),
    );
  });

  it('overdue>0 + recipient + delivered → warning + email sent + alerted heartbeat', async () => {
    mockDb([OVERDUE_OLD, OVERDUE_RECENT]);

    const result = await runOnboardingProfileOverdueAlert({ now: NOW });

    expect(result.overdueCount).toBe(2);
    expect(result.emailOutcome).toBe('sent');
    expect(reportWarning).toHaveBeenCalledWith(
      'cron.onboarding-profile-overdue',
      'onboarding_profiles_overdue',
      expect.objectContaining({ overdueCount: 2 }),
    );
    expect(sendMock).toHaveBeenCalledWith(
      expect.objectContaining({
        to: 'admin@fxmily.test',
        overdueCount: 2,
        oldestCompletedAt: OVERDUE_OLD,
      }),
    );
    const scanRow = (
      vi.mocked(logAudit).mock.calls.map((c) => c[0]) as Array<{
        action: string;
        metadata: Record<string, unknown>;
      }>
    ).find((a) => a.action === 'cron.onboarding_profile_overdue.scan');
    expect(scanRow?.metadata.emailOutcome).toBe('sent');
    expect(scanRow?.metadata.alerted).toBe(true);
    expect(scanRow?.metadata.oldestCompletedAt).toBe(OVERDUE_OLD);
    expect(JSON.stringify(scanRow?.metadata)).not.toMatch(/@/); // PII-free
  });

  it('overdue>0 + no recipient → warning + heartbeat, email not attempted', async () => {
    envMock.WEEKLY_REPORT_RECIPIENT = undefined;
    mockDb([OVERDUE_OLD]);

    const result = await runOnboardingProfileOverdueAlert({ now: NOW });

    expect(result.emailOutcome).toBe('not_attempted');
    expect(sendMock).not.toHaveBeenCalled();
    expect(reportWarning).toHaveBeenCalledWith(
      'cron.onboarding-profile-overdue',
      'onboarding_profiles_overdue',
      expect.anything(),
    );
  });

  it('overdue>0 + email throws → emailOutcome failed, alert still heartbeat-audited', async () => {
    sendMock.mockRejectedValue(new Error('Resend 500'));
    mockDb([OVERDUE_OLD]);

    const result = await runOnboardingProfileOverdueAlert({ now: NOW });

    expect(result.emailOutcome).toBe('failed');
    expect(reportWarning).toHaveBeenCalledWith(
      'cron.onboarding-profile-overdue',
      'admin_email_failed',
      expect.anything(),
    );
    const scanRow = (
      vi.mocked(logAudit).mock.calls.map((c) => c[0]) as Array<{
        action: string;
        metadata: Record<string, unknown>;
      }>
    ).find((a) => a.action === 'cron.onboarding_profile_overdue.scan');
    expect(scanRow?.metadata.emailOutcome).toBe('failed');
  });
});
