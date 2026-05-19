import { afterEach, describe, expect, it, vi } from 'vitest';

// Mock the DB + the enqueue helper + audit before importing the SUT.
const userFindManyMock = vi.fn();
const mindsetCheckFindManyMock = vi.fn();
const notificationQueueFindManyMock = vi.fn();

vi.mock('@/lib/db', () => ({
  db: {
    user: { findMany: userFindManyMock },
    mindsetCheck: { findMany: mindsetCheckFindManyMock },
    notificationQueue: { findMany: notificationQueueFindManyMock },
  },
}));

const enqueueMindsetCheckNotificationMock = vi.fn();
vi.mock('@/lib/notifications/enqueue', () => ({
  enqueueMindsetCheckNotification: enqueueMindsetCheckNotificationMock,
}));

const logAuditMock = vi.fn(async () => undefined);
vi.mock('@/lib/auth/audit', () => ({
  logAudit: logAuditMock,
}));

const { runMindsetCheckReminderScan } = await import('./reminders');

afterEach(() => {
  userFindManyMock.mockReset();
  mindsetCheckFindManyMock.mockReset();
  notificationQueueFindManyMock.mockReset();
  enqueueMindsetCheckNotificationMock.mockReset();
  logAuditMock.mockClear();
});

/**
 * SPEC §27.2/§27.4 — weekly mindset reminder scan. Unlike check-in, there is
 * NO time-window probe (weekly single-instance cron); idempotency is the skip
 * logic. Reference Monday: 2026-05-11 (Europe/Paris week of 2026-05-11→17).
 */
describe('runMindsetCheckReminderScan', () => {
  // 2026-05-13 (Wed) 09:00 UTC → Paris week starts Monday 2026-05-11.
  const NOW = new Date('2026-05-13T09:00:00Z');
  const WEEK = '2026-05-11';

  it('no eligible members → zero work + audit reason, no enqueue', async () => {
    userFindManyMock.mockResolvedValueOnce([]);
    const out = await runMindsetCheckReminderScan(NOW);
    expect(out.scannedUsers).toBe(0);
    expect(out.enqueued).toBe(0);
    expect(out.weekStart).toBe(WEEK);
    expect(enqueueMindsetCheckNotificationMock).not.toHaveBeenCalled();
    expect(logAuditMock).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'cron.mindset_check_reminders.scan',
        metadata: expect.objectContaining({ reason: 'no_eligible_users' }),
      }),
    );
  });

  it('enqueues only members who have not submitted this week (1 bulk lookup each)', async () => {
    userFindManyMock.mockResolvedValueOnce([{ id: 'user_a' }, { id: 'user_b' }]);
    // user_a already submitted this week's mindset check, user_b hasn't.
    mindsetCheckFindManyMock.mockResolvedValueOnce([{ userId: 'user_a' }]);
    notificationQueueFindManyMock.mockResolvedValueOnce([]);
    enqueueMindsetCheckNotificationMock.mockResolvedValueOnce('notif_b');

    const out = await runMindsetCheckReminderScan(NOW);

    expect(mindsetCheckFindManyMock).toHaveBeenCalledTimes(1);
    expect(notificationQueueFindManyMock).toHaveBeenCalledTimes(1);
    expect(enqueueMindsetCheckNotificationMock).toHaveBeenCalledTimes(1);
    expect(enqueueMindsetCheckNotificationMock).toHaveBeenCalledWith('user_b', {
      weekStart: WEEK,
    });
    expect(out.scannedUsers).toBe(2);
    expect(out.enqueued).toBe(1);
    expect(out.skipped).toBe(1);
  });

  it('skips a member who already has a pending nudge FOR THIS week (idempotent)', async () => {
    userFindManyMock.mockResolvedValueOnce([{ id: 'user_a' }]);
    mindsetCheckFindManyMock.mockResolvedValueOnce([]);
    notificationQueueFindManyMock.mockResolvedValueOnce([
      { userId: 'user_a', payload: { weekStart: WEEK } },
    ]);

    const out = await runMindsetCheckReminderScan(NOW);

    expect(enqueueMindsetCheckNotificationMock).not.toHaveBeenCalled();
    expect(out.enqueued).toBe(0);
    expect(out.skipped).toBe(1);
  });

  it('a pending nudge for a DIFFERENT (older) week does NOT skip the new week', async () => {
    userFindManyMock.mockResolvedValueOnce([{ id: 'user_a' }]);
    mindsetCheckFindManyMock.mockResolvedValueOnce([]);
    notificationQueueFindManyMock.mockResolvedValueOnce([
      { userId: 'user_a', payload: { weekStart: '2026-05-04' } },
    ]);
    enqueueMindsetCheckNotificationMock.mockResolvedValueOnce('notif_a');

    const out = await runMindsetCheckReminderScan(NOW);

    expect(enqueueMindsetCheckNotificationMock).toHaveBeenCalledWith('user_a', {
      weekStart: WEEK,
    });
    expect(out.enqueued).toBe(1);
  });

  it('respects the userIds option (filters the cohort)', async () => {
    userFindManyMock.mockResolvedValueOnce([{ id: 'user_a' }]);
    mindsetCheckFindManyMock.mockResolvedValueOnce([]);
    notificationQueueFindManyMock.mockResolvedValueOnce([]);
    enqueueMindsetCheckNotificationMock.mockResolvedValueOnce('id');

    await runMindsetCheckReminderScan(NOW, { userIds: ['user_a'] });

    expect(userFindManyMock.mock.calls[0]?.[0]?.where?.id).toEqual({ in: ['user_a'] });
  });

  it('counts a failed enqueue (null) as skipped, not enqueued', async () => {
    userFindManyMock.mockResolvedValueOnce([{ id: 'user_a' }]);
    mindsetCheckFindManyMock.mockResolvedValueOnce([]);
    notificationQueueFindManyMock.mockResolvedValueOnce([]);
    enqueueMindsetCheckNotificationMock.mockResolvedValueOnce(null);

    const out = await runMindsetCheckReminderScan(NOW);

    expect(out.enqueued).toBe(0);
    expect(out.skipped).toBe(1);
  });

  it('logs the canonical heartbeat audit row at the end of every scan that ran', async () => {
    userFindManyMock.mockResolvedValueOnce([{ id: 'user_a' }]);
    mindsetCheckFindManyMock.mockResolvedValueOnce([]);
    notificationQueueFindManyMock.mockResolvedValueOnce([]);
    enqueueMindsetCheckNotificationMock.mockResolvedValueOnce('id');

    await runMindsetCheckReminderScan(NOW);

    expect(logAuditMock).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'cron.mindset_check_reminders.scan',
        metadata: expect.objectContaining({
          scannedUsers: 1,
          enqueued: 1,
          skipped: 0,
          weekStart: WEEK,
        }),
      }),
    );
  });
});
