import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * SCOPE 4 admin visibility (J3 "classement pour tous") — `getMemberOffDayAdminSummary`
 * must expose a member's forward-window off-day DECLARATIONS to the admin, and
 * recompute the over-cap flag from the LIVE rows with the EXACT boundary the
 * declaration layer enforces (`windowCount > MAX_FREE_OFF_DAYS_PER_WINDOW`), so
 * an admin can spot the atypical (past-cap, reason-required) declarations that
 * curb leaderboard gaming. Read-only, fail-open on a DB hiccup.
 *
 * Mock convention: only the two collaborators that touch the outside world are
 * mocked — `db.memberOffDay.findMany` (the rows) and `reportWarning` (the
 * fail-open telemetry). The pure helpers `formatOffDayLabel` (fr-FR label) and
 * `localDateOf`/`parseLocalDate`/`shiftLocalDate` (TZ math) run for REAL — the
 * test proves the service wires the real formatter (not a raw ISO passthrough)
 * and the real forward window (`[today, today+30]` in the member TZ).
 */

const m = vi.hoisted(() => ({
  findMany: vi.fn(),
  reportWarning: vi.fn(),
}));

vi.mock('@/lib/db', () => ({
  db: {
    memberOffDay: {
      findMany: m.findMany,
    },
  },
}));

vi.mock('@/lib/observability', () => ({
  reportWarning: m.reportWarning,
}));

import { getMemberOffDayAdminSummary } from './off-days-admin';
import { MAX_FREE_OFF_DAYS_PER_WINDOW, OFF_DAY_FORWARD_HORIZON_DAYS } from '@/lib/schemas/off-day';

/** A stored `MemberOffDay` row shape (only the two selected columns). */
function offDayRow(dateIso: string, reason: string | null = null) {
  return { date: new Date(`${dateIso}T00:00:00.000Z`), reason };
}

/** N off-day rows on consecutive UTC days from a fixed start (for cap tests). */
function offDayRows(count: number, reason: string | null = null) {
  const rows: { date: Date; reason: string | null }[] = [];
  for (let i = 0; i < count; i += 1) {
    const d = new Date(Date.UTC(2026, 6, 7 + i)); // 2026-07-07 + i days
    rows.push({ date: d, reason });
  }
  return rows;
}

beforeEach(() => {
  m.findMany.mockReset();
  m.reportWarning.mockReset();
});

describe('getMemberOffDayAdminSummary', () => {
  it('exposes the cap and horizon constants (single source of truth)', async () => {
    m.findMany.mockResolvedValue([]);

    const summary = await getMemberOffDayAdminSummary('user-1', 'Europe/Paris');

    expect(summary.cap).toBe(MAX_FREE_OFF_DAYS_PER_WINDOW);
    expect(summary.horizonDays).toBe(OFF_DAY_FORWARD_HORIZON_DAYS);
  });

  it('queries the member-scoped forward window [today, today+30] with parsed Date bounds', async () => {
    m.findMany.mockResolvedValue([]);

    await getMemberOffDayAdminSummary('user-42', 'Europe/Paris');

    expect(m.findMany).toHaveBeenCalledTimes(1);
    const arg = m.findMany.mock.calls[0]?.[0];
    expect(arg?.where?.userId).toBe('user-42');
    expect(arg?.where?.date?.gte).toBeInstanceOf(Date);
    expect(arg?.where?.date?.lte).toBeInstanceOf(Date);
    // Upper bound is exactly OFF_DAY_FORWARD_HORIZON_DAYS civil days after the
    // lower bound (proves the real `shiftLocalDate` window, not a hard-coded span).
    const spanDays = Math.round(
      (arg.where.date.lte.getTime() - arg.where.date.gte.getTime()) / 86_400_000,
    );
    expect(spanDays).toBe(OFF_DAY_FORWARD_HORIZON_DAYS);
    // Chronological order so the admin reads the declarations as a timeline.
    expect(arg?.orderBy).toEqual({ date: 'asc' });
  });

  it('maps rows to {date, label, reason} with the real fr-FR label (not a raw ISO)', async () => {
    m.findMany.mockResolvedValue([
      offDayRow('2026-07-07', 'Congés annuels'),
      offDayRow('2026-07-08', null),
    ]);

    const summary = await getMemberOffDayAdminSummary('user-1', 'Europe/Paris');

    expect(summary.windowCount).toBe(2);
    expect(summary.upcoming).toEqual([
      { date: '2026-07-07', label: 'mardi 7 juillet', reason: 'Congés annuels' },
      { date: '2026-07-08', label: 'mercredi 8 juillet', reason: null },
    ]);
  });

  it('is NOT over cap when the member is exactly AT the free cap', async () => {
    m.findMany.mockResolvedValue(offDayRows(MAX_FREE_OFF_DAYS_PER_WINDOW));

    const summary = await getMemberOffDayAdminSummary('user-1', 'Europe/Paris');

    expect(summary.windowCount).toBe(MAX_FREE_OFF_DAYS_PER_WINDOW);
    expect(summary.overCap).toBe(false);
  });

  it('flags over cap when the member declares MORE than the free cap', async () => {
    m.findMany.mockResolvedValue(offDayRows(MAX_FREE_OFF_DAYS_PER_WINDOW + 1));

    const summary = await getMemberOffDayAdminSummary('user-1', 'Europe/Paris');

    expect(summary.windowCount).toBe(MAX_FREE_OFF_DAYS_PER_WINDOW + 1);
    expect(summary.overCap).toBe(true);
  });

  it('returns an empty, not-over-cap summary when no off days are declared', async () => {
    m.findMany.mockResolvedValue([]);

    const summary = await getMemberOffDayAdminSummary('user-1', 'Europe/Paris');

    expect(summary.windowCount).toBe(0);
    expect(summary.overCap).toBe(false);
    expect(summary.upcoming).toEqual([]);
    expect(m.reportWarning).not.toHaveBeenCalled();
  });

  it('fails open (empty summary + telemetry) when the DB read throws', async () => {
    m.findMany.mockRejectedValue(Object.assign(new Error('pool timeout'), { code: 'P2024' }));

    const summary = await getMemberOffDayAdminSummary('user-1', 'Europe/Paris');

    expect(summary).toEqual({
      cap: MAX_FREE_OFF_DAYS_PER_WINDOW,
      horizonDays: OFF_DAY_FORWARD_HORIZON_DAYS,
      windowCount: 0,
      overCap: false,
      upcoming: [],
    });
    expect(m.reportWarning).toHaveBeenCalledWith('admin.off_day.summary', 'load_degraded', {
      code: 'P2024',
    });
  });

  it('records an "unknown" code when the thrown error has no string code', async () => {
    m.findMany.mockRejectedValue(new Error('boom'));

    const summary = await getMemberOffDayAdminSummary('user-1', 'Europe/Paris');

    expect(summary.windowCount).toBe(0);
    expect(m.reportWarning).toHaveBeenCalledWith('admin.off_day.summary', 'load_degraded', {
      code: 'unknown',
    });
  });
});
