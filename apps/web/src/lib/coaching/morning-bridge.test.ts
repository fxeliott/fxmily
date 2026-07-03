import { describe, expect, it } from 'vitest';

import {
  ABSENCE_DAYS_THRESHOLD,
  buildMorningBridge,
  MORNING_BRIDGE_END_HOUR,
  type MorningBridgeInput,
} from './morning-bridge';

/**
 * Tour 11 — decision table of the morning bridge. Pure module: each case pins
 * the SELECTED branch (welcome-back vs yesterday-echo), the tone and the
 * register variation, never the full prose (copy stays editable without churn).
 */

function input(overrides: Partial<MorningBridgeInput> = {}): MorningBridgeInput {
  return {
    localHour: 8,
    daysSinceLastCheckin: 1,
    yesterdayEvening: {
      intentionKept: true,
      planRespectedToday: null,
      stressScore: null,
    },
    coachingRegister: null,
    ...overrides,
  };
}

describe('buildMorningBridge — visibility gates', () => {
  it('returns null outside the morning window', () => {
    expect(buildMorningBridge(input({ localHour: MORNING_BRIDGE_END_HOUR }))).toBeNull();
    expect(buildMorningBridge(input({ localHour: 18 }))).toBeNull();
    expect(buildMorningBridge(input({ localHour: 23 }))).toBeNull();
  });

  it('shows in the morning (0..11)', () => {
    expect(buildMorningBridge(input({ localHour: 0 }))).not.toBeNull();
    expect(buildMorningBridge(input({ localHour: 11 }))).not.toBeNull();
  });

  it('returns null when the member has never checked in', () => {
    expect(buildMorningBridge(input({ daysSinceLastCheckin: null }))).toBeNull();
  });

  it('returns null when already checked in today (arrival moment passed)', () => {
    expect(buildMorningBridge(input({ daysSinceLastCheckin: 0 }))).toBeNull();
  });

  it('returns null when there is no evening check-in to bridge from (and no absence)', () => {
    expect(
      buildMorningBridge(input({ daysSinceLastCheckin: 1, yesterdayEvening: null })),
    ).toBeNull();
  });
});

describe('buildMorningBridge — return after absence', () => {
  it('substitutes a warm welcome-back at/after the absence threshold', () => {
    const bridge = buildMorningBridge(
      input({ daysSinceLastCheckin: ABSENCE_DAYS_THRESHOLD, yesterdayEvening: null }),
    );
    expect(bridge).not.toBeNull();
    expect(bridge?.kind).toBe('welcome-back');
    expect(bridge?.tone).toBe('ok');
    expect(bridge?.lines).toHaveLength(1);
    expect(bridge?.lines[0]).toMatch(/Content de te revoir/);
  });

  it('welcome-back wins over a stale yesterday evening check-in', () => {
    const bridge = buildMorningBridge(
      input({
        daysSinceLastCheckin: 5,
        yesterdayEvening: { intentionKept: true, planRespectedToday: null, stressScore: null },
      }),
    );
    expect(bridge?.kind).toBe('welcome-back');
  });

  it('is never punitive about the absence (no failure/guilt wording)', () => {
    const bridge = buildMorningBridge(
      input({ daysSinceLastCheckin: 4, yesterdayEvening: null, coachingRegister: 'pedagogique' }),
    );
    const text = bridge?.lines.join(' ').toLowerCase() ?? '';
    expect(text).not.toContain('échec');
    expect(text).not.toContain('rattrape');
  });
});

