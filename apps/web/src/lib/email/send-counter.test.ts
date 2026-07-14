import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * J2 — daily send counter unit tests (item 9 : "compteur concurrence").
 *
 * `reserveDailySend` is the atomic reservation primitive: an `INSERT ... ON
 * CONFLICT DO UPDATE ... WHERE count < CAP RETURNING count`. Under concurrency,
 * Postgres serialises the row; the reservation that would exceed the cap gets an
 * EMPTY `RETURNING` set (the WHERE fails), which the code maps to `capped: true`.
 * We drive that contract by controlling the mocked `db.$queryRaw` result rows.
 */

const { queryRawMock, findUniqueMock } = vi.hoisted(() => ({
  queryRawMock: vi.fn(),
  findUniqueMock: vi.fn(),
}));

vi.mock('@/lib/db', () => ({
  db: {
    $queryRaw: queryRawMock,
    emailSendCounter: { findUnique: findUniqueMock },
  },
}));

import {
  RESEND_DAILY_CAP,
  currentParisSendDay,
  getDailySendCount,
  reserveDailySend,
} from './send-counter';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('reserveDailySend', () => {
  it('grants a reservation when the row returns a count below the cap', async () => {
    queryRawMock.mockResolvedValue([{ count: 5 }]);

    const result = await reserveDailySend();

    expect(result).toEqual({ ok: true, count: 5, capped: false });
  });

  it('refuses the reservation when RETURNING is empty (cap reached, WHERE failed)', async () => {
    // The atomic UPDATE ... WHERE count < CAP matched no row → empty result set.
    queryRawMock.mockResolvedValue([]);

    const result = await reserveDailySend();

    expect(result).toEqual({ ok: false, count: RESEND_DAILY_CAP, capped: true });
  });

  it('coerces the DB count (bigint-like) to a JS number', async () => {
    queryRawMock.mockResolvedValue([{ count: 42n }]);

    const result = await reserveDailySend();

    expect(result).toEqual({ ok: true, count: 42, capped: false });
  });

  it('grants exactly at the last slot (count === CAP after increment)', async () => {
    queryRawMock.mockResolvedValue([{ count: RESEND_DAILY_CAP }]);

    const result = await reserveDailySend();

    expect(result).toEqual({ ok: true, count: RESEND_DAILY_CAP, capped: false });
  });
});

describe('getDailySendCount', () => {
  it('returns the stored count when a counter row exists', async () => {
    findUniqueMock.mockResolvedValue({ count: 12 });

    await expect(getDailySendCount()).resolves.toBe(12);
  });

  it('returns 0 when no counter row exists yet', async () => {
    findUniqueMock.mockResolvedValue(null);

    await expect(getDailySendCount()).resolves.toBe(0);
  });
});

describe('currentParisSendDay', () => {
  it('formats the Paris civil day as YYYY-MM-DD', () => {
    // 2026-07-13 10:00 UTC = 12:00 Europe/Paris (CEST) → same calendar day.
    // allow-absolute-date deterministic Paris tz-conversion fixture (not clock-relative)
    expect(currentParisSendDay(new Date('2026-07-13T10:00:00Z'))).toBe('2026-07-13');
  });

  it('rolls to the next Paris day for a late-UTC instant past Paris midnight', () => {
    // 2026-07-13 23:30 UTC = 2026-07-14 01:30 Europe/Paris → next civil day.
    // allow-absolute-date deterministic Paris tz-conversion fixture (not clock-relative)
    expect(currentParisSendDay(new Date('2026-07-13T23:30:00Z'))).toBe('2026-07-14');
  });
});
