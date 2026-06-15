import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { isEveningReminderDue, isMorningReminderDue } from './timezone';

/**
 * S10 regression guard (TIER1) — the deployed cron UTC schedule MUST overlap the
 * Paris-LOCAL reminder windows (lib/checkin/timezone.ts) in BOTH DST seasons.
 *
 * The bug this guards: `checkin-reminders` fired at UTC hours `7-8,20-21`, which
 * only intersects the Paris windows [07:30,09:00) + [20:30,22:00) in WINTER (CET).
 * All summer (CEST, UTC+2) the first tick 07:00 UTC = 09:00 Paris was already past
 * the exclusive 09:00 end → ZERO reminders fired ~7 months/yr, silently (the scan
 * still wrote its heartbeat so health stayed green). We assert the REAL crontab
 * file so a future schedule edit that re-introduces the divergence fails CI.
 */

const CRONTAB_URL = new URL('../../../../../ops/cron/crontab.fxmily', import.meta.url);

/** Expand a single crontab field ("0,15,30,45", "5-7,18-20", "*") into values. */
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

/** Parse the UTC (hour, minute) ticks of the checkin-reminders row. */
function checkinTicksUtc(): ReadonlyArray<{ hour: number; minute: number }> {
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

function utcInstant(isoDate: string, hour: number, minute: number): Date {
  return new Date(
    `${isoDate}T${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:00Z`,
  );
}

describe('check-in reminder cron ↔ Paris window coverage (DST-safe)', () => {
  const ticks = checkinTicksUtc();
  const seasons: ReadonlyArray<readonly [label: string, isoDate: string]> = [
    ['summer (CEST, UTC+2)', '2026-07-15'],
    ['winter (CET, UTC+1)', '2026-01-15'],
  ];

  for (const [label, isoDate] of seasons) {
    it(`fires ≥1 MORNING reminder tick inside the Paris window — ${label}`, () => {
      const due = ticks.filter((t) =>
        isMorningReminderDue(utcInstant(isoDate, t.hour, t.minute), 'Europe/Paris'),
      );
      expect(due.length, `morning ticks in window (${label})`).toBeGreaterThan(0);
    });

    it(`fires ≥1 EVENING reminder tick inside the Paris window — ${label}`, () => {
      const due = ticks.filter((t) =>
        isEveningReminderDue(utcInstant(isoDate, t.hour, t.minute), 'Europe/Paris'),
      );
      expect(due.length, `evening ticks in window (${label})`).toBeGreaterThan(0);
    });
  }
});
