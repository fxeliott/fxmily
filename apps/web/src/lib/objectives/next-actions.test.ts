import { describe, expect, it } from 'vitest';

import type { GuidanceAction } from '@/lib/daily-guidance/service';

import { MAX_NEXT_ACTIONS, orderGuidanceActions, stateRank } from './next-actions';

/**
 * S6 §32-2 — l'ordre des « prochaines actions » de /objectifs. Verrouille la
 * régression corrigée : le nouvel état `missed` (rattrapage actionnable) doit
 * primer sur l'informatif `info` (réunion du jour), pas tomber avec `done`.
 */

function action(state: GuidanceAction['state'], key: string): GuidanceAction {
  return {
    key,
    kind: 'checkin',
    title: key,
    detail: ' ',
    href: `/${key}`,
    state,
    emphasis: 'secondary',
  };
}

describe('stateRank — todo < missed < info < done', () => {
  it('classe les quatre états dans l’ordre actionnable', () => {
    expect(stateRank('todo')).toBe(0);
    expect(stateRank('missed')).toBe(1);
    expect(stateRank('info')).toBe(2);
    expect(stateRank('done')).toBe(3);
  });

  it('missed prime STRICTEMENT sur info (cœur de la régression S6)', () => {
    expect(stateRank('missed')).toBeLessThan(stateRank('info'));
  });
});

describe('orderGuidanceActions', () => {
  it('trie todo → missed → info → done', () => {
    const ordered = orderGuidanceActions([
      action('info', 'meeting'),
      action('done', 'checkin-ok'),
      action('missed', 'morning-catchup'),
      action('todo', 'mindset'),
    ]);
    expect(ordered.map((a) => a.key)).toEqual([
      'mindset',
      'morning-catchup',
      'meeting',
      'checkin-ok',
    ]);
  });

  it('DEFECT-1 — un rattrapage `missed` passe devant une réunion `info` co-présente', () => {
    // Scénario réel : créneau du soir, check-in du soir fait (done), check-in du
    // matin sauté (missed), réunion aujourd'hui (info), mindset déjà répondu.
    const ordered = orderGuidanceActions([
      action('info', 'meeting-today'),
      action('missed', 'morning-catchup'),
      action('done', 'evening-checkin'),
    ]);
    // La 1re action surfacée (celle que le hero d'objectifs met en avant) est le
    // rattrapage faisable, jamais la réunion informative.
    expect(ordered[0]?.key).toBe('morning-catchup');
    expect(ordered.indexOf(ordered.find((a) => a.key === 'meeting-today')!)).toBeGreaterThan(0);
  });

  it('préserve l’ordre d’entrée à rang égal (tri stable)', () => {
    const ordered = orderGuidanceActions([
      action('todo', 'first-todo'),
      action('info', 'meeting'),
      action('todo', 'second-todo'),
    ]);
    expect(ordered.map((a) => a.key)).toEqual(['first-todo', 'second-todo', 'meeting']);
  });

  it(`ne garde au plus que ${MAX_NEXT_ACTIONS} actions (la moins prioritaire tombe)`, () => {
    const ordered = orderGuidanceActions([
      action('todo', 't1'),
      action('todo', 't2'),
      action('missed', 'm1'),
      action('info', 'i1'),
      action('done', 'd1'),
    ]);
    expect(ordered).toHaveLength(MAX_NEXT_ACTIONS);
    expect(ordered.map((a) => a.key)).not.toContain('d1');
  });

  it('ne mute jamais le tableau d’entrée', () => {
    const input = [action('info', 'meeting'), action('todo', 'mindset')];
    const snapshot = input.map((a) => a.key);
    orderGuidanceActions(input);
    expect(input.map((a) => a.key)).toEqual(snapshot);
  });
});
