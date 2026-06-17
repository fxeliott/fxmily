/**
 * Pure aggregation helpers for the member-facing V1.5 process metrics:
 * setup quality (Steenbarger A/B/C grading) and risk-ceiling discipline
 * (Tharp ≤ 2 %). No I/O, no DB, no `server-only` — safe to import in vitest.
 *
 * Mirrors the logic already used for the AI reports (lib/weekly-report/builder)
 * but consumes the dashboard-data serialized shapes (riskPct as `string | null`
 * from a Prisma Decimal, tradeQuality as `'A'|'B'|'C'|null`).
 *
 * Posture §2: both measure the ACT (grading the setup / sizing the position),
 * never P&L or market direction.
 */

export interface SetupQualityDist {
  A: number;
  B: number;
  C: number;
  /** A + B + C — trades where the quality was captured. */
  captured: number;
}

export interface RiskDiscipline {
  /** Trades where riskPct > 2 % (Tharp ceiling breach). Strict `>`. */
  overTwoCount: number;
  /** Median riskPct across captured values ; null when none. */
  median: number | null;
  /** Total trades with a non-null, finite riskPct. */
  capturedCount: number;
}

export function aggregateSetupQuality(
  trades: ReadonlyArray<{ tradeQuality: 'A' | 'B' | 'C' | null }>,
): SetupQualityDist {
  let A = 0;
  let B = 0;
  let C = 0;
  for (const t of trades) {
    if (t.tradeQuality === 'A') A++;
    else if (t.tradeQuality === 'B') B++;
    else if (t.tradeQuality === 'C') C++;
  }
  return { A, B, C, captured: A + B + C };
}

export function aggregateRiskDiscipline(
  trades: ReadonlyArray<{ riskPct: string | null }>,
): RiskDiscipline {
  const values: number[] = [];
  for (const t of trades) {
    if (t.riskPct === null) continue;
    const v = Number(t.riskPct);
    if (Number.isFinite(v)) values.push(v);
  }
  return {
    overTwoCount: values.filter((v) => v > 2).length,
    median: median(values),
    capturedCount: values.length,
  };
}

/** Inline median — guarded for `noUncheckedIndexedAccess`. */
function median(xs: number[]): number | null {
  if (xs.length === 0) return null;
  const sorted = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) {
    const a = sorted[mid - 1];
    const b = sorted[mid];
    if (a === undefined || b === undefined) return null;
    return Math.round(((a + b) / 2) * 10000) / 10000;
  }
  const v = sorted[mid];
  return v === undefined ? null : Math.round(v * 10000) / 10000;
}