describe('buildMorningBridge — yesterday echo', () => {
  it('intention kept → tone ok, kind yesterday', () => {
    const bridge = buildMorningBridge(
      input({
        yesterdayEvening: { intentionKept: true, planRespectedToday: null, stressScore: 2 },
      }),
    );
    expect(bridge?.kind).toBe('yesterday');
    expect(bridge?.tone).toBe('ok');
    expect(bridge?.lines[0]).toMatch(/tenu ton intention/);
  });

  it('intention missed → neutral tone (never red), datum-framed', () => {
    const bridge = buildMorningBridge(
      input({
        yesterdayEvening: { intentionKept: false, planRespectedToday: null, stressScore: null },
      }),
    );
    expect(bridge?.tone).toBe('neutral');
    expect(bridge?.lines[0]?.toLowerCase()).toMatch(/donnée|information/);
  });

  it('falls back to plan-respected when intention is null (null-passthrough)', () => {
    const bridge = buildMorningBridge(
      input({
        yesterdayEvening: { intentionKept: null, planRespectedToday: true, stressScore: null },
      }),
    );
    expect(bridge?.tone).toBe('ok');
    expect(bridge?.lines[0]).toMatch(/respecté ton plan/);
  });

  it('a null intention AND null plan never fabricate a signal (neutral presence nod)', () => {
    const bridge = buildMorningBridge(
      input({
        yesterdayEvening: { intentionKept: null, planRespectedToday: null, stressScore: null },
      }),
    );
    expect(bridge?.tone).toBe('neutral');
    expect(bridge?.lines[0]).toMatch(/bilan du soir/);
  });

  it('adds a calm self-care follow-up only on a genuinely high-stress evening', () => {
    const high = buildMorningBridge(
      input({
        yesterdayEvening: { intentionKept: true, planRespectedToday: null, stressScore: 8 },
      }),
    );
    expect(high?.lines).toHaveLength(2);
    expect(high?.lines[1]).toMatch(/stress/i);

    const low = buildMorningBridge(
      input({
        yesterdayEvening: { intentionKept: true, planRespectedToday: null, stressScore: 3 },
      }),
    );
    expect(low?.lines).toHaveLength(1);
  });

  it('null stress never triggers the self-care follow-up (null-passthrough)', () => {
    const bridge = buildMorningBridge(
      input({
        yesterdayEvening: { intentionKept: true, planRespectedToday: null, stressScore: null },
      }),
    );
    expect(bridge?.lines).toHaveLength(1);
  });
});

describe('buildMorningBridge — register personalisation', () => {
  it('picks the register variant; garbage/null falls back to pedagogique', () => {
    const direct = buildMorningBridge(
      input({
        coachingRegister: 'direct',
        yesterdayEvening: { intentionKept: true, planRespectedToday: null, stressScore: null },
      }),
    );
    const socratique = buildMorningBridge(
      input({
        coachingRegister: 'socratique',
        yesterdayEvening: { intentionKept: true, planRespectedToday: null, stressScore: null },
      }),
    );
    const fallback = buildMorningBridge(
      input({
        coachingRegister: null,
        yesterdayEvening: { intentionKept: true, planRespectedToday: null, stressScore: null },
      }),
    );
    // The socratique register asks a question; the others assert.
    expect(socratique?.lines[0]).toMatch(/\?$/);
    expect(direct?.lines[0]).not.toMatch(/\?$/);
    // Null register resolves to the pedagogique copy (longer, teaching wording).
    expect(fallback?.lines[0]).toMatch(/constance/);
  });
});

describe('buildMorningBridge — copy hygiene', () => {
  it('never emits an em-dash (Eliott copy rule) across all branches', () => {
    const cases: MorningBridgeInput[] = [
      input({ daysSinceLastCheckin: 5, yesterdayEvening: null }),
      input({
        yesterdayEvening: { intentionKept: true, planRespectedToday: null, stressScore: 9 },
      }),
      input({
        yesterdayEvening: { intentionKept: false, planRespectedToday: null, stressScore: null },
      }),
      input({
        yesterdayEvening: { intentionKept: null, planRespectedToday: true, stressScore: null },
      }),
      input({
        yesterdayEvening: { intentionKept: null, planRespectedToday: null, stressScore: null },
      }),
    ];
    for (const register of ['direct', 'pedagogique', 'socratique'] as const) {
      for (const base of cases) {
        const bridge = buildMorningBridge({ ...base, coachingRegister: register });
        const text = (bridge?.title ?? '') + ' ' + (bridge?.lines.join(' ') ?? '');
        expect(text).not.toContain('—');
      }
    }
  });

  it('tone is never anything but ok/neutral (red reserved for outcomes)', () => {
    const bridge = buildMorningBridge(
      input({
        yesterdayEvening: { intentionKept: false, planRespectedToday: null, stressScore: 10 },
      }),
    );
    expect(['ok', 'neutral']).toContain(bridge?.tone);
  });
});
