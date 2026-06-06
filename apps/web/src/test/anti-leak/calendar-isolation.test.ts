import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { adaptiveCalendarOutputSchema } from '@/lib/schemas/adaptive-calendar';
import { buildCalendarSnapshot } from '@/lib/calendar/snapshot';

/**
 * §26 / §2 / §21.5 / §27.7 — BLOCKING isolation suite. Carbone of
 * `training-isolation.test.ts`.
 *
 * The calendar organises the member's TIME. It must NEVER read a P&L value
 * (`realizedR` / `outcome` / `plannedRR` / `resultR`) nor pull a real-edge
 * ANALYSIS module (scoring / analytics / trades service). The snapshot sent to
 * Claude is count-only by construction. This suite proves that with a static
 * source-code firewall over `lib/calendar/**` + the two calendar schema files,
 * plus a runtime check on the snapshot payload and the output schema.
 *
 * The two SANCTIONED cross-imports are explicitly bounded:
 *   - `lib/calendar/service.ts` may import ONLY `countRecentTrainingActivity`
 *     from `@/lib/training/...` (the count-only §21.5 primitive).
 *   - it may import ONLY `pseudonymizeMember` from `@/lib/weekly-report/...`
 *     (the shared pseudonymisation hash, like the §25 monthly-debrief loader).
 */

