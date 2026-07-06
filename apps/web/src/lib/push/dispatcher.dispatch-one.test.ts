import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Tour 15 (P2-A) — side-effecting coverage for the quiet-hours GATE inside
 * `dispatchOne`. The sibling `dispatcher.test.ts` covers only pure functions;
 * this file proves the DB writes + audit the gate performs, with a mocked `db`
 * (repo convention: `vi.hoisted` + `vi.mock('@/lib/db')`, mirroring
 * `lib/audit/cleanup.test.ts`).
 *
 * The three branches proven here:
 *   1. undated nudge inside quiet hours → DEFERRED (status back to pending,
 *      nextAttemptAt = next local 08:00, attempts NET UNCHANGED after
 *      claim+defer, audit `notification.dispatch.deferred`).
 *   2. dated check-in reminder inside quiet hours → EXPIRED (P1 fix: status
 *      failed / quiet_hours_expired, audit `…expired_quiet_hours`, never held).
 *   3. exempt slug inside quiet hours → passes the gate and reaches the send
 *      path (proven by falling through to `no_subscriptions`, i.e. NOT
 *      intercepted as deferred/expired).
 *
 * Timezone anchor: a member in Europe/Paris (May = CEST, UTC+2) at 03:00 local
 * = 01:00 UTC. Next local 08:00 = 06:00 UTC the same day.
 */

const NIGHT_PARIS = new Date('2026-05-07T01:00:00Z'); // 03:00 Paris (inside window)

const db = vi.hoisted(() => ({
  updateMany: vi.fn(),
  findUnique: vi.fn(),
  update: vi.fn(),
}));

const collaborators = vi.hoisted(() => ({
  getEffectivePreferences: vi.fn(),
  listDispatchableSubscriptionsForUser: vi.fn(),
  logAudit: vi.fn(),
}));

vi.mock('@/lib/db', () => ({
  db: {
    notificationQueue: {
      updateMany: db.updateMany,
      findUnique: db.findUnique,
      update: db.update,
    },
  },
}));

vi.mock('@/lib/env', () => ({
  env: { AUTH_URL: 'https://app.fxmilyapp.com' },
}));

vi.mock('@/lib/auth/audit', () => ({
  logAudit: collaborators.logAudit,
}));

vi.mock('@/lib/push/preferences', () => ({
  getEffectivePreferences: collaborators.getEffectivePreferences,
}));

vi.mock('@/lib/push/service', () => ({
  listDispatchableSubscriptionsForUser: collaborators.listDispatchableSubscriptionsForUser,
  bumpSubscriptionLastSeen: vi.fn(),
  deletePushSubscriptionByEndpoint: vi.fn(),
}));

import { dispatchOne } from './dispatcher';
import type { NotificationTypeSlug } from '@/lib/schemas/push-subscription';

// Freeze the clock so `new Date()` inside the gate lands at 03:00 Paris.
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NIGHT_PARIS);

  db.updateMany.mockReset();
  db.findUnique.mockReset();
  db.update.mockReset();
  collaborators.getEffectivePreferences.mockReset();
  collaborators.listDispatchableSubscriptionsForUser.mockReset();
  collaborators.logAudit.mockReset();

  // Default happy-path stubs: claim succeeds, prefs allow everything.
  db.updateMany.mockResolvedValue({ count: 1 });
  db.update.mockResolvedValue({});
  collaborators.logAudit.mockResolvedValue(undefined);
});

afterEach(() => {
  vi.useRealTimers();
});

/**
 * Seed the row `dispatchOne` re-fetches after the atomic claim. `attempts`
 * reflects the POST-claim value (the claim already did attempts+1); for a
 * first-time row that is 1.
 */
function seedRow(type: NotificationTypeSlug, attemptsAfterClaim = 1) {
  db.findUnique.mockResolvedValue({
    id: 'noti_1',
    userId: 'user_1',
    type,
    payload: {},
    attempts: attemptsAfterClaim,
    isTransactional: false,
    user: { timezone: 'Europe/Paris' },
  });
  // Preference map: allow this slug (all true is enough for the gate).
  collaborators.getEffectivePreferences.mockResolvedValue(
    Object.fromEntries([[type, true]]) as Record<NotificationTypeSlug, boolean>,
  );
}

