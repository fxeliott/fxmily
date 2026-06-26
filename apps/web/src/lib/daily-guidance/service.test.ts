import { beforeEach, describe, expect, it, vi } from 'vitest';

import { getCalendarForUser, getQuestionnaireForUser } from '@/lib/calendar/service';
import { getCheckinStatus } from '@/lib/checkin/service';
import { listScheduledMeetingsOn } from '@/lib/meeting/service';
import { getMindsetCheck } from '@/lib/mindset/service';
import { getDueTrackingInstruments } from '@/lib/tracking/service';

import { getDailyGuidance } from './service';

/**
 * Session 5 — daily-guidance composition. The pure modules (`./slot`,
 * `@/lib/calendar/week`, `@/lib/checkin/timezone`) run REAL; only the DB-backed
 * surfaces are mocked, so the test exercises the genuine derivation (slot →
 * primary check-in, today-block extraction by civil date, Monday mindset
 * emphasis, calendar state machine, ordering). Carbone the batch.test mock style.
 *
 * 2026-06-08 is a Monday (CEST). 07:00 UTC = 09:00 Paris (morning), 18:00 UTC =
 * 20:00 Paris (evening). 2026-06-09 is a Tuesday.
 */

vi.mock('@/lib/calendar/service', () => ({
  getCalendarForUser: vi.fn(),
  getQuestionnaireForUser: vi.fn(),
}));
vi.mock('@/lib/checkin/service', () => ({ getCheckinStatus: vi.fn() }));
vi.mock('@/lib/mindset/service', () => ({ getMindsetCheck: vi.fn() }));
vi.mock('@/lib/meeting/service', () => ({ listScheduledMeetingsOn: vi.fn() }));
vi.mock('@/lib/tracking/service', () => ({ getDueTrackingInstruments: vi.fn() }));

const USER = 'user_1';
const TZ = 'Europe/Paris';
const MON_MORNING = new Date('2026-06-08T07:00:00Z'); // 09:00 Paris, Monday
const MON_AFTERNOON = new Date('2026-06-08T13:00:00Z'); // 15:00 Paris, Monday (afternoon slot)
const MON_EVENING = new Date('2026-06-08T18:00:00Z'); // 20:00 Paris, Monday
const TUE_MORNING = new Date('2026-06-09T07:00:00Z'); // 09:00 Paris, Tuesday

/** Minimal serialized calendar carrying just the `schedule.days` the service reads. */
function calendarWith(days: Array<{ date: string; blocks: unknown[] }>) {
  return {
    schedule: { days: days.map((d) => ({ date: d.date, dayLabel: 'Lundi', blocks: d.blocks })) },
  } as unknown as Awaited<ReturnType<typeof getCalendarForUser>>;
}

const aBlock = (over: Record<string, unknown> = {}) => ({
  slot: 'morning',
  category: 'live_trading',
  durationMin: 60,
  label: 'Session de trading',
  priority: 'medium',
  ...over,
});

beforeEach(() => {
  vi.mocked(getCheckinStatus).mockResolvedValue({
    today: '2026-06-08',
    morningSubmitted: false,
    eveningSubmitted: false,
  });
  vi.mocked(getCalendarForUser).mockResolvedValue(null);
  vi.mocked(getQuestionnaireForUser).mockResolvedValue(null);
  vi.mocked(getMindsetCheck).mockResolvedValue(null);
  vi.mocked(listScheduledMeetingsOn).mockResolvedValue([]);
  vi.mocked(getDueTrackingInstruments).mockResolvedValue([]);
});

/** Minimal DueTrackingInstrument list — the service reads only key + title. */
function dueTracking(...pairs: Array<[key: string, title: string]>) {
  return pairs.map(([key, title]) => ({
    instrument: { key, title },
    dueSince: '2026-06-08T07:00:00Z',
  })) as unknown as Awaited<ReturnType<typeof getDueTrackingInstruments>>;
}

