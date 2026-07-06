/**
 * V1.7 §30 — Meeting occurrence generation tests (J-M1, pure module).
 *
 * TDD-first per `feedback_backend_first_workflow.md`. The DST round-trip is the
 * risky part (SPEC §30.7 invariant): `scheduledAt` is the exact UTC instant of
 * the 12h/20h Paris slot, and `date` is DERIVED from it — they must never
 * diverge on a switch day. Pinned on the two post-switch Mondays which are
 * REAL meeting days (the Sundays before are weekends → 0 meetings).
 */

import { describe, expect, it } from 'vitest';

import { localDateOf, parseLocalDate } from '@/lib/checkin/timezone';

import {
  MEETING_SLOTS,
  MEETING_TIMEZONE,
  buildMeetingOccurrence,
  generateMeetingOccurrences,
} from './occurrence';

// ---------------------------------------------------------------------------
// DST anchor sanity — these dates ARE Mondays (self-documenting the fixtures).
// EU DST 2026: spring-forward Sun 2026-03-29, fall-back Sun 2026-10-25.
// ---------------------------------------------------------------------------

describe('DST anchors are Mondays (real meeting days)', () => {
  it('2026-03-30 (post spring-forward, CEST) is a Monday', () => {
    expect(parseLocalDate('2026-03-30').getUTCDay()).toBe(1);
  });
  it('2026-10-26 (post fall-back, CET) is a Monday', () => {
    // allow-absolute-date injected-clock-anchor
    expect(parseLocalDate('2026-10-26').getUTCDay()).toBe(1); // allow-absolute-date injected-clock-anchor
  });
});

// ---------------------------------------------------------------------------
// buildMeetingOccurrence — DST-aware scheduledAt + derived date
// ---------------------------------------------------------------------------

describe('buildMeetingOccurrence — DST-aware scheduledAt', () => {
  it('CEST Monday 2026-03-30: 12h Paris → 10:00Z, 20h Paris → 18:00Z', () => {
    expect(buildMeetingOccurrence('2026-03-30', 'midday').scheduledAt.toISOString()).toBe(
      '2026-03-30T10:00:00.000Z',
    );
    expect(buildMeetingOccurrence('2026-03-30', 'evening').scheduledAt.toISOString()).toBe(
      '2026-03-30T18:00:00.000Z',
    );
  });

  it('CET Monday 2026-10-26: 12h Paris → 11:00Z, 20h Paris → 19:00Z', () => {
    // allow-absolute-date injected-clock-anchor
    expect(buildMeetingOccurrence('2026-10-26', 'midday').scheduledAt.toISOString()).toBe(
      // allow-absolute-date injected-clock-anchor
      '2026-10-26T11:00:00.000Z', // allow-absolute-date injected-clock-anchor
    );
    expect(buildMeetingOccurrence('2026-10-26', 'evening').scheduledAt.toISOString()).toBe(
      // allow-absolute-date injected-clock-anchor
      '2026-10-26T19:00:00.000Z', // allow-absolute-date injected-clock-anchor
    );
  });

  it('date is DERIVED from scheduledAt and round-trips to the input day (§30.7)', () => {
    for (const day of ['2026-03-30', '2026-10-26']) {
      // allow-absolute-date injected-clock-anchor
      for (const slot of MEETING_SLOTS) {
        const occ = buildMeetingOccurrence(day, slot);
        expect(occ.date).toBe(day);
        // The invariant: date === localDateOf(scheduledAt, Paris), by construction.
        expect(occ.date).toBe(localDateOf(occ.scheduledAt, MEETING_TIMEZONE));
        expect(occ.slot).toBe(slot);
      }
    }
  });
});

// ---------------------------------------------------------------------------
// generateMeetingOccurrences — rolling window, weekend skip, determinism
// ---------------------------------------------------------------------------

describe('generateMeetingOccurrences', () => {
  it('emits Mon–Fri × 2 slots over a 7-day window, skipping the weekend', () => {
    // 2026-03-30 is Monday → Mon–Fri = 5 weekdays × 2 slots = 10, Sat/Sun skipped.
    const occ = generateMeetingOccurrences('2026-03-30', 7);
    expect(occ).toHaveLength(10);
    for (const o of occ) {
      const dow = parseLocalDate(o.date).getUTCDay();
      expect(dow).toBeGreaterThanOrEqual(1); // never Sunday (0)
      expect(dow).toBeLessThanOrEqual(5); // never Saturday (6)
    }
  });

  it('emits midday before evening for each day (chronological)', () => {
    const occ = generateMeetingOccurrences('2026-03-30', 1); // single Monday
    expect(occ.map((o) => o.slot)).toEqual(['midday', 'evening']);
    expect(occ[0]!.scheduledAt.getTime()).toBeLessThan(occ[1]!.scheduledAt.getTime());
  });

  it('skips a weekend-only window entirely (Sat + Sun → 0)', () => {
    // 2026-03-28 Sat, 2026-03-29 Sun (the spring-forward Sunday) → 0 meetings.
    expect(parseLocalDate('2026-03-28').getUTCDay()).toBe(6);
    expect(generateMeetingOccurrences('2026-03-28', 2)).toHaveLength(0);
  });

  it('is deterministic — same inputs yield byte-identical occurrences (cron idempotence basis)', () => {
    const a = generateMeetingOccurrences('2026-03-30', 7);
    const b = generateMeetingOccurrences('2026-03-30', 7);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it('clamps a non-positive / non-integer span', () => {
    expect(generateMeetingOccurrences('2026-03-30', 0)).toEqual([]);
    expect(generateMeetingOccurrences('2026-03-30', -5)).toEqual([]);
    // 1.9 days → 1 day scanned (Monday) → 2 slots.
    expect(generateMeetingOccurrences('2026-03-30', 1.9)).toHaveLength(2);
  });
});
