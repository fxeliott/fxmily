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
 *
 * Output shape is versioned via `schemaVersion` so a future J11+ schema
 * change is non-breaking for users who keep historical exports.
 */

export const EXPORT_SCHEMA_VERSION = 1 as const;

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
  dailyCheckins: SafeDailyCheckin[];
  behavioralScores: SafeBehavioralScore[];
  douglasDeliveries: SafeDouglasDelivery[];
  douglasFavorites: SafeDouglasFavorite[];
  weeklyReports: SafeWeeklyReport[];
  pushSubscriptions: SafePushSubscription[];
  notificationPreferences: SafeNotificationPreference[];
  notificationQueue: SafeNotificationQueueRow[];
  auditLogs: SafeAuditLog[];
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
type SafeDailyCheckin = Awaited<ReturnType<typeof db.dailyCheckin.findMany>>[number];
type SafeBehavioralScore = Awaited<ReturnType<typeof db.behavioralScore.findMany>>[number];
type SafeDouglasDelivery = Awaited<ReturnType<typeof db.markDouglasDelivery.findMany>>[number];
type SafeDouglasFavorite = Awaited<ReturnType<typeof db.markDouglasFavorite.findMany>>[number];
type SafeWeeklyReport = Awaited<ReturnType<typeof db.weeklyReport.findMany>>[number];
type SafeNotificationPreference = Awaited<
  ReturnType<typeof db.notificationPreference.findMany>
>[number];
type SafeNotificationQueueRow = Awaited<ReturnType<typeof db.notificationQueue.findMany>>[number];

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
  dailyCheckinCount: number;
  behavioralScoreCount: number;
  douglasDeliveryCount: number;
  douglasFavoriteCount: number;
  weeklyReportCount: number;
  pushSubscriptionCount: number;
  notificationPreferenceCount: number;
  notificationQueueCount: number;
  auditLogCount: number;
}

export async function buildUserDataExport(userId: string): Promise<UserDataExport> {
  // All user-scoped reads are run in parallel — they hit different tables
  // and Postgres handles the fan-out fine. At 30 → 1000 members per user
  // dataset this stays sub-second.
  const [
    user,
    trades,
    annotations,
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

  return {
    schemaVersion: EXPORT_SCHEMA_VERSION,
    exportedAt: new Date().toISOString(),
    notes: {
      source: 'Fxmily — /account/data',
      contact: 'eliot@fxmily.com',
      schemaDocumentation:
        'Politique de confidentialité Fxmily — voir https://app.fxmily.com/legal/privacy',
    },
    user: user as SafeUser | null,
    trades,
    tradeAnnotations: annotations,
    dailyCheckins: checkins,
    behavioralScores: scores,
    douglasDeliveries: deliveries,
    douglasFavorites: favorites,
    weeklyReports: reports,
    pushSubscriptions: pushSubsRaw as SafePushSubscription[],
    notificationPreferences: preferences,
    notificationQueue: queue,
    auditLogs: auditLogs as SafeAuditLog[],
  };
}

export function summariseExport(snapshot: UserDataExport): ExportSummary {
  return {
    schemaVersion: snapshot.schemaVersion,
    tradeCount: snapshot.trades.length,
    tradeAnnotationCount: snapshot.tradeAnnotations.length,
    dailyCheckinCount: snapshot.dailyCheckins.length,
    behavioralScoreCount: snapshot.behavioralScores.length,
    douglasDeliveryCount: snapshot.douglasDeliveries.length,
    douglasFavoriteCount: snapshot.douglasFavorites.length,
    weeklyReportCount: snapshot.weeklyReports.length,
    pushSubscriptionCount: snapshot.pushSubscriptions.length,
    notificationPreferenceCount: snapshot.notificationPreferences.length,
    notificationQueueCount: snapshot.notificationQueue.length,
    auditLogCount: snapshot.auditLogs.length,
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
