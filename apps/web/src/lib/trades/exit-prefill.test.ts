import { describe, expect, it } from 'vitest';

import { defaultExitInstant, defaultExitLocalInput } from './exit-prefill';

/**
 * J10 correctif n°2 — LES tests qui auraient détecté le défaut.
 *
 * L'ancienne règle `max(now, entrée + 1 h)` proposait une sortie dans le futur
 * dès que le trade avait moins d'une heure. Chaque cas ci-dessous échoue si
 * elle revient.
 */
describe('defaultExitInstant', () => {
  const now = new Date('2026-08-07T14:00:00.000Z');

  it('proposes NOW for a trade opened minutes ago (regression J10-2)', () => {
    // Le scalp : entrée il y a 10 minutes. L'ancienne règle proposait
    // 14:50 UTC, soit 50 minutes dans le futur.
    const entered = new Date('2026-08-07T13:50:00.000Z');
    expect(defaultExitInstant(entered, now).toISOString()).toBe('2026-08-07T14:00:00.000Z');
  });

  it('proposes NOW for a trade opened one second ago', () => {
    const entered = new Date('2026-08-07T13:59:59.000Z');
    expect(defaultExitInstant(entered, now).getTime()).toBe(now.getTime());
  });

  it('never proposes an instant in the future for a past entry', () => {
    for (const minutesAgo of [0, 1, 5, 30, 59, 60, 61, 1440]) {
      const entered = new Date(now.getTime() - minutesAgo * 60_000);
      expect(defaultExitInstant(entered, now).getTime()).toBeLessThanOrEqual(now.getTime());
    }
  });

  it('proposes NOW for a trade opened long ago (the entry never wins)', () => {
    const entered = new Date('2026-08-01T09:00:00.000Z');
    expect(defaultExitInstant(entered, now).getTime()).toBe(now.getTime());
  });

  it('floors at the entry when the entry is dated slightly ahead', () => {
    // `tradeOpenSchema` tolère une entrée jusqu'à 1 h en avant. Proposer `now`
    // sec produirait un formulaire que `closeTrade` refuserait
    // (`exitedAt < enteredAt`). Le plancher garde le formulaire cohérent.
    const entered = new Date('2026-08-07T14:20:00.000Z');
    expect(defaultExitInstant(entered, now).toISOString()).toBe('2026-08-07T14:20:00.000Z');
  });
});

describe('defaultExitLocalInput', () => {
  it('renders the wall clock in the member set timezone, not UTC', () => {
    const now = new Date('2026-08-07T14:00:00.000Z'); // 16:00 à Paris (CEST)
    expect(defaultExitLocalInput('2026-08-07T13:50:00.000Z', 'Europe/Paris', now)).toBe(
      '2026-08-07T16:00',
    );
    expect(defaultExitLocalInput('2026-08-07T13:50:00.000Z', 'UTC', now)).toBe('2026-08-07T14:00');
  });

  it('does not add an hour to a fresh trade (regression J10-2)', () => {
    const now = new Date('2026-08-07T14:00:00.000Z');
    const rendered = defaultExitLocalInput('2026-08-07T13:55:00.000Z', 'Europe/Paris', now);
    expect(rendered).toBe('2026-08-07T16:00');
    expect(rendered).not.toBe('2026-08-07T16:55');
  });
});
