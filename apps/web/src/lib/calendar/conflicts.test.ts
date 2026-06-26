import { describe, expect, it } from 'vitest';

import type {
  AdaptiveCalendarOutput,
  CalendarBlock,
  CalendarBlockCategoryValue,
} from '@/lib/schemas/adaptive-calendar';
import type { CalendarSlotValue } from '@/lib/calendar/instrument-v1';
import type { WeeklyScheduleResponses } from '@/lib/schemas/weekly-schedule-questionnaire';

import { detectCalendarConflicts, mergeWarnings } from './conflicts';

// =============================================================================
// Factories — default to ALL slots available + no meeting commitment, so each
// rule is isolated: a test only triggers a conflict by explicitly setting a
// slot unavailable / stacking a day / committing to meetings.
// =============================================================================

const on = { morning: true, afternoon: true, evening: true };
const off = { morning: false, afternoon: false, evening: false };

function responses(overrides: Partial<WeeklyScheduleResponses> = {}): WeeklyScheduleResponses {
  return {
    profile: 'salarie',
    sessionGoal: 3,
    weekdayAvailability: { monday: on, tuesday: on, wednesday: on, thursday: on, friday: on },
    weekendAvailability: { saturday: on, sunday: on },
    sleep: 'standard',
    energyPeak: 'morning',
    meetingCommitment: 'none',
    practiceFocus: 'balanced',
    constraint: 'none',
    ...overrides,
  };
}

function block(
  slot: CalendarSlotValue,
  category: CalendarBlockCategoryValue,
  durationMin = 60,
): CalendarBlock {
  return { slot, category, durationMin, label: `${category} ${slot}`, priority: 'medium' };
}

/** Build a 7-day plan from a per-day block list (index 0 = Monday … 6 = Sunday). */
function output(daysBlocks: CalendarBlock[][], warnings: string[] = []): AdaptiveCalendarOutput {
  const days = Array.from({ length: 7 }, (_, i) => ({
    date: `2026-06-0${8 + i}`, // 2026-06-08 is a Monday; cosmetic here (rules use the index)
    dayLabel: `Jour ${i + 1}`,
    blocks: daysBlocks[i] ?? [],
  }));
  return {
    weekStart: '2026-06-08',
    overview: 'Une semaine calme et régulière pour avancer sur ta pratique sans te surcharger.',
    days,
    weeklyFocus: 'Garder un rythme tenable et régulier toute la semaine.',
    warnings,
  };
}

/** Market-advice lexicon — no conflict message may ever contain these (§2). */
const MARKET_TOKENS = [
  'achète',
  'achete',
  'vends',
  'vendre',
  'acheter',
  'support',
  'résistance',
  'resistance',
  'haussier',
  'baissier',
  'cible',
  'objectif de prix',
  'niveau',
  'long ',
  'short ',
];

