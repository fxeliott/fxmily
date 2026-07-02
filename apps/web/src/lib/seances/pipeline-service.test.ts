import { beforeEach, describe, expect, it, vi } from 'vitest';

import { CANONICAL_ASSETS } from './pipeline-canonical';
import {
  seancePipelinePersistSchema,
  type SeancePipelinePersistInput,
} from '@/lib/schemas/seance-pipeline';

/**
 * Réunion hub (séances) J4 — writer + pull gates. `@/lib/db` mocked (branching
 * logic, not Postgres). `parseLocalDate` + `assembleSeanceContent` run REAL
 * (pure). Proves: the no-backfill / not-done skips, the Règle n°1 invalid_output
 * gate, identity injection through to the create payload, the always-on
 * `pipelineSyncedAt` stamp, and the content-less preserve branch.
 */

const m = vi.hoisted(() => ({
  sessionFindUnique: vi.fn(),
  sessionFindMany: vi.fn(),
  sessionUpdate: vi.fn(),
  logAudit: vi.fn(),
  reportError: vi.fn(),
}));

vi.mock('@/lib/db', () => ({
  db: {
    replaySession: {
      findUnique: m.sessionFindUnique,
      findMany: m.sessionFindMany,
      update: m.sessionUpdate,
    },
  },
}));

vi.mock('@/lib/auth/audit', () => ({ logAudit: m.logAudit }));
vi.mock('@/lib/observability', () => ({
  reportError: m.reportError,
  reportWarning: vi.fn(),
}));

import { loadSeancePipelineEnvelope, persistSeancePipelineResults } from './pipeline-service';

function validContentBlock() {
  return {
    summary: 'Fil conducteur du matin.',
    keyTakeaways: ['Point A'],
    contentModel: 'claude-opus-4-8',
    assets: CANONICAL_ASSETS.map((a) => ({
      symbol: a.symbol,
      bias: 'neutre' as const,
      levels: [{ label: 'Support', value: '1.0800' }],
      reading: [`Lecture ${a.symbol}.`],
    })),
    messages: CANONICAL_ASSETS.map((a) => ({ asset: a.symbol, text: `${a.symbol} : RAS.` })),
  };
}

/** Parse through the real schema so the service receives a well-formed input. */
function payload(over: Record<string, unknown> = {}): SeancePipelinePersistInput {
  return seancePipelinePersistSchema.parse({
    sessions: [
      {
        date: '2026-06-30',
        slot: 'analyse',
        checkpoints: { mp4: false, vimeo: false, transcript: false, ai: false, deployed: false },
        ...over,
      },
    ],
  });
}

const heldContentPayload = (): SeancePipelinePersistInput =>
  payload({
    checkpoints: { mp4: true, vimeo: true, transcript: true, ai: true, deployed: true },
    durationSec: 3600,
    vimeo: { id: '123456', hash: 'abc123', processing: false },
    transcript: { source: 'fathom', lang: 'fr', pending: false },
    content: validContentBlock(),
  });

beforeEach(() => {
  vi.clearAllMocks();
  m.sessionUpdate.mockResolvedValue({});
});

describe('persistSeancePipelineResults — gates', () => {
  it('skips an undeclared session (no-backfill: pipeline never creates a row)', async () => {
    m.sessionFindUnique.mockResolvedValue(null);
    const res = await persistSeancePipelineResults(heldContentPayload());
    expect(res).toEqual({ persisted: 0, skipped: 1, errors: 0 });
    expect(m.sessionUpdate).not.toHaveBeenCalled();
    expect(m.logAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'seance.batch.skipped',
        metadata: expect.objectContaining({ reason: 'not_declared' }),
      }),
    );
  });

  it('skips a non-done (scheduled/cancelled) session — never publishes content', async () => {
    m.sessionFindUnique.mockResolvedValue({ id: 's1', status: 'scheduled' });
    const res = await persistSeancePipelineResults(heldContentPayload());
    expect(res).toEqual({ persisted: 0, skipped: 1, errors: 0 });
    expect(m.sessionUpdate).not.toHaveBeenCalled();
    expect(m.logAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'seance.batch.skipped',
        metadata: expect.objectContaining({ reason: 'not_done' }),
      }),
    );
  });

  it('rejects content that fails Règle n°1 (emoji) → invalid_output, no write', async () => {
    m.sessionFindUnique.mockResolvedValue({ id: 's1', status: 'done' });
    const bad = heldContentPayload();
    // mutate the parsed payload's summary to carry an emoji
    (bad.sessions[0]!.content as { summary: string }).summary = 'Bon plan 🚀.';
    const res = await persistSeancePipelineResults(bad);
    expect(res).toEqual({ persisted: 0, skipped: 0, errors: 1 });
    expect(m.sessionUpdate).not.toHaveBeenCalled();
    expect(m.logAudit).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'seance.batch.invalid_output' }),
    );
  });
});

