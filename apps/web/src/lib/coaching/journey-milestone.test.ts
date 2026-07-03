import { describe, expect, it } from 'vitest';

import {
  FIRST_MONTH_DAYS,
  getTodayJourneyMilestone,
  TRADE_JOURNAL_MILESTONES,
  type JourneyMilestoneInput,
} from './journey-milestone';

/**
 * Tour 11 — process milestone decision table. Pure module: each case pins the
 * SELECTED milestone (kind + value) and the one-day-only gate, never the prose.
 */

const TZ = 'Europe/Paris';

function input(overrides: Partial<JourneyMilestoneInput> = {}): JourneyMilestoneInput {
  return {
    totalTrades: 3,
    createdAt: null,
    timezone: TZ,
    now: new Date('2026-07-03T10:00:00Z'),
    ...overrides,
  };
}

describe('getTodayJourneyMilestone — journaled trades', () => {
  it('fires on an EXACT anchor count (10/25/50/100)', () => {
    for (const anchor of TRADE_JOURNAL_MILESTONES) {
      const m = getTodayJourneyMilestone(input({ totalTrades: anchor }));
      expect(m?.kind).toBe('trades');
      expect(m?.value).toBe(anchor);
      expect(m?.title).toContain(String(anchor));
    }
  });

  it('returns null between anchors (one-day-only, count pile)', () => {
    expect(getTodayJourneyMilestone(input({ totalTrades: 9 }))).toBeNull();
    expect(getTodayJourneyMilestone(input({ totalTrades: 11 }))).toBeNull();
    expect(getTodayJourneyMilestone(input({ totalTrades: 26 }))).toBeNull();
    expect(getTodayJourneyMilestone(input({ totalTrades: 0 }))).toBeNull();
  });

  it('trade milestone copy is process-over-outcome, not a market call', () => {
    const m = getTodayJourneyMilestone(input({ totalTrades: 25 }));
    expect(m?.body.toLowerCase()).toMatch(/trace|nombre/);
  });
});

describe('getTodayJourneyMilestone — first month', () => {
  it('fires exactly on the J+30 anniversary calendar day', () => {
    // created 2026-06-03 (Paris) → +30 days = 2026-07-03.
    const m = getTodayJourneyMilestone(
      input({
        totalTrades: 3,
        createdAt: '2026-06-03T09:00:00Z',
        now: new Date('2026-07-03T10:00:00Z'),
      }),
    );
    expect(m?.kind).toBe('first-month');
    expect(m?.value).toBe(FIRST_MONTH_DAYS);
  });

  it('returns null one day before and one day after the anniversary', () => {
    const before = getTodayJourneyMilestone(
      input({ createdAt: '2026-06-03T09:00:00Z', now: new Date('2026-07-02T10:00:00Z') }),
    );
    const after = getTodayJourneyMilestone(
      input({ createdAt: '2026-06-03T09:00:00Z', now: new Date('2026-07-04T10:00:00Z') }),
    );
    expect(before).toBeNull();
    expect(after).toBeNull();
  });

  it('returns null when there is no createdAt', () => {
    expect(getTodayJourneyMilestone(input({ createdAt: null }))).toBeNull();
  });

  it('returns null on garbage createdAt (never fabricates)', () => {
    expect(getTodayJourneyMilestone(input({ createdAt: 'not-a-date' }))).toBeNull();
  });
});

describe('getTodayJourneyMilestone — priority + hygiene', () => {
  it('trade milestone takes priority over a coincident anniversary', () => {
    const m = getTodayJourneyMilestone(
      input({
        totalTrades: 10,
        createdAt: '2026-06-03T09:00:00Z',
        now: new Date('2026-07-03T10:00:00Z'),
      }),
    );
    expect(m?.kind).toBe('trades');
  });

  it('never emits an em-dash in any milestone copy', () => {
    const cases = [
      getTodayJourneyMilestone(input({ totalTrades: 10 })),
      getTodayJourneyMilestone(input({ totalTrades: 100 })),
      getTodayJourneyMilestone(
        input({ createdAt: '2026-06-03T09:00:00Z', now: new Date('2026-07-03T10:00:00Z') }),
      ),
    ];
    for (const m of cases) {
      const text = `${m?.eyebrow ?? ''} ${m?.title ?? ''} ${m?.body ?? ''}`;
      expect(text).not.toContain('—');
    }
  });
});
