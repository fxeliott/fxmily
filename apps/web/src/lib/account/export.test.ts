import { beforeEach, describe, expect, it, vi } from 'vitest';

const userFindUnique = vi.fn();
const tradeFindMany = vi.fn();
const tradeAnnotationFindMany = vi.fn();
const dailyCheckinFindMany = vi.fn();
const behavioralScoreFindMany = vi.fn();
const douglasDeliveryFindMany = vi.fn();
const douglasFavoriteFindMany = vi.fn();
const weeklyReportFindMany = vi.fn();
const pushSubscriptionFindMany = vi.fn();
const notificationPreferenceFindMany = vi.fn();
const notificationQueueFindMany = vi.fn();
const auditLogFindMany = vi.fn();

vi.mock('@/lib/db', () => ({
  db: {
    user: { findUnique: userFindUnique },
    trade: { findMany: tradeFindMany },
    tradeAnnotation: { findMany: tradeAnnotationFindMany },
    dailyCheckin: { findMany: dailyCheckinFindMany },
    behavioralScore: { findMany: behavioralScoreFindMany },
    markDouglasDelivery: { findMany: douglasDeliveryFindMany },
    markDouglasFavorite: { findMany: douglasFavoriteFindMany },
    weeklyReport: { findMany: weeklyReportFindMany },
    pushSubscription: { findMany: pushSubscriptionFindMany },
    notificationPreference: { findMany: notificationPreferenceFindMany },
    notificationQueue: { findMany: notificationQueueFindMany },
    auditLog: { findMany: auditLogFindMany },
  },
}));

const { EXPORT_SCHEMA_VERSION, buildExportFilename, buildUserDataExport, summariseExport } =
  await import('./export');

beforeEach(() => {
  userFindUnique.mockReset();
  tradeFindMany.mockReset();
  tradeAnnotationFindMany.mockReset();
  dailyCheckinFindMany.mockReset();
  behavioralScoreFindMany.mockReset();
  douglasDeliveryFindMany.mockReset();
  douglasFavoriteFindMany.mockReset();
  weeklyReportFindMany.mockReset();
  pushSubscriptionFindMany.mockReset();
  notificationPreferenceFindMany.mockReset();
  notificationQueueFindMany.mockReset();
  auditLogFindMany.mockReset();

  // Default empty results for all readers — tests override what they need.
  userFindUnique.mockResolvedValue(null);
  tradeFindMany.mockResolvedValue([]);
  tradeAnnotationFindMany.mockResolvedValue([]);
  dailyCheckinFindMany.mockResolvedValue([]);
  behavioralScoreFindMany.mockResolvedValue([]);
  douglasDeliveryFindMany.mockResolvedValue([]);
  douglasFavoriteFindMany.mockResolvedValue([]);
  weeklyReportFindMany.mockResolvedValue([]);
  pushSubscriptionFindMany.mockResolvedValue([]);
  notificationPreferenceFindMany.mockResolvedValue([]);
  notificationQueueFindMany.mockResolvedValue([]);
  auditLogFindMany.mockResolvedValue([]);
});

