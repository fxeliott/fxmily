import 'server-only';

import { db } from '@/lib/db';

/**
 * J10 — RGPD data portability (article 20 GDPR).
 *
 * Builds a JSON-serialisable snapshot of every user-owned row across the
 * Fxmily schema. Designed to be the source of truth for `/api/account/data/export`
 * (interactive) and any future support tooling (e.g. emailing a user their
 * own data).
 *
 * Coverage contract (Session 21) — the export MUST cover **every** user-owned
 * relation declared on the Prisma `User` model. The two arrays
 * `EXPORTED_USER_RELATIONS` / `EXCLUDED_USER_RELATIONS` enumerate that
 * classification, and `export.test.ts` parses `prisma/schema.prisma` and fails
 * if any `User` relation is neither exported nor explicitly whitelisted-excluded.
 * This turns a silent portability gap (a behavioural/psychological table missing
 * from the download) into a hard test failure.
 *
 * Sensitive-field policy — stripped before returning :
 *   - `passwordHash` (argon2id) — never leaves the DB.
 *   - `pushSubscription.p256dhKey` / `pushSubscription.authKey` — exposing
 *     them would let anyone forge a push to the user. The endpoint URL +
 *     timestamps are kept (it's the user's own data, useful for debugging
 *     "why did push stop working").
 *   - `auditLog.ipHash` — already a hash, but its value is correlation
 *     metadata controlled by the editor; sharing it back would let a user
 *     correlate sessions across devices, which is mostly useless and may
 *     enable account-takeover side channels. We expose `action`, `userAgent`,
 *     `metadata`, `createdAt` only.
 *   - `verificationToken.token` — single-use auth secrets, irrelevant once
 *     consumed.
 *   - OAuth `Account` tokens + `Session` rows — auth plumbing, not
 *     member-generated content; excluded from portability (see
 *     `EXCLUDED_USER_RELATIONS`).
 *
 * The behavioural / psychological tables added in Session 21 (training,
 * mindset, reflections, habits, pre-trade checks, onboarding profile, calendar,
 * meetings, MT5 verification) carry **no auth secret** — they are member-owned
 * content (the very heart of the "athlete tracking"), so they are exported as
 * full rows, exactly like `trades` / `dailyCheckins`. Storage keys (e.g.
 * `Mt5AccountProof.fileKey`, `TrainingTrade.entryScreenshotKey`) are opaque
 * references to the member's own uploads, not credentials.
 *
 * Output shape is versioned via `schemaVersion` so a future J11+ schema
 * change is non-breaking for users who keep historical exports.
 */

export const EXPORT_SCHEMA_VERSION = 2 as const;

/**
 * `User` relation fields whose data is included in the portability export.
 * Note: `tradeAnnotations` / `trainingAnnotations` / `tradeMedia` are exported
 * as derived buckets — they hang off `Trade`/`TrainingTrade`, not directly off
 * `User`, so they are NOT listed here (this array enumerates direct `User`
 * relations only). `tradeAnnotations` / `trainingAnnotations` are the
 * corrections a member RECEIVED (queried via the parent trade's `userId`); the
 * matching `User` relations `annotationsAuthored` / `trainingAnnotationsAuthored`
 * are the *admin-authored* side and live in `EXCLUDED_USER_RELATIONS`.
 * `tradeMedia` is the member's own multi-capture screenshots (`Trade.media`,
 * §31), queried the same way — the deletion path already purges these keys
 * (`account/deletion.ts`), so portability (art.20) must surface them too.
 * The Trade-transitive buckets are covered by the dedicated guard in
 * `export.test.ts` (parses `Trade` relations), not the `User`-relation guard.
 */