describe('persistSeancePipelineResults — write', () => {
  it('writes the editorial content + injects identities + stamps pipelineSyncedAt', async () => {
    m.sessionFindUnique.mockResolvedValue({ id: 's1', status: 'done' });
    const res = await persistSeancePipelineResults(heldContentPayload());
    expect(res).toEqual({ persisted: 1, skipped: 0, errors: 0 });

    expect(m.sessionUpdate).toHaveBeenCalledTimes(1);
    const arg = m.sessionUpdate.mock.calls[0]![0] as {
      where: { id: string };
      data: Record<string, unknown>;
    };
    expect(arg.where).toEqual({ id: 's1' });
    expect(arg.data.summary).toBe('Fil conducteur du matin.');
    expect(arg.data.contentGenerated).toBe(true);
    expect(arg.data.pipelineSyncedAt).toBeInstanceOf(Date);

    const assetsCreate = (arg.data.assets as { create: Array<Record<string, unknown>> }).create;
    const messagesCreate = (arg.data.messages as { create: Array<Record<string, unknown>> }).create;
    expect(assetsCreate).toHaveLength(6);
    expect(messagesCreate).toHaveLength(6);

    // Règle n°1: DXY identity injected from canon (name + macro), position 5.
    const dxy = assetsCreate.find((a) => a.symbol === 'DXY')!;
    expect(dxy.name).toBe('Indice dollar');
    expect(dxy.macro).toBe(true);
    expect(dxy.position).toBe(5);
  });

  it('content-less sync preserves editorial state (no assets/messages write) but still stamps sync', async () => {
    m.sessionFindUnique.mockResolvedValue({ id: 's1', status: 'done' });
    const res = await persistSeancePipelineResults(
      payload({
        checkpoints: { mp4: true, vimeo: false, transcript: false, ai: false, deployed: false },
      }),
    );
    expect(res).toEqual({ persisted: 1, skipped: 0, errors: 0 });
    const arg = m.sessionUpdate.mock.calls[0]![0] as { data: Record<string, unknown> };
    expect(arg.data.assets).toBeUndefined();
    expect(arg.data.messages).toBeUndefined();
    expect(arg.data.summary).toBeUndefined();
    expect(arg.data.contentGenerated).toBe(false);
    expect(arg.data.cpMp4).toBe(true);
    expect(arg.data.pipelineSyncedAt).toBeInstanceOf(Date);
  });

  it('records a persist_failed error without aborting the batch', async () => {
    m.sessionFindUnique.mockResolvedValue({ id: 's1', status: 'done' });
    m.sessionUpdate.mockRejectedValueOnce(new Error('db down'));
    const res = await persistSeancePipelineResults(heldContentPayload());
    expect(res).toEqual({ persisted: 0, skipped: 0, errors: 1 });
    expect(m.logAudit).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'seance.batch.persist_failed' }),
    );
    expect(m.reportError).toHaveBeenCalled();
  });
});

describe('loadSeancePipelineEnvelope — pull', () => {
  it('maps declared rows to the PII-free envelope + audits the pull', async () => {
    m.sessionFindMany.mockResolvedValue([
      {
        date: new Date('2026-06-30T00:00:00.000Z'),
        slot: 'analyse',
        status: 'done',
        title: 'Analyse du 30 juin',
        time: '12h00',
        cancelReason: null,
        cpMp4: true,
        cpVimeo: true,
        cpTranscript: true,
        cpAi: true,
        cpDeployed: false,
        contentNeedsReview: false,
        contentGenerated: true,
        pipelineSyncedAt: new Date('2026-06-30T20:46:00.000Z'),
      },
      {
        date: new Date('2026-06-29T00:00:00.000Z'),
        slot: 'debrief',
        status: 'scheduled',
        title: '',
        time: null,
        cancelReason: null,
        cpMp4: false,
        cpVimeo: false,
        cpTranscript: false,
        cpAi: false,
        cpDeployed: false,
        contentNeedsReview: false,
        contentGenerated: false,
        pipelineSyncedAt: null,
      },
    ]);

    const env = await loadSeancePipelineEnvelope({ now: new Date('2026-06-30T10:00:00.000Z') });
    expect(env.sessions).toHaveLength(2);
    expect(env.sessions[0]).toMatchObject({
      date: '2026-06-30',
      slot: 'analyse',
      status: 'done',
      time: '12h00',
      checkpoints: { mp4: true, vimeo: true, transcript: true, ai: true, deployed: false },
      contentGenerated: true,
      syncedAt: '2026-06-30T20:46:00.000Z',
    });
    // Derived fallbacks for the placeholder-ish second row.
    expect(env.sessions[1]!.time).toBe('20h00');
    expect(env.sessions[1]!.title).toContain('débrief');
    expect(env.sessions[1]!.syncedAt).toBeNull();

    expect(m.logAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'seance.batch.pulled',
        metadata: expect.objectContaining({ sessionsCount: 2 }),
      }),
    );
  });
});
