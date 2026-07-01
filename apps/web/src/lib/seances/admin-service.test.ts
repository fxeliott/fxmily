/**
 * Réunion hub (séances) — ADMIN write-path tests (Prisma-mocked), mirror of
 * `lib/meeting/service.test.ts`. Pins the DB-aware surface of `/admin/seances`
 * that the pure planner (`admin-derive.planSeanceGoNoGo`, unit-tested apart)
 * cannot prove: that `declareSeanceGoNoGo` actually WRITES what the decision
 * says, and — critically — that reinstating a `cancelled` slot runs the
 * destructive wipe transaction (deleteMany assets/messages + null EVERY stale
 * editorial/checkpoint/pipeline field, incl. the `pipelineSyncedAt` stamp) so no
 * outdated analysis can resurface as "à jour" (Règle n°1). Plus the no-backfill /
 * no-rewind HARD guards and `requestSeanceRegeneration`.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/db', () => ({
  db: {
    replaySession: { findUnique: vi.fn(), create: vi.fn(), update: vi.fn() },
    replayAsset: { deleteMany: vi.fn() },
    replayMessage: { deleteMany: vi.fn() },
    $transaction: vi.fn(),
  },
}));

import { parseLocalDate } from '@/lib/checkin/timezone';
import { db } from '@/lib/db';
import { safeFreeText } from '@/lib/text/safe';

import {
  declareSeanceGoNoGo,
  requestSeanceRegeneration,
  SeanceGoNoGoError,
  SeanceRegenerateError,
} from './admin-service';
import { deriveSeanceTitle } from './derive';

/** 2026-07-01 14:00 Paris (CEST, UTC+2) → seanceToday() = "2026-07-01". */
const NOW = new Date('2026-07-01T12:00:00.000Z');

/** A transaction client whose ops are spies; `$transaction(fn)` runs `fn(tx)`. */
function stubTransaction() {
  const tx = {
    replayAsset: { deleteMany: vi.fn() },
    replayMessage: { deleteMany: vi.fn() },
    replaySession: { update: vi.fn() },
  };
  vi.mocked(db.$transaction).mockImplementation((async (fn: (client: unknown) => unknown) =>
    fn(tx)) as never);
  return tx;
}

beforeEach(() => {
  vi.resetAllMocks();
});

describe('declareSeanceGoNoGo — create (no-backfill floor)', () => {
  it('creates a brand-new row for TODAY with derived title + normalised time', async () => {
    vi.mocked(db.replaySession.findUnique).mockResolvedValue(null as never);

    const res = await declareSeanceGoNoGo(
      { date: '2026-07-01', slot: 'analyse', status: 'scheduled', time: '12:00' },
      NOW,
    );

    expect(res).toEqual({ date: '2026-07-01', slot: 'analyse', status: 'scheduled' });
    expect(db.replaySession.create).toHaveBeenCalledTimes(1);
    const arg = vi.mocked(db.replaySession.create).mock.calls[0]![0] as {
      data: Record<string, unknown>;
    };
    expect(arg.data.date).toEqual(parseLocalDate('2026-07-01'));
    expect(arg.data.slot).toBe('analyse');
    expect(arg.data.status).toBe('scheduled');
    expect(arg.data.title).toBe(deriveSeanceTitle('2026-07-01', 'analyse'));
    expect(arg.data.time).toBe('12h00'); // "12:00" → canonical "12h00"
    expect(arg.data.cancelReason).toBeNull();
  });

  it('creates a FUTURE row too (floor = today, not "only today")', async () => {
    vi.mocked(db.replaySession.findUnique).mockResolvedValue(null as never);

    await declareSeanceGoNoGo(
      { date: '2026-07-13', slot: 'debrief', status: 'scheduled', time: '20:00' },
      NOW,
    );

    const arg = vi.mocked(db.replaySession.create).mock.calls[0]![0] as {
      data: Record<string, unknown>;
    };
    expect(arg.data.date).toEqual(parseLocalDate('2026-07-13'));
    expect(arg.data.time).toBe('20h00');
  });

  it('REFUSES creating a PAST row — no-backfill → SeanceGoNoGoError("backfill"), 0 write', async () => {
    vi.mocked(db.replaySession.findUnique).mockResolvedValue(null as never);

    await expect(
      declareSeanceGoNoGo({ date: '2026-06-20', slot: 'analyse', status: 'scheduled' }, NOW),
    ).rejects.toMatchObject({ name: 'SeanceGoNoGoError', reason: 'backfill' });

    await expect(
      declareSeanceGoNoGo({ date: '2026-06-20', slot: 'analyse', status: 'scheduled' }, NOW),
    ).rejects.toBeInstanceOf(SeanceGoNoGoError);
    expect(db.replaySession.create).not.toHaveBeenCalled();
    expect(db.replaySession.update).not.toHaveBeenCalled();
  });
});