describe('buildUserDataExport', () => {
  it('returns the schema-versioned snapshot with empty arrays on a fresh user', async () => {
    userFindUnique.mockResolvedValueOnce({
      id: 'u1',
      email: 'eliot@example.com',
      emailVerified: null,
      firstName: 'Eliot',
      lastName: 'Pena',
      image: null,
      role: 'member',
      status: 'active',
      timezone: 'Europe/Paris',
      consentRgpdAt: null,
      joinedAt: new Date('2026-05-05T08:00:00Z'),
      lastSeenAt: null,
      createdAt: new Date('2026-05-05T08:00:00Z'),
      updatedAt: new Date('2026-05-05T08:00:00Z'),
      deletedAt: null,
    });

    const snap = await buildUserDataExport('u1');

    expect(snap.schemaVersion).toBe(EXPORT_SCHEMA_VERSION);
    expect(snap.user?.email).toBe('eliot@example.com');
    expect(snap.trades).toEqual([]);
    expect(snap.notes.contact).toBe('eliot@fxmily.com');
    expect(typeof snap.exportedAt).toBe('string');
    expect(new Date(snap.exportedAt).toString()).not.toBe('Invalid Date');
  });

  it('does not select passwordHash from the user (sensitive)', async () => {
    await buildUserDataExport('u1');
    expect(userFindUnique).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'u1' },
        select: expect.not.objectContaining({ passwordHash: true }),
      }),
    );
  });

  it('selects safe push subscription fields only (no p256dhKey/authKey)', async () => {
    await buildUserDataExport('u1');
    const call = pushSubscriptionFindMany.mock.calls[0]?.[0];
    expect(call?.select).toEqual({
      id: true,
      endpoint: true,
      userAgent: true,
      createdAt: true,
      updatedAt: true,
      lastSeenAt: true,
    });
  });

  it('selects safe audit log fields only (no ipHash)', async () => {
    await buildUserDataExport('u1');
    const call = auditLogFindMany.mock.calls[0]?.[0];
    expect(call?.select).toEqual({
      action: true,
      userAgent: true,
      metadata: true,
      createdAt: true,
    });
  });

  it('queries every domain with a userId filter (defense in depth)', async () => {
    await buildUserDataExport('u1');
    // Each finder receives `{ where: { userId: 'u1' } }` (annotations use the
    // `trade` relation filter).
    expect(tradeFindMany.mock.calls[0]?.[0]?.where).toEqual({ userId: 'u1' });
    expect(tradeAnnotationFindMany.mock.calls[0]?.[0]?.where).toEqual({ trade: { userId: 'u1' } });
    expect(dailyCheckinFindMany.mock.calls[0]?.[0]?.where).toEqual({ userId: 'u1' });
    expect(behavioralScoreFindMany.mock.calls[0]?.[0]?.where).toEqual({ userId: 'u1' });
    expect(douglasDeliveryFindMany.mock.calls[0]?.[0]?.where).toEqual({ userId: 'u1' });
    expect(douglasFavoriteFindMany.mock.calls[0]?.[0]?.where).toEqual({ userId: 'u1' });
    expect(weeklyReportFindMany.mock.calls[0]?.[0]?.where).toEqual({ userId: 'u1' });
    expect(pushSubscriptionFindMany.mock.calls[0]?.[0]?.where).toEqual({ userId: 'u1' });
    expect(notificationPreferenceFindMany.mock.calls[0]?.[0]?.where).toEqual({ userId: 'u1' });
    expect(notificationQueueFindMany.mock.calls[0]?.[0]?.where).toEqual({ userId: 'u1' });
    expect(auditLogFindMany.mock.calls[0]?.[0]?.where).toEqual({ userId: 'u1' });
  });
});

describe('summariseExport', () => {
  it('counts every section', () => {
    const summary = summariseExport({
      schemaVersion: 1,
      exportedAt: '2026-05-08T10:00:00.000Z',
      notes: { source: 's', contact: 'c', schemaDocumentation: 'd' },
      user: null,
      trades: [{}, {}, {}] as never,
      tradeAnnotations: [{}] as never,
      dailyCheckins: [{}, {}] as never,
      behavioralScores: [],
      douglasDeliveries: [{}] as never,
      douglasFavorites: [],
      weeklyReports: [{}] as never,
      pushSubscriptions: [{}, {}] as never,
      notificationPreferences: [{}] as never,
      notificationQueue: [],
      auditLogs: [{}, {}, {}, {}] as never,
    });
    expect(summary).toMatchObject({
      schemaVersion: 1,
      tradeCount: 3,
      tradeAnnotationCount: 1,
      dailyCheckinCount: 2,
      behavioralScoreCount: 0,
      douglasDeliveryCount: 1,
      douglasFavoriteCount: 0,
      weeklyReportCount: 1,
      pushSubscriptionCount: 2,
      notificationPreferenceCount: 1,
      notificationQueueCount: 0,
      auditLogCount: 4,
    });
  });
});

describe('buildExportFilename', () => {
  it('uses the last 6 characters of the userId + the local-day date', () => {
    const filename = buildExportFilename(
      {
        schemaVersion: 1,
        exportedAt: '2026-05-08T10:24:00.000Z',
        notes: { source: 's', contact: 'c', schemaDocumentation: 'd' },
        user: null,
        trades: [],
        tradeAnnotations: [],
        dailyCheckins: [],
        behavioralScores: [],
        douglasDeliveries: [],
        douglasFavorites: [],
        weeklyReports: [],
        pushSubscriptions: [],
        notificationPreferences: [],
        notificationQueue: [],
        auditLogs: [],
      },
      'cuid_abcdefghij',
    );
    // userId is 15 chars, slice(-6) takes the last 6 → "efghij".
    expect(filename).toBe('fxmily-data-efghij-2026-05-08.json');
  });
});
