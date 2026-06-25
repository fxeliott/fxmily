import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * S3 §33 « micro-relance avant l'alerte » — DoD #4 trap case (« et non au
 * premier oubli, qui passe par la micro-relance »). Proves the gentle nudge is
 * sent EXACTLY once on an isolated below-threshold gap, is left to the alert
 * path once the gap reaches the repetition threshold (complementary, no
 * double-touch), is idempotent per gap, and never stamps on a failed enqueue.
 * Scan runs REAL; db / audit / observability / notifications are mocked.
 */

vi.mock('@/lib/db', () => ({
  db: {
    user: { findMany: vi.fn() },
    discrepancy: { findMany: vi.fn(), update: vi.fn() },
  },
}));
vi.mock('@/lib/auth/audit', () => ({ logAudit: vi.fn() }));
vi.mock('@/lib/observability', () => ({ reportError: vi.fn(), reportWarning: vi.fn() }));
vi.mock('@/lib/notifications/enqueue', () => ({
  enqueueDouglasDeliveryNotification: vi.fn().mockResolvedValue(null),
  enqueueGentleVerificationReminder: vi.fn().mockResolvedValue('notif-1'),
}));

import { db } from '@/lib/db';
import { enqueueGentleVerificationReminder } from '@/lib/notifications/enqueue';

import { scanGentleRemindersForAllMembers } from './alerts';

const NOW = new Date('2026-06-25T10:00:00.000Z');

/**
 * Arm one member. `fresh` = the never-reminded unexcused gaps the first query
 * returns; `allUnexcused` = the full unexcused set the second query returns (the
 * repetition state). When `fresh` is empty the scan returns before the second
 * query, so `allUnexcused` is only consumed when there is fresh work.
 */
function arm(fresh: Array<{ id: string; type: string }>, allUnexcused: Array<{ type: string }>) {
  vi.mocked(db.user.findMany).mockResolvedValue([{ id: 'member-1' }] as never);
  vi.mocked(db.discrepancy.findMany)
    .mockResolvedValueOnce(fresh as never)
    .mockResolvedValueOnce(allUnexcused as never);
  vi.mocked(db.discrepancy.update).mockResolvedValue({ id: 'x' } as never);
}

describe('scanGentleRemindersForAllMembers — micro-relance (S3 §33 / DoD #4)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(enqueueGentleVerificationReminder).mockResolvedValue('notif-1');
  });

  it('🟢 1 oubli isolé sous le seuil → EXACTEMENT 1 micro-relance + stamp, AUCUNE alerte', async () => {
    arm([{ id: 'd1', type: 'unfilled_no_reason' }], [{ type: 'unfilled_no_reason' }]);
    const r = await scanGentleRemindersForAllMembers({ now: NOW });

    expect(r.remindersSent).toBe(1);
    expect(enqueueGentleVerificationReminder).toHaveBeenCalledTimes(1);
    expect(enqueueGentleVerificationReminder).toHaveBeenCalledWith('member-1', {
      discrepancyId: 'd1',
    });
    // Stamped once → never re-nudged (the WHERE gentleReminderAt:null filters it out next run).
    expect(db.discrepancy.update).toHaveBeenCalledWith({
      where: { id: 'd1' },
      data: { gentleReminderAt: NOW },
    });
  });

  it("🛑 gap AU seuil de répétition → PAS de micro-relance (l'alerte le gère, pas de double-touch)", async () => {
    // 2 × false_declared = threshold of `false_declaration_repeat` (2) → alert
    // territory. The fresh one must NOT also get a gentle nudge.
    arm(
      [{ id: 'd3', type: 'false_declared' }],
      [{ type: 'false_declared' }, { type: 'false_declared' }],
    );
    const r = await scanGentleRemindersForAllMembers({ now: NOW });

    expect(r.remindersSent).toBe(0);
    expect(enqueueGentleVerificationReminder).not.toHaveBeenCalled();
    expect(db.discrepancy.update).not.toHaveBeenCalled();
  });

  it('🔁 aucun gap frais (déjà relancés) → 0 relance, 0 requête de répétition', async () => {
    // The `gentleReminderAt: null` filter yields nothing → early return.
    vi.mocked(db.user.findMany).mockResolvedValue([{ id: 'member-1' }] as never);
    vi.mocked(db.discrepancy.findMany).mockResolvedValueOnce([] as never);
    const r = await scanGentleRemindersForAllMembers({ now: NOW });

    expect(r.remindersSent).toBe(0);
    expect(enqueueGentleVerificationReminder).not.toHaveBeenCalled();
    // Only the fresh query ran; the repetition query is skipped.
    expect(db.discrepancy.findMany).toHaveBeenCalledTimes(1);
  });

  it('⚠️ enqueue échoue (best-effort null) → PAS de stamp (retry au prochain scan, jamais perdu)', async () => {
    arm([{ id: 'd1', type: 'unfilled_no_reason' }], [{ type: 'unfilled_no_reason' }]);
    vi.mocked(enqueueGentleVerificationReminder).mockResolvedValue(null);
    const r = await scanGentleRemindersForAllMembers({ now: NOW });

    expect(r.remindersSent).toBe(0);
    expect(db.discrepancy.update).not.toHaveBeenCalled();
  });

  it('🟢 deux gaps frais distincts sous le seuil → une relance chacun (≤1 par écart)', async () => {
    // 1 unfilled + 1 missing_declared, each below its own rule threshold (3).
    arm(
      [
        { id: 'd1', type: 'unfilled_no_reason' },
        { id: 'd2', type: 'missing_declared' },
      ],
      [{ type: 'unfilled_no_reason' }, { type: 'missing_declared' }],
    );
    const r = await scanGentleRemindersForAllMembers({ now: NOW });

    expect(r.remindersSent).toBe(2);
    expect(enqueueGentleVerificationReminder).toHaveBeenCalledTimes(2);
  });
});
