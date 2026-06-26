import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/db', () => ({ db: {} }));
vi.mock('@/lib/auth/audit', () => ({ logAudit: vi.fn() }));
vi.mock('@/lib/observability', () => ({ reportError: vi.fn(), reportWarning: vi.fn() }));
vi.mock('@/lib/notifications/enqueue', () => ({
  enqueueDouglasDeliveryNotification: vi.fn(),
}));

import { db } from '@/lib/db';

import { ALERT_RULES } from './alerts';
import {
  currentPeriodStart,
  foldConstancy,
  listRecentConstancyScores,
  ritualEventId,
} from './constancy';

/**
 * S3 §33.5 — pure constancy fold (DoD §31 #3 « le score monte et descend
 * correctement ») + repetition invariants (DoD §31 #4).
 */

describe('foldConstancy — le score monte et descend (DoD #3)', () => {
  const confronted = { everConfronted: true, discrepancies28d: { total: 0, addressed: 0 } };

  it('full regularity, clean honesty → high score', () => {
    const r = foldConstancy(
      [
        { reason: 'filled', excused: false },
        { reason: 'filled', excused: false },
      ],
      confronted,
    );
    expect(r.breakdown.regularity).toBe(100);
    expect(r.breakdown.honesty).toBe(100);
    expect(r.value).toBeGreaterThan(95);
  });

  it('🚨 DESCEND — forgot rituals pull regularity down', () => {
    const r = foldConstancy(
      [
        { reason: 'filled', excused: false },
        { reason: 'forgot_no_reason', excused: false },
        { reason: 'forgot_no_reason', excused: false },
        { reason: 'forgot_no_reason', excused: false },
      ],
      confronted,
    );
    expect(r.breakdown.regularity).toBe(25);
  });

  it('🚨 DESCEND — a false declaration costs more than a reality gap', () => {
    const gap = foldConstancy([{ reason: 'reality_gap', excused: false }], confronted);
    const lie = foldConstancy([{ reason: 'false_declaration', excused: false }], confronted);
    expect(gap.breakdown.honesty).toBe(85);
    expect(lie.breakdown.honesty).toBe(60);
  });

  it('🚨 REMONTE — an excused event no longer counts (motif valable, DoD §29)', () => {
    const before = foldConstancy(
      [
        { reason: 'filled', excused: false },
        { reason: 'forgot_no_reason', excused: false },
        { reason: 'reality_gap', excused: false },
      ],
      confronted,
    );
    const after = foldConstancy(
      [
        { reason: 'filled', excused: false },
        { reason: 'forgot_no_reason', excused: true },
        { reason: 'reality_gap', excused: true },
      ],
      confronted,
    );
    expect(after.value!).toBeGreaterThan(before.value!);
    expect(after.breakdown.regularity).toBe(100);
    expect(after.breakdown.honesty).toBe(100);
  });

  it('🚨 anti-survente §33.6 — never confronted ⇒ honesty is null, never a fake 100', () => {
    const r = foldConstancy([{ reason: 'filled', excused: false }], {
      everConfronted: false,
      discrepancies28d: { total: 0, addressed: 0 },
    });
    expect(r.breakdown.honesty).toBeNull();
    expect(r.value).not.toBeNull(); // regularity still scores
  });

  it('discipline = facing reality (addressed / total over 28d)', () => {
    const r = foldConstancy([], {
      everConfronted: true,
      discrepancies28d: { total: 4, addressed: 3 },
    });
    expect(r.breakdown.discipline).toBe(75);
  });

  it('no signal at all → null value (no fake neutral score)', () => {
    const r = foldConstancy([], {
      everConfronted: false,
      discrepancies28d: { total: 0, addressed: 0 },
    });
    expect(r.value).toBeNull();
  });

  it('weights renormalise over present axes only', () => {
    const r = foldConstancy(
      [
        { reason: 'filled', excused: false },
        { reason: 'forgot_no_reason', excused: false },
      ],
      { everConfronted: false, discrepancies28d: { total: 0, addressed: 0 } },
    );
    // Only regularity (50%) present → value == regularity exactly.
    expect(r.value).toBe(50);
  });
});

