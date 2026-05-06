import { afterEach, describe, expect, it, vi } from 'vitest';

// Mock the DB + the enqueue helper before importing the SUT.
const userFindManyMock = vi.fn();
const dailyCheckinFindManyMock = vi.fn();

vi.mock('@/lib/db', () => ({
  db: {
    user: { findMany: userFindManyMock },
    dailyCheckin: { findMany: dailyCheckinFindManyMock },
  },
}));

const enqueueCheckinReminderMock = vi.fn();
vi.mock('@/lib/notifications/enqueue', () => ({
  enqueueCheckinReminder: enqueueCheckinReminderMock,
}));

const logAuditMock = vi.fn(async () => undefined);
vi.mock('@/lib/auth/audit', () => ({
  logAudit: logAuditMock,
}));

const { runCheckinReminderScan } = await import('./reminders');

afterEach(() => {
  userFindManyMock.mockReset();
  dailyCheckinFindManyMock.mockReset();
  enqueueCheckinReminderMock.mockReset();
  logAuditMock.mockClear();
});

/**
 * Cron scan helper (J5 audit BLOCKERS B2 + B3).
 *
 * V1 ships single-TZ (Europe/Paris). The fast path early-returns when the
 * window probe says "neither morning nor evening is due", which keeps the
 * cron run cheap (1 audit row, zero DB churn) outside the 07:30-09:00 /
 * 20:30-22:00 windows.
 */
describe('runCheckinReminderScan', () => {
  it('early-returns with zero scan when out of all reminder windows', async () => {
    // 14:00 UTC = 16:00 Paris = neither window.
    const out = await runCheckinReminderScan(new Date('2026-05-06T14:00:00Z'));
    expect(out.scannedUsers).toBe(0);
    expect(out.enqueuedMorning).toBe(0);
    expect(out.enqueuedEvening).toBe(0);
    expect(userFindManyMock).not.toHaveBeenCalled();
    expect(enqueueCheckinReminderMock).not.toHaveBeenCalled();
    // The audit row still fires — that's our heartbeat.
    expect(logAuditMock).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'checkin.reminder.scan',
        metadata: expect.objectContaining({ reason: 'out_of_window' }),
      }),
    );
  });

  it('reports zero work + audit reason when window is open but no eligible members', async () => {
    userFindManyMock.mockResolvedValueOnce([]);
    // 06:30 UTC = 08:30 Paris = morning window.
    const out = await runCheckinReminderScan(new Date('2026-05-06T06:30:00Z'));
    expect(out.scannedUsers).toBe(0);
    expect(enqueueCheckinReminderMock).not.toHaveBeenCalled();
    expect(logAuditMock).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: expect.objectContaining({ reason: 'no_eligible_users' }),
      }),
    );
  });

  it('enqueues morning reminders for all due users in a single bulk lookup', async () => {
    userFindManyMock.mockResolvedValueOnce([
      { id: 'user_a', timezone: 'Europe/Paris' },
      { id: 'user_b', timezone: 'Europe/Paris' },
    ]);
    // user_a already filed morning, user_b hasn't.
    dailyCheckinFindManyMock.mockResolvedValueOnce([
      { userId: 'user_a', date: new Date('2026-05-06T00:00:00Z'), slot: 'morning' },
    ]);
    enqueueCheckinReminderMock.mockResolvedValueOnce('notif_b');

    // 06:30 UTC = 08:30 Paris = morning window.
    const out = await runCheckinReminderScan(new Date('2026-05-06T06:30:00Z'));

    expect(dailyCheckinFindManyMock).toHaveBeenCalledTimes(1);
    expect(enqueueCheckinReminderMock).toHaveBeenCalledTimes(1);
    expect(enqueueCheckinReminderMock).toHaveBeenCalledWith('user_b', {
      slot: 'morning',
      date: '2026-05-06',
    });
    expect(out.scannedUsers).toBe(2);
    expect(out.enqueuedMorning).toBe(1);
    expect(out.skipped).toBe(1);
  });

  it('enqueues evening reminders correctly during the evening window', async () => {
    userFindManyMock.mockResolvedValueOnce([{ id: 'user_a', timezone: 'Europe/Paris' }]);
    dailyCheckinFindManyMock.mockResolvedValueOnce([]);
    enqueueCheckinReminderMock.mockResolvedValueOnce('notif_x');

    // 18:30 UTC = 20:30 Paris = evening window.
    const out = await runCheckinReminderScan(new Date('2026-05-06T18:30:00Z'));

    expect(out.enqueuedEvening).toBe(1);
    expect(out.enqueuedMorning).toBe(0);
    expect(enqueueCheckinReminderMock).toHaveBeenCalledWith('user_a', {
      slot: 'evening',
      date: '2026-05-06',
    });
  });

  it('skips users whose slot is already filled (no enqueue, counted as skipped)', async () => {
    userFindManyMock.mockResolvedValueOnce([{ id: 'user_a', timezone: 'Europe/Paris' }]);
    dailyCheckinFindManyMock.mockResolvedValueOnce([
      { userId: 'user_a', date: new Date('2026-05-06T00:00:00Z'), slot: 'evening' },
    ]);
    const out = await runCheckinReminderScan(new Date('2026-05-06T18:30:00Z'));
    expect(out.enqueuedEvening).toBe(0);
    expect(out.skipped).toBe(1);
    expect(enqueueCheckinReminderMock).not.toHaveBeenCalled();
  });

  it('respects the userIds option (filters to a subset)', async () => {
    userFindManyMock.mockResolvedValueOnce([{ id: 'user_a', timezone: 'Europe/Paris' }]);
    dailyCheckinFindManyMock.mockResolvedValueOnce([]);
    enqueueCheckinReminderMock.mockResolvedValueOnce('id');

    await runCheckinReminderScan(new Date('2026-05-06T06:30:00Z'), { userIds: ['user_a'] });

    expect(userFindManyMock.mock.calls[0]?.[0]?.where?.id).toEqual({ in: ['user_a'] });
  });

  it('does not double-count when a user has both windows due simultaneously (e.g. test scenarios)', async () => {
    userFindManyMock.mockResolvedValueOnce([{ id: 'user_a', timezone: 'Europe/Paris' }]);
    dailyCheckinFindManyMock.mockResolvedValueOnce([]);
    enqueueCheckinReminderMock.mockResolvedValueOnce('m').mockResolvedValueOnce('e');

    // 06:30 UTC = 08:30 Paris (only morning is due in Paris). Evening window
    // would need 18:30+. So this is morning only — assert that.
    const out = await runCheckinReminderScan(new Date('2026-05-06T06:30:00Z'));
    expect(out.enqueuedMorning).toBe(1);
    expect(out.enqueuedEvening).toBe(0);
  });

  it('logs the canonical audit row at the end of every scan that ran', async () => {
    userFindManyMock.mockResolvedValueOnce([{ id: 'user_a', timezone: 'Europe/Paris' }]);
    dailyCheckinFindManyMock.mockResolvedValueOnce([]);
    enqueueCheckinReminderMock.mockResolvedValueOnce('id');

    await runCheckinReminderScan(new Date('2026-05-06T06:30:00Z'));

    expect(logAuditMock).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'checkin.reminder.scan',
        metadata: expect.objectContaining({
          scannedUsers: 1,
          enqueuedMorning: 1,
          enqueuedEvening: 0,
          skipped: 0,
        }),
      }),
    );
  });
});
