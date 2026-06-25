import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { PROCESS_FIDELITY_V1 } from '@/lib/tracking/instruments/process-fidelity-v1';
import { buildResponsesSchema } from '@/lib/tracking/schema';

/**
 * SPEC §21.5 / §27.7 (BLOQUANT) — statistical-isolation suite for the V2 S2
 * universal tracking engine. This is the test PROMISED verbatim by
 * `prisma/schema.prisma` (TrackingEntry / TrackingSchedule block:
 * "Enforced by `test/anti-leak/tracking-isolation.test.ts`"). Sibling of
 * `calendar-isolation.test.ts` + `training-isolation.test.ts`.
 *
 * Invariant under test (3 angles):
 *   1. SCHEMA — `TrackingEntry` / `TrackingSchedule` carry NO FK to `Trade` /
 *      `BehavioralScore` / `PreTradeCheck`. Only the `userId` cascade exists.
 *   2. SOURCE — the `lib/tracking/**` modules name no P&L column
 *      (`realizedR` / `resultR` / `plannedRR` / `outcome`), import no real-edge
 *      analysis module (scoring / analytics / trades / habit), and never read
 *      `db.trade` / `db.behavioralScore`. The D1 gauge reads OTHER surfaces
 *      (pre-trade / mindset / training / meetings / check-ins) but ONLY as a
 *      `_max` of a timestamp (count/recency), never a row/P&L.
 *   3. RUNTIME — the captured `responses` are a CLOSED Zod shape: a smuggled
 *      P&L key (`realizedR` / `outcome`) is rejected, so no raw edge can leak
 *      into a tracking row.
 */

/** Resolve repo source relative to THIS test file (cwd-independent). */
function readSrc(rel: string): string {
  return readFileSync(fileURLToPath(new URL(`../../${rel}`, import.meta.url)), 'utf8');
}

/** apps/web-relative read (for the Prisma schema, a sibling of `src/`). */
function readRepo(rel: string): string {
  return readFileSync(fileURLToPath(new URL(`../../../${rel}`, import.meta.url)), 'utf8');
}

/** Strip comments before scanning — defensive comments mention the tokens. */
function readSrcCode(rel: string): string {
  return readSrc(rel)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}

function tsFilesIn(relDir: string): string[] {
  const abs = fileURLToPath(new URL(`../../${relDir}`, import.meta.url));
  return readdirSync(abs)
    .filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts') && !f.endsWith('.spec.ts'))
    .map((f) => `${relDir}/${f}`);
}

const TRACKING_MODULES: string[] = [
  ...tsFilesIn('lib/tracking'),
  ...tsFilesIn('lib/tracking/instruments'),
];

// =============================================================================
// Block A — Prisma schema FK firewall (the literal `Enforced by` claim)
// =============================================================================

describe('§21.5 — tracking models carry NO FK to the real edge', () => {
  const schema = readRepo('prisma/schema.prisma');

  function modelBlock(name: string): string {
    const start = schema.indexOf(`model ${name} {`);
    expect(start, `model ${name} must exist in schema.prisma`).toBeGreaterThan(-1);
    const end = schema.indexOf('\n}', start);
    expect(end).toBeGreaterThan(start);
    return schema.slice(start, end);
  }

  it.each(['TrackingEntry', 'TrackingSchedule'])(
    '%s has the userId cascade as its ONLY relation — no Trade/BehavioralScore/PreTradeCheck FK',
    (model) => {
      const block = modelBlock(model);
      // The ONLY relation is the user cascade.
      expect(block).toContain('user   User   @relation');
      expect(block).toContain('onDelete: Cascade');
      const relations = block.match(/@relation\b/g) ?? [];
      expect(relations, `${model} must declare exactly one @relation (user)`).toHaveLength(1);
      // No real-edge model is referenced as a field type (a FK would name it).
      for (const forbidden of ['Trade', 'BehavioralScore', 'PreTradeCheck']) {
        expect(block, `${model} must not reference ${forbidden} (§21.5 breach)`).not.toContain(
          forbidden,
        );
      }
    },
  );
});

