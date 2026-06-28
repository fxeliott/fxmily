import { afterEach, describe, expect, it, vi } from 'vitest';

// Mock the db singleton BEFORE importing the SUT (Prisma client init lazy
// otherwise yells about adapter / connection at unit-test time).
const findFirstMock = vi.fn();
const createMock = vi.fn();

vi.mock('@/lib/db', () => ({
  db: {
    notificationQueue: {
      findFirst: findFirstMock,
      create: createMock,
    },
  },
}));

vi.mock('@/lib/auth/audit', () => ({
  logAudit: vi.fn(async () => undefined),
}));

const {
  enqueueCheckinReminder,
  enqueueDouglasDeliveryNotification,
  enqueueMindsetCheckNotification,
  enqueueGentleVerificationReminder,
} = await import('./enqueue');

afterEach(() => {
  findFirstMock.mockReset();
  createMock.mockReset();
});

/**
 * Race-safe enqueue (J5 audit BLOCKER B1 fix).
 *
 * The new flow trusts the DB unique partial index (created in migration
 * 20260507100000_j5_notification_dedup) for idempotency. The helper must:
 *   1. Try `create` directly (no pre-scan).
 *   2. On Prisma `P2002` unique-violation, look up the existing row and
 *      return its id — so concurrent callers converge on the same row.
 *   3. On any other DB error, log + return null (best-effort).
 */
describe('enqueueCheckinReminder', () => {
  it('inserts a fresh row and returns its id', async () => {
    createMock.mockResolvedValueOnce({ id: 'notif_new_1' });

    const id = await enqueueCheckinReminder('user_1', { slot: 'morning', date: '2026-05-07' });

    expect(id).toBe('notif_new_1');
    expect(createMock).toHaveBeenCalledTimes(1);
    expect(createMock.mock.calls[0]?.[0]?.data).toMatchObject({
      userId: 'user_1',
      type: 'checkin_morning_reminder',
      payload: { slot: 'morning', date: '2026-05-07' },
    });
  });

  it('maps the morning/evening slot to the right NotificationType', async () => {
    createMock.mockResolvedValue({ id: 'x' });

    await enqueueCheckinReminder('u', { slot: 'evening', date: '2026-05-07' });

    expect(createMock.mock.calls[0]?.[0]?.data?.type).toBe('checkin_evening_reminder');
  });

  it('returns the existing row id when create races into a P2002 unique-violation', async () => {
    // First, P2002 unique-violation from the partial index.
    createMock.mockRejectedValueOnce(
      Object.assign(new Error('unique violation'), { code: 'P2002' }),
    );
    // Then findFirst returns the row that won the race.
    findFirstMock.mockResolvedValueOnce({
      id: 'notif_existing',
      payload: { slot: 'morning', date: '2026-05-07' },
    });

    const id = await enqueueCheckinReminder('user_1', { slot: 'morning', date: '2026-05-07' });

    expect(id).toBe('notif_existing');
    expect(findFirstMock).toHaveBeenCalledTimes(1);
  });

  it('returns null when P2002 fires but the existing row is for a different date (defensive)', async () => {
    createMock.mockRejectedValueOnce(
      Object.assign(new Error('unique violation'), { code: 'P2002' }),
    );
    findFirstMock.mockResolvedValueOnce({
      id: 'notif_other_date',
      payload: { slot: 'morning', date: '2026-05-06' },
    });

    const id = await enqueueCheckinReminder('user_1', { slot: 'morning', date: '2026-05-07' });

    expect(id).toBeNull();
  });

  it('returns null on any non-P2002 DB error (best-effort)', async () => {
    createMock.mockRejectedValueOnce(Object.assign(new Error('boom'), { code: 'P9999' }));

    const id = await enqueueCheckinReminder('user_1', { slot: 'morning', date: '2026-05-07' });

    expect(id).toBeNull();
    expect(findFirstMock).not.toHaveBeenCalled();
  });

  it('returns null on a thrown non-Prisma error', async () => {
    createMock.mockRejectedValueOnce(new Error('connection lost'));

    const id = await enqueueCheckinReminder('user_1', { slot: 'evening', date: '2026-05-07' });

    expect(id).toBeNull();
  });
});

/**
 * RC#4 — DB-level dedup folds. Both weekly-nudge kinds now sit behind a partial
 * unique index (20260629100000_rc4_notification_dedup_mindset_gentle); a
 * concurrent / re-fired scan that races the create must converge on the
 * existing pending row, never surface a false failure.
 */