export const EXPORTED_USER_RELATIONS = [
  'auditLogs',
  'trades',
  'notificationsQueued',
  'dailyCheckins',
  'behavioralScores',
  'douglasDeliveries',
  'douglasFavorites',
  'weeklyReports',
  'pushSubscriptions',
  'notificationPreferences',
  'weeklyReviews',
  'reflectionEntries',
  'habitLogs',
  'trainingTrades',
  'trainingDebriefs',
  'trainingSessions',
  'monthlyDebriefs',
  'mindsetChecks',
  'preTradeChecks',
  'onboardingInterview',
  'onboardingAnswers',
  'memberProfile',
  // J-E — ADMIN-ONLY monthly deep re-profiling snapshots. Same 4-dim data class
  // as `memberProfile` (AI-derived FROM the member's own data → art.15 access
  // right); not a member coaching surface, but the member's own profiling, so
  // exported exactly like `memberProfile` / `monthlyDebriefs`.
  'memberProfileMonthlySnapshots',
  'weeklyScheduleQuestionnaires',
  'adaptiveCalendars',
  'meetingAttendances',
  'brokerAccounts',
  'mt5AccountProofs',
  'discrepancies',
  'constancyScores',
  'scoreEvents',
  'alerts',
  // V2 S2 — universal tracking engine: member-owned captured responses +
  // per-instrument cadence rows (no auth secret, no admin-only field → exported).
  'trackingEntries',
  'trackingSchedules',
  // S5 §32-E3 — mental micro-objectives: the member's own psychological
  // engagement loops (axis + curated intention + outcome). Member-owned
  // content, no auth secret, no link to the trading edge (§21.5) → exported.
  'mentalMicroObjectives',
] as const;

/**
 * `User` relations deliberately NOT in the member's self-service portability
 * export, each with a documented reason. Keeping this explicit (rather than
 * implicit-by-omission) is what lets the guard test prove total coverage.
 */
export const EXCLUDED_USER_RELATIONS: Readonly<Record<string, string>> = {
  // Auth plumbing — OAuth tokens are secrets; not member-generated content.
  accounts: 'OAuth account rows hold access/refresh tokens (secrets).',
  sessions: 'Ephemeral auth sessions — not portable member content.',
  passwordResetTokens:
    'Single-use password-reset secrets (SHA-256 hashed, ≤1 row/user, ~30-min TTL). Auth secret like verificationToken — not portable member content.',
  // Admin-authored data — the member is the SUBJECT, not the author.
  invitationsSent: 'Invitations are authored by the admin, never by a member.',
  annotationsAuthored:
    'Admin-authored trade corrections. The corrections a member RECEIVED are exported as the derived `tradeAnnotations` bucket.',
  trainingAnnotationsAuthored:
    'Admin-authored training corrections. Received ones are exported as the derived `trainingAnnotations` bucket.',
  adminNotesAbout:
    'Admin private coaching notes (SPEC §7.7) — controller-internal, not member self-service portability.',
  adminNotesAuthored: 'Admin-authored private notes — only the admin user owns these.',
  reviewedAccessRequests: 'Admin review actions on public access requests — not member data.',
  // F5 (overhaul) — moderation events are controller-internal admin decisions
  // (suspend / reinstate) with a subjective free-text motif + the acting admin's
  // identity, exactly like `adminNotesAbout`. Out of scope for the automated
  // art.20 self-service export (a member may still request them via a manual
  // art.15 access request to the controller).
  moderationEvents:
    'Admin moderation decisions about the member (suspend/reinstate + motif) — controller-internal, not member self-service portability.',
  moderationActionsTaken:
    'Moderation actions AUTHORED by an admin — only an admin is ever the actor, never a member.',
} as const;

