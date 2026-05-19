import { describe, expect, it } from 'vitest';

import { MINDSET_INSTRUMENT_V1, type MindsetDimensionId } from './instrument';
import {
  buildMindsetTrend,
  computeMindsetProfile,
  splitByContiguousVersion,
  type MindsetCheckRecord,
  type MindsetTrendPoint,
} from './profile';

/**
 * SPEC §27.3/§27.7 — pure profile aggregator (THE risk piece). TDD:
 * normalization 1→0/3→50/5→100, per-dimension independence, honest `null`
 * (never a fake 0, §27.4), defensive against forged/out-of-range rows,
 * idempotent/pure, and the intra-version segmentation guarantee (§27.7).
 */

const V1_ITEMS = MINDSET_INSTRUMENT_V1.items;
const V1_VERSION = MINDSET_INSTRUMENT_V1.version;

function answersAll(value: number): Record<string, number> {
  const r: Record<string, number> = {};
  for (const it of V1_ITEMS) r[it.id] = value;
  return r;
}

/** Build a responses map where every item of a dimension gets `byDim[dim]`. */
function answersByDim(byDim: Partial<Record<MindsetDimensionId, number>>): Record<string, number> {
  const r: Record<string, number> = {};
  for (const it of V1_ITEMS) {
    const v = byDim[it.dimensionId];
    if (v !== undefined) r[it.id] = v;
  }
  return r;
}

describe('computeMindsetProfile — normalization (Likert 1..5 → 0..100)', () => {
  it('all 5 → every dimension 100, overall 100', () => {
    const p = computeMindsetProfile(V1_VERSION, answersAll(5));
    expect(p).not.toBeNull();
    for (const d of p!.dimensions) expect(d.score).toBe(100);
    expect(p!.overall).toBe(100);
  });

  it('all 1 → every dimension 0, overall 0 (a real 0, not the honest null)', () => {
    const p = computeMindsetProfile(V1_VERSION, answersAll(1));
    for (const d of p!.dimensions) {
      expect(d.score).toBe(0);
      expect(d.answeredItems).toBe(d.totalItems);
    }
    expect(p!.overall).toBe(0);
  });

  it('all 3 → midpoint 50', () => {
    const p = computeMindsetProfile(V1_VERSION, answersAll(3));
    for (const d of p!.dimensions) expect(d.score).toBe(50);
    expect(p!.overall).toBe(50);
  });

  it('within-dimension mean: items {5,1} → mean 3 → 50', () => {
    const dim = V1_ITEMS[0]!.dimensionId;
    const items = V1_ITEMS.filter((i) => i.dimensionId === dim);
    expect(items.length).toBe(2);
    const responses: Record<string, number> = {
      [items[0]!.id]: 5,
      [items[1]!.id]: 1,
    };
    const p = computeMindsetProfile(V1_VERSION, responses);
    const score = p!.dimensions.find((d) => d.dimensionId === dim)!.score;
    expect(score).toBe(50);
  });

  it('rounds to 1 decimal (mean 4/3 of {2,1} would be ...; use {4,5} → mean 4.5 → 87.5)', () => {
    const dim = V1_ITEMS[0]!.dimensionId;
    const items = V1_ITEMS.filter((i) => i.dimensionId === dim);
    const p = computeMindsetProfile(V1_VERSION, {
      [items[0]!.id]: 4,
      [items[1]!.id]: 5,
    });
    // mean 4.5 → (4.5-1)/4*100 = 87.5
    expect(p!.dimensions.find((d) => d.dimensionId === dim)!.score).toBe(87.5);
  });
});

describe('computeMindsetProfile — honesty invariants (§27.4 anti Black-Hat)', () => {
  it('unknown instrument version → null (refuse to fabricate)', () => {
    expect(computeMindsetProfile(999, answersAll(5))).toBeNull();
  });

  it('empty responses → every dimension score null, overall null (NEVER a fake 0)', () => {
    const p = computeMindsetProfile(V1_VERSION, {});
    expect(p).not.toBeNull();
    for (const d of p!.dimensions) {
      expect(d.score).toBeNull();
      expect(d.answeredItems).toBe(0);
      expect(d.totalItems).toBe(2);
    }
    expect(p!.overall).toBeNull();
  });

  it('one dimension answered, the rest not → that dim scored, others null, overall = the one', () => {
    const dim = V1_ITEMS[0]!.dimensionId;
    const p = computeMindsetProfile(V1_VERSION, answersByDim({ [dim]: 5 }));
    const scored = p!.dimensions.filter((d) => d.score !== null);
    expect(scored).toHaveLength(1);
    expect(scored[0]!.dimensionId).toBe(dim);
    expect(scored[0]!.score).toBe(100);
    expect(p!.overall).toBe(100);
  });

  it('partial dimension (1 of 2 items) → mean over answered only, answeredItems 1', () => {
    const dim = V1_ITEMS[0]!.dimensionId;
    const items = V1_ITEMS.filter((i) => i.dimensionId === dim);
    const p = computeMindsetProfile(V1_VERSION, { [items[0]!.id]: 5 });
    const d = p!.dimensions.find((x) => x.dimensionId === dim)!;
    expect(d.answeredItems).toBe(1);
    expect(d.score).toBe(100);
  });
});