describe('getDailyGuidance — slot + check-in', () => {
  it('morning: the morning check-in is the primary action (todo)', async () => {
    const g = await getDailyGuidance(USER, TZ, MON_MORNING);
    expect(g.slot).toBe('morning');
    expect(g.actions[0]).toMatchObject({
      key: 'checkin-morning',
      emphasis: 'primary',
      state: 'todo',
    });
    // secondary evening check-in is also surfaced while undone
    expect(g.actions.some((a) => a.key === 'checkin-evening' && a.emphasis === 'secondary')).toBe(
      true,
    );
  });

  it('should_make_morning_checkin_primary_when_slot_is_afternoon (primaryCheckinSlot afternoon → morning)', async () => {
    // Arrange — 15:00 Paris falls in the afternoon bucket (12 ≤ h < 18).
    // `primaryCheckinSlot('afternoon')` maps to 'morning' (slot.ts:58-60), so
    // the morning check-in (market-prep / routine) stays the primary nudge.

    // Act
    const g = await getDailyGuidance(USER, TZ, MON_AFTERNOON);

    // Assert
    expect(g.slot).toBe('afternoon');
    expect(g.actions[0]).toMatchObject({
      key: 'checkin-morning',
      emphasis: 'primary',
      state: 'todo',
    });
    // the evening check-in is still surfaced as secondary while undone
    expect(g.actions.some((a) => a.key === 'checkin-evening' && a.emphasis === 'secondary')).toBe(
      true,
    );
  });

  it('evening: the evening check-in becomes primary', async () => {
    const g = await getDailyGuidance(USER, TZ, MON_EVENING);
    expect(g.slot).toBe('evening');
    expect(g.actions[0]).toMatchObject({ key: 'checkin-evening', emphasis: 'primary' });
  });

  it('a submitted primary check-in renders as done (calm ack), not todo', async () => {
    vi.mocked(getCheckinStatus).mockResolvedValue({
      today: '2026-06-08',
      morningSubmitted: true,
      eveningSubmitted: true,
    });
    const g = await getDailyGuidance(USER, TZ, MON_MORNING);
    const morning = g.actions.find((a) => a.key === 'checkin-morning');
    expect(morning?.state).toBe('done');
    // the other (done) check-in is NOT repeated as a secondary todo
    expect(g.actions.some((a) => a.key === 'checkin-evening')).toBe(false);
  });
});

describe('getDailyGuidance — today calendar blocks', () => {
  it('generated calendar surfaces ONLY today’s blocks', async () => {
    vi.mocked(getQuestionnaireForUser).mockResolvedValue({ instrumentVersion: 1 } as never);
    vi.mocked(getCalendarForUser).mockResolvedValue(
      calendarWith([
        {
          date: '2026-06-08',
          blocks: [aBlock(), aBlock({ slot: 'evening', category: 'backtest' })],
        },
        { date: '2026-06-09', blocks: [aBlock({ label: 'Demain' })] },
      ]),
    );
    const g = await getDailyGuidance(USER, TZ, MON_MORNING);
    expect(g.calendarState).toBe('generated');
    expect(g.todayBlocks).toHaveLength(2);
    expect(g.todayBlocks.every((b) => b.label !== 'Demain')).toBe(true);
  });

  it('questionnaire filled but no calendar → preparing', async () => {
    vi.mocked(getQuestionnaireForUser).mockResolvedValue({ instrumentVersion: 1 } as never);
    vi.mocked(getCalendarForUser).mockResolvedValue(null);
    const g = await getDailyGuidance(USER, TZ, MON_MORNING);
    expect(g.calendarState).toBe('preparing');
    expect(g.todayBlocks).toHaveLength(0);
  });

  it('no questionnaire → calendarState "none" (questionnaire CTA delegated to its widget)', async () => {
    const g = await getDailyGuidance(USER, TZ, MON_MORNING);
    expect(g.calendarState).toBe('none');
    // The questionnaire CTA lives in CalendarStatusWidget below — never duplicated here.
    expect(g.actions.some((a) => a.kind === 'questionnaire')).toBe(false);
  });
});