export interface UserDataExport {
  schemaVersion: typeof EXPORT_SCHEMA_VERSION;
  exportedAt: string;
  notes: {
    source: string;
    contact: string;
    schemaDocumentation: string;
  };
  user: SafeUser | null;
  trades: SafeTrade[];
  tradeAnnotations: SafeTradeAnnotation[];
  // §31 — multi-capture screenshots attached to a member's own trades. Derived
  // bucket via `Trade.media` (hangs off Trade, not User). The deletion path
  // already treats these `fileKey`s as member PII; portability must match.
  tradeMedia: SafeTradeMedia[];
  dailyCheckins: SafeDailyCheckin[];
  behavioralScores: SafeBehavioralScore[];
  douglasDeliveries: SafeDouglasDelivery[];
  douglasFavorites: SafeDouglasFavorite[];
  weeklyReports: SafeWeeklyReport[];
  pushSubscriptions: SafePushSubscription[];
  notificationPreferences: SafeNotificationPreference[];
  notificationQueue: SafeNotificationQueueRow[];
  auditLogs: SafeAuditLog[];
  // Session 21 — behavioural / psychological tracking surface (previously
  // absent from the export despite the UI promising "100% of your data").
  weeklyReviews: SafeWeeklyReview[];
  reflectionEntries: SafeReflectionEntry[];
  habitLogs: SafeHabitLog[];
  trainingTrades: SafeTrainingTrade[];
  trainingAnnotations: SafeTrainingAnnotation[];
  trainingDebriefs: SafeTrainingDebrief[];
  trainingSessions: SafeTrainingSession[];
  monthlyDebriefs: SafeMonthlyDebrief[];
  mindsetChecks: SafeMindsetCheck[];
  preTradeChecks: SafePreTradeCheck[];
  onboardingInterview: SafeOnboardingInterview | null;
  onboardingAnswers: SafeOnboardingAnswer[];
  memberProfile: SafeMemberProfile | null;
  memberProfileMonthlySnapshots: SafeMemberProfileMonthlySnapshot[];
  weeklyScheduleQuestionnaires: SafeWeeklyScheduleQuestionnaire[];
  adaptiveCalendars: SafeAdaptiveCalendar[];
  meetingAttendances: SafeMeetingAttendance[];
  brokerAccounts: SafeBrokerAccount[];
  mt5AccountProofs: SafeMt5AccountProof[];
  discrepancies: SafeDiscrepancy[];
  constancyScores: SafeConstancyScore[];
  scoreEvents: SafeScoreEvent[];
  alerts: SafeAlert[];
  // V2 S2 — universal tracking engine captures + per-instrument cadence rows.
  trackingEntries: SafeTrackingEntry[];
  trackingSchedules: SafeTrackingSchedule[];
  // S5 §32-E3 — member's mental micro-objective engagement loops.
  mentalMicroObjectives: SafeMentalMicroObjective[];
}

// Whitelist DTOs : explicit `Pick<>` (or shaped literal) per row so a future
// schema addition does not silently leak through this endpoint. If a new
// sensitive field is added to a model, the type-check forces the developer
// to update this file.

type SafeUser = {
  id: string;
  email: string;
  emailVerified: Date | null;
  firstName: string | null;
  lastName: string | null;
  image: string | null;
  role: string;
  status: string;
  timezone: string;
  consentRgpdAt: Date | null;
  joinedAt: Date;
  lastSeenAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
};

type SafeTrade = Awaited<ReturnType<typeof db.trade.findMany>>[number];
type SafeTradeAnnotation = Awaited<ReturnType<typeof db.tradeAnnotation.findMany>>[number];
type SafeTradeMedia = Awaited<ReturnType<typeof db.tradeMedia.findMany>>[number];
type SafeDailyCheckin = Awaited<ReturnType<typeof db.dailyCheckin.findMany>>[number];
type SafeBehavioralScore = Awaited<ReturnType<typeof db.behavioralScore.findMany>>[number];
type SafeDouglasDelivery = Awaited<ReturnType<typeof db.markDouglasDelivery.findMany>>[number];
type SafeDouglasFavorite = Awaited<ReturnType<typeof db.markDouglasFavorite.findMany>>[number];
type SafeWeeklyReport = Awaited<ReturnType<typeof db.weeklyReport.findMany>>[number];
type SafeNotificationPreference = Awaited<
  ReturnType<typeof db.notificationPreference.findMany>
>[number];
type SafeNotificationQueueRow = Awaited<ReturnType<typeof db.notificationQueue.findMany>>[number];

