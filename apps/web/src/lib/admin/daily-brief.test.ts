import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Tour 15 — daily ADMIN brief composition + run.
 *
 * `composeAdminDailyBrief` (reuse triage counts + new-signal delta + drifting
 * members) and `runAdminDailyBrief` (email outcomes + heartbeat) run REAL.
 * `getTriageQueueCounts` is mocked (it has its own test) so the brief logic is
 * exercised in isolation; db / audit / observability / email / env are mocked.
 */

const { envMock, sendMock, triageMock } = vi.hoisted(() => ({
  envMock: { WEEKLY_REPORT_RECIPIENT: 'admin@fxmily.test' as string | undefined },
  sendMock: vi.fn<(...args: unknown[]) => Promise<{ id: string | null; delivered: boolean }>>(),
  triageMock: vi.fn(),
}));

vi.mock('@/lib/db', () => ({
  db: {
    markDouglasDelivery: { groupBy: vi.fn(), count: vi.fn() },
    user: { count: vi.fn() },
  },
}));

vi.mock('@/lib/auth/audit', () => ({ logAudit: vi.fn() }));
vi.mock('@/lib/observability', () => ({ reportWarning: vi.fn() }));
vi.mock('@/lib/email/send', () => ({ sendAdminDailyBriefEmail: sendMock }));
vi.mock('@/lib/env', () => ({ env: envMock }));
// Spread the REAL module so the single-sourced disengagement predicate
// (`DISENGAGED_AFTER_MS` + `disengagedMembersWhere`) flows through the brief
// unchanged — only `getTriageQueueCounts` is stubbed (it has its own test).
vi.mock('./attention-service', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./attention-service')>();
  return { ...actual, getTriageQueueCounts: triageMock };
});

import { logAudit } from '@/lib/auth/audit';
import { db } from '@/lib/db';
import { reportWarning } from '@/lib/observability';

import { composeAdminDailyBrief, runAdminDailyBrief } from './daily-brief';

const NOW = new Date('2026-07-06T05:00:00.000Z');

const TRIAGE = {
  uncommentedClosed: 4,
  staleOpen: 1,
  openDiscrepancies: 2,
  behavioralSignals: 3,
  total: 10,
};

/** Wire the four reads the brief performs. `signalMembers` = distinct members
 *  with a delivery in the last 24h; `deliveries` = raw delivery count;
 *  `disengaged` = active members not seen for a week. */
function mockDb(opts: { signalMembers: string[]; deliveries: number; disengaged: number }) {
  triageMock.mockResolvedValue(TRIAGE);
  vi.mocked(db.markDouglasDelivery.groupBy).mockResolvedValue(
    opts.signalMembers.map((userId) => ({ userId })) as never,
  );
  vi.mocked(db.markDouglasDelivery.count).mockResolvedValue(opts.deliveries as never);
  vi.mocked(db.user.count).mockResolvedValue(opts.disengaged as never);
}

/** Grab the first-call argument of a mocked method (typed loosely). */
function firstArg(fn: unknown): Record<string, unknown> {
  const calls = (fn as { mock: { calls: unknown[][] } }).mock.calls;
  const call = calls[0];
  if (!call) throw new Error('expected the method to have been called');
  return call[0] as Record<string, unknown>;
}

beforeEach(() => {
  vi.clearAllMocks();
  envMock.WEEKLY_REPORT_RECIPIENT = 'admin@fxmily.test';
  sendMock.mockResolvedValue({ id: 'msg_1', delivered: true });
});

describe('composeAdminDailyBrief', () => {
  it('reuses the triage counts and adds the 24h signal delta + drifting members', async () => {
    mockDb({ signalMembers: ['m1', 'm2'], deliveries: 5, disengaged: 3 });

    const brief = await composeAdminDailyBrief({ now: NOW });

    expect(brief.triage).toEqual(TRIAGE);
    expect(brief.newSignalMembers).toBe(2); // distinct members, not deliveries
    expect(brief.newSignalDeliveries).toBe(5);
    expect(brief.disengagedMembers).toBe(3);
    expect(brief.composedAt).toBe(NOW.toISOString());
  });

  it('reads the signal delta over a 24h window, non-deleted members only', async () => {
    mockDb({ signalMembers: [], deliveries: 0, disengaged: 0 });

    await composeAdminDailyBrief({ now: NOW });

    const groupArg = firstArg(db.markDouglasDelivery.groupBy);
    expect(groupArg.by).toEqual(['userId']);
    const where = groupArg.where as Record<string, unknown>;
    expect(where.user).toEqual({ status: { not: 'deleted' } });
    const floor = (where.createdAt as { gte: Date }).gte;
    // 24h before NOW.
    expect(floor.getTime()).toBe(NOW.getTime() - 24 * 60 * 60 * 1000);
  });

  it('scopes drifting members to active, non-deleted, not seen for a week', async () => {
    mockDb({ signalMembers: [], deliveries: 0, disengaged: 0 });

    await composeAdminDailyBrief({ now: NOW });

    const where = firstArg(db.user.count).where as Record<string, unknown>;
    expect(where.status).toBe('active');
    expect(where.deletedAt).toBeNull();
    // Either last seen before the 7-day floor, or never seen while joined before it.
    const or = where.OR as Array<Record<string, unknown>>;
    expect(or).toHaveLength(2);
    const weekFloor = NOW.getTime() - 7 * 24 * 60 * 60 * 1000;
    expect((or[0]?.lastSeenAt as { lt: Date }).lt.getTime()).toBe(weekFloor);
    expect(or[1]?.lastSeenAt).toBeNull();
    expect((or[1]?.joinedAt as { lt: Date }).lt.getTime()).toBe(weekFloor);
  });
});

