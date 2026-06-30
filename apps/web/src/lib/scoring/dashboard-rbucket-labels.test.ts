import { describe, expect, it } from 'vitest';

import { bucketRMultiples } from './dashboard-data';

/**
 * 2026-06-30 A-Z re-challenge — the R-multiple distribution buckets are clipped
 * at 0.5R width with the top rim at `edges[14] = 3.5R`. The top label was '+3R+',
 * which reads as "[3R, +inf)" but actually covers [3.5R, +inf) — a +3.2R trade
 * lands in the '+3R' bucket below it, so '+3R+' mislabelled the rim. It is now
 * '+3.5R+'. These assertions lock label↔edge alignment so the rim can never
 * silently drift again. (The classifier was already correct — only the label.)
 */
const t = (r: number) => ({ realizedR: String(r), realizedRSource: 'computed' as const });

describe('bucketRMultiples — label ↔ edge alignment', () => {
  it('produces 15 buckets and labels the top rim by its real lower bound (3.5R)', () => {
    const buckets = bucketRMultiples([]);
    expect(buckets).toHaveLength(15);
    const top = buckets[buckets.length - 1]!;
    expect(top.from).toBe(3.5);
    expect(top.to).toBe(Infinity);
    expect(top.label).toBe('+3.5R+');
  });

  it('every positive finite-lower-bound bucket label carries its own `from` value', () => {
    for (const b of bucketRMultiples([])) {
      if (Number.isFinite(b.from) && b.from > 0) {
        expect(b.label).toContain(String(b.from));
      }
    }
  });

  it('a +3.2R trade lands in the +3R bucket, a +3.6R trade in the +3.5R+ rim', () => {
    const buckets = bucketRMultiples([t(3.2), t(3.6)]);
    const byLabel = (l: string) => buckets.find((b) => b.label === l)!;
    expect(byLabel('+3R').count).toBe(1); // [3, 3.5)
    expect(byLabel('+3.5R+').count).toBe(1); // [3.5, +inf)
  });

  it('the rim catches every outlier from 3.5R up', () => {
    const buckets = bucketRMultiples([t(3.5), t(4), t(10)]);
    expect(buckets.find((b) => b.label === '+3.5R+')!.count).toBe(3);
  });
});
