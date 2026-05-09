import 'server-only';

import { Prisma } from '@/generated/prisma/client';
import { db } from '@/lib/db';

/**
 * J10 — RGPD account deletion lifecycle (article 17 right to erasure).
 *
 * Two-phase model on a single column (`User.deletedAt`) disambiguated by
 * `User.status` :
 *
 *   1. Active                 — `status='active', deletedAt=NULL`
 *   2. Scheduled (24h grace)  — `status='active', deletedAt = now + 24h`
 *      The user can log in, see the countdown, and cancel.
 *   3. Soft-deleted (matrl.)  — `status='deleted', deletedAt = materialisation time`
 *      PII has been scrubbed. Login refused (auth.ts gates on `status==='active'`).
 *      Eliot can still match audit logs to the row by `id` (cuid is opaque).
 *   4. Hard-purged             — row gone via cascade. Trades, check-ins, push
 *      subscriptions, etc. all disappear with `onDelete: Cascade` on the FK.
 *
 * Why a single column ? Adding `deletionScheduledAt` would have been cleaner
 * but requires a 2nd migration + dual-update consistency invariants. With one
 * column the invariants are tighter : a row's `deletedAt` always answers
 * "when does/did this account exit the active pool ?".
 *
 * Why 24h grace ? SPEC §15 J10 brief — anti-impulsivity. Mitigates the case
 * where a member deletes after a frustrating losing trade and regrets it
 * five minutes later. Long enough to think, short enough to feel honoured.
 *
 * Why 30d hard purge ? Aligns with the 30d Postgres backup retention
 * (`/etc/fxmily/backups`) so a restore-from-backup never resurrects a fully
 * purged account silently — by the time the backup ages out, the row is
 * irretrievable from the DB anyway.
 */

const GRACE_MS = 24 * 60 * 60 * 1000;
const HARD_PURGE_DAYS = 30;

export const ACCOUNT_DELETION_GRACE_HOURS = 24;
export const ACCOUNT_HARD_PURGE_DAYS = HARD_PURGE_DAYS;

export type AccountDeletionState =
  | { kind: 'active' }
  | { kind: 'scheduled'; scheduledAt: Date; msUntilMaterialisation: number }
  | { kind: 'materialised'; materialisedAt: Date; msUntilHardPurge: number };

export interface AccountDeletionStatusInput {
  status: string;
  deletedAt: Date | null;
}

/**
 * Pure helper — derive the current lifecycle state from `(status, deletedAt)`.
 * Exported for use in Server Components and tests; the page calls this
 * before deciding which UI to render.
 */
export function deriveDeletionState(
  user: AccountDeletionStatusInput,
  now: Date = new Date(),
): AccountDeletionState {
  if (user.status === 'deleted' && user.deletedAt) {
    const hardPurgeAt = user.deletedAt.getTime() + HARD_PURGE_DAYS * 24 * 60 * 60 * 1000;
    return {
      kind: 'materialised',
      materialisedAt: user.deletedAt,
      msUntilHardPurge: Math.max(0, hardPurgeAt - now.getTime()),
    };
  }
  if (user.status === 'active' && user.deletedAt) {
    return {
      kind: 'scheduled',
      scheduledAt: user.deletedAt,
      msUntilMaterialisation: Math.max(0, user.deletedAt.getTime() - now.getTime()),
    };
  }
  return { kind: 'active' };
}

export class AccountDeletionAlreadyRequestedError extends Error {
  override readonly name = 'AccountDeletionAlreadyRequestedError';
  constructor() {
    super('Account deletion is already scheduled.');
  }
}

export class AccountDeletionNotPendingError extends Error {
  override readonly name = 'AccountDeletionNotPendingError';
  constructor() {
    super('No pending account deletion to cancel.');
  }
}

export interface RequestAccountDeletionResult {
  scheduledAt: Date;
}

