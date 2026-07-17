import { describe, expect, it } from 'vitest';

import { mapCheckinToHabitLogs, type CheckinHabitSource } from './habit-projection';

function source(overrides: Partial<CheckinHabitSource> = {}): CheckinHabitSource {
  return {
    date: '2026-07-17',
    sleepHours: 8,
    sleepQuality: 7,
    meditationMin: 0,
    sportType: null,
    sportDurationMin: null,
    ...overrides,
  };
}

describe('mapCheckinToHabitLogs', () => {
  describe('sleep (always projects)', () => {
    it('projects sleep with duration in minutes and quality passed through', () => {
      const logs = mapCheckinToHabitLogs(source({ sleepHours: 8, sleepQuality: 7 }));
      const sleep = logs.find((l) => l.kind === 'sleep');
      expect(sleep).toEqual({
        kind: 'sleep',
        date: '2026-07-17',
        value: { durationMin: 480, quality: 7 },
      });
    });

    it('rounds fractional hours to whole minutes', () => {
      const [sleep] = mapCheckinToHabitLogs(source({ sleepHours: 7.5 }));
      expect(sleep?.value).toMatchObject({ durationMin: 450 });
    });

    it('clamps duration to the 24h HabitLog bound', () => {
      const [sleep] = mapCheckinToHabitLogs(source({ sleepHours: 24 }));
      expect(sleep?.value).toMatchObject({ durationMin: 1440 });
    });

    it('projects sleep even for a 0h night', () => {
      const [sleep] = mapCheckinToHabitLogs(source({ sleepHours: 0, sleepQuality: 1 }));
      expect(sleep).toMatchObject({ kind: 'sleep', value: { durationMin: 0, quality: 1 } });
    });

    it('never carries a notes key on the sleep log', () => {
      const [sleep] = mapCheckinToHabitLogs(source());
      expect(sleep).not.toHaveProperty('notes');
    });
  });

  describe('meditation (only when > 0)', () => {
    it('does not project meditation when 0 minutes', () => {
      const logs = mapCheckinToHabitLogs(source({ meditationMin: 0 }));
      expect(logs.some((l) => l.kind === 'meditation')).toBe(false);
    });

    it('projects meditation when minutes > 0', () => {
      const logs = mapCheckinToHabitLogs(source({ meditationMin: 30 }));
      const meditation = logs.find((l) => l.kind === 'meditation');
      expect(meditation).toEqual({
        kind: 'meditation',
        date: '2026-07-17',
        value: { durationMin: 30 },
      });
    });

    it('clamps meditation duration to the 180min HabitLog bound', () => {
      // Defensive: the morning check-in schema now also caps meditation at 180,
      // so this over-bound input can only reach the pure mapper directly. The
      // clamp stays as a belt-and-suspenders guard mirroring the HabitLog bound.
      const logs = mapCheckinToHabitLogs(source({ meditationMin: 240 }));
      const meditation = logs.find((l) => l.kind === 'meditation');
      expect(meditation?.value).toEqual({ durationMin: 180 });
    });

    it('omits the optional quality key (check-in carries no meditation quality)', () => {
      const logs = mapCheckinToHabitLogs(source({ meditationMin: 15 }));
      const meditation = logs.find((l) => l.kind === 'meditation');
      expect(meditation?.value).not.toHaveProperty('quality');
    });
  });

  describe('sport (only when declared)', () => {
    it('does not project sport when sportType is null', () => {
      const logs = mapCheckinToHabitLogs(source({ sportType: null, sportDurationMin: null }));
      expect(logs.some((l) => l.kind === 'sport')).toBe(false);
    });

    it('projects sport with mapped kind, duration, and the original label in notes', () => {
      const logs = mapCheckinToHabitLogs(
        source({ sportType: 'course à pied', sportDurationMin: 45 }),
      );
      const sport = logs.find((l) => l.kind === 'sport');
      expect(sport).toEqual({
        kind: 'sport',
        date: '2026-07-17',
        value: { type: 'cardio', durationMin: 45 },
        notes: 'course à pied',
      });
    });

    it('defaults duration to 0 when sportDurationMin is null', () => {
      const logs = mapCheckinToHabitLogs(source({ sportType: 'yoga', sportDurationMin: null }));
      const sport = logs.find((l) => l.kind === 'sport');
      expect(sport?.value).toMatchObject({ durationMin: 0 });
    });

    it('clamps sport duration to the 600min HabitLog bound', () => {
      const logs = mapCheckinToHabitLogs(source({ sportType: 'vélo', sportDurationMin: 720 }));
      const sport = logs.find((l) => l.kind === 'sport');
      expect(sport?.value).toMatchObject({ durationMin: 600 });
    });

    it('omits the optional intensityRating key (check-in carries no intensity)', () => {
      const logs = mapCheckinToHabitLogs(source({ sportType: 'muscu', sportDurationMin: 60 }));
      const sport = logs.find((l) => l.kind === 'sport');
      expect(sport?.value).not.toHaveProperty('intensityRating');
    });

    it.each([
      ['musculation', 'strength'],
      ['renforcement', 'strength'],
      ['course à pied', 'cardio'],
      ['vélo', 'cardio'],
      ['natation', 'cardio'],
      ['yoga', 'flexibility'],
      ['stretching', 'flexibility'],
      ['crossfit', 'mixed'],
      ['circuit training', 'mixed'],
      ['jardinage', 'other'],
      ['bricolage', 'other'],
    ])('maps "%s" to sport kind "%s"', (label, expected) => {
      const logs = mapCheckinToHabitLogs(source({ sportType: label, sportDurationMin: 30 }));
      const sport = logs.find((l) => l.kind === 'sport');
      expect(sport?.value).toMatchObject({ type: expected });
    });
  });

  describe('combined + invariants', () => {
    it('projects all three pillars together, in stable order', () => {
      const logs = mapCheckinToHabitLogs(
        source({
          sleepHours: 7,
          sleepQuality: 6,
          meditationMin: 20,
          sportType: 'musculation',
          sportDurationMin: 50,
        }),
      );
      expect(logs.map((l) => l.kind)).toEqual(['sleep', 'meditation', 'sport']);
    });

    it('stamps every projected log with the check-in date', () => {
      const logs = mapCheckinToHabitLogs(
        source({ date: '2026-02-29', meditationMin: 10, sportType: 'yoga', sportDurationMin: 15 }),
      );
      expect(logs.every((l) => l.date === '2026-02-29')).toBe(true);
      expect(logs).toHaveLength(3);
    });

    it('projects only sleep when neither meditation nor sport is present', () => {
      const logs = mapCheckinToHabitLogs(source());
      expect(logs).toHaveLength(1);
      expect(logs[0]?.kind).toBe('sleep');
    });
  });
});
