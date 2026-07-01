import { describe, expect, it } from 'vitest';

import { CANONICAL_ASSETS } from '@/lib/seances/pipeline-canonical';

import { seancePipelinePersistSchema, seancePipelineSessionSchema } from './seance-pipeline';

/**
 * Réunion hub (séances) J4 — structural net for the persist payload. Proves the
 * `.strict()` unknown-key rejection + the cross-field consistency refinements
 * (cpAi⟺content, cpVimeo⟹vimeo.id, cpTranscript⟹non-pending, enums). The
 * SEMANTIC Règle n°1 net is `pipeline-canonical.test.ts`.
 */

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

function baseSession(over: Record<string, unknown> = {}) {
  return {
    date: '2026-06-30',
    slot: 'analyse',
    checkpoints: { mp4: false, vimeo: false, transcript: false, ai: false, deployed: false },
    ...over,
  };
}

describe('seancePipelineSessionSchema — structure + defaults', () => {
  it('parses a minimal content-less session and applies defaults', () => {
    const res = seancePipelineSessionSchema.safeParse(baseSession());
    expect(res.success).toBe(true);
    if (res.success) {
      expect(res.data.content).toBeNull();
      expect(res.data.vimeo).toBeNull();
      expect(res.data.transcript).toBeNull();
      expect(res.data.durationSec).toBeNull();
      expect(res.data.contentNeedsReview).toBe(false);
      expect(res.data.failure).toBeNull();
    }
  });

  it('parses a full held session (cpAi + content + vimeo + transcript)', () => {
    const res = seancePipelineSessionSchema.safeParse(
      baseSession({
        checkpoints: { mp4: true, vimeo: true, transcript: true, ai: true, deployed: true },
        durationSec: 3600,
        vimeo: { id: '123456', hash: 'abc123', processing: false },
        transcript: { source: 'fathom', lang: 'fr', pending: false },
        content: validContentBlock(),
      }),
    );
    expect(res.success).toBe(true);
  });

  it('rejects an unknown key (.strict)', () => {
    const res = seancePipelineSessionSchema.safeParse(baseSession({ surprise: 1 }));
    expect(res.success).toBe(false);
  });
});

describe('seancePipelineSessionSchema — consistency refinements', () => {
  it('rejects cpAi=true without content', () => {
    const res = seancePipelineSessionSchema.safeParse(
      baseSession({
        checkpoints: { mp4: true, vimeo: true, transcript: true, ai: true, deployed: false },
      }),
    );
    expect(res.success).toBe(false);
  });

  it('rejects content present without cpAi', () => {
    const res = seancePipelineSessionSchema.safeParse(
      baseSession({ content: validContentBlock() }),
    );
    expect(res.success).toBe(false);
  });

  it('allows content present + contentNeedsReview=true (regen fallback)', () => {
    // Isolate the needsReview allowance: only cpAi set (so the vimeo/transcript
    // refinements are not triggered by missing metadata).
    const res = seancePipelineSessionSchema.safeParse(
      baseSession({
        checkpoints: { mp4: false, vimeo: false, transcript: false, ai: true, deployed: false },
        content: validContentBlock(),
        contentNeedsReview: true,
      }),
    );
    expect(res.success).toBe(true);
  });

  it('rejects cpVimeo=true without vimeo.id', () => {
    const res = seancePipelineSessionSchema.safeParse(
      baseSession({
        checkpoints: { mp4: true, vimeo: true, transcript: false, ai: false, deployed: false },
      }),
    );
    expect(res.success).toBe(false);
  });

  it('rejects cpTranscript=true with a pending transcript', () => {
    const res = seancePipelineSessionSchema.safeParse(
      baseSession({
        checkpoints: { mp4: true, vimeo: true, transcript: true, ai: false, deployed: false },
        vimeo: { id: '123456', processing: false },
        transcript: { source: 'fathom', lang: 'fr', pending: true },
      }),
    );
    expect(res.success).toBe(false);
  });
});

describe('seancePipelineSessionSchema — enums', () => {
  it('rejects an unknown transcript source', () => {
    const res = seancePipelineSessionSchema.safeParse(
      baseSession({ transcript: { source: 'gladia', lang: 'fr', pending: true } }),
    );
    expect(res.success).toBe(false);
  });

  it('rejects an unknown failure step', () => {
    const res = seancePipelineSessionSchema.safeParse(
      baseSession({ failure: { step: 'deploy', error: 'boom' } }),
    );
    expect(res.success).toBe(false);
  });

  it('accepts the canonical failure step "deployed"', () => {
    const res = seancePipelineSessionSchema.safeParse(
      baseSession({ failure: { step: 'deployed', error: 'cf 500' } }),
    );
    expect(res.success).toBe(true);
  });

  it('rejects a non-canonical asset symbol', () => {
    const bad = validContentBlock();
    bad.assets[0] = { ...bad.assets[0]!, symbol: 'BTCUSD' as never };
    const res = seancePipelineSessionSchema.safeParse(
      baseSession({
        checkpoints: { mp4: true, vimeo: true, transcript: true, ai: true, deployed: false },
        content: bad,
      }),
    );
    expect(res.success).toBe(false);
  });
});

describe('seancePipelinePersistSchema — envelope', () => {
  it('requires at least one session', () => {
    expect(seancePipelinePersistSchema.safeParse({ sessions: [] }).success).toBe(false);
  });

  it('parses a one-session batch', () => {
    expect(seancePipelinePersistSchema.safeParse({ sessions: [baseSession()] }).success).toBe(true);
  });
});
