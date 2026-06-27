import { describe, expect, it } from 'vitest';

import {
  computeFieldCompletionRate,
  computeTrainingRegularity,
  FIELD_COMPLETION_FIELDS,
  REGULARITY_WINDOW_DAYS,
} from './training-stats';

/**
 * S8 RE-CHALLENGE — pure §269 aggregators. No DB, no clock: `now` is injected so
 * the streak/window boundaries are deterministic (mirror `lib/checkin/streak`).
 *
 * The critical invariants under test:
 *   - §23.7 — civil-day membership is Europe/Paris, NOT UTC (a 00:30 Paris
 *     backtest belongs to its Paris day). Asserted via a nocturnal entry.
 *   - §269(e) — current streak ends today OR (grace) yesterday, and breaks once
 *     both are empty; longest is the longest historical run.
 *   - §269(d) — completeness counts PRESENCE, never the VALUE (a `false`/`loss`
 *     is a completed field), and is `null` (not 0) on an empty history.
 */

const at = (iso: string) => new Date(iso);

describe('computeTrainingRegularity — empty + window', () => {
  it('returns all-zero for no backtests', () => {
    expect(computeTrainingRegularity([], at('2026-06-15T12:00:00.000Z'))).toEqual({
      activeDays30: 0,
      currentDayStreak: 0,
      longestDayStreak: 0,
    });
  });

  it('counts distinct active days only within the rolling 30-day window', () => {
    const now = at('2026-06-15T12:00:00.000Z'); // Paris 2026-06-15
    const r = computeTrainingRegularity(
      [
        at('2026-06-15T08:00:00.000Z'), // today
        at('2026-06-15T09:00:00.000Z'), // same civil day → not double-counted
        at('2026-05-17T08:00:00.000Z'), // exactly 29 days before → in window
        at('2026-05-16T08:00:00.000Z'), // 30 days before → OUT of window
      ],
      now,
    );
    expect(r.activeDays30).toBe(2);
  });

  it('exposes a 30-day window constant (documents the metric)', () => {
    expect(REGULARITY_WINDOW_DAYS).toBe(30);
  });
});

describe('computeTrainingRegularity — Europe/Paris civil-day attribution (§23.7)', () => {
  it('attributes a 01:30 Paris (23:30Z previous day) backtest to its PARIS day, not UTC', () => {
    // 2026-06-14T23:30Z = 2026-06-15 01:30 in Paris (UTC+2 in June).
    const nocturnal = at('2026-06-14T23:30:00.000Z');
    // now = 2026-06-16 → today is empty; the streak survives ONLY if the entry
    // is attributed to 2026-06-15 (yesterday, grace). A UTC attribution to
    // 2026-06-14 would make yesterday empty → streak 0.
    const r = computeTrainingRegularity([nocturnal], at('2026-06-16T12:00:00.000Z'));
    expect(r.currentDayStreak).toBe(1);
    expect(r.longestDayStreak).toBe(1);
  });
});

describe('computeTrainingRegularity — current streak (§269e)', () => {
  it('counts consecutive days ending TODAY when practised today', () => {
    const now = at('2026-06-15T12:00:00.000Z');
    const r = computeTrainingRegularity(
      [
        at('2026-06-15T08:00:00.000Z'),
        at('2026-06-14T08:00:00.000Z'),
        at('2026-06-13T08:00:00.000Z'),
      ],
      now,
    );
    expect(r.currentDayStreak).toBe(3);
    expect(r.longestDayStreak).toBe(3);
  });

  it('GRACE — keeps yesterday-ending streak when today not yet practised', () => {
    const now = at('2026-06-15T12:00:00.000Z'); // today empty
    const r = computeTrainingRegularity(
      [at('2026-06-14T08:00:00.000Z'), at('2026-06-13T08:00:00.000Z')],
      now,
    );
    expect(r.currentDayStreak).toBe(2);
  });

  it('breaks the current streak once BOTH today and yesterday are empty', () => {
    const now = at('2026-06-15T12:00:00.000Z');
    const r = computeTrainingRegularity(
      [at('2026-06-13T08:00:00.000Z'), at('2026-06-12T08:00:00.000Z')],
      now,
    );
    expect(r.currentDayStreak).toBe(0);
    // ...but the historical run is still surfaced as the longest.
    expect(r.longestDayStreak).toBe(2);
  });

  it('longest > current — a past 3-day run survives a later gap + single today', () => {
    const now = at('2026-06-20T12:00:00.000Z');
    const r = computeTrainingRegularity(
      [
        // past 3-day run
        at('2026-06-01T08:00:00.000Z'),
        at('2026-06-02T08:00:00.000Z'),
        at('2026-06-03T08:00:00.000Z'),
        // gap, then only today
        at('2026-06-20T08:00:00.000Z'),
      ],
      now,
    );
    expect(r.currentDayStreak).toBe(1);
    expect(r.longestDayStreak).toBe(3);
  });
});

describe('computeFieldCompletionRate — PRESENCE, not value (§269d)', () => {
  it('returns null (not 0) when there are no backtests', () => {
    expect(computeFieldCompletionRate([])).toBeNull();
  });

  it('declares the seven optional journal fields', () => {
    expect(FIELD_COMPLETION_FIELDS).toHaveLength(7);
  });

  it('counts a falsy-but-PRESENT value (false / loss / negative R) as completed', () => {
    // 3 present (outcome/resultR/systemRespected), 4 null → 3/7.
    const rate = computeFieldCompletionRate([
      {
        outcome: 'loss',
        resultR: -1,
        systemRespected: false,
        planFollowed: null,
        riskDefinedBefore: null,
        emotionalStateNoted: null,
        noImpulsiveDeviation: null,
      },
    ]);
    expect(rate).toBeCloseTo(3 / 7, 10);
  });

  it('is 1 when every field is present and 0 when every field is null', () => {
    const full = {
      outcome: 'win',
      resultR: 2,
      systemRespected: true,
      planFollowed: true,
      riskDefinedBefore: true,
      emotionalStateNoted: true,
      noImpulsiveDeviation: true,
    };
    const empty = {
      outcome: null,
      resultR: null,
      systemRespected: null,
      planFollowed: null,
      riskDefinedBefore: null,
      emotionalStateNoted: null,
      noImpulsiveDeviation: null,
    };
    expect(computeFieldCompletionRate([full])).toBe(1);
    expect(computeFieldCompletionRate([empty])).toBe(0);
    // mean of a full + empty row = 0.5
    expect(computeFieldCompletionRate([full, empty])).toBe(0.5);
  });
});
