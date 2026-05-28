import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  memberProfileOutputSchema,
  type OnboardingInterviewSnapshot,
} from '@/lib/schemas/onboarding-interview';

// Stub env BEFORE importing the module (env.ANTHROPIC_API_KEY drives the
// factory's Mock vs Live decision).
vi.mock('@/lib/env', () => ({
  env: {
    ANTHROPIC_API_KEY: undefined,
    ANTHROPIC_MODEL: 'claude-sonnet-4-6',
  },
}));

const { MockOnboardingProfileClient, getOnboardingProfileClient, resetOnboardingClient } =
  await import('./claude-client');

/**
 * V2.4 Phase A.2 — Claude client tests (Mock deterministic + factory).
 *
 * Live client tests are out of scope (requires `@anthropic-ai/sdk` mock +
 * real API key — V1 default ship path is Mock + Live lazy-imported only
 * when ANTHROPIC_API_KEY set, which doesn't happen in CI/dev).
 */

function makeSnapshot(
  overrides: Partial<OnboardingInterviewSnapshot> = {},
): OnboardingInterviewSnapshot {
  const defaultAnswerText =
    "J'ai démarré le trading en 2022 après avoir lu un livre sur le sujet. Premier compte réel à 500€, blow-up rapide. Retour en 2024 avec une approche plus structurée et un focus process.";
  return {
    pseudonymLabel: 'member-aabbccdd',
    instrumentVersion: 'v1',
    startedAt: '2026-05-28T10:00:00.000Z',
    completedAt: '2026-05-28T10:30:00.000Z',
    answers: [
      {
        questionIndex: 0,
        questionKey: 'parcours_origin',
        questionText: 'Raconte comment tu es arrivé au trading.',
        answerText: defaultAnswerText,
        dimensionId: 'parcours_trading',
        phase: 'warmup' as const,
      },
      {
        questionIndex: 8,
        questionKey: 'discipline_last10_count',
        questionText:
          'Sur tes 10 derniers trades, combien ont été exécutés à 100% selon ton plan ?',
        answerText:
          'Honnêtement 4 sur 10. Je dévie souvent sur le target — je sors trop tôt par peur que le marché reparte.',
        dimensionId: 'discipline_plan_adherence',
        phase: 'core' as const,
      },
      {
        questionIndex: 17,
        questionKey: 'emotion_body_stress',
        questionText: 'Où sens-tu le stress dans ton corps ?',
        answerText:
          "Tension dans les épaules et la mâchoire. Respiration courte. J'ai souvent envie de me lever et marcher.",
        dimensionId: 'emotional_regulation',
        phase: 'core' as const,
      },
    ],
    ...overrides,
  };
}

describe('MockOnboardingProfileClient', () => {
  beforeEach(() => {
    resetOnboardingClient();
  });

  afterEach(() => {
    resetOnboardingClient();
  });

  it('generates a Zod-valid MemberProfile output from a normal snapshot', async () => {
    const client = new MockOnboardingProfileClient();
    const snapshot = makeSnapshot();
    const result = await client.generate(snapshot);

    expect(result.mocked).toBe(true);
    expect(result.model).toContain('mock:');
    expect(result.usage.inputTokens).toBeGreaterThan(0);

    // Zod-strict validation (critical : Mock output MUST pass the same
    // schema as Live, otherwise the smoke-test path is broken).
    const validated = memberProfileOutputSchema.safeParse(result.output);
    expect(validated.success).toBe(true);
  });

  it('produces evidence that are verbatim substrings of answer texts', async () => {
    const client = new MockOnboardingProfileClient();
    const snapshot = makeSnapshot();
    const result = await client.generate(snapshot);

    const corpus = snapshot.answers
      .map((a) => a.answerText)
      .join('\n')
      .normalize('NFC');
    for (const highlight of result.output.highlights) {
      for (const evidence of highlight.evidence) {
        // Mock picks verbatim from answerText OR uses placeholder filler
        // (which won't pass real evidence validation but is acceptable
        // for the smoke-test chain — placeholders explicitly labelled).
        const normalized = evidence.normalize('NFC');
        const isSubstring = corpus.includes(normalized);
        const isPlaceholder = evidence.toLowerCase().includes('(mock');
        expect(isSubstring || isPlaceholder).toBe(true);
      }
    }
  });

  it('handles empty snapshot with stub fallback output (Zod-valid)', async () => {
    const client = new MockOnboardingProfileClient();
    const snapshotEmpty = makeSnapshot({
      answers: [
        {
          questionIndex: 0,
          questionKey: 'parcours_origin',
          questionText: 'Question',
          answerText: 'court', // < 30 chars → filtered out as "no usable answer"
          dimensionId: 'parcours_trading',
          phase: 'warmup' as const,
        },
      ],
    });
    const result = await client.generate(snapshotEmpty);

    // Even on empty input, Mock must produce a Zod-valid MemberProfile
    // (3+ highlights, 3+ axes, 100-800 chars summary) to keep the smoke
    // chain unblocked.
    const validated = memberProfileOutputSchema.safeParse(result.output);
    expect(validated.success).toBe(true);
    expect(result.output.highlights.length).toBeGreaterThanOrEqual(3);
    expect(result.output.axes_prioritaires.length).toBeGreaterThanOrEqual(3);
  });
});

describe('getOnboardingProfileClient (factory)', () => {
  beforeEach(() => {
    resetOnboardingClient();
  });

  afterEach(() => {
    resetOnboardingClient();
  });

  it('returns Mock when ANTHROPIC_API_KEY is undefined (V1 default path)', () => {
    const client = getOnboardingProfileClient();
    expect(client).toBeInstanceOf(MockOnboardingProfileClient);
  });

  it('caches the client per-process (same instance on repeated calls)', () => {
    const a = getOnboardingProfileClient();
    const b = getOnboardingProfileClient();
    expect(a).toBe(b);
  });
});
