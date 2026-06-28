import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * V2 hardening — drain-loop coverage for `purgeStaleAuditLog`.
 *
 * The pre-V2 implementation deleted a SINGLE 5_000-row batch per daily run,
 * which is slower than the ~15k rows/day intake at 1000 members → the table
 * grew net every day. These tests pin the new behaviour: the bounded delete
 * loops until the stale backlog is drained, while still respecting a hard
 * iteration cap so the job always terminates inside the cron time budget.
 *
 * Mock strategy mirrors the repo convention (`lib/access-request/service.test.ts`):
 * `vi.hoisted` shares the mock fns with the hoisted `vi.mock('@/lib/db')`
 * factory. The mocks faithfully simulate a shrinking backlog so the loop's
 * termination conditions are exercised for real, not asserted in the abstract.
 */

const m = vi.hoisted(() => ({
  findMany: vi.fn(),
  deleteMany: vi.fn(),
}));

vi.mock('@/lib/db', () => ({
  db: { auditLog: { findMany: m.findMany, deleteMany: m.deleteMany } },
}));

import { purgeStaleAuditLog } from './cleanup';

/** Seed a backlog of `total` stale rows that shrinks as `deleteMany` runs. */
function seedBacklog(total: number): () => number {
  let remaining = Array.from({ length: total }, (_, i) => String(i));
  m.findMany.mockImplementation(async (args: { take: number }) =>
    remaining.slice(0, args.take).map((id) => ({ id })),
  );
  m.deleteMany.mockImplementation(async (args: { where: { id: { in: string[] } } }) => {
    const doomed = new Set(args.where.id.in);
    const before = remaining.length;
    remaining = remaining.filter((id) => !doomed.has(id));
    return { count: before - remaining.length };
  });
  return () => remaining.length;
}

beforeEach(() => {
  m.findMany.mockReset();
  m.deleteMany.mockReset();
});

describe('purgeStaleAuditLog drain loop', () => {
  it('drains a backlog larger than one batch across multiple iterations', async () => {
    const left = seedBacklog(12_000);

    const res = await purgeStaleAuditLog({ batchSize: 5_000 });

    expect(res.scanned).toBe(12_000);
    expect(res.purged).toBe(12_000);
    expect(res.errors).toBe(0);
    expect(left()).toBe(0);
    // 5_000 + 5_000 + 2_000 → the partial third page ends the loop.
    expect(m.findMany).toHaveBeenCalledTimes(3);
  });

  it('does no delete and probes once when nothing is stale', async () => {
    seedBacklog(0);

    const res = await purgeStaleAuditLog({ batchSize: 5_000 });

    expect(res.scanned).toBe(0);
    expect(res.purged).toBe(0);
    expect(m.findMany).toHaveBeenCalledTimes(1);
    expect(m.deleteMany).not.toHaveBeenCalled();
  });

  it('stops at the iteration cap instead of looping forever', async () => {
    seedBacklog(1_000_000);

    const res = await purgeStaleAuditLog({ batchSize: 5_000, maxBatches: 3 });

    expect(res.scanned).toBe(15_000);
    expect(res.purged).toBe(15_000);
    expect(m.findMany).toHaveBeenCalledTimes(3);
  });

  it('halts the drain and reports the batch as errored when a delete fails', async () => {
    seedBacklog(20_000);
    m.deleteMany.mockReset();
    m.deleteMany.mockRejectedValueOnce(new Error('pool timeout'));
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    const res = await purgeStaleAuditLog({ batchSize: 5_000 });

    expect(res.errors).toBe(5_000);
    expect(res.purged).toBe(0);
    expect(m.findMany).toHaveBeenCalledTimes(1);
    errSpy.mockRestore();
  });
});