describe('runAdminDailyBrief', () => {
  it('emails the operator and heartbeats with the counts (busy day)', async () => {
    mockDb({ signalMembers: ['m1', 'm2'], deliveries: 5, disengaged: 3 });

    const result = await runAdminDailyBrief({ now: NOW });

    expect(result.emailOutcome).toBe('sent');
    expect(sendMock).toHaveBeenCalledTimes(1);
    const emailArg = firstArg(sendMock);
    expect(emailArg.to).toBe('admin@fxmily.test');
    // The email carries the composed brief (counts only — PII-free).
    expect((emailArg.brief as { newSignalMembers: number }).newSignalMembers).toBe(2);

    // Heartbeat ALWAYS fires with the PII-free counts.
    const auditArg = firstArg(logAudit);
    expect(auditArg.action).toBe('cron.admin_daily_brief.scan');
    const meta = auditArg.metadata as Record<string, unknown>;
    expect(meta.triageTotal).toBe(10);
    expect(meta.newSignalMembers).toBe(2);
    expect(meta.disengagedMembers).toBe(3);
    expect(meta.emailOutcome).toBe('sent');
    // No member id / name / email in the heartbeat metadata (PII-free invariant).
    expect(JSON.stringify(meta)).not.toContain('m1');
  });

  it('still emails + heartbeats on a totally calm day (standing report)', async () => {
    mockDb({ signalMembers: [], deliveries: 0, disengaged: 0 });
    triageMock.mockResolvedValue({
      uncommentedClosed: 0,
      staleOpen: 0,
      openDiscrepancies: 0,
      behavioralSignals: 0,
      total: 0,
    });

    const result = await runAdminDailyBrief({ now: NOW });

    // A calm day is NOT skipped — the brief is a standing report, so silence
    // always means a broken cron, never a quiet day.
    expect(result.emailOutcome).toBe('sent');
    expect(sendMock).toHaveBeenCalledTimes(1);
    expect(logAudit).toHaveBeenCalledTimes(1);
  });

  it('degrades to a warning when the email throws, heartbeat records failed', async () => {
    mockDb({ signalMembers: ['m1'], deliveries: 1, disengaged: 0 });
    sendMock.mockRejectedValue(new Error('resend down'));

    const result = await runAdminDailyBrief({ now: NOW });

    expect(result.emailOutcome).toBe('failed');
    expect(reportWarning).toHaveBeenCalledWith(
      'cron.admin-daily-brief',
      'admin_email_failed',
      expect.objectContaining({ error: expect.stringContaining('resend down') }),
    );
    // The heartbeat STILL fires (never blinds the monitor on an email failure).
    expect(logAudit).toHaveBeenCalledTimes(1);
    const meta = firstArg(logAudit).metadata as Record<string, unknown>;
    expect(meta.emailOutcome).toBe('failed');
  });

  it('skips the email but still heartbeats when no recipient is configured', async () => {
    mockDb({ signalMembers: [], deliveries: 0, disengaged: 0 });
    envMock.WEEKLY_REPORT_RECIPIENT = undefined;

    const result = await runAdminDailyBrief({ now: NOW });

    expect(result.emailOutcome).toBe('not_attempted');
    expect(sendMock).not.toHaveBeenCalled();
    expect(logAudit).toHaveBeenCalledTimes(1);
    expect((firstArg(logAudit).metadata as Record<string, unknown>).emailOutcome).toBe(
      'not_attempted',
    );
  });

  it('records a skipped outcome when the mailer reports not delivered (dev fallback)', async () => {
    mockDb({ signalMembers: [], deliveries: 0, disengaged: 0 });
    sendMock.mockResolvedValue({ id: null, delivered: false });

    const result = await runAdminDailyBrief({ now: NOW });

    expect(result.emailOutcome).toBe('skipped');
    expect((firstArg(logAudit).metadata as Record<string, unknown>).emailOutcome).toBe('skipped');
  });
});