describe('declareSeanceGoNoGo — update guards', () => {
  it('REFUSES a no-rewind (done → scheduled) → SeanceGoNoGoError("no_rewind"), 0 write', async () => {
    vi.mocked(db.replaySession.findUnique).mockResolvedValue({
      id: 's1',
      status: 'done',
    } as never);

    await expect(
      declareSeanceGoNoGo({ date: '2026-07-01', slot: 'analyse', status: 'scheduled' }, NOW),
    ).rejects.toMatchObject({ reason: 'no_rewind' });
    expect(db.replaySession.update).not.toHaveBeenCalled();
    expect(db.$transaction).not.toHaveBeenCalled();
  });

  it('simple update (scheduled → cancelled) writes status + sanitised reason, NO wipe', async () => {
    vi.mocked(db.replaySession.findUnique).mockResolvedValue({
      id: 's1',
      status: 'scheduled',
    } as never);

    await declareSeanceGoNoGo(
      { date: '2026-07-01', slot: 'debrief', status: 'cancelled', reason: 'météo' },
      NOW,
    );

    expect(db.$transaction).not.toHaveBeenCalled();
    expect(db.replaySession.update).toHaveBeenCalledTimes(1);
    const arg = vi.mocked(db.replaySession.update).mock.calls[0]![0] as {
      where: unknown;
      data: Record<string, unknown>;
    };
    expect(arg.where).toEqual({ id: 's1' });
    expect(arg.data.status).toBe('cancelled');
    expect(arg.data.cancelReason).toBe(safeFreeText('météo'));
    // No `time` supplied → the key is omitted (keeps the stored value).
    expect('time' in arg.data).toBe(false);
  });
});