/**
 * Schedule a soft-delete : flips `deletedAt` to `now + 24h`, leaves `status`
 * at `active` so the member can still cancel inside the grace window.
 *
 * Atomicity (J10 Phase I — code-reviewer H1) : the previous implementation
 * was `findUnique` THEN `update`, leaving a race where two concurrent
 * submissions of the form (double-click on slow connection) could both
 * pass the `state.kind === 'active'` check and both `update`. Benign in
 * practice (`deletedAt` overwrites with the same value) BUT the audit row
 * fired twice, which polluted post-mortems. We now combine check + update
 * via a `WHERE deletedAt IS NULL AND status='active'` predicate +
 * `updateMany` so Prisma returns `count` ; if `count === 0` we know
 * another request won OR the user moved out of the active state. We then
 * fall back to `findUnique` to discriminate "already scheduled" vs
 * "user not found" so the Server Action can render the right banner.
 *
 * Idempotency : if a deletion is already scheduled, throws
 * `AccountDeletionAlreadyRequestedError`. Callers (Server Action) translate
 * this into a friendly UI message rather than re-extending the grace.
 */
export async function requestAccountDeletion(
  userId: string,
  options: { now?: Date; graceMs?: number } = {},
): Promise<RequestAccountDeletionResult> {
  const now = options.now ?? new Date();
  const graceMs = options.graceMs ?? GRACE_MS;
  const scheduledAt = new Date(now.getTime() + graceMs);

  // Atomic transition `(active, null) → (active, scheduledAt)`. Returns the
  // count of rows the predicate matched.
  const result = await db.user.updateMany({
    where: { id: userId, status: 'active', deletedAt: null },
    data: { deletedAt: scheduledAt },
  });

  if (result.count === 1) {
    return { scheduledAt };
  }

  // count===0 : either the user doesn't exist, or already scheduled, or
  // already materialised. Disambiguate with a single read.
  const existing = await db.user.findUnique({
    where: { id: userId },
    select: { status: true, deletedAt: true },
  });
  if (!existing) throw new Error(`User ${userId} not found`);

  // If the row exists but the predicate didn't match, it means the user is
  // not in the "active + null" state — every other possibility is "already
  // requested" (scheduled in the future) or "already materialised" (deleted).
  // Both surface as the same UI message.
  throw new AccountDeletionAlreadyRequestedError();
}

/**
 * Cancel a scheduled deletion. Only valid while `status='active'` AND
 * `deletedAt` is in the future. Once the cron has materialised the deletion
 * (status='deleted'), cancellation requires Eliot intervention via support.
 *
 * Atomicity (J10 Phase L review B2 — race fix to mirror `requestAccountDeletion`
 * Phase I H1) : the previous `findUnique` + `update` combo opened a race
 * window between the user clicking "annuler" and the cron flipping
 * `status='deleted'` mid-flight. Single `updateMany` with the full
 * predicate `(status='active', deletedAt > now)` makes the transition
 * atomic ; `count===0` means the cron won (or the row never had a
 * deletion scheduled).
 */
export async function cancelAccountDeletion(
  userId: string,
  options: { now?: Date } = {},
): Promise<void> {
  const now = options.now ?? new Date();

  // Predicate semantic — `status='active'` (the cron hasn't yet flipped
  // the row to 'deleted') AND `deletedAt IS NOT NULL` (a deletion is
  // actually scheduled). We do NOT add `gt: now` here : once the grace
  // window has passed but BEFORE the cron has materialised, the user
  // still has a legitimate cancel right (no actual destruction has
  // happened yet). If the cron has run, `status` is already 'deleted'
  // and the predicate misses → we throw `NotPending` and tell them to
  // contact Eliot for a manual restore (within the 30d window).
  // The `now` parameter is kept for API symmetry with `requestAccountDeletion`
  // — used only by the disambiguation read below if needed.
  void now;
  const result = await db.user.updateMany({
    where: {
      id: userId,
      status: 'active',
      deletedAt: { not: null },
    },
    data: { deletedAt: null },
  });

  if (result.count === 1) return;

  // count===0 — disambiguate "not pending" vs "user not found" so the
  // Server Action can render the right message.
  const existing = await db.user.findUnique({
    where: { id: userId },
    select: { id: true },
  });
  if (!existing) throw new Error(`User ${userId} not found`);
  throw new AccountDeletionNotPendingError();
}

export interface MaterialiseResult {
  scanned: number;
  materialised: number;
  errors: number;
  /** IDs of users actually flipped from 'active' to 'deleted' this run. */
  materialisedIds: string[];
  ranAt: string;
}