describe('enqueueMindsetCheckNotification — P2002 dedup fold', () => {
  it('inserts a fresh nudge and returns its id', async () => {
    createMock.mockResolvedValueOnce({ id: 'mindset_new' });

    const id = await enqueueMindsetCheckNotification('user_1', { weekStart: '2026-06-29' });

    expect(id).toBe('mindset_new');
    expect(createMock.mock.calls[0]?.[0]?.data).toMatchObject({
      userId: 'user_1',
      type: 'mindset_check_ready',
      payload: { weekStart: '2026-06-29' },
    });
  });

  it('folds a P2002 race into the existing pending row id (no false failure)', async () => {
    createMock.mockRejectedValueOnce(
      Object.assign(new Error('unique violation'), { code: 'P2002' }),
    );
    findFirstMock.mockResolvedValueOnce({ id: 'mindset_winner' });

    const id = await enqueueMindsetCheckNotification('user_1', { weekStart: '2026-06-29' });

    expect(id).toBe('mindset_winner');
    expect(findFirstMock).toHaveBeenCalledWith({
      where: { userId: 'user_1', type: 'mindset_check_ready', status: 'pending' },
      select: { id: true },
    });
  });

  it('returns null on a genuine (non-P2002) failure, without a re-read', async () => {
    createMock.mockRejectedValueOnce(Object.assign(new Error('boom'), { code: 'P9999' }));

    const id = await enqueueMindsetCheckNotification('user_1', { weekStart: '2026-06-29' });

    expect(id).toBeNull();
    expect(findFirstMock).not.toHaveBeenCalled();
  });
});

describe('enqueueGentleVerificationReminder — P2002 dedup fold', () => {
  it('inserts a fresh gentle reminder and returns its id', async () => {
    createMock.mockResolvedValueOnce({ id: 'gentle_new' });

    const id = await enqueueGentleVerificationReminder('member_1', { discrepancyId: 'd1' });

    expect(id).toBe('gentle_new');
    expect(createMock.mock.calls[0]?.[0]?.data).toMatchObject({
      userId: 'member_1',
      type: 'verification_gentle_reminder',
      payload: { discrepancyId: 'd1' },
    });
  });

  it('folds a P2002 race into the existing pending row id', async () => {
    createMock.mockRejectedValueOnce(
      Object.assign(new Error('unique violation'), { code: 'P2002' }),
    );
    findFirstMock.mockResolvedValueOnce({ id: 'gentle_winner' });

    const id = await enqueueGentleVerificationReminder('member_1', { discrepancyId: 'd1' });

    expect(id).toBe('gentle_winner');
    expect(findFirstMock).toHaveBeenCalledWith({
      where: { userId: 'member_1', type: 'verification_gentle_reminder', status: 'pending' },
      select: { id: true },
    });
  });

  it('returns null on a genuine (non-P2002) failure, without a re-read', async () => {
    createMock.mockRejectedValueOnce(new Error('connection lost'));

    const id = await enqueueGentleVerificationReminder('member_1', { discrepancyId: 'd1' });

    expect(id).toBeNull();
    expect(findFirstMock).not.toHaveBeenCalled();
  });
});

/**
 * Session 3 §28 — drift alert emission (completes the J9 reception chain).
 */
describe('enqueueDouglasDeliveryNotification', () => {
  it('enqueues a douglas_card_delivered row and returns its id', async () => {
    createMock.mockResolvedValueOnce({ id: 'notif_douglas_1' });

    const id = await enqueueDouglasDeliveryNotification('user_1', {
      deliveryId: 'del_1',
      cardSlug: 'sortir-du-tilt',
    });

    expect(id).toBe('notif_douglas_1');
    expect(createMock).toHaveBeenCalledTimes(1);
    expect(createMock.mock.calls[0]?.[0]?.data).toMatchObject({
      userId: 'user_1',
      type: 'douglas_card_delivered',
      payload: { deliveryId: 'del_1', cardSlug: 'sortir-du-tilt' },
    });
  });

  it('returns null on a DB error (best-effort — never throws, never rolls back the delivery)', async () => {
    createMock.mockRejectedValueOnce(new Error('queue down'));

    const id = await enqueueDouglasDeliveryNotification('user_1', {
      deliveryId: 'del_2',
      cardSlug: 'anything',
    });

    expect(id).toBeNull();
  });
});