describe('getDailyGuidance — meeting / mindset / douglas', () => {
  it('a meeting today names both scheduled slots', async () => {
    vi.mocked(listScheduledMeetingsOn).mockResolvedValue([
      { id: 'm1', slot: 'midday', scheduledAt: '2026-06-08T10:00:00Z' },
      { id: 'm2', slot: 'evening', scheduledAt: '2026-06-08T18:00:00Z' },
    ]);
    const g = await getDailyGuidance(USER, TZ, MON_MORNING);
    const meeting = g.actions.find((a) => a.kind === 'meeting');
    expect(meeting?.detail).toContain('analyse à 12h');
    expect(meeting?.detail).toContain('bilan à 20h');
  });

  it('a single scheduled slot is named alone (no phantom 12h when only the evening runs)', async () => {
    vi.mocked(listScheduledMeetingsOn).mockResolvedValue([
      { id: 'm2', slot: 'evening', scheduledAt: '2026-06-08T18:00:00Z' },
    ]);
    const g = await getDailyGuidance(USER, TZ, MON_MORNING);
    const meeting = g.actions.find((a) => a.kind === 'meeting');
    expect(meeting?.detail).toContain('bilan à 20h');
    expect(meeting?.detail).not.toContain('12h');
  });

  it('the weekly mindset QCM is emphasised on Monday', async () => {
    const g = await getDailyGuidance(USER, TZ, MON_MORNING);
    const mindset = g.actions.find((a) => a.kind === 'mindset');
    expect(mindset).toMatchObject({ emphasis: 'primary', state: 'todo' });
  });

  it('the mindset QCM is secondary on a non-Monday', async () => {
    const g = await getDailyGuidance(USER, TZ, TUE_MORNING);
    const mindset = g.actions.find((a) => a.kind === 'mindset');
    expect(mindset?.emphasis).toBe('secondary');
  });

  it('a submitted mindset check is NOT surfaced', async () => {
    vi.mocked(getMindsetCheck).mockResolvedValue({ id: 'mc1' } as never);
    const g = await getDailyGuidance(USER, TZ, MON_MORNING);
    expect(g.actions.some((a) => a.kind === 'mindset')).toBe(false);
  });

  it('the Mark Douglas inbox is NOT duplicated here (delegated to DouglasInboxWidget)', async () => {
    const g = await getDailyGuidance(USER, TZ, MON_MORNING);
    expect(g.actions.some((a) => a.kind === 'douglas')).toBe(false);
  });

  it('nothing pending → no todo action (calm "à jour" state)', async () => {
    vi.mocked(getCheckinStatus).mockResolvedValue({
      today: '2026-06-08',
      morningSubmitted: true,
      eveningSubmitted: true,
    });
    vi.mocked(getMindsetCheck).mockResolvedValue({ id: 'mc1' } as never);
    vi.mocked(getQuestionnaireForUser).mockResolvedValue({ instrumentVersion: 1 } as never);
    vi.mocked(getCalendarForUser).mockResolvedValue(
      calendarWith([{ date: '2026-06-08', blocks: [] }]),
    );
    const g = await getDailyGuidance(USER, TZ, MON_MORNING);
    expect(g.actions.some((a) => a.state === 'todo')).toBe(false);
  });
});

describe('getDailyGuidance — Paris anchoring + JSONB drift hardening (re-challenge #3)', () => {
  // 2026-06-09T03:00:00Z = 05:00 Paris (Tuesday 06-09) but 23:00 New York
  // (Monday 06-08). The calendar/meeting/mindset are Paris-keyed, so `today`
  // must follow Paris (06-09), NOT the member's NY day (06-08).
  const NY_NIGHT = new Date('2026-06-09T03:00:00Z');

  it('anchors today on Paris even for a non-Paris member (calendar is Paris-keyed)', async () => {
    vi.mocked(getQuestionnaireForUser).mockResolvedValue({ instrumentVersion: 1 } as never);
    vi.mocked(getCalendarForUser).mockResolvedValue(
      calendarWith([
        { date: '2026-06-08', blocks: [aBlock({ label: 'NY-day-Monday' })] },
        { date: '2026-06-09', blocks: [aBlock({ label: 'Paris-day-Tuesday' })] },
      ]),
    );
    const g = await getDailyGuidance(USER, 'America/New_York', NY_NIGHT);
    expect(g.today).toBe('2026-06-09'); // Paris civil day, not NY's 06-08
    expect(g.todayBlocks).toHaveLength(1);
    expect(g.todayBlocks[0]?.label).toBe('Paris-day-Tuesday');
  });

  it('does not crash if the persisted schedule.days drifted (not a 7-array)', async () => {
    vi.mocked(getQuestionnaireForUser).mockResolvedValue({ instrumentVersion: 1 } as never);
    // Simulate a drifted JSONB row (days missing) cast past the read boundary.
    vi.mocked(getCalendarForUser).mockResolvedValue({ schedule: {} } as never);
    const g = await getDailyGuidance(USER, TZ, MON_MORNING);
    expect(g.calendarState).toBe('generated');
    expect(g.todayBlocks).toEqual([]);
  });
});