/**
 * Cron-driven phase transition : every scheduled deletion whose grace window
 * has elapsed becomes a true soft-delete. PII is scrubbed in this exact step
 * so that even an untimely backup taken at this moment captures only the
 * scrubbed values.
 *
 * Scrubbed fields :
 *   - email             → `deleted-${id}@fxmily.local` (keeps the UNIQUE
 *     constraint satisfied so a re-invitation could in theory land on a
 *     fresh row with the original email later, V2).
 *   - firstName, lastName, image, emailVerified → NULL.
 *   - passwordHash      → NULL (login refused regardless via status check;
 *     this protects against a future bug that would re-enable login).
 *   - pushSubscription   → NULL (legacy J9 column).
 *
 * Trades / check-ins / scores / push subs / preferences / queue / audits
 * stay in place under cascade-managed FKs until the hard-purge phase.
 */
export async function materialisePendingDeletions(
  options: { now?: Date; batchSize?: number } = {},
): Promise<MaterialiseResult> {
  const now = options.now ?? new Date();
  const batchSize = options.batchSize ?? 200;

  const pending = await db.user.findMany({
    where: {
      status: 'active',
      deletedAt: { lte: now },
    },
    select: { id: true, deletedAt: true },
    orderBy: { deletedAt: 'asc' },
    take: batchSize,
  });

  const materialisedIds: string[] = [];
  let errors = 0;
  for (const u of pending) {
    try {
      await db.user.update({
        where: { id: u.id },
        data: {
          status: 'deleted',
          deletedAt: now,
          email: `deleted-${u.id}@fxmily.local`,
          emailVerified: null,
          firstName: null,
          lastName: null,
          image: null,
          passwordHash: null,
          // Prisma 7 requires `Prisma.DbNull` to write SQL NULL into a Json
          // column ; bare `null` is rejected at the type level (and would be
          // misinterpreted as JSON `null` literal at the Postgres level).
          pushSubscription: Prisma.DbNull,
        },
      });
      materialisedIds.push(u.id);
    } catch (err) {
      errors += 1;
      console.error('[account.deletion.materialise] failed for', u.id, err);
    }
  }

  return {
    scanned: pending.length,
    materialised: materialisedIds.length,
    errors,
    materialisedIds,
    ranAt: now.toISOString(),
  };
}

export interface PurgeResult {
  scanned: number;
  purged: number;
  errors: number;
  /** IDs of users actually hard-deleted this run (cascade triggered). */
  purgedIds: string[];
  ranAt: string;
  threshold: string;
}

/**
 * Hard-delete users whose soft-delete is older than `HARD_PURGE_DAYS`.
 * Cascades through all user-scoped tables via the FK `onDelete: Cascade`
 * declared in `prisma/schema.prisma` (Trade, DailyCheckin, BehavioralScore,
 * MarkDouglasDelivery, MarkDouglasFavorite, WeeklyReport, PushSubscription,
 * NotificationPreference, NotificationQueue, AuditLog, Account, Session).
 *
 * Returned counts feed the cron heartbeat audit row.
 */
export async function purgeMaterialisedDeletions(
  options: { now?: Date; olderThanDays?: number; batchSize?: number } = {},
): Promise<PurgeResult> {
  const now = options.now ?? new Date();
  const days = options.olderThanDays ?? HARD_PURGE_DAYS;
  const threshold = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
  const batchSize = options.batchSize ?? 200;

  const stale = await db.user.findMany({
    where: {
      status: 'deleted',
      deletedAt: { lt: threshold },
    },
    select: { id: true },
    orderBy: { deletedAt: 'asc' },
    take: batchSize,
  });

  const purgedIds: string[] = [];
  let errors = 0;
  for (const u of stale) {
    try {
      await db.user.delete({ where: { id: u.id } });
      purgedIds.push(u.id);
    } catch (err) {
      errors += 1;
      console.error('[account.deletion.purge] failed for', u.id, err);
    }
  }

  return {
    scanned: stale.length,
    purged: purgedIds.length,
    errors,
    purgedIds,
    ranAt: now.toISOString(),
    threshold: threshold.toISOString(),
  };
}
