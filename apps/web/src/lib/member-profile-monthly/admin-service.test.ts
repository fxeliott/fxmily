import { beforeEach, describe, expect, it, vi } from 'vitest';

const { findMany } = vi.hoisted(() => ({ findMany: vi.fn() }));

vi.mock('@/lib/db', () => ({
  db: { memberProfileMonthlySnapshot: { findMany } },
}));

import { listMonthlyReprofileSnapshotsForMember } from './admin-service';

/**
 * J-E inc.3 — the ADMIN read service for the monthly re-profiling trajectory.
 * Pins the serialization contract (`@db.Date` → `YYYY-MM-DD`, instant → ISO,
 * the 4 dims pass through raw for render-time `safeParse`), the newest-first
 * order, and the defensive `take` clamp so a prolific member cannot unbound
 * the admin render.
 */

function row(over: Record<string, unknown> = {}) {
  return {
    id: 'mps_1',
    userId: 'user_1',
    monthStart: new Date('2026-06-01T00:00:00.000Z'),
    monthEnd: new Date('2026-06-30T00:00:00.000Z'),
    generatedAt: new Date('2026-07-01T09:00:00.000Z'),
    evolutionNarrative: 'Le respect du plan progresse ce mois.',
    coachingTone: { register: 'socratique', rationale: 'x', evidence: ['y'] },
    learningStage: null,
    axesStructured: [{ axis: 'A', dimensionId: 'd', priority: 2, evidence: ['z'] }],
    weakSignals: null,
    claudeModel: 'claude-opus-4-8',
    // Extra Prisma columns the mapper deliberately drops (not part of the admin
    // read view) — present to prove the mapper narrows the row.
    inputTokens: 100,
    outputTokens: 200,
    costEur: { toString: () => '0.000000' },
    ...over,
  };
}

beforeEach(() => {
  findMany.mockReset();
});

describe('listMonthlyReprofileSnapshotsForMember', () => {
  it('serializes a row into the JSON-safe admin view', async () => {
    findMany.mockResolvedValue([row()]);

    const [snap] = await listMonthlyReprofileSnapshotsForMember('user_1');

    expect(snap).toEqual({
      id: 'mps_1',
      userId: 'user_1',
      monthStart: '2026-06-01',
      monthEnd: '2026-06-30',
      generatedAt: '2026-07-01T09:00:00.000Z',
      evolutionNarrative: 'Le respect du plan progresse ce mois.',
      coachingTone: { register: 'socratique', rationale: 'x', evidence: ['y'] },
      learningStage: null,
      axesStructured: [{ axis: 'A', dimensionId: 'd', priority: 2, evidence: ['z'] }],
      weakSignals: null,
      claudeModel: 'claude-opus-4-8',
    });
    // Token / cost columns never leak into the admin read view.
    expect(snap).not.toHaveProperty('inputTokens');
    expect(snap).not.toHaveProperty('costEur');
  });

  it('reads the member newest-first with the default clamp', async () => {
    findMany.mockResolvedValue([]);
    await listMonthlyReprofileSnapshotsForMember('user_42');
    expect(findMany).toHaveBeenCalledWith({
      where: { userId: 'user_42' },
      orderBy: { monthStart: 'desc' },
      take: 12,
    });
  });

  it('clamps the take between 1 and 24', async () => {
    findMany.mockResolvedValue([]);

    await listMonthlyReprofileSnapshotsForMember('user_1', 100);
    expect(findMany).toHaveBeenLastCalledWith(expect.objectContaining({ take: 24 }));

    await listMonthlyReprofileSnapshotsForMember('user_1', 0);
    expect(findMany).toHaveBeenLastCalledWith(expect.objectContaining({ take: 1 }));
  });
});