// Session 21 — member-owned content tables (no auth secret → full row).
type SafeWeeklyReview = Awaited<ReturnType<typeof db.weeklyReview.findMany>>[number];
type SafeReflectionEntry = Awaited<ReturnType<typeof db.reflectionEntry.findMany>>[number];
type SafeHabitLog = Awaited<ReturnType<typeof db.habitLog.findMany>>[number];
type SafeTrainingTrade = Awaited<ReturnType<typeof db.trainingTrade.findMany>>[number];
type SafeTrainingAnnotation = Awaited<ReturnType<typeof db.trainingAnnotation.findMany>>[number];
type SafeTrainingDebrief = Awaited<ReturnType<typeof db.trainingDebrief.findMany>>[number];
type SafeTrainingSession = Awaited<ReturnType<typeof db.trainingSession.findMany>>[number];
type SafeMonthlyDebrief = Awaited<ReturnType<typeof db.monthlyDebrief.findMany>>[number];
type SafeMindsetCheck = Awaited<ReturnType<typeof db.mindsetCheck.findMany>>[number];
type SafePreTradeCheck = Awaited<ReturnType<typeof db.preTradeCheck.findMany>>[number];
type SafeOnboardingInterview = NonNullable<
  Awaited<ReturnType<typeof db.onboardingInterview.findFirst>>
>;
type SafeOnboardingAnswer = Awaited<
  ReturnType<typeof db.onboardingInterviewAnswer.findMany>
>[number];
type SafeMemberProfile = NonNullable<Awaited<ReturnType<typeof db.memberProfile.findFirst>>>;
type SafeMemberProfileMonthlySnapshot = Awaited<
  ReturnType<typeof db.memberProfileMonthlySnapshot.findMany>
>[number];
type SafeWeeklyScheduleQuestionnaire = Awaited<
  ReturnType<typeof db.weeklyScheduleQuestionnaire.findMany>
>[number];
type SafeAdaptiveCalendar = Awaited<ReturnType<typeof db.adaptiveCalendar.findMany>>[number];
type SafeMeetingAttendance = Awaited<ReturnType<typeof db.meetingAttendance.findMany>>[number];
type SafeBrokerAccount = Awaited<ReturnType<typeof db.brokerAccount.findMany>>[number];
type SafeMt5AccountProof = Awaited<ReturnType<typeof db.mt5AccountProof.findMany>>[number];
type SafeDiscrepancy = Awaited<ReturnType<typeof db.discrepancy.findMany>>[number];
type SafeConstancyScore = Awaited<ReturnType<typeof db.constancyScore.findMany>>[number];
type SafeScoreEvent = Awaited<ReturnType<typeof db.scoreEvent.findMany>>[number];
type SafeAlert = Awaited<ReturnType<typeof db.alert.findMany>>[number];
type SafeTrackingEntry = Awaited<ReturnType<typeof db.trackingEntry.findMany>>[number];
type SafeTrackingSchedule = Awaited<ReturnType<typeof db.trackingSchedule.findMany>>[number];
// S5 §32-E3 — mental micro-objective loops (member-owned, no auth secret).
type SafeMentalMicroObjective = Awaited<
  ReturnType<typeof db.mentalMicroObjective.findMany>
>[number];

type SafePushSubscription = {
  id: string;
  endpoint: string;
  userAgent: string | null;
  createdAt: Date;
  updatedAt: Date;
  lastSeenAt: Date | null;
};

type SafeAuditLog = {
  action: string;
  userAgent: string | null;
  metadata: unknown;
  createdAt: Date;
};

export interface ExportSummary {
  schemaVersion: typeof EXPORT_SCHEMA_VERSION;
  tradeCount: number;
  tradeAnnotationCount: number;
  tradeMediaCount: number;
  dailyCheckinCount: number;
  behavioralScoreCount: number;
  douglasDeliveryCount: number;
  douglasFavoriteCount: number;
  weeklyReportCount: number;
  pushSubscriptionCount: number;
  notificationPreferenceCount: number;
  notificationQueueCount: number;
  auditLogCount: number;
  weeklyReviewCount: number;
  reflectionEntryCount: number;
  habitLogCount: number;
  trainingTradeCount: number;
  trainingAnnotationCount: number;
  trainingDebriefCount: number;
  trainingSessionCount: number;
  monthlyDebriefCount: number;
  mindsetCheckCount: number;
  preTradeCheckCount: number;
  onboardingInterviewCount: number;
  onboardingAnswerCount: number;
  memberProfileCount: number;
  memberProfileMonthlySnapshotCount: number;
  weeklyScheduleQuestionnaireCount: number;
  adaptiveCalendarCount: number;
  meetingAttendanceCount: number;
  brokerAccountCount: number;
  mt5AccountProofCount: number;
  discrepancyCount: number;
  constancyScoreCount: number;
  scoreEventCount: number;
  alertCount: number;
  trackingEntryCount: number;
  trackingScheduleCount: number;
  mentalMicroObjectiveCount: number;
}

