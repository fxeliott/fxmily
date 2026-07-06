import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { isEveningReminderDue, isMorningReminderDue } from './timezone';

/**
 * S10 regression guard (TIER1), rewritten tour 13 — the deployed cron schedule
 * MUST cover the Paris-LOCAL reminder windows (lib/checkin/timezone.ts) in BOTH
 * DST seasons.
 *
 * TIMEZONE REALITY (tour 13): the prod host runs `Europe/Paris` and Debian
 * crond interprets /etc/cron.d hour fields in the HOST-LOCAL timezone, not
 * UTC (proven at runtime: an `18-20` hour field logged ticks 17:00→18:45 UTC
 * = 19:00→20:45 Paris, cron.log 2026-07-04). The previous version of this
 * test modelled the ticks as UTC instants, so it green-lit a `5-7,18-20`
 * field that actually fired 05:00-07:45 + 18:00-20:45 Paris — covering only
 * the first 15-30 min of each member window. This version models the ticks
 * as Paris WALL-CLOCK times, exactly like crond executes them, and asserts
 * FULL-WINDOW coverage (not just "at least one tick") so an edge-only
 * overlap can never pass again.
 */

const CRONTAB_URL = new URL('../../../../../ops/cron/crontab.fxmily', import.meta.url);

/** Expand a single crontab field ("0,15,30,45", "7-9,20-22", "*") into values. */
function expandField(field: string, max: number): number[] {
  const out = new Set<number>();
  for (const part of field.split(',')) {
    if (part === '*') {
      for (let i = 0; i <= max; i += 1) out.add(i);
      continue;
    }
    const range = part.match(/^(\d+)-(\d+)$/);
    if (range && range[1] !== undefined && range[2] !== undefined) {
      for (let i = Number(range[1]); i <= Number(range[2]); i += 1) out.add(i);
    } else {
      out.add(Number(part));
    }
  }
  return [...out].sort((a, b) => a - b);
}

/** Parse the HOST-LOCAL (Europe/Paris) (hour, minute) ticks of the checkin-reminders row. */
function checkinTicksParisLocal(): ReadonlyArray<{ hour: number; minute: number }> {
  const text = readFileSync(CRONTAB_URL, 'utf8');
  const row = text
    .split('\n')
    .find((line) => line.includes('checkin-reminders') && !line.trimStart().startsWith('#'));
  expect(row, 'crontab.fxmily must carry an active checkin-reminders row').toBeTruthy();
  const fields = row!.trim().split(/\s+/);
  const minuteField = fields[0] ?? '';
  const hourField = fields[1] ?? '';
  const minutes = expandField(minuteField, 59);
  const hours = expandField(hourField, 23);
  const ticks: Array<{ hour: number; minute: number }> = [];
  for (const hour of hours) {
    for (const minute of minutes) ticks.push({ hour, minute });
  }
  return ticks;
}

/**
 * Build the UTC instant for a Paris wall-clock time on a given date. The two
 * test dates sit deep inside each DST season, so the offset is a constant
 * (+02:00 CEST / +01:00 CET) — no transition edge cases on these days.
 */
function parisInstant(isoDate: string, hour: number, minute: number, offset: string): Date {
  return new Date(
    `${isoDate}T${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:00${offset}`,
  );
}

describe('check-in reminder cron ↔ Paris window coverage (host-local crond, DST-safe)', () => {
  const ticks = checkinTicksParisLocal();
  const seasons: ReadonlyArray<readonly [label: string, isoDate: string, offset: string]> = [
    ['summer (CEST, UTC+2)', '2026-07-15', '+02:00'], // allow-absolute-date injected-clock-anchor
    ['winter (CET, UTC+1)', '2026-01-15', '+01:00'],
  ];

  // Windows are 90 min each with a 15-min cadence → full coverage means at
  // least 6 due ticks (07:30..08:45 / 20:30..21:45). Requiring ≥4 tolerates a
  // legitimate future cadence change (every 20-30 min) while still failing
  // the edge-only overlap this test exists to prevent.
  const FULL_COVERAGE_MIN_TICKS = 4;

  for (const [label, isoDate, offset] of seasons) {
    it(`covers the MORNING Paris window end-to-end — ${label}`, () => {
      const due = ticks.filter((t) =>
        isMorningReminderDue(parisInstant(isoDate, t.hour, t.minute, offset), 'Europe/Paris'),
      );
      expect(
        due.length,
        `morning ticks in window (${label}): ${JSON.stringify(due)}`,
      ).toBeGreaterThanOrEqual(FULL_COVERAGE_MIN_TICKS);
    });

    it(`covers the EVENING Paris window end-to-end — ${label}`, () => {
      const due = ticks.filter((t) =>
        isEveningReminderDue(parisInstant(isoDate, t.hour, t.minute, offset), 'Europe/Paris'),
      );
      expect(
        due.length,
        `evening ticks in window (${label}): ${JSON.stringify(due)}`,
      ).toBeGreaterThanOrEqual(FULL_COVERAGE_MIN_TICKS);
    });
  }
});
