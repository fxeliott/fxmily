/**
 * V1.7 §30 J-M2 MeetingAttendance E2E — auth-gate + declare/persist + re-declare
 * upsert + HARD-guard refusals (cancelled / future / out-of-window) + render.
 *
 * SPEC §30.4 + §30.7 + §18.4. Covers the `/reunions` member surface in phases :
 *
 *   1. AUTH GATE — anon bounced to /login on /reunions (proxy.ts matcher +
 *      page-level `auth()` + `status='active'` gate).
 *   2. DECLARE + PERSIST + RE-DECLARE — a declaration round-trips through the
 *      Prisma V1.7 schema (2 enums `MeetingSlot`/`MeetingAttendanceMode`,
 *      `@@unique([meetingId, userId])` upsert idempotency: re-declaring UPDATES
 *      the same row, never stacks).
 *   3. HARD GUARD (SPEC §30.7) — declaration REFUSED for a cancelled / future /
 *      out-of-window meeting, never persisted.
 *   4. RENDER — `/reunions` shows the page heading for an authed member.
 *
 * Scar GG-CI (canon `v2-3-pre-trade-happy-path.spec.ts`): the service
 * `lib/meeting/service.ts` uses `import 'server-only'` and cannot load in the
 * Playwright runtime (no alias shim like `vitest.config.ts:13`). So we talk to
 * Prisma directly via `@/lib/db` and inline-replicate the HARD guard. The
 * service-layer logic itself is covered by Vitest (`lib/meeting/service.test.ts`
 * + `app/reunions/actions.test.ts`). `meetingWindowStart` is a PURE module (no
 * `server-only`) so it imports fine — we reuse the real one to stay faithful.
 *
 * Skipping policy (carbon J9 visual): skip with a clear message if Playwright
 * Chromium is not installed, rather than crashing.
 */

import { existsSync } from 'node:fs';

import { chromium, expect, test } from '@playwright/test';

import { db } from '@/lib/db';
import { localDateOf, parseLocalDate } from '@/lib/checkin/timezone';
import { MEETING_WINDOW_DAYS, meetingWindowStart } from '@/lib/meeting/window';
import { cleanupTestUsers, seedMemberUser, type SeededUser } from '@/test/db-helpers';
import { loginAs } from '@/test/e2e-auth';

const MS_PER_DAY = 24 * 60 * 60 * 1000;

type DeclInput = { meetingId: string; attendanceMode: 'live' | 'replay'; contentReviewed: boolean };

/**
 * Inline replica of `declareMeetingAttendance` from `lib/meeting/service.ts`
 * (server-only → not loadable in Playwright). Semantics MUST match the service
 * exactly: HARD guard (not_found / cancelled / future / out_of_window) then
 * upsert on `(meetingId, userId)`. Throws a `MeetingNotDeclarableError`-shaped
 * error (name + reason) on refusal.
 *
 * This E2E exercises the cancelled / future / out_of_window guards (the cases
 * needing real Meeting rows + the rolling window). The `not_found` branch is
 * covered by Vitest against the real service (`lib/meeting/service.test.ts`).
 */
function notDeclarable(reason: string): Error & { reason: string } {
  return Object.assign(new Error(`Meeting not declarable: ${reason}`), {
    name: 'MeetingNotDeclarableError',
    reason,
  });
}

async function declareInline(userId: string, input: DeclInput, now: Date) {
  const [meeting, user] = await Promise.all([
    db.meeting.findUnique({
      where: { id: input.meetingId },
      select: { id: true, status: true, scheduledAt: true },
    }),
    db.user.findUnique({ where: { id: userId }, select: { joinedAt: true } }),
  ]);

  if (!meeting || !user) throw notDeclarable('not_found');
  if (meeting.status === 'cancelled') throw notDeclarable('cancelled');
  if (meeting.scheduledAt.getTime() > now.getTime()) throw notDeclarable('future');
  const fromUtc = meetingWindowStart(now, user.joinedAt);
  if (meeting.scheduledAt.getTime() < fromUtc.getTime()) throw notDeclarable('out_of_window');

  return db.meetingAttendance.upsert({
    where: { meetingId_userId: { meetingId: input.meetingId, userId } },
    create: {
      meetingId: input.meetingId,
      userId,
      attendanceMode: input.attendanceMode,
      contentReviewed: input.contentReviewed,
      declaredAt: now,
    },
    update: {
      attendanceMode: input.attendanceMode,
      contentReviewed: input.contentReviewed,
      declaredAt: now,
    },
    select: { id: true, attendanceMode: true, contentReviewed: true },
  });
}

const createdMeetingIds: string[] = [];

/** Create a Meeting with `date` DERIVED from `scheduledAt` (invariant §30.7). */
async function createTestMeeting(
  scheduledAt: Date,
  status: 'scheduled' | 'cancelled',
  slot: 'midday' | 'evening' = 'midday',
): Promise<string> {
  const localDate = localDateOf(scheduledAt, 'Europe/Paris');
  const row = await db.meeting.create({
    data: { date: parseLocalDate(localDate), slot, scheduledAt, status },
    select: { id: true },
  });
  createdMeetingIds.push(row.id);
  return row.id;
}

const MEMBER_EMAIL = 'v1-7-meeting.member.e2e.test@fxmily.local';
const MEMBER_PASSWORD = 'V1_7-MeetingPwd-2026!';

let member: SeededUser | null = null;