// =============================================================================
// Block B — static source firewall over lib/tracking/**
// =============================================================================

/** P&L reads + real-edge analysis surfaces — NEVER in `lib/tracking/**`. */
const BREACH_TOKENS = [
  'realizedR',
  'resultR',
  'plannedRR',
  '@/lib/scoring',
  '@/lib/analytics',
  '@/lib/trades',
  '@/lib/habit',
  'db.trade.',
  'db.behavioralScore',
];

describe('§21.5 — static source firewall', () => {
  it('the glob actually discovers the tracking tree (no silent empty set)', () => {
    expect(TRACKING_MODULES).toContain('lib/tracking/service.ts');
    expect(TRACKING_MODULES).toContain('lib/tracking/schema.ts');
    expect(TRACKING_MODULES).toContain('lib/tracking/coverage.ts');
    expect(TRACKING_MODULES).toContain('lib/tracking/cadence.ts');
    expect(TRACKING_MODULES).toContain('lib/tracking/instruments/process-fidelity-v1.ts');
    expect(TRACKING_MODULES.length).toBeGreaterThanOrEqual(7);
  });

  it.each(TRACKING_MODULES)('tracking module %s names no P&L / real-edge analysis token', (rel) => {
    const code = readSrcCode(rel);
    for (const token of BREACH_TOKENS) {
      expect(code, `${rel} must not contain "${token}" in code (§21.5 breach)`).not.toContain(
        token,
      );
    }
    // `outcome` only as a whole word: tracking code never reads a trade outcome.
    expect(/\boutcome\b/.test(code), `${rel} must not reference trade outcome`).toBe(false);
  });
});

// =============================================================================
// Block C — the D1 gauge reads foreign surfaces COUNT/RECENCY-only
// =============================================================================

describe('§21.5 — getTrackingCoverage reads existing surfaces as _max timestamps only', () => {
  it('every foreign-surface read in the coverage body is a _max aggregate, never a row/P&L', () => {
    const full = readSrcCode('lib/tracking/service.ts');
    const start = full.indexOf('export async function getTrackingCoverage');
    expect(start).toBeGreaterThan(-1);
    // The function body up to the next top-level export.
    const after = full.indexOf('\nexport ', start + 1);
    const body = full.slice(start, after === -1 ? undefined : after);

    // It DOES read other surfaces (pre-trade / mindset / training / meetings /
    // check-ins) — but each strictly through a `_max` of a timestamp.
    expect(body).toContain('_max');
    expect(body).toContain('db.preTradeCheck.aggregate(');
    // It must never widen to a full-row read of a foreign surface or a P&L col.
    expect(body).not.toContain('findMany');
    expect(body).not.toContain('db.trade.');
    expect(body).not.toContain('db.behavioralScore');
    for (const pnl of ['realizedR', 'resultR', 'plannedRR']) {
      expect(body, `coverage must not read "${pnl}"`).not.toContain(pnl);
    }
  });
});

// =============================================================================
// Block D — runtime: the captured `responses` are a CLOSED shape (no P&L)
// =============================================================================

describe('§2/§21.5 — the responses schema rejects any smuggled P&L key', () => {
  const schema = buildResponsesSchema(PROCESS_FIDELITY_V1);
  // A fully valid capture for the shipped instrument (mirror schema.test.ts).
  const valid = {
    cut_20h: true,
    one_risk_trade_per_day: true,
    one_stop_per_day: false,
    stop_set_before_entry: true,
    risk_size_respected: true,
    prep_done_before_session: true,
    patience_anti_fomo: 4,
    no_revenge_after_loss: 3,
  };

  it('accepts the valid capture but rejects an injected realizedR / outcome key', () => {
    expect(schema.safeParse(valid).success).toBe(true);
    expect(schema.safeParse({ ...valid, realizedR: 2.5 }).success).toBe(false);
    expect(schema.safeParse({ ...valid, outcome: 'win' }).success).toBe(false);
  });
});
