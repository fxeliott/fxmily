import { describe, expect, it } from 'vitest';

import { summarizeHabitPillars } from './pillars';

describe('summarizeHabitPillars — J5.2 aggregation', () => {
  it('averages the pillar scalar + counts days, in canonical order', () => {
    const out = summarizeHabitPillars([
      { kind: 'sport', value: { type: 'cardio', durationMin: 45 } },
      { kind: 'sleep', value: { durationMin: 480 } }, // 8h
      { kind: 'sleep', value: { durationMin: 420 } }, // 7h
    ]);
    // sleep before sport (canonical order) ; sleep avg (8+7)/2 = 7.5h over 2 days.
    expect(out).toEqual([
      { kind: 'sleep', daysLogged: 2, average: 7.5, unit: 'h' },
      { kind: 'sport', daysLogged: 1, average: 45, unit: 'min' },
    ]);
  });

  it('uses the right unit per pillar', () => {
    const out = summarizeHabitPillars([
      { kind: 'nutrition', value: { mealsCount: 3 } },
      { kind: 'caffeine', value: { cups: 2 } },
      { kind: 'meditation', value: { durationMin: 15 } },
    ]);
    expect(out).toEqual([
      { kind: 'nutrition', daysLogged: 1, average: 3, unit: 'repas' },
      { kind: 'caffeine', daysLogged: 1, average: 2, unit: 'cafés' },
      { kind: 'meditation', daysLogged: 1, average: 15, unit: 'min' },
    ]);
  });

  it('drops a pillar whose payload does not match its schema', () => {
    expect(summarizeHabitPillars([{ kind: 'sleep', value: {} }])).toEqual([]);
  });

  it('empty input -> empty summary', () => {
    expect(summarizeHabitPillars([])).toEqual([]);
  });
});
