import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { beforeEach, describe, expect, it, vi } from 'vitest';

const userFindUnique = vi.fn();
const tradeFindMany = vi.fn();
const tradeAnnotationFindMany = vi.fn();
const tradeMediaFindMany = vi.fn();
const dailyCheckinFindMany = vi.fn();
const behavioralScoreFindMany = vi.fn();
const douglasDeliveryFindMany = vi.fn();
const douglasFavoriteFindMany = vi.fn();
const weeklyReportFindMany = vi.fn();
const pushSubscriptionFindMany = vi.fn();
const notificationPreferenceFindMany = vi.fn();
const notificationQueueFindMany = vi.fn();
const auditLogFindMany = vi.fn();
// Session 21 — behavioural / psychological surface.
const weeklyReviewFindMany = vi.fn();
const reflectionEntryFindMany = vi.fn();
const habitLogFindMany = vi.fn();
const trainingTradeFindMany = vi.fn();
const trainingAnnotationFindMany = vi.fn();
const trainingDebriefFindMany = vi.fn();
const trainingSessionFindMany = vi.fn();
const monthlyDebriefFindMany = vi.fn();
const mindsetCheckFindMany = vi.fn();
const preTradeCheckFindMany = vi.fn();
const onboardingInterviewFindFirst = vi.fn();
const onboardingInterviewAnswerFindMany = vi.fn();
const memberProfileFindFirst = vi.fn();
const memberProfileMonthlySnapshotFindMany = vi.fn();
const weeklyScheduleQuestionnaireFindMany = vi.fn();
const adaptiveCalendarFindMany = vi.fn();
const meetingAttendanceFindMany = vi.fn();
const brokerAccountFindMany = vi.fn();
const mt5AccountProofFindMany = vi.fn();
const discrepancyFindMany = vi.fn();
const constancyScoreFindMany = vi.fn();
const scoreEventFindMany = vi.fn();
const alertFindMany = vi.fn();
// V2 S2 — universal tracking engine.
const trackingEntryFindMany = vi.fn();
const trackingScheduleFindMany = vi.fn();
// S5 §32-E3 — mental micro-objective loops.
const mentalMicroObjectiveFindMany = vi.fn();

vi.mock('@/lib/db', () => ({
  db: {
    user: { findUnique: userFindUnique },
    trade: { findMany: tradeFindMany },
    tradeAnnotation: { findMany: tradeAnnotationFindMany },
    tradeMedia: { findMany: tradeMediaFindMany },
    dailyCheckin: { findMany: dailyCheckinFindMany },
    behavioralScore: { findMany: behavioralScoreFindMany },
    markDouglasDelivery: { findMany: douglasDeliveryFindMany },
    markDouglasFavorite: { findMany: douglasFavoriteFindMany },
    weeklyReport: { findMany: weeklyReportFindMany },
    pushSubscription: { findMany: pushSubscriptionFindMany },
    notificationPreference: { findMany: notificationPreferenceFindMany },
    notificationQueue: { findMany: notificationQueueFindMany },
    auditLog: { findMany: auditLogFindMany },
    weeklyReview: { findMany: weeklyReviewFindMany },
    reflectionEntry: { findMany: reflectionEntryFindMany },
    habitLog: { findMany: habitLogFindMany },
    trainingTrade: { findMany: trainingTradeFindMany },
    trainingAnnotation: { findMany: trainingAnnotationFindMany },
    trainingDebrief: { findMany: trainingDebriefFindMany },
    trainingSession: { findMany: trainingSessionFindMany },
    monthlyDebrief: { findMany: monthlyDebriefFindMany },
    mindsetCheck: { findMany: mindsetCheckFindMany },
    preTradeCheck: { findMany: preTradeCheckFindMany },
    onboardingInterview: { findFirst: onboardingInterviewFindFirst },
    onboardingInterviewAnswer: { findMany: onboardingInterviewAnswerFindMany },
    memberProfile: { findFirst: memberProfileFindFirst },
    memberProfileMonthlySnapshot: { findMany: memberProfileMonthlySnapshotFindMany },
    weeklyScheduleQuestionnaire: { findMany: weeklyScheduleQuestionnaireFindMany },
    adaptiveCalendar: { findMany: adaptiveCalendarFindMany },
    meetingAttendance: { findMany: meetingAttendanceFindMany },
    brokerAccount: { findMany: brokerAccountFindMany },
    mt5AccountProof: { findMany: mt5AccountProofFindMany },
    discrepancy: { findMany: discrepancyFindMany },
    constancyScore: { findMany: constancyScoreFindMany },
    scoreEvent: { findMany: scoreEventFindMany },
    alert: { findMany: alertFindMany },
    trackingEntry: { findMany: trackingEntryFindMany },
    trackingSchedule: { findMany: trackingScheduleFindMany },
    mentalMicroObjective: { findMany: mentalMicroObjectiveFindMany },
  },
}));