async function isChromiumLaunchable(): Promise<{ ok: boolean; reason?: string }> {
  const exec = chromium.executablePath();
  if (!exec || !existsSync(exec)) {
    return {
      ok: false,
      reason: `Playwright Chromium binary not found at ${exec || '(unresolved path)'} — run \`pnpm exec playwright install chromium\` once and re-run this suite.`,
    };
  }
  return { ok: true };
}

test.describe('V1.7 §30 MeetingAttendance — auth-gate + declare/persist + HARD guard + render', () => {
  test.beforeAll(async () => {
    const probe = await isChromiumLaunchable();
    test.skip(!probe.ok, probe.reason ?? 'Chromium not launchable');

    await cleanupTestUsers();
    member = await seedMemberUser({
      email: MEMBER_EMAIL,
      password: MEMBER_PASSWORD,
      firstName: 'V1_7',
      lastName: 'Meeting',
    });
    // Backdate joinedAt 60d so the rolling 30d window = [now-30d, now) and a
    // meeting 2 days ago is in-window while one 40 days ago is out-of-window.
    await db.user.update({
      where: { id: member.id },
      data: { joinedAt: new Date(Date.now() - 60 * MS_PER_DAY) },
    });
  });

  test.afterAll(async () => {
    if (createdMeetingIds.length > 0) {
      await db.meetingAttendance.deleteMany({ where: { meetingId: { in: createdMeetingIds } } });
      await db.meeting.deleteMany({ where: { id: { in: createdMeetingIds } } });
    }
    await cleanupTestUsers();
    member = null;
  });

  test('anon is bounced to /login on /reunions', async ({ page }) => {
    await page.goto('/reunions');
    await expect(page).toHaveURL(/\/login/);
  });

  test('DECLARE + PERSIST + RE-DECLARE: upsert on (meetingId, userId) never stacks', async () => {
    if (!member) throw new Error('seed missing — beforeAll did not run');
    const now = new Date();
    const meetingId = await createTestMeeting(
      new Date(now.getTime() - 2 * MS_PER_DAY),
      'scheduled',
    );

    // 1st declaration: live + content read → complete.
    const first = await declareInline(
      member.id,
      { meetingId, attendanceMode: 'live', contentReviewed: true },
      now,
    );
    expect(first.attendanceMode).toBe('live');
    expect(first.contentReviewed).toBe(true);

    // Re-declaration: replay + content NOT read → UPDATES the same row.
    const second = await declareInline(
      member.id,
      { meetingId, attendanceMode: 'replay', contentReviewed: false },
      now,
    );
    expect(second.id).toBe(first.id); // same row — no stack

    const count = await db.meetingAttendance.count({
      where: { meetingId, userId: member.id },
    });
    expect(count).toBe(1);

    const row = await db.meetingAttendance.findUnique({
      where: { meetingId_userId: { meetingId, userId: member.id } },
      select: { attendanceMode: true, contentReviewed: true },
    });
    expect(row?.attendanceMode).toBe('replay');
    expect(row?.contentReviewed).toBe(false);
  });

  test('HARD GUARD: REFUSES a cancelled meeting (reason=cancelled), never persists', async () => {
    if (!member) throw new Error('seed missing');
    const now = new Date();
    const meetingId = await createTestMeeting(
      new Date(now.getTime() - 3 * MS_PER_DAY),
      'cancelled',
    );

    const err = await declareInline(
      member.id,
      { meetingId, attendanceMode: 'live', contentReviewed: true },
      now,
    ).catch((e) => e);
    expect(err.reason).toBe('cancelled');

    const count = await db.meetingAttendance.count({ where: { meetingId, userId: member.id } });
    expect(count).toBe(0);
  });

  test('HARD GUARD: REFUSES a future meeting (reason=future)', async () => {
    if (!member) throw new Error('seed missing');
    const now = new Date();
    const meetingId = await createTestMeeting(
      new Date(now.getTime() + 1 * MS_PER_DAY),
      'scheduled',
    );

    const err = await declareInline(
      member.id,
      { meetingId, attendanceMode: 'live', contentReviewed: true },
      now,
    ).catch((e) => e);
    expect(err.reason).toBe('future');

    const count = await db.meetingAttendance.count({ where: { meetingId, userId: member.id } });
    expect(count).toBe(0);
  });

  test(`HARD GUARD: REFUSES an out-of-window meeting (> ${MEETING_WINDOW_DAYS}d, reason=out_of_window)`, async () => {
    if (!member) throw new Error('seed missing');
    const now = new Date();
    const meetingId = await createTestMeeting(
      new Date(now.getTime() - 40 * MS_PER_DAY),
      'scheduled',
    );

    const err = await declareInline(
      member.id,
      { meetingId, attendanceMode: 'live', contentReviewed: true },
      now,
    ).catch((e) => e);
    expect(err.reason).toBe('out_of_window');

    const count = await db.meetingAttendance.count({ where: { meetingId, userId: member.id } });
    expect(count).toBe(0);
  });

  test('RENDER: /reunions shows the page heading for an authed member', async ({
    page,
    request,
  }) => {
    if (!member) throw new Error('seed missing');

    await page.goto('/login');
    await loginAs(page, request, member.email, member.password);

    await page.goto('/reunions');
    await page.waitForLoadState('networkidle');

    await expect(page).toHaveURL(/\/reunions/);
    await expect(page.locator('h1#reunions-heading')).toBeVisible();

    // No Next dev-overlay error dialog mounted.
    await expect(page.locator('[data-nextjs-dialog-overlay]')).toHaveCount(0);
  });
});
