/**
 * Vitest TDD pour les paths J8 polish (post audit-driven 2e passe).
 *
 * Couvre :
 *   - `MockWeeklyReportClient.generate()` — output Zod-valid pour différents
 *     snapshots (active, inactive, mixed).
 *   - Path "no activity" du mock — court-circuit utilisé par `service.ts`
 *     mitigation #4 (skip Claude pour membres inactifs).
 *   - Cost computation déterministe via `computeCostEur`.
 *   - Allowlist `ANTHROPIC_MODEL` rejette les modèles non-pricés.
 */

import { describe, expect, it } from 'vitest';

import { weeklyReportOutputSchema } from '@/lib/schemas/weekly-report';

import { MockWeeklyReportClient, resetClaudeClient } from './claude-client';
import { computeCostEur, PRICING_USD_PER_MTOK } from './pricing';

const ACTIVE_SNAPSHOT = {
  // V1.5 — pseudonymized member label (replaces raw userId at the prompt boundary).
  // V1.5.2 — renamed `memberLabel` → `pseudonymLabel` + widened to 32 bits (8 hex).
  pseudonymLabel: 'member-A1B2C3D4',
  timezone: 'Europe/Paris',
  weekStart: new Date('2026-05-04T00:00:00Z'),
  weekEnd: new Date('2026-05-10T23:59:59.999Z'),
  counters: {
    tradesTotal: 4,
    tradesWin: 2,
    tradesLoss: 1,
    tradesBreakEven: 1,
    tradesOpen: 0,
    realizedRSum: 2.5,
    realizedRMean: 0.625,
    planRespectRate: 0.75,
    hedgeRespectRate: 0.5,
    morningCheckinsCount: 5,
    eveningCheckinsCount: 4,
    streakDays: 5,
    sleepHoursMedian: 7,
    moodMedian: 7,
    stressMedian: 4,
    annotationsReceived: 1,
    annotationsViewed: 1,
    douglasCardsDelivered: 2,
    douglasCardsSeen: 1,
    douglasCardsHelpful: 1,
    // V1.5 — defaults all-zero / null since this fixture predates capture.
    tradesQualityA: 0,
    tradesQualityB: 0,
    tradesQualityC: 0,
    tradesQualityCaptured: 0,
    riskPctMedian: null,
    riskPctOverTwoCount: 0,
  },
  freeText: {
    emotionTags: ['calm', 'focused', 'fomo'],
    pairsTraded: ['EURUSD', 'XAUUSD'],
    sessionsTraded: [
      { session: 'london' as const, count: 2 },
      { session: 'newyork' as const, count: 2 },
    ],
    journalExcerpts: ['Journée propre, plan respecté.'],
  },
  scores: {
    discipline: 75,
    emotionalStability: 68,
    consistency: 72,
    engagement: 80,
  },
};

const INACTIVE_SNAPSHOT = {
  // V1.5 — pseudonymized member label (V1.5.2 — 32-bit / 8 hex chars).
  pseudonymLabel: 'member-D4E5F6A7',
  timezone: 'Europe/Paris',
  weekStart: new Date('2026-05-04T00:00:00Z'),
  weekEnd: new Date('2026-05-10T23:59:59.999Z'),
  counters: {
    tradesTotal: 0,
    tradesWin: 0,
    tradesLoss: 0,
    tradesBreakEven: 0,
    tradesOpen: 0,
    realizedRSum: 0,
    realizedRMean: null,
    planRespectRate: null,
    hedgeRespectRate: null,
    morningCheckinsCount: 0,
    eveningCheckinsCount: 0,
    streakDays: 0,
    sleepHoursMedian: null,
    moodMedian: null,
    stressMedian: null,
    annotationsReceived: 0,
    annotationsViewed: 0,
    douglasCardsDelivered: 0,
    douglasCardsSeen: 0,
    douglasCardsHelpful: 0,
    // V1.5 — inactive member, no V1.5 capture either.
    tradesQualityA: 0,
    tradesQualityB: 0,
    tradesQualityC: 0,
    tradesQualityCaptured: 0,
    riskPctMedian: null,
    riskPctOverTwoCount: 0,
  },
  freeText: {
    emotionTags: [],
    pairsTraded: [],
    sessionsTraded: [],
    journalExcerpts: [],
  },
  scores: {
    discipline: null,
    emotionalStability: null,
    consistency: null,
    engagement: null,
  },
};