const {
  EXPORT_SCHEMA_VERSION,
  EXPORTED_USER_RELATIONS,
  EXCLUDED_USER_RELATIONS,
  buildExportFilename,
  buildUserDataExport,
  summariseExport,
} = await import('./export');

const ALL_FIND_MANY = [
  tradeFindMany,
  tradeAnnotationFindMany,
  tradeMediaFindMany,
  dailyCheckinFindMany,
  behavioralScoreFindMany,
  douglasDeliveryFindMany,
  douglasFavoriteFindMany,
  weeklyReportFindMany,
  pushSubscriptionFindMany,
  notificationPreferenceFindMany,
  notificationQueueFindMany,
  auditLogFindMany,
  weeklyReviewFindMany,
  reflectionEntryFindMany,
  habitLogFindMany,
  trainingTradeFindMany,
  trainingAnnotationFindMany,
  trainingDebriefFindMany,
  trainingSessionFindMany,
  monthlyDebriefFindMany,
  mindsetCheckFindMany,
  preTradeCheckFindMany,
  onboardingInterviewAnswerFindMany,
  memberProfileMonthlySnapshotFindMany,
  weeklyScheduleQuestionnaireFindMany,
  adaptiveCalendarFindMany,
  meetingAttendanceFindMany,
  brokerAccountFindMany,
  mt5AccountProofFindMany,
  discrepancyFindMany,
  constancyScoreFindMany,
  scoreEventFindMany,
  alertFindMany,
  trackingEntryFindMany,
  trackingScheduleFindMany,
  mentalMicroObjectiveFindMany,
];

beforeEach(() => {
  userFindUnique.mockReset();
  onboardingInterviewFindFirst.mockReset();
  memberProfileFindFirst.mockReset();
  for (const fn of ALL_FIND_MANY) fn.mockReset();

  // Default empty results for all readers — tests override what they need.
  userFindUnique.mockResolvedValue(null);
  onboardingInterviewFindFirst.mockResolvedValue(null);
  memberProfileFindFirst.mockResolvedValue(null);
  for (const fn of ALL_FIND_MANY) fn.mockResolvedValue([]);
});

const SAFE_USER = {
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
};

// Complete empty snapshot — every required field present so fixtures stay
// type-safe as the export shape grows.
const EMPTY_SNAPSHOT = {
  schemaVersion: EXPORT_SCHEMA_VERSION,
  exportedAt: '2026-05-08T10:00:00.000Z',
  notes: { source: 's', contact: 'c', schemaDocumentation: 'd' },
  user: null,
  trades: [],
  tradeAnnotations: [],
  tradeMedia: [],
  dailyCheckins: [],
  behavioralScores: [],
  douglasDeliveries: [],
  douglasFavorites: [],
  weeklyReports: [],
  pushSubscriptions: [],
  notificationPreferences: [],
  notificationQueue: [],
  auditLogs: [],
  weeklyReviews: [],
  reflectionEntries: [],
  habitLogs: [],
  trainingTrades: [],
  trainingAnnotations: [],
  trainingDebriefs: [],
  trainingSessions: [],
  monthlyDebriefs: [],
  mindsetChecks: [],
  preTradeChecks: [],
  onboardingInterview: null,
  onboardingAnswers: [],
  memberProfile: null,
  memberProfileMonthlySnapshots: [],
  weeklyScheduleQuestionnaires: [],
  adaptiveCalendars: [],
  meetingAttendances: [],
  brokerAccounts: [],
  mt5AccountProofs: [],
  discrepancies: [],
  constancyScores: [],
  scoreEvents: [],
  alerts: [],
  trackingEntries: [],
  trackingSchedules: [],
  mentalMicroObjectives: [],
} satisfies Parameters<typeof summariseExport>[0];

