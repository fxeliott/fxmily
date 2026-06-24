import { describe, expect, it } from 'vitest';

import type { TrackingAxisId } from './axes';
import { computeCoverage } from './coverage';

const NOW = new Date('2026-06-24T12:00:00.000Z');

function mapOf(entries: [TrackingAxisId, Date | null][]): Map<TrackingAxisId, Date | null> {
  return new Map(entries);
}

describe('computeCoverage', () => {
  it('reports 0% when nothing is captured', () => {
    const cov = computeCoverage(new Map(), NOW);
    expect(cov.totalCount).toBe(11);
    expect(cov.coveredCount).toBe(0);
    expect(cov.pct).toBe(0);
    expect(cov.axes).toHaveLength(11);
    expect(cov.axes.every((a) => !a.covered && a.lastCapturedAt === null)).toBe(true);
  });

  it('reports 100% when every axis is fresh', () => {
    const recent = new Date('2026-06-23T12:00:00.000Z');
    const all = mapOf(
      (
        [
          'execution',
          'risk_discipline',
          'market_analysis',
          'training',
          'formation',
          'meeting_presence',
          'emotions_confidence',
          'sleep_lifestyle',
          'evening_review',
          'self_work',
          'routine',
        ] as TrackingAxisId[]
      ).map((a) => [a, recent]),
    );
    const cov = computeCoverage(all, NOW);
    expect(cov.coveredCount).toBe(11);
    expect(cov.pct).toBe(100);
  });

  it('counts only FRESH captures (stale beyond the window is not covered)', () => {
    const fresh = new Date('2026-06-20T12:00:00.000Z'); // 4 days ago → covered
    const stale = new Date('2026-04-01T12:00:00.000Z'); // ~84 days ago → not covered
    const cov = computeCoverage(
      mapOf([
        ['execution', fresh],
        ['training', stale],
      ]),
      NOW,
    );
    expect(cov.axes.find((a) => a.axis === 'execution')?.covered).toBe(true);
    expect(cov.axes.find((a) => a.axis === 'training')?.covered).toBe(false);
    expect(cov.axes.find((a) => a.axis === 'training')?.lastCapturedAt).toBeNull();
    expect(cov.coveredCount).toBe(1);
  });

  it('respects a custom freshness window', () => {
    const sevenDaysAgo = new Date('2026-06-17T12:00:00.000Z');
    expect(computeCoverage(mapOf([['routine', sevenDaysAgo]]), NOW, 30).coveredCount).toBe(1);
    expect(computeCoverage(mapOf([['routine', sevenDaysAgo]]), NOW, 3).coveredCount).toBe(0);
  });

  it('rounds the percentage to an integer', () => {
    // 1 / 11 = 9.09% → 9
    const cov = computeCoverage(mapOf([['self_work', NOW]]), NOW);
    expect(cov.pct).toBe(9);
  });
});
