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
    expect(snap.notes.contact).toBe('eliot@fxmilyapp.com');
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

// =============================================================================
// J10 Phase A — extended edge cases (added 2026-05-09)
// =============================================================================

const EMPTY_SNAPSHOT_FIELDS = {
  schemaVersion: 1 as const,
  exportedAt: '2026-05-08T10:00:00.000Z',
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
};

describe('buildUserDataExport — fresh-user / empty-state', () => {
  // Why this edge case matters : a user that just signed up but never
  // submitted any trade or check-in must still get a valid, schema-versioned
  // export (article 20 GDPR — even an empty dataset must be portable). The
  // snapshot must NOT throw because every section is empty.
  it('returns valid empty-array sections for a brand-new user with zero data anywhere', async () => {
    userFindUnique.mockResolvedValueOnce({
      id: 'u_fresh',
      email: 'fresh@example.com',
      emailVerified: null,
      firstName: null,
      lastName: null,
      image: null,
      role: 'member',
      status: 'active',
      timezone: 'Europe/Paris',
      consentRgpdAt: null,
      joinedAt: new Date('2026-05-08T08:00:00Z'),
      lastSeenAt: null,
      createdAt: new Date('2026-05-08T08:00:00Z'),
      updatedAt: new Date('2026-05-08T08:00:00Z'),
      deletedAt: null,
    });

    const snap = await buildUserDataExport('u_fresh');

    // Every collection is an empty array (not null, not undefined).
    expect(snap.trades).toEqual([]);
    expect(snap.tradeAnnotations).toEqual([]);
    expect(snap.dailyCheckins).toEqual([]);
    expect(snap.behavioralScores).toEqual([]);
    expect(snap.douglasDeliveries).toEqual([]);
    expect(snap.douglasFavorites).toEqual([]);
    expect(snap.weeklyReports).toEqual([]);
    expect(snap.pushSubscriptions).toEqual([]);
    expect(snap.notificationPreferences).toEqual([]);
    expect(snap.notificationQueue).toEqual([]);
    expect(snap.auditLogs).toEqual([]);
    // User itself is hydrated.
    expect(snap.user?.email).toBe('fresh@example.com');
    // Summary on a fresh snapshot must be all zeros.
    const summary = summariseExport(snap);
    expect(summary.tradeCount).toBe(0);
    expect(summary.auditLogCount).toBe(0);
  });

  // Why this edge case matters : a heavy-trader with thousands of trades
  // could push the JSON payload to a size that breaks downloads (browser
  // memory / R2 egress / Cloudflare 100 MB limit). We sanity-check that the
  // serialised payload for 5000 minimal trades stays well under 50 MB so the
  // current architecture (single in-memory JSON.stringify) is safe at the V1
  // member cap of ~1000.
  it('keeps JSON payload < 50 MB even for a power-user with 5000 trades (sanity check)', async () => {
    const largeTrades = Array.from({ length: 5000 }, (_, i) => ({
      id: `trade_${i}`,
      userId: 'u_power',
      pair: 'EURUSD',
      direction: 'long',
      entryPrice: 1.085 + i * 0.0001,
      exitPrice: 1.087,
      size: 0.1,
      pnl: 200,
      openedAt: new Date('2026-05-08T08:00:00Z'),
      closedAt: new Date('2026-05-08T09:00:00Z'),
      createdAt: new Date('2026-05-08T09:00:00Z'),
      updatedAt: new Date('2026-05-08T09:00:00Z'),
      session: 'london',
      notes: null,
      screenshots: [],
    }));
    tradeFindMany.mockResolvedValueOnce(largeTrades);
    userFindUnique.mockResolvedValueOnce({
      id: 'u_power',
      email: 'power@example.com',
      emailVerified: null,
      firstName: null,
      lastName: null,
      image: null,
      role: 'member',
      status: 'active',
      timezone: 'Europe/Paris',
      consentRgpdAt: null,
      joinedAt: new Date('2026-01-01T00:00:00Z'),
      lastSeenAt: null,
      createdAt: new Date('2026-01-01T00:00:00Z'),
      updatedAt: new Date('2026-05-08T08:00:00Z'),
      deletedAt: null,
    });

    const snap = await buildUserDataExport('u_power');
    const serialised = JSON.stringify(snap);
    const sizeBytes = Buffer.byteLength(serialised, 'utf8');
    const sizeMb = sizeBytes / (1024 * 1024);

    expect(snap.trades.length).toBe(5000);
    // Sanity ceiling : 5000 trades should stay well below 50 MB. If this
    // assertion ever trips, the route handler needs streaming JSON.
    expect(sizeMb).toBeLessThan(50);
  });
});

describe('summariseExport — defensive shape handling', () => {
  // Why this edge case matters : `summariseExport` is also called from the
  // POST route to build the audit metadata. If a future schema change adds
  // an unexpected extra field on the snapshot (e.g. a V2 `subscriptions`
  // section), the summariser must not crash on the existing keys. We pin
  // that the function only reads the well-known keys it knows about.
  it('ignores foreign / unknown fields on the snapshot (forward-compat)', () => {
    const snap = {
      ...EMPTY_SNAPSHOT_FIELDS,
      trades: [{}, {}] as never,
      // Foreign field that doesn't exist in the type — added by a hypothetical
      // future schema. The summariser must remain a pure projection.
      mysteryFutureSection: [{}, {}, {}],
      anotherUnknownKey: 'value',
    } as unknown as Parameters<typeof summariseExport>[0];

    const summary = summariseExport(snap);

    expect(summary.tradeCount).toBe(2);
    // No unknown counter snuck into the output.
    expect(Object.keys(summary)).toEqual([
      'schemaVersion',
      'tradeCount',
      'tradeAnnotationCount',
      'dailyCheckinCount',
      'behavioralScoreCount',
      'douglasDeliveryCount',
      'douglasFavoriteCount',
      'weeklyReportCount',
      'pushSubscriptionCount',
      'notificationPreferenceCount',
      'notificationQueueCount',
      'auditLogCount',
    ]);
  });
});

describe('buildExportFilename — userId edge cases', () => {
  // Why this edge case matters : while real cuids are 25 chars, defensive
  // handling of a shorter userId (test data, support tooling, future ID
  // format change) must not crash or produce a malformed filename. With a
  // 5-char userId, slice(-6) returns the entire string (5 chars).
  it('handles a userId shorter than 6 chars by using the whole string', () => {
    const filename = buildExportFilename(
      { ...EMPTY_SNAPSHOT_FIELDS, exportedAt: '2026-05-08T10:00:00.000Z' },
      'u1234',
    );
    expect(filename).toBe('fxmily-data-u1234-2026-05-08.json');
  });

  // Why this edge case matters : a 1-char userId still produces a valid,
  // non-empty filename. We pin this so any future "minimum length" bug
  // (e.g. forgetting the slice fallback) is caught.
  it('still produces a valid filename for a 1-char userId', () => {
    const filename = buildExportFilename(
      { ...EMPTY_SNAPSHOT_FIELDS, exportedAt: '2026-05-08T10:00:00.000Z' },
      'a',
    );
    expect(filename).toBe('fxmily-data-a-2026-05-08.json');
    expect(filename).toMatch(/^fxmily-data-.+-\d{4}-\d{2}-\d{2}\.json$/);
  });
});
