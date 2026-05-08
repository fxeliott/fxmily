/**
 * Smoke test for J9 — Web Push notifications dispatcher.
 *
 * Validates SPEC §15 J9 "Done quand" criteria, end-to-end against the dev server :
 *   1. Member has a `PushSubscription` row → cron dispatcher claims it.
 *   2. NotificationQueue row → status flips pending → dispatching → sent.
 *   3. Audit `notification.dispatched` row created with metadata.
 *   4. Idempotency : a 2nd cron run does NOT re-send the row (already sent).
 *   5. Preference filter : when member opts out, the dispatcher marks failed
 *      with reason `preference_off` and emits `notification.dispatch.skipped`.
 *
 * V1 path uses the `MockPushClient` (default when VAPID env absent), so this
 * smoke test does NOT need real VAPID keys configured. The Live path with
 * real `web-push` is exercised separately via the manual iPhone test (Eliot).
 *
 * Pre-conditions :
 *   - Postgres dev DB running (docker-compose.dev.yml).
 *   - Dev server running on http://localhost:3000.
 *   - Migration `20260508180000_j9_push_subscription` applied.
 *   - CRON_SECRET in app env (default `dev-smoke-cron-secret-fxmily-j9`).
 */

import { PrismaPg } from '@prisma/adapter-pg';

import { PrismaClient } from '../src/generated/prisma/client.js';
import { hashPassword } from '../src/lib/auth/password.js';

const TEST_EMAIL = 'j9smoke.member.e2e.test@fxmily.local';
const TEST_PASSWORD = 'J9SmokePwd-2026!';
const CRON_SECRET = process.env.CRON_SECRET ?? 'dev-smoke-cron-secret-fxmily-j9';
const APP_URL = 'http://localhost:3000';

// Canonical 87-char base64url ECDH P-256 key + 22-char auth (deterministic so
// cleanup is easy).
const FAKE_P256DH =
  'BNcFxmilyJ9SmokeTestEcdhP256PublicKey0000000000000000000000000000000000000000000000000A';
const FAKE_AUTH = 'tA9FxmilyJ9SmokeAu';

function required(name: string): string {
  const v = process.env[name];
  if (!v) {
    console.error(`[smoke:j9] Missing env var ${name}.`);
    process.exit(2);
  }
  return v;
}