describe('getDailyGuidance — S6 §32-2 (plan du jour consolidé : missed / timing / tracking)', () => {
  it('the morning check-in becomes a calm "missed" catch-up in the evening', async () => {
    // Evening slot, neither check-in submitted: the morning one's moment has
    // passed → `missed` (amber/rattrapable), never red — and stays secondary.
    const g = await getDailyGuidance(USER, TZ, MON_EVENING);
    const morning = g.actions.find((a) => a.key === 'checkin-morning');
    expect(morning?.state).toBe('missed');
    expect(morning?.emphasis).toBe('secondary');
    expect(morning?.detail).toMatch(/rattraper/i);
  });

  it('the morning check-in is plain "todo" (never missed) earlier in the day', async () => {
    const g = await getDailyGuidance(USER, TZ, MON_MORNING);
    expect(g.actions.find((a) => a.key === 'checkin-morning')?.state).toBe('todo');
    expect(g.actions.some((a) => a.state === 'missed')).toBe(false);
  });

  it('a submitted morning check-in is never "missed" in the evening', async () => {
    vi.mocked(getCheckinStatus).mockResolvedValue({
      today: '2026-06-08',
      morningSubmitted: true,
      eveningSubmitted: false,
    });
    const g = await getDailyGuidance(USER, TZ, MON_EVENING);
    // Done other-slot check-in is not repeated, so it is absent (not missed).
    expect(g.actions.some((a) => a.key === 'checkin-morning')).toBe(false);
    expect(g.actions.some((a) => a.state === 'missed')).toBe(false);
  });

  it('tags the FIRST pending action "current" and the SECOND "next"', async () => {
    // Monday morning, nothing submitted → pending = [checkin-morning, mindset, checkin-evening].
    const g = await getDailyGuidance(USER, TZ, MON_MORNING);
    const pending = g.actions.filter((a) => a.state === 'todo' || a.state === 'missed');
    expect(pending[0]?.timing).toBe('current');
    expect(pending[1]?.timing).toBe('next');
    expect(g.actions.filter((a) => a.timing === 'current')).toHaveLength(1);
    expect(g.actions.filter((a) => a.timing === 'next')).toHaveLength(1);
  });

  it('done / info actions never carry a timing marker', async () => {
    vi.mocked(listScheduledMeetingsOn).mockResolvedValue([
      { id: 'm2', slot: 'evening', scheduledAt: '2026-06-08T18:00:00Z' },
    ]);
    const g = await getDailyGuidance(USER, TZ, MON_MORNING);
    const meeting = g.actions.find((a) => a.kind === 'meeting');
    expect(meeting?.state).toBe('info');
    expect(meeting?.timing).toBeUndefined();
  });

  it('surfaces the TOP due tracking relevé as a calm secondary nudge', async () => {
    vi.mocked(getDueTrackingInstruments).mockResolvedValue(
      dueTracking(['process-fidelity', 'Fidélité à ton cadre']),
    );
    const g = await getDailyGuidance(USER, TZ, MON_MORNING);
    expect(g.actions.find((a) => a.kind === 'tracking')).toMatchObject({
      key: 'tracking-process-fidelity',
      title: 'Fidélité à ton cadre',
      href: '/tracking/process-fidelity',
      state: 'todo',
      emphasis: 'secondary',
    });
  });

  it('surfaces ONLY the top due relevé even when several are due (no entassement, §31.2)', async () => {
    vi.mocked(getDueTrackingInstruments).mockResolvedValue(
      dueTracking(['a', 'Relevé A'], ['b', 'Relevé B'], ['c', 'Relevé C']),
    );
    const g = await getDailyGuidance(USER, TZ, MON_MORNING);
    const tracking = g.actions.filter((a) => a.kind === 'tracking');
    expect(tracking).toHaveLength(1);
    expect(tracking[0]?.key).toBe('tracking-a');
  });

  it('no tracking action when nothing is due', async () => {
    const g = await getDailyGuidance(USER, TZ, MON_MORNING);
    expect(g.actions.some((a) => a.kind === 'tracking')).toBe(false);
  });
});
