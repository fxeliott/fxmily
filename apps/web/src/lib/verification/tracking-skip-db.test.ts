import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * S3 §32 généralisée — DB orchestration of the tracking-instrument skip scan
 * (`scanTrackingSkipsForAllMembers`). The PURE occurrence enumeration is covered
 * by `tracking/cadence.test.ts` (`listClosedOccurrences`); this file proves the
 * subtle DB branches that nothing else exercises deterministically — and that a
 * regression there would silently re-introduce an UNJUST accusation (exactly what
 * §33.6 forbids) or leak captured content into scoring (what §21.5 forbids):
 *   - SKIP        → a DUE, unfilled, closed occurrence → Discrepancy(tracking_skipped_no_reason)
 *   - FILLED      → an entry exists for that occurrence → NO gap
 *   - SNOOZED     → paused through the period end → NO gap (calm self-pacing, §2)
 *   - JOIN FLOOR  → occurrence whose period started before the member joined → not owed
 *   - DEDUP       → an already-materialised ref is never duplicated (idempotent)
 *   - ISOLATION   → the completion read selects metadata ONLY, never `responses`
 *   - per_trade   → no schedule sweep → never scanned
 *   - ERROR       → a DB failure is isolated to errors:1, never throws the cron
 *
 * Mock strategy mirrors `reconcile-db.test.ts`: `@/lib/db` + the instrument
 * registry are mocked so the branching logic is exercised without Postgres (the
 * real-DB path is proven end-to-end by the verification e2e chain).
 */

const m = vi.hoisted(() => ({
  userFindMany: vi.fn(),
  trackingEntryFindMany: vi.fn(),
  trackingScheduleFindMany: vi.fn(),
  discrepancyFindMany: vi.fn(),
  discrepancyCreateMany: vi.fn(),
  getCurrentInstruments: vi.fn(),
  reportError: vi.fn(),
}));

vi.mock('@/lib/db', () => ({
  db: {
    user: { findMany: m.userFindMany },
    trackingEntry: { findMany: m.trackingEntryFindMany },
    trackingSchedule: { findMany: m.trackingScheduleFindMany },
    discrepancy: { findMany: m.discrepancyFindMany, createMany: m.discrepancyCreateMany },
  },
}));
vi.mock('@/lib/auth/audit', () => ({ logAudit: vi.fn() }));
vi.mock('@/lib/observability', () => ({ reportError: m.reportError, reportWarning: vi.fn() }));
vi.mock('@/lib/tracking/registry', () => ({ getCurrentInstruments: m.getCurrentInstruments }));

import type { TrackingCadence, TrackingInstrument } from '@/lib/tracking/types';

import { scanTrackingSkipsForAllMembers, trackingSkipRef } from './constancy';

// Fixed clock: Thursday 2026-06-25 12:00 UTC (= 14:00 Paris), ISO week 26.
// With grace 7d / lookback 28d the only CLOSED weekly occurrences are W24 + W23
// (see tracking/cadence.test.ts) → the scan owes exactly those two per member.
const NOW = new Date('2026-06-25T12:00:00.000Z');
const W24 = '2026-W24';
const W23 = '2026-W23';

/** Minimal instrument fixture — the scan reads `.key`, `.cadence`, `.title` only. */
function inst(key: string, cadence: TrackingCadence, title = `Suivi ${key}`): TrackingInstrument {
  return {
    key,
    version: 'v1',
    axis: 'process',
    title,
    preamble: 'x',
    cadence,
    defaultCaptureContext: 'live',
    capturesConfidence: false,
    questions: [{ id: 'q1', kind: 'boolean', label: 'x' }],
  } as unknown as TrackingInstrument;
}

const WK = inst('wk', { kind: 'weekly', anchorDow: 1 }, 'Fidélité à ton cadre');

