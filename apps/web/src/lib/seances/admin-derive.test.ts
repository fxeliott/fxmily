import { describe, expect, it } from 'vitest';

import {
  ADMIN_SEANCE_HORIZON_DAYS,
  derivePipelineStatus,
  formatSyncedAtLabel,
  futureSeanceCells,
  isWeekendDate,
  normalizeSeanceTime,
  planSeanceGoNoGo,
  seanceTimeToInputValue,
  seanceToday,
  type PipelineStatusInput,
} from './admin-derive';

/**
 * The load-bearing FSM + pipeline-status derivation for `/admin/seances` (J3),
 * tested PURE (no DB). Ported guards mirror the static hub `state.mjs`
 * (declareGoNoGo) + `generate.mjs` (pipelineState / rowBadge).
 */

const IDLE: PipelineStatusInput = {
  status: 'scheduled',
  cpMp4: false,
  cpVimeo: false,
  cpTranscript: false,
  cpAi: false,
  cpDeployed: false,
  vimeoProcessing: false,
  transcriptPending: false,
  contentNeedsReview: false,
  pipelineFailedStep: null,
};

describe('planSeanceGoNoGo — go/no-go FSM guards', () => {
  it('creates a new row for today/future (no existing row)', () => {
    for (const target of ['scheduled', 'done', 'cancelled'] as const) {
      const d = planSeanceGoNoGo({ existingStatus: null, target, isPastDate: false });
      expect(d).toEqual({ ok: true, mode: 'create', wipeContent: false });
    }
  });

  it('REFUSES backfill: a brand-new row on a past day', () => {
    const d = planSeanceGoNoGo({ existingStatus: null, target: 'done', isPastDate: true });
    expect(d).toEqual({ ok: false, reason: 'backfill' });
  });

  it('REFUSES no-rewind: a held (done) session back to scheduled', () => {
    const d = planSeanceGoNoGo({ existingStatus: 'done', target: 'scheduled', isPastDate: false });
    expect(d).toEqual({ ok: false, reason: 'no_rewind' });
  });

  it('reinstate cancelled → scheduled WIPES stale content (closes the resurface path)', () => {
    // A cancelled slot that was previously `done` still holds its old content;
    // leaving cancelled for `scheduled` must wipe it, else `done → cancelled →
    // scheduled → done` resurfaces a stale analysis (a later scheduled → done
    // does NOT wipe). Regression guard for the FSM defect.
    const d = planSeanceGoNoGo({
      existingStatus: 'cancelled',
      target: 'scheduled',
      isPastDate: false,
    });
    expect(d).toEqual({ ok: true, mode: 'update', wipeContent: true });
  });

  it('allows the scheduled → scheduled no-op', () => {
    const d = planSeanceGoNoGo({
      existingStatus: 'scheduled',
      target: 'scheduled',
      isPastDate: false,
    });
    expect(d).toEqual({ ok: true, mode: 'update', wipeContent: false });
  });

  it('reinstate cancelled → done WIPES stale content', () => {
    const d = planSeanceGoNoGo({ existingStatus: 'cancelled', target: 'done', isPastDate: false });
    expect(d).toEqual({ ok: true, mode: 'update', wipeContent: true });
  });

  it('depublish done → cancelled keeps content (no wipe)', () => {
    const d = planSeanceGoNoGo({ existingStatus: 'done', target: 'cancelled', isPastDate: false });
    expect(d).toEqual({ ok: true, mode: 'update', wipeContent: false });
  });

  it('publish scheduled → done does not wipe', () => {
    const d = planSeanceGoNoGo({ existingStatus: 'scheduled', target: 'done', isPastDate: false });
    expect(d).toEqual({ ok: true, mode: 'update', wipeContent: false });
  });

  it('allows acting on an EXISTING past row (cancel a past scheduled slot)', () => {
    const d = planSeanceGoNoGo({
      existingStatus: 'scheduled',
      target: 'cancelled',
      isPastDate: true,
    });
    expect(d).toEqual({ ok: true, mode: 'update', wipeContent: false });
  });
});

describe('normalizeSeanceTime / seanceTimeToInputValue', () => {
  it('normalises HH:MM → HHhMM', () => {
    expect(normalizeSeanceTime('12:00')).toBe('12h00');
    expect(normalizeSeanceTime('09:05')).toBe('09h05');
    expect(normalizeSeanceTime('23:59')).toBe('23h59');
    expect(normalizeSeanceTime('00:00')).toBe('00h00');
  });

  it('rejects malformed/empty input → null', () => {
    expect(normalizeSeanceTime('')).toBeNull();
    expect(normalizeSeanceTime(null)).toBeNull();
    expect(normalizeSeanceTime(undefined)).toBeNull();
    expect(normalizeSeanceTime('25:00')).toBeNull();
    expect(normalizeSeanceTime('12:60')).toBeNull();
    expect(normalizeSeanceTime('abc')).toBeNull();
    expect(normalizeSeanceTime('12h00')).toBeNull();
  });

  it('inverts back to the input form (round-trip)', () => {
    expect(seanceTimeToInputValue('12h00')).toBe('12:00');
    expect(seanceTimeToInputValue('09h05')).toBe('09:05');
    expect(seanceTimeToInputValue(null)).toBe('');
    expect(seanceTimeToInputValue('')).toBe('');
    expect(seanceTimeToInputValue('garbage')).toBe('');
  });
});