function readSrc(rel: string): string {
  return readFileSync(fileURLToPath(new URL(`../../${rel}`, import.meta.url)), 'utf8');
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

const CALENDAR_MODULES: string[] = [
  ...tsFilesIn('lib/calendar'),
  'lib/schemas/adaptive-calendar.ts',
  'lib/schemas/weekly-schedule-questionnaire.ts',
];

/** P&L field reads + real-edge analysis modules. NEVER in `lib/calendar/**`. */
const BREACH_TOKENS = [
  'realizedR',
  'resultR',
  'plannedRR',
  '@/lib/scoring',
  '@/lib/analytics',
  '@/lib/trades/service',
  '@/lib/trades/admin',
];

describe('§26 isolation — static source-code firewall', () => {
  it('the glob actually discovers the calendar tree', () => {
    expect(CALENDAR_MODULES).toContain('lib/calendar/instrument-v1.ts');
    expect(CALENDAR_MODULES).toContain('lib/calendar/snapshot.ts');
    expect(CALENDAR_MODULES).toContain('lib/calendar/service.ts');
    expect(CALENDAR_MODULES).toContain('lib/calendar/week.ts');
    // At least the 4 lib modules + 2 schema files.
    expect(CALENDAR_MODULES.length).toBeGreaterThanOrEqual(6);
  });

  it.each(CALENDAR_MODULES)('calendar module %s carries no P&L / analysis token', (rel) => {
    const code = readSrcCode(rel);
    for (const token of BREACH_TOKENS) {
      expect(code, `${rel} must not contain "${token}" in code (§26/§2 breach)`).not.toContain(
        token,
      );
    }
    // `outcome` only as a whole word (so `outcomeOfBacktest`-style false
    // positives don't matter); calendar code never references trade outcomes.
    expect(/\boutcome\b/.test(code), `${rel} must not reference trade outcome`).toBe(false);
  });

  it.each(CALENDAR_MODULES)(
    'calendar module %s reads real-edge trades COUNT-only (never a full-row find/aggregate)',
    (rel) => {
      const code = readSrcCode(rel);
      // Only `db.trade.count` is allowed. A `db.trade.findMany()` /
      // `findFirst()` / `aggregate()` WITHOUT an explicit count-only select
      // would return every column — incl. realizedR / outcome / plannedRR —
      // without ever spelling a BREACH_TOKEN in source. Pin the query SHAPE so
      // the firewall doesn't rely on the runtime layer alone (security MEDIUM-1).
      const nonCountTradeAccess = code.match(/\bdb\.trade\.(?!count\b)\w+/g) ?? [];
      expect(nonCountTradeAccess, `${rel} may only use db.trade.count`).toEqual([]);
      // Real trades are read ONLY as a count; the raw model is off-limits.
      expect(code, `${rel} must not touch db.trainingTrade directly`).not.toContain(
        'db.trainingTrade',
      );
    },
  );

  it('service.ts imports from @/lib/training ONLY the count-only primitive', () => {
    const raw = readSrc('lib/calendar/service.ts');
    const trainingImports = raw.match(/from\s+['"]@\/lib\/training[^'"]*['"]/g) ?? [];
    expect(trainingImports).toEqual(["from '@/lib/training/training-trade-service'"]);
    expect(raw).toContain(
      "import { countRecentTrainingActivity } from '@/lib/training/training-trade-service'",
    );
    // No other training symbol leaks in.
    for (const forbidden of [
      'listTrainingTradesForUser',
      'getTrainingTradeById',
      'createTrainingTrade',
      'db.trainingTrade',
    ]) {
      expect(readSrcCode('lib/calendar/service.ts')).not.toContain(forbidden);
    }
  });

  it('service.ts imports from @/lib/weekly-report ONLY pseudonymizeMember', () => {
    const raw = readSrc('lib/calendar/service.ts');
    const wrImports = raw.match(/from\s+['"]@\/lib\/weekly-report[^'"]*['"]/g) ?? [];
    expect(wrImports).toEqual(["from '@/lib/weekly-report/builder'"]);
    expect(raw).toContain("import { pseudonymizeMember } from '@/lib/weekly-report/builder'");
    expect(readSrcCode('lib/calendar/service.ts')).not.toContain('buildWeeklySnapshot');
  });
});

describe('§26 isolation — runtime payload + schema', () => {
  it('the Claude snapshot exposes ONLY count-only activity keys', () => {
    const snap = buildCalendarSnapshot({
      pseudonymLabel: 'member-AAAA1111',
      weekStart: '2026-06-08',
      instrumentVersion: 1,
      profileSummary: null,
      responses: {
        profile: 'salarie',
        sessionGoal: 3,
        weekdayAvailability: {
          monday: { morning: true, afternoon: false, evening: false },
          tuesday: { morning: false, afternoon: false, evening: false },
          wednesday: { morning: false, afternoon: false, evening: false },
          thursday: { morning: false, afternoon: false, evening: false },
          friday: { morning: false, afternoon: false, evening: false },
        },
        weekendAvailability: {
          saturday: { morning: false, afternoon: false, evening: false },
          sunday: { morning: false, afternoon: false, evening: false },
        },
        sleep: 'standard',
        energyPeak: 'morning',
        meetingCommitment: 'none',
        practiceFocus: 'balanced',
        constraint: 'none',
      },
      activity: {
        tradesLast30d: 5,
        checkinsLast14d: 3,
        trainingSessionsLast14d: 2,
        lastMindsetCheckDate: null,
      },
    });
    expect(Object.keys(snap.activity).sort()).toEqual(
      [
        'checkinsLast14d',
        'lastMindsetCheckDate',
        'tradesLast30d',
        'trainingSessionsLast14d',
      ].sort(),
    );
  });

  it('adaptiveCalendarOutputSchema.strict() rejects an injected realizedR key', () => {
    const valid = {
      weekStart: '2026-06-08',
      overview: 'x'.repeat(120),
      days: Array.from({ length: 7 }, (_v, i) => ({
        date: `2026-06-${String(8 + i).padStart(2, '0')}`,
        dayLabel: `Jour ${i + 1}`,
        blocks: [
          { slot: 'morning', category: 'rest', durationMin: 30, label: 'Repos', priority: 'low' },
        ],
      })),
      weeklyFocus: 'y'.repeat(80),
      warnings: [],
    };
    expect(adaptiveCalendarOutputSchema.safeParse(valid).success).toBe(true);
    expect(adaptiveCalendarOutputSchema.safeParse({ ...valid, realizedR: 2.5 }).success).toBe(
      false,
    );
  });
});