export async function buildUserDataExport(userId: string): Promise<UserDataExport> {
  // All user-scoped reads are run in parallel — they hit different tables
  // and Postgres handles the fan-out fine. At 30 → 1000 members per user
  // dataset this stays sub-second. Split into two batches purely for
  // readability; both fan out concurrently.
  const [
    user,
    trades,
    annotations,
    tradeMedia,
    checkins,
    scores,
    deliveries,
    favorites,
    reports,
    pushSubsRaw,
    preferences,
    queue,
    auditLogs,
  ] = await Promise.all([
    db.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        emailVerified: true,
        firstName: true,
        lastName: true,
        image: true,
        role: true,
        status: true,
        timezone: true,
        consentRgpdAt: true,
        joinedAt: true,
        lastSeenAt: true,
        createdAt: true,
        updatedAt: true,
        deletedAt: true,
      },
    }),
    db.trade.findMany({ where: { userId }, orderBy: { createdAt: 'asc' } }),
    db.tradeAnnotation.findMany({
      where: { trade: { userId } },
      orderBy: { createdAt: 'asc' },
    }),
    // §31 — member's own multi-capture screenshots. Derived via the parent
    // trade's `userId` (mirror `tradeAnnotation` above).
    db.tradeMedia.findMany({
      where: { trade: { userId } },
      orderBy: { createdAt: 'asc' },
    }),
    db.dailyCheckin.findMany({ where: { userId }, orderBy: { createdAt: 'asc' } }),
    db.behavioralScore.findMany({ where: { userId }, orderBy: { date: 'asc' } }),
    db.markDouglasDelivery.findMany({ where: { userId }, orderBy: { createdAt: 'asc' } }),
    db.markDouglasFavorite.findMany({ where: { userId }, orderBy: { createdAt: 'asc' } }),
    db.weeklyReport.findMany({ where: { userId }, orderBy: { weekStart: 'asc' } }),
    db.pushSubscription.findMany({
      where: { userId },
      select: {
        id: true,
        endpoint: true,
        userAgent: true,
        createdAt: true,
        updatedAt: true,
        lastSeenAt: true,
      },
      orderBy: { createdAt: 'asc' },
    }),
    db.notificationPreference.findMany({ where: { userId } }),
    db.notificationQueue.findMany({ where: { userId }, orderBy: { createdAt: 'asc' } }),
    db.auditLog.findMany({
      where: { userId },
      select: {
        action: true,
        userAgent: true,
        metadata: true,
        createdAt: true,
      },
      orderBy: { createdAt: 'asc' },
    }),
  ]);

  // Session 21 — behavioural / psychological surface. Filter key matches the
  // schema FK: `userId` for the member-facing modules, `memberId` for the S3
  // verification + training-session containers. `trainingAnnotations` mirrors
  // `tradeAnnotations`: the corrections RECEIVED, queried via the parent
  // training trade's `userId` (admin-authored relation excluded by policy).
  const [
    weeklyReviews,
    reflectionEntries,
    habitLogs,
    trainingTrades,
    trainingAnnotations,
    trainingDebriefs,
    trainingSessions,
    monthlyDebriefs,
    mindsetChecks,
    preTradeChecks,
    onboardingInterview,
    onboardingAnswers,
    memberProfile,
    memberProfileMonthlySnapshots,
    weeklyScheduleQuestionnaires,
    adaptiveCalendars,
    meetingAttendances,
    brokerAccounts,
    mt5AccountProofs,
    discrepancies,
    constancyScores,
    scoreEvents,
    alerts,
    trackingEntries,
    trackingSchedules,
    mentalMicroObjectives,
  ] = await Promise.all([
    db.weeklyReview.findMany({ where: { userId }, orderBy: { createdAt: 'asc' } }),
    db.reflectionEntry.findMany({ where: { userId }, orderBy: { createdAt: 'asc' } }),
    db.habitLog.findMany({ where: { userId }, orderBy: { createdAt: 'asc' } }),
    db.trainingTrade.findMany({ where: { userId }, orderBy: { createdAt: 'asc' } }),
    db.trainingAnnotation.findMany({
      where: { trainingTrade: { is: { userId } } },
      orderBy: { createdAt: 'asc' },
    }),
    db.trainingDebrief.findMany({ where: { userId }, orderBy: { createdAt: 'asc' } }),
    db.trainingSession.findMany({ where: { memberId: userId }, orderBy: { createdAt: 'asc' } }),
    db.monthlyDebrief.findMany({ where: { userId }, orderBy: { monthStart: 'asc' } }),
    db.mindsetCheck.findMany({ where: { userId }, orderBy: { createdAt: 'asc' } }),
    db.preTradeCheck.findMany({ where: { userId }, orderBy: { createdAt: 'asc' } }),
    db.onboardingInterview.findFirst({ where: { userId } }),
    db.onboardingInterviewAnswer.findMany({ where: { userId }, orderBy: { createdAt: 'asc' } }),
    db.memberProfile.findFirst({ where: { userId } }),
    db.memberProfileMonthlySnapshot.findMany({ where: { userId }, orderBy: { monthStart: 'asc' } }),
    db.weeklyScheduleQuestionnaire.findMany({ where: { userId }, orderBy: { createdAt: 'asc' } }),
    db.adaptiveCalendar.findMany({ where: { userId }, orderBy: { createdAt: 'asc' } }),
    db.meetingAttendance.findMany({ where: { userId }, orderBy: { createdAt: 'asc' } }),
    db.brokerAccount.findMany({ where: { memberId: userId }, orderBy: { createdAt: 'asc' } }),
    db.mt5AccountProof.findMany({ where: { memberId: userId }, orderBy: { createdAt: 'asc' } }),
    db.discrepancy.findMany({ where: { memberId: userId }, orderBy: { createdAt: 'asc' } }),
    db.constancyScore.findMany({ where: { memberId: userId }, orderBy: { createdAt: 'asc' } }),
    db.scoreEvent.findMany({ where: { memberId: userId }, orderBy: { createdAt: 'asc' } }),
    db.alert.findMany({ where: { memberId: userId }, orderBy: { createdAt: 'asc' } }),
    db.trackingEntry.findMany({ where: { userId }, orderBy: { submittedAt: 'asc' } }),
    db.trackingSchedule.findMany({ where: { userId }, orderBy: { createdAt: 'asc' } }),
    // S5 §32-E3 — `memberId`-keyed, like the S3 verification surface.
    db.mentalMicroObjective.findMany({
      where: { memberId: userId },
      orderBy: { createdAt: 'asc' },
    }),
  ]);

  return {
    schemaVersion: EXPORT_SCHEMA_VERSION,
    exportedAt: new Date().toISOString(),
    notes: {
      source: 'Fxmily · /account/data',
      contact: 'fxeliott@fxmily.fr',
      schemaDocumentation:
        'Politique de confidentialité Fxmily, voir https://app.fxmilyapp.com/legal/privacy',
    },
    user: user as SafeUser | null,
    trades,
    tradeAnnotations: annotations,
    tradeMedia,
    dailyCheckins: checkins,
    behavioralScores: scores,
    douglasDeliveries: deliveries,
    douglasFavorites: favorites,
    weeklyReports: reports,
    pushSubscriptions: pushSubsRaw as SafePushSubscription[],
    notificationPreferences: preferences,
    notificationQueue: queue,
    auditLogs: auditLogs as SafeAuditLog[],
    weeklyReviews,
    reflectionEntries,
    habitLogs,
    trainingTrades,
    trainingAnnotations,
    trainingDebriefs,
    trainingSessions,
    monthlyDebriefs,
    mindsetChecks,
    preTradeChecks,
    onboardingInterview: onboardingInterview as SafeOnboardingInterview | null,
    onboardingAnswers,
    memberProfile: memberProfile as SafeMemberProfile | null,
    memberProfileMonthlySnapshots,
    weeklyScheduleQuestionnaires,
    adaptiveCalendars,
    meetingAttendances,
    brokerAccounts,
    mt5AccountProofs,
    discrepancies,
    constancyScores,
    scoreEvents,
    alerts,
    trackingEntries,
    trackingSchedules,
    mentalMicroObjectives,
  };
}