async function main() {
  const databaseUrl = required('DATABASE_URL');
  const adapter = new PrismaPg({ connectionString: databaseUrl });
  const db = new PrismaClient({ adapter });

  try {
    // --- Step 1: ensure test member exists -------------------------------------
    console.log('[smoke:j9] step 1 — seeding test member');
    // Cleanup any stale data from prior runs.
    await db.notificationQueue.deleteMany({ where: { user: { email: TEST_EMAIL } } });
    await db.pushSubscription.deleteMany({ where: { user: { email: TEST_EMAIL } } });
    await db.notificationPreference.deleteMany({ where: { user: { email: TEST_EMAIL } } });

    const passwordHash = await hashPassword(TEST_PASSWORD);
    const member = await db.user.upsert({
      where: { email: TEST_EMAIL },
      create: {
        email: TEST_EMAIL,
        passwordHash,
        firstName: 'Smoke',
        lastName: 'J9',
        role: 'member',
        status: 'active',
      },
      update: { passwordHash, status: 'active' },
      select: { id: true },
    });
    console.log(`[smoke:j9] step 1 — member id=${member.id}`);

    // --- Step 2: seed a PushSubscription row -----------------------------------
    console.log('[smoke:j9] step 2 — seeding push subscription');
    const sub = await db.pushSubscription.create({
      data: {
        userId: member.id,
        endpoint: `https://fcm.googleapis.com/fcm/send/smoke-j9-${Date.now()}`,
        p256dhKey: FAKE_P256DH,
        authKey: FAKE_AUTH,
        userAgent: 'smoke-test-j9/1.0',
      },
      select: { id: true, endpoint: true },
    });
    console.log(`[smoke:j9] step 2 — subscription id=${sub.id}`);

    // --- Step 3: enqueue a notification ----------------------------------------
    console.log('[smoke:j9] step 3 — enqueueing notification (annotation_received)');
    const notif = await db.notificationQueue.create({
      data: {
        userId: member.id,
        type: 'annotation_received',
        payload: { tradeId: 'smoke-trade-clx0', annotationId: 'smoke-anno-1' },
        status: 'pending',
      },
      select: { id: true, status: true, attempts: true },
    });
    console.log(`[smoke:j9] step 3 — notif id=${notif.id} status=${notif.status}`);

    // --- Step 4: trigger the cron dispatcher -----------------------------------
    console.log('[smoke:j9] step 4 — POST /api/cron/dispatch-notifications');
    const cronUrl = `${APP_URL}/api/cron/dispatch-notifications`;
    const cronResp = await fetch(cronUrl, {
      method: 'POST',
      headers: { 'X-Cron-Secret': CRON_SECRET },
    });
    if (!cronResp.ok) {
      console.error(`[smoke:j9] step 4 — cron HTTP ${cronResp.status}`);
      console.error(await cronResp.text());
      process.exit(1);
    }
    const cronJson = (await cronResp.json()) as Record<string, unknown>;
    console.log(`[smoke:j9] step 4 — cron response`, JSON.stringify(cronJson));
    if (cronJson.sent === undefined || (cronJson.sent as number) < 1) {
      console.error('[smoke:j9] step 4 — expected at least 1 sent, got:', cronJson);
      process.exit(1);
    }

    // --- Step 5: verify queue row state + audit trail --------------------------
    console.log('[smoke:j9] step 5 — verifying queue state + audit log');
    const updated = await db.notificationQueue.findUnique({
      where: { id: notif.id },
      select: { status: true, attempts: true, dispatchedAt: true },
    });
    if (updated?.status !== 'sent') {
      console.error('[smoke:j9] step 5 — expected status=sent, got:', updated);
      process.exit(1);
    }
    if (updated.dispatchedAt === null) {
      console.error('[smoke:j9] step 5 — expected dispatchedAt to be set');
      process.exit(1);
    }
    const dispatched = await db.auditLog.findFirst({
      where: { userId: member.id, action: 'notification.dispatched' },
      orderBy: { createdAt: 'desc' },
      select: { metadata: true },
    });
    if (dispatched === null) {
      console.error('[smoke:j9] step 5 — no notification.dispatched audit row');
      process.exit(1);
    }
    console.log(`[smoke:j9] step 5 — queue.status=sent, audit row OK`);

    // --- Step 6: idempotency — 2nd run does NOT resend -------------------------
    console.log('[smoke:j9] step 6 — idempotency check (2nd cron run)');
    const cron2 = await fetch(cronUrl, {
      method: 'POST',
      headers: { 'X-Cron-Secret': CRON_SECRET },
    });
    if (!cron2.ok) {
      console.error(`[smoke:j9] step 6 — cron HTTP ${cron2.status}`);
      process.exit(1);
    }
    const cron2Json = (await cron2.json()) as Record<string, unknown>;
    // The 2nd run shouldn't re-process our `sent` row. If it found nothing,
    // `scanned` should be 0 (or only count NEW pending rows from other tests).
    console.log(`[smoke:j9] step 6 — 2nd cron response`, JSON.stringify(cron2Json));
    const updatedAfter = await db.notificationQueue.findUnique({
      where: { id: notif.id },
      select: { status: true, dispatchedAt: true },
    });
    if (updatedAfter?.status !== 'sent') {
      console.error('[smoke:j9] step 6 — status changed unexpectedly');
      process.exit(1);
    }
    console.log('[smoke:j9] step 6 — idempotency OK (status still=sent)');

    // --- Step 7: preference filter ---------------------------------------------
    console.log('[smoke:j9] step 7 — preference filter (opt out + new notif)');
    await db.notificationPreference.create({
      data: { userId: member.id, type: 'annotation_received', enabled: false },
    });
    const notif2 = await db.notificationQueue.create({
      data: {
        userId: member.id,
        type: 'annotation_received',
        payload: { tradeId: 'smoke-trade-clx1' },
        status: 'pending',
      },
      select: { id: true },
    });
    const cron3 = await fetch(cronUrl, {
      method: 'POST',
      headers: { 'X-Cron-Secret': CRON_SECRET },
    });
    const cron3Json = (await cron3.json()) as Record<string, unknown>;
    console.log(`[smoke:j9] step 7 — 3rd cron response`, JSON.stringify(cron3Json));

    const filtered = await db.notificationQueue.findUnique({
      where: { id: notif2.id },
      select: { status: true, lastErrorCode: true, failureReason: true },
    });
    if (filtered?.status !== 'failed' || filtered.lastErrorCode !== 'preference_off') {
      console.error(
        '[smoke:j9] step 7 — expected status=failed reason=preference_off, got:',
        filtered,
      );
      process.exit(1);
    }
    const skipped = await db.auditLog.findFirst({
      where: {
        userId: member.id,
        action: 'notification.dispatch.skipped',
      },
      orderBy: { createdAt: 'desc' },
      select: { metadata: true },
    });
    if (skipped === null) {
      console.error('[smoke:j9] step 7 — no notification.dispatch.skipped audit row');
      process.exit(1);
    }
    console.log('[smoke:j9] step 7 — preference filter OK');

    // --- Step 8: cleanup -------------------------------------------------------
    console.log('[smoke:j9] step 8 — cleanup');
    await db.notificationQueue.deleteMany({ where: { userId: member.id } });
    await db.pushSubscription.deleteMany({ where: { userId: member.id } });
    await db.notificationPreference.deleteMany({ where: { userId: member.id } });
    await db.auditLog.deleteMany({ where: { userId: member.id } });
    await db.user.delete({ where: { id: member.id } });

    console.log(
      '[smoke:j9] ALL GREEN — J9 critère "Done quand" validé en live (mock client path).',
    );
  } finally {
    await db.$disconnect();
  }
}

main().catch((err) => {
  console.error('[smoke:j9] FAILED', err);
  process.exit(1);
});