describe('ritual idempotency + period anchoring', () => {
  it('ritualEventId is deterministic (THE idempotency key of the daily scan)', () => {
    const a = ritualEventId('forgot_no_reason', 'member1', '2026-06-10', 'morning');
    const b = ritualEventId('forgot_no_reason', 'member1', '2026-06-10', 'morning');
    expect(a).toBe(b);
    expect(a).not.toBe(ritualEventId('forgot_no_reason', 'member1', '2026-06-10', 'evening'));
    expect(a).not.toBe(ritualEventId('filled', 'member1', '2026-06-10', 'morning'));
  });

  it('currentPeriodStart anchors on the ISO Monday (Paris)', () => {
    // Thursday 2026-06-11 → Monday 2026-06-08.
    expect(currentPeriodStart(new Date('2026-06-11T10:00:00.000Z'))).toBe('2026-06-08');
    // Monday itself stays Monday.
    expect(currentPeriodStart(new Date('2026-06-08T10:00:00.000Z'))).toBe('2026-06-08');
    // Sunday late evening Paris still belongs to the week of its Monday.
    expect(currentPeriodStart(new Date('2026-06-14T21:30:00.000Z'))).toBe('2026-06-08');
  });
});

describe('ALERT_RULES — répétition obligatoire (DoD §31 #4 / §33.8)', () => {
  it('🚨 EVERY rule has a threshold ≥ 2 — a single slip can never alert', () => {
    for (const rule of ALERT_RULES) {
      expect(rule.threshold).toBeGreaterThanOrEqual(2);
    }
  });

  it('🚨 every rule maps to a PSYCHOLOGICAL coaching category (never trading advice)', () => {
    for (const rule of ALERT_RULES) {
      expect(['discipline', 'ego']).toContain(rule.cardCategory);
      // The member-visible label is calm French copy — no market vocabulary.
      expect(rule.triggeredByLabel).not.toMatch(/achat|vente|long|short|setup|niveau|objectif/i);
    }
  });
});

describe('listRecentConstancyScores — trajectoire oldest→newest (S4/S6)', () => {
  it('inverse le take DB (newest→oldest) en une trajectoire croissante', async () => {
    // Le sparkline de constance (membre /verification + panneau admin) se lit du
    // plus ancien au plus récent ; la requête prend newest-first puis `.reverse()`.
    // Ce test VERROUILLE cet invariant — un refacto retirant `.reverse()`
    // inverserait silencieusement la courbe (aucun autre test ne le rougirait).
    const rowsDescFromDb = [
      {
        value: 70,
        breakdown: {},
        periodStart: new Date('2026-06-15'),
        computedAt: new Date('2026-06-15'),
      },
      {
        value: 60,
        breakdown: {},
        periodStart: new Date('2026-06-08'),
        computedAt: new Date('2026-06-08'),
      },
      {
        value: 50,
        breakdown: {},
        periodStart: new Date('2026-06-01'),
        computedAt: new Date('2026-06-01'),
      },
    ];
    const findMany = vi.fn().mockResolvedValue(rowsDescFromDb);
    (db as unknown as { constancyScore: { findMany: typeof findMany } }).constancyScore = {
      findMany,
    };

    const result = await listRecentConstancyScores('u1', 12);

    // La requête demande bien le plus récent d'abord (orderBy desc, take borné).
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { memberId: 'u1' },
        orderBy: { periodStart: 'desc' },
        take: 12,
      }),
    );
    const times = result.map((r) => r.periodStart.getTime());
    expect(times).toEqual([...times].sort((a, b) => a - b)); // strictement croissant
    expect(result[0]?.value).toBe(50); // le plus ancien en premier
    expect(result[result.length - 1]?.value).toBe(70); // le plus récent en dernier
  });
});
