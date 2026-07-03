import { describe, expect, it } from 'vitest';

import { deriveNextStep } from './next-step';
import type { GuidanceAction } from './service';

/**
 * NextStepRail wayfinding derivation (§32-2 cross-page). The action list
 * mirrors what `getDailyGuidance` produces: ordered, `timing`-tagged
 * (`current` = first pending, `next` = second), `done`/`info` never pending.
 */

function action(overrides: Partial<GuidanceAction> & { key: string }): GuidanceAction {
  return {
    kind: 'checkin',
    title: 'Check-in du matin',
    detail: 'Sommeil, routine, préparation.',
    href: '/checkin/morning',
    state: 'todo',
    emphasis: 'primary',
    ...overrides,
  };
}

const morning = action({ key: 'checkin-morning', timing: 'current' });
const mindset = action({
  key: 'mindset-week',
  kind: 'mindset',
  title: 'QCM mindset de la semaine',
  href: '/mindset/new',
  state: 'todo',
  emphasis: 'secondary',
  timing: 'next',
});
const meetingInfo = action({
  key: 'meeting-today',
  kind: 'meeting',
  title: 'Réunion Fxmily aujourd’hui',
  href: '/reunions',
  state: 'info',
});
const doneCheckin = action({ key: 'checkin-morning', state: 'done' });

describe('deriveNextStep', () => {
  it('links the current action when the member is on another page', () => {
    const step = deriveNextStep([morning, mindset, meetingInfo], '/journal');
    expect(step).toEqual({ kind: 'now', target: morning, onCurrentSurface: false });
  });

  it('acks "you are here" and links the NEXT action on the current surface', () => {
    const step = deriveNextStep([morning, mindset], '/checkin/morning');
    expect(step.kind).toBe('here-next');
    expect(step.onCurrentSurface).toBe(true);
    expect(step.target).toBe(mindset);
  });

  it('treats a sub-route as being on the current surface', () => {
    const tracking = action({
      key: 'tracking-focus',
      kind: 'tracking',
      title: 'Relevé focus',
      href: '/tracking/focus',
      timing: 'current',
    });
    const step = deriveNextStep([tracking, mindset], '/tracking/focus/history');
    expect(step.kind).toBe('here-next');
    expect(step.target).toBe(mindset);
  });

  it('here-next with NO other pending action yields a null target (quiet ack)', () => {
    const step = deriveNextStep([morning, doneCheckin, meetingInfo], '/checkin/morning');
    expect(step).toEqual({ kind: 'here-next', target: null, onCurrentSurface: true });
  });

  it('all-done when nothing is pending (done + info only)', () => {
    const step = deriveNextStep([doneCheckin, meetingInfo], '/journal');
    expect(step).toEqual({ kind: 'all-done', target: null, onCurrentSurface: false });
  });

  it('a missed action is pending wayfinding-wise (calm catch-up, never skipped)', () => {
    const missedMorning = action({ key: 'checkin-morning', state: 'missed', timing: 'current' });
    const step = deriveNextStep([missedMorning], '/patterns');
    expect(step).toEqual({ kind: 'now', target: missedMorning, onCurrentSurface: false });
  });

  it('falls back to first pending when timing tags are absent', () => {
    const untagged = action({ key: 'checkin-evening', href: '/checkin/evening' });
    const step = deriveNextStep([meetingInfo, untagged], '/journal');
    expect(step).toEqual({ kind: 'now', target: untagged, onCurrentSurface: false });
  });

  it('info actions are NEVER a wayfinding target (a meeting is not a to-do)', () => {
    const step = deriveNextStep([meetingInfo], '/journal');
    expect(step.kind).toBe('all-done');
  });
});
