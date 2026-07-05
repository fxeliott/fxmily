import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Mock the DB + the enqueue helper before importing the SUT.
const userFindManyMock = vi.fn();
const dailyCheckinFindManyMock = vi.fn();
const memberOffDayFindManyMock = vi.fn();

vi.mock('@/lib/db', () => ({
  db: {
    user: { findMany: userFindManyMock },
    dailyCheckin: { findMany: dailyCheckinFindManyMock },
    memberOffDay: { findMany: memberOffDayFindManyMock },
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

beforeEach(() => {
  // Tour 14 — default: no explicit off days declared. Individual tests override
  // this to exercise the off-day pont (streak skip + reminder suppression).
  memberOffDayFindManyMock.mockResolvedValue([]);
});

afterEach(() => {
  userFindManyMock.mockReset();
  dailyCheckinFindManyMock.mockReset();
  memberOffDayFindManyMock.mockReset();
  enqueueCheckinReminderMock.mockReset();
  logAuditMock.mockClear();
});

/**
 * Cron scan helper (J5 audit BLOCKERS B2 + B3, F2 per-TZ buckets).
 *
 * The fast path early-returns when NO timezone present in the cohort has a
 * morning/evening window due, which keeps the cron run cheap (1 audit row, no
 * checkin bulk fetch + enqueue) outside the 07:30-09:00 / 20:30-22:00 LOCAL
 * windows. F2 — the probe runs on the ACTUAL cohort's distinct timezones, so it
 * needs the (cheap, ≪30-row) user fetch first; a single Europe/Paris probe
 * would mis-fire for members living elsewhere.
 */
describe('runCheckinReminderScan', () => {
  it('early-returns without the checkin bulk fetch when the whole cohort is out of all windows', async () => {
    // 14:00 UTC = 16:00 Paris = neither window for a Paris-only cohort. The
    // cohort IS fetched (to learn its timezones) but the heavier per-day checkin
    // bulk fetch + enqueue loop are short-circuited.
    userFindManyMock.mockResolvedValueOnce([
      { id: 'user_a', timezone: 'Europe/Paris', weekendsOff: true },
      { id: 'user_b', timezone: 'Europe/Paris', weekendsOff: true },
    ]);
    const out = await runCheckinReminderScan(new Date('2026-05-06T14:00:00Z'));
    expect(out.scannedUsers).toBe(0);
    expect(out.enqueuedMorning).toBe(0);
    expect(out.enqueuedEvening).toBe(0);
    expect(dailyCheckinFindManyMock).not.toHaveBeenCalled();
    expect(enqueueCheckinReminderMock).not.toHaveBeenCalled();
    // The audit row still fires — that's our heartbeat.
    expect(logAuditMock).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'cron.checkin_reminders.scan',
        metadata: expect.objectContaining({ reason: 'out_of_window' }),
      }),
    );
  });

  it('F2: enqueues for a member whose LOCAL window is due even though Europe/Paris is out of window', async () => {
    // 12:00 UTC. Paris = 14:00 CEST (out of both windows). A member in
    // America/New_York is at 08:00 EDT → inside the 07:30-09:00 morning window.
    // A single Europe/Paris probe would WRONGLY skip the whole scan; the per-TZ
    // bucket probe must keep it alive and enqueue the NY member only.
    userFindManyMock.mockResolvedValueOnce([
      { id: 'paris_u', timezone: 'Europe/Paris', weekendsOff: true },
      { id: 'ny_u', timezone: 'America/New_York', weekendsOff: false },
    ]);
    dailyCheckinFindManyMock.mockResolvedValueOnce([]);
    enqueueCheckinReminderMock.mockResolvedValueOnce('notif_ny');

    const out = await runCheckinReminderScan(new Date('2026-05-06T12:00:00Z'));

    // Only the NY member is in-window; the Paris member is scanned-but-skipped.
    expect(enqueueCheckinReminderMock).toHaveBeenCalledTimes(1);
    expect(enqueueCheckinReminderMock).toHaveBeenCalledWith('ny_u', {
      slot: 'morning',
      date: '2026-05-06',
      streak: 0,
    });
    expect(out.scannedUsers).toBe(2);
    expect(out.enqueuedMorning).toBe(1);
    expect(out.enqueuedEvening).toBe(0);
    expect(out.skipped).toBe(1);
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
      { id: 'user_a', timezone: 'Europe/Paris', weekendsOff: true },
      { id: 'user_b', timezone: 'Europe/Paris', weekendsOff: true },
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
      streak: 0,
    });
    expect(out.scannedUsers).toBe(2);
    expect(out.enqueuedMorning).toBe(1);
    expect(out.skipped).toBe(1);
  });

  it('enqueues evening reminders correctly during the evening window', async () => {
    userFindManyMock.mockResolvedValueOnce([
      { id: 'user_a', timezone: 'Europe/Paris', weekendsOff: true },
    ]);
    dailyCheckinFindManyMock.mockResolvedValueOnce([]);
    enqueueCheckinReminderMock.mockResolvedValueOnce('notif_x');

    // 18:30 UTC = 20:30 Paris = evening window.
    const out = await runCheckinReminderScan(new Date('2026-05-06T18:30:00Z'));

    expect(out.enqueuedEvening).toBe(1);
    expect(out.enqueuedMorning).toBe(0);
    expect(enqueueCheckinReminderMock).toHaveBeenCalledWith('user_a', {
      slot: 'evening',
      date: '2026-05-06',
      streak: 0,
    });
  });

  it('skips users whose slot is already filled (no enqueue, counted as skipped)', async () => {
    userFindManyMock.mockResolvedValueOnce([
      { id: 'user_a', timezone: 'Europe/Paris', weekendsOff: true },
    ]);
    dailyCheckinFindManyMock.mockResolvedValueOnce([
      { userId: 'user_a', date: new Date('2026-05-06T00:00:00Z'), slot: 'evening' },
    ]);
    const out = await runCheckinReminderScan(new Date('2026-05-06T18:30:00Z'));
    expect(out.enqueuedEvening).toBe(0);
    expect(out.skipped).toBe(1);
    expect(enqueueCheckinReminderMock).not.toHaveBeenCalled();
  });

  it('counts a due+unfilled slot whose enqueue FAILS (null) as an error, NOT a skip (observability A-Z)', async () => {
    userFindManyMock.mockResolvedValueOnce([
      { id: 'user_a', timezone: 'Europe/Paris', weekendsOff: true },
    ]);
    dailyCheckinFindManyMock.mockResolvedValueOnce([]);
    // Genuine enqueue failure (NOT the P2002 no-op): the helper returns null.
    enqueueCheckinReminderMock.mockResolvedValueOnce(null);

    // 18:30 UTC = 20:30 Paris → evening due, slot unfilled → it WILL attempt.
    const out = await runCheckinReminderScan(new Date('2026-05-06T18:30:00Z'));

    // A failed reminder must surface as `errors` so health.ts escalates the
    // cron green→amber instead of the failure hiding in `skipped`.
    expect(out.enqueuedEvening).toBe(0);
    expect(out.errors).toBe(1);
    expect(out.skipped).toBe(0);
    expect(enqueueCheckinReminderMock).toHaveBeenCalledTimes(1);
  });

  it('respects the userIds option (filters to a subset)', async () => {
    userFindManyMock.mockResolvedValueOnce([
      { id: 'user_a', timezone: 'Europe/Paris', weekendsOff: true },
    ]);
    dailyCheckinFindManyMock.mockResolvedValueOnce([]);
    enqueueCheckinReminderMock.mockResolvedValueOnce('id');

    await runCheckinReminderScan(new Date('2026-05-06T06:30:00Z'), { userIds: ['user_a'] });

    expect(userFindManyMock.mock.calls[0]?.[0]?.where?.id).toEqual({ in: ['user_a'] });
  });

  it('does not double-count when a user has both windows due simultaneously (e.g. test scenarios)', async () => {
    userFindManyMock.mockResolvedValueOnce([
      { id: 'user_a', timezone: 'Europe/Paris', weekendsOff: true },
    ]);
    dailyCheckinFindManyMock.mockResolvedValueOnce([]);
    enqueueCheckinReminderMock.mockResolvedValueOnce('m').mockResolvedValueOnce('e');

    // 06:30 UTC = 08:30 Paris (only morning is due in Paris). Evening window
    // would need 18:30+. So this is morning only — assert that.
    const out = await runCheckinReminderScan(new Date('2026-05-06T06:30:00Z'));
    expect(out.enqueuedMorning).toBe(1);
    expect(out.enqueuedEvening).toBe(0);
  });

  // Tour 12 (action 2) — the scan computes the member's streak in memory from the
  // widened bulk fetch and passes it to the enqueue (no per-member query).
  it('passes the current streak (from the pre-fetched window) to the enqueue', async () => {
    userFindManyMock.mockResolvedValueOnce([
      { id: 'user_a', timezone: 'Europe/Paris', weekendsOff: true },
    ]);
    // Evening window is due on 2026-05-06. Streak walk anchors on TODAY: since
    // today's slot isn't filled yet, the streak is the consecutive run ending
    // YESTERDAY. Seed 3 consecutive prior days (05-03..05-05) → streak = 3.
    dailyCheckinFindManyMock.mockResolvedValueOnce([
      { userId: 'user_a', date: new Date('2026-05-05T00:00:00Z'), slot: 'evening' },
      { userId: 'user_a', date: new Date('2026-05-04T00:00:00Z'), slot: 'morning' },
      { userId: 'user_a', date: new Date('2026-05-03T00:00:00Z'), slot: 'evening' },
    ]);
    enqueueCheckinReminderMock.mockResolvedValueOnce('notif_streak');

    // 18:30 UTC = 20:30 Paris = evening window.
    await runCheckinReminderScan(new Date('2026-05-06T18:30:00Z'));

    expect(enqueueCheckinReminderMock).toHaveBeenCalledWith('user_a', {
      slot: 'evening',
      date: '2026-05-06',
      streak: 3,
    });
  });

  // The widened fetch must be ONE query (no N+1 for the streak) — the whole point.
  it('keeps the streak-aware fetch to a single bulk round-trip (no N+1)', async () => {
    userFindManyMock.mockResolvedValueOnce([
      { id: 'user_a', timezone: 'Europe/Paris', weekendsOff: true },
      { id: 'user_b', timezone: 'Europe/Paris', weekendsOff: true },
    ]);
    dailyCheckinFindManyMock.mockResolvedValueOnce([]);
    enqueueCheckinReminderMock.mockResolvedValue('id');

    await runCheckinReminderScan(new Date('2026-05-06T18:30:00Z'));

    // One findMany feeds BOTH the `filled` gate and every member's streak.
    expect(dailyCheckinFindManyMock).toHaveBeenCalledTimes(1);
  });

  it('logs the canonical audit row at the end of every scan that ran', async () => {
    userFindManyMock.mockResolvedValueOnce([
      { id: 'user_a', timezone: 'Europe/Paris', weekendsOff: true },
    ]);
    dailyCheckinFindManyMock.mockResolvedValueOnce([]);
    enqueueCheckinReminderMock.mockResolvedValueOnce('id');

    await runCheckinReminderScan(new Date('2026-05-06T06:30:00Z'));

    expect(logAuditMock).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'cron.checkin_reminders.scan',
        metadata: expect.objectContaining({
          scannedUsers: 1,
          enqueuedMorning: 1,
          enqueuedEvening: 0,
          skipped: 0,
        }),
      }),
    );
  });

  // Tour 14 — the off-day pont: a member whose LOCAL today is off gets NO
  // reminder, counted as `skipped` (subset `offDaySkipped`), never `errors`.
  it('suppresses the reminder on a WEEKEND for a weekends-off member (skipped as off_day)', async () => {
    // 2026-05-09 = Saturday. 18:30 UTC = 20:30 Paris = evening window would fire,
    // but the member keeps weekends off → the reminder is suppressed.
    userFindManyMock.mockResolvedValueOnce([
      { id: 'user_a', timezone: 'Europe/Paris', weekendsOff: true },
    ]);
    dailyCheckinFindManyMock.mockResolvedValueOnce([]);

    const out = await runCheckinReminderScan(new Date('2026-05-09T18:30:00Z'));

    expect(enqueueCheckinReminderMock).not.toHaveBeenCalled();
    expect(out.skipped).toBe(1);
    expect(out.offDaySkipped).toBe(1);
    expect(out.errors).toBe(0);
    expect(logAuditMock).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: expect.objectContaining({ offDaySkipped: 1 }),
      }),
    );
  });

  it('still reminds on a weekend when the member trades weekends (weekendsOff=false)', async () => {
    // Same Saturday, but this member opted out of weekend-off → normal reminder.
    userFindManyMock.mockResolvedValueOnce([
      { id: 'trader', timezone: 'Europe/Paris', weekendsOff: false },
    ]);
    dailyCheckinFindManyMock.mockResolvedValueOnce([]);
    enqueueCheckinReminderMock.mockResolvedValueOnce('notif_sat');

    const out = await runCheckinReminderScan(new Date('2026-05-09T18:30:00Z'));

    expect(enqueueCheckinReminderMock).toHaveBeenCalledTimes(1);
    expect(out.enqueuedEvening).toBe(1);
    expect(out.offDaySkipped).toBe(0);
  });

  it('suppresses the reminder on an EXPLICITLY declared off day (a weekday)', async () => {
    // 2026-05-06 = Wednesday (a working day), but the member declared it off.
    userFindManyMock.mockResolvedValueOnce([
      { id: 'user_a', timezone: 'Europe/Paris', weekendsOff: true },
    ]);
    dailyCheckinFindManyMock.mockResolvedValueOnce([]);
    memberOffDayFindManyMock.mockResolvedValueOnce([
      { userId: 'user_a', date: new Date('2026-05-06T00:00:00Z') },
    ]);

    const out = await runCheckinReminderScan(new Date('2026-05-06T18:30:00Z'));

    expect(enqueueCheckinReminderMock).not.toHaveBeenCalled();
    expect(out.skipped).toBe(1);
    expect(out.offDaySkipped).toBe(1);
    expect(out.errors).toBe(0);
  });
});