describe('detectCalendarConflicts — pure deterministic conflicts (§32-1)', () => {
  describe('Rule 1 — demanding block on a declared-unavailable slot', () => {
    it('fires when a live session lands on an unavailable slot (single day)', () => {
      const r = responses({
        weekdayAvailability: { monday: off, tuesday: on, wednesday: on, thursday: on, friday: on },
      });
      const plan = output([[block('morning', 'live_trading')]]); // Monday morning, but Mon is off
      const msgs = detectCalendarConflicts(r, plan);
      expect(msgs.some((m) => m.includes('indisponible'))).toBe(true);
      expect(msgs.some((m) => m.toLowerCase().includes('lundi'))).toBe(true);
    });

    it('is silent when the same block lands on an available slot', () => {
      const r = responses(); // all available
      const plan = output([[block('morning', 'live_trading')]]);
      expect(detectCalendarConflicts(r, plan)).toEqual([]);
    });

    it('does NOT flag rest/free blocks on an unavailable slot', () => {
      const r = responses({
        weekdayAvailability: { monday: off, tuesday: on, wednesday: on, thursday: on, friday: on },
      });
      const plan = output([[block('morning', 'rest'), block('afternoon', 'free')]]);
      expect(detectCalendarConflicts(r, plan)).toEqual([]);
    });

    it('aggregates multiple unavailable days into ONE message', () => {
      const r = responses({
        weekdayAvailability: {
          monday: off,
          tuesday: off,
          wednesday: off,
          thursday: on,
          friday: on,
        },
      });
      const plan = output([
        [block('morning', 'live_trading')],
        [block('afternoon', 'backtest')],
        [block('evening', 'mark_douglas_review')],
      ]);
      const msgs = detectCalendarConflicts(r, plan);
      const unavailableMsgs = msgs.filter((m) => m.includes('indisponible'));
      expect(unavailableMsgs).toHaveLength(1);
    });
  });

  describe('Rule 2 — overloaded day', () => {
    it('fires when a day stacks ≥6 demanding blocks', () => {
      const heavy = Array.from({ length: 6 }, () => block('morning', 'backtest', 30));
      const plan = output([heavy]);
      const msgs = detectCalendarConflicts(responses(), plan);
      expect(msgs.some((m) => m.toLowerCase().includes('chargée'))).toBe(true);
    });

    it('fires when a day stacks ≥8h of demanding practice', () => {
      const plan = output([
        [
          block('morning', 'backtest', 120),
          block('afternoon', 'live_trading', 120),
          block('evening', 'backtest', 120),
          block('evening', 'mark_douglas_review', 120),
        ],
      ]);
      const msgs = detectCalendarConflicts(responses(), plan);
      expect(msgs.some((m) => m.toLowerCase().includes('chargée'))).toBe(true);
    });

    it('is silent for a reasonable day (rest/free do not count toward load)', () => {
      const plan = output([
        [
          block('morning', 'live_trading', 90),
          block('afternoon', 'rest', 120),
          block('evening', 'free', 120),
        ],
      ]);
      expect(detectCalendarConflicts(responses(), plan)).toEqual([]);
    });
  });

  describe('Rule 3 — meeting commitment with no meeting block', () => {
    it('fires for a "regular" commitment when the plan reserves no meeting block', () => {
      const r = responses({ meetingCommitment: 'regular' });
      const plan = output([[block('morning', 'live_trading')]]);
      const msgs = detectCalendarConflicts(r, plan);
      expect(msgs.some((m) => m.toLowerCase().includes('réunion'))).toBe(true);
    });

    it('is silent for "regular" when a meeting block IS reserved', () => {
      const r = responses({ meetingCommitment: 'regular' });
      const plan = output([[block('afternoon', 'meeting')]]);
      expect(detectCalendarConflicts(r, plan)).toEqual([]);
    });

    it('is silent for an "occasional" commitment without a meeting block', () => {
      const r = responses({ meetingCommitment: 'occasional' });
      const plan = output([[block('morning', 'live_trading')]]);
      expect(detectCalendarConflicts(r, plan)).toEqual([]);
    });
  });

  describe('global invariants', () => {
    it('returns [] for a fully coherent plan (happy path)', () => {
      const plan = output([
        [block('morning', 'live_trading', 90)],
        [block('afternoon', 'backtest', 60)],
        [],
        [block('morning', 'mark_douglas_review', 45)],
        [],
        [],
        [],
      ]);
      expect(detectCalendarConflicts(responses(), plan)).toEqual([]);
    });

    it('every emitted message stays within the 200-char Zod warning bound', () => {
      const r = responses({
        meetingCommitment: 'regular',
        weekdayAvailability: {
          monday: off,
          tuesday: off,
          wednesday: off,
          thursday: off,
          friday: off,
        },
        weekendAvailability: { saturday: off, sunday: off },
      });
      const heavy = Array.from({ length: 6 }, () => block('morning', 'live_trading', 90));
      const plan = output([heavy, heavy, heavy, heavy, heavy, heavy, heavy]);
      const msgs = detectCalendarConflicts(r, plan);
      expect(msgs.length).toBeGreaterThan(0);
      for (const m of msgs) expect(m.length).toBeLessThanOrEqual(200);
    });

    it('never contains market-advice vocabulary (§2 firewall)', () => {
      const r = responses({
        meetingCommitment: 'regular',
        weekdayAvailability: {
          monday: off,
          tuesday: off,
          wednesday: off,
          thursday: off,
          friday: off,
        },
        weekendAvailability: { saturday: off, sunday: off },
      });
      const heavy = Array.from({ length: 6 }, () => block('morning', 'live_trading', 90));
      const msgs = detectCalendarConflicts(r, output([heavy, heavy, heavy, [], [], [], []]));
      const joined = msgs.join(' ').toLowerCase();
      for (const token of MARKET_TOKENS) expect(joined).not.toContain(token);
    });

    it('is pure — identical input yields identical output', () => {
      const r = responses({
        weekdayAvailability: { monday: off, tuesday: on, wednesday: on, thursday: on, friday: on },
      });
      const plan = output([[block('morning', 'backtest')]]);
      expect(detectCalendarConflicts(r, plan)).toEqual(detectCalendarConflicts(r, plan));
    });
  });
});

describe('mergeWarnings — dedupe + order + cap', () => {
  it('puts conflicts first, then model warnings', () => {
    const merged = mergeWarnings(['Modèle A'], ['Conflit 1']);
    expect(merged[0]).toBe('Conflit 1');
    expect(merged[1]).toBe('Modèle A');
  });

  it('dedupes case/whitespace-insensitively', () => {
    const merged = mergeWarnings(['journée  chargée'], ['Journée chargée']);
    expect(merged).toEqual(['Journée chargée']);
  });

  it('caps at 3, conflicts winning the cap', () => {
    const merged = mergeWarnings(['Modèle 1', 'Modèle 2'], ['Conflit 1', 'Conflit 2', 'Conflit 3']);
    expect(merged).toEqual(['Conflit 1', 'Conflit 2', 'Conflit 3']);
  });

  it('drops blank entries', () => {
    expect(mergeWarnings(['  ', 'Modèle'], [''])).toEqual(['Modèle']);
  });

  it('returns [] when both inputs are empty', () => {
    expect(mergeWarnings([], [])).toEqual([]);
  });
});