describe('dispatchOne — quiet-hours gate (Tour 15, P2-A)', () => {
  it('DEFERS an undated nudge inside quiet hours without counting a retry', async () => {
    seedRow('weekly_report_ready', 1);

    const result = await dispatchOne('noti_1');

    expect(result.status).toBe('deferred');
    if (result.status === 'deferred') {
      expect(result.reason).toBe('quiet_hours');
      // 08:00 Paris (CEST) = 06:00 UTC, same local day.
      expect(result.nextAttemptAt.toISOString()).toBe('2026-05-07T06:00:00.000Z');
    }

    // The defer write: status back to pending, nextAttemptAt = next 08:00, and
    // attempts DECREMENTED by 1 → cancels the claim's +1, so a claim+defer cycle
    // leaves `attempts` NET UNCHANGED (the P1-adjacent invariant: a hold is not
    // a delivery attempt).
    expect(db.update).toHaveBeenCalledTimes(1);
    const updateArg = db.update.mock.calls[0]?.[0];
    expect(updateArg.data.status).toBe('pending');
    expect(updateArg.data.nextAttemptAt.toISOString()).toBe('2026-05-07T06:00:00.000Z');
    expect(updateArg.data.attempts).toEqual({ decrement: 1 });

    // Audited as a deferral, never as a failure/retry.
    const deferAudit = collaborators.logAudit.mock.calls.find(
      (c) => c[0]?.action === 'notification.dispatch.deferred',
    );
    expect(deferAudit).toBeDefined();
    expect(deferAudit?.[0].metadata.reason).toBe('quiet_hours');

    // Never reached the send path.
    expect(collaborators.listDispatchableSubscriptionsForUser).not.toHaveBeenCalled();
  });

  it('EXPIRES a dated check-in reminder inside quiet hours (P1 fix — never deferred)', async () => {
    // This is the P1 scenario: an evening reminder at 03:00 local must be DROPPED,
    // not held to 08:00 where it would deliver yesterday's "Bilan du jour".
    seedRow('checkin_evening_reminder', 1);

    const result = await dispatchOne('noti_1');

    expect(result.status).toBe('expired');
    if (result.status === 'expired') {
      expect(result.reason).toBe('quiet_hours');
    }

    // The expire write: terminal `failed` status + explicit reason, and crucially
    // NO nextAttemptAt (it is not re-queued) and NO attempts change.
    expect(db.update).toHaveBeenCalledTimes(1);
    const updateArg = db.update.mock.calls[0]?.[0];
    expect(updateArg.data.status).toBe('failed');
    expect(updateArg.data.failureReason).toBe('quiet_hours_expired');
    expect(updateArg.data.lastErrorCode).toBe('quiet_hours_expired');
    expect(updateArg.data.nextAttemptAt).toBeUndefined();
    expect(updateArg.data.attempts).toBeUndefined();

    // Dedicated audit action, distinct from deferred / failed.
    const expireAudit = collaborators.logAudit.mock.calls.find(
      (c) => c[0]?.action === 'notification.dispatch.expired_quiet_hours',
    );
    expect(expireAudit).toBeDefined();
    expect(expireAudit?.[0].metadata.type).toBe('checkin_evening_reminder');

    // It was NOT deferred (no pending re-queue).
    const requeued = collaborators.logAudit.mock.calls.some(
      (c) => c[0]?.action === 'notification.dispatch.deferred',
    );
    expect(requeued).toBe(false);
    // Never reached the send path.
    expect(collaborators.listDispatchableSubscriptionsForUser).not.toHaveBeenCalled();
  });

  it('SENDS an exempt slug inside quiet hours (passes the gate at night)', async () => {
    // An MT5-proof verdict answers a just-uploaded proof → delivered even at 03:00.
    // Prove it is NOT intercepted by the gate: it reaches the send path, where an
    // empty subscription list yields `no_subscriptions` (the send path, not the
    // quiet-hours path).
    seedRow('verification_proof_analyzed', 1);
    collaborators.listDispatchableSubscriptionsForUser.mockResolvedValue([]);

    const result = await dispatchOne('noti_1');

    expect(result.status).toBe('skipped');
    if (result.status === 'skipped') {
      expect(result.reason).toBe('no_subscriptions');
    }

    // Reached the send path — the gate did NOT defer/expire it.
    expect(collaborators.listDispatchableSubscriptionsForUser).toHaveBeenCalledWith('user_1');
    const gateAudits = collaborators.logAudit.mock.calls.filter(
      (c) =>
        c[0]?.action === 'notification.dispatch.deferred' ||
        c[0]?.action === 'notification.dispatch.expired_quiet_hours',
    );
    expect(gateAudits).toHaveLength(0);
  });
});