describe('buildUserDataExport', () => {
  it('returns the schema-versioned snapshot with empty arrays on a fresh user', async () => {
    userFindUnique.mockResolvedValueOnce(SAFE_USER);

    const snap = await buildUserDataExport('u1');

    expect(snap.schemaVersion).toBe(EXPORT_SCHEMA_VERSION);
    expect(snap.user?.email).toBe('eliot@example.com');
    expect(snap.trades).toEqual([]);
    expect(snap.notes.contact).toBe('fxeliott@fxmily.fr');
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

  it('queries every domain with the correct ownership filter (defense in depth)', async () => {
    await buildUserDataExport('u1');
    // `userId`-keyed modules.
    expect(tradeFindMany.mock.calls[0]?.[0]?.where).toEqual({ userId: 'u1' });
    expect(tradeAnnotationFindMany.mock.calls[0]?.[0]?.where).toEqual({ trade: { userId: 'u1' } });
    // §31 — derived bucket via the parent trade's owner (mirror tradeAnnotation).
    expect(tradeMediaFindMany.mock.calls[0]?.[0]?.where).toEqual({ trade: { userId: 'u1' } });
    expect(dailyCheckinFindMany.mock.calls[0]?.[0]?.where).toEqual({ userId: 'u1' });
    expect(behavioralScoreFindMany.mock.calls[0]?.[0]?.where).toEqual({ userId: 'u1' });
    expect(douglasDeliveryFindMany.mock.calls[0]?.[0]?.where).toEqual({ userId: 'u1' });
    expect(douglasFavoriteFindMany.mock.calls[0]?.[0]?.where).toEqual({ userId: 'u1' });
    expect(weeklyReportFindMany.mock.calls[0]?.[0]?.where).toEqual({ userId: 'u1' });
    expect(pushSubscriptionFindMany.mock.calls[0]?.[0]?.where).toEqual({ userId: 'u1' });
    expect(notificationPreferenceFindMany.mock.calls[0]?.[0]?.where).toEqual({ userId: 'u1' });
    expect(notificationQueueFindMany.mock.calls[0]?.[0]?.where).toEqual({ userId: 'u1' });
    expect(auditLogFindMany.mock.calls[0]?.[0]?.where).toEqual({ userId: 'u1' });
    expect(weeklyReviewFindMany.mock.calls[0]?.[0]?.where).toEqual({ userId: 'u1' });
    expect(reflectionEntryFindMany.mock.calls[0]?.[0]?.where).toEqual({ userId: 'u1' });
    expect(habitLogFindMany.mock.calls[0]?.[0]?.where).toEqual({ userId: 'u1' });
    expect(trainingTradeFindMany.mock.calls[0]?.[0]?.where).toEqual({ userId: 'u1' });
    expect(trainingAnnotationFindMany.mock.calls[0]?.[0]?.where).toEqual({
      trainingTrade: { is: { userId: 'u1' } },
    });
    expect(trainingDebriefFindMany.mock.calls[0]?.[0]?.where).toEqual({ userId: 'u1' });
    expect(monthlyDebriefFindMany.mock.calls[0]?.[0]?.where).toEqual({ userId: 'u1' });
    expect(mindsetCheckFindMany.mock.calls[0]?.[0]?.where).toEqual({ userId: 'u1' });
    expect(preTradeCheckFindMany.mock.calls[0]?.[0]?.where).toEqual({ userId: 'u1' });
    expect(onboardingInterviewFindFirst.mock.calls[0]?.[0]?.where).toEqual({ userId: 'u1' });
    expect(onboardingInterviewAnswerFindMany.mock.calls[0]?.[0]?.where).toEqual({ userId: 'u1' });
    expect(memberProfileFindFirst.mock.calls[0]?.[0]?.where).toEqual({ userId: 'u1' });
    expect(weeklyScheduleQuestionnaireFindMany.mock.calls[0]?.[0]?.where).toEqual({ userId: 'u1' });
    expect(adaptiveCalendarFindMany.mock.calls[0]?.[0]?.where).toEqual({ userId: 'u1' });
    expect(meetingAttendanceFindMany.mock.calls[0]?.[0]?.where).toEqual({ userId: 'u1' });
    // `memberId`-keyed modules (S3 verification + training-session containers).
    expect(trainingSessionFindMany.mock.calls[0]?.[0]?.where).toEqual({ memberId: 'u1' });
    expect(brokerAccountFindMany.mock.calls[0]?.[0]?.where).toEqual({ memberId: 'u1' });
    expect(mt5AccountProofFindMany.mock.calls[0]?.[0]?.where).toEqual({ memberId: 'u1' });
    expect(discrepancyFindMany.mock.calls[0]?.[0]?.where).toEqual({ memberId: 'u1' });
    expect(constancyScoreFindMany.mock.calls[0]?.[0]?.where).toEqual({ memberId: 'u1' });
    expect(scoreEventFindMany.mock.calls[0]?.[0]?.where).toEqual({ memberId: 'u1' });
    expect(alertFindMany.mock.calls[0]?.[0]?.where).toEqual({ memberId: 'u1' });
    // V2 S2 — universal tracking engine (member-owned, `userId`-keyed).
    expect(trackingEntryFindMany.mock.calls[0]?.[0]?.where).toEqual({ userId: 'u1' });
    expect(trackingScheduleFindMany.mock.calls[0]?.[0]?.where).toEqual({ userId: 'u1' });
    // S5 §32-E3 — mental micro-objectives (member-owned, `memberId`-keyed).
    expect(mentalMicroObjectiveFindMany.mock.calls[0]?.[0]?.where).toEqual({ memberId: 'u1' });
  });

  it('exports the behavioural / psychological surface added in Session 21', async () => {
    userFindUnique.mockResolvedValueOnce(SAFE_USER);
    mindsetCheckFindMany.mockResolvedValueOnce([{ id: 'm1' }, { id: 'm2' }]);
    reflectionEntryFindMany.mockResolvedValueOnce([{ id: 'r1' }]);
    onboardingInterviewFindFirst.mockResolvedValueOnce({ id: 'oi1' });
    memberProfileFindFirst.mockResolvedValueOnce({ id: 'mp1' });
    alertFindMany.mockResolvedValueOnce([{ id: 'a1' }, { id: 'a2' }, { id: 'a3' }]);

    const snap = await buildUserDataExport('u1');

    expect(snap.mindsetChecks).toHaveLength(2);
    expect(snap.reflectionEntries).toHaveLength(1);
    expect(snap.onboardingInterview).toEqual({ id: 'oi1' });
    expect(snap.memberProfile).toEqual({ id: 'mp1' });
    expect(snap.alerts).toHaveLength(3);

    const summary = summariseExport(snap);
    expect(summary.mindsetCheckCount).toBe(2);
    expect(summary.onboardingInterviewCount).toBe(1);
    expect(summary.memberProfileCount).toBe(1);
    expect(summary.alertCount).toBe(3);
  });

  it('exports the J-E monthly deep re-profiling snapshots (RGPD art.15, member-scoped)', async () => {
    userFindUnique.mockResolvedValueOnce(SAFE_USER);
    memberProfileMonthlySnapshotFindMany.mockResolvedValueOnce([
      { id: 's1', monthStart: new Date('2026-06-01') },
      { id: 's2', monthStart: new Date('2026-07-01') },
    ]);

    const snap = await buildUserDataExport('u1');

    expect(snap.memberProfileMonthlySnapshots).toHaveLength(2);
    expect(summariseExport(snap).memberProfileMonthlySnapshotCount).toBe(2);
    // Member-scoped read (never a cross-member leak) + chronological order.
    const call = memberProfileMonthlySnapshotFindMany.mock.calls[0]?.[0];
    expect(call?.where).toEqual({ userId: 'u1' });
    expect(call?.orderBy).toEqual({ monthStart: 'asc' });
  });
});

// =============================================================================
// Session 21 — RGPD portability COVERAGE CONTRACT
// =============================================================================

describe('export coverage contract — every User relation is classified', () => {
  // Why this guard matters : the previous export silently covered only 12 of
  // the ~39 `User` relations while the UI promised "100% of your data" — a
  // GDPR art.20 misrepresentation. This test parses the live Prisma schema and
  // fails if ANY `User` relation is neither exported nor explicitly
  // whitelisted-excluded, turning a silent drift into a hard failure.
  //
  // NOTE: if a future change adds a new *enum*-typed field to `User`, add it to
  // `USER_ENUM_TYPES` below (the parser can't tell a custom enum from a model
  // relation by syntax alone). A failure here means "classify the new relation".
  const SCALAR_TYPES = new Set([
    'String',
    'Int',
    'BigInt',
    'Float',
    'Decimal',
    'Boolean',
    'DateTime',
    'Json',
    'Bytes',
  ]);
  const USER_ENUM_TYPES = new Set(['UserRole', 'UserStatus']);

  function parseUserRelationFields(): string[] {
    const schemaPath = fileURLToPath(new URL('../../../prisma/schema.prisma', import.meta.url));
    const schema = readFileSync(schemaPath, 'utf8');
    const block = schema.match(/^model User \{([\s\S]*?)^\}/m)?.[1];
    if (!block) throw new Error('Could not locate `model User` block in schema.prisma');

    const fields: string[] = [];
    for (const rawLine of block.split('\n')) {
      const m = rawLine.match(/^\s+([a-zA-Z][a-zA-Z0-9_]*)\s+([A-Za-z][A-Za-z0-9_]*)(\[\]|\?)?/);
      if (!m) continue; // comments (//, ///), @@attributes, blank lines
      const field = m[1]!;
      const type = m[2]!;
      if (SCALAR_TYPES.has(type) || USER_ENUM_TYPES.has(type)) continue;
      fields.push(field);
    }
    return fields;
  }

  it('parses a plausible number of User relations from the schema', () => {
    const relations = parseUserRelationFields();
    // Sanity floor — if the parser silently matches nothing, the coverage
    // assertions below would pass vacuously.
    expect(relations.length).toBeGreaterThan(20);
  });

  it('classifies every User relation as exported XOR excluded (no silent gap)', () => {
    const relations = parseUserRelationFields();
    const exported = new Set<string>(EXPORTED_USER_RELATIONS);
    const excluded = new Set<string>(Object.keys(EXCLUDED_USER_RELATIONS));

    const unclassified = relations.filter((r) => !exported.has(r) && !excluded.has(r));
    expect(unclassified, `Unclassified User relations: ${unclassified.join(', ')}`).toEqual([]);
  });

  it('has no stale entries in the exported/excluded lists (must exist in schema)', () => {
    const relations = new Set(parseUserRelationFields());
    const stale = [...EXPORTED_USER_RELATIONS, ...Object.keys(EXCLUDED_USER_RELATIONS)].filter(
      (r) => !relations.has(r),
    );
    expect(stale, `Listed relations absent from schema: ${stale.join(', ')}`).toEqual([]);
  });

  it('keeps exported and excluded sets disjoint', () => {
    const excluded = new Set(Object.keys(EXCLUDED_USER_RELATIONS));
    const overlap = EXPORTED_USER_RELATIONS.filter((r) => excluded.has(r));
    expect(overlap, `Relations both exported and excluded: ${overlap.join(', ')}`).toEqual([]);
  });
});

// =============================================================================
// RC#4 — Trade-transitive PII coverage contract
// =============================================================================

describe('export coverage contract — Trade child relations (transitive PII)', () => {
  // Why this guard matters : `TradeMedia` silently leaked OUT of the export for
  // weeks. The `model User` guard above can't catch it — TradeMedia hangs off
  // `Trade`, not `User`, so it never appears as a User relation. The deletion
  // path (`account/deletion.ts`) DID purge `media.fileKey` as member PII, but
  // the art.20 export never read it. This guard parses `model Trade` and fails
  // if any 1-N child table (member PII queried via the parent trade's owner) is
  // not classified — turning the next "table under Trade" into a hard failure.
  const SCALAR_TYPES = new Set([
    'String',
    'Int',
    'BigInt',
    'Float',
    'Decimal',
    'Boolean',
    'DateTime',
    'Json',
    'Bytes',
  ]);

  // How each 1-N child relation of `Trade` is covered by the export.
  const TRADE_CHILD_COVERAGE: Readonly<Record<string, string>> = {
    annotations: 'Exported as the derived `tradeAnnotations` bucket (corrections received).',
    media: 'Exported as the derived `tradeMedia` bucket (§31 multi-capture screenshots).',
    discrepancies: 'Exported via the member-scoped `discrepancies` reader (memberId-keyed).',
  };

  function parseTradeListRelations(): string[] {
    const schemaPath = fileURLToPath(new URL('../../../prisma/schema.prisma', import.meta.url));
    const schema = readFileSync(schemaPath, 'utf8');
    const block = schema.match(/^model Trade \{([\s\S]*?)^\}/m)?.[1];
    if (!block) throw new Error('Could not locate `model Trade` block in schema.prisma');

    const fields: string[] = [];
    for (const rawLine of block.split('\n')) {
      // Only list relations (`Type[]`). Scalar arrays (e.g. `tags String[]`)
      // are member content already inside the exported Trade row, not a
      // separate table — excluded by the SCALAR_TYPES check.
      const m = rawLine.match(/^\s+([a-zA-Z][a-zA-Z0-9_]*)\s+([A-Za-z][A-Za-z0-9_]*)\[\]/);
      if (!m) continue;
      const field = m[1]!;
      const type = m[2]!;
      if (SCALAR_TYPES.has(type)) continue;
      fields.push(field);
    }
    return fields;
  }

  it('parses the expected Trade child relations from the schema', () => {
    const children = parseTradeListRelations();
    expect(children).toContain('media');
    expect(children).toContain('annotations');
  });

  it('classifies every Trade child relation (no silent transitive PII gap)', () => {
    const children = parseTradeListRelations();
    const classified = new Set(Object.keys(TRADE_CHILD_COVERAGE));
    const unclassified = children.filter((c) => !classified.has(c));
    expect(
      unclassified,
      `Unclassified Trade child relations (member PII not covered by export): ${unclassified.join(', ')}`,
    ).toEqual([]);
  });

  it('has no stale Trade-child classifications (must exist in schema)', () => {
    const children = new Set(parseTradeListRelations());
    const stale = Object.keys(TRADE_CHILD_COVERAGE).filter((c) => !children.has(c));
    expect(stale, `Listed Trade children absent from schema: ${stale.join(', ')}`).toEqual([]);
  });
});

describe('summariseExport', () => {
  it('counts every section', () => {
    const summary = summariseExport({
      ...EMPTY_SNAPSHOT,
      trades: [{}, {}, {}] as never,
      tradeAnnotations: [{}] as never,
      tradeMedia: [{}, {}] as never,
      dailyCheckins: [{}, {}] as never,
      douglasDeliveries: [{}] as never,
      weeklyReports: [{}] as never,
      pushSubscriptions: [{}, {}] as never,
      notificationPreferences: [{}] as never,
      auditLogs: [{}, {}, {}, {}] as never,
      habitLogs: [{}, {}, {}] as never,
      mindsetChecks: [{}, {}] as never,
      onboardingInterview: { id: 'oi' } as never,
      memberProfile: { id: 'mp' } as never,
      alerts: [{}, {}] as never,
    });
    expect(summary).toMatchObject({
      schemaVersion: EXPORT_SCHEMA_VERSION,
      tradeCount: 3,
      tradeAnnotationCount: 1,
      tradeMediaCount: 2,
      dailyCheckinCount: 2,
      behavioralScoreCount: 0,
      douglasDeliveryCount: 1,
      douglasFavoriteCount: 0,
      weeklyReportCount: 1,
      pushSubscriptionCount: 2,
      notificationPreferenceCount: 1,
      notificationQueueCount: 0,
      auditLogCount: 4,
      habitLogCount: 3,
      mindsetCheckCount: 2,
      onboardingInterviewCount: 1,
      memberProfileCount: 1,
      alertCount: 2,
    });
  });
});

describe('buildExportFilename', () => {
  it('uses the last 6 characters of the userId + the local-day date', () => {
    const filename = buildExportFilename(
      { ...EMPTY_SNAPSHOT, exportedAt: '2026-05-08T10:24:00.000Z' },
      'cuid_abcdefghij',
    );
    // userId is 15 chars, slice(-6) takes the last 6 → "efghij".
    expect(filename).toBe('fxmily-data-efghij-2026-05-08.json');
  });
});

// =============================================================================
// J10 Phase A — extended edge cases (added 2026-05-09)
// =============================================================================

describe('buildUserDataExport — fresh-user / empty-state', () => {
  // Why this edge case matters : a user that just signed up but never
  // submitted any trade or check-in must still get a valid, schema-versioned
  // export (article 20 GDPR — even an empty dataset must be portable). The
  // snapshot must NOT throw because every section is empty.
  it('returns valid empty-array sections for a brand-new user with zero data anywhere', async () => {
    userFindUnique.mockResolvedValueOnce({
      ...SAFE_USER,
      id: 'u_fresh',
      email: 'fresh@example.com',
      firstName: null,
      lastName: null,
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
    expect(snap.habitLogs).toEqual([]);
    expect(snap.trainingTrades).toEqual([]);
    expect(snap.constancyScores).toEqual([]);
    // Singular relations are null, not throwing.
    expect(snap.onboardingInterview).toBeNull();
    expect(snap.memberProfile).toBeNull();
    // User itself is hydrated.
    expect(snap.user?.email).toBe('fresh@example.com');
    // Summary on a fresh snapshot must be all zeros.
    const summary = summariseExport(snap);
    expect(summary.tradeCount).toBe(0);
    expect(summary.auditLogCount).toBe(0);
    expect(summary.onboardingInterviewCount).toBe(0);
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
      ...SAFE_USER,
      id: 'u_power',
      email: 'power@example.com',
      firstName: null,
      lastName: null,
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
      ...EMPTY_SNAPSHOT,
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
      'tradeMediaCount',
      'dailyCheckinCount',
      'behavioralScoreCount',
      'douglasDeliveryCount',
      'douglasFavoriteCount',
      'weeklyReportCount',
      'pushSubscriptionCount',
      'notificationPreferenceCount',
      'notificationQueueCount',
      'auditLogCount',
      'weeklyReviewCount',
      'reflectionEntryCount',
      'habitLogCount',
      'trainingTradeCount',
      'trainingAnnotationCount',
      'trainingDebriefCount',
      'trainingSessionCount',
      'monthlyDebriefCount',
      'mindsetCheckCount',
      'preTradeCheckCount',
      'onboardingInterviewCount',
      'onboardingAnswerCount',
      'memberProfileCount',
      'memberProfileMonthlySnapshotCount',
      'weeklyScheduleQuestionnaireCount',
      'adaptiveCalendarCount',
      'meetingAttendanceCount',
      'brokerAccountCount',
      'mt5AccountProofCount',
      'discrepancyCount',
      'constancyScoreCount',
      'scoreEventCount',
      'alertCount',
      'trackingEntryCount',
      'trackingScheduleCount',
      'mentalMicroObjectiveCount',
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
      { ...EMPTY_SNAPSHOT, exportedAt: '2026-05-08T10:00:00.000Z' },
      'u1234',
    );
    expect(filename).toBe('fxmily-data-u1234-2026-05-08.json');
  });

  // Why this edge case matters : a 1-char userId still produces a valid,
  // non-empty filename. We pin this so any future "minimum length" bug
  // (e.g. forgetting the slice fallback) is caught.
  it('still produces a valid filename for a 1-char userId', () => {
    const filename = buildExportFilename(
      { ...EMPTY_SNAPSHOT, exportedAt: '2026-05-08T10:00:00.000Z' },
      'a',
    );
    expect(filename).toBe('fxmily-data-a-2026-05-08.json');
    expect(filename).toMatch(/^fxmily-data-.+-\d{4}-\d{2}-\d{2}\.json$/);
  });
});