function member(over: Record<string, unknown> = {}) {
  return {
    id: 'mem1',
    joinedAt: new Date('2026-01-01T00:00:00.000Z'),
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    timezone: 'Europe/Paris',
    ...over,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  // Defaults: one long-standing member, one weekly instrument, nothing filled,
  // nothing snoozed, nothing already materialised. createMany echoes its count.
  m.getCurrentInstruments.mockReturnValue([WK]);
  m.userFindMany.mockResolvedValue([member()]);
  m.trackingEntryFindMany.mockResolvedValue([]);
  m.trackingScheduleFindMany.mockResolvedValue([]);
  m.discrepancyFindMany.mockResolvedValue([]);
  m.discrepancyCreateMany.mockImplementation(async (args: { data: unknown[] }) => ({
    count: args.data.length,
  }));
});

describe('scanTrackingSkipsForAllMembers — DUE + unfilled = a discipline gap (§32)', () => {
  it('materialises ONE skip per closed, unfilled occurrence (calm static reasoning, sev 1)', async () => {
    const res = await scanTrackingSkipsForAllMembers({ now: NOW });

    expect(m.discrepancyCreateMany).toHaveBeenCalledTimes(1);
    const created = m.discrepancyCreateMany.mock.calls[0]![0].data as Array<
      Record<string, unknown>
    >;
    expect(created.map((d) => d.trackingRef)).toEqual([
      trackingSkipRef('wk', W24),
      trackingSkipRef('wk', W23),
    ]);
    for (const row of created) {
      expect(row.type).toBe('tracking_skipped_no_reason');
      expect(row.severity).toBe(1);
      expect(row.detectedAt).toBe(NOW);
      expect(row.memberId).toBe('mem1');
      // §2-clean static French — references the instrument + occurrence, never a verdict.
      expect(row.claudeReasoning).toContain('Fidélité à ton cadre');
    }
    // Member-facing copy: a HUMAN period, never the raw ISO key `2026-W24`.
    expect(created[0]!.claudeReasoning).toContain('de la semaine du 8 au 14 juin 2026');
    expect(created[0]!.claudeReasoning).not.toContain(W24);
    expect(created[1]!.claudeReasoning).toContain('de la semaine du 1 au 7 juin 2026');
    expect(res).toEqual({
      membersScanned: 1,
      instrumentsScanned: 1,
      discrepanciesCreated: 2,
      errors: 0,
    });
  });

  it('FILLED occurrence → no skip (completion metadata excludes it)', async () => {
    m.trackingEntryFindMany.mockResolvedValue([
      { userId: 'mem1', instrumentKey: 'wk', occurrenceKey: W24 },
    ]);
    const res = await scanTrackingSkipsForAllMembers({ now: NOW });
    const created = m.discrepancyCreateMany.mock.calls[0]![0].data as Array<
      Record<string, unknown>
    >;
    expect(created.map((d) => d.trackingRef)).toEqual([trackingSkipRef('wk', W23)]);
    expect(res.discrepanciesCreated).toBe(1);
  });

  it('SNOOZED through the period end → never accused (§2/§33.6)', async () => {
    // Paused until after both periods end (W24 ends 06-15, W23 ends 06-08).
    m.trackingScheduleFindMany.mockResolvedValue([
      { userId: 'mem1', instrumentKey: 'wk', pausedUntil: new Date('2026-07-01T00:00:00.000Z') },
    ]);
    const res = await scanTrackingSkipsForAllMembers({ now: NOW });
    expect(m.discrepancyCreateMany).not.toHaveBeenCalled();
    expect(res.discrepanciesCreated).toBe(0);
  });

  it('SNOOZE that LAPSES before a period end still accuses that period (§2/§33.6 boundary)', async () => {
    // Paused until 06-12: it ran THROUGH W23's end (06-08) but lapsed BEFORE
    // W24's end (06-15). The pause only forgives the occurrence it fully covered.
    m.trackingScheduleFindMany.mockResolvedValue([
      { userId: 'mem1', instrumentKey: 'wk', pausedUntil: new Date('2026-06-12T00:00:00.000Z') },
    ]);
    const res = await scanTrackingSkipsForAllMembers({ now: NOW });
    const created = m.discrepancyCreateMany.mock.calls[0]![0].data as Array<
      Record<string, unknown>
    >;
    expect(created.map((d) => d.trackingRef)).toEqual([trackingSkipRef('wk', W24)]);
    expect(res.discrepanciesCreated).toBe(1);
  });

  it('SNOOZE exactly equal to a period end forgives it (>= boundary, inclusive)', async () => {
    // pausedUntil === W24 end (06-15) → W24 forgiven (the `>=` guard); W23 too.
    m.trackingScheduleFindMany.mockResolvedValue([
      { userId: 'mem1', instrumentKey: 'wk', pausedUntil: new Date('2026-06-15T00:00:00.000Z') },
    ]);
    const res = await scanTrackingSkipsForAllMembers({ now: NOW });
    expect(m.discrepancyCreateMany).not.toHaveBeenCalled();
    expect(res.discrepanciesCreated).toBe(0);
  });

  it('JOIN FLOOR → an occurrence whose period started before the member joined is not owed', async () => {
    // Joined 06-05: W23 starts 06-01 (before) → not owed; W24 starts 06-08 → owed.
    m.userFindMany.mockResolvedValue([
      member({
        joinedAt: new Date('2026-06-05T00:00:00.000Z'),
        createdAt: new Date('2026-06-05T00:00:00.000Z'),
      }),
    ]);
    const res = await scanTrackingSkipsForAllMembers({ now: NOW });
    const created = m.discrepancyCreateMany.mock.calls[0]![0].data as Array<
      Record<string, unknown>
    >;
    expect(created.map((d) => d.trackingRef)).toEqual([trackingSkipRef('wk', W24)]);
    expect(res.discrepanciesCreated).toBe(1);
  });

  it('falls back to createdAt when joinedAt is null', async () => {
    m.userFindMany.mockResolvedValue([
      member({ joinedAt: null, createdAt: new Date('2026-06-05T00:00:00.000Z') }),
    ]);
    const res = await scanTrackingSkipsForAllMembers({ now: NOW });
    const created = m.discrepancyCreateMany.mock.calls[0]![0].data as Array<
      Record<string, unknown>
    >;
    expect(created.map((d) => d.trackingRef)).toEqual([trackingSkipRef('wk', W24)]);
    expect(res.discrepanciesCreated).toBe(1);
  });

  it('JOIN FLOOR is day-floored in the member timezone (no sub-day frame mismatch)', async () => {
    // A member WEST of UTC who joined Sunday 06-07 22:00 LOCAL (= 06-08T02:00Z,
    // i.e. AFTER the W24 UTC-midnight pin 06-08T00:00Z). They were a member from
    // before the week of W24 began → they owe W24. A RAW-timestamp floor would
    // mis-bucket the join onto the wrong civil day and drop W24 entirely; the
    // local-date floor (mirror of `meetingJoinFloor`) owes it correctly. W23
    // (period started 06-01, before they joined) is rightly NOT owed.
    m.userFindMany.mockResolvedValue([
      member({
        timezone: 'America/New_York',
        joinedAt: new Date('2026-06-08T02:00:00.000Z'),
        createdAt: new Date('2026-06-08T02:00:00.000Z'),
      }),
    ]);
    const res = await scanTrackingSkipsForAllMembers({ now: NOW });
    const created = m.discrepancyCreateMany.mock.calls[0]![0].data as Array<
      Record<string, unknown>
    >;
    expect(created.map((d) => d.trackingRef)).toEqual([trackingSkipRef('wk', W24)]);
    expect(res.discrepanciesCreated).toBe(1);
  });

  it('IDEMPOTENT → an already-materialised ref is never re-created', async () => {
    m.discrepancyFindMany.mockResolvedValue([
      { memberId: 'mem1', trackingRef: trackingSkipRef('wk', W24) },
      { memberId: 'mem1', trackingRef: trackingSkipRef('wk', W23) },
    ]);
    const res = await scanTrackingSkipsForAllMembers({ now: NOW });
    expect(m.discrepancyCreateMany).not.toHaveBeenCalled();
    expect(res.discrepanciesCreated).toBe(0);
  });

  it('🚨 ISOLATION (§21.5) → the completion read selects metadata ONLY, never capture content', async () => {
    await scanTrackingSkipsForAllMembers({ now: NOW });
    expect(m.trackingEntryFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        select: { userId: true, instrumentKey: true, occurrenceKey: true },
      }),
    );
    // No `responses` / `confidenceLevel` may appear in any read this scan issues.
    const selects = JSON.stringify([
      m.trackingEntryFindMany.mock.calls,
      m.trackingScheduleFindMany.mock.calls,
      m.discrepancyFindMany.mock.calls,
    ]);
    expect(selects).not.toContain('responses');
    expect(selects).not.toContain('confidenceLevel');
  });

  it('per_trade / manual instruments are never schedule-swept (instrumentsScanned excludes them)', async () => {
    m.getCurrentInstruments.mockReturnValue([
      WK,
      inst('pt', { kind: 'per_trade' }),
      inst('mn', { kind: 'manual' }),
    ]);
    const res = await scanTrackingSkipsForAllMembers({ now: NOW });
    expect(res.instrumentsScanned).toBe(1); // only the weekly one
    const created = m.discrepancyCreateMany.mock.calls[0]![0].data as Array<
      Record<string, unknown>
    >;
    // No ref ever references the per_trade / manual keys.
    expect(created.every((d) => String(d.trackingRef).startsWith('wk@'))).toBe(true);
  });

  it('DAILY cadence is swept with its OWN 2-day grace and a daily period label', async () => {
    // A daily instrument under the same clock. `tracking/cadence.test.ts` proves
    // the most recent CLOSED daily occurrence is 2026-06-22 (period ends 06-23,
    // +2 j grace = 06-25T00:00Z ≤ NOW) — it would NOT be closed under the weekly
    // 7-day grace, so this locks that the daily branch + its shorter grace run.
    const DLY = inst('dly', { kind: 'daily' }, 'Routine du matin');
    m.getCurrentInstruments.mockReturnValue([DLY]);
    const res = await scanTrackingSkipsForAllMembers({ now: NOW });
    expect(res.instrumentsScanned).toBe(1);
    const created = m.discrepancyCreateMany.mock.calls[0]![0].data as Array<
      Record<string, unknown>
    >;
    const refs = created.map((d) => String(d.trackingRef));
    expect(refs).toContain(trackingSkipRef('dly', '2026-06-22'));
    // Every daily ref is `dly@YYYY-MM-DD`, never an ISO-week key.
    expect(refs.every((r) => /^dly@\d{4}-\d{2}-\d{2}$/.test(r))).toBe(true);
    const firstClosed = created.find(
      (d) => d.trackingRef === trackingSkipRef('dly', '2026-06-22'),
    )!;
    // Daily reasoning reads « du 22 juin 2026 », never the weekly « de la semaine ».
    expect(firstClosed.claudeReasoning).toContain('du 22 juin 2026');
    expect(firstClosed.claudeReasoning).not.toContain('de la semaine');
  });

  it('short-circuits with no recurring instruments at all', async () => {
    m.getCurrentInstruments.mockReturnValue([inst('pt', { kind: 'per_trade' })]);
    const res = await scanTrackingSkipsForAllMembers({ now: NOW });
    expect(res).toEqual({
      membersScanned: 0,
      instrumentsScanned: 0,
      discrepanciesCreated: 0,
      errors: 0,
    });
    expect(m.userFindMany).not.toHaveBeenCalled();
  });

  it('ERROR isolation → a DB failure becomes errors:1, never throws (cron stays up)', async () => {
    m.trackingEntryFindMany.mockRejectedValue(new Error('pg down'));
    const res = await scanTrackingSkipsForAllMembers({ now: NOW });
    expect(res.errors).toBe(1);
    expect(res.discrepanciesCreated).toBe(0);
    expect(m.reportError).toHaveBeenCalledWith(
      'verification.constancy.tracking',
      expect.any(Error),
      expect.any(Object),
    );
  });
});