describe('declareSeanceGoNoGo — reinstate wipe (Règle n°1: no stale "à jour")', () => {
  it('cancelled → done wipes assets + messages + EVERY stale field in ONE transaction', async () => {
    const tx = stubTransaction();
    vi.mocked(db.replaySession.findUnique).mockResolvedValue({
      id: 's1',
      status: 'cancelled',
    } as never);

    const res = await declareSeanceGoNoGo(
      { date: '2026-07-01', slot: 'analyse', status: 'done', time: '12:00' },
      NOW,
    );

    expect(res).toEqual({ date: '2026-07-01', slot: 'analyse', status: 'done' });
    expect(db.$transaction).toHaveBeenCalledTimes(1);
    // The non-cascading deletes are LOAD-BEARING (wipe is an UPDATE, not a DELETE).
    expect(tx.replayAsset.deleteMany).toHaveBeenCalledWith({ where: { sessionId: 's1' } });
    expect(tx.replayMessage.deleteMany).toHaveBeenCalledWith({ where: { sessionId: 's1' } });
    // Never the top-level client — the wipe MUST be atomic via the tx client.
    expect(db.replaySession.update).not.toHaveBeenCalled();

    const upd = tx.replaySession.update.mock.calls[0]![0] as {
      where: unknown;
      data: Record<string, unknown>;
    };
    expect(upd.where).toEqual({ id: 's1' });
    expect(upd.data.status).toBe('done');
    expect(upd.data.time).toBe('12h00');
    // No-null-leak: content, checkpoints, vimeo, transcript, pipeline all reset.
    const nulled = [
      'cancelReason',
      'summary',
      'duration',
      'vimeoId',
      'vimeoHash',
      'vimeoEmbedUrl',
      'transcriptSource',
      'transcriptLang',
      'contentModel',
      'pipelineFailedStep',
      'pipelineFailedError',
      'pipelineSyncedAt', // the stamp whose stale value would lie "Synchronisé …"
    ];
    for (const key of nulled) expect(upd.data[key], `${key} must be null`).toBeNull();

    const falsed = [
      'vimeoProcessing',
      'transcriptPending',
      'contentGenerated',
      'contentNeedsReview',
      'cpMp4',
      'cpVimeo',
      'cpTranscript',
      'cpAi',
      'cpDeployed',
    ];
    for (const key of falsed) expect(upd.data[key], `${key} must be false`).toBe(false);

    expect(upd.data.keyTakeaways).toEqual([]);
  });

  it('cancelled → scheduled ALSO wipes (closes done→cancelled→scheduled→done resurfacing)', async () => {
    const tx = stubTransaction();
    vi.mocked(db.replaySession.findUnique).mockResolvedValue({
      id: 's2',
      status: 'cancelled',
    } as never);

    await declareSeanceGoNoGo({ date: '2026-07-01', slot: 'analyse', status: 'scheduled' }, NOW);

    expect(db.$transaction).toHaveBeenCalledTimes(1);
    expect(tx.replayAsset.deleteMany).toHaveBeenCalledWith({ where: { sessionId: 's2' } });
    const upd = tx.replaySession.update.mock.calls[0]![0] as { data: Record<string, unknown> };
    expect(upd.data.status).toBe('scheduled');
    expect(upd.data.contentGenerated).toBe(false);
    expect(upd.data.pipelineSyncedAt).toBeNull();
  });
});

describe('requestSeanceRegeneration', () => {
  it('re-arms the AI step on a held session (clears cpAi/contentGenerated + failure)', async () => {
    vi.mocked(db.replaySession.findUnique).mockResolvedValue({
      id: 's1',
      status: 'done',
    } as never);

    await requestSeanceRegeneration('2026-07-01', 'analyse');

    expect(db.replaySession.update).toHaveBeenCalledTimes(1);
    const arg = vi.mocked(db.replaySession.update).mock.calls[0]![0] as {
      where: unknown;
      data: Record<string, unknown>;
    };
    expect(arg.where).toEqual({ id: 's1' });
    expect(arg.data).toEqual({
      cpAi: false,
      contentGenerated: false,
      contentNeedsReview: false,
      pipelineFailedStep: null,
      pipelineFailedError: null,
    });
  });

  it('REFUSES a missing target → SeanceRegenerateError("not_found")', async () => {
    vi.mocked(db.replaySession.findUnique).mockResolvedValue(null as never);

    await expect(requestSeanceRegeneration('2026-07-01', 'analyse')).rejects.toMatchObject({
      name: 'SeanceRegenerateError',
      reason: 'not_found',
    });
    expect(db.replaySession.update).not.toHaveBeenCalled();
  });

  it('REFUSES a non-held target (status !== done) → SeanceRegenerateError("not_done")', async () => {
    vi.mocked(db.replaySession.findUnique).mockResolvedValue({
      id: 's1',
      status: 'scheduled',
    } as never);

    await expect(requestSeanceRegeneration('2026-07-01', 'analyse')).rejects.toBeInstanceOf(
      SeanceRegenerateError,
    );
    await expect(requestSeanceRegeneration('2026-07-01', 'analyse')).rejects.toMatchObject({
      reason: 'not_done',
    });
    expect(db.replaySession.update).not.toHaveBeenCalled();
  });
});
