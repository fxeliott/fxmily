import { beforeEach, describe, expect, it, vi } from 'vitest';

const m = vi.hoisted(() => ({
  findFirst: vi.fn(),
}));

vi.mock('@/lib/db', () => ({
  db: {
    auditLog: { findFirst: m.findFirst },
  },
}));

import {
  CRISIS_AUDIT_ACTIONS,
  CRISIS_FOLLOWUP_WINDOW_MS,
  getRecentCrisisSignal,
} from './crisis-followup';

beforeEach(() => vi.clearAllMocks());

const NOW = new Date('2026-07-03T10:00:00Z');
const USER = 'user_1';

describe('getRecentCrisisSignal', () => {
  it('returns null when no crisis row exists in the window', async () => {
    m.findFirst.mockResolvedValue(null);
    expect(await getRecentCrisisSignal(USER, NOW)).toBeNull();
  });

  it('queries the dedicated slugs, scoped to the user and the 48h window', async () => {
    m.findFirst.mockResolvedValue(null);
    await getRecentCrisisSignal(USER, NOW);
    expect(m.findFirst).toHaveBeenCalledWith({
      where: {
        userId: USER,
        action: { in: [...CRISIS_AUDIT_ACTIONS] },
        createdAt: {
          gte: new Date(NOW.getTime() - CRISIS_FOLLOWUP_WINDOW_MS),
          lte: NOW,
        },
      },
      orderBy: { createdAt: 'desc' },
      select: { createdAt: true, metadata: true },
    });
  });

  it('maps a high row to level high with its timestamp', async () => {
    const detectedAt = new Date('2026-07-02T21:00:00Z');
    m.findFirst.mockResolvedValue({ createdAt: detectedAt, metadata: { level: 'high' } });
    expect(await getRecentCrisisSignal(USER, NOW)).toEqual({ level: 'high', detectedAt });
  });

  it('maps a medium row to level medium', async () => {
    const detectedAt = new Date('2026-07-03T08:00:00Z');
    m.findFirst.mockResolvedValue({ createdAt: detectedAt, metadata: { level: 'medium' } });
    expect(await getRecentCrisisSignal(USER, NOW)).toEqual({ level: 'medium', detectedAt });
  });

  it('degrades a malformed metadata to medium (softer copy), never throws', async () => {
    const detectedAt = new Date('2026-07-03T08:00:00Z');
    m.findFirst.mockResolvedValue({ createdAt: detectedAt, metadata: null });
    expect(await getRecentCrisisSignal(USER, NOW)).toEqual({ level: 'medium', detectedAt });
    m.findFirst.mockResolvedValue({ createdAt: detectedAt, metadata: ['level'] });
    expect(await getRecentCrisisSignal(USER, NOW)).toEqual({ level: 'medium', detectedAt });
  });

  it('window boundary: the where clause excludes anything older than 48h', async () => {
    m.findFirst.mockResolvedValue(null);
    await getRecentCrisisSignal(USER, NOW);
    const call = m.findFirst.mock.calls[0]![0] as {
      where: { createdAt: { gte: Date } };
    };
    expect(NOW.getTime() - call.where.createdAt.gte.getTime()).toBe(48 * 60 * 60 * 1000);
  });
});