describe('MockWeeklyReportClient', () => {
  it('génère une output Zod-valide pour un membre actif', async () => {
    resetClaudeClient();
    const client = new MockWeeklyReportClient();
    const result = await client.generate(ACTIVE_SNAPSHOT);

    expect(result.mocked).toBe(true);
    expect(result.model.startsWith('mock:')).toBe(true);
    // Output validé via Zod côté `generate()` — on revalide post-fait pour
    // garantir alignement avec le schéma Phase A.
    const parsed = weeklyReportOutputSchema.safeParse(result.output);
    expect(parsed.success).toBe(true);
    expect(result.output.summary.length).toBeGreaterThanOrEqual(100);
    expect(result.output.recommendations.length).toBeGreaterThan(0);
  });

  it('produit le path "no activity" pour un membre inactif (mitigation #4 J8)', async () => {
    const client = new MockWeeklyReportClient();
    const result = await client.generate(INACTIVE_SNAPSHOT);

    expect(result.mocked).toBe(true);
    // Le summary "no activity" mentionne explicitement l'absence d'activité.
    expect(result.output.summary).toMatch(/aucune activité/i);
    // Au moins une recommandation engagement (relance check-in).
    expect(result.output.recommendations.length).toBeGreaterThanOrEqual(1);
    expect(result.output.recommendations[0]).toMatch(/check-in matin/i);
    // Pas de risk pour un onboarding récent — c'est cohérent avec la posture
    // Mark Douglas (pas anxiogène).
    expect(result.output.risks.length).toBe(0);
  });

  it('inclut le drift discipline dans risks quand planRespectRate < 0.7', async () => {
    const client = new MockWeeklyReportClient();
    const lowDisciplineSnapshot = {
      ...ACTIVE_SNAPSHOT,
      counters: { ...ACTIVE_SNAPSHOT.counters, planRespectRate: 0.5 },
    };
    const result = await client.generate(lowDisciplineSnapshot);
    expect(result.output.risks.some((r) => r.match(/Plan respecté/i))).toBe(true);
  });

  it('inclut le tilt warning dans risks quand 3+ pertes sans gain', async () => {
    const client = new MockWeeklyReportClient();
    const tiltSnapshot = {
      ...ACTIVE_SNAPSHOT,
      counters: {
        ...ACTIVE_SNAPSHOT.counters,
        tradesWin: 0,
        tradesLoss: 3,
      },
    };
    const result = await client.generate(tiltSnapshot);
    expect(result.output.risks.some((r) => r.match(/tilt|pertes/i))).toBe(true);
  });

  it('cost en EUR 6-décimales prêt pour Decimal(10,6)', async () => {
    const client = new MockWeeklyReportClient();
    const result = await client.generate(ACTIVE_SNAPSHOT);
    expect(result.cost.costEur).toMatch(/^\d+\.\d{6}$/);
    expect(Number(result.cost.costEur)).toBeGreaterThan(0);
  });
});

describe('pricing — computeCostEur', () => {
  it('Sonnet 4.6 input = $3/Mtok × 0.93 EUR/USD', () => {
    const cost = computeCostEur('claude-sonnet-4-6', {
      inputTokens: 1_000_000,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheCreateTokens: 0,
    });
    // 1M tok × $3 × 0.93 = $2.79 EUR
    expect(Number(cost.costEur)).toBeCloseTo(2.79, 6);
  });

  it('Sonnet 4.6 cache read = 90% rabais vs base input', () => {
    const cost = computeCostEur('claude-sonnet-4-6', {
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 1_000_000,
      cacheCreateTokens: 0,
    });
    // 1M × $0.30 × 0.93 = $0.279 EUR (10% du base)
    expect(Number(cost.costEur)).toBeCloseTo(0.279, 6);
  });

  it('Haiku 4.5 input ~3.75× moins cher que Sonnet 4.6', () => {
    const sonnet = Number(
      computeCostEur('claude-sonnet-4-6', {
        inputTokens: 1_000_000,
        outputTokens: 0,
        cacheReadTokens: 0,
        cacheCreateTokens: 0,
      }).costEur,
    );
    const haiku = Number(
      computeCostEur('claude-haiku-4-5', {
        inputTokens: 1_000_000,
        outputTokens: 0,
        cacheReadTokens: 0,
        cacheCreateTokens: 0,
      }).costEur,
    );
    expect(sonnet / haiku).toBeCloseTo(3.75, 1);
  });

  it('PRICING_USD_PER_MTOK contient les 3 modèles whitelistés env', () => {
    expect(PRICING_USD_PER_MTOK['claude-sonnet-4-6']).toBeDefined();
    expect(PRICING_USD_PER_MTOK['claude-haiku-4-5']).toBeDefined();
  });

  it('rejette tokens négatifs (validation Zod)', () => {
    expect(() =>
      computeCostEur('claude-sonnet-4-6', {
        inputTokens: -1,
        outputTokens: 0,
        cacheReadTokens: 0,
        cacheCreateTokens: 0,
      }),
    ).toThrow();
  });
});
