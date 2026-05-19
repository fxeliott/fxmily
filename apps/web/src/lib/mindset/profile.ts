import {
  getMindsetInstrument,
  MINDSET_LIKERT_MAX,
  MINDSET_LIKERT_MIN,
  type MindsetDimensionId,
} from '@/lib/mindset/instrument';

/**
 * V1.5 — pure mindset-profile aggregator (SPEC §27.3/§27.7 — THE risk piece).
 *
 * Maps a stored `responses` map → a 0–100 score per dimension + an overall,
 * recompute-safe and idempotent. PURE: no DB, no `Date.now()`, no I/O — the
 * profile is computed at RENDER and NEVER stored (SPEC §27.3).
 *
 * Honesty invariants (SPEC §27.4, canon §21.4/§23.4 — anti Black-Hat):
 *  - A dimension with zero valid answers scores `null` ("pas encore de
 *    données"), NEVER a fabricated 0. Likewise `overall`.
 *  - Forged / out-of-range / non-finite values (historical or tampered rows
 *    — this function is total) are IGNORED, never coerced to a boundary.
 *  - An unknown `instrumentVersion` ⇒ `null` (the instrument was never
 *    shipped; we refuse to invent a profile rather than guess).
 *
 * Longitudinal-validity invariant (SPEC §27.7): trends are compared
 * intra-`instrumentVersion` ONLY. `buildMindsetTrend` splits each dimension's
 * chronological series into contiguous same-version segments so a line/area
 * never connects two points across an instrument version change. A week with
 * no check is an honest GAP (no point), never extrapolated (SPEC §27.4).
 */

const LIKERT_SPAN = MINDSET_LIKERT_MAX - MINDSET_LIKERT_MIN; // 4

function roundTo(value: number, decimals: number): number {
  const f = 10 ** decimals;
  return Math.round(value * f) / f;
}

function isValidLikert(value: unknown): value is number {
  return (
    typeof value === 'number' &&
    Number.isInteger(value) &&
    value >= MINDSET_LIKERT_MIN &&
    value <= MINDSET_LIKERT_MAX
  );
}

export interface MindsetDimensionScore {
  readonly dimensionId: MindsetDimensionId;
  readonly label: string;
  /** 0–100, or `null` when no valid answer (honest — never a fake 0). */
  readonly score: number | null;
  readonly answeredItems: number;
  readonly totalItems: number;
}

export interface MindsetProfile {
  readonly version: number;
  readonly dimensions: readonly MindsetDimensionScore[];
  /** Mean of non-null dimension scores, or `null` if every dimension is null. */
  readonly overall: number | null;
}

export type MindsetResponses = Readonly<Record<string, number>>;

/**
 * Compute the profile for ONE check. Returns `null` iff `version` resolves to
 * no shipped instrument (refuse to fabricate — SPEC §27.4).
 */
export function computeMindsetProfile(
  version: number,
  responses: MindsetResponses,
): MindsetProfile | null {
  const instrument = getMindsetInstrument(version);
  if (!instrument) return null;

  const dimensions: MindsetDimensionScore[] = instrument.dimensions.map((dim) => {
    const items = instrument.items.filter((it) => it.dimensionId === dim.id);
    let sum = 0;
    let answered = 0;
    for (const item of items) {
      const value = responses[item.id];
      if (isValidLikert(value)) {
        sum += value;
        answered += 1;
      }
    }
    const score =
      answered === 0
        ? null
        : roundTo(((sum / answered - MINDSET_LIKERT_MIN) / LIKERT_SPAN) * 100, 1);
    return {
      dimensionId: dim.id,
      label: dim.label,
      score,
      answeredItems: answered,
      totalItems: items.length,
    };
  });

  const scored = dimensions.map((d) => d.score).filter((s): s is number => s !== null);
  const overall =
    scored.length === 0 ? null : roundTo(scored.reduce((a, b) => a + b, 0) / scored.length, 1);

  return { version, dimensions, overall };
}

export interface MindsetCheckRecord {
  readonly weekStart: string; // YYYY-MM-DD (Monday, Europe/Paris)
  readonly instrumentVersion: number;
  readonly responses: MindsetResponses;
}

export interface MindsetTrendPoint {
  readonly weekStart: string;
  readonly version: number;
  /** 0–100, or `null` for an answered check whose dimension had no valid item. */
  readonly score: number | null;
}

export interface MindsetDimensionTrend {
  readonly dimensionId: MindsetDimensionId;
  readonly label: string;
  /** Chronological (weekStart asc). One point per check that has this dim. */
  readonly points: readonly MindsetTrendPoint[];
  /**
   * `points` split into contiguous same-version runs (SPEC §27.7). A chart
   * renders one line per segment so it never bridges a version change.
   */
  readonly segments: readonly (readonly MindsetTrendPoint[])[];
}

/**
 * Split an already-chronological point list into maximal contiguous runs of
 * the SAME `version` (SPEC §27.7 longitudinal-validity guarantee). Pure and
 * registry-independent so the cross-version split is testable without a real
 * v2 shipped.
 */
export function splitByContiguousVersion(
  points: readonly MindsetTrendPoint[],
): readonly (readonly MindsetTrendPoint[])[] {
  const segments: MindsetTrendPoint[][] = [];
  for (const point of points) {
    const current = segments[segments.length - 1];
    if (current && current[current.length - 1]?.version === point.version) {
      current.push(point);
    } else {
      segments.push([point]);
    }
  }
  return segments;
}

/**
 * Build the per-dimension trend across many checks. Checks are sorted by
 * `weekStart` ascending (chronological). A check whose instrument version is
 * unknown contributes no point (refuse to fabricate). A dimension only gets a
 * point for a check whose instrument actually defines that dimension.
 */
export function buildMindsetTrend(checks: readonly MindsetCheckRecord[]): {
  readonly dimensions: readonly MindsetDimensionTrend[];
} {
  const sorted = [...checks].sort((a, b) => a.weekStart.localeCompare(b.weekStart));

  // Accumulate points per dimension id, preserving chronological order.
  const byDimension = new Map<MindsetDimensionId, { label: string; points: MindsetTrendPoint[] }>();

  for (const check of sorted) {
    const profile = computeMindsetProfile(check.instrumentVersion, check.responses);
    if (!profile) continue;
    for (const dim of profile.dimensions) {
      let entry = byDimension.get(dim.dimensionId);
      if (!entry) {
        entry = { label: dim.label, points: [] };
        byDimension.set(dim.dimensionId, entry);
      }
      entry.points.push({
        weekStart: check.weekStart,
        version: check.instrumentVersion,
        score: dim.score,
      });
    }
  }

  const dimensions: MindsetDimensionTrend[] = [];
  for (const [dimensionId, { label, points }] of byDimension) {
    dimensions.push({
      dimensionId,
      label,
      points,
      segments: splitByContiguousVersion(points),
    });
  }
  return { dimensions };
}