describe('computeMindsetProfile — defensive (forged / tampered rows are total)', () => {
  it('out-of-range / non-integer / non-number values are IGNORED (never coerced to a boundary)', () => {
    const dim = V1_ITEMS[0]!.dimensionId;
    const items = V1_ITEMS.filter((i) => i.dimensionId === dim);
    // item[0] forged in many ways across runs; item[1] = valid 4.
    for (const forged of [0, 6, -3, 3.5, Number.NaN, Infinity]) {
      const responses: Record<string, number> = {
        [items[0]!.id]: forged,
        [items[1]!.id]: 4,
      };
      const d = computeMindsetProfile(V1_VERSION, responses)!.dimensions.find(
        (x) => x.dimensionId === dim,
      )!;
      // only the valid 4 counts → mean 4 → 75, answered 1 (forged ignored).
      expect(d.answeredItems).toBe(1);
      expect(d.score).toBe(75);
    }
  });

  it('a dimension whose only answers are all invalid → score null (not 0)', () => {
    const dim = V1_ITEMS[0]!.dimensionId;
    const items = V1_ITEMS.filter((i) => i.dimensionId === dim);
    const d = computeMindsetProfile(V1_VERSION, {
      [items[0]!.id]: 0,
      [items[1]!.id]: 99,
    })!.dimensions.find((x) => x.dimensionId === dim)!;
    expect(d.answeredItems).toBe(0);
    expect(d.score).toBeNull();
  });

  it('is pure: same input → deep-equal output, and the input is not mutated', () => {
    const input = answersAll(4);
    const snapshot = JSON.stringify(input);
    const a = computeMindsetProfile(V1_VERSION, input);
    const b = computeMindsetProfile(V1_VERSION, input);
    expect(a).toEqual(b);
    expect(JSON.stringify(input)).toBe(snapshot);
  });
});

describe('splitByContiguousVersion (§27.7 intra-version guarantee)', () => {
  const pt = (weekStart: string, version: number): MindsetTrendPoint => ({
    weekStart,
    version,
    score: 50,
  });

  it('empty → []', () => {
    expect(splitByContiguousVersion([])).toEqual([]);
  });

  it('single version run → one segment', () => {
    const pts = [pt('2026-05-04', 1), pt('2026-05-11', 1), pt('2026-05-18', 1)];
    const seg = splitByContiguousVersion(pts);
    expect(seg).toHaveLength(1);
    expect(seg[0]).toHaveLength(3);
  });

  it('version change splits — v1,v1,v2,v1 → [[v1,v1],[v2],[v1]] (never bridges versions)', () => {
    const pts = [
      pt('2026-05-04', 1),
      pt('2026-05-11', 1),
      pt('2026-05-18', 2),
      pt('2026-05-25', 1),
    ];
    const seg = splitByContiguousVersion(pts);
    expect(seg.map((s) => s.map((p) => p.version))).toEqual([[1, 1], [2], [1]]);
  });
});

describe('buildMindsetTrend', () => {
  const responsesV1 = answersAll(4);

  it('sorts checks chronologically (unsorted input → ascending points)', () => {
    const checks: MindsetCheckRecord[] = [
      { weekStart: '2026-05-18', instrumentVersion: 1, responses: responsesV1 },
      { weekStart: '2026-05-04', instrumentVersion: 1, responses: responsesV1 },
      { weekStart: '2026-05-11', instrumentVersion: 1, responses: responsesV1 },
    ];
    const trend = buildMindsetTrend(checks);
    for (const dim of trend.dimensions) {
      expect(dim.points.map((p) => p.weekStart)).toEqual([
        '2026-05-04',
        '2026-05-11',
        '2026-05-18',
      ]);
    }
  });

  it('a missing week is an honest GAP (no point), never extrapolated (§27.4)', () => {
    const checks: MindsetCheckRecord[] = [
      { weekStart: '2026-05-04', instrumentVersion: 1, responses: responsesV1 },
      // 2026-05-11 skipped on purpose
      { weekStart: '2026-05-18', instrumentVersion: 1, responses: responsesV1 },
    ];
    const trend = buildMindsetTrend(checks);
    for (const dim of trend.dimensions) {
      expect(dim.points).toHaveLength(2);
      expect(dim.points.map((p) => p.weekStart)).toEqual(['2026-05-04', '2026-05-18']);
    }
  });

  it('a check with an unknown instrument version contributes no point', () => {
    const checks: MindsetCheckRecord[] = [
      { weekStart: '2026-05-04', instrumentVersion: 1, responses: responsesV1 },
      { weekStart: '2026-05-11', instrumentVersion: 999, responses: responsesV1 },
    ];
    const trend = buildMindsetTrend(checks);
    for (const dim of trend.dimensions) {
      expect(dim.points).toHaveLength(1);
      expect(dim.points[0]!.weekStart).toBe('2026-05-04');
    }
  });

  it('an answered check whose dimension has no valid item yields a point with score null (≠ a missing week)', () => {
    const checks: MindsetCheckRecord[] = [
      { weekStart: '2026-05-04', instrumentVersion: 1, responses: {} },
    ];
    const trend = buildMindsetTrend(checks);
    for (const dim of trend.dimensions) {
      expect(dim.points).toHaveLength(1);
      expect(dim.points[0]!.score).toBeNull();
    }
  });

  it('single-version cohort → exactly one segment per dimension', () => {
    const checks: MindsetCheckRecord[] = [
      { weekStart: '2026-05-04', instrumentVersion: 1, responses: responsesV1 },
      { weekStart: '2026-05-11', instrumentVersion: 1, responses: responsesV1 },
    ];
    const trend = buildMindsetTrend(checks);
    for (const dim of trend.dimensions) {
      expect(dim.segments).toHaveLength(1);
      expect(dim.segments[0]).toHaveLength(2);
    }
  });
});