export function summariseExport(snapshot: UserDataExport): ExportSummary {
  return {
    schemaVersion: snapshot.schemaVersion,
    tradeCount: snapshot.trades.length,
    tradeAnnotationCount: snapshot.tradeAnnotations.length,
    tradeMediaCount: snapshot.tradeMedia.length,
    dailyCheckinCount: snapshot.dailyCheckins.length,
    behavioralScoreCount: snapshot.behavioralScores.length,
    douglasDeliveryCount: snapshot.douglasDeliveries.length,
    douglasFavoriteCount: snapshot.douglasFavorites.length,
    weeklyReportCount: snapshot.weeklyReports.length,
    pushSubscriptionCount: snapshot.pushSubscriptions.length,
    notificationPreferenceCount: snapshot.notificationPreferences.length,
    notificationQueueCount: snapshot.notificationQueue.length,
    auditLogCount: snapshot.auditLogs.length,
    weeklyReviewCount: snapshot.weeklyReviews.length,
    reflectionEntryCount: snapshot.reflectionEntries.length,
    habitLogCount: snapshot.habitLogs.length,
    trainingTradeCount: snapshot.trainingTrades.length,
    trainingAnnotationCount: snapshot.trainingAnnotations.length,
    trainingDebriefCount: snapshot.trainingDebriefs.length,
    trainingSessionCount: snapshot.trainingSessions.length,
    monthlyDebriefCount: snapshot.monthlyDebriefs.length,
    mindsetCheckCount: snapshot.mindsetChecks.length,
    preTradeCheckCount: snapshot.preTradeChecks.length,
    onboardingInterviewCount: snapshot.onboardingInterview ? 1 : 0,
    onboardingAnswerCount: snapshot.onboardingAnswers.length,
    memberProfileCount: snapshot.memberProfile ? 1 : 0,
    memberProfileMonthlySnapshotCount: snapshot.memberProfileMonthlySnapshots.length,
    weeklyScheduleQuestionnaireCount: snapshot.weeklyScheduleQuestionnaires.length,
    adaptiveCalendarCount: snapshot.adaptiveCalendars.length,
    meetingAttendanceCount: snapshot.meetingAttendances.length,
    brokerAccountCount: snapshot.brokerAccounts.length,
    mt5AccountProofCount: snapshot.mt5AccountProofs.length,
    discrepancyCount: snapshot.discrepancies.length,
    constancyScoreCount: snapshot.constancyScores.length,
    scoreEventCount: snapshot.scoreEvents.length,
    alertCount: snapshot.alerts.length,
    trackingEntryCount: snapshot.trackingEntries.length,
    trackingScheduleCount: snapshot.trackingSchedules.length,
    mentalMicroObjectiveCount: snapshot.mentalMicroObjectives.length,
  };
}

/**
 * Build a download-friendly filename. Avoids leaking the full `userId` in
 * the filename (which could end up in the OS download history shared with
 * cloud sync); we keep the last 6 cuid chars + the local date.
 */
export function buildExportFilename(snapshot: UserDataExport, userId: string): string {
  const idTail = userId.slice(-6);
  const isoDay = snapshot.exportedAt.slice(0, 10);
  return `fxmily-data-${idTail}-${isoDay}.json`;
}