describe('derivePipelineStatus — badge + steps (jamais d’échec silencieux)', () => {
  it('all-idle → "en attente", every step idle, hasData false', () => {
    const p = derivePipelineStatus(IDLE);
    expect(p.badge).toBe('attente');
    expect(p.hasData).toBe(false);
    expect(p.steps.every((s) => s.state === 'idle')).toBe(true);
    // The first not-done step carries aria-current.
    expect(p.steps[0]?.current).toBe(true);
    expect(p.steps.filter((s) => s.current)).toHaveLength(1);
  });

  it('all checkpoints done → "publié"', () => {
    const p = derivePipelineStatus({
      ...IDLE,
      status: 'done',
      cpMp4: true,
      cpVimeo: true,
      cpTranscript: true,
      cpAi: true,
      cpDeployed: true,
    });
    expect(p.badge).toBe('publie');
    expect(p.steps.every((s) => s.state === 'done')).toBe(true);
    expect(p.steps.some((s) => s.current)).toBe(false);
  });

  it('partial progress → "en cours", first not-done step is current', () => {
    const p = derivePipelineStatus({ ...IDLE, status: 'done', cpMp4: true });
    expect(p.badge).toBe('encours');
    expect(p.hasData).toBe(true);
    expect(p.steps[0]?.state).toBe('done');
    expect(p.steps[1]?.current).toBe(true); // vimeo is the next not-done step
  });

  it('an ingestion failure → "à relancer", that step is failed', () => {
    const p = derivePipelineStatus({ ...IDLE, status: 'done', pipelineFailedStep: 'vimeo' });
    expect(p.badge).toBe('relancer');
    expect(p.steps.find((s) => s.key === 'vimeo')?.state).toBe('failed');
    expect(p.deadLetter).toBe(false);
  });

  it('contentNeedsReview → "à régénérer", ai failed, deadLetter true', () => {
    const p = derivePipelineStatus({ ...IDLE, status: 'done', contentNeedsReview: true });
    expect(p.badge).toBe('regenerer');
    expect(p.steps.find((s) => s.key === 'ai')?.state).toBe('failed');
    expect(p.deadLetter).toBe(true);
  });

  it('an ai-step failure also counts as a dead-letter → "à régénérer"', () => {
    const p = derivePipelineStatus({ ...IDLE, status: 'done', pipelineFailedStep: 'ai' });
    expect(p.badge).toBe('regenerer');
    expect(p.deadLetter).toBe(true);
  });

  it('cancelled status overrides any progress → "annulée"', () => {
    const p = derivePipelineStatus({
      ...IDLE,
      status: 'cancelled',
      cpMp4: true,
      cpVimeo: true,
    });
    expect(p.badge).toBe('cancelled');
  });

  it('reflects vimeoProcessing (active) + transcriptPending (pending)', () => {
    const p = derivePipelineStatus({
      ...IDLE,
      status: 'done',
      vimeoProcessing: true,
      transcriptPending: true,
    });
    expect(p.steps.find((s) => s.key === 'vimeo')?.state).toBe('active');
    expect(p.steps.find((s) => s.key === 'transcript')?.state).toBe('pending');
    expect(p.hasData).toBe(true);
  });
});

describe('futureSeanceCells / isWeekendDate', () => {
  it('flags weekends', () => {
    expect(isWeekendDate('2026-07-04')).toBe(true); // Saturday
    expect(isWeekendDate('2026-07-05')).toBe(true); // Sunday
    expect(isWeekendDate('2026-06-29')).toBe(false); // Monday
  });

  it('emits both slots for weekdays only, never a weekend', () => {
    const cells = futureSeanceCells('2026-06-29'); // a Monday
    expect(cells.length).toBeGreaterThan(0);
    // No weekend date ever appears.
    expect(cells.every((c) => !isWeekendDate(c.date))).toBe(true);
    // Each surfaced day carries exactly its two slots.
    const byDate = new Map<string, Set<string>>();
    for (const c of cells) {
      const set = byDate.get(c.date) ?? new Set();
      set.add(c.slot);
      byDate.set(c.date, set);
    }
    for (const slots of byDate.values()) {
      expect([...slots].sort()).toEqual(['analyse', 'debrief']);
    }
    // Horizon is inclusive of today + ADMIN_SEANCE_HORIZON_DAYS days.
    const maxOffsetDate = '2026-07-13'; // 2026-06-29 + 14 (a Monday)
    expect(cells.some((c) => c.date === maxOffsetDate)).toBe(true);
    expect(ADMIN_SEANCE_HORIZON_DAYS).toBe(14);
  });
});

describe('seanceToday — Europe/Paris civil day', () => {
  it('maps a morning UTC instant to the same Paris day', () => {
    // 2026-06-30T07:14:00Z = 09:14 Paris (CEST +2).
    expect(seanceToday(new Date('2026-06-30T07:14:00.000Z'))).toBe('2026-06-30');
  });

  it('rolls to the next Paris day after 22:00 UTC in summer', () => {
    // 2026-06-30T22:30:00Z = 00:30 Paris next day (CEST +2).
    expect(seanceToday(new Date('2026-06-30T22:30:00.000Z'))).toBe('2026-07-01');
  });
});

describe('formatSyncedAtLabel — J4 sync freshness (defect #2 made visible)', () => {
  it('formats an instant as "JJ/MM à HHhMM" in Europe/Paris', () => {
    // 2026-06-30T20:46:00Z = 22:46 Paris (CEST +2).
    expect(formatSyncedAtLabel('2026-06-30T20:46:00.000Z')).toBe('30/06 à 22h46');
  });

  it('returns null for a null/empty/unparseable input', () => {
    expect(formatSyncedAtLabel(null)).toBeNull();
    expect(formatSyncedAtLabel(undefined)).toBeNull();
    expect(formatSyncedAtLabel('not-a-date')).toBeNull();
  });
});
