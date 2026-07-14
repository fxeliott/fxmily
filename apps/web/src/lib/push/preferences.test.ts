import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * J2 — notification preference gating unit tests (item 9 : "gating opt-out").
 *
 * Preferences are opt-OUT: a missing row means enabled. `getEffectivePreferences`
 * seeds every slug to `true` then overrides with the persisted rows, so the two
 * J2 notification types (`weekly_review_reminder`, `calendar_ready`) default on
 * and only flip off when the member explicitly toggles them. `db` is fully mocked.
 */

const { findManyMock, findUniqueMock, upsertMock } = vi.hoisted(() => ({
  findManyMock: vi.fn(),
  findUniqueMock: vi.fn(),
  upsertMock: vi.fn(),
}));

vi.mock('@/lib/db', () => ({
  db: {
    notificationPreference: {
      findMany: findManyMock,
      findUnique: findUniqueMock,
      upsert: upsertMock,
    },
  },
}));

import { getEffectivePreferences, isPreferenceEnabled, setPreference } from './preferences';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('getEffectivePreferences', () => {
  it('defaults every type to enabled when the member has no rows (opt-out model)', async () => {
    findManyMock.mockResolvedValue([]);

    const prefs = await getEffectivePreferences('usr_1');

    // J2 notification types must default ON.
    expect(prefs.weekly_review_reminder).toBe(true);
    expect(prefs.calendar_ready).toBe(true);
  });

  it('flips a J2 type off when the member disabled it, leaving others enabled', async () => {
    findManyMock.mockResolvedValue([{ type: 'weekly_review_reminder', enabled: false }]);

    const prefs = await getEffectivePreferences('usr_1');

    expect(prefs.weekly_review_reminder).toBe(false);
    // A sibling J2 type the member never touched stays enabled.
    expect(prefs.calendar_ready).toBe(true);
  });

  it('ignores a persisted row whose type is not a known notification slug', async () => {
    findManyMock.mockResolvedValue([{ type: 'legacy_unknown_type', enabled: false }]);

    const prefs = await getEffectivePreferences('usr_1');

    // Unknown slug must not create a key nor disturb the known defaults.
    expect(prefs).not.toHaveProperty('legacy_unknown_type');
    expect(prefs.weekly_review_reminder).toBe(true);
  });
});

describe('isPreferenceEnabled', () => {
  it('returns true when no row exists (default opt-in)', async () => {
    findUniqueMock.mockResolvedValue(null);

    await expect(isPreferenceEnabled('usr_1', 'weekly_review_reminder')).resolves.toBe(true);
  });

  it('honours an explicit disabled row', async () => {
    findUniqueMock.mockResolvedValue({ enabled: false });

    await expect(isPreferenceEnabled('usr_1', 'weekly_review_reminder')).resolves.toBe(false);
  });

  it('honours an explicit enabled row', async () => {
    findUniqueMock.mockResolvedValue({ enabled: true });

    await expect(isPreferenceEnabled('usr_1', 'calendar_ready')).resolves.toBe(true);
  });
});

describe('setPreference', () => {
  it('upserts on the composite (userId, type) key', async () => {
    upsertMock.mockResolvedValue({});

    await setPreference('usr_1', 'weekly_review_reminder', false);

    const arg = upsertMock.mock.calls[0]?.[0];
    expect(arg?.where).toEqual({
      userId_type: { userId: 'usr_1', type: 'weekly_review_reminder' },
    });
    expect(arg?.create).toMatchObject({
      userId: 'usr_1',
      type: 'weekly_review_reminder',
      enabled: false,
    });
    expect(arg?.update).toMatchObject({ enabled: false });
  });
});
